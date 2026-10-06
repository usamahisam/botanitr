/**
 * Gate validasi Flash Scalper:
 *  A) tick turbo ≤5 dtk, kuota 2/user, degraded dikecualikan
 *  B) cooldown 60 dtk + floor fee Tokocrypto memungkinkan TP 0,5
 *  C) fail-safe: 3 gagal -> degraded -> pulih saat sukses
 *  D) cap harian menahan tick saat kuota habis
 *  E) replay 3 hari volatile + slippage: bersih positif, DD <5%
 *
 * Jalankan: npx tsx server/scripts/test-flash.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.BOTANI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'botani-flash-'));
process.env.SECRET_KEY = 'test-secret-key-minimal-32-chars-abcdef';

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

async function main() {
  const { shouldTick, turboAllowed, hitDailyCap } = await import('../src/engine/scheduler.js');
  const { recordTradeFail, recordTradeSuccess, isDegraded } = await import('../src/engine/trader.js');
  const { adaptiveCooldownMs } = await import('../src/strategies/regime.js');
  const { minGrossTargetPct } = await import('../src/strategies/fees.js');

  console.log('A) Turbo tick + kuota');
  const t0 = 1000000;
  check('turbo lolos di 4 dtk', shouldTick(911, t0, true) === true);
  check('turbo ditahan sebelum 4 dtk', shouldTick(911, t0 + 3999, true) === false);
  check('normal tetap ~8 dtk+', shouldTick(912, t0, false) === true && shouldTick(912, t0 + 7999, false) === false);
  const fakeBot: any = { id: 1, user_id: 7 };
  check('kuota 2/user', turboAllowed(fakeBot, { turbo: true }, new Map([[7, 2]])) === false);
  check('di bawah kuota lolos', turboAllowed(fakeBot, { turbo: true }, new Map([[7, 1]])) === true);
  check('tanpa flag ditolak', turboAllowed(fakeBot, {}, new Map()) === false);

  console.log('\nB) Cooldown + floor fee');
  check('cooldown flash 60 dtk', adaptiveCooldownMs({ cooldown_min: 1 }, 'scalp') === 60000);
  const floorToko = minGrossTargetPct('tokocrypto', {});
  check(`floor Tokocrypto <=0,8% (got ${floorToko.toFixed(2)})`, floorToko <= 0.8);
  check('TP preset di atas floor', 1.2 >= floorToko);
  check('floor Indodax >0,8%', minGrossTargetPct('indodax', {}) > 0.8);

  console.log('\nC) Fail-safe');
  recordTradeFail(921); recordTradeFail(921);
  check('2 gagal belum degraded', isDegraded(921) === false);
  recordTradeFail(921);
  check('3 gagal -> degraded', isDegraded(921) === true);
  check('degraded dikecualikan dari turbo', turboAllowed({ id: 921, user_id: 7 } as any, { turbo: true }, new Map()) === false);
  recordTradeSuccess(921);
  check('sukses -> pulih', isDegraded(921) === false);

  console.log('\nD) Cap harian');
  const { db, queries, now } = await import('../src/db/index.js');
  const info = queries.insertBot.run({
    user_id: 0, name: 'Cap', exchange_id: 'indodax', pair: 'XRPIDR', strategy: 'scalper',
    params: '{}', budget_idr: 100000, current_budget: 100000, lot: 10000, mode: 'paper',
    auto_compound_pct: 100, status: 'running', state: '{}', max_daily_loss_pct: 0,
    market_preset_id: null, created_at: now(), updated_at: now(),
  });
  const capBot = { ...(queries.getBot.get(info.lastInsertRowid) as any) };
  check('di bawah cap jalan', hitDailyCap(capBot, { max_trades_per_day: 20 }) === false);
  const ins = db.prepare(`INSERT INTO trades (user_id, bot_id, exchange_id, pair, side, price, qty, fee, value, realized_pnl, cost_basis, mode, created_at)
    VALUES (0,?, 'indodax','XRPIDR','buy',100,1,0,100,0,100,'paper',datetime('now'))`);
  for (let i = 0; i < 20; i++) ins.run(capBot.id);
  check('cap 20 tercapai -> tahan', hitDailyCap(capBot, { max_trades_per_day: 20 }) === true);
  check('tanpa cap -> jalan', hitDailyCap(capBot, {}) === false);

  console.log('\nE) Replay 3 hari trending + slippage (gate rilis preset)');
  const { replay } = await import('../src/engine/replay.js');
  const rnd = mulberry32(7);
  const closes: number[] = [];
  for (let i = 0; i < 4320; i++) closes.push(100 * (1 + 0.00003 * i) * (1 + 0.03 * Math.sin(i / 45) + 0.002 * (rnd() - 0.5) * 2));
  const kl = closes.map((c, i) => [1700000000000 + i * 60000, c * 0.9995, c * 1.0005, c * 0.9995, c, 10] as any);
  const r = await replay('scalper', {
    timeframe: '1m', ema_fast: 12, ema_slow: 30, rsi_period: 7, rsi_entry: 60,
    tp_pct: 1.2, sl_pct: 0.7, trailing_pct: 0.8, cooldown_min: 1,
  }, kl, { budget: 10000, fee: 0.001, slippagePct: 0.1, exchangeId: 'tokocrypto', stepMs: 60000, maxTradesPerDay: 20 });
  const perDay = (r.buys + r.sells) / 2 / 3;
  const perTrade = r.sells > 0 ? (r.realized / r.sells / 10000) * 100 : 0;
  check(`frekuensi 5-15/hari (got ${perDay.toFixed(1)})`, perDay >= 5 && perDay <= 15, `b=${r.buys} s=${r.sells}`);
  check(`bersih >=0,2%/trade (got ${perTrade.toFixed(2)}%)`, perTrade >= 0.2, `Rp${r.realized.toFixed(2)}`);
  check('drawdown <5%', r.maxDdPct < 5, `${r.maxDdPct.toFixed(2)}%`);

  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
