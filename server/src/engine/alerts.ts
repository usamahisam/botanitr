import { db, now } from '../db/index.js';
import { registry } from '../exchange/registry.js';
import { log } from '../log.js';
import { notify } from '../telegram/notify.js';
import { getUsdtIdr } from './balances.js';
import { fmtIDR } from '../utils/format.js';

/**
 * Price Alert: notifikasi Telegram saat harga menyentuh target (above/below).
 * Cek berkala tiap 20 detik; alert nonaktif setelah terpicu (one-shot).
 */

export interface AlertRow {
  id: number; user_id: number; exchange_id: string; pair: string; direction: 'above' | 'below';
  target_price: number; note: string | null; active: number; triggered_at: string | null; created_at: string;
}

async function checkAlerts(): Promise<number> {
  const alerts = db.prepare('SELECT * FROM price_alerts WHERE active=1').all() as AlertRow[];
  if (alerts.length === 0) return 0;
  let triggered = 0;

  for (const a of alerts) {
    try {
      const client = registry.getForUser(a.exchange_id, a.user_id);
      const ticker = await client.getTicker(a.pair);
      const hit = a.direction === 'above' ? ticker.last >= a.target_price : ticker.last <= a.target_price;
      if (hit) {
        const mult = client.quoteAsset === 'IDR' ? 1 : await getUsdtIdr();
        const arrow = a.direction === 'above' ? 'naik ke' : 'turun ke';
        const msg = `PRICE ALERT: ${a.pair} ${arrow} target\nHarga sekarang: ${fmtIDR(ticker.last * mult)}\nTarget: ${fmtIDR(a.target_price * mult)}${a.note ? `\nCatatan: ${a.note}` : ''}`;
        db.prepare('UPDATE price_alerts SET active=0, triggered_at=? WHERE id=?').run(now(), a.id);
        log('info', 'SYSTEM', msg, { user_id: a.user_id });
        await notify(msg, a.user_id).catch(() => {});
        triggered++;
      }
    } catch { /* lewati alert gagal */ }
  }
  return triggered;
}

let timer: NodeJS.Timeout | null = null;
export function startAlertEngine(intervalMs = 20000) {
  timer = setInterval(() => checkAlerts().catch(e => log('error', 'ERROR', `Cek alert gagal: ${e.message}`)), intervalMs);
  setTimeout(() => checkAlerts().catch(() => {}), 15000);
  const n = (db.prepare('SELECT COUNT(*) c FROM price_alerts WHERE active=1').get() as any).c;
  if (n > 0) log('info', 'ENGINE', `Price alert engine aktif (${n} alert aktif)`);
}
export function stopAlertEngine() { if (timer) clearInterval(timer); }

// Untuk test langsung
export { checkAlerts };
