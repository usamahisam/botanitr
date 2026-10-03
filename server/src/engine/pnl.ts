import { db } from '../db/index.js';

/** Awal hari ini (WIB) dalam ISO UTC */
function todayStartUtcIso(): string {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 3600 * 1000);
  const startUtc = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate())).getTime() - 7 * 3600 * 1000;
  return new Date(startUtc).toISOString();
}

/**
 * Perhitungan PnL & statistik untuk dashboard (terisolasi per user).
 * Semua dalam quote currency masing-masing; konversi IDR dilakukan pemanggil via usdtIdr.
 */
export const pnl = {
  /** Realized PnL total per exchange + mode */
  realized(exchangeId?: string, mode?: string, userId = 0): number {
    let sql = 'SELECT COALESCE(SUM(realized_pnl),0) s FROM trades WHERE user_id=?';
    const args: any[] = [userId];
    if (exchangeId) { sql += ' AND exchange_id=?'; args.push(exchangeId); }
    if (mode) { sql += ' AND mode=?'; args.push(mode); }
    return (db.prepare(sql).get(...args) as any).s;
  },

  /** Win rate dari siklus sell dengan realized_pnl != 0 */
  winRate(exchangeId?: string, userId = 0): { wins: number; total: number; rate: number } {
    let sql = `SELECT COUNT(*) total, SUM(CASE WHEN realized_pnl>0 THEN 1 ELSE 0 END) wins
               FROM trades WHERE side='sell' AND realized_pnl != 0 AND user_id=?`;
    const args: any[] = [userId];
    if (exchangeId) { sql += ' AND exchange_id=?'; args.push(exchangeId); }
    const row = db.prepare(sql).get(...args) as any;
    const total = row.total || 0;
    const wins = row.wins || 0;
    return { wins, total, rate: total > 0 ? wins / total : 0 };
  },

  /** Realized PnL hari ini (WIB) */
  realizedToday(exchangeId?: string, userId = 0): number {
    let sql = `SELECT COALESCE(SUM(realized_pnl),0) s FROM trades WHERE user_id=? AND created_at >= ?`;
    const args: any[] = [userId, todayStartUtcIso()];
    if (exchangeId) { sql += ' AND exchange_id=?'; args.push(exchangeId); }
    return (db.prepare(sql).get(...args) as any).s;
  },

  /** Realized PnL hari ini per bot (untuk max daily loss guard) */
  botRealizedToday(botId: number): number {
    return (db.prepare(`SELECT COALESCE(SUM(realized_pnl),0) s FROM trades WHERE bot_id=? AND created_at >= ?`)
      .get(botId, todayStartUtcIso()) as any).s;
  },

  /** Statistik per bot */
  botStats(botId: number): { realized: number; wins: number; total: number; trades: number } {
    const r = db.prepare(`SELECT COALESCE(SUM(realized_pnl),0) s, COUNT(*) c FROM trades WHERE bot_id=?`).get(botId) as any;
    const w = db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN realized_pnl>0 THEN 1 ELSE 0 END) wins
                          FROM trades WHERE bot_id=? AND side='sell' AND realized_pnl != 0`).get(botId) as any;
    return { realized: r.s, trades: r.c, wins: w.wins || 0, total: w.total || 0 };
  },

  /** Data tren profit harian per bot (7 hari, untuk sparkline) */
  botTrend(botId: number, days = 7): { date: string; pnl: number }[] {
    const rows = db.prepare(`
      SELECT substr(created_at, 1, 10) d, COALESCE(SUM(realized_pnl),0) p
      FROM trades WHERE bot_id=? AND created_at >= datetime('now', ?)
      GROUP BY d ORDER BY d`).all(botId, `-${days} days`) as any[];
    return rows.map(r => ({ date: r.d, pnl: r.p }));
  }
};
