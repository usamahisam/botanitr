import { db, queries, now, BotRow } from '../db/index.js';
import { registry } from '../exchange/registry.js';
import { parsePair } from '../exchange/base.js';
import { log } from '../log.js';
import { getUsdtIdr } from './balances.js';

/**
 * Equity curve per bot: catat equity harian (kas tersisa + nilai posisi + realized)
 * dalam quote currency. Dipakai untuk grafik performa di kartu bot.
 */

function todayWib(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Hitung equity bot saat ini (quote): current_budget - kas_terpakai + nilai posisi.
 *  Pendekatan: equity = realized_pnl + nilai posisi terbuka saat ini + kas yang
 *  dikelola bot. Karena bot tidak punya sub-akun terpisah, kita aproksimasi:
 *  equity ≈ current_budget (setelah compound) + floating PnL posisi terbuka. */
async function computeBotEquity(bot: BotRow): Promise<number> {
  const client = registry.get(bot.exchange_id);
  let floating = 0;
  try {
    const state = JSON.parse(bot.state || '{}');
    const entries: any[] = state.entries || state.filledBuys || (state.position ? [state.position] : []);
    const qty = entries.reduce((s: number, e: any) => s + (e.qty || 0), 0);
    const cost = entries.reduce((s: number, e: any) => s + (e.cost || 0), 0);
    if (qty > 0) {
      const ticker = await client.getTicker(bot.pair);
      floating = qty * ticker.last - cost; // floating PnL posisi
    }
  } catch { /* abaikan, floating=0 */ }
  return bot.current_budget + floating;
}

/** Rekam equity hari ini untuk semua bot aktif (upsert per tanggal) */
export async function recordDailyEquity(): Promise<number> {
  const bots = (queries.allBots.all() as BotRow[]).filter(b => b.status !== 'stopped');
  const date = todayWib();
  const ts = now();
  const ins = db.prepare(`INSERT INTO bot_equity (bot_id, date, equity_quote, recorded_at)
    VALUES (?,?,?,?) ON CONFLICT(bot_id, date) DO UPDATE SET equity_quote=excluded.equity_quote, recorded_at=excluded.recorded_at`);
  let n = 0;
  for (const bot of bots) {
    try {
      const equity = await computeBotEquity(bot);
      ins.run(bot.id, date, equity, ts);
      n++;
    } catch { /* lewati bot gagal */ }
  }
  return n;
}

let timer: NodeJS.Timeout | null = null;
/** Rekam equity berkala: tiap 6 jam + sekali saat boot (untuk data awal) */
export function startEquityRecorder() {
  const run = () => recordDailyEquity().catch(e => log('error', 'ERROR', `Rekam equity gagal: ${e.message}`));
  setTimeout(run, 30000); // 30 detik setelah boot
  timer = setInterval(run, 6 * 3600 * 1000);
}
export function stopEquityRecorder() { if (timer) clearInterval(timer); }

/** Data equity untuk grafik: gabungkan titik budget awal + equity harian */
export function getEquityCurve(botId: number, days = 30): { date: string; equity: number }[] {
  const bot = queries.getBot.get(botId) as BotRow | undefined;
  if (!bot) return [];
  const rows = db.prepare(`SELECT date, equity_quote FROM bot_equity WHERE bot_id=? ORDER BY date DESC LIMIT ?`)
    .all(botId, days) as any[];
  const curve = rows.reverse().map(r => ({ date: r.date, equity: r.equity_quote }));
  // Titik awal = budget awal saat bot dibuat
  const startDate = bot.created_at.slice(0, 10);
  if (curve.length === 0 || curve[0].date > startDate) {
    curve.unshift({ date: startDate, equity: bot.budget_idr });
  }
  return curve;
}
