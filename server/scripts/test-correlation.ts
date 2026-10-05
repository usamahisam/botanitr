/**
 * Guard korelasi:
 *  A) pearson: identik -> ~1, berlawanan -> ~-1, data minim -> 0
 *  B) report tanpa bot -> aman, shape benar
 *
 * Jalankan: npx tsx server/scripts/test-correlation.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.BOTANI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'botani-corr-'));
process.env.SECRET_KEY = 'test-secret-key-minimal-32-chars-abcdef';

let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

async function main() {
  const { pearson, correlationReport } = await import('../src/engine/correlation.js');

  console.log('A) pearson');
  const up = Array.from({ length: 50 }, (_, i) => 100 + i);
  check('identik -> 1', Math.abs(pearson(up, up) - 1) < 1e-9, String(pearson(up, up)));
  check('berlawanan -> -1', Math.abs(pearson(up, [...up].reverse()) + 1) < 1e-9);
  check('data minim -> 0', pearson([1, 2], [1, 2]) === 0);

  console.log('\nB) report');
  const r = correlationReport(0);
  check('tanpa bot -> aman', r.high.length === 0 && /tidak ada korelasi/i.test(r.note), r.note);
  check('shape benar', Array.isArray(r.pairs));

  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
