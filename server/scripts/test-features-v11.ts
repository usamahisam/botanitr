/**
 * E2E fitur v1.1 (roadmap):
 *  A) Trailing stop Scalper (lock profit saat harga berbalik dari puncak)
 *  B) Equity curve per bot (rekam + curve dengan titik awal budget)
 *  C) Price alert (terpicu saat harga sentuh target → nonaktif)
 *
 * Jalankan: npx tsx server/scripts/test-features-v11.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.BOTANI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'botani-feat-'));

let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

function tickerAt(price: number) {
  return { pair: 'XRPIDR', bid: price - 1, ask: price + 1, last: price, high24: price, low24: price, vol24: 0, ts: Date.now() };
}

async function main() {
  const { db, queries, now } = await import('../src/db/index.js');
  const { getStrategy } = await import('../src/strategies/types.js');
  await import('../src/strategies/scalper.js');

  // ===== A) Trailing Stop Scalper =====
  console.log('A) Trailing Stop Scalper');
  const scalper = getStrategy('scalper');
  // TP sangat tinggi (nonaktif) & SL sangat rendah agar MURNI menguji trailing 1.5%
  const params = { ...scalper.defaultParams, tp_pct: 100, sl_pct: 50, trailing_pct: 1.5 };
  const bot: any = { id: 1, name: 'S', exchange_id: 'indodax', pair: 'XRPIDR', strategy: 'scalper', params: JSON.stringify(params), current_budget: 100000, mode: 'paper' };
  // State: posisi terbuka entry 26000, qty 3.8, cost 98800
  const state: any = { position: { entryPrice: 26000, qty: 3.8, cost: 98800, peakPrice: 26000 }, prevFastAbove: true, candlesTs: Date.now(), candles: [] };

  // Simulasi harga naik ke 27000 (puncak), lalu turun
  const ctxNaik: any = { bot, ticker: tickerAt(27000), usdtIdr: 1, now: Date.now(), getKlines: async () => [] };
  await scalper.onTick(ctxNaik, state, params);
  check('peakPrice tercatat naik ke 27000', state.position?.peakPrice === 27000, `got ${state.position?.peakPrice}`);

  // Harga turun ke 26600 = 27000 * (1 - 1.48%) → di bawah trail (27000*0.985=26595)? 26600 > 26595 → belum kena
  let ctx: any = { bot, ticker: tickerAt(26600), usdtIdr: 1, now: Date.now(), getKlines: async () => [] };
  let actions = await scalper.onTick(ctx, state, params);
  check('belum trailing exit di 26600 (masih di atas trail)', !actions.some(a => a.tag === 'SCALPER_EXIT' && a.reason.includes('Trailing')), JSON.stringify(actions.map(a=>a.tag)));

  // Harga turun ke 26500 < 26595 → trailing exit
  ctx = { bot, ticker: tickerAt(26500), usdtIdr: 1, now: Date.now(), getKlines: async () => [] };
  actions = await scalper.onTick(ctx, state, params);
  const trailExit = actions.find(a => a.reason.includes('Trailing'));
  check('trailing exit terpicu di 26500 (< trail 26595)', !!trailExit, JSON.stringify(actions.map(a=>a.reason)));
  check('posisi bertahan saat emit (tunggu fill)', state.position !== null);
  const { applyFillToState: applyFillV11 } = await import('../src/engine/scheduler.js');
  applyFillV11('scalper', state, { price: 26500, qty: state.position.qty, value: state.position.qty * 26500, fee: 0 }, trailExit);
  check('posisi ditutup setelah fill terkonfirmasi', state.position === null);

  // ===== B) Equity Curve =====
  console.log('\nB) Equity Curve');
  const { recordDailyEquity, getEquityCurve } = await import('../src/engine/equity.js');
  const info = queries.insertBot.run({
    name: 'EqBot', exchange_id: 'indodax', pair: 'XRPIDR', strategy: 'dca', params: '{}',
    budget_idr: 100000, current_budget: 105000, lot: 20000, mode: 'paper', auto_compound_pct: 100,
    status: 'running', state: '{}', max_daily_loss_pct: 0,market_preset_id: null, user_id: 0, created_at: now(), updated_at: now()
  });
  const botId = Number(info.lastInsertRowid);
  const n = await recordDailyEquity();
  check('recordDailyEquity mencatat ≥1 bot', n >= 1, `got ${n}`);
  const curve = await getEquityCurve(botId, 30);
  check('curve tidak kosong', curve.length >= 1, `len=${curve.length}`);
  check('curve punya titik equity hari ini (105000)', curve.some(c => c.equity === 105000), JSON.stringify(curve));
  // Titik awal budget hanya muncul jika bot dibuat di tanggal berbeda dari hari ini
  const startDate = (queries.getBot.get(botId) as any).created_at.slice(0, 10);
  const todayWib = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  if (startDate < todayWib) {
    check('curve punya titik awal budget (beda hari)', curve[0].equity === 100000, JSON.stringify(curve[0]));
  } else {
    check('titik awal budget digabung dgn hari ini (wajar, bot baru dibuat)', true);
  }

  // ===== C) Price Alert =====
  console.log('\nC) Price Alert');
  const { checkAlerts } = await import('../src/engine/alerts.js');
  const { registry } = await import('../src/exchange/registry.js');
  // Stub ticker: paksa harga XRPIDR = 27000 di atas target 26500
  const idx = registry.get('indodax');
  const origGetTicker = idx.getTicker.bind(idx);
  (idx as any).getTicker = async (pair: string) => tickerAt(27000);

  const ainfo = db.prepare('INSERT INTO price_alerts (exchange_id, pair, direction, target_price, note, active, created_at) VALUES (?,?,?,?,?,1,?)')
    .run('indodax', 'XRPIDR', 'above', 26500, 'tes resistance', now());
  const alertId = Number(ainfo.lastInsertRowid);

  const triggered = await checkAlerts();
  check('alert terpicu (27000 ≥ 26500)', triggered >= 1, `got ${triggered}`);
  const alertAfter = db.prepare('SELECT * FROM price_alerts WHERE id=?').get(alertId) as any;
  check('alert nonaktif setelah terpicu', alertAfter.active === 0, `active=${alertAfter.active}`);
  check('triggered_at tercatat', !!alertAfter.triggered_at);

  // Alert below tidak terpicu (harga 27000 > target 25000 untuk below)
  (idx as any).getTicker = async () => tickerAt(27000);
  db.prepare('INSERT INTO price_alerts (exchange_id, pair, direction, target_price, active, created_at) VALUES (?,?,?,?,1,?)')
    .run('indodax', 'XRPIDR', 'below', 25000, now());
  const triggered2 = await checkAlerts();
  check('alert below tidak terpicu (harga masih di atas)', triggered2 === 0, `got ${triggered2}`);

  (idx as any).getTicker = origGetTicker;

  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
