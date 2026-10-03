/**
 * E2E penuh jalur LIVE melalui mock: exchange diset mode 'live',
 * engine scheduler mengeksekusi order bot "live" ke mock /tapi.
 * Membuktikan: guard mode live, eksekusi trade live, pencatatan, dan tidak ada
 * order nyata yang keluar (semua ke mock).
 *
 * Jalankan: npx tsx server/scripts/test-live-e2e.ts
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const API_KEY = 'LIVEKEY-9Z';
const API_SECRET = 'livesecret-abc123xyz';
const PORT = 3902;

// Pakai DB sementara agar tidak mengotori data user
const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'botani-e2e-'));
process.env.BOTANI_DATA_DIR = tmpData;
process.env.INDODAX_BASE_URL = `http://127.0.0.1:${PORT}`;

const balances: Record<string, number> = { idr: 5_000_000, xrp: 0 };
const seenCoid = new Set<string>();

function verifySign(body: string, sign: string) {
  return crypto.createHmac('sha512', API_SECRET).update(body).digest('hex') === sign;
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const url = req.url || '';
    res.setHeader('Content-Type', 'application/json');
    if (url === '/tapi') {
      const params = new URLSearchParams(body);
      if (req.headers['key'] !== API_KEY || !verifySign(body, String(req.headers['sign'] || ''))) {
        res.end(JSON.stringify({ success: 0, error: 'Invalid credentials.', error_code: 'invalid_credentials' })); return;
      }
      const method = params.get('method');
      if (method === 'getInfo') {
        res.end(JSON.stringify({ success: 1, return: { server_time: Date.now(), balance: balances, balance_hold: {}, address: {}, user_id: 'live-mock', name: 'LiveMock' } })); return;
      }
      if (method === 'getOrderByClientOrderId') {
        res.end(JSON.stringify({ success: 1, return: { order: { order_id: '1', client_order_id: params.get('client_order_id'), status: 'filled' } } })); return;
      }
      if (method === 'tradeHistory') {
        const base = (params.get('pair') || 'xrp_idr').split('_')[0];
        res.end(JSON.stringify({ success: 1, return: { trades: [{ trade_id: '1', order_id: '1', type: 'buy', [base]: '3.75', price: '26600', fee: '299', trade_time: '1' }] } })); return;
      }
      if (method === 'openOrders') { res.end(JSON.stringify({ success: 1, return: { orders: [] } })); return; }
      if (method === 'trade') {
        const coid = params.get('client_order_id');
        if (coid && seenCoid.has(coid)) { res.end(JSON.stringify({ success: 0, error: 'dup', error_code: 'duplicate' })); return; }
        if (coid) seenCoid.add(coid);
        if (params.get('type') === 'buy') {
          const idr = Number(params.get('idr') || 0);
          balances.idr -= idr; balances.xrp += idr / 26600;
          res.end(JSON.stringify({ success: 1, return: { order_id: 1, client_order_id: coid, receive_xrp: (idr / 26600).toFixed(8), spend_rp: idr, fee: idr * 0.003 } }));
        } else {
          const qty = Number(params.get('xrp') || 0);
          balances.xrp -= qty; balances.idr += qty * 26600 * 0.997;
          res.end(JSON.stringify({ success: 1, return: { order_id: 2, client_order_id: coid, receive_rp: qty * 26600 * 0.997, spend_xrp: qty } }));
        }
        return;
      }
      res.end(JSON.stringify({ success: 0, error: 'unknown' })); return;
    }
    if (url === '/api/server_time') { res.end(JSON.stringify({ server_time: Date.now() })); return; }
    if (url.startsWith('/api/') && url.endsWith('/ticker')) {
      res.end(JSON.stringify({ ticker: { buy: '26600', sell: '26635', last: '26600', high: '27182', low: '26520', server_time: Math.floor(Date.now() / 1000), vol_idr: '1' } })); return;
    }
    res.statusCode = 404; res.end('{}');
  });
});

let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

async function main() {
  await new Promise<void>(r => server.listen(PORT, r));
  console.log(`Mock live Indodax :${PORT}, DB sementara: ${tmpData}\n`);

  // Import setelah env diset
  const { db, queries, settings, now } = await import('../src/db/index.js');
  const { encrypt } = await import('../src/crypto.js');
  const { registry } = await import('../src/exchange/registry.js');
  const { getStrategy } = await import('../src/strategies/types.js');
  const { executeAction } = await import('../src/engine/trader.js');
  await import('../src/strategies/dca.js');

  // Setup: exchange indodax → mode live + kredensial mock
  db.prepare(`UPDATE exchanges SET mode='live', api_key_enc=?, api_secret_enc=? WHERE id='indodax'`)
    .run(encrypt(API_KEY), encrypt(API_SECRET));
  registry.reloadUser(0);

  const exRow = queries.getExchange.get('indodax', 0) as any;
  check('exchange mode live', exRow.mode === 'live');
  const client = registry.getForUser('indodax', 0);
  check('kredensial termuat', client.hasCredentials());

  // Buat bot live
  const strat = getStrategy('dca');
  const params = { ...strat.defaultParams };
  const info = queries.insertBot.run({
    name: 'DCA Live Mock', exchange_id: 'indodax', pair: 'XRPIDR', strategy: 'dca',
    params: JSON.stringify(params), budget_idr: 200000, current_budget: 200000, lot: 40000,
    mode: 'live', auto_compound_pct: 100, status: 'running',
    state: JSON.stringify(strat.init(params)), max_daily_loss_pct: 0, user_id: 0, created_at: now(), updated_at: now()
  });
  const bot = queries.getBot.get(info.lastInsertRowid) as any;
  check('bot live dibuat', bot.mode === 'live');

  // Simulasi tick: DCA entry pertama (buy)
  const ticker = { pair: 'XRPIDR', bid: 26600, ask: 26635, last: 26600, high24: 27182, low24: 26520, vol24: 0, ts: Date.now() };
  const ctx: any = { bot, ticker, usdtIdr: 1, now: Date.now(), getKlines: async () => [] };
  const state = JSON.parse(bot.state);
  const actions = await strat.onTick(ctx, state, params);
  check('strategi hasilkan aksi buy', actions.length > 0 && actions[0].type === 'buy', JSON.stringify(actions));

  if (actions[0]) {
    const trade = await executeAction(bot, actions[0], 1);
    check('trade live tereksekusi', !!trade);
    check('mode trade = live', trade?.mode === 'live', `got ${trade?.mode}`);
    check('order_id dari exchange', !!trade?.order_id && trade.order_id !== '', `got ${trade?.order_id}`);
    check('client_order_id tercatat', !!trade?.client_order_id);
    check('qty terisi', (trade?.qty ?? 0) > 0, `got ${trade?.qty}`);
  }

  // Saldo mock berkurang
  check('saldo mock IDR berkurang', balances.idr < 5_000_000, `sisa ${balances.idr}`);
  check('mock menerima client_order_id unik', seenCoid.size > 0);

  server.close();
  fs.rmSync(tmpData, { recursive: true, force: true });
  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); server.close(); process.exit(1); });
