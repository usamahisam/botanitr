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

  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
