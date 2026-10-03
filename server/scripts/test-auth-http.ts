/**
 * E2E HTTP auth: setup admin → login → akses terproteksi → user kedua terisolasi.
 * Menjalankan express mini (authRouter + requireAuth) di port acak.
 *
 * Jalankan: npx tsx server/scripts/test-auth-http.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.BOTANI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'botani-auth-'));
process.env.SECRET_KEY = 'test-secret-key-minimal-32-chars-abcdef';

let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

async function main() {
  const express = (await import('express')).default;
  const { authRouter } = await import('../src/routes/auth.js');
  const { requireAuth, requireAdmin } = await import('../src/auth.js');

  const app = express();
  app.use(express.json());
  app.use('/api', authRouter);
  app.use('/api', requireAuth, (req: any, res: any, next: any) => {
    if (req.path === '/secret') return res.json({ uid: (req as any).user.id });
    if (req.path === '/admin-only') {
      if ((req as any).user.role !== 'admin') return res.status(403).json({ error: 'Hanya admin' });
      return res.json({ ok: true });
    }
    next();
  });

  const server = await new Promise<any>(r => {
    const s = app.listen(0, () => r(s));
  });
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

  // 1. Status awal: butuh setup
  let r = await get('/auth/status');
  check('status awal needsSetup=true', r.data.needsSetup === true, JSON.stringify(r.data));

  // 2. Tanpa token → 401
  r = await get('/secret');
  check('tanpa token → 401', r.status === 401, `got ${r.status}`);

  // 3. Setup admin
  r = await post('/auth/setup', { username: 'admin', password: 'admin123' });
  check('setup admin 201', r.status === 201, `got ${r.status} ${JSON.stringify(r.data)}`);
  const adminToken = r.data.token;
  check('setup mengembalikan token', typeof adminToken === 'string' && adminToken.length > 20);

  // 4. Setup kedua ditolak
  r = await post('/auth/setup', { username: 'x', password: 'xxxxxx' });
  check('setup kedua ditolak', r.status === 400, `got ${r.status}`);

  // 5. Akses terproteksi dengan token
  r = await get('/secret', adminToken);
  check('token valid → uid cocok', r.status === 200 && r.data.uid === 1, JSON.stringify(r.data));

  // 6. Login salah → 401
  r = await post('/auth/login', { username: 'admin', password: 'salah' });
  check('login salah → 401', r.status === 401, `got ${r.status}`);

  // 7. Login benar
  r = await post('/auth/login', { username: 'admin', password: 'admin123' });
  check('login benar → token', r.status === 200 && !!r.data.token, `got ${r.status}`);

  // 8. Admin buat user2
  r = await post('/auth/users', { username: 'trader', password: 'trader123' }, adminToken);
  check('admin buat user 201', r.status === 201 && r.data.username === 'trader', JSON.stringify(r.data));

  // 9. Login user2 → bukan admin → /admin-only 403
  const l2 = await post('/auth/login', { username: 'trader', password: 'trader123' });
  const u2 = await get('/admin-only', l2.data.token);
  check('non-admin → 403 di rute admin', u2.status === 403, `got ${u2.status}`);
  const a1 = await get('/admin-only', adminToken);
  check('admin lolos rute admin', a1.status === 200, `got ${a1.status}`);

  // 10. Token user2 akses /secret → uid=2 (isolasi)
  const s2 = await get('/secret', l2.data.token);
  check('token user2 → uid=2', s2.status === 200 && s2.data.uid === 2, JSON.stringify(s2.data));

  server.close();
  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
