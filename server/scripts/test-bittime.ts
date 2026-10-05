/**
 * E2E adapter Bittime via mock HTTP (meniru openapi.bittime.com):
 *  A) Ticker 24hr bentuk ARRAY + bookTicker object
 *  B) Buy MARKET dihitung dari quantity (tanpa quoteOrderQty) + clientOrderId
 *  C) Rekonsiliasi fill via GET order (executedQty)
 *  D) Balances + adopsi takerCommission
 *  E) Idempotensi: kirim order duplikat memakai orderId yang sama
 *  F) Klines dari agregasi trades
 *  G) Registrasi di registry + seed default pairs
 *
 * Jalankan: npx tsx server/scripts/test-bittime.ts
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.BOTANI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'botani-bittime-'));

const API_KEY = 'BITTIME-KEY-1';
const API_SECRET = 'bittime-secret-xyz';
const PORT = 3905;

let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

const balances: Record<string, number> = { IDR: 5_000_000, XRP: 0 };
const seenCoid = new Set<string>();
let orderSeq = 100;
const orders = new Map<number, any>();

function verifySign(url: URL, sign: string) {
  const params = new URLSearchParams(url.searchParams.toString());
  params.delete('signature');
  // tiru totalParams = query string (tanpa signature)
  const qs = params.toString();
  return crypto.createHmac('sha256', API_SECRET).update(qs).digest('hex') === sign;
}

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const u = new URL(req.url || '/', 'http://x');

  if (u.pathname === '/api/v1/ping') { res.end('{}'); return; }
  if (u.pathname === '/api/v1/ticker/24hr') {
    res.end(JSON.stringify([{ symbol: 'XRPIDR', lastPrice: '26600', bidPrice: '26590', askPrice: '26610', highPrice: '27182', lowPrice: '26520', quoteVolume: '1000000' }]));
    return;
  }
  if (u.pathname === '/api/v1/ticker/bookTicker') {
    res.end(JSON.stringify({ symbol: 'XRPIDR', bidPrice: '26600', bidQty: '100', askPrice: '26635', askQty: '50' }));
    return;
  }
  if (u.pathname === '/api/v1/trades') {
    const out = [];
    for (let i = 0; i < 40; i++) out.push({ id: i, price: String(26600 + (i % 5)), qty: '2', time: Date.now() - (40 - i) * 60000 });
    res.end(JSON.stringify(out));
    return;
  }
  if (u.pathname === '/api/v1/exchangeInfo') {
    res.end(JSON.stringify({ symbols: [{ symbol: 'XRPIDR', status: 'TRADING', filters: [{ filterType: 'LOT_SIZE', minQty: '1', minVal: '10000', maxQty: '999999', stepSize: '0.01' }] }] }));
    return;
  }
  // --- signed endpoints ---
  const key = req.headers['x-mbx-apikey'];
  const sig = u.searchParams.get('signature') || '';
  if (key !== API_KEY || !verifySign(u, sig)) {
    res.statusCode = 401; res.end(JSON.stringify({ code: -1022, msg: 'Invalid signature.' })); return;
  }
  if (u.pathname === '/api/v1/account') {
    res.end(JSON.stringify({ canTrade: true, takerCommission: 10, balances: Object.entries(balances).map(([asset, free]) => ({ asset, free: String(free), locked: '0' })) }));
    return;
  }
  if (u.pathname === '/api/v1/order' && req.method === 'POST') {
    const coid = u.searchParams.get('newClientOrderId') || '';
    if (coid && seenCoid.has(coid)) {
      res.statusCode = 400; res.end(JSON.stringify({ code: -2010, msg: 'duplicate client order id' })); return;
    }
    if (coid) seenCoid.add(coid);
    const side = u.searchParams.get('side');
    const qty = Number(u.searchParams.get('quantity') || 0);
    const orderId = orderSeq++;
    if (side === 'BUY') {
      const cost = qty * 26610;
      balances.IDR -= cost; balances.XRP += qty;
      orders.set(orderId, { symbol: 'XRPIDR', orderId, executedQty: String(qty), cummulativeQuoteQty: String(cost), status: 'FILLED' });
    } else {
      balances.XRP -= qty;
      const value = qty * 26600 * 0.999;
      balances.IDR += value;
      orders.set(orderId, { symbol: 'XRPIDR', orderId, executedQty: String(qty), cummulativeQuoteQty: String(value), status: 'FILLED' });
    }
    res.end(JSON.stringify({ symbol: 'XRPIDR', orderId, clientOrderId: coid }));
    return;
  }
  if (u.pathname === '/api/v1/order' && req.method === 'GET') {
    const o = orders.get(Number(u.searchParams.get('orderId')));
    if (!o) { res.statusCode = 400; res.end(JSON.stringify({ code: -2013, msg: 'order not exists' })); return; }
    res.end(JSON.stringify(o));
    return;
  }
  if (u.pathname === '/api/v1/openOrders') {
    res.end(JSON.stringify([]));
    return;
  }
  if (u.pathname === '/api/v1/order' && req.method === 'DELETE') {
    res.end(JSON.stringify({ symbol: 'XRPIDR', orderId: Number(u.searchParams.get('orderId')) }));
    return;
  }
  res.statusCode = 404; res.end('{}');
});

async function main() {
  await new Promise<void>(r => server.listen(PORT, r));
  console.log(`Mock Bittime :${PORT}\n`);
  process.env.BITTIME_BASE_URL = `http://127.0.0.1:${PORT}`;

  const { db } = await import('../src/db/index.js');
  const { registry } = await import('../src/exchange/registry.js');
  const { BittimeClient } = await import('../src/exchange/bittime.js');
  const client = new BittimeClient();
  client.setCredentials(API_KEY, API_SECRET);

  // ===== A) Ticker array =====
  console.log('A) Ticker & klines publik');
  const t = await client.getTicker('XRPIDR');
  check('last dari array 24hr', t.last === 26600, `got ${t.last}`);
  check('bid/ask dari bookTicker', t.bid === 26600 && t.ask === 26635, `got ${t.bid}/${t.ask}`);
  const kl = await client.getKlines('XRPIDR', '1m', 50);
  check('klines agregasi trades', kl.length >= 3, `got ${kl.length}`);

  // ===== B) Buy via quantity =====
  console.log('\nB) Buy MARKET (quantity, bukan quoteOrderQty)');
  const buy = await client.buyMarket('XRPIDR', 100000, 'e2e-bt-buy-1');
  check('qty > 0', buy.qty > 0, `got ${buy.qty}`);
  check('harga wajar', buy.price > 26000 && buy.price < 27000, `got ${buy.price}`);

  // ===== C) Rekonsiliasi =====
  console.log('\nC) Fill dari order query');
  check('order_id terisi', !!buy.order_id, `got ${buy.order_id}`);

  // ===== D) Balances + fee =====
  console.log('\nD) Balances & fee');
  const bals = await client.getBalances();
  check('saldo terbaca', bals.length >= 2, `got ${bals.length}`);
  check('fee diadopsi 10bp -> 0.001', Math.abs((client as any).feeRate - 0.001) < 1e-9, `got ${(client as any).feeRate}`);

  // ===== E) Idempotensi =====
  console.log('\nE) Idempotensi clientOrderId');
  let dupErr = '';
  try { await client.buyMarket('XRPIDR', 100000, 'e2e-bt-buy-1'); }
  catch (e: any) { dupErr = e.message; }
  check('duplikat ditolak', /duplicate/i.test(dupErr), `got: ${dupErr}`);

  // ===== F) Sell =====
  console.log('\nF) Sell MARKET');
  const sell = await client.sellMarket('XRPIDR', 3.5, 'e2e-bt-sell-1');
  check('sell qty > 0', sell.qty > 0, `got ${sell.qty}`);

  // ===== G2) Wizard recommend di atas Bittime (stub klines) =====
  console.log('\nG2) Recommend Bittime (stub klines sintetis)');
  const pub = registry.get('bittime');
  const origKlines = (pub as any).getKlines.bind(pub);
  const synth: any[] = [];
  let px = 1500000000;
  for (let i = 0; i < 120; i++) {
    px = px * (1 + Math.sin(i / 10) * 0.004);
    synth.push([1700000000000 + i * 86400000, px, px * 1.002, px * 0.998, px, 10]);
  }
  (pub as any).getKlines = async () => synth;
  try {
    const { recommend } = await import('../src/engine/wizard.js');
    const recs = await recommend('bittime', 'BTCIDR', 100000);
    check('8 preset kembali terurut', recs.length === 8, `got ${recs.length}`);
    check('backtest terisi (trades>0 di salah satu)', recs.some(r => r.backtest.trades > 0),
      JSON.stringify(recs.map(r => [r.id, r.backtest.trades])));
  } finally {
    (pub as any).getKlines = origKlines;
  }

  // ===== G3) max-spendable override mode =====
  console.log('\nG3) max-spendable override mode');
  const { maxSpendable } = await import('../src/engine/budget.js');
  const paperView = await maxSpendable(0, 'bittime', 'paper');
  check('paper -> seed 10jt IDR', paperView.mode === 'paper' && paperView.free === 10000000 && paperView.quote === 'IDR',
    JSON.stringify(paperView));

  // ===== G) Registrasi =====
  console.log('\nG) Registrasi & seed');
  const reg = registry.get('bittime');
  check('terdaftar (id=bittime)', (reg as any).id === 'bittime');
  const pairs = db.prepare(`SELECT COUNT(*) c FROM default_pairs WHERE exchange_id='bittime'`).get() as any;
  check('10 default pairs terseed', pairs.c === 10, `got ${pairs.c}`);
  const ex = db.prepare(`SELECT COUNT(*) c FROM exchanges WHERE id='bittime'`).get() as any;
  check('baris exchange ada', ex.c >= 1, `got ${ex.c}`);

  server.close();
  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); server.close(); process.exit(1); });
