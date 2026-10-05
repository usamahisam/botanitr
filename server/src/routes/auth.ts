import { Router } from 'express';
import { db, queries, now, UserRow, ensureUserExchanges } from '../db/index.js';
import {
  hashPassword, verifyPassword, signToken, userCount,
  backfillLegacyToAdmin, authCookie, clearCookie, uid
} from '../auth.js';
import { requireAuth, requireAdmin, loginRateLimit } from '../auth.js';

export const authRouter = Router();
const asyncH = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next);

/** Status: butuh setup admin? */
authRouter.get('/auth/status', asyncH(async (_req: any, res: any) => {
  res.json({ needsSetup: userCount() === 0 });
}));

/** Setup awal: buat admin pertama (hanya jika belum ada user) + klaim data legacy */
authRouter.post('/auth/setup', loginRateLimit, asyncH(async (req: any, res: any) => {
  if (userCount() > 0) return res.status(400).json({ error: 'Setup sudah dilakukan. Login sebagai admin untuk menambah user.' });
  const { username, password } = req.body || {};
  if (!username || String(username).length < 3) return res.status(400).json({ error: 'Username minimal 3 karakter' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });
  const info = queries.insertUser.run(String(username).trim(), await hashPassword(String(password)), 'admin', now());
  const adminId = Number(info.lastInsertRowid);
  backfillLegacyToAdmin(adminId);
  ensureUserExchanges(adminId);
  const token = signToken({ id: adminId, username: String(username).trim(), role: 'admin' });
  res.setHeader('Set-Cookie', authCookie(token));
  res.status(201).json({ token, user: { id: adminId, username: String(username).trim(), role: 'admin' } });
}));

/** Login */
authRouter.post('/auth/login', loginRateLimit, asyncH(async (req: any, res: any) => {
  const { username, password } = req.body || {};
  const row = queries.getUserByName.get(String(username || '').trim()) as UserRow | undefined;
  if (!row || !(await verifyPassword(String(password || ''), row.pass_hash))) {
    return res.status(401).json({ error: 'Username atau password salah' });
  }
  const token = signToken({ id: row.id, username: row.username, role: row.role });
  res.setHeader('Set-Cookie', authCookie(token));
  res.json({ token, user: { id: row.id, username: row.username, role: row.role } });
}));

authRouter.post('/auth/logout', asyncH(async (_req: any, res: any) => {
  res.setHeader('Set-Cookie', clearCookie());
  res.json({ ok: true });
}));

authRouter.get('/auth/me', requireAuth, asyncH(async (req: any, res: any) => {
  res.json({ user: req.user });
}));

/** Ganti password sendiri */
authRouter.post('/auth/password', requireAuth, asyncH(async (req: any, res: any) => {
  const { current, password } = req.body || {};
  const row = queries.getUser.get(uid(req)) as UserRow | undefined;
  if (!row) return res.status(404).json({ error: 'User tidak ditemukan' });
  if (!(await verifyPassword(String(current || ''), row.pass_hash))) {
    return res.status(400).json({ error: 'Password saat ini salah' });
  }
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'Password baru minimal 6 karakter' });
  db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(await hashPassword(String(password)), row.id);
  res.json({ ok: true });
}));

/** Admin: tambah user baru */
authRouter.post('/auth/users', requireAuth, requireAdmin, asyncH(async (req: any, res: any) => {
  const { username, password, role } = req.body || {};
  if (!username || String(username).length < 3) return res.status(400).json({ error: 'Username minimal 3 karakter' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });
  const exists = queries.getUserByName.get(String(username).trim()) as UserRow | undefined;
  if (exists) return res.status(400).json({ error: 'Username sudah dipakai' });
  const info = queries.insertUser.run(String(username).trim(), await hashPassword(String(password)), role === 'admin' ? 'admin' : 'user', now());
  const newId = Number(info.lastInsertRowid);
  ensureUserExchanges(newId);
  res.status(201).json({ id: newId, username: String(username).trim(), role: role === 'admin' ? 'admin' : 'user' });
}));

/** Admin: daftar user */
authRouter.get('/auth/users', requireAuth, requireAdmin, asyncH(async (_req: any, res: any) => {
  res.json(queries.allUsers.all());
}));

/** Admin: hapus user (tidak boleh hapus diri sendiri / admin terakhir) */
authRouter.delete('/auth/users/:id', requireAuth, requireAdmin, asyncH(async (req: any, res: any) => {
  const id = Number(req.params.id);
  if (id === uid(req)) return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri' });
  const admins = (db.prepare(`SELECT COUNT(*) c FROM users WHERE role='admin'`).get() as any).c;
  const target = queries.getUser.get(id) as UserRow | undefined;
  if (!target) return res.status(404).json({ error: 'User tidak ditemukan' });
  if (target.role === 'admin' && admins <= 1) return res.status(400).json({ error: 'Tidak bisa menghapus admin terakhir' });
  // Hapus bersih seluruh data milik user (bot, trade, log, kredensial, dsb.)
  // agar API key terenkripsi & riwayatnya tak tertinggal yatim di DB.
  const del = (table: string) => db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(id);
  for (const t of ['bots', 'trades', 'logs', 'settings', 'exchanges', 'paper_balances', 'balance_snapshots', 'price_alerts']) del(t);
  db.prepare('DELETE FROM telegram_chats WHERE user_id=?').run(id);
  db.prepare('DELETE FROM market_ratings WHERE user_id=?').run(id);
  db.prepare('DELETE FROM market_presets WHERE user_id=?').run(id);
  db.prepare('DELETE FROM market_ratings WHERE preset_id NOT IN (SELECT id FROM market_presets)').run();
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  const { registry } = await import('../exchange/registry.js');
  registry.dropUser(id);
  res.json({ ok: true });
}));
