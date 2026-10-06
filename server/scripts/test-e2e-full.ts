/**
 * Audit E2E MASIF: jelajahi SEMUA endpoint API seperti user sungguhan —
 * auth, dashboard, bots CRUD, trades, logs, alerts, marketplace, wizard,
 * demo purge, killswitch, settings, quick-trade.
 * Endpoint butuh jaringan boleh 400 selama berpesan jelas (tak boleh 500/crash).
 *
 * Jalankan: npx tsx server/scripts/test-e2e-full.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.BOTANI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'botani-e2e-'));
process.env.SECRET_KEY = 'test-secret-key-minimal-32-chars-abcdef';

let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

async function main() {
  const express = (await import('express')).default;
  const { authRouter } = await import('../src/routes/auth.js');
  const { requireAuth } = await import('../src/auth.js');
  const { api } = await import('../src/routes/api.js');
  await import('../src/db/index.js');

  const app = express();
  app.use(express.json());
  app.use('/api', authRouter);
  app.use('/api', requireAuth, api);
  const server = await new Promise<any>(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const rq = async (m: string, p: string, body?: any, token?: string) => {
    const res = await fetch(base + p, {
      method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const text = await res.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch { data = { _raw: text.slice(0, 80) }; }
    return { status: res.status, data };
  };
  const no500 = (r: any) => r.status !== 500;
  const get = (p: string, t?: string) => rq('GET', p, undefined, t);
  const post = (p: string, b: any, t?: string) => rq('POST', p, b, t);
  const del = (p: string, t?: string) => rq('DELETE', p, undefined, t);

  // ===== 0) Auth =====
  console.log('0) Auth');
  let r = await post('/auth/setup', { username: 'admin', password: 'admin123' });
  check('setup 201', r.status === 201, `got ${r.status}`);
  r = await post('/auth/login', { username: 'admin', password: 'admin123' });
  check('login 200 + token', r.status === 200 && !!r.data.token, `got ${r.status}`);
  const T = r.data.token;
  r = await get('/dashboard');
  check('tanpa token → 401', r.status === 401, `got ${r.status}`);

  // ===== 1) Dashboard & saldo =====
  console.log('\n1) Dashboard & saldo');
  r = await get('/dashboard', T);
  check('dashboard 200 + portfolio', r.status === 200 && !!r.data.portfolio, `got ${r.status}`);
  r = await get('/balances/check', T);
  check('balances/check 200 array', r.status === 200 && Array.isArray(r.data), `got ${r.status}`);
  r = await get('/exchanges', T);
  check('exchanges 200 + 4 row', r.status === 200 && r.data.length >= 4, `got ${r.status} len=${r.data?.length}`);
  r = await get('/pairs?exchange=indodax', T);
  check('pairs indodax > 0', r.status === 200 && r.data.length > 0, `got ${r.status}`);
  r = await get('/exchanges/indodax/max-spendable?mode=paper', T);
  check('max-spendable paper 200', r.status === 200 && r.data.free === 10000000, JSON.stringify(r.data));

  // ===== 2) Bots CRUD =====
  console.log('\n2) Bots CRUD');
  r = await post('/bots', { name: 'E2E Grid', exchange_id: 'indodax', pair: 'XRPIDR', strategy: 'grid', params: {}, budget_idr: 100000, mode: 'paper' }, T);
  check('buat bot paper 201', r.status === 201 && !!r.data.id, `got ${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
  const botId = r.data.id;
  const { db: dbEq } = await import('../src/db/index.js');
  const eqRows = (dbEq.prepare('SELECT COUNT(*) c FROM bot_equity WHERE bot_id=?').get(botId) as any).c;
  check('titik equity awal terekam saat bot dibuat', eqRows >= 1, `got ${eqRows}`);
  r = await post('/bots', { name: 'X', exchange_id: 'indodax', pair: 'XRPIDR', strategy: 'ngawur', params: {}, budget_idr: 1000, mode: 'paper' }, T);
  check('strategi asing → 400', r.status === 400, `got ${r.status}`);
  r = await post('/bots', { name: ' Sultan', exchange_id: 'indodax', pair: 'XRPIDR', strategy: 'grid', params: {}, budget_idr: 999999999999, mode: 'paper' }, T);
  check('budget > kas demo → 400 + saran', r.status === 400 && /demo|kas/i.test(r.data.error || ''), `got ${r.status}`);
  r = await get('/bots', T);
  check('list bots ada 1', r.status === 200 && r.data.length === 1, `got ${r.status} len=${r.data?.length}`);
  check('bot bawa cash_quote = budget', r.data[0]?.cash_quote === 100000 && r.data[0]?.open_cost_quote === 0, JSON.stringify({ cash: r.data[0]?.cash_quote, open: r.data[0]?.open_cost_quote }));
  r = await post(`/bots/${botId}/pause`, {}, T);
  check('pause 200', r.status === 200, `got ${r.status}`);
  r = await post(`/bots/${botId}/resume`, {}, T);
  check('resume 200', r.status === 200, `got ${r.status}`);
  r = await get(`/bots/${botId}/equity?days=30`, T);
  check('equity 200 array', r.status === 200 && Array.isArray(r.data), `got ${r.status}`);
  r = await get(`/bots/${botId}/trend`, T);
  check('trend tak 500', no500(r), `got ${r.status}`);

  // ===== 3) Trades & logs =====
  console.log('\n3) Trades & logs');
  r = await get('/trades?limit=10', T);
  check('trades 200', r.status === 200 && Array.isArray(r.data?.rows), `got ${r.status}`);
  r = await get('/trades/export', T);
  check('export CSV 200', r.status === 200, `got ${r.status}`);
  r = await get('/logs?limit=10', T);
  check('logs 200 array', r.status === 200 && Array.isArray(r.data), `got ${r.status}`);

  // ===== 4) Alerts =====
  console.log('\n4) Alerts');
  r = await post('/alerts', { exchange_id: 'ngawur', pair: 'XRPIDR', direction: 'above', target_price: 100 }, T);
  check('alert exchange asing → 400', r.status === 400, `got ${r.status}`);
  r = await post('/alerts', { exchange_id: 'indodax', pair: 'XRPIDR', direction: 'above', target_price: 20000, note: 'e2e' }, T);
  check('buat alert 201', r.status === 201 && !!r.data.id, `got ${r.status}`);
  const alertId = r.data.id;
  r = await get('/alerts', T);
  check('list alerts ada 1', r.status === 200 && r.data.length === 1, `got ${r.status}`);
  r = await del(`/alerts/${alertId}`, T);
  check('hapus alert 200', r.status === 200, `got ${r.status}`);

  // ===== 5) Marketplace =====
  console.log('\n5) Marketplace');
  r = await get('/marketplace', T);
  const sysCount = r.data?.length ?? 0;
  check(`marketplace 11 preset sistem (got ${sysCount})`, r.status === 200 && sysCount === 11, `got ${r.status}`);
  const dynPreset = (r.data || []).find((p: any) => p.strategy === 'dynamic');
  check('preset dynamic ada', !!dynPreset);
  r = await post('/marketplace', { name: 'E2E Preset', strategy: 'revert', params: {}, budget_quote: 50000 }, T);
  check('buat preset user 201', r.status === 201 && !!r.data.id, `got ${r.status}`);
  const myPreset = r.data.id;
  r = await post(`/marketplace/${myPreset}/install`, { exchange_id: 'indodax', pair: 'DOGEIDR', status: 'paused' }, T);
  check('install preset → bot paused 201', r.status === 201, `got ${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);
  r = await post(`/marketplace/${myPreset}/install`, { exchange_id: 'indodax', pair: 'BTCIDR', budget_quote: 999999999999 }, T);
  check('install budget > kas → 400', r.status === 400, `got ${r.status}`);
  r = await post(`/marketplace/${myPreset}/rate`, { stars: 5 }, T);
  check('rate 200', r.status === 200, `got ${r.status}`);
  // Anti double-count: 1 bot wizard (tanpa link) strategi scalper hanya
  // terhitung di 1 preset + stopped tak dihitung di mana pun.
  const wiz = await post('/bots', { name: 'E2E Scalp', exchange_id: 'indodax', pair: 'XRPIDR', strategy: 'scalper', params: {}, budget_idr: 50000, mode: 'paper' }, T);
  r = await get('/marketplace', T);
  const scalpRows = (r.data || []).filter((p: any) => p.strategy === 'scalper');
  const scalpRunning = scalpRows.reduce((s: number, p: any) => s + (p.bots_running || 0), 0);
  check('bot tanpa link terhitung tepat 1x', scalpRunning === 1, JSON.stringify(scalpRows.map((p: any) => [p.name, p.bots_running])));
  await post(`/bots/${wiz.data.id}/pause`, {}, T);
  await post(`/bots/${wiz.data.id}/stop`, { liquidate: false }, T);
  r = await get('/marketplace', T);
  const scalpTotal = (r.data || []).filter((p: any) => p.strategy === 'scalper').reduce((s: number, p: any) => s + (p.bots_total || 0), 0);
  check('bot stopped tak dihitung', scalpTotal === 0, `got ${scalpTotal}`);
  await del(`/bots/${wiz.data.id}`, T);
  r = await del(`/marketplace/${myPreset}`, T);
  check('hapus preset user 200', r.status === 200, `got ${r.status}`);

  // ===== 6) Wizard & backtest (boleh 400 offline, tak boleh 500) =====
  console.log('\n6) Wizard & backtest');
  r = await get('/wizard/presets?exchange=indodax&pair=XRPIDR&budget=100000', T);
  check('presets tak 500', no500(r), `got ${r.status}`);
  if (r.status === 200) check(`presets 10 (got ${r.data?.length})`, r.data?.length === 10);
  r = await post('/wizard/backtest', { exchange_id: 'indodax', pair: 'XRPIDR', preset_id: 'grid-sideways' }, T);
  check('backtest preset tak 500', no500(r), `got ${r.status}`);
  r = await post('/backtest', { exchange_id: 'indodax', pair: 'XRPIDR', strategy: 'grid', params: {}, days: 7, budget: 100000 }, T);
  check('backtest custom tak 500', no500(r), `got ${r.status}`);

  // ===== 7) Demo purge (kasus user: bot dihapus tapi riwayat menggantung) =====
  console.log('\n7) Demo purge');
  const { db } = await import('../src/db/index.js');
  db.prepare(`INSERT INTO trades (user_id, bot_id, exchange_id, pair, side, price, qty, fee, value, realized_pnl, cost_basis, mode, created_at)
    VALUES (1, 999999, 'indodax','XRPIDR','buy',100,1,0,100,0,100,'paper',datetime('now'))`).run();
  r = await post('/demo/purge', {}, T);
  check('purge 200 + ringkasan', r.status === 200 && r.data.ok && typeof r.data.trades === 'number', `got ${r.status} ${JSON.stringify(r.data)}`);
  r = await get('/trades?limit=50', T);
  check('trades paper bersih', r.status === 200 && (r.data.rows || []).filter((t: any) => t.mode === 'paper').length === 0, `got ${(r.data.rows || []).length} baris`);

  // ===== 8) Hapus bot paper ikut hapus riwayatnya =====
  console.log('\n8) Hapus bot paper cascade');
  const b2 = await post('/bots', { name: 'E2E Hapus', exchange_id: 'indodax', pair: 'XRPIDR', strategy: 'dca', params: {}, budget_idr: 50000, mode: 'paper' }, T);
  db.prepare(`INSERT INTO trades (user_id, bot_id, exchange_id, pair, side, price, qty, fee, value, realized_pnl, cost_basis, mode, created_at)
    VALUES (1, ?, 'indodax','XRPIDR','buy',100,1,0,100,0,100,'paper',datetime('now'))`).run(b2.data.id);
  r = await del(`/bots/${b2.data.id}`, T);
  check('hapus saat running -> 400 terkunci', r.status === 400, `got ${r.status}`);
  await post(`/bots/${b2.data.id}/pause`, {}, T);
  r = await del(`/bots/${b2.data.id}`, T);
  const left = (db.prepare('SELECT COUNT(*) c FROM trades WHERE bot_id=?').get(b2.data.id) as any).c;
  check('setelah pause: bot + trades ikut terhapus', r.status === 200 && left === 0, `got ${r.status} sisa=${left}`);
  r = await del(`/bots/${botId}`, T);
  check('bot e2e sudah bersih oleh purge → 404', r.status === 404, `got ${r.status}`);

  // ===== 9) Killswitch, settings, telegram, market (tak boleh 500) =====
  console.log('\n9) Lainnya');
  r = await post('/killswitch', {}, T);
  check('killswitch 200', r.status === 200 && typeof r.data.bots_paused === 'number', `got ${r.status}`);
  r = await get('/settings', T);
  check('settings 200', r.status === 200, `got ${r.status}`);
  r = await post('/telegram/test', {}, T);
  check('telegram/test tak 500', no500(r), `got ${r.status}`);
  r = await get('/market', T);
  check('market tak 500', no500(r), `got ${r.status}`);
  r = await post('/trade/quick', { exchange_id: 'indodax', pair: 'XRPIDR', side: 'buy', amount: 10000, mode: 'paper' }, T);
  check('quick-trade paper tak 500', no500(r), `got ${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);
  r = await post('/exchanges/indodax/paper-reset', {}, T);
  check('paper-reset 200', r.status === 200 && r.data.ok, `got ${r.status}`);

  server.close();
  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
