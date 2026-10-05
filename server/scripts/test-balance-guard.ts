/**
 * E2E guard saldo + faucet demo:
 *  A) Guard menolak buy paper saat kas kurang (skip bersih, tanpa exception)
 *  B) Guard menolak sell paper saat aset kurang
 *  C) Guard lolos + trade tereksekusi saat saldo cukup
 *  D) Faucet reset mengembalikan seed (default & kustom via settings)
 *  E) checkBalancesHealth menandai shortfall per bot
 *
 * Jalankan: npx tsx server/scripts/test-balance-guard.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.BOTANI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'botani-bal-'));

let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

const TICKER = { pair: 'XRPIDR', bid: 26499, ask: 26501, last: 26500, high24: 27000, low24: 26000, vol24: 0, ts: Date.now() };

async function main() {
  const { db, queries, settings, now } = await import('../src/db/index.js');
  const { registry } = await import('../src/exchange/registry.js');
  const { executeAction } = await import('../src/engine/trader.js');
  const { checkBalancesHealth } = await import('../src/engine/balances.js');
  const { paperSeed } = await import('../src/exchange/paper.js');

  // Stub ticker agar hermetik (tanpa jaringan)
  const client = registry.getForUser('indodax', 0);
  (client as any).getTicker = async () => ({ ...TICKER });

  const mkBot = (name: string, lot: number) => {
    const info = queries.insertBot.run({
      user_id: 0, name, exchange_id: 'indodax', pair: 'XRPIDR', strategy: 'dca',
      params: '{}', budget_idr: 100000, current_budget: 100000, lot,
      mode: 'paper', auto_compound_pct: 100, status: 'running', state: '{}',
      max_daily_loss_pct: 0,market_preset_id: null, created_at: now(), updated_at: now()
    });
    return queries.getBot.get(info.lastInsertRowid) as any;
  };
  const tradesFor = (botId: number) =>
    (db.prepare('SELECT * FROM trades WHERE bot_id=?').all(botId) as any[]).length;

  // ===== A) Buy ditolak saat kas kurang =====
  console.log('A) Guard buy paper (kas kurang)');
  const botA = mkBot('GuardA', 100000);
  queries.upsertPaperBalance.run('indodax', 'IDR', 5000, 0, 0); // kas hanya 5rb
  const rA = await executeAction(botA, { type: 'buy', amountQuote: 100000, reason: 'tes', tag: 'TRADE' }, 1);
  check('buy 100rb dengan kas 5rb -> null (skip)', rA === null);
  check('tidak ada trade tercatat', tradesFor(botA.id) === 0);
  const logA = db.prepare(`SELECT message FROM logs WHERE bot_id=? ORDER BY id DESC LIMIT 1`).get(botA.id) as any;
  check('log menyebut angka butuh vs tersedia', /butuh.*tersedia/i.test(logA?.message || ''), (logA?.message || '').slice(0, 100));

  // ===== B) Sell ditolak saat aset kurang =====
  console.log('\nB) Guard sell paper (aset kurang)');
  const botB = mkBot('GuardB', 20000);
  const rB = await executeAction(botB, { type: 'sell', qtyBase: 10, costBasis: 0, reason: 'tes', tag: 'TRADE' }, 1);
  check('sell 10 XRP tanpa saldo -> null (skip)', rB === null);
  check('tidak ada trade tercatat', tradesFor(botB.id) === 0);

  // ===== C) Lolos saat cukup =====
  console.log('\nC) Guard lolos saat saldo cukup');
  const botC = mkBot('GuardC', 20000);
  queries.upsertPaperBalance.run('indodax', 'IDR', 50000, 0, 0);
  const rC = await executeAction(botC, { type: 'buy', amountQuote: 20000, reason: 'tes', tag: 'TRADE' }, 1);
  check('buy 20rb dengan kas 50rb -> trade', !!rC && rC.side === 'buy');
  check('trade tercatat 1', tradesFor(botC.id) === 1);
  const sisa = db.prepare('SELECT free FROM paper_balances WHERE exchange_id=? AND asset=? AND user_id=?').get('indodax', 'IDR', 0) as any;
  check('kas berkurang 20rb', Math.abs(sisa.free - 30000) < 1, `sisa=${sisa.free}`);

  // ===== D) Faucet =====
  console.log('\nD) Faucet reset');
  check('seed default IDR 10jt', paperSeed('IDR', 0) === 10000000);
  check('seed default USDT 1000', paperSeed('USDT', 0) === 1000);
  const paper = registry.getPaperForUser('indodax', 0);
  const reset1 = paper.resetToSeed();
  check('reset mengembalikan 10jt IDR', reset1.seed === 10000000 && reset1.quote === 'IDR');
  const kas1 = db.prepare('SELECT free FROM paper_balances WHERE exchange_id=? AND asset=? AND user_id=?').get('indodax', 'IDR', 0) as any;
  check('saldo DB = seed', kas1.free === 10000000);
  settings.set('paper_seed_idr', '250000', 0);
  const reset2 = paper.resetToSeed();
  check('seed kustom 250rb dipakai', reset2.seed === 250000);
  settings.set('paper_seed_idr', '10000000', 0);

  // ===== E) Health check =====
  console.log('\nE) checkBalancesHealth');
  const botE = mkBot('GuardE', 999999999); // lot raksasa -> pasti short
  const health = await checkBalancesHealth(0);
  const idx = health.find(h => h.exchange_id === 'indodax');
  check('indodax ada di hasil', !!idx);
  const need = idx?.bots.find(b => b.bot_id === botE.id);
  check('bot lot raksasa ditandai short', need !== undefined && need.ok === false, JSON.stringify(need));
  check('counter short > 0', (idx?.short ?? 0) > 0);

  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
