/**
 * E2E kill switch: bot running + open order di mock → activate →
 * semua bot paused + semua open order dibatalkan (via cancelOrder).
 * Jalankan: npx tsx server/scripts/test-killswitch.ts
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const API_KEY = 'KS-KEY';
const API_SECRET = 'ks-secret';
const PORT = 3903;

process.env.INDODAX_BASE_URL = `http://127.0.0.1:${PORT}`;
// Isolasi DB ke direktori sementara SEBELUM import modul DB
const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'botani-ks-'));
process.env.BOTANI_DATA_DIR = tmpData;

// Mock state: ada 2 open order live
let openOrders = [
  { order_id: '111', client_order_id: 'a', pair: 'xrp_idr', type: 'sell', order_type: 'limit', price: '27000', order_xrp: '10' },
  { order_id: '222', client_order_id: 'b', pair: 'doge_idr', type: 'buy', order_type: 'limit', price: '1600', order_idr: '50000' }
];
const cancelCalls: string[] = [];

const verify = (body: string, sign: string) => crypto.createHmac('sha512', API_SECRET).update(body).digest('hex') === sign;

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const url = req.url || '';
    res.setHeader('Content-Type', 'application/json');
    if (url === '/tapi') {
      const params = new URLSearchParams(body);
      if (req.headers['key'] !== API_KEY || !verify(body, String(req.headers['sign'] || ''))) {
        res.end(JSON.stringify({ success: 0, error: 'Invalid credentials.', error_code: 'invalid_credentials' })); return;
      }
      const method = params.get('method');
      if (method === 'openOrders') {
        // Dengan pair → array; tanpa → object per pair
        const pair = params.get('pair');
        if (pair) {
          res.end(JSON.stringify({ success: 1, return: { orders: openOrders.filter(o => o.pair === pair) } }));
        } else {
          const grouped: Record<string, any[]> = {};
          for (const o of openOrders) (grouped[o.pair] = grouped[o.pair] || []).push(o);
          res.end(JSON.stringify({ success: 1, return: { orders: grouped } }));
        }
        return;
      }
      if (method === 'cancelOrder') {
        const oid = params.get('order_id')!;
        cancelCalls.push(oid);
        openOrders = openOrders.filter(o => o.order_id !== oid);
        res.end(JSON.stringify({ success: 1, return: { order_id: Number(oid), balance: {} } }));
        return;
      }
      if (method === 'getInfo') { res.end(JSON.stringify({ success: 1, return: { server_time: Date.now(), balance: { idr: 100000 }, balance_hold: {}, address: {}, user_id: 'ks', name: 'KS' } })); return; }
      res.end(JSON.stringify({ success: 0, error: 'unknown' })); return;
    }
    if (url === '/api/server_time') { res.end(JSON.stringify({ server_time: Date.now() })); return; }
    if (url.startsWith('/api/') && url.endsWith('/ticker')) { res.end(JSON.stringify({ ticker: { buy: '26600', sell: '26635', last: '26600', high: '1', low: '1', server_time: 1, vol_idr: '1' } })); return; }
    res.statusCode = 404; res.end('{}');
  });
});

let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

async function main() {
  await new Promise<void>(r => server.listen(PORT, r));
  console.log(`Mock Indodax (2 open order) :${PORT}\n`);

  const { db, queries, now } = await import('../src/db/index.js');
  const { encrypt } = await import('../src/crypto.js');
  const { registry } = await import('../src/exchange/registry.js');
  const { activateKillSwitch } = await import('../src/engine/killswitch.js');

  // Exchange live + kredensial mock
  db.prepare(`UPDATE exchanges SET mode='live', api_key_enc=?, api_secret_enc=? WHERE id='indodax'`).run(encrypt(API_KEY), encrypt(API_SECRET));
  registry.reloadFromDb();

  // Buat 2 bot running
  for (const nm of ['Bot A', 'Bot B']) {
    queries.insertBot.run({ name: nm, exchange_id: 'indodax', pair: 'XRPIDR', strategy: 'dca', params: '{}', budget_idr: 100000, current_budget: 100000, lot: 20000, mode: 'live', auto_compound_pct: 100, status: 'running', state: '{}', max_daily_loss_pct: 0, created_at: now(), updated_at: now() });
  }
  const runningBefore = (queries.runningBots.all() as any[]).length;
  check('2 bot running sebelum kill switch', runningBefore === 2, `got ${runningBefore}`);

  // Aktifkan kill switch
  const result = await activateKillSwitch('Test');
  check('semua bot di-pause', result.bots_paused === 2, `got ${result.bots_paused}`);
  check('2 order dibatalkan', result.orders_cancelled['indodax'] === 2, `got ${JSON.stringify(result.orders_cancelled)}`);
  check('tidak ada error', result.errors.length === 0, result.errors.join(';'));
  check('cancelOrder dipanggil 2x', cancelCalls.length === 2, `got ${cancelCalls.length}`);
  check('open order mock kosong', openOrders.length === 0);

  const runningAfter = (queries.runningBots.all() as any[]).length;
  check('tidak ada bot running setelahnya', runningAfter === 0, `got ${runningAfter}`);

  server.close();
  fs.rmSync(tmpData, { recursive: true, force: true });
  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); server.close(); process.exit(1); });
