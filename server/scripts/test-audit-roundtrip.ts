/**
 * Audit round-trip SEMUA strategi: tiap strategi harus mampu menyelesaikan
 * minimal 1 siklus penuh beli -> jual dengan hasil bersih >= 0 di data
 * yang cocok untuk gayanya. Menangkap strategi yang "mudah buy sulit sell".
 *
 * Jalankan: npx tsx server/scripts/test-audit-roundtrip.ts
 */
let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toK(closes: number[]): any[] {
  const t0 = 1700000000000;
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1];
    return [t0 + i * 300000, o, Math.max(o, c) * 1.0008, Math.min(o, c) * 0.9992, c, 1000];
  });
}

function sideways(n = 600, seed = 7): any[] {
  const rnd = mulberry32(seed);
  const closes: number[] = [];
  for (let i = 0; i < n; i++) closes.push(100000 * (1 + 0.02 * Math.sin(i / 7) + 0.004 * (rnd() - 0.5) * 2));
  return toK(closes);
}

function uptrend(n = 600, seed = 21): any[] {
  const rnd = mulberry32(seed);
  const closes: number[] = [];
  for (let i = 0; i < n; i++) closes.push(100000 * (1 + 0.0006 * i) * (1 + 0.008 * Math.sin(i / 6) + 0.002 * (rnd() - 0.5) * 2));
  return toK(closes);
}

async function main() {
  const { replay } = await import('../src/engine/replay.js');
  const BUDGET = 1000000;
  const sw = sideways();
  const up = uptrend();

  console.log('A) Mean-reversion di sideways (wajib cuan bersih)');
  for (const [name, params] of [
    ['grid', { lower_pct: 3, upper_pct: 3, levels: 6, profit_pct: 0.5 }],
    ['dca', { drop_pct: 2, take_profit_pct: 3, max_buys: 5, partial_pct: 50 }],
    ['harvester', { drop_pct: 2.5, harvest_pct: 2, max_buys: 8 }],
    ['bollinger', { timeframe: '5m' }],
    ['dynamic', { step_pct: 1.0, levels: 8, profit_pct: 0.5 }],
  ] as const) {
    const r = await replay(name, params, sw, { budget: BUDGET });
    check(`${name}: buy&sell + realized>=0`, r.buys > 0 && r.sells > 0 && r.realized >= 0,
      `b=${r.buys} s=${r.sells} Rp${Math.round(r.realized)}`);
  }

  console.log('\nB) Momentum di uptrend (wajib ada exit)');
  for (const [name, params] of [
    ['scalper', { timeframe: '1m' }],
    ['revert', { timeframe: '5m' }],
    ['breakout', { timeframe: '5m' }],
  ] as const) {
    const r = await replay(name, params, up, { budget: BUDGET });
    check(`${name}: buy&sell`, r.buys > 0 && r.sells > 0, `b=${r.buys} s=${r.sells} Rp${Math.round(r.realized)}`);
  }

  console.log('\nC) Rebalance dua arah');
  const { getStrategy } = await import('../src/strategies/types.js');
  await import('../src/strategies/rebalance.js');
  const rb = getStrategy('rebalance');
  const st: any = { lastRun: 0 };
  // Kas 1jt IDR, tak pegang BTC, target BTC 100% -> harus BELI
  const ctxBuy: any = {
    bot: { current_budget: 1000000, exchange_id: 'indodax' }, ticker: { last: 1500000000 },
    quote: 'IDR', minLot: 0, usdtIdr: 1, now: Date.now(),
    getKlines: async () => [], getBalances: async () => [{ asset: 'IDR', free: 1000000, locked: 0 }],
    getPrice: async () => 1500000000,
  };
  const aBuy = await rb.onTick(ctxBuy, st, { targets: { BTC: 100 }, threshold_pct: 1, interval_min: 0 });
  check('rebalance kurang -> beli', aBuy.some(a => a.type === 'buy'), JSON.stringify(aBuy.map(a => a.type)));
  // Pegang BTC 1 @ 1,5M, target BTC 50%/ETH 50% -> BTC berlebih, harus JUAL
  const st2: any = { lastRun: 0 };
  const ctxSell: any = {
    ...ctxBuy,
    getBalances: async () => [{ asset: 'IDR', free: 0, locked: 0 }, { asset: 'BTC', free: 1, locked: 0 }],
    getPrice: async (p: string) => (p === 'BTCIDR' ? 1500000000 : 1),
  };
  const aSell = await rb.onTick(ctxSell, st2, { targets: { BTC: 50, ETH: 50 }, threshold_pct: 1, interval_min: 0, max_trade_quote: 100000000 });
  check('rebalance lebih -> jual', aSell.some(a => a.type === 'sell'), JSON.stringify(aSell.map(a => a.type)));

  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
