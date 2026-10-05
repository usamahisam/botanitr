/**
 * E2E budget maksimal bot:
 *  A) validateLiveBudget menolak budget > kas (pesan jelas + angka)
 *  B) validateLiveBudget lolos bila cukup
 *  C) validateLiveBudget fail-open bila saldo tak terbaca
 *  D) maxSpendable paper (seed) & live (mock)
 *  E) validateBudget paper: tolak budget > kas demo + pesan reset
 *
 * Jalankan: npx tsx server/scripts/test-bot-budget.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.BOTANI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'botani-budget-'));

let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

async function main() {
  await import('../src/db/index.js');
  const { registry } = await import('../src/exchange/registry.js');
  const { validateLiveBudget, validateBudget, maxSpendable } = await import('../src/engine/budget.js');

  // Stub saldo live: kas IDR 198.600
  const client = registry.getForUser('indodax', 0);
  (client as any).getBalances = async () => [{ asset: 'IDR', free: 198600, locked: 0 }];

  // ===== A) Budget melebihi kas =====
  console.log('A) Budget > kas ditolak');
  const over = await validateLiveBudget(0, 'indodax', 500000);
  check('ok=false', over.ok === false);
  check('freeQuote=198600', over.freeQuote === 198600, `got ${over.freeQuote}`);
  check('pesan menyebut angka', /500\.000.*198\.600|198\.600.*500\.000/s.test(over.message.replace(/[^\d.]/g, m => m)), over.message.slice(0, 120));

  // ===== B) Budget cukup =====
  console.log('\nB) Budget cukup diloloskan');
  const okRes = await validateLiveBudget(0, 'indodax', 100000);
  check('ok=true, skipped=false', okRes.ok === true && okRes.skipped === false);

  // ===== C) Fail-open =====
  console.log('\nC) Saldo tak terbaca -> fail-open');
  (client as any).getBalances = async () => { throw new Error('jaringan putus'); };
  const skip = await validateLiveBudget(0, 'indodax', 999999999);
  check('ok=true + skipped=true', skip.ok === true && skip.skipped === true);
  (client as any).getBalances = async () => [{ asset: 'IDR', free: 198600, locked: 0 }];

  // ===== D) maxSpendable =====
  console.log('\nD) maxSpendable');
  const paper = await maxSpendable(0, 'indodax');
  check('paper mode + seed 10jt', paper.mode === 'paper' && paper.free === 10000000 && paper.quote === 'IDR',
    JSON.stringify(paper));
  const { db } = await import('../src/db/index.js');
  db.prepare(`UPDATE exchanges SET mode='live' WHERE id='indodax' AND user_id=0`).run();
  const live = await maxSpendable(0, 'indodax');
  check('live mode + kas 198600', live.mode === 'live' && live.free === 198600, JSON.stringify(live));

  // ===== E) Paper: budget > kas demo ditolak sejak pembuatan =====
  console.log('\nE) validateBudget paper');
  const paperOver = await validateBudget(0, 'indodax', 1000000000, 'paper');
  check('budget 1M > seed 10jt -> ok=false', paperOver.ok === false, JSON.stringify({ ok: paperOver.ok, free: paperOver.freeQuote }));
  check('pesan sarankan reset demo', /reset saldo demo/i.test(paperOver.message), paperOver.message.slice(0, 140));
  const paperOk = await validateBudget(0, 'indodax', 100000, 'paper');
  check('budget 100rb diloloskan', paperOk.ok === true && paperOk.skipped === false);

  // ===== F) Klaim modal: bot running lain mengurangi jatah (anti double-spend) =====
  console.log('\nF) Klaim modal running');
  const { queries, now } = await import('../src/db/index.js');
  queries.insertBot.run({
    user_id: 0, name: 'Klaim-A', exchange_id: 'indodax', pair: 'XRPIDR', strategy: 'grid',
    params: '{}', budget_idr: 6000000, current_budget: 6000000, lot: 1000000, mode: 'paper',
    auto_compound_pct: 100, status: 'running', state: '{}', max_daily_loss_pct: 0,
    market_preset_id: null, created_at: now(), updated_at: now(),
  });
  const claimOver = await validateBudget(0, 'indodax', 5000000, 'paper');
  check('6jt diklaim + 5jt baru > 10jt -> tolak', claimOver.ok === false, claimOver.message.slice(0, 140));
  check('pesan sebut klaim berjalan', /klaim/i.test(claimOver.message), claimOver.message.slice(0, 140));
  const claimOk = await validateBudget(0, 'indodax', 3000000, 'paper');
  check('6jt diklaim + 3jt baru <= 10jt -> lolos', claimOk.ok === true, claimOk.message.slice(0, 120));

  // ===== G) Guard ledger kas bot =====
  console.log('\nG) checkLedgerCash');
  const { checkLedgerCash } = await import('../src/engine/trader.js');
  check('kas cukup -> null', checkLedgerCash(100000, 50000) === null);
  check('kas belum init -> null (fail-open)', checkLedgerCash(undefined, 999999) === null);
  check('kas kurang jauh -> pesan', typeof checkLedgerCash(10000, 90000) === 'string');
  check('selisih fee 0,3% ditoleransi', checkLedgerCash(99700, 100000) === null, 'fee-drag tidak boleh blokir buy terakhir');

  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
