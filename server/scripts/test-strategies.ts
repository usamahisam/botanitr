/**
 * Validasi strategi via replay harness + candle sintetik deterministik.
 * Syarat lolos: tak crash, ada aksi buy AND sell di skenario yang cocok,
 * tiap trade bersih di atas fee, dan kerugian skenario crash terbatas.
 *
 * Jalankan: npx tsx server/scripts/test-strategies.ts
 */
process.env.BOTANI_DATA_DIR = '/tmp/botani-tstrat-' + Date.now();
process.env.SECRET_KEY = 'test-secret-key-minimal-32-chars-abcdef';

let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

/** PRNG deterministik agar hasil stabil antar run */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type K = [number, number, number, number, number, number];

function toKlines(closes: number[], stepMs = 300000): K[] {
  const t0 = 1700000000000;
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1];
    return [t0 + i * stepMs, o, Math.max(o, c) * 1.0008, Math.min(o, c) * 0.9992, c, 1000];
  });
}

function sideways(n = 600, seed = 7): K[] {
  const rnd = mulberry32(seed);
  const closes: number[] = [];
  for (let i = 0; i < n; i++) closes.push(100000 * (1 + 0.02 * Math.sin(i / 7) + 0.004 * (rnd() - 0.5) * 2));
  return toKlines(closes);
}

function uptrend(n = 600, seed = 21): K[] {
  const rnd = mulberry32(seed);
  const closes: number[] = [];
  for (let i = 0; i < n; i++) closes.push(100000 * (1 + 0.0006 * i) * (1 + 0.008 * Math.sin(i / 6) + 0.002 * (rnd() - 0.5) * 2));
  return toKlines(closes);
}

function crash(n = 600): K[] {
  const closes: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i < 200) closes.push(100000);
    else if (i < 260) closes.push(100000 * (1 - 0.005 * (i - 200))); // -30%
    else closes.push(70000);
  }
  return toKlines(closes);
}

async function main() {
  const { replay } = await import('../src/engine/replay.js');
  const { minGrossTargetPct, isNetProfitable } = await import('../src/strategies/fees.js');
  const { detectRegime } = await import('../src/strategies/regime.js');
  const BUDGET = 1000000;

  console.log('A) Kesadaran fee');
  const indo = minGrossTargetPct('indodax', {});
  const bina = minGrossTargetPct('binance', {});
  check('floor Indodax > 0,6% (fee PP)', indo > 0.6, `${indo}`);
  check('floor Binance < Indodax', bina < indo, `${bina} vs ${indo}`);
  check('+0,5% di Indodax = rugi bersih', isNetProfitable(100, 100.5, 'indodax', {}) === false);
  check('+1,2% di Indodax = cuan bersih', isNetProfitable(100, 101.2, 'indodax', {}) === true);

  console.log('\nB) Deteksi rezim');
  const sw = sideways();
  const flat = toKlines(Array.from({ length: 100 }, () => 100000));
  const vola = toKlines(Array.from({ length: 100 }, (_, i) => 100000 * (1 + 0.03 * Math.sin(i / 2))));
  check('sideways ±2% bukan hemat', detectRegime(sw, {}).mode !== 'hemat', detectRegime(sw, {}).mode);
  check('garis datar total = hemat', detectRegime(flat, {}).mode === 'hemat');
  check('osilasi ±3% cepat = scalp', detectRegime(vola, {}).mode === 'scalp');

  console.log('\nC) Sideways ±2% (2 hari, budget 1jt, fee Indodax)');
  const grid = await replay('grid', { lower_pct: 3, upper_pct: 3, levels: 6, profit_pct: 0.5 }, sw, { budget: BUDGET });
  check('grid: ada buy & sell', grid.buys > 0 && grid.sells > 0, `b=${grid.buys} s=${grid.sells}`);
  check('grid: terealisasi positif', grid.realized > 0, `Rp${Math.round(grid.realized)}`);
  const bb = await replay('bollinger', { timeframe: '5m', bb_period: 20, bb_mult: 2, entry_b: 0 }, sw, { budget: BUDGET });
  check('bollinger: ada buy & sell', bb.buys > 0 && bb.sells > 0, `b=${bb.buys} s=${bb.sells}`);
  check('bollinger: terealisasi positif', bb.realized > 0, `Rp${Math.round(bb.realized)}`);
  const dyn = await replay('dynamic', { step_pct: 1.0, levels: 8, profit_pct: 0.5 }, sw, { budget: BUDGET });
  check('dynamic: ping-pong minimal 5x panen', dyn.buys >= 5 && dyn.sells >= 5, `b=${dyn.buys} s=${dyn.sells}`);
  check('dynamic: terealisasi positif', dyn.realized > 0, `Rp${Math.round(dyn.realized)}`);
  const dca = await replay('dca', { drop_pct: 2, take_profit_pct: 3, max_buys: 5, partial_pct: 50 }, sw, { budget: BUDGET });
  check('dca: akumulasi jalan', dca.buys > 0, `b=${dca.buys}`);
  const agg = await replay('dca', { drop_pct: 2, take_profit_pct: 3, max_buys: 4, all_in: 'agresif' }, sw, { budget: BUDGET });
  check('dca agresif: borong 4 lot di depan', agg.buys >= 4, `b=${agg.buys}`);
  const harv = await replay('harvester', { drop_pct: 2.5, harvest_pct: 2, max_buys: 8 }, sw, { budget: BUDGET });
  check('harvester: akumulasi jalan', harv.buys > 0, `b=${harv.buys}`);

  console.log('\nD) Uptrend + pullback (+36%/2hari)');
  const up = uptrend();
  const rev = await replay('revert', { timeframe: '5m', rsi_len: 3, oversold: 20, exit_rsi: 65 }, up, { budget: BUDGET });
  check('revert: ada buy & sell', rev.buys > 0 && rev.sells > 0, `b=${rev.buys} s=${rev.sells} Rp${Math.round(rev.realized)}`);
  const brk = await replay('breakout', { timeframe: '5m', donchian_n: 20, tp_pct: 0.8, sl_pct: 1.2 }, up, { budget: BUDGET });
  check('breakout: ikut tren', brk.buys > 0 && brk.sells > 0, `b=${brk.buys} s=${brk.sells} Rp${Math.round(brk.realized)}`);
  const sc = await replay('scalper', { timeframe: '1m', ema_fast: 20, ema_slow: 50, rsi_period: 14, rsi_entry: 55, tp_pct: 1.0, sl_pct: 0.8, trailing_pct: 0.8 }, up, { budget: BUDGET });
  check('scalper: ada posisi & exit', sc.buys > 0 && sc.sells > 0, `b=${sc.buys} s=${sc.sells} Rp${Math.round(sc.realized)}`);
  const dynUp = await replay('dynamic', { step_pct: 1.0, levels: 8, profit_pct: 0.5 }, up, { budget: BUDGET });
  check('dynamic uptrend: ikut naik + panen', dynUp.buys > 0 && dynUp.sells > 0, `b=${dynUp.buys} s=${dynUp.sells} Rp${Math.round(dynUp.realized)}`);

  console.log('\nE) Crash -30% (risiko campuran: rugi terbatas, tak hang)');
  const cr = crash();
  for (const [name, params] of [
    ['grid', {}], ['dca', {}], ['scalper', {}], ['revert', {}], ['bollinger', {}], ['breakout', {}], ['dynamic', {}],
  ] as const) {
    const r = await replay(name, params, cr, { budget: BUDGET });
    check(`${name}: drawdown < 70%`, r.maxDdPct < 70, `${r.maxDdPct.toFixed(1)}%`);
  }
  const dcaSL = await replay('dca', { drop_pct: 2, take_profit_pct: 3, max_buys: 5, all_in: 'cadangan', sl_pct: 4 }, cr, { budget: BUDGET });
  check('dca stop-rugi memotong saat crash', dcaSL.sells > 0, `s=${dcaSL.sells}`);

  console.log('\nF) Revert: exit wajib cuan + entry tunggu pantul');
  const { getStrategy } = await import('../src/strategies/types.js');
  await import('../src/strategies/revert.js');
  const revS = getStrategy('revert');
  // RSI panas (closes naik tajam) tapi harga di bawah entry
  const hot = Array.from({ length: 60 }, (_, i) => [1700000000000 + i * 300000, 90 + i, 91 + i, 89 + i, 90 + i, 10]);
  const mkRevCtx = (price: number, kl: any = hot): any => ({
    bot: { current_budget: 1000000, exchange_id: 'indodax' }, ticker: { last: price },
    quote: 'IDR', minLot: 0, usdtIdr: 1, now: Date.now(),
    getKlines: async () => kl, getBalances: async () => [], getPrice: async () => price,
  });
  const rParams = { timeframe: '5m', rsi_len: 3, oversold: 20, exit_rsi: 65, tp_pct: 1.0, sl_pct: 3.0, mtf_confirm: false };
  const stLoss = { position: { entryPrice: 100, qty: 10, cost: 1000 }, candlesTs: 0, candles: [], lastEntryTs: 0 };
  const aLoss = await revS.onTick(mkRevCtx(98), stLoss, rParams);
  check('rugi -2% saat RSI panas -> TAHAN (tak ada sell)', !aLoss.some(a => a.type === 'sell'), JSON.stringify(aLoss.map(a => a.type)));
  const stTol = { position: { entryPrice: 100, qty: 10, cost: 1000 }, candlesTs: 0, candles: [], lastEntryTs: 0 };
  const aTol = await revS.onTick(mkRevCtx(99.6), stTol, rParams);
  check('rugi -0,4% saat RSI panas -> TAHAN juga', !aTol.some(a => a.type === 'sell'), JSON.stringify(aTol.map(a => a.type)));
  const stWin = { position: { entryPrice: 100, qty: 10, cost: 1000 }, candlesTs: 0, candles: [], lastEntryTs: 0 };
  const aWin = await revS.onTick(mkRevCtx(102), stWin, rParams);
  check('cuan -> exit', aWin.some(a => a.type === 'sell'), JSON.stringify(aWin.map(a => a.type)));
  // Basis naik 90->109.5: tren (SMA20) lolos di kedua kasus, yang
  // membedakan hanya cross pantul RSI.
  const rise: any[] = [];
  for (let i = 0; i < 40; i++) rise.push([1700000000000 + i * 300000, 90 + i * 0.5, 91 + i * 0.5, 89 + i * 0.5, 90 + i * 0.5, 10]);
  const t0 = 1700000000000 + 40 * 300000;
  const kl = (extra: number[]) => [...rise, ...extra.map((c, i) => [t0 + i * 300000, c - 0.1, c + 0.1, c - 0.1, c, 10])];
  // Jatuh terus: 108.5, 107, 106.5 (RSI tetap tenggelam, tren masih lolos)
  const stF = { position: null, candlesTs: 0, candles: [], lastEntryTs: 0 };
  const aF = await revS.onTick(mkRevCtx(106.6, kl([108.5, 107, 106.5])), stF, { ...rParams, trend_sma: 20 });
  check('RSI tenggelam tanpa pantul -> tak entry', !aF.some(a => a.type === 'buy'), JSON.stringify(aF.map(a => a.type)));
  // Pantul: 108.5, 107, 108 (cross naik melewati oversold)
  const stV = { position: null, candlesTs: 0, candles: [], lastEntryTs: 0 };
  const aV = await revS.onTick(mkRevCtx(108.1, kl([108.5, 107, 108])), stV, { ...rParams, trend_sma: 20 });
  check('pantul cross oversold -> entry', aV.some(a => a.type === 'buy'), JSON.stringify(aV.map(a => a.type)));

  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
