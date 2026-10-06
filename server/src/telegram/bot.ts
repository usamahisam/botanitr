import { Telegraf, Markup } from 'telegraf';
import { db, queries, settings, now } from '../db/index.js';
import type { UserRow } from '../db/index.js';
import { registry, KNOWN_EXCHANGES } from '../exchange/registry.js';
import { log } from '../log.js';
import { fmtIDR, fmtMoney, fmtPct, fmtTimeWib, quoteOfPair } from '../utils/format.js';
import { fetchExchangeBalance, getUsdtIdr } from '../engine/balances.js';
import { pnl } from '../engine/pnl.js';
import { setTelegramSender, notifyDailySummary, userChats, allChats } from './notify.js';
import { makeAgent } from '../exchange/http.js';
import { config } from '../config.js';

/** Instance bot per pemilik token: 'env' atau 'u<userId>'. Satu token = satu polling loop. */
const bots = new Map<string, { inst: Telegraf; token: string }>();
let summaryTimer: NodeJS.Timeout | null = null;

/** Proxy Telegram milik user (atau default env bila kosong) */
function userProxy(userId: number): string {
  return settings.get('proxy_telegram', '', userId) || config.defaultProxy;
}

/**
 * Kumpulkan token yang harus dijalankan: token env + token milik tiap user.
 * Token yang sama hanya dijalankan sekali (hindari konflik polling 409).
 */
export function collectBotTokens(): { key: string; token: string; proxy: string }[] {
  const out: { key: string; token: string; proxy: string }[] = [];
  const seen = new Set<string>();
  if (config.telegramToken) {
    seen.add(config.telegramToken);
    out.push({ key: 'env', token: config.telegramToken, proxy: config.defaultProxy });
  }
  const users = db.prepare('SELECT id FROM users').all() as any[];
  const ids = users.length > 0 ? users.map(u => u.id) : [0];
  for (const uid of ids) {
    const t = settings.get('telegram_bot_token', '', uid);
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push({ key: `u${uid}`, token: t, proxy: userProxy(uid) });
    }
  }
  return out;
}

/** Resolve user dari chat id (telegram_chats, fallback pindai settings semua user) */
export function userIdForChat(chatId: string): number | null {
  const row = db.prepare('SELECT user_id FROM telegram_chats WHERE chat_id=?').get(chatId) as any;
  if (row) return row.user_id;
  // Fallback: cocokkan dengan allowed list tiap user
  const users = db.prepare('SELECT id FROM users').all() as any[];
  const ids = users.length > 0 ? users.map(u => u.id) : [0];
  for (const uid of ids) {
    const list = settings.get('telegram_allowed_chat_ids', '', uid).split(',').map(s => s.trim());
    if (list.includes(chatId)) {
      db.prepare('INSERT OR IGNORE INTO telegram_chats (chat_id, user_id) VALUES (?,?)').run(chatId, uid);
      return uid;
    }
  }
  return null;
}

/** Sinkronkan telegram_chats dari allowed list milik user */
export function syncUserChats(userId: number) {
  const list = settings.get('telegram_allowed_chat_ids', '', userId).split(',').map(s => s.trim()).filter(Boolean);
  const ins = db.prepare('INSERT OR IGNORE INTO telegram_chats (chat_id, user_id) VALUES (?,?)');
  for (const c of list) ins.run(c, userId);
  // Hapus mapping user ini yang tak lagi di allowed (jangan sentuh milik user lain)
  if (list.length > 0) {
    const placeholders = list.map(() => '?').join(',');
    db.prepare(`DELETE FROM telegram_chats WHERE user_id=? AND chat_id NOT IN (${placeholders})`).run(userId, ...list);
  }
}

function maskChat(ctx: any): number | null {
  const id = String(ctx.chat?.id ?? '');
  const userId = userIdForChat(id);
  if (userId === null) {
    ctx.reply('Akses ditolak. Chat ID Anda: ' + id + '\nTambahkan Chat ID ini di Pengaturan → Telegram.').catch(() => {});
    return null;
  }
  ctx.state.userId = userId;
  return userId;
}

/** True bila chat ini milik akun admin (hanya pantau, tanpa aksi trading). */
function isAdminChat(ctx: any): boolean {
  const userId = ctx.state?.userId;
  if (userId == null) return false;
  try {
    const row = db.prepare('SELECT role FROM users WHERE id=?').get(userId) as any;
    return row?.role === 'admin';
  } catch {
    return false;
  }
}

const ADMIN_READONLY = 'Akun admin hanya pantau — aksi trading (pause/resume/hapus/kill switch) khusus akun user.';

/** Guard handler aksi trading via Telegram untuk akun admin. True = lolos. */
export async function guardTrader(ctx: any): Promise<boolean> {
  if (isAdminChat(ctx)) {
    try {
      if (typeof ctx.answerCbQuery === 'function') await ctx.answerCbQuery(ADMIN_READONLY);
      else await ctx.reply(ADMIN_READONLY);
    } catch { /* abaikan */ }
    return false;
  }
  return true;
}

function userExchangeIds(userId: number): string[] {
  const rows = db.prepare('SELECT id FROM exchanges WHERE user_id=?').all(userId) as any[];
  return rows.length > 0 ? rows.map(r => r.id) : [...KNOWN_EXCHANGES];
}

/** Escape teks untuk parse_mode HTML (nama bot dll. diketik user) */
export function esc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Daftar perintah resmi bot — tampil sebagai saran otomatis saat mengetik "/"
 * di Telegram (tombol Menu). Didaftarkan via setMyCommands tiap launch.
 */
export const BOT_COMMANDS = [
  { command: 'start', description: 'Mulai & tampilkan menu utama' },
  { command: 'menu', description: 'Tampilkan tombol menu' },
  { command: 'status', description: 'Ringkasan bot & total portfolio' },
  { command: 'balance', description: 'Saldo & koin per exchange' },
  { command: 'positions', description: 'Posisi terbuka tiap bot' },
  { command: 'bots', description: 'Daftar bot + tombol pause/resume' },
  { command: 'price', description: 'Cek harga — /price XRPIDR' },
  { command: 'pnl', description: 'Profit, PnL hari ini & win rate' },
  { command: 'pause', description: 'Pause bot — /pause [id] (kosong = semua)' },
  { command: 'resume', description: 'Lanjutkan bot — /resume [id] (kosong = semua)' },
  { command: 'stop', description: 'Hapus bot — /stop <id>' },
  { command: 'logs', description: 'Log terakhir — /logs [jumlah]' },
  { command: 'panic', description: 'Kill switch darurat' },
  { command: 'help', description: 'Panduan lengkap semua perintah' },
];

/** Keyboard menu persisten (tombol di bawah kolom chat) */
function mainMenuKeyboard() {
  return Markup.keyboard([
    ['Status', 'Saldo'],
    ['Posisi', 'Bot Saya'],
    ['PnL', 'Log'],
    ['Bantuan'],
  ]).resize().reply_markup;
}

const HELP_TEXT =
  `<b>PANDUAN TRADING BOTANI</b>\n\n` +
  `<b>Pantau</b>\n` +
  `/status — ringkasan bot &amp; total portfolio\n` +
  `/balance — saldo &amp; koin per exchange\n` +
  `/positions — posisi terbuka tiap bot\n` +
  `/bots — daftar bot + tombol pause/resume\n` +
  `/price <code>PAIR</code> — harga, mis. <code>/price XRPIDR</code>\n` +
  `/pnl — profit, rugi/laba hari ini &amp; win rate\n` +
  `/logs <code>[n]</code> — log terakhir (maks 15)\n\n` +
  `<b>Kontrol</b>\n` +
  `/pause <code>[id]</code> — pause satu bot / semua bila kosong\n` +
  `/resume <code>[id]</code> — lanjutkan satu bot / semua\n` +
  `/stop <code>&lt;id&gt;</code> — hapus bot (dengan konfirmasi)\n` +
  `/panic — kill switch: pause SEMUA + batalkan order live\n\n` +
  `<b>Tips</b>\n` +
  `• Ketik <code>/</code> untuk melihat semua perintah\n` +
  `• Gunakan tombol menu di bawah untuk akses cepat\n` +
  `• ID bot bisa dilihat di /bots atau /positions\n` +
  `• Pengaturan lengkap (exchange, budget, strategi) di dashboard web\n` +
  `• Akun admin hanya pantau: pause/resume/hapus/kill switch khusus akun user`;

const WELCOME_TEXT =
  `<b>Trading Botani siap.</b>\n\n` +
  `Pantau &amp; kendalikan bot trading Anda langsung dari sini.\n` +
  `Ketik <code>/</code> untuk daftar perintah, atau pakai tombol menu di bawah.\n\n` +
  `<b>Mulai cepat:</b> /status · /balance · /bots · /help`;

function statusIcon(s: string): string {
  return s === 'running' ? '[ON]' : s === 'paused' ? '[OFF]' : '[--]';
}

async function buildStatus(userId: number): Promise<string> {
  const bots = (db.prepare('SELECT * FROM bots WHERE user_id=?').all(userId) as any[]);
  const running = bots.filter(b => b.status === 'running').length;
  const paused = bots.filter(b => b.status === 'paused').length;
  let totalIdr = 0;
  const lines = [
    `<b>STATUS BOTANI</b>`,
    `Aktif: <b>${running}</b> · Pause: <b>${paused}</b> · Total: <b>${bots.length}</b>`,
    `────────────────`,
  ];
  for (const id of userExchangeIds(userId)) {
    try {
      const v = await fetchExchangeBalance(id, userId);
      totalIdr += v.saldo_total_idr;
      const badge = v.mode === 'paper' ? '[DEMO]' : '[RIIL]';
      lines.push(`<b>${esc(v.name)}</b> ${badge}${v.error ? ' [error]' : ''}`);
      if (v.error) lines.push(`  <i>${esc(v.error)}</i>`);
      else lines.push(`  Saldo <b>${fmtIDR(v.saldo_total_idr)}</b> · Kas ${fmtIDR(v.kas_bebas_idr)}`);
    } catch (e: any) {
      lines.push(`<b>${esc(id)}</b> [error] <i>${esc(e.message)}</i>`);
    }
  }
  lines.push(`────────────────`, `<b>Total Portfolio: ${fmtIDR(totalIdr)}</b>`);
  return lines.join('\n');
}

async function buildBalance(userId: number): Promise<string> {
  const lines = [`<b>SALDO PER EXCHANGE</b>`, ''];
  for (const id of userExchangeIds(userId)) {
    try {
      const v = await fetchExchangeBalance(id, userId);
      lines.push(`── <b>${esc(v.name)}</b> ──`);
      if (v.error) { lines.push(`[error] <i>${esc(v.error)}</i>`, ''); continue; }
      lines.push(`Kas Bebas: <b>${fmtIDR(v.kas_bebas_idr)}</b>`);
      const top = v.coins.filter(c => c.symbol !== v.quote_asset).slice(0, 6);
      for (const c of top) lines.push(`  <code>${esc(c.symbol)}</code> ${c.qty.toFixed(6)} ≈ ${fmtIDR(c.value_idr)}`);
      lines.push(`Total: <b>${fmtIDR(v.saldo_total_idr)}</b>`, '');
    } catch (e: any) {
      lines.push(`── <b>${esc(id)}</b> ──`, `[error] <i>${esc(e.message)}</i>`, '');
    }
  }
  return lines.join('\n');
}

async function buildPositions(userId: number): Promise<string> {
  const bots = (db.prepare('SELECT * FROM bots WHERE user_id=?').all(userId) as any[]).filter(b => b.status !== 'stopped');
  if (bots.length === 0) return 'Tidak ada posisi/bot aktif.\nBuat bot baru di dashboard web atau /help.';
  const lines = [`<b>POSISI BOT</b>`, ''];
  for (const b of bots) {
    let entries: any[] = [];
    try {
      const state = JSON.parse(b.state || '{}');
      entries = state.entries || state.filledBuys || (state.position ? [state.position] : []);
    } catch { /* state korup → tampilkan tanpa posisi */ }
    const qty = entries.reduce((s: number, e: any) => s + (Number(e.qty) || 0), 0);
    const cost = entries.reduce((s: number, e: any) => s + (Number(e.cost) || 0), 0);
    // Nominal dalam quote pair (USDT untuk *USDT) — JANGAN dikali kurs.
    // (Kode lama mengalikan semua non-Indodax dengan kurs → Bittime/IDR ikut rusak.)
    const quote = quoteOfPair(b.pair);
    lines.push(`${statusIcon(b.status)} <b>#${b.id} ${esc(b.name)}</b>`);
    lines.push(`  <code>${esc(b.pair)}</code> · ${esc(b.strategy)} · ${esc(b.status)}`);
    lines.push(`  Budget ${fmtMoney(b.current_budget, quote)}`);
    if (qty > 0) lines.push(`  Posisi <code>${qty.toFixed(8)}</code> (modal ${fmtMoney(cost, quote)})`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Daftar bot + tombol aksi inline per bot (dipakai /bots) */
function buildBotsKeyboard(userId: number) {
  const bots = (db.prepare('SELECT * FROM bots WHERE user_id=? ORDER BY id DESC LIMIT 10').all(userId) as any[]);
  if (bots.length === 0) return null;
  const rows = bots.map(b => {
    const btn = b.status === 'running'
      ? { text: `Pause #${b.id}`, callback_data: `bot_p_${b.id}` }
      : { text: `Jalan #${b.id}`, callback_data: `bot_r_${b.id}` };
    return [btn, { text: `Hapus #${b.id}`, callback_data: `bot_s_${b.id}` }];
  });
  return { inline_keyboard: rows };
}

async function buildPnl(userId: number): Promise<string> {
  const usdtIdr = await getUsdtIdr();
  const wr = pnl.winRate(undefined, userId);
  const lines = [`<b>PROFIT &amp; WIN RATE</b>`, ''];
  let totalRealizedIdr = 0;
  for (const id of userExchangeIds(userId)) {
    try {
      const client = registry.get(id);
      // Per-exchange tampil dalam quote aslinya (USDT tetap USDT);
      // total gabungan (beda quote) dikonversi ke Rp.
      const quote = client.quoteAsset === 'USDT' ? 'USDT' : 'IDR';
      const r = pnl.realized(id, undefined, userId);
      const today = pnl.realizedToday(id, userId);
      const mult = quote === 'IDR' ? 1 : usdtIdr;
      totalRealizedIdr += r * mult;
      const label = id === 'indodax' ? 'Indodax' : id === 'tokocrypto' ? 'Tokocrypto' : id === 'binance' ? 'Binance' : id;
      const emo = r >= 0 ? '[+]' : '[-]';
      lines.push(`${emo} <b>${esc(label)}</b>`);
      lines.push(`  Total <b>${fmtMoney(r, quote)}</b> · Hari ini ${fmtMoney(today, quote)}`);
    } catch (e: any) {
      lines.push(`[error] <b>${esc(id)}</b> <i>${esc(e.message)}</i>`);
    }
  }
  lines.push('', `<b>Total Realized: ${fmtIDR(totalRealizedIdr)}</b>`);
  lines.push(`Win Rate: <b>${wr.wins}/${wr.total}</b> (${fmtPct(wr.rate * 100)})`);
  return lines.join('\n');
}

/** Format baris log DB menjadi teks HTML ringkas (urut terbaru → terlama) */
export function formatLogs(rows: any[]): string {
  return rows.map(r => {
    const t = fmtTimeWib(String(r.created_at || ''));
    const icon = r.level === 'error' ? '[ERR]' : r.level === 'warn' ? '[WARN]' : '[INFO]';
    return `<code>${esc(t)}</code> ${icon} [${esc(r.tag)}] ${esc(String(r.message || '').slice(0, 120))}`;
  }).join('\n');
}

function ensureInstance(key: string, token: string, proxy: string): Telegraf {
  const existing = bots.get(key);
  if (existing) {
    if (existing.token === token) return existing.inst;
    try { existing.inst.stop(); } catch { /* abaikan */ }
    bots.delete(key);
  }
  const agent = makeAgent(proxy);
  const inst = new Telegraf(token, agent ? { telegram: { agent } as any } : {});
  setupHandlers(inst);
  bots.set(key, { inst, token });
  inst.launch()
    .then(async () => {
      log('info', 'TELEGRAM', `Bot Telegram aktif (${key})`);
      // Daftarkan menu perintah "/" (tombol Menu di kolom chat)
      try { await inst.telegram.setMyCommands(BOT_COMMANDS); }
      catch (e: any) { log('warn', 'TELEGRAM', `setMyCommands gagal (${key}): ${e.message}`); }
    })
    .catch(e => log('error', 'TELEGRAM', `Gagal launch (${key}): ${e.message}`));
  return inst;
}

function setupHandlers(inst: Telegraf) {
  inst.use((ctx, next) => { if (maskChat(ctx) !== null) return next(); });
  const html = { parse_mode: 'HTML' } as const;

  inst.start(ctx => ctx.reply(WELCOME_TEXT, { ...html, reply_markup: mainMenuKeyboard() }));
  inst.help(ctx => ctx.reply(HELP_TEXT, html));
  inst.command('menu', ctx => ctx.reply('<b>Menu utama</b> — pilih tombol di bawah:', { ...html, reply_markup: mainMenuKeyboard() }));

  inst.command('status', async ctx => ctx.reply(await buildStatus(ctx.state.userId), html));
  inst.command('balance', async ctx => ctx.reply(await buildBalance(ctx.state.userId), html));
  inst.command('positions', async ctx => ctx.reply(await buildPositions(ctx.state.userId), html));
  inst.command('pnl', async ctx => ctx.reply(await buildPnl(ctx.state.userId), html));

  // Tombol keyboard menu → handler yang sama dengan perintah slash
  inst.hears('Status', async ctx => ctx.reply(await buildStatus(ctx.state.userId), html));
  inst.hears('Saldo', async ctx => ctx.reply(await buildBalance(ctx.state.userId), html));
  inst.hears('Posisi', async ctx => ctx.reply(await buildPositions(ctx.state.userId), html));
  inst.hears('PnL', async ctx => ctx.reply(await buildPnl(ctx.state.userId), html));
  inst.hears('Bot Saya', async ctx => {
    const kb = buildBotsKeyboard(ctx.state.userId);
    if (!kb) return ctx.reply('Belum ada bot.\nBuat bot baru di dashboard web atau /help.', html);
    await ctx.reply(await buildPositions(ctx.state.userId), { ...html, reply_markup: kb });
  });
  inst.hears('Log', async ctx => {
    const rows = db.prepare('SELECT * FROM logs WHERE (user_id=? OR user_id=0) ORDER BY id DESC LIMIT 5').all(ctx.state.userId) as any[];
    if (rows.length === 0) return ctx.reply('Belum ada log.');
    await ctx.reply(`<b>5 LOG TERAKHIR</b>\n\n${formatLogs(rows)}`, html);
  });
  inst.hears('Bantuan', ctx => ctx.reply(HELP_TEXT, html));

  inst.command('bots', async ctx => {
    const kb = buildBotsKeyboard(ctx.state.userId);
    if (!kb) return ctx.reply('Belum ada bot.\nBuat bot baru di dashboard web atau /help.', html);
    await ctx.reply(await buildPositions(ctx.state.userId), { ...html, reply_markup: kb });
  });

  // Aksi inline per bot dari /bots (pause / resume / hapus)
  const botToggle = async (ctx: any, id: number, to: 'paused' | 'running') => {
    if (!(await guardTrader(ctx))) return;
    const userId = ctx.state?.userId;
    if (!userId || !id) { await ctx.answerCbQuery('Sesi kedaluwarsa, ulangi /bots.'); return; }
    const botRow = db.prepare('SELECT * FROM bots WHERE id=? AND user_id=?').get(id, userId) as any;
    if (!botRow) { await ctx.answerCbQuery('Bot tidak ditemukan.'); return; }
    queries.setBotStatus.run(to, now(), id);
    await ctx.answerCbQuery(to === 'paused' ? `Bot #${id} di-pause` : `Bot #${id} dilanjutkan`);
    try { await ctx.editMessageReplyMarkup(buildBotsKeyboard(userId) ?? undefined); } catch { /* abaikan */ }
  };
  inst.action(/^bot_p_(\d+)$/, async ctx => botToggle(ctx, Number((ctx as any).match?.[1]), 'paused'));
  inst.action(/^bot_r_(\d+)$/, async ctx => botToggle(ctx, Number((ctx as any).match?.[1]), 'running'));
  inst.action(/^bot_s_(\d+)$/, async ctx => {
    if (!(await guardTrader(ctx))) return;
    const userId = (ctx as any).state?.userId;
    const id = Number((ctx as any).match?.[1]);
    if (!userId || !id) { await ctx.answerCbQuery('Sesi kedaluwarsa, ulangi /bots.'); return; }
    const botRow = db.prepare('SELECT * FROM bots WHERE id=? AND user_id=?').get(id, userId) as any;
    if (!botRow) { await ctx.answerCbQuery('Bot tidak ditemukan.'); return; }
    await ctx.answerCbQuery('Menghapus…');
    queries.deleteBot.run(id);
    log('info', 'TELEGRAM', `Bot #${id} "${botRow.name}" dihapus via Telegram oleh @${(ctx as any).from?.username || (ctx as any).from?.id}`, { user_id: userId });
    try {
      await ctx.editMessageText(`Bot #${id} "${esc(botRow.name)}" dihapus.`, html);
    } catch { /* abaikan */ }
  });

  inst.command('price', async ctx => {
    const pair = (ctx.payload || '').toUpperCase().trim();
    if (!pair) return ctx.reply('Format: <code>/price XRPIDR</code>\nContoh: <code>/price BTCIDR</code> atau <code>/price BTCUSDT</code>', html);
    // Coba semua exchange milik user (tebak dulu dari suffix pair)
    const ids = userExchangeIds(ctx.state.userId);
    const ordered = [...ids].sort((a, b) => {
      const score = (id: string) => {
        if (pair.endsWith('USDT')) return id === 'tokocrypto' || id === 'binance' ? 0 : 1;
        return id === 'indodax' ? 0 : 1;
      };
      return score(a) - score(b);
    });
    const errors: string[] = [];
    for (const exchangeId of ordered) {
      try {
        const client = registry.getForUser(exchangeId, ctx.state.userId);
        const t = await client.getTicker(pair);
        const quote = quoteOfPair(pair);
        return ctx.reply(
          `Harga <b>${esc(pair)}</b> <i>via ${esc(exchangeId)}</i>\n` +
          `Last: <b>${fmtMoney(t.last, quote)}</b>\n` +
          `Bid: ${fmtMoney(t.bid, quote)} · Ask: ${fmtMoney(t.ask, quote)}\n` +
          `24J: ${fmtMoney(t.low24, quote)} – ${fmtMoney(t.high24, quote)}`,
          html
        );
      } catch (e: any) {
        errors.push(`${exchangeId}: ${e.message}`);
      }
    }
    ctx.reply(`Gagal ambil harga <b>${esc(pair)}</b> di semua exchange:\n<i>${esc(errors.slice(0, 3).join('; '))}</i>`, html);
  });

  inst.command('pause', async ctx => {
    if (!(await guardTrader(ctx))) return;
    const userId = ctx.state.userId;
    const id = parseInt(ctx.payload || '', 10);
    if (id) {
      const botRow = db.prepare('SELECT * FROM bots WHERE id=? AND user_id=?').get(id, userId) as any;
      if (!botRow) return ctx.reply('Bot tidak ditemukan. Lihat ID di /bots.', html);
      queries.setBotStatus.run('paused', now(), id);
      ctx.reply(`<b>#${id} ${esc(botRow.name)}</b> di-pause.`, html);
    } else {
      const info = db.prepare(`UPDATE bots SET status='paused' WHERE status='running' AND user_id=?`).run(userId);
      ctx.reply(`<b>${info.changes} bot</b> di-pause.`, html);
    }
    log('info', 'TELEGRAM', `Pause via Telegram ${id ? '#' + id : '(semua)'} oleh chat ${ctx.chat.id}`, { user_id: userId });
  });

  inst.command('resume', async ctx => {
    if (!(await guardTrader(ctx))) return;
    const userId = ctx.state.userId;
    const id = parseInt(ctx.payload || '', 10);
    if (id) {
      const botRow = db.prepare('SELECT * FROM bots WHERE id=? AND user_id=?').get(id, userId) as any;
      if (!botRow) return ctx.reply('Bot tidak ditemukan. Lihat ID di /bots.', html);
      queries.setBotStatus.run('running', now(), id);
      ctx.reply(`<b>#${id} ${esc(botRow.name)}</b> dilanjutkan.`, html);
    } else {
      const info = db.prepare(`UPDATE bots SET status='running' WHERE status='paused' AND user_id=?`).run(userId);
      ctx.reply(`<b>${info.changes} bot</b> dilanjutkan.`, html);
    }
  });

  inst.command('stop', async ctx => {
    if (!(await guardTrader(ctx))) return;
    const userId = ctx.state.userId;
    const id = parseInt(ctx.payload || '', 10);
    if (!id) return ctx.reply('Format: <code>/stop &lt;id&gt;</code> — lihat ID di /bots.', html);
    const botRow = db.prepare('SELECT * FROM bots WHERE id=? AND user_id=?').get(id, userId) as any;
    if (!botRow) return ctx.reply('Bot tidak ditemukan.', html);
    let warn = '';
    try {
      const st = JSON.parse(botRow.state || '{}');
      const entries: any[] = st.entries || st.filledBuys || (st.position ? [st.position] : []);
      const qty = entries.reduce((s: number, e: any) => s + (Number(e.qty) || 0), 0);
      if (qty > 0) warn = `\n\nCatatan: masih ada posisi <code>±${qty.toFixed(8)}</code> — aset tetap di exchange, hanya berhenti dipantau.`;
    } catch { /* abaikan */ }
    await ctx.reply(
      `Hapus bot <b>#${id} "${esc(botRow.name)}"</b> (<code>${esc(botRow.pair)}</code>)?${warn}`,
      { ...html, reply_markup: { inline_keyboard: [[{ text: 'Ya, hapus', callback_data: `stop_yes_${id}` }, { text: 'Batal', callback_data: 'stop_no' }]] } }
    );
  });

  inst.action('stop_no', async ctx => {
    await ctx.answerCbQuery('Dibatalkan');
    await ctx.editMessageText('Penghapusan dibatalkan.');
  });
  inst.action(/^stop_yes_(\d+)$/, async ctx => {
    if (!(await guardTrader(ctx))) return;
    const userId = (ctx as any).state?.userId;
    const m = (ctx as any).match as RegExpMatchArray | undefined;
    const id = Number(m?.[1]);
    if (!userId || !id) {
      await ctx.answerCbQuery('Sesi kedaluwarsa, ulangi /stop.');
      return;
    }
    const botRow = db.prepare('SELECT * FROM bots WHERE id=? AND user_id=?').get(id, userId) as any;
    if (!botRow) {
      await ctx.answerCbQuery('Bot tidak ditemukan.');
      await ctx.editMessageText('Bot tidak ditemukan (mungkin sudah dihapus).');
      return;
    }
    await ctx.answerCbQuery('Menghapus…');
    queries.deleteBot.run(id);
    log('info', 'TELEGRAM', `Bot #${id} "${botRow.name}" dihapus via Telegram oleh @${(ctx as any).from?.username || (ctx as any).from?.id}`, { user_id: userId });
    await ctx.editMessageText(`Bot <b>#${id} "${esc(botRow.name)}"</b> dihapus.`, { parse_mode: 'HTML' });
  });

  inst.command('panic', async ctx => {
    if (!(await guardTrader(ctx))) return;
    await ctx.reply(
      '<b>KILL SWITCH</b> akan:\n' +
      '• Pause <b>semua bot</b>\n' +
      '• Batalkan <b>semua open order live</b>\n\nLanjutkan?',
      { ...html, reply_markup: { inline_keyboard: [[{ text: 'Ya, aktifkan', callback_data: 'panic_confirm' }, { text: 'Batal', callback_data: 'panic_cancel' }]] } }
    );
  });

  inst.action('panic_cancel', async ctx => {
    await ctx.answerCbQuery('Dibatalkan');
    await ctx.editMessageText('Kill switch dibatalkan. Bot tetap berjalan.');
  });
  inst.action('panic_confirm', async ctx => {
    if (!(await guardTrader(ctx))) return;
    const userId = (ctx as any).state?.userId;
    if (!userId) {
      await ctx.answerCbQuery('Sesi kedaluwarsa, ulangi /panic.');
      return;
    }
    await ctx.answerCbQuery('Mengaktifkan…');
    const { activateKillSwitch } = await import('../engine/killswitch.js');
    const r = await activateKillSwitch(`Telegram @${ctx.from?.username || ctx.from?.id}`, userId);
    const total = Object.values(r.orders_cancelled).reduce((s, n) => s + n, 0);
    await ctx.editMessageText(
      `<b>KILL SWITCH AKTIF</b>\n` +
      `<b>${r.bots_paused} bot</b> di-pause\n` +
      `<b>${total} open order</b> dibatalkan` +
      `${r.errors.length ? `\n<i>${esc(r.errors.join('; '))}</i>` : ''}\n\n` +
      `Gunakan /resume untuk menjalankan lagi.`,
      html
    );
  });

  inst.command('logs', ctx => {
    const n = Math.min(parseInt(ctx.payload || '5', 10) || 5, 15);
    const rows = db.prepare('SELECT * FROM logs WHERE (user_id=? OR user_id=0) ORDER BY id DESC LIMIT ?').all(ctx.state.userId, n) as any[];
    if (rows.length === 0) return ctx.reply('Belum ada log.');
    ctx.reply(`<b>${n} LOG TERAKHIR</b>\n\n${formatLogs(rows)}`, html);
  });
} // end setupHandlers

export function startTelegram(): boolean {
  for (const t of collectBotTokens()) ensureInstance(t.key, t.token, t.proxy);
  if (bots.size === 0) {
    log('warn', 'TELEGRAM', 'Token Telegram kosong — fitur Telegram dimatikan');
    return false;
  }

  // Sender untuk notifikasi otomatis — dirutekan ke instance milik user
  setTelegramSender(async (userId: number | null, text: string) => {
    // Kumpulkan target per instance agar tiap chat dikirimi sekali
    const targets = new Map<Telegraf, Set<string>>();
    const addTarget = (inst: Telegraf | undefined, chats: string[]) => {
      if (!inst || chats.length === 0) return;
      let set = targets.get(inst);
      if (!set) { set = new Set(); targets.set(inst, set); }
      for (const c of chats) set.add(c);
    };
    if (userId !== null) {
      const own = bots.get(`u${userId}`);
      addTarget(own?.inst ?? bots.get('env')?.inst, userChats(userId));
    } else {
      const users = db.prepare('SELECT id FROM users').all() as any[];
      const ids = users.length > 0 ? users.map(u => u.id) : [0];
      for (const uid of ids) {
        const own = bots.get(`u${uid}`);
        addTarget(own?.inst ?? bots.get('env')?.inst, userChats(uid));
      }
    }
    for (const [inst, chats] of targets) {
      for (const chatId of chats) {
        try {
          // Coba render HTML dulu (ringkasan & status kaya format); bila gagal
          // (tag tak valid dari teks dinamis), kirim versi teks polos.
          await inst.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
        } catch {
          try { await inst.telegram.sendMessage(chatId, text.replace(/<[^>]*>/g, '')); } catch { /* abaikan */ }
        }
      }
    }
  });

  if (summaryTimer) clearInterval(summaryTimer);



  // Ringkasan harian per user yang punya chat terdaftar
  summaryTimer = setInterval(async () => {
    const wib = new Date(Date.now() + 7 * 3600 * 1000);
    const hhmm = wib.toISOString().slice(11, 16);
    const today = wib.toISOString().slice(0, 10);
    const users = db.prepare('SELECT id FROM users').all() as any[];
    const ids = users.length > 0 ? users.map(u => u.id) : [0];
    for (const userId of ids) {
      const dailyTime = settings.get('daily_summary_time', '00:00', userId);
      if (hhmm !== dailyTime) continue;
      if (settings.get('last_summary_date', '', userId) === today) continue;
      if (userChats(userId).length === 0) continue;
      settings.set('last_summary_date', today, userId);
      await notifyDailySummary(await buildPnl(userId), userId);
    }
  }, 60000);

  return true;
}

export async function stopTelegram() {
  if (summaryTimer) { clearInterval(summaryTimer); summaryTimer = null; }
  for (const [, b] of bots) {
    try { b.inst.stop(); } catch { /* abaikan */ }
  }
  bots.clear();
  setTelegramSender(null);
}

export async function restartTelegram(): Promise<boolean> {
  await stopTelegram();
  return startTelegram();
}

/** Terjemahkan error Telegram menjadi panduan Bahasa Indonesia */
export function friendlyTelegramError(message: string): string {
  const m = message || '';
  if (/bot can't send messages to the bot/i.test(m)) {
    return 'Chat ID yang diisi adalah milik BOT (bot tidak bisa mengirimi bot lain). ' +
      'Gunakan Chat ID akun Anda sendiri: chat ke @userinfobot, salin angka "Id", ' +
      'lalu kirim /start ke bot trading ini dan isi angka tersebut di Pengaturan.';
  }
  if (/chat not found/i.test(m)) {
    return 'Chat tidak ditemukan: kirim /start (atau pesan apa saja) ke bot trading ini dulu, ' +
      'lalu ulangi tes kirim.';
  }
  if (/blocked by the user|user is deactivated/i.test(m)) {
    return 'Bot diblokir atau akun nonaktif: buka blokir bot / kirim /start ke bot, lalu ulangi.';
  }
  if (/unauthorized|invalid token/i.test(m)) {
    return 'Token tidak valid (401). Periksa kembali token dari @BotFather.';
  }
  return m;
}

/** Kirim pesan tes memakai bot milik user (fallback token env bila user belum isi) */
export async function sendTestMessage(userId = 0): Promise<{ ok: boolean; error?: string; sent_to?: number }> {
  let token = settings.get('telegram_bot_token', '', userId);
  let key = `u${userId}`;
  if (!token && config.telegramToken) { token = config.telegramToken; key = 'env'; }
  if (!token) return { ok: false, error: 'Token belum diisi' };
  const chats = userChats(userId);
  if (chats.length === 0) return { ok: false, error: 'Chat ID allowed kosong' };
  const inst = ensureInstance(key, token, key === 'env' ? config.defaultProxy : userProxy(userId));
  try {
    let n = 0;
    for (const chatId of chats) {
      await inst.telegram.sendMessage(chatId, 'Tes koneksi Trading Botani berhasil.');
      n++;
    }
    return { ok: true, sent_to: n };
  } catch (e: any) {
    return { ok: false, error: friendlyTelegramError(e.message) };
  }
}

export type { UserRow };
