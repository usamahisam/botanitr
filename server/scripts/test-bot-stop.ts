/**
 * Stop & likuidasi + kunci hapus + riwayat per bot:
 *  A) DELETE bot running -> 400 berpesan
 *  B) POST /bots/:id/stop liquidate: posisi terjual, kas ledger eis,
 *     status stopped, trade tercatat
 *  C) DELETE setelah stopped -> 200
 *  D) GET /bots/:id/summary: ringkasan buy/sell/realized
 *
 * Jalankan: npx tsx server/scripts/test-bot-stop.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.BOTANI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'botani-stop-'));
process.env.SECRET_KEY = 'test-secret-key-minimal-32-chars-abcdef';

let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

async function main() {
  const express = (await import('express')).default;
  const { authRouter } = await import('../src/routes/auth.js');
  const { requireAuth } = await import('../src/auth.js');
  const { api } = await import('../src/routes/api.js');
  const { db, queries, now } = await import('../src/db/index.js');
  const { registry } = await import('../src/exchange/registry.js');

  // Stub ticker agar hermetik
  const client: any = registry.getForUser('indodax', 1);
  client.getTicker = async () => ({ pair: 'XRPIDR', bid: 29900, ask: 30100, last: 30000, high24: 31000, low24: 29000, vol24: 0, ts: Date.now() });

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
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  await rq('POST', '/auth/setup', { username: 'admin', password: 'admin123' });
  const login = await rq('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  const A = login.data.token;
  await rq('POST', '/auth/users', { username: 'trader', password: 'trader123', role: 'user' }, A);
  const loginU = await rq('POST', '/auth/login', { username: 'trader', password: 'trader123' });
  const T = loginU.data.token;
  const U = 2;

  // Bot running dengan 1 posisi terbuka (kas sudah jadi barang)
  const info = queries.insertBot.run({
    user_id: U, name: 'StopMe', exchange_id: 'indodax', pair: 'XRPIDR', strategy: 'dca',
    params: '{}', budget_idr: 100000, current_budget: 100000, lot: 20000, mode: 'paper',
    auto_compound_pct: 100, status: 'running',
    state: JSON.stringify({ entries: [{ price: 25000, qty: 4, cost: 100000 }, { price: 25000, qty: 10, cost: 250000 }], lastEntryPrice: 25000, tier1Done: false, cash: 0 }),
    max_daily_loss_pct: 0, market_preset_id: null, created_at: now(), updated_at: now(),
  });
  const botId = info.lastInsertRowid as number;
  db.prepare(`INSERT INTO paper_balances (exchange_id, asset, free, locked, user_id) VALUES ('indodax','XRP',4,0,?)`).run(U);

  console.log('A) Kunci hapus saat running');
  let r = await rq('DELETE', `/bots/${botId}`, undefined, T);
  check('DELETE running -> 400 + pesan stop dulu', r.status === 400 && /hentikan|stop/i.test(r.data.error || ''), `got ${r.status} ${r.data.error || ''}`);

  console.log('\nB) Stop & likuidasi (saldo XRP cuma 4, entry kedua 10 = drift)');
  r = await rq('POST', `/bots/${botId}/stop`, { liquidate: true }, T);
  check('stop 200 + sold=1', r.status === 200 && r.data.sold === 1, `got ${r.status} ${JSON.stringify(r.data)}`);
  check('drift dilaporkan di errors (bukan diam)', r.status === 200 && (r.data.errors || []).length === 1, JSON.stringify(r.data.errors));
  const after = queries.getBot.get(botId) as any;
  check('status stopped', after.status === 'stopped', `got ${after.status}`);
  const st = JSON.parse(after.state);
  check('entry terjual bersih, entry drift tersisa', (st.entries || []).length === 1, JSON.stringify(st.entries));
  check('kas ledger terisi hasil jual', st.cash > 100000, `got ${st.cash}`);
  const sellTrades = db.prepare(`SELECT COUNT(*) c FROM trades WHERE bot_id=? AND side='sell'`).get(botId) as any;
  check('trade sell tercatat', sellTrades.c === 1, `got ${sellTrades.c}`);

  console.log('\nC) Hapus setelah stopped');
  r = await rq('DELETE', `/bots/${botId}`, undefined, T);
  check('DELETE stopped -> 200', r.status === 200, `got ${r.status}`);

  console.log('\nD) Ringkasan per bot');
  const info2 = queries.insertBot.run({
    user_id: U, name: 'SumMe', exchange_id: 'indodax', pair: 'XRPIDR', strategy: 'grid',
    params: '{}', budget_idr: 50000, current_budget: 50000, lot: 10000, mode: 'paper',
    auto_compound_pct: 100, status: 'paused', state: '{}',
    max_daily_loss_pct: 0, market_preset_id: null, created_at: now(), updated_at: now(),
  });
  const b2 = info2.lastInsertRowid as number;
  db.prepare(`INSERT INTO trades (user_id, bot_id, exchange_id, pair, side, price, qty, fee, value, realized_pnl, cost_basis, mode, created_at)
    VALUES (?,?, 'indodax','XRPIDR','buy',100,1,0,100,0,100,'paper',?)`).run(U, b2, now());
  db.prepare(`INSERT INTO trades (user_id, bot_id, exchange_id, pair, side, price, qty, fee, value, realized_pnl, cost_basis, mode, created_at)
    VALUES (?,?, 'indodax','XRPIDR','sell',110,1,0,110,10,100,'paper',?)`).run(U, b2, now());
  r = await rq('GET', `/bots/${b2}/summary`, undefined, T);
  check('summary 200 + buys=1 sells=1 realized=10', r.status === 200 && r.data.buys === 1 && r.data.sells === 1 && r.data.realized === 10,
    `got ${r.status} ${JSON.stringify(r.data)}`);

  server.close();
  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
