import { db, queries, now, BotRow } from '../db/index.js';
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
import '../strategies/revert.js';
import '../strategies/bollinger.js';
import '../strategies/breakout.js';
import '../strategies/dynamic.js';

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

/**
 * Stagger: bot diproses tiap ~8 detik + jitter per id.
 * WAJIB module-level Map: objek BotRow dari DB selalu baru tiap tick,
 * sehingga state di badan objek (__last_tick dulu) tak pernah bertahan.
 */
const lastTick = new Map<number, number>();
export function shouldTick(botId: number, nowMs: number): boolean {
  const interval = 8000 + (botId % 4) * 1500;
  const last = lastTick.get(botId) || 0;
  if (nowMs - last < interval) return false;
  lastTick.set(botId, nowMs);
  return true;
}
/** Buang entri bot yang sudah tak ada agar Map tak bocor memori. */
export function pruneTickCache(activeIds: number[]) {
  const keep = new Set(activeIds);
  for (const id of lastTick.keys()) {
    if (!keep.has(id)) lastTick.delete(id);
  }
}

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

  const minLot = (db.prepare('SELECT min_lot_idr FROM exchanges WHERE id=? AND user_id=?').get(bot.exchange_id, bot.user_id) as any)?.min_lot_idr ?? 10000;
  const ctx: StrategyContext = {
    bot, ticker, quote: client.quoteAsset, minLot, usdtIdr, now: Date.now(),
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

/**
 * Catat hasil fill ke struktur state internal strategi.
 * Diekspor untuk pengujian. PENTING: tracker (level/terakhir-beli) hanya
 * dimajukan di sini — SETELAH fill terkonfirmasi — agar order yang gagal
 * tetap dicoba lagi tick berikutnya, bukan hangus diam-diam.
 */
export function applyFillToState(strategyName: string, state: any, trade: any, action: any) {
  if (action.type === 'buy') {
    const entry: any = { price: trade.price, qty: trade.qty, cost: trade.value };
    // Level grid (untuk partial-unwind per level); strategi lain abaikan.
    if (Number.isInteger(action?.meta?.level)) entry.level = action.meta.level;
    if (Array.isArray(state.filledBuys)) state.filledBuys.push(entry);
    else if (Array.isArray(state.entries)) state.entries.push(entry);
    else if ('position' in state && (state.position == null)) state.position = { entryPrice: trade.price, qty: trade.qty, cost: trade.value };
    // Tracker harga terakhir (dipakai penentu buy berikutnya)
    if (typeof state.lastEntryPrice === 'number') state.lastEntryPrice = trade.price;
    if (typeof state.lastBuyPrice === 'number') state.lastBuyPrice = trade.price;
    // Level grid/dynamic dari meta aksi (bukan saat aksi dibuat)
    const lvl = action?.meta?.level;
    if ((strategyName === 'grid' || strategyName === 'dynamic') && Number.isInteger(lvl) && Array.isArray(state.levelsHit) && !state.levelsHit.includes(lvl)) {
      state.levelsHit.push(lvl);
    }
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
      pruneTickCache(bots.map(b => b.id));
      for (const bot of bots) {
        if (!shouldTick(bot.id, nowMs)) continue;
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
