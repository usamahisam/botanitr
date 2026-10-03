import { queries, now, BotRow } from '../db/index.js';
import { registry } from '../exchange/registry.js';
import { Ticker } from '../exchange/base.js';
import { log } from '../log.js';
import { getStrategy, StrategyContext } from '../strategies/types.js';
import { executeAction } from './trader.js';
import { getUsdtIdr } from './balances.js';
import { notifyTrade, notify } from '../telegram/notify.js';
import { pnl } from './pnl.js';
import '../strategies/grid.js';
import '../strategies/dca.js';
import '../strategies/scalper.js';
import '../strategies/harvester.js';
import '../strategies/rebalance.js';

/** Cache ticker in-memory 5 detik per user+exchange+pair */
const tickerCache = new Map<string, { data: Ticker; ts: number }>();
const balanceCache = new Map<string, { data: { asset: string; free: number; locked: number }[]; ts: number }>();
async function getTickerCached(exchangeId: string, pair: string, userId = 0): Promise<Ticker> {
  const key = `${userId}:${exchangeId}:${pair}`;
  const c = tickerCache.get(key);
  if (c && Date.now() - c.ts < 5000) return c.data;
  const data = await registry.getForUser(exchangeId, userId).getTicker(pair);
  tickerCache.set(key, { data, ts: Date.now() });
  return data;
}

/** Stagger: bot diproses tiap ~8 detik + jitter per id */
function shouldTick(bot: BotRow, nowMs: number): boolean {
  const interval = 8000 + (bot.id % 4) * 1500;
  const last = (bot as any).__last_tick || 0;
  if (nowMs - last < interval) return false;
  (bot as any).__last_tick = nowMs;
  return true;
}

const botCache = new Map<number, BotRow>();

async function processBot(bot: BotRow) {
  // Guard: max daily loss — pause bot jika rugi realized hari ini melewati batas
  if (bot.max_daily_loss_pct > 0) {
    const client0 = registry.getForUser(bot.exchange_id, bot.user_id);
    const mult = client0.quoteAsset === 'IDR' ? 1 : await getUsdtIdr();
    const realizedToday = pnl.botRealizedToday(bot.id);
    const lossLimit = (bot.max_daily_loss_pct / 100) * bot.current_budget;
    if (realizedToday < 0 && Math.abs(realizedToday) >= lossLimit) {
      queries.setBotStatus.run('paused', now(), bot.id);
      const msg = `🛑 MAX DAILY LOSS tercapai untuk "${bot.name}": rugi hari ini ${Math.round(realizedToday * mult).toLocaleString('id-ID')} ≥ batas ${Math.round(lossLimit * mult).toLocaleString('id-ID')} (${bot.max_daily_loss_pct}%). Bot di-pause otomatis.`;
      log('warn', 'ENGINE', msg, { bot_id: bot.id, user_id: bot.user_id });
      await notify(msg, bot.user_id).catch(() => {});
      return;
    }
  }

  const strategy = getStrategy(bot.strategy);
  const params = JSON.parse(bot.params || '{}');
  let state = JSON.parse(bot.state || '{}');

  const ticker = await getTickerCached(bot.exchange_id, bot.pair, bot.user_id);
  const client = registry.getForUser(bot.exchange_id, bot.user_id);
  const usdtIdr = client.quoteAsset === 'IDR' ? 1 : await getUsdtIdr();

  // Cache saldo 60 detik per user+exchange+mode (dipakai rebalance)
  const balKey = `${bot.user_id}:${bot.exchange_id}:${bot.mode}`;
  let balEntry = balanceCache.get(balKey);
  if (!balEntry || Date.now() - balEntry.ts > 60000) {
    const balances = bot.mode === 'paper'
      ? registry.getPaperForUser(bot.exchange_id, bot.user_id).getBalances()
      : await client.getBalances();
    balEntry = { data: balances, ts: Date.now() };
    balanceCache.set(balKey, balEntry);
  }

  const ctx: StrategyContext = {
    bot, ticker, usdtIdr, now: Date.now(),
    getKlines: (interval, limit) => client.getKlines(bot.pair, interval, limit),
    getBalances: async () => balEntry!.data,
    getPrice: async (pair: string) => (await getTickerCached(bot.exchange_id, pair, bot.user_id)).last
  };

  const actions = await strategy.onTick(ctx, state, params);

  // Eksekusi aksi; update state berdasarkan hasil fill
  for (const action of actions) {
    const trade = await executeAction(bot, action, usdtIdr);
    if (trade) {
      // Catat fill ke state strategi (untuk grid/dca/harvester entries)
      applyFillToState(bot.strategy, state, trade, action);
      await notifyTrade(trade, action, usdtIdr);
    }
  }

  queries.updateBotState.run(JSON.stringify(state), now(), bot.id);
  if (bot.error_count > 0) queries.setBotError.run(0, now(), bot.id);
}

/** Catat hasil fill ke struktur state internal strategi */
function applyFillToState(strategyName: string, state: any, trade: any, action: any) {
  if (action.type === 'buy') {
    const entry = { price: trade.price, qty: trade.qty, cost: trade.value };
    if (Array.isArray(state.filledBuys)) state.filledBuys.push(entry);
    else if (Array.isArray(state.entries)) state.entries.push(entry);
    else if (strategyName === 'scalper') state.position = { entryPrice: trade.price, qty: trade.qty, cost: trade.value };
  }
  // Sell: state sudah di-reset oleh strategi itu sendiri saat menghasilkan aksi
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startScheduler(broadcast: (event: string, payload: any) => void) {
  const tick = async () => {
    if (running) return; // hindari overlap
    running = true;
    try {
      const bots = queries.runningBots.all() as BotRow[];
      const nowMs = Date.now();
      for (const bot of bots) {
        if (!shouldTick(bot, nowMs)) continue;
        try {
          await processBot(bot);
        } catch (e: any) {
          const fresh = queries.getBot.get(bot.id) as BotRow;
          const errCount = (fresh.error_count || 0) + 1;
          queries.setBotError.run(errCount, now(), bot.id);
          if (errCount <= 3 || errCount % 10 === 0) {
            log('error', 'ERROR', `Bot "${bot.name}" error (#${errCount}): ${e.message}`, { bot_id: bot.id, user_id: bot.user_id });
          }
          // Kredensial salah → pause otomatis
          if (/kredensial|Invalid API-key|permissions/i.test(e.message) && bot.mode === 'live') {
            queries.setBotStatus.run('paused', now(), bot.id);
            log('warn', 'ENGINE', `Bot "${bot.name}" di-pause otomatis (masalah kredensial/izin)`, { bot_id: bot.id, user_id: bot.user_id });
          }
        }
      }
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, 4000);
  log('info', 'ENGINE', 'Scheduler multi-bot dimulai (interval 4s, stagger per bot)');
}

export function stopScheduler() { if (timer) clearInterval(timer); }
