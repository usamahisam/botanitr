/**
 * E2E stop/resume & luncurkan-ulang:
 *  A) Stagger scheduler: tick pertama lolos, tick beruntun ditahan, mandiri per bot, prune bekerja
 *  B) Grid re-anchor: anchor basi + tanpa posisi + harga di luar range -> ikut harga, tanpa aksi
 *  C) Grid TIDAK reset saat ada posisi terbuka (unwind tetap jalan)
 *  D) Grid dalam range: anchor dipertahankan, perilaku beli normal tak berubah
 *
 * Jalankan: npx tsx server/scripts/test-resume.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.BOTANI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'botani-resume-'));

let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

const tickerAt = (price: number) => ({
  pair: 'BTCIDR', bid: price - 1, ask: price + 1, last: price,
  high24: price, low24: price, vol24: 0, ts: Date.now()
});

async function main() {
  await import('../src/db/index.js');
  const { shouldTick, pruneTickCache } = await import('../src/engine/scheduler.js');
  const { getStrategy } = await import('../src/strategies/types.js');
  await import('../src/strategies/grid.js');
  const grid = getStrategy('grid');
  const params = { lower_pct: 3, upper_pct: 3, levels: 6 };

  // ===== A) Stagger per-bot berbasis waktu, bukan objek baris DB =====
  console.log('A) Stagger scheduler');
  check('tick pertama lolos', shouldTick(7, 100000) === true);
  check('tick 1ms berikut ditahan', shouldTick(7, 100001) === false);
  check('bot lain mandiri (id 8)', shouldTick(8, 100001) === true);
  check('lolos lagi setelah interval (12,5 dtk)', shouldTick(7, 100000 + 12500) === true);
  pruneTickCache([8]);
  check('prune menghapus bot tak aktif', shouldTick(7, 100001) === true, 'cache id 7 harusnya sudah dibuang');

  const mkCtx = (price: number): any => ({
    bot: { id: 1, current_budget: 100000, pair: 'BTCIDR' },
    ticker: tickerAt(price), usdtIdr: 1, now: Date.now(),
    getKlines: async () => [], getBalances: async () => [],
    getPrice: async () => price
  });

  // ===== B) Re-anchor saat keluar range tanpa posisi =====
  console.log('\nB) Grid re-anchor setelah jeda lama');
  const stale = { anchor: 1000, filledBuys: [], levelsHit: [0, 1] };
  const actsB = await grid.onTick(mkCtx(1100), stale, params);
  check('anchor mengikuti harga (1000 -> 1100)', stale.anchor === 1100, `got ${stale.anchor}`);
  check('levelsHit dibersihkan', stale.levelsHit.length === 0);
  check('tanpa aksi dadakan', actsB.length === 0, `got ${actsB.length}`);
  const staleLow = { anchor: 1000, filledBuys: [], levelsHit: [] as number[] };
  await grid.onTick(mkCtx(900), staleLow, params);
  check('re-anchor juga saat jatuh jauh (1000 -> 900)', staleLow.anchor === 900, `got ${staleLow.anchor}`);

  // ===== C) Posisi terbuka: JANGAN reset prematur, unwind tetap jalan =====
  console.log('\nC) Posisi terbuka dipertahankan');
  const withPos = { anchor: 1000, filledBuys: [{ price: 990, qty: 1, cost: 990 }], levelsHit: [2] as number[] };
  const actsC = await grid.onTick(mkCtx(1100), withPos, params);
  check('unwind sell tetap teremisi', actsC.some(a => a.tag === 'GRID_UNWIND'), JSON.stringify(actsC.map(a => a.tag)));
  check('anchor di-reset OLEH unwind (siklus baru)', withPos.anchor === 1100, `got ${withPos.anchor}`);
  const bagHold = { anchor: 1000, filledBuys: [{ price: 990, qty: 1, cost: 990 }], levelsHit: [0, 1, 2] as number[] };
  const actsHold = await grid.onTick(mkCtx(900), bagHold, params);
  check('tanpa unwind di bawah breakeven', actsHold.length === 0, `got ${actsHold.length}`);
  check('anchor TIDAK di-reset saat nyangkut (tunggu recovery)', bagHold.anchor === 1000, `got ${bagHold.anchor}`);

  // ===== D) Dalam range: perilaku lama tak berubah =====
  console.log('\nD) Dalam range normal');
  const normal = { anchor: 1000, filledBuys: [], levelsHit: [] as number[] };
  const actsD = await grid.onTick(mkCtx(995), normal, params);
  check('anchor dipertahankan', normal.anchor === 1000, `got ${normal.anchor}`);
  check('tanpa aksi di 995 (belum sentuh level 990)', actsD.length === 0, `got ${actsD.length}`);
  const dip = { anchor: 1000, filledBuys: [], levelsHit: [] as number[] };
  const actsDip = await grid.onTick(mkCtx(985), dip, params);
  check('beli normal saat sentuh level 990', actsDip.length === 1 && actsDip[0].type === 'buy', JSON.stringify(actsDip.map(a => a.type)));
  check('level ditandai', JSON.stringify(dip.levelsHit) === '[2]', JSON.stringify(dip.levelsHit));

  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
