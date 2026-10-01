/**
 * E2E test jalur "riil" (mode live) TANPA uang sungguhan.
 * Menggunakan mock HTTP server yang meniru /tapi Indodax:
 *  - memvalidasi header Key & Sign (HMAC-SHA512)
 *  - memvalidasi body market order (order_type, idr/btc, client_order_id)
 *  - mencegah order duplikat via client_order_id
 *
 * Jalankan: npx tsx server/scripts/test-live-mock.ts
 */
import http from 'node:http';
import crypto from 'node:crypto';

const API_KEY = 'TESTKEY-1234';
const API_SECRET = 'testsecret-567890abcdef';
const PORT = 3901;

// State mock
const seenClientOrderIds = new Set<string>();
const balances: Record<string, number> = { idr: 1_000_000, xrp: 0 };
let lastRequest: { headers: any; body: string } | null = null;
const requests: { body: URLSearchParams; sign: string }[] = [];

function verifySign(body: string, sign: string): boolean {
  const expect = crypto.createHmac('sha512', API_SECRET).update(body).digest('hex');
  return expect === sign;
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const url = req.url || '';
    res.setHeader('Content-Type', 'application/json');

    if (url === '/tapi') {
      const key = req.headers['key'];
      const sign = String(req.headers['sign'] || '');
      lastRequest = { headers: req.headers, body };
      const params = new URLSearchParams(body);
      requests.push({ body: params, sign });

      // Validasi kredensial
      if (key !== API_KEY || !verifySign(body, sign)) {
        res.end(JSON.stringify({ success: 0, error: 'Invalid credentials.', error_code: 'invalid_credentials' }));
        return;
      }
      const method = params.get('method');

      if (method === 'getInfo') {
        res.end(JSON.stringify({
          success: 1,
          return: { server_time: Date.now(), balance: balances, balance_hold: {}, address: {}, user_id: 'mock1', name: 'Mock' }
        }));
        return;
      }

      if (method === 'getOrderByClientOrderId') {
        const coid = params.get('client_order_id')!;
        if (seenClientOrderIds.has(coid)) {
          res.end(JSON.stringify({ success: 1, return: { order: { order_id: '900001', client_order_id: coid, status: 'filled' } } }));
        } else {
          res.end(JSON.stringify({ success: 0, error: 'Order not found', error_code: 'order_not_found' }));
        }
        return;
      }

      if (method === 'tradeHistory') {
        const pair = params.get('pair') || 'xrp_idr';
        const base = pair.split('_')[0];
        res.end(JSON.stringify({
          success: 1,
          return: { trades: [{ trade_id: '1', order_id: params.get('order_id'), type: 'buy', [base]: '3.75', price: '26600', fee: '299', trade_time: String(Math.floor(Date.now() / 1000)) }] }
        }));
        return;
      }

      if (method === 'trade') {
        const coid = params.get('client_order_id');
        const orderType = params.get('order_type');
        const type = params.get('type');
        const price = params.get('price');

        // Idempotensi: client_order_id duplikat → reject
        if (coid && seenClientOrderIds.has(coid)) {
          res.end(JSON.stringify({ success: 0, error: `client order id ${coid} already exists`, error_code: 'duplicate_client_order_id' }));
          return;
        }
        // Validasi market order tidak boleh bawa price
        if (orderType === 'market' && price) {
          res.end(JSON.stringify({ success: 0, error: 'price not allowed for market order', error_code: 'invalid_param' }));
          return;
        }
        if (coid) seenClientOrderIds.add(coid);

        if (type === 'buy') {
          const idr = Number(params.get('idr') || 0);
          balances.idr -= idr;
          balances.xrp += (idr / 26600);
          res.end(JSON.stringify({ success: 1, return: { order_id: 900001, client_order_id: coid, receive_xrp: (idr / 26600).toFixed(8), spend_rp: idr, fee: idr * 0.003, remain_rp: balances.idr } }));
        } else {
          const qty = Number(params.get('xrp') || 0);
          balances.xrp -= qty;
          balances.idr += qty * 26600 * 0.997;
          res.end(JSON.stringify({ success: 1, return: { order_id: 900002, client_order_id: coid, receive_rp: qty * 26600 * 0.997, spend_xrp: qty, fee: qty * 26600 * 0.003 } }));
        }
        return;
      }

      res.end(JSON.stringify({ success: 0, error: 'unknown method' }));
      return;
    }

    if (url === '/api/server_time') { res.end(JSON.stringify({ timezone: 'UTC', server_time: Date.now() })); return; }
    if (url.startsWith('/api/') && url.endsWith('/ticker')) {
      res.end(JSON.stringify({ ticker: { buy: '26600', sell: '26635', last: '26600', high: '27182', low: '26520', server_time: Math.floor(Date.now() / 1000), vol_idr: '1000000' } }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
});

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name} ${detail}`); failed++; }
}

async function main() {
  await new Promise<void>(r => server.listen(PORT, r));
  console.log(`Mock Indodax /tapi berjalan di :${PORT}\n`);

  // Override base URL ke mock
  process.env.INDODAX_BASE_URL = `http://127.0.0.1:${PORT}`;
  const { IndodaxClient } = await import('../src/exchange/indodax.js');
  const client = new IndodaxClient();
  client.setCredentials(API_KEY, API_SECRET);

  // --- Test 1: signature & kredensial benar ---
  console.log('Test 1: Signature HMAC-SHA512 & getInfo');
  const bal = await client.getBalances();
  check('getInfo sukses', Array.isArray(bal));
  const idrBal = bal.find(b => b.asset === 'IDR');
  check('saldo IDR terbaca', idrBal?.free === 1_000_000, `got ${idrBal?.free}`);

  // --- Test 2: market BUY tidak mengirim price, pakai idr + client_order_id ---
  console.log('\nTest 2: BUY MARKET (order_type=market, tanpa price, client_order_id)');
  const buyCoid = 'e2e-buy-001';
  const buy = await client.buyMarket('XRPIDR', 100000, buyCoid);
  const tradeReq = requests.find(r => r.body.get('method') === 'trade');
  check('order_type=market', tradeReq?.body.get('order_type') === 'market', `got ${tradeReq?.body.get('order_type')}`);
  check('tidak ada parameter price', tradeReq?.body.get('price') === null, `got ${tradeReq?.body.get('price')}`);
  check('pakai idr', tradeReq?.body.get('idr') === '100000', `got ${tradeReq?.body.get('idr')}`);
  check('client_order_id terkirim', tradeReq?.body.get('client_order_id') === buyCoid);
  check('hasil qty > 0', buy.qty > 0, `got ${buy.qty}`);

  // --- Test 3: idempotensi — client_order_id sama → ditolak mock ---
  console.log('\nTest 3: Idempotensi client_order_id (duplikat ditolak)');
  let dupError = '';
  try {
    await client.buyMarket('XRPIDR', 100000, buyCoid);
  } catch (e: any) { dupError = e.message; }
  check('order duplikat ditolak', /already exists/i.test(dupError), `got: ${dupError}`);

  // --- Test 4: SELL MARKET pakai qty base + order_type=market ---
  console.log('\nTest 4: SELL MARKET (qty base, order_type=market)');
  const sellCoid = 'e2e-sell-001';
  const sell = await client.sellMarket('XRPIDR', 3.5, sellCoid);
  const sellReqs = requests.filter(r => r.body.get('method') === 'trade' && r.body.get('type') === 'sell');
  const sellReq = sellReqs[sellReqs.length - 1];
  check('order_type=market', sellReq?.body.get('order_type') === 'market');
  check('qty base (xrp) terkirim', sellReq?.body.get('xrp') === '3.5', `got ${sellReq?.body.get('xrp')}`);
  check('tidak ada price', sellReq?.body.get('price') === null);
  check('hasil sell OK', sell.qty > 0);

  // --- Test 5: kredensial salah → error jelas ---
  console.log('\nTest 5: Kredensial salah ditolak');
  const bad = new IndodaxClient();
  bad.setCredentials('WRONG', 'WRONG');
  let authErr = '';
  try { await bad.getBalances(); } catch (e: any) { authErr = e.message; }
  check('error invalid credentials', /credentials/i.test(authErr), `got: ${authErr}`);

  server.close();
  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); server.close(); process.exit(1); });
