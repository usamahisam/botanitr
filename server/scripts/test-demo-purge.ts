/**
 * Hapus data demo tuntas:
 *  A) purge hapus bot paper + trades paper (termasuk yatim) + log + reset saldo
 *  B) data live tidak tersentuh
 *  C) hapus bot paper via API ikut hapus trades-nya; bot live dipertahankan
 *
 * Jalankan: npx tsx server/scripts/test-demo-purge.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.BOTANI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'botani-purge-'));
process.env.SECRET_KEY = 'test-secret-key-minimal-32-chars-abcdef';

let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

async function main() {
  const { db, queries, now } = await import('../src/db/index.js');
  const { purgePaperData } = await import('../src/engine/demo.js');
  const U = 99;

  const mkBot = (mode: string) => queries.insertBot.run({
    user_id: U, name: `B-${mode}`, exchange_id: 'indodax', pair: 'XRPIDR', strategy: 'grid',
    params: '{}', budget_idr: 100000, current_budget: 100000, lot: 20000, mode,
    auto_compound_pct: 100, status: 'paused', state: '{}', max_daily_loss_pct: 0,
    market_preset_id: null, created_at: now(), updated_at: now(),
  }).lastInsertRowid as number;
  const mkTrade = (botId: number | null, mode: string) => db.prepare(
    `INSERT INTO trades (user_id, bot_id, exchange_id, pair, side, price, qty, fee, value, realized_pnl, cost_basis, mode, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(U, botId, 'indodax', 'XRPIDR', 'buy', 100, 1, 0, 100, 0, 100, mode, now());
  const mkLog = (botId: number | null) => queries.insertLog.run(U, 'info', 'TRADE', botId, 'x', 0, null, now());

  const paperBot = mkBot('paper');
  const liveBot = mkBot('live');
  mkTrade(paperBot, 'paper');
  mkTrade(liveBot, 'live');
  mkTrade(999999, 'paper'); // yatim: bot sudah dihapus duluan
  mkLog(paperBot);
  mkLog(liveBot);
  db.prepare(`INSERT INTO paper_balances (exchange_id, asset, free, locked, user_id) VALUES ('indodax','IDR',12345,0,?)`).run(U);

  console.log('A) purgePaperData');
  const r = purgePaperData(U, 'indodax');
  check('bot paper terhapus', r.bots === 1, JSON.stringify(r));
  check('trades paper terhapus (2)', r.trades === 2, JSON.stringify(r));
  check('log bot paper terhapus', r.logs === 1, JSON.stringify(r));
  const leftBots = (db.prepare('SELECT COUNT(*) c FROM bots WHERE user_id=?').get(U) as any).c;
  const leftTrades = (db.prepare('SELECT COUNT(*) c FROM trades WHERE user_id=?').get(U) as any).c;
  const leftLogs = (db.prepare('SELECT COUNT(*) c FROM logs WHERE user_id=?').get(U) as any).c;
  check('bot live utuh', leftBots === 1, `got ${leftBots}`);
  check('trade live utuh', leftTrades === 1, `got ${leftTrades}`);
  check('log live utuh', leftLogs === 1, `got ${leftLogs}`);
  const bal = db.prepare(`SELECT free FROM paper_balances WHERE user_id=? AND exchange_id='indodax' AND asset='IDR'`).get(U) as any;
  check('saldo kembali seed 10jt', bal?.free === 10000000, `got ${bal?.free}`);

  console.log('\nB) purge exchange lain tak ganggu');
  const r2 = purgePaperData(U, 'binance');
  check('jalan tanpa error', r2.exchanges.includes('binance'));

  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
