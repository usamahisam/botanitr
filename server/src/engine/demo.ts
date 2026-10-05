import { db } from '../db/index.js';
import { registry, KNOWN_EXCHANGES } from '../exchange/registry.js';
import { paperSeed } from '../exchange/paper.js';

export interface PurgeResult {
  bots: number; trades: number; logs: number; snapshots: number; exchanges: string[];
}

/**
 * Hapus TUNTAS seluruh data demo milik user: bot paper, riwayat transaksi
 * paper (termasuk yang yatim karena botnya sudah dihapus duluan), log milik
 * bot paper, snapshot saldo — lalu kembalikan saldo demo ke seed awal.
 * Data RIIL (live) tidak pernah disentuh.
 */
export function purgePaperData(userId: number, exchangeId?: string): PurgeResult {
  const ids = exchangeId ? [exchangeId] : [...KNOWN_EXCHANGES];
  const out: PurgeResult = { bots: 0, trades: 0, logs: 0, snapshots: 0, exchanges: [] };
  for (const id of ids) {
    const botIds = (db.prepare('SELECT id FROM bots WHERE user_id=? AND mode=? AND exchange_id=?')
      .all(userId, 'paper', id) as any[]).map(r => r.id);
    if (botIds.length > 0) {
      const ph = botIds.map(() => '?').join(',');
      out.logs += Number(db.prepare(`DELETE FROM logs WHERE user_id=? AND bot_id IN (${ph})`).run(userId, ...botIds).changes || 0);
      out.bots += Number(db.prepare(`DELETE FROM bots WHERE user_id=? AND mode='paper' AND exchange_id=?`).run(userId, id).changes || 0);
    }
    out.trades += Number(db.prepare(`DELETE FROM trades WHERE user_id=? AND mode='paper' AND exchange_id=?`).run(userId, id).changes || 0);
    out.snapshots += Number(db.prepare(`DELETE FROM balance_snapshots WHERE user_id=? AND exchange_id=?`).run(userId, id).changes || 0);
    try {
      const quote = registry.getForUser(id, userId).quoteAsset;
      db.prepare('DELETE FROM paper_balances WHERE user_id=? AND exchange_id=?').run(userId, id);
      db.prepare(`INSERT INTO paper_balances (exchange_id, asset, free, locked, user_id) VALUES (?,?,?,0,?)`)
        .run(id, quote, paperSeed(quote, userId), userId);
      out.exchanges.push(id);
    } catch { /* exchange tak dikenal → lewati */ }
  }
  return out;
}
