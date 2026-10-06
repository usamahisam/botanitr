/**
 * Cakupan admin: tanpa trading, kelola market & user.
 *  A) Admin: matikan market -> user tak bisa buat bot di sana
 *  B) Pairs CRUD: user 403, admin bisa tambah/hapus
 *  C) Scheduler lewati market nonaktif (via shouldTick? tidak — cek query)
 *
 * Jalankan: npx tsx server/scripts/test-admin-scope.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.BOTANI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'botani-adminscope-'));
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
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  await rq('POST', '/auth/setup', { username: 'admin', password: 'admin123' });
  const la = await rq('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  const A = la.data.token;
  await rq('POST', '/auth/users', { username: 'trader', password: 'trader123', role: 'user' }, A);
  const lu = await rq('POST', '/auth/login', { username: 'trader', password: 'trader123' });
  const T = lu.data.token;

  console.log('A) Market on/off');
  let r = await rq('PUT', '/exchanges/bittime', { enabled: 0 }, T);
  check('user matikan market sendiri 200', r.status === 200, `got ${r.status} ${JSON.stringify(r.data)}`);
  r = await rq('POST', '/bots', { name: 'X', exchange_id: 'bittime', pair: 'BTCIDR', strategy: 'grid', params: {}, budget_idr: 1000, mode: 'paper' }, T);
  check('buat bot di market mati → 400', r.status === 400 && /nonaktif/i.test(r.data.error || ''), `got ${r.status} ${r.data.error || ''}`);
  r = await rq('PUT', '/exchanges/bittime', { enabled: 1, apply_all: true }, A);
  check('admin aktifkan untuk semua 200', r.status === 200, `got ${r.status}`);
  r = await rq('POST', '/bots', { name: 'X', exchange_id: 'bittime', pair: 'BTCIDR', strategy: 'grid', params: {}, budget_idr: 1000, mode: 'paper' }, T);
  check('setelah aktif bisa lagi 201', r.status === 201, `got ${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);

  console.log('\nB) Pairs CRUD');
  r = await rq('POST', '/pairs', { exchange_id: 'indodax', symbol: 'PEPEIDR', base: 'PEPE', quote: 'IDR' }, T);
  check('user tambah koin → 403', r.status === 403, `got ${r.status}`);
  r = await rq('POST', '/pairs', { exchange_id: 'indodax', symbol: 'PEPEIDR', base: 'PEPE', quote: 'IDR', label: 'Pepe', min_lot: 10000 }, A);
  check('admin tambah koin 201', r.status === 201 && !!r.data.id, `got ${r.status}`);
  const pid = r.data.id;
  r = await rq('POST', '/pairs', { exchange_id: 'indodax', symbol: 'PEPEIDR', base: 'PEPE', quote: 'IDR' }, A);
  check('duplikat → 400', r.status === 400, `got ${r.status}`);
  r = await rq('DELETE', `/pairs/${pid}`, undefined, T);
  check('user hapus koin → 403', r.status === 403, `got ${r.status}`);
  r = await rq('DELETE', `/pairs/${pid}`, undefined, A);
  check('admin hapus koin 200', r.status === 200, `got ${r.status}`);
  r = await rq('DELETE', `/pairs/${pid}`, undefined, A);
  check('hapus yang tak ada → 404', r.status === 404, `got ${r.status}`);

  server.close();
  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
