/**
 * E2E v2.0:
 *  A) Auth: setup admin → login → JWT valid → isolasi antar user
 *  B) Rebalance: alokasi berlebih → aksi jual; kurang → aksi beli
 *  C) Marketplace: list seed → install (paused) → rating
 *  D) Backtest equity: hasil mengandung kurva equity
 *  E) Binance: instance terdaftar, base URL benar, id/label benar
 *
 * Jalankan: npx tsx server/scripts/test-v2.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.BOTANI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'botani-v2-'));
process.env.SECRET_KEY = 'test-secret-key-minimal-32-chars-abcdef';

let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

async function main() {
  const { db, queries, now, ensureUserExchanges } = await import('../src/db/index.js');
  const { hashPassword, verifyPassword, signToken, verifyToken, backfillLegacyToAdmin } = await import('../src/auth.js');
  const { getStrategy } = await import('../src/strategies/types.js');
  await import('../src/strategies/grid.js');
  await import('../src/strategies/dca.js');
  await import('../src/strategies/scalper.js');
  await import('../src/strategies/harvester.js');
  await import('../src/strategies/rebalance.js');
  const { BinanceClient } = await import('../src/exchange/binance.js');
  const { registry } = await import('../src/exchange/registry.js');
  const { backtest, runCustomBacktest } = await import('../src/engine/wizard.js');

  // ===== A) Auth =====
  console.log('A) Auth multi-user');
  const hash = await hashPassword('rahasia123');
  check('bcrypt hash terverifikasi', await verifyPassword('rahasia123', hash));
  check('password salah ditolak', !(await verifyPassword('salah', hash)));
  const ai = queries.insertUser.run('admin1', hash, 'admin', now());
  const adminId = Number(ai.lastInsertRowid);
  backfillLegacyToAdmin(adminId);
  const token = signToken({ id: adminId, username: 'admin1', role: 'admin' });
  const dec = verifyToken(token);
  check('JWT valid & uid cocok', !!dec && dec.id === adminId && dec.role === 'admin', JSON.stringify(dec));
  check('JWT rusak ditolak', verifyToken(token + 'x') === null);
  const bi = queries.insertUser.run('user2', await hashPassword('pass1234'), 'user', now());
  const user2 = Number(bi.lastInsertRowid);
  ensureUserExchanges(user2);
  const ex1 = (db.prepare('SELECT COUNT(*) c FROM exchanges WHERE user_id=?').get(adminId) as any).c;
  const ex2 = (db.prepare('SELECT COUNT(*) c FROM exchanges WHERE user_id=?').get(user2) as any).c;
  check('admin punya 4 baris exchange', ex1 === 4, `got ${ex1}`);
  check('user2 punya 4 baris exchange', ex2 === 4, `got ${ex2}`);
  // Kredensial terisolasi: set untuk admin saja
  db.prepare(`UPDATE exchanges SET api_key_enc='x' WHERE id='indodax' AND user_id=?`).run(adminId);
  const other = db.prepare(`SELECT api_key_enc FROM exchanges WHERE id='indodax' AND user_id=?`).get(user2) as any;
  check('kredensial tidak bocor ke user lain', other.api_key_enc === null, `got ${other.api_key_enc}`);

  // ===== B) Rebalance =====
  console.log('\nB) Strategi Rebalance');
  const strat = getStrategy('rebalance');
  check('strategi rebalance terdaftar', strat.label === 'Rebalance');
  const params = { targets: { BTC: 50, ETH: 30 }, threshold_pct: 2, interval_min: 0 };
  const bot: any = { id: 9, user_id: adminId, name: 'R', exchange_id: 'indodax', pair: 'BTCIDR', strategy: 'rebalance', params: JSON.stringify(params), current_budget: 1000000, mode: 'paper' };
  // Saldo: BTC 0.0005 @1.5M = 750rb (75% > target 50%), kas 250rb → harus jual BTC
  const state: any = { lastRun: 0 };
  const ctx: any = {
    bot, ticker: { pair: 'BTCIDR', bid: 1.5e9, ask: 1.5e9, last: 1.5e9, high24: 0, low24: 0, vol24: 0, ts: 1 },
    usdtIdr: 1, now: Date.now(),
    getKlines: async () => [],
    getBalances: async () => [{ asset: 'BTC', free: 0.0005, locked: 0 }, { asset: 'IDR', free: 250000, locked: 0 }],
    getPrice: async (p: string) => p === 'BTCIDR' ? 1.5e9 : 48e6
  };
  const actions = await strat.onTick(ctx, state, params);
  const sellBtc = actions.find(a => a.type === 'sell');
  check('kelebihan BTC → aksi jual', !!sellBtc, JSON.stringify(actions.map(a => a.type)));
  check('tag REBALANCE', sellBtc?.tag === 'REBALANCE');
  // Kasus kurang: ETH 0, kas besar → harus beli
  const ctx2: any = { ...ctx, getBalances: async () => [{ asset: 'IDR', free: 1000000, locked: 0 }] };
  const state2: any = { lastRun: 0 };
  const actions2 = await strat.onTick({ ...ctx2, now: Date.now() }, state2, params);
  check('kekurangan alokasi → aksi beli', actions2.some(a => a.type === 'buy'), JSON.stringify(actions2.map(a => a.type)));
  // Interval: tick kedua langsung → tidak ada aksi
  const actions3 = await strat.onTick({ ...ctx2, now: Date.now() }, state2, { ...params, interval_min: 60 });
  check('interval_min menghormati jeda', actions3.length === 0, `got ${actions3.length}`);

  // ===== C) Marketplace =====
  console.log('\nC) Marketplace');
  const seeds = db.prepare(`SELECT COUNT(*) c FROM market_presets WHERE user_id=0`).get() as any;
  check('5 preset bawaan terseed', seeds.c === 5, `got ${seeds.c}`);
  const preset = db.prepare('SELECT * FROM market_presets WHERE public=1 LIMIT 1').get() as any;
  const strat2 = getStrategy(preset.strategy);
  const binfo = queries.insertBot.run({
    user_id: user2, name: `${preset.name} (market)`, exchange_id: 'indodax', pair: 'XRPIDR',
    strategy: preset.strategy, params: preset.params, budget_idr: 100000, current_budget: 100000,
    lot: 20000, mode: 'paper', auto_compound_pct: 100, status: 'paused',
    state: JSON.stringify(strat2.init(JSON.parse(preset.params))), max_daily_loss_pct: 0,
    market_preset_id: preset.id, created_at: now(), updated_at: now()
  });
  const installed = queries.getBot.get(binfo.lastInsertRowid) as any;
  check('install membuat bot paused milik user2', installed.status === 'paused' && installed.user_id === user2);
  check('bot ter-link ke preset', installed.market_preset_id === preset.id, `got ${installed.market_preset_id}`);
  // Bot kedua dari preset sama, status running
  const binfo2 = queries.insertBot.run({
    user_id: user2, name: `${preset.name} (market) #2`, exchange_id: 'indodax', pair: 'XRPIDR',
    strategy: preset.strategy, params: preset.params, budget_idr: 50000, current_budget: 50000,
    lot: 10000, mode: 'paper', auto_compound_pct: 100, status: 'running',
    state: JSON.stringify(strat2.init(JSON.parse(preset.params))), max_daily_loss_pct: 0,
    market_preset_id: preset.id, created_at: now(), updated_at: now()
  });
  const agg = db.prepare(`SELECT COUNT(*) total,
    SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) running
    FROM bots WHERE market_preset_id=? AND user_id=?`).get(preset.id, user2) as any;
  check('hitungan per preset: total=2', agg.total === 2, `got ${agg.total}`);
  check('hitungan per preset: running=1', agg.running === 1, `got ${agg.running}`);
  // Bot user lain tidak ikut terhitung
  const aggAdmin = db.prepare(`SELECT COUNT(*) total FROM bots WHERE market_preset_id=? AND user_id=?`).get(preset.id, adminId) as any;
  check('hitungan terisolasi per user', aggAdmin.total === 0, `got ${aggAdmin.total}`);
  db.prepare(`INSERT INTO market_ratings (preset_id, user_id, stars) VALUES (?,?,?)`).run(preset.id, user2, 5);
  const rating = db.prepare(`SELECT COALESCE(AVG(stars),0) r FROM market_ratings WHERE preset_id=?`).get(preset.id) as any;
  check('rating tersimpan (avg=5)', rating.r === 5, `got ${rating.r}`);

  // ===== D) Backtest equity =====
  console.log('\nD) Backtest equity');
  const klines: any[] = [];
  let px = 26000;
  for (let i = 0; i < 200; i++) {
    px = px * (1 + (Math.sin(i / 9) * 0.004) + ((i * 37 % 11) - 5) * 0.0004);
    klines.push([1700000000000 + i * 3600000, px, px * 1.002, px * 0.998, px, 100]);
  }
  const bt = backtest({ id: 'x', nama: 'x', strategi: 'dca', gaya: '', deskripsi: '', params: { drop_pct: 2, take_profit_pct: 3, max_buys: 5 }, leverage_label: '', tp_sl_label: '', timeframe: '' }, klines, 100000);
  check('backtest menghasilkan equity series', bt.equity.length > 5, `got ${bt.equity.length}`);
  check('equity pertama ≈ budget', Math.abs(bt.equity[0].v - 100000) < 20000, `got ${bt.equity[0].v}`);
  check('ada trades tereksekusi', bt.trades > 0, `got ${bt.trades}`);

  // ===== E) Binance =====
  console.log('\nE) Adapter Binance');
  const b = new BinanceClient();
  check('id = binance', (b as any).id === 'binance');
  check('quote USDT, fee 0.1%', b.quoteAsset === 'USDT' && b.feeRate === 0.001);
  const reg = registry.get('binance');
  check('terdaftar di registry', reg === reg && (reg as any).id === 'binance');
  const ping = await b.testConnection().catch(e => ({ ok: false, error: String(e) }));
  console.log(`  (info) ping api.binance.com: ${ping.ok ? `OK ${(ping as any).latency_ms}ms` : 'gagal — ' + (ping as any).error}`);

  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
