import { db, now } from '../db/index.js';
import { registry, KNOWN_EXCHANGES } from '../exchange/registry.js';
import { log } from '../log.js';
import { notify } from '../telegram/notify.js';

export interface KillSwitchResult {
  bots_paused: number;
  orders_cancelled: Record<string, number>;
  errors: string[];
}

/**
 * KILL SWITCH per-user:
 * 1. Pause semua bot running milik user (stop order baru)
 * 2. Batalkan semua open order live di exchange milik user
 * 3. Log + notifikasi Telegram ke user tersebut
 */
export async function activateKillSwitch(triggeredBy: string, userId: number): Promise<KillSwitchResult> {
  const result: KillSwitchResult = { bots_paused: 0, orders_cancelled: {}, errors: [] };

  // 1. Pause semua bot running milik user
  const info = db.prepare(`UPDATE bots SET status='paused', updated_at=? WHERE status='running' AND user_id=?`).run(now(), userId);
  result.bots_paused = info.changes;

  // 2. Batalkan open order live (client milik user)
  for (const id of KNOWN_EXCHANGES) {
    try {
      const client = registry.getForUser(id, userId);
      if (!client.hasCredentials()) continue;
      const n = await client.cancelOpenOrders();
      result.orders_cancelled[id] = n;
    } catch (e: any) {
      result.errors.push(`${id}: ${e.message}`);
      result.orders_cancelled[id] = 0;
    }
  }

  const totalCancelled = Object.values(result.orders_cancelled).reduce((s, n) => s + n, 0);
  const msg = `KILL SWITCH AKTIF (${triggeredBy}) — ${result.bots_paused} bot di-pause, ${totalCancelled} open order dibatalkan${result.errors.length ? `. Error: ${result.errors.join('; ')}` : ''}`;

  log('warn', 'SYSTEM', msg, { user_id: userId });
  await notify(msg, userId).catch(() => {});

  return result;
}
