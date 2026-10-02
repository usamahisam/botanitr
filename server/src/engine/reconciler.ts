import { db, queries, now, BotRow } from '../db/index.js';
import { registry } from '../exchange/registry.js';
import { parsePair } from '../exchange/base.js';
import { log } from '../log.js';
import { notify } from '../telegram/notify.js';

/**
 * Reconciler: bandingkan posisi yang dicatat state bot vs saldo aktual di exchange.
 * Jika drift (selisih qty) melebihi toleransi → peringatkan via log + Telegram.
 * Hanya berjalan untuk bot live (paper selalu konsisten dengan simulator).
 */

/** Ambil qty posisi yang dicatat state bot */
function botRecordedQty(bot: BotRow): number {
  try {
    const state = JSON.parse(bot.state || '{}');
    const entries: any[] = state.entries || state.filledBuys || (state.position ? [state.position] : []);
    return entries.reduce((s: number, e: any) => s + (e.qty || 0), 0);
  } catch {
    return 0;
  }
}

export interface DriftReport {
  bot_id: number; name: string; pair: string;
  recorded_qty: number; actual_qty: number; drift_pct: number;
}

export async function reconcileOnce(opts: { tolerancePct?: number; notifyOnDrift?: boolean } = {}): Promise<DriftReport[]> {
  const tolerance = opts.tolerancePct ?? 5; // toleransi drift 5%
  const drifts: DriftReport[] = [];
  const bots = (queries.allBots.all() as BotRow[]).filter(b => b.status !== 'stopped' && b.mode === 'live');

  for (const bot of bots) {
    const client = registry.get(bot.exchange_id);
    if (!client.hasCredentials()) continue;
    const recorded = botRecordedQty(bot);
    if (recorded <= 0) continue; // tidak ada posisi tercatat → tidak ada yang direkonsiliasi

    const { base } = parsePair(bot.pair, client.quoteAsset);
    try {
      const balances = await client.getBalances();
      const actual = balances.find(b => b.asset === base.toUpperCase());
      const actualQty = (actual?.free ?? 0) + (actual?.locked ?? 0);
      const driftPct = recorded > 0 ? Math.abs(actualQty - recorded) / recorded * 100 : 0;
      if (driftPct > tolerance) {
        drifts.push({ bot_id: bot.id, name: bot.name, pair: bot.pair, recorded_qty: recorded, actual_qty: actualQty, drift_pct: driftPct });
      }
    } catch { /* gagal ambil saldo → lewati */ }
  }

  if (drifts.length > 0 && opts.notifyOnDrift !== false) {
    const lines = ['⚠️ DRIFT POSISI TERDETEKSI (state bot ≠ saldo exchange):'];
    for (const d of drifts) {
      lines.push(`• ${d.name} (${d.pair}): tercatat ${d.recorded_qty.toFixed(6)}, aktual ${d.actual_qty.toFixed(6)} (drift ${d.drift_pct.toFixed(1)}%)`);
    }
    lines.push('Kemungkinan ada order manual/partial fill. Periksa & sesuaikan state bot.');
    const msg = lines.join('\n');
    log('warn', 'ENGINE', msg);
    await notify(msg).catch(() => {});
  }

  return drifts;
}

let timer: NodeJS.Timeout | null = null;
export function startReconciler(intervalMs = 10 * 60 * 1000) {
  // Jalankan tiap 10 menit, mulai 2 menit setelah boot
  timer = setInterval(() => reconcileOnce().catch(e => log('error', 'ERROR', `Reconciler gagal: ${e.message}`)), intervalMs);
  setTimeout(() => reconcileOnce().catch(() => {}), 120000);
  log('info', 'ENGINE', `Reconciler drift aktif (interval ${Math.round(intervalMs / 60000)} menit)`);
}
export function stopReconciler() { if (timer) clearInterval(timer); }
