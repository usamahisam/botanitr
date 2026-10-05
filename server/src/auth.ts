import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db, queries, now, UserRow } from './db/index.js';
import { config } from './config.js';

export interface AuthUser { id: number; username: string; role: string }

function jwtSecret(): string {
  if (!config.secretKey || config.secretKey.length < 32) {
    throw new Error('SECRET_KEY minimal 32 karakter untuk JWT');
  }
  return config.secretKey;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ uid: user.id, username: user.username, role: user.role }, jwtSecret(), { expiresIn: '30d' });
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const p = jwt.verify(token, jwtSecret()) as any;
    if (!p || typeof p.uid !== 'number') return null;
    return { id: p.uid, username: p.username, role: p.role || 'user' };
  } catch {
    return null;
  }
}

export function userCount(): number {
  return (db.prepare('SELECT COUNT(*) c FROM users').get() as any).c;
}

/** Pindahkan data legacy (user_id=0) ke admin pertama + seed exchange miliknya */
export function backfillLegacyToAdmin(adminId: number) {
  for (const t of ['settings', 'exchanges', 'bots', 'trades', 'logs', 'balance_snapshots', 'paper_balances', 'price_alerts']) {
    db.prepare(`UPDATE ${t} SET user_id=? WHERE user_id=0`).run(adminId);
  }
}

function extractToken(req: any): string | null {
  const h = req.headers?.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  const cookie = req.headers?.cookie;
  if (cookie) {
    const m = cookie.split(';').map((s: string) => s.trim()).find((s: string) => s.startsWith('botani_token='));
    if (m) return decodeURIComponent(m.slice('botani_token='.length));
  }
  return null;
}

/** Middleware: wajib login. Path publik: /health, /auth/status|setup|login|logout */
const PUBLIC_AUTH = new Set(['/auth/status', '/auth/setup', '/auth/login', '/auth/logout']);
export function requireAuth(req: any, res: any, next: any) {
  const raw: string = req.path || '';
  const path = raw.length > 1 ? raw.replace(/\/+$/, '') : raw;
  if (path === '/health' || PUBLIC_AUTH.has(path)) return next();
  const token = extractToken(req);
  const user = token ? verifyToken(token) : null;
  if (!user) return res.status(401).json({ error: 'Perlu login', code: 'AUTH_REQUIRED' });
  // Pastikan user masih ada
  const row = queries.getUser.get(user.id) as UserRow | undefined;
  if (!row) return res.status(401).json({ error: 'Akun tidak ditemukan', code: 'AUTH_REQUIRED' });
  req.user = { id: row.id, username: row.username, role: row.role };
  next();
}

export function requireAdmin(req: any, res: any, next: any) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Hanya admin' });
  }
  next();
}

export function uid(req: any): number {
  return req.user.id;
}

/**
 * Rate limit sederhana in-memory untuk endpoint sensitif (login/setup).
 * Tanpa ini, halaman login yang terekspos ke internet bisa di-brute-force.
 * Batas: 10 percobaan per IP per 5 menit; lebihnya ditolak 429.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();
export function loginRateLimit(req: any, res: any, next: any) {
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
  const nowMs = Date.now();
  const cur = attempts.get(ip);
  if (!cur || nowMs >= cur.resetAt) {
    attempts.set(ip, { count: 1, resetAt: nowMs + 5 * 60 * 1000 });
    // Bersihkan entri basi sesekali agar Map tak membesar
    if (attempts.size > 5000) {
      for (const [k, v] of attempts) if (v.resetAt <= nowMs) attempts.delete(k);
    }
    return next();
  }
  cur.count++;
  if (cur.count > 10) {
    return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi dalam 5 menit.' });
  }
  next();
}

export const COOKIE_NAME = 'botani_token';
export function authCookie(token: string): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`;
}
export function clearCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
