import { db, queries, now, BotRow } from '../db/index.js';
import { registry } from '../exchange/registry.js';
import { Ticker, parsePair } from '../exchange/base.js';
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
      const msg = `MAX DAILY LOSS tercapai untuk "${bot.name}": rugi hari ini ${Math.round(realizedToday * mult).toLocaleString('id-ID')} ≥ batas ${Math.round(lossLimit * mult).toLocaleString('id-ID')} (${bot.max_daily_loss_pct}%). Bot di-pause otomatis.`;
      log('warn', 'ENGINE', msg, { bot_id: bot.id, user_id: bot.user_id });
      await notify(msg, bot.user_id).catch(() => {});
      return;
    }
  }

  const strategy = getStrategy(bot.strategy);
  const params = JSON.parse(bot.params || '{}');
  let state = JSON.parse(bot.state || '{}');
  // Ledger kas virtual per bot (eksak, bukan aproksimasi).
  initCashLedger(state, bot.current_budget);

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

  // Saldo aktual aset bot: baris base tak ada + baris quote ADA = benar-benar
  // nol (exchange hanya mengembalikan aset bersaldo). Quote tak ada = baca
  // gagal → null (jangan perlakukan sebagai nol).
  const baseActual = (): number | null => {
    try {
      const { base } = parsePair(bot.pair, client.quoteAsset);
      const find = (a: string) => balEntry.data.find((b: any) => String(b.asset).toUpperCase() === a.toUpperCase());
      if (!find(client.quoteAsset)) return null;
      const bal = find(base);
      return bal ? (Number(bal.free) || 0) + (Number(bal.locked) || 0) : 0;
    } catch {
      return null;
    }
  };

  // Pulihkan posisi yang hilang dari state padahal koin masih ada
  // (sinyal jual gagal tereksekusi di versi lama). Berlaku paper+live.
  try {
    await recoverPosition(bot, state, async () => baseActual());
  } catch { /* gagal baca → lewati, strategi jalan normal */ }

  // Auto-heal drift (live saja): catatan melebihi saldo exchange (partial fill
  // / jual manual) → selaraskan ke bawah + catat. Tak pernah menaikkan.
  if (bot.mode === 'live' && balEntry) {
    const healed = healDriftQty(state, () => baseActual());
    if (healed) {
      log('warn', 'ENGINE', `Drift ${bot.name} diselaraskan otomatis: catatan ${healed.recorded.toFixed(6)} → saldo ${healed.actual.toFixed(6)}`, { bot_id: bot.id, user_id: bot.user_id });
    }
  }

  // Budget efektif = sisa kas ledger (tak pernah melebihi modal acuan).
  // Setelah rugi, lot menyusut mengikuti kas yang benar-benar ada — bukan
  // terus memesan sebesar modal awal lalu diblokir guard (bot macet selamanya).
  const effBudget = Number.isFinite(state.cash)
    ? Math.min(bot.current_budget, Math.max(0, state.cash))
    : bot.current_budget;

  const minLot = (db.prepare('SELECT min_lot_idr FROM exchanges WHERE id=? AND user_id=?').get(bot.exchange_id, bot.user_id) as any)?.min_lot_idr ?? 10000;
  const ctx: StrategyContext = {
    bot: { ...bot, current_budget: effBudget }, ticker, quote: client.quoteAsset, minLot, usdtIdr, now: Date.now(),
    getKlines: (interval, limit) => client.getKlines(bot.pair, interval, limit),
    getBalances: async () => balEntry!.data,
    getPrice: async (pair: string) => (await getTickerCached(bot.exchange_id, pair, bot.user_id)).last
  };

  const actions = await strategy.onTick(ctx, state, params);

  // Eksekusi aksi; update state berdasarkan hasil fill
  let filled = 0;
  for (const action of actions) {
    const trade = await executeAction(bot, action, usdtIdr, state.cash);
    if (trade) {
      // Catat fill ke state strategi (untuk grid/dca/harvester entries)
      applyFillToState(bot.strategy, state, trade, action);
      await notifyTrade(trade, action, usdtIdr);
      filled++;
    }
  }
  // Tiap ada fill → titik equity baru agar kurva hidup (bukan 2 titik statis)
  if (filled > 0) {
    const { recordBotEquity } = await import('./equity.js');
    await recordBotEquity(bot.id);
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
/**
 * Inisialisasi malas ledger kas (untuk bot lama): kas = modal acuan -
 * modal yang sedang nyangkut di posisi terbuka. Setelah ini
 * equity = kas + nilai posisi (eksak).
 */
export function initCashLedger(state: any, currentBudget: number): void {
  if (Number.isFinite(state.cash)) return;
  const open: any[] = state.entries || state.filledBuys || (state.position ? [state.position] : []);
  const openCost = open.reduce((s: number, e: any) => s + (Number(e.cost) || 0), 0);
  state.cash = currentBudget - openCost;
}

/**
 * Selaraskan qty catatan ke saldo aktual (hanya mengecilkan).
 * Mengembalikan { recorded, actual } bila penyesuaian terjadi, else null.
 * Dipakai auto-heal scheduler (live) — baris aset tak ada (null) = lewati.
 */
export function healDriftQty(state: any, actualOf: (pair: string) => number | null): { recorded: number; actual: number } | null {
  try {
    const open: any[] = state.entries || state.filledBuys || (state.position ? [state.position] : []);
    const recorded = open.reduce((s: number, e: any) => s + (Number(e.qty) || 0), 0);
    if (!(recorded > 0)) return null;
    const actual = actualOf('');
    if (actual === null || !(actual >= 0)) return null;
    if (actual >= recorded * 0.9) return null; // dalam toleransi 10%
    const ratio = actual / recorded;
    for (const e of open) {
      e.qty = (Number(e.qty) || 0) * ratio;
      e.cost = (Number(e.cost) || 0) * ratio;
    }
    // Bersihkan sisa nol agar tak menumpuk jadi phantom abadi
    for (const key of ['entries', 'filledBuys'] as const) {
      if (Array.isArray((state as any)[key])) {
        (state as any)[key] = (state as any)[key].filter((e: any) => (Number(e.qty) || 0) > 0);
      }
    }
    if (state.position && !((Number(state.position.qty) || 0) > 0)) state.position = null;
    return { recorded, actual };
  } catch {
    return null;
  }
}

/**
 * Hanya perbarui ledger kas dari fill (tanpa menyentuh posisi/entries).
 * Dipakai alur khusus yang mengelola entries sendiri (mis. stop-likuidasi).
 */
export function applyCashFill(state: any, trade: any, action: any): void {
  const tValue = Number(trade?.value);
  const tFee = Number(trade?.fee) || 0;
  if (Number.isFinite(state.cash) && Number.isFinite(tValue)) {
    if (action.type === 'buy') state.cash -= tValue + tFee;
    else if (action.type === 'sell') state.cash += tValue - tFee;
  }
}

export function applyFillToState(strategyName: string, state: any, trade: any, action: any) {
  // Ledger kas: beli menguras kas sebesar nilai+fee, jual menambah kas sebesar nilai-fee.
  // Hanya bila ledger sudah diinisialisasi (angka tak valid = lewati, jangan racuni).
  applyCashFill(state, trade, action);
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
    return;
  }
  if (action.type !== 'sell') return;
  // SELL: state diubah HANYA di sini (fill terkonfirmasi). Strategi tidak
  // boleh menghapus posisi saat emit — bila eksekusi gagal (saldo kurang,
  // debu), sinyal diulang tick berikutnya, bukan hilang selamanya.
  const meta = action?.meta || {};
  if (strategyName === 'grid' || strategyName === 'dynamic') {
    if (Array.isArray(state.filledBuys) && state.filledBuys.length > 0) {
      let idx = -1;
      if (Number.isInteger(meta.level)) {
        idx = state.filledBuys.findIndex((e: any) => e.level === meta.level);
      }
      if (idx < 0) {
        // Fallback state lama tanpa level: fill dengan qty paling mirip
        let best = -1, bestDiff = Infinity;
        state.filledBuys.forEach((e: any, i: number) => {
          const d = Math.abs((Number(e.qty) || 0) - trade.qty);
          if (d < bestDiff) { bestDiff = d; best = i; }
        });
        if (best >= 0 && bestDiff <= Math.max(trade.qty * 0.05, 1e-9)) idx = best;
      }
      if (idx >= 0) {
        const fill = state.filledBuys[idx];
        const fillQty = Number(fill?.qty) || 0;
        if (fillQty > 0 && trade.qty < fillQty * 0.995) {
          // Jual parsial (trim selisih receh): kurangi fill proporsional,
          // level tetap terisi agar sisa debu tidak hilang dari radar.
          const keep = 1 - trade.qty / fillQty;
          fill.qty = fillQty - trade.qty;
          fill.cost = (Number(fill.cost) || 0) * keep;
        } else {
          const [gone] = state.filledBuys.splice(idx, 1);
          if (Number.isInteger(gone?.level) && Array.isArray(state.levelsHit)) {
            state.levelsHit = state.levelsHit.filter((l: any) => l !== gone.level);
          }
          // Siklus selesai → anchor mengikuti harga fill (re-center)
          if (state.filledBuys.length === 0 && Number(trade.price) > 0) {
            state.anchor = trade.price;
          }
        }
      }
    }
    return;
  }
  if (strategyName === 'dca' || strategyName === 'harvester') {
    if (Array.isArray(state.entries)) {
      if (meta.all === true) {
        state.entries = [];
        if (typeof state.lastEntryPrice === 'number') state.lastEntryPrice = 0;
        if (typeof state.lastBuyPrice === 'number') state.lastBuyPrice = 0;
        state.tier1Done = false;
      } else {
        // Parsial: porsi dihitung dari fill AKTUAL (tahan terhadap trim),
        // bukan dari rencana saat emit.
        const totalQty = state.entries.reduce((s: number, e: any) => s + (Number(e.qty) || 0), 0);
        const soldRatio = totalQty > 0 ? trade.qty / totalQty : 0;
        if (soldRatio > 0 && soldRatio < 0.995) {
          const keep = 1 - soldRatio;
          state.entries = state.entries.map((e: any) => ({ ...e, qty: e.qty * keep, cost: e.cost * keep }));
          if (meta.tier1) state.tier1Done = true;
        } else if (soldRatio >= 0.995) {
          state.entries = [];
          if (typeof state.lastEntryPrice === 'number') state.lastEntryPrice = 0;
          if (typeof state.lastBuyPrice === 'number') state.lastBuyPrice = 0;
          state.tier1Done = false;
        }
      }
    }
    return;
  }
  // Strategi posisi tunggal (scalper/revert/bollinger/breakout):
  // bersihkan HANYA saat fill terkonfirmasi.
  if ('position' in state) state.position = null;
}

/**
 * Pulihkan posisi yang hilang dari state padahal koinnya masih ada
 * (kasus: sinyal jual di-emit versi lama → eksekusi gagal → posisi hangus
 * dari state). Rekonstruksi dari buy terakhir di riwayat, dibatasi saldo
 * aktual. Mengembalikan true bila ada yang dipulihkan.
 */
export async function recoverPosition(bot: BotRow, state: any, getBaseFree: () => Promise<number | null>): Promise<boolean> {
  if (!('position' in state) || state.position != null) return false;
  try {
    // Jangan bangkitkan posisi yang SUDAH terjual: bila trade terakhir adalah
    // sell, state kosong itu benar (balance yang masih tampil hanya lag).
    const last = db.prepare(`SELECT side FROM trades WHERE bot_id=? ORDER BY id DESC LIMIT 1`).get(bot.id) as any;
    if (last && last.side === 'sell') return false;
    const free = await getBaseFree();
    if (!(free !== null && free > 0)) return false;
    const row = db.prepare(`SELECT price, qty, value FROM trades WHERE bot_id=? AND side='buy' ORDER BY id DESC LIMIT 1`).get(bot.id) as any;
    if (!row || !(row.price > 0) || !(row.qty > 0)) return false;
    const qty = Math.min(Number(row.qty), free);
    if (!(qty > 0)) return false;
    state.position = {
      entryPrice: row.price, qty,
      cost: (Number(row.value) || 0) * (qty / Number(row.qty)),
    };
    log('warn', 'ENGINE', `Posisi bot "${bot.name}" dipulihkan dari riwayat: ${qty} @ ${row.price} (koin masih ada, state kehilangan posisi)`, { bot_id: bot.id, user_id: bot.user_id });
    return true;
  } catch {
    return false;
  }
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
