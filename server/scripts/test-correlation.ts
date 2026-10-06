/**
 * Guard korelasi:
 *  A) pearson: identik -> ~1, berlawanan -> ~-1, data minim -> 0
 *  B) report tanpa bot -> aman, shape benar
 *  D) ignore: sembunyikan pasangan, pasangan lain tetap, urutan normal, basi auto-hapus, reset
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
  const { pearson, correlationReport, ignorePair, unignoreAll, getIgnored, pairKey } = await import('../src/engine/correlation.js');

  console.log('A) pearson');
  const up = Array.from({ length: 50 }, (_, i) => 100 + i);
  check('identik -> 1', Math.abs(pearson(up, up) - 1) < 1e-9, String(pearson(up, up)));
  check('berlawanan -> -1', Math.abs(pearson(up, [...up].reverse()) + 1) < 1e-9);
  check('data minim -> 0', pearson([1, 2], [1, 2]) === 0);

  console.log('\nB) report');
  const r = correlationReport(0);
  check('tanpa bot -> aman', r.high.length === 0 && /tidak ada korelasi/i.test(r.note), r.note);
  check('shape benar', Array.isArray(r.pairs));

  console.log('\nC) bot demo dikecualikan');
  const { db, queries, now } = await import('../src/db/index.js');
  queries.insertBot.run({
    user_id: 0, name: 'PaperA', exchange_id: 'indodax', pair: 'XRPIDR', strategy: 'grid',
    params: '{}', budget_idr: 100000, current_budget: 100000, lot: 20000, mode: 'paper',
    auto_compound_pct: 100, status: 'running', state: '{}', max_daily_loss_pct: 0,
    market_preset_id: null, created_at: now(), updated_at: now(),
  });
  queries.insertBot.run({
    user_id: 0, name: 'PaperB', exchange_id: 'bittime', pair: 'XRPIDR', strategy: 'grid',
    params: '{}', budget_idr: 100000, current_budget: 100000, lot: 20000, mode: 'paper',
    auto_compound_pct: 100, status: 'running', state: '{}', max_daily_loss_pct: 0,
    market_preset_id: null, created_at: now(), updated_at: now(),
  });
  const r2 = correlationReport(0);
  check('2 bot demo pair sama -> tetap aman', r2.high.length === 0 && r2.pairs.length === 0, JSON.stringify(r2.pairs));
  void db;

  console.log('\nD) ignore pasangan');
  check('pairKey normal (A|B=B|A)', pairKey('x:B', 'a:A') === pairKey('a:A', 'x:B'));
  ignorePair(5, 'indodax:DOGEIDR', 'binance:DOGEUSDT');
  ignorePair(5, 'binance:DOGEUSDT', 'indodax:DOGEIDR'); // duplikat terbalik
  check('idempoten + ternormalisasi', JSON.stringify(getIgnored(5)) === JSON.stringify(['binance:DOGEUSDT|indodax:DOGEIDR']), JSON.stringify(getIgnored(5)));
  // Simulasi report: kunci basi (pair tak dipakai) ikut terhapus saat report jalan
  const { settings } = await import('../src/db/index.js');
  settings.set('corr_ignore', 'binance:DOGEUSDT|indodax:DOGEIDR,stale:XXX', 6);
  const r3 = correlationReport(6); // user 6 tanpa bot
  check('kunci basi auto-hapus', JSON.stringify(getIgnored(6)) === JSON.stringify([]) && r3.ignored.length === 0, JSON.stringify(getIgnored(6)));
  unignoreAll(5);
  check('reset mengosongkan', getIgnored(5).length === 0);

  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
