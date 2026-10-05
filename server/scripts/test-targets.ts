/**
 * Jarak jual + sesuaikan drift:
 *  A) grid: target level terdekat dari fee floor
 *  B) dca: tier parsial vs penuh
 *  C) tanpa posisi -> null
 *  D) reconcile: catatan 10 vs aktual 6 -> diskala ke 6
 *
 * Jalankan: npx tsx server/scripts/test-targets.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.BOTANI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'botani-targets-'));
process.env.SECRET_KEY = 'test-secret-key-minimal-32-chars-abcdef';

let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

async function main() {
  const { nearestSellTarget } = await import('../src/engine/targets.js');

  console.log('A) grid');
  // Indodax: floor = 0.6 fee + 0.2 buffer + 0.3 net = 1.1%
  const g = nearestSellTarget('grid', { filledBuys: [{ price: 1000, qty: 1, cost: 1000 }] }, { profit_pct: 0.5 }, 'indodax', 1005);
  check('butuh +~0.6% lagi', g !== null && Math.abs(g.pctAway - 0.6) < 0.05, JSON.stringify(g));

  console.log('\nB) dca');
  const d1 = nearestSellTarget('dca',
    { entries: [{ price: 1000, qty: 10, cost: 10000 }], tier1Done: false },
    { take_profit_pct: 3 }, 'indodax', 1005);
  check('tier parsial ~+1.0%', d1 !== null && Math.abs(d1.pctAway - 1.0) < 0.1, JSON.stringify(d1));
  const d2 = nearestSellTarget('dca',
    { entries: [{ price: 1000, qty: 10, cost: 10000 }], tier1Done: true },
    { take_profit_pct: 3 }, 'indodax', 1005);
  check('tier penuh ~+2.9%', d2 !== null && Math.abs(d2.pctAway - 2.9) < 0.15, JSON.stringify(d2));

  console.log('\nC) tanpa posisi');
  check('grid kosong -> null', nearestSellTarget('grid', { filledBuys: [] }, {}, 'indodax', 100) === null);

  console.log('\nD) reconcile endpoint');
  const express = (await import('express')).default;
  const { authRouter } = await import('../src/routes/auth.js');
  const { requireAuth } = await import('../src/auth.js');
  const { api } = await import('../src/routes/api.js');
  const { db, queries, now } = await import('../src/db/index.js');
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
  const T = login.data.token;
  const info = queries.insertBot.run({
    user_id: 1, name: 'Drift', exchange_id: 'indodax', pair: 'XRPIDR', strategy: 'dca',
    params: '{}', budget_idr: 100000, current_budget: 100000, lot: 20000, mode: 'paper',
    auto_compound_pct: 100, status: 'paused', state: JSON.stringify({ entries: [{ price: 100, qty: 10, cost: 1000 }] }),
    max_daily_loss_pct: 0, market_preset_id: null, created_at: now(), updated_at: now(),
  });
  const botId = info.lastInsertRowid as number;
  db.prepare(`INSERT INTO paper_balances (exchange_id, asset, free, locked, user_id) VALUES ('indodax','XRP',6,0,1)`).run();
  const r = await rq('POST', `/bots/${botId}/reconcile`, {}, T);
  check('drift disesuaikan 10 -> 6', r.status === 200 && r.data.adjusted === true && Math.abs(r.data.actual - 6) < 1e-9, JSON.stringify(r.data));
  const st = JSON.parse((queries.getBot.get(botId) as any).state);
  check('qty entry diskala', Math.abs(st.entries[0].qty - 6) < 1e-9, JSON.stringify(st.entries));
  const r2 = await rq('POST', `/bots/${botId}/reconcile`, {}, T);
  check('kedua kali: tak ada drift', r2.status === 200 && r2.data.drift === false, JSON.stringify(r2.data));

  server.close();
  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
