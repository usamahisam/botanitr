/**
 * E2E HTTP audit-fixes: sanitasi query numerik, validasi body, rate-limit login,
 * hapus user kaskade, quick-trade balance guard.
 *
 * Jalankan: npx tsx server/scripts/test-audit-http.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.BOTANI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'botani-audit-'));
process.env.SECRET_KEY = 'test-secret-key-minimal-32-chars-abcdef';

let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

async function main() {
  const express = (await import('express')).default;
  const { authRouter } = await import('../src/routes/auth.js');
  const { requireAuth } = await import('../src/auth.js');
  const { api } = await import('../src/routes/api.js');
  const { db, queries } = await import('../src/db/index.js');

  const app = express();
  app.use(express.json());
  app.use('/api', authRouter);
  app.use('/api', requireAuth, api);
  const server = await new Promise<any>(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = async (p: string, body: any, token?: string) => {
    const res = await fetch(base + p, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body)
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const get = async (p: string, token?: string) => {
    const res = await fetch(base + p, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const del = async (p: string, token?: string) => {
    const res = await fetch(base + p, { method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  // Setup admin + login
  await post('/auth/setup', { username: 'admin', password: 'admin123' });
  const login = await post('/auth/login', { username: 'admin', password: 'admin123' });
  const T = login.data.token;
  // Trader untuk aksi trading (admin diblokir trading)
  await post('/auth/users', { username: 'trader', password: 'trader123', role: 'user' }, T);
  const loginU = await post('/auth/login', { username: 'trader', password: 'trader123' });
  const U = loginU.data.token;

  // ===== A) Query numerik korup tak 500 =====
  console.log('A) Sanitasi query');
  let r = await get('/trades?limit=rusak&offset=xx', T);
  check('trades limit korup → 200', r.status === 200 && Array.isArray(r.data?.rows), `got ${r.status}`);
  r = await get('/logs?limit=NaN', T);
  check('logs limit korup → 200', r.status === 200, `got ${r.status}`);
  r = await get('/wizard/presets?budget=abc', T);
  check('wizard budget korup → 200', r.status === 200, `got ${r.status}`);
  r = await get('/dashboard', T);
  check('dashboard smoke → 200', r.status === 200, `got ${r.status}`);

  // ===== B) Validasi body bots =====
  console.log('\nB) Validasi bots');
  const goodBot = { name: 't', exchange_id: 'indodax', pair: 'XRPIDR', strategy: 'grid', budget_idr: 100000 };
  r = await post('/bots', { ...goodBot, budget_idr: -5 }, U);
  check('budget negatif → 400', r.status === 400, `got ${r.status} ${JSON.stringify(r.data)}`);
  r = await post('/bots', { ...goodBot, mode: 'hacker' }, U);
  check('mode ilegal → 400', r.status === 400, `got ${r.status}`);
  r = await post('/bots', { ...goodBot, strategy: 'tidakada' }, U);
  check('strategi tak dikenal → 400', r.status === 400, `got ${r.status}`);
  r = await post('/bots', { ...goodBot, compound_pct: 500 }, U);
  check('compound >100 dijepit ke 100', r.status === 201 && r.data.auto_compound_pct === 100, `got ${r.status} ${JSON.stringify(r.data)}`);
  r = await post('/bots', goodBot, U);
  check('bot valid → 201', r.status === 201, `got ${r.status} ${JSON.stringify(r.data)}`);

  // ===== C) Validasi alerts =====
  console.log('\nC) Validasi alerts');
  r = await post('/alerts', { exchange_id: 'indodax', pair: 'XRPIDR', direction: 'above', target_price: 'abc' }, T);
  check('target non-angka → 400', r.status === 400, `got ${r.status}`);
  r = await post('/alerts', { exchange_id: 'tidakada', pair: 'XRPIDR', direction: 'above', target_price: 100 }, T);
  check('exchange tak dikenal → 400', r.status === 400, `got ${r.status}`);
  r = await post('/alerts', { exchange_id: 'indodax', pair: 'XRPIDR', direction: 'sideways', target_price: 100 }, T);
  check('direction ilegal → 400', r.status === 400, `got ${r.status}`);

  // ===== D) Validasi marketplace =====
  console.log('\nD) Validasi marketplace');
  r = await post('/marketplace', { name: 'x', strategy: 'tidakada' }, T);
  check('publish strategi tak dikenal → 400', r.status === 400, `got ${r.status}`);
  r = await post('/marketplace', { name: 'x', strategy: 'grid', params: [1, 2] }, T);
  check('publish params array → 400', r.status === 400, `got ${r.status}`);

  // ===== E) Rate-limit login (unit, IP unik) =====
  console.log('\nE) Rate-limit login');
  const { loginRateLimit } = await import('../src/auth.js');
  let blocked = 0, allowed = 0;
  for (let i = 0; i < 11; i++) {
    const req: any = { ip: '9.9.9.99' };
    let code = 0; let nexted = false;
    const res: any = { status: (c: number) => { code = c; return res; }, json: () => res, set: () => res };
    loginRateLimit(req, res, () => { nexted = true; });
    if (nexted) allowed++; else if (code === 429) blocked++;
  }
  check('10 lolos + 1 diblokir 429', allowed === 10 && blocked === 1, `allowed=${allowed} blocked=${blocked}`);

  // ===== F) Hapus user kaskade =====
  console.log('\nF) Hapus user kaskade');
  const u3 = await post('/auth/users', { username: 'hapus', password: 'hapus123' }, T);
  const u3id = u3.data.id;
  // (exchanges auto-dibuat via ensureUserExchanges saat user dibuat)
  db.prepare(`INSERT INTO settings (user_id, key, value) VALUES (?,?,?)`).run(u3id, 'k', 'v');
  const l3 = await post('/auth/login', { username: 'hapus', password: 'hapus123' });
  const T3 = l3.data.token;
  check('user3 login ok', !!T3);
  r = await del(`/auth/users/${u3id}`, T);
  check('hapus user3 → 200', r.status === 200, `got ${r.status}`);
  const cnt = (t: string) => (db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE user_id=?`).get(u3id) as any).c;
  check('exchanges ikut terhapus', cnt('exchanges') === 0, `got ${cnt('exchanges')}`);
  check('settings ikut terhapus', cnt('settings') === 0, `got ${cnt('settings')}`);
  r = await get('/bots', T3);
  check('token user terhapus → 401', r.status === 401, `got ${r.status}`);

  // ===== G) Quick-trade balance guard (paper, tanpa jaringan) =====
  console.log('\nG) Quick-trade guard');
  r = await post('/trade/quick', { exchange_id: 'indodax', pair: 'XRPIDR', side: 'buy', amount: 999999999 }, U);
  check('buy melebihi kas paper → 400 berpesan', r.status === 400 && /tidak cukup/i.test(r.data.error || ''), `got ${r.status} ${JSON.stringify(r.data)}`);
  r = await post('/trade/quick', { exchange_id: 'indodax', pair: 'XRPIDR', side: 'buy', amount: -5 }, U);
  check('amount negatif → 400', r.status === 400, `got ${r.status}`);
  r = await post('/trade/quick', { exchange_id: 'indodax', pair: 'XRPIDR', side: 'hold', amount: 100 }, U);
  check('side ilegal → 400', r.status === 400, `got ${r.status}`);

  server.close();
  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
