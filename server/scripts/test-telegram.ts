/**
 * Regresi bug: token Telegram milik user non-admin tidak pernah dipakai
 * (botToken() lama hanya membaca env/admin/legacy).
 * Tes: collectBotTokens() harus memuat token tiap user + dedupe + proxy per-user.
 *
 * Jalankan: npx tsx server/scripts/test-telegram.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.BOTANI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'botani-tg-'));
delete process.env.TELEGRAM_BOT_TOKEN;

let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

async function main() {
  const { db, queries, settings, now } = await import('../src/db/index.js');
  const { hashPassword } = await import('../src/auth.js');
  const { collectBotTokens } = await import('../src/telegram/bot.js');

  // Setup: admin tanpa token, user2 dengan token + proxy sendiri
  const a = queries.insertUser.run('admin', await hashPassword('admin123'), 'admin', now());
  const adminId = Number(a.lastInsertRowid);
  const u = queries.insertUser.run('trader', await hashPassword('trader123'), 'user', now());
  const userId = Number(u.lastInsertRowid);
  settings.set('telegram_bot_token', 'TOKEN-USER2', userId);
  settings.set('proxy_telegram', 'socks5://127.0.0.1:1080', userId);
  settings.set('telegram_allowed_chat_ids', '111,222', userId);

  let list = collectBotTokens();
  check('token user non-admin terkumpul', list.some(t => t.key === `u${userId}` && t.token === 'TOKEN-USER2'),
    JSON.stringify(list));
  check('proxy per-user terbawa', list.find(t => t.key === `u${userId}`)?.proxy === 'socks5://127.0.0.1:1080');
  check('admin tanpa token tidak dibuatkan instance', !list.some(t => t.key === `u${adminId}`));

  // Dedupe: user lain pakai token sama → satu instance saja
  const u3 = queries.insertUser.run('trader2', await hashPassword('x123456'), 'user', now());
  settings.set('telegram_bot_token', 'TOKEN-USER2', Number(u3.lastInsertRowid));
  list = collectBotTokens();
  check('token kembar hanya satu instance', list.filter(t => t.token === 'TOKEN-USER2').length === 1,
    JSON.stringify(list.map(t => t.key)));

  // Tanpa token sama sekali → list kosong (fitur mati, bukan crash)
  db.prepare('DELETE FROM settings WHERE key=?').run('telegram_bot_token');
  list = collectBotTokens();
  check('tanpa token → tidak ada instance', list.length === 0, `got ${list.length}`);

  // Pesan error Telegram diterjemahkan menjadi panduan (tanpa network)
  const { friendlyTelegramError } = await import('../src/telegram/bot.js');
  check('chat ID milik bot → panduan userinfobot',
    /milik BOT/i.test(friendlyTelegramError('403: Forbidden: the bot can\'t send messages to the bot')) &&
    /userinfobot/i.test(friendlyTelegramError('403: Forbidden: the bot can\'t send messages to the bot')));
  check('chat not found → panduan /start',
    /\/start/i.test(friendlyTelegramError('400: Bad Request: chat not found')));
  check('error tak dikenal diteruskan apa adanya',
    friendlyTelegramError('timeout of 15000ms exceeded') === 'timeout of 15000ms exceeded');

  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
