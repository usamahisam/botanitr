import { db, queries, now, BotRow } from '../db/index.js';
import { registry } from '../exchange/registry.js';
import { log } from '../log.js';

/**
 * Equity curve per bot: kas tersisa + nilai posisi + realized, dalam quote.
 * Resolusi PER JAM (slot WIB 'YYYY-MM-DDTHH'): direkam tiap 30 menit (upsert
 * per slot) + sekali setiap ada trade tereksekusi. Kurva harian lama (satu
 * titik per hari) adalah penyebab grafik bot baru hanya 2 titik.
 *
 * Kolom `date` dipakai ulang untuk slot jam — string ISO sehingga urutan
 * leksikografis = kronologis, dan baris harian lama tetap valid & terurut.
 * Retensi 45 hari (selaras price_history).
 */

const RETENTION_MS = 45 * 24 * 3600 * 1000;

/** Slot jam WIB saat ini: 'YYYY-MM-DDTHH' */
export function hourSlotWib(at = Date.now()): string {
  return new Date(at + 7 * 3600 * 1000).toISOString().slice(0, 13);
}

function todayWib(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Hitung equity bot saat ini (quote): current_budget + floating PnL posisi.
 *  Karena bot tidak punya sub-akun terpisah, aproksimasi ini yang terbaik
 *  tanpa ledger transfer per bot. */
async function computeBotEquity(bot: BotRow): Promise<number> {
  let floating = 0;
  try {
    const state = JSON.parse(bot.state || '{}');
    const entries: any[] = state.entries || state.filledBuys || (state.position ? [state.position] : []);
    const qty = entries.reduce((s: number, e: any) => s + (Number(e.qty) || 0), 0);
    const cost = entries.reduce((s: number, e: any) => s + (Number(e.cost) || 0), 0);
    if (qty > 0) {
      const ticker = await registry.getForUser(bot.exchange_id, bot.user_id).getTicker(bot.pair);
      floating = qty * ticker.last - cost; // floating PnL posisi
    }
  } catch { /* abaikan, floating=0 */ }
  return bot.current_budget + floating;
}

/** Rekam satu titik equity bot pada slot jam tertentu (upsert). */
export function recordEquityPoint(botId: number, equity: number, slot?: string): void {
  const s = slot || hourSlotWib();
  db.prepare(`INSERT INTO bot_equity (bot_id, date, equity_quote, recorded_at)
    VALUES (?,?,?,?) ON CONFLICT(bot_id, date) DO UPDATE SET equity_quote=excluded.equity_quote, recorded_at=excluded.recorded_at`)
    .run(botId, s, equity, now());
}

/** Rekam equity semua bot aktif pada slot jam ini + prune retensi */
export async function recordDailyEquity(): Promise<number> {
  const bots = (db.prepare(`SELECT * FROM bots WHERE status != 'stopped'`).all() as BotRow[]);
  const slot = hourSlotWib();
  let n = 0;
  for (const bot of bots) {
    try {
      recordEquityPoint(bot.id, await computeBotEquity(bot), slot);
      n++;
    } catch { /* lewati bot gagal */ }
  }
  try {
    const cutoff = hourSlotWib(Date.now() - RETENTION_MS);
    db.prepare(`DELETE FROM bot_equity WHERE date < ?`).run(cutoff);
  } catch { /* abaikan */ }
  return n;
}

/** Rekam equity satu bot — dipanggil scheduler setiap ada trade tereksekusi. */
export async function recordBotEquity(botId: number): Promise<void> {
  try {
    const bot = queries.getBot.get(botId) as BotRow | undefined;
    if (!bot) return;
    recordEquityPoint(bot.id, await computeBotEquity(bot));
  } catch (e: any) {
    log('warn', 'ENGINE', `Rekam equity bot #${botId} gagal: ${e.message}`);
  }
}

let timer: NodeJS.Timeout | null = null;
/** Rekam equity berkala: tiap 30 menit + sekali saat boot (untuk data awal) */
export function startEquityRecorder() {
  const run = () => recordDailyEquity().catch(e => log('error', 'ERROR', `Rekam equity gagal: ${e.message}`));
  setTimeout(run, 30000); // 30 detik setelah boot
  timer = setInterval(run, 30 * 60 * 1000);
}
export function stopEquityRecorder() { if (timer) clearInterval(timer); }

/**
 * Data equity untuk grafik: titik budget awal + titik per jam + titik live.
 * Grafik memakai indeks sumbu-x, jadi label campuran tanggal/slot tak masalah.
 */
export async function getEquityCurve(botId: number, days = 30): Promise<{ date: string; equity: number }[]> {
  const bot = queries.getBot.get(botId) as BotRow | undefined;
  if (!bot) return [];
  const rows = db.prepare(`SELECT date, equity_quote FROM bot_equity WHERE bot_id=? ORDER BY date DESC LIMIT ?`)
    .all(botId, Math.min(days * 24 + 5, 1100)) as any[];
  const curve = rows.reverse().map(r => ({ date: r.date, equity: r.equity_quote }));
  // Titik awal = budget awal saat bot dibuat
  const startDate = bot.created_at.slice(0, 10);
  if (curve.length === 0 || curve[0].date > startDate) {
    curve.unshift({ date: startDate, equity: bot.budget_idr });
  }
  // Titik live: equity saat ini (budget + floating posisi terbuka)
  try {
    const live = await computeBotEquity(bot);
    const last = curve[curve.length - 1];
    if (last && (last.date === todayWib() || last.date.startsWith(todayWib()))) {
      last.equity = live; // segarkan titik hari ini dengan nilai live
    } else {
      curve.push({ date: hourSlotWib(), equity: live });
    }
  } catch { /* abaikan — kurva historis tetap dikembalikan */ }
  // Jamin minimal 2 titik (mis. bot baru dibuat hari ini) agar grafik tampil.
  if (curve.length === 1) {
    curve.unshift({ date: startDate, equity: bot.budget_idr });
  }
  return curve;
}
