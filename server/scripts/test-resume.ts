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
  check('level BELUM ditandai sebelum fill (deferral)', dip.levelsHit.length === 0, JSON.stringify(dip.levelsHit));
  check('meta level terbawa di aksi', actsDip[0].meta?.level === 2, JSON.stringify(actsDip[0].meta));
  const { applyFillToState } = await import('../src/engine/scheduler.js');
  applyFillToState('grid', dip, { price: 985, qty: 1, value: 985 }, actsDip[0]);
  check('level ditandai SETELAH fill', JSON.stringify(dip.levelsHit) === '[2]', JSON.stringify(dip.levelsHit));
  // DCA: lastEntryPrice maju hanya saat fill
  await import('../src/strategies/dca.js');
  const dcaState: any = { entries: [], lastEntryPrice: 0 };
  const dca = getStrategy('dca');
  const dcaCtx: any = { bot: { id: 2, current_budget: 100000 }, ticker: { pair: 'XRPIDR', bid: 99, ask: 101, last: 100, high24: 100, low24: 100, vol24: 0, ts: 1 }, usdtIdr: 1, now: Date.now(), getKlines: async () => [], getBalances: async () => [], getPrice: async () => 100 };
  const dcaActs = await dca.onTick(dcaCtx, dcaState, { drop_pct: 2, take_profit_pct: 3, max_buys: 5 });
  check('DCA entry pertama teremisi', dcaActs.length === 1, `got ${dcaActs.length}`);
  check('lastEntryPrice BELUM maju sebelum fill', dcaState.lastEntryPrice === 0, `got ${dcaState.lastEntryPrice}`);
  applyFillToState('dca', dcaState, { price: 100, qty: 1, value: 100 }, dcaActs[0]);
  check('lastEntryPrice maju SETELAH fill', dcaState.lastEntryPrice === 100, `got ${dcaState.lastEntryPrice}`);
  check('entry tercatat', dcaState.entries.length === 1);

  // ===== E) numParam: parameter korup tak boleh mematikan strategi =====
  console.log('\nE) numParam sanitasi');
  const { numParam } = await import('../src/strategies/types.js');
  check('NaN -> default', numParam({ x: 'abc' }, 'x', 5) === 5);
  check('undefined -> default', numParam({}, 'x', 5) === 5);
  check('clamp min/max', numParam({ x: 1000 }, 'x', 5, 1, 50) === 50 && numParam({ x: -3 }, 'x', 5, 1, 50) === 1);
  check('nilai valid lolos', numParam({ x: '2.5' }, 'x', 5) === 2.5);
  const badParams = { drop_pct: 'rusak', take_profit_pct: NaN, max_buys: 'banyak' };
  const deadState: any = { entries: [], lastEntryPrice: 0 };
  const deadActs = await dca.onTick(dcaCtx, deadState, badParams);
  check('DCA param korup tetap hasilkan entry (default)', deadActs.length === 1, `got ${deadActs.length}`);

  // ===== F) Harvester: dust-hold — sisa debu ditahan, bukan dipanen paksa =====
  console.log('\nF) Harvester dust-hold');
  await import('../src/strategies/harvester.js');
  const harv = getStrategy('harvester');
  const hState: any = { entries: [{ price: 100, qty: 0.5, cost: 50 }], lastBuyPrice: 90 };
  // minLot 30: panen-1 cair 50.15 (lolos), panen-2 cair ~25 (ditahan)
  const hCtx: any = { ...dcaCtx, minLot: 30, ticker: { pair: 'XRPIDR', bid: 199, ask: 201, last: 200, high24: 200, low24: 200, vol24: 0, ts: 1 } };
  const hActs = await harv.onTick(hCtx, hState, { drop_pct: 2.5, harvest_pct: 2, max_buys: 8 });
  check('panen besar teremisi', hActs.length === 1 && hActs[0].tag === 'INVENTORY_HARVEST_RECYCLE', JSON.stringify(hActs.map(a => a.tag)));
  check('sisa dipertahankan (bukan dikosongkan)', hState.entries.length === 1, `got ${hState.entries.length}`);
  // Panen kedua beruntun di harga sama -> hasil < minLot -> DITAHAN (entries utuh)
  const hActs2 = await harv.onTick(hCtx, hState, { drop_pct: 2.5, harvest_pct: 2, max_buys: 8 });
  check('panen kedua ditahan (debu)', hActs2.length === 0, `got ${JSON.stringify(hActs2.map(a => a.tag))}`);
  check('entries tetap utuh saat hold', hState.entries.length === 1, `got ${hState.entries.length}`);

  // ===== G) Grid dust-hold: unwind terlalu kecil ditahan, bukan diclear =====
  console.log('\nG) Grid dust-hold');
  const gState: any = { anchor: 100, filledBuys: [{ level: 0, price: 100, qty: 0.0001, cost: 0.01 }], levelsHit: [0] };
  const gCtx: any = { ...mkCtx(104), minLot: 50000 };
  const gActs = await grid.onTick(gCtx, gState, params);
  check('unwind debu ditahan (tanpa aksi)', gActs.length === 0, `got ${JSON.stringify(gActs.map(a => a.tag))}`);
  check('filledBuys tetap (menunggu harga naik)', gState.filledBuys.length === 1, `got ${gState.filledBuys.length}`);
  const gState2: any = { anchor: 100, filledBuys: [{ level: 0, price: 100, qty: 0.5, cost: 50 }], levelsHit: [0] };
  const gCtx2: any = { ...mkCtx(104), minLot: 1 };
  const gActs2 = await grid.onTick(gCtx2, gState2, params);
  check('unwind normal tetap jalan', gActs2.length === 1 && gActs2[0].type === 'sell', `got ${JSON.stringify(gActs2.map(a => a.tag))}`);

  // ===== H) Scalper: exit debu ditahan, bukan dijual paksa =====
  console.log('\nH) Scalper dust-exit');
  await import('../src/strategies/scalper.js');
  const scalper = getStrategy('scalper');
  // Tuple [t,o,h,l,c,v] sesuai tipe Kline exchange
  const klinesUp = (n: number, start: number, step: number) =>
    Array.from({ length: n }, (_, i) => [i, start + i * step, start + i * step + 1, start + i * step - 1, start + i * step, 1]);
  const dustPos: any = { entryPrice: 100, qty: 0.0001 };
  const sCtxHold: any = { ...mkCtx(110), minLot: 50000, getKlines: async () => klinesUp(30, 100, 1) };
  const sActsHold = await scalper.onTick(sCtxHold, { position: dustPos, cooldownUntil: 0 }, { ema_fast: 5, ema_slow: 20, take_profit_pct: 50, stop_loss_pct: 50 });
  check('take-profit debu ditahan', sActsHold.length === 0, `got ${JSON.stringify(sActsHold.map(a => a.tag))}`);
  const bigPos: any = { entryPrice: 100, qty: 10 };
  const sCtxBig: any = { ...mkCtx(110), minLot: 1, getKlines: async () => klinesUp(30, 100, 1) };
  const sActsBig = await scalper.onTick(sCtxBig, { position: bigPos, cooldownUntil: 0 }, { ema_fast: 5, ema_slow: 20, take_profit_pct: 5, stop_loss_pct: 50 });
  check('take-profit normal tetap jalan', sActsBig.length === 1 && sActsBig[0].type === 'sell', `got ${JSON.stringify(sActsBig.map(a => a.tag))}`);
  // State legacy tanpa cache + getKlines gagal total -> tak crash, tak ada aksi
  const sCtxDead: any = { ...mkCtx(110), minLot: 1, getKlines: async () => { throw new Error('jaringan putus'); } };
  let deadScalpActs: any[] = [];
  let crashed = false;
  try { deadScalpActs = await scalper.onTick(sCtxDead, {} as any, {}); } catch { crashed = true; }
  check('state korup + klines gagal tak crash', !crashed && deadScalpActs.length === 0, `crashed=${crashed}`);

  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
