import { db, now } from '../db/index.js';
import { registry } from '../exchange/registry.js';
import { log } from '../log.js';
import { notify } from '../telegram/notify.js';

export interface KillSwitchResult {
  bots_paused: number;
  orders_cancelled: Record<string, number>;
  errors: string[];
}

/**
 * KILL SWITCH GLOBAL:
 * 1. Pause semua bot yang sedang running (stop order baru)
 * 2. Batalkan semua open order live di semua exchange
 * 3. Log + notifikasi Telegram
 *
 * Dipakai saat pasar crash / ada anomali. Mode paper tidak punya open order riil.
 */
export async function activateKillSwitch(triggeredBy: string): Promise<KillSwitchResult> {
  const result: KillSwitchResult = { bots_paused: 0, orders_cancelled: {}, errors: [] };

  // 1. Pause semua bot running
  const info = db.prepare(`UPDATE bots SET status='paused', updated_at=? WHERE status='running'`).run(now());
  result.bots_paused = info.changes;

  // 2. Batalkan open order live
  for (const client of registry.list()) {
    if (!client.hasCredentials()) continue;
    try {
      const n = await client.cancelOpenOrders();
      result.orders_cancelled[client.id] = n;
    } catch (e: any) {
      result.errors.push(`${client.id}: ${e.message}`);
      result.orders_cancelled[client.id] = 0;
    }
  }

  const totalCancelled = Object.values(result.orders_cancelled).reduce((s, n) => s + n, 0);
  const msg = `🚨 KILL SWITCH AKTIF (${triggeredBy}) — ${result.bots_paused} bot di-pause, ${totalCancelled} open order dibatalkan${result.errors.length ? `. Error: ${result.errors.join('; ')}` : ''}`;

  log('warn', 'SYSTEM', msg);
  await notify(msg).catch(() => {});

  return result;
}
