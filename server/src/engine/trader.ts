import { db, queries, now, BotRow, TradeRow } from '../db/index.js';
import { registry } from '../exchange/registry.js';
import { parsePair } from '../exchange/base.js';
import { log } from '../log.js';
import { notify } from '../telegram/notify.js';
import { Action } from '../strategies/types.js';
import { fmtIDR, fmtQty } from '../utils/format.js';
import { compound } from './compound.js';

let tradeCounter = 0;

/**
 * Throttle log skip berulang: kondisi persisten (kas kurang/lot kecil) bisa
 * terpicu tiap tick (~450 baris/jam ke DB). Batasi 1 log per 15 menit per
 * (bot, jenis-sebab); eksekusi skip-nya sendiri tetap jalan tiap tick.
 */
const lastSkipLog = new Map<string, number>();
const SKIP_LOG_MS = 15 * 60 * 1000;
function logSkipOnce(botId: number, kind: string, level: 'info' | 'warn', tag: any, message: string, opts: any): boolean {
  const key = `${botId}:${kind}`;
  const last = lastSkipLog.get(key) || 0;
  if (Date.now() - last < SKIP_LOG_MS) return false;
  lastSkipLog.set(key, Date.now());
  log(level, tag, message, opts);
  // Bersihkan entri basi sesekali
  if (lastSkipLog.size > 1000) {
    const cutoff = Date.now() - SKIP_LOG_MS;
    for (const [k, t] of lastSkipLog) if (t < cutoff) lastSkipLog.delete(k);
  }
  return true;
}

/**
 * Pre-flight balance guard: pastikan saldo cukup SEBELUM order dikirim.
 * Mengembalikan null bila aman, atau pesan error yang jelas bila tidak.
 * Fail-open: bila saldo gagal dibaca, biarkan order jalan (exchange yang menolak bila kurang).
 */
export async function checkBalance(bot: BotRow, action: Action, paper: boolean, usdtIdr: number): Promise<string | null> {
  const client = registry.getForUser(bot.exchange_id, bot.user_id);
  const quote = client.quoteAsset;
  const { base } = parsePair(bot.pair, quote);
  let balances;
  try {
    balances = paper
      ? registry.getPaperForUser(bot.exchange_id, bot.user_id).getBalances()
      : await client.getBalances();
  } catch {
    return null; // tidak bisa baca saldo → biarkan exchange yang memutuskan
  }
  const free = (asset: string) => balances.find(b => b.asset === asset.toUpperCase())?.free ?? 0;
  if (action.type === 'buy') {
    const amount = action.amountQuote ?? 0;
    const freeQuote = free(quote);
    if (amount > freeQuote) {
      return `Kas ${quote} tidak cukup untuk buy ${bot.pair}: butuh ${fmtIDR(amount * usdtIdr)}, tersedia ${fmtIDR(freeQuote * usdtIdr)}`;
    }
  } else {
    const qty = action.qtyBase ?? 0;
    const freeBase = free(base);
    if (qty > freeBase + 1e-12) {
      return `Saldo ${base} tidak cukup untuk sell ${bot.pair}: butuh ${fmtQty(qty)}, tersedia ${fmtQty(freeBase)}`;
    }
  }
  return null;
}

/**
 * Guard ledger kas bot: satu akun dipakai ramai-ramai, jadi saldo akun SAJA
 * tidak cukup — tiap bot hanya boleh belanja dari kas ledgernya sendiri
 * (state.cash yang dirawat scheduler). Mencegah double-spend antar bot.
 * Toleransi 0,5%: fee tiap fill menggerus kas sedikit di bawah lot terencana
 * (yang dihitung dari budget) — tanpa toleransi, buy terakhir level grid
 * bisa terblokir selamanya oleh selisih receh fee. Double-spend sungguhan
 * selalu berskala besar, jadi toleransi ini aman.
 * Mengembalikan null bila aman / tak diketahui, atau pesan penolakan.
 */
export function checkLedgerCash(cash: number | undefined | null, amountQuote: number, tolerancePct = 0.5): string | null {
  if (!Number.isFinite(cash)) return null; // ledger belum init → lewati (fail-open)
  if (amountQuote > (cash as number) * (1 + tolerancePct / 100)) {
    return `Kas ledger bot tidak cukup: butuh ${amountQuote}, kas bot ${cash} (kas akun dipakai bersama bot lain)`;
  }
  return null;
}

/**
 * Eksekusi Action dari strategi → order (paper/live) → catat trade → compound.
 * Idempoten via client_order_id.
 */
export async function executeAction(bot: BotRow, action: Action, usdtIdr: number, botCash?: number): Promise<TradeRow | null> {
  const cycle = `${Date.now()}-${tradeCounter++}`;
  // client_order_id: maks 36 char, alfanumerik _- (aturan Indodax)
  const clientOrderId = `bot${bot.id}-${action.type}${cycle}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 36);

  // Idempotensi lokal (double-tick dalam satu proses)
  if (queries.tradeByClientId.get(clientOrderId)) return null;

  const client = registry.getForUser(bot.exchange_id, bot.user_id);
  const paper = bot.mode === 'paper';
  const trader = paper ? registry.getPaperForUser(bot.exchange_id, bot.user_id) : client;

  const minLot = (db.prepare('SELECT * FROM exchanges WHERE id=? AND user_id=?').get(bot.exchange_id, bot.user_id) as any)?.min_lot_idr ?? 10000;

  try {
    let result: { order_id: string; price: number; qty: number; fee: number; side: 'buy' | 'sell' };
    let value = 0;

    // Pre-flight: lot minimum + kecukupan saldo (skip bersih tanpa error_count)
    if (action.type === 'buy' && (action.amountQuote ?? 0) < minLot) {
      logSkipOnce(bot.id, 'minlot', 'warn', 'TRADE', `Order buy ${fmtIDR((action.amountQuote ?? 0) * usdtIdr)} < lot minimum ${fmtIDR(minLot * usdtIdr)}, dilewati`, { bot_id: bot.id, user_id: bot.user_id });
      return null;
    }
    const balErr = await checkBalance(bot, action, paper, usdtIdr);
    if (balErr) {
      const logged = logSkipOnce(bot.id, 'balance', 'warn', 'TRADE', `${balErr} — order dilewati`, { bot_id: bot.id, user_id: bot.user_id });
      if (logged && !paper) await notify(`⚠️ Order ${bot.name} dilewati:\n${balErr}`, bot.user_id).catch(() => {});
      return null;
    }
    // Guard ledger: jangan belanja melebihi kas milik bot ini (anti double-spend)
    if (action.type === 'buy') {
      const ledgerErr = checkLedgerCash(botCash, action.amountQuote ?? 0);
      if (ledgerErr) {
        logSkipOnce(bot.id, 'ledger', 'warn', 'TRADE', `${ledgerErr} — order dilewati`, { bot_id: bot.id, user_id: bot.user_id });
        return null;
      }
    }

    if (action.type === 'buy') {
      const amount = action.amountQuote ?? 0;
      result = await trader.buyMarket(bot.pair, amount, clientOrderId);
      // Koersi defensif: client harusnya mengembalikan number, tapi jangan percaya buta
      result = { ...result, price: Number(result.price), qty: Number(result.qty), fee: Number(result.fee) || 0 };
      value = result.qty * result.price;
      if (!Number.isFinite(value) || !Number.isFinite(result.qty) || !Number.isFinite(result.price) || result.qty <= 0) {
        logSkipOnce(bot.id, 'badfill', 'warn', 'TRADE', `Hasil buy ${bot.pair} tak valid dari exchange, dilewati`, { bot_id: bot.id, user_id: bot.user_id });
        return null;
      }
    } else {
      const qty = action.qtyBase ?? 0;
      if (qty <= 0) return null;
      result = await trader.sellMarket(bot.pair, qty, clientOrderId);
      result = { ...result, price: Number(result.price), qty: Number(result.qty), fee: Number(result.fee) || 0 };
      value = result.qty * result.price;
      // Validasi hasil fill: nilai korup/NaN atau debu jauh di bawah lot minimum
      // dilewati bersih (bukan error) agar sisa fraksional tak memicu error-loop.
      if (!Number.isFinite(value) || !Number.isFinite(result.qty) || !Number.isFinite(result.price)) {
        logSkipOnce(bot.id, 'badfill', 'warn', 'TRADE', `Hasil sell ${bot.pair} tak valid dari exchange, dilewati`, { bot_id: bot.id, user_id: bot.user_id });
        return null;
      }
      if (value < minLot * 0.2) {
        logSkipOnce(bot.id, 'dust', 'warn', 'TRADE', `Hasil sell ${bot.pair} terlalu kecil/debu (${fmtIDR(value * usdtIdr)}), dilewati`, { bot_id: bot.id, user_id: bot.user_id });
        return null;
      }
    }

    const realized = action.type === 'sell' ? value - result.fee - (action.costBasis ?? 0) : 0;
    const row: Omit<TradeRow, 'id'> = {
      user_id: bot.user_id, bot_id: bot.id, exchange_id: bot.exchange_id, pair: bot.pair,
      side: action.type, price: result.price, qty: result.qty, fee: result.fee,
      value, realized_pnl: realized, cost_basis: action.costBasis ?? 0,
      mode: bot.mode, order_id: result.order_id, client_order_id: clientOrderId,
      strategy_tag: action.tag, note: action.reason, created_at: now()
    };
    const info = queries.insertTrade.run(row);
    const trade: TradeRow = { id: Number(info.lastInsertRowid), ...row };

    const modeBadge = paper ? '📄' : '💰';
    const sideLabel = action.type === 'buy' ? 'BELI' : 'JUAL';
    log('info', (action.tag as any) || 'TRADE',
      `${modeBadge} ${sideLabel} ${bot.pair} ${result.qty.toFixed(8)} @ ${Math.round(result.price)} — ${action.reason}`,
      { bot_id: bot.id, impact_rp: action.impactRp ?? (realized * usdtIdr || undefined), user_id: bot.user_id });

    // Auto-compound setelah profit
    if (realized > 0) {
      compound.maybeCompound(bot, realized, usdtIdr);
    }

    return trade;
  } catch (e: any) {
    log('error', 'ERROR', `Eksekusi ${action.type} ${bot.pair} gagal: ${e.message}`, { bot_id: bot.id, user_id: bot.user_id });
    throw e;
  }
}
