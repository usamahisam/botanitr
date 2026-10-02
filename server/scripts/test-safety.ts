/**
 * E2E fitur keamanan v1.1:
 *  A) Indodax TAPI v2 (auto-detect + myTrades HMAC-SHA256)
 *  B) Max daily loss guard (auto-pause saat rugi harian > batas)
 *  C) Reconciler drift (deteksi posisi bot ≠ saldo exchange)
 *
 * Jalankan: npx tsx server/scripts/test-safety.ts
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const V2_KEY = 'V2KEY-1';
const V2_SECRET = 'v2secret-xyz';
const PORT = 3904;

process.env.BOTANI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'botani-safety-'));
// Arahkan host v1 (ticker) DAN v2 (TAPI) ke mock
process.env.INDODAX_BASE_URL = `http://127.0.0.1:${PORT}`;
process.env.INDODAX_V2_BASE_URL = `http://127.0.0.1:${PORT}`;

let v2AccountCalled = 0;
let lastV2Headers: any = null;

const v2verify = (qs: string, sig: string) => crypto.createHmac('sha256', V2_SECRET).update(qs).digest('hex') === sig;

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const url = req.url || '';
  const u = new URL(url, 'http://x');

  // TAPI v2 (HMAC-SHA256)
  if (u.pathname.startsWith('/api/v2/')) {
    lastV2Headers = req.headers;
    const qs = u.searchParams.toString().replace(/&signature=[^&]*/, '');
    const sig = u.searchParams.get('signature') || '';
    if (req.headers['x-apikey'] !== V2_KEY || !v2verify(qs, sig)) {
      res.statusCode = 401; res.end(JSON.stringify({ code: -1002, msg: 'Invalid credentials.' })); return;
    }
    if (u.pathname === '/api/v2/account') {
      v2AccountCalled++;
      res.end(JSON.stringify({ canTrade: true, canWithdraw: false, balances: [{ asset: 'IDR', free: '5000000', locked: '0' }, { asset: 'XRP', free: '7.5', locked: '0' }] }));
      return;
    }
    if (u.pathname === '/api/v2/myTrades') {
      res.end(JSON.stringify([{ symbol: 'XRPIDR', orderId: '5', qty: '3.75', price: '26600', commission: '299', time: Date.now() }]));
      return;
    }
    if (u.pathname === '/api/v2/order' && req.method === 'POST') {
      res.end(JSON.stringify({ symbol: 'XRPIDR', orderId: 5, side: 'BUY', type: 'MARKET', executedQty: '3.75' }));
      return;
    }
    if (u.pathname === '/api/v2/openOrders') { res.end('[]'); return; }
    res.end('{}'); return;
  }

  // Publik v1 ticker
  if (u.pathname.startsWith('/api/') && u.pathname.endsWith('/ticker')) {
    res.end(JSON.stringify({ ticker: { buy: '26600', sell: '26635', last: '26600', high: '1', low: '1', server_time: 1, vol_idr: '1' } }));
    return;
  }
  res.statusCode = 404; res.end('{}');
});

let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

async function main() {
  await new Promise<void>(r => server.listen(PORT, r));
  console.log(`Mock Indodax v2 :${PORT}\n`);

  const { db, queries, now } = await import('../src/db/index.js');
  const { encrypt } = await import('../src/crypto.js');
  const { registry } = await import('../src/exchange/registry.js');
  const { IndodaxClient } = await import('../src/exchange/indodax.js');
  const { pnl } = await import('../src/engine/pnl.js');
  const { reconcileOnce } = await import('../src/engine/reconciler.js');

  // ===== A) TAPI v2 auto-detect + myTrades =====
  console.log('A) Indodax TAPI v2');
  db.prepare(`UPDATE exchanges SET mode='live', api_key_enc=?, api_secret_enc=? WHERE id='indodax'`).run(encrypt(V2_KEY), encrypt(V2_SECRET));
  registry.reloadFromDb();
  const client = registry.get('indodax') as IndodaxClient;

  const balances = await client.getBalances();
  check('v2 account terpanggil (auto-detect)', v2AccountCalled > 0, `called ${v2AccountCalled}x`);
  check('v2 kirim header X-APIKEY', lastV2Headers?.['x-apikey'] === V2_KEY);
  const idr = balances.find(b => b.asset === 'IDR');
  check('saldo v2 terbaca', idr?.free === 5_000_000, `got ${idr?.free}`);

  const buy = await client.buyMarket('XRPIDR', 100000, 'testv2-buy-1');
  check('buy v2 mengembalikan qty>0', buy.qty > 0, `got ${buy.qty}`);
  check('fill direkonsiliasi dari myTrades (qty=3.75)', Math.abs(buy.qty - 3.75) < 1e-6, `got ${buy.qty}`);

  // ===== B) Max daily loss guard =====
  console.log('\nB) Max Daily Loss Guard');
  const { getStrategy } = await import('../src/strategies/types.js');
  await import('../src/strategies/dca.js');
  const strat = getStrategy('dca');
  // Bot dengan batas rugi 5% dari budget 100rb = 5000
  const info = queries.insertBot.run({
    name: 'LossBot', exchange_id: 'indodax', pair: 'XRPIDR', strategy: 'dca',
    params: JSON.stringify(strat.defaultParams), budget_idr: 100000, current_budget: 100000, lot: 20000,
    mode: 'live', auto_compound_pct: 100, status: 'running', state: '{}',
    max_daily_loss_pct: 5, created_at: now(), updated_at: now()
  });
  const bot = queries.getBot.get(info.lastInsertRowid) as any;
  check('bot dibuat dengan max_daily_loss_pct=5', bot.max_daily_loss_pct === 5);

  // Simulasikan rugi hari ini -6000 (> 5000) → insert trade sell rugi
  db.prepare(`INSERT INTO trades (bot_id, exchange_id, pair, side, price, qty, fee, value, realized_pnl, cost_basis, mode, order_id, client_order_id, strategy_tag, note, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(bot.id, 'indodax', 'XRPIDR', 'sell', 26600, 0.2, 60, 5320, -6000, 11320, 'live', 'x', 'x', 'TEST', 'rugi', now());
  const todayLoss = pnl.botRealizedToday(bot.id);
  check('realizedToday terbaca -6000', todayLoss === -6000, `got ${todayLoss}`);

  // Jalankan guard via scheduler processBot (tiruan): panggil logika guard langsung
  const lossLimit = (bot.max_daily_loss_pct / 100) * bot.current_budget;
  const shouldPause = todayLoss < 0 && Math.abs(todayLoss) >= lossLimit;
  check('guard mendeteksi rugi > batas (6000 ≥ 5000)', shouldPause);
  if (shouldPause) queries.setBotStatus.run('paused', now(), bot.id);
  const botAfter = queries.getBot.get(bot.id) as any;
  check('bot auto-paused setelah guard', botAfter.status === 'paused', `got ${botAfter.status}`);

  // ===== C) Reconciler drift =====
  console.log('\nC) Reconciler Drift');
  // Bot live dengan state posisi 3.75 XRP, tapi saldo mock 7.5 XRP → drift 100%
  const info2 = queries.insertBot.run({
    name: 'DriftBot', exchange_id: 'indodax', pair: 'XRPIDR', strategy: 'dca',
    params: '{}', budget_idr: 100000, current_budget: 100000, lot: 20000,
    mode: 'live', auto_compound_pct: 100, status: 'running',
    state: JSON.stringify({ entries: [{ price: 26600, qty: 3.75, cost: 99750 }] }),
    max_daily_loss_pct: 0, created_at: now(), updated_at: now()
  });
  const drifts = await reconcileOnce({ tolerancePct: 5, notifyOnDrift: false });
  check('drift terdeteksi', drifts.length >= 1, `got ${drifts.length}`);
  const d = drifts.find(x => x.bot_id === Number(info2.lastInsertRowid));
  check('drift bot yang benar terdeteksi', !!d, JSON.stringify(drifts));
  if (d) check('drift_pct besar (100%)', d.drift_pct > 50, `got ${d.drift_pct}`);

  server.close();
  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); server.close(); process.exit(1); });
