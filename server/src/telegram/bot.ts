import { Telegraf } from 'telegraf';
import { db, queries, settings, now, UserRow } from '../db/index.js';
import { registry } from '../exchange/registry.js';
import { log } from '../log.js';
import { fmtIDR, fmtPct } from '../utils/format.js';
import { fetchExchangeBalance, getUsdtIdr } from '../engine/balances.js';
import { pnl } from '../engine/pnl.js';
import { setTelegramSender, notifyDailySummary, userChats, allChats } from './notify.js';
import { makeAgent } from '../exchange/http.js';
import { config } from '../config.js';

let bot: Telegraf | null = null;
let summaryTimer: NodeJS.Timeout | null = null;

/** Token bot: dari env, atau milik admin (user pertama) */
function botToken(): string {
  if (config.telegramToken) return config.telegramToken;
  const admin = db.prepare(`SELECT id FROM users ORDER BY id ASC LIMIT 1`).get() as any;
  if (admin) {
    const t = settings.get('telegram_bot_token', '', admin.id);
    if (t) return t;
  }
  return settings.get('telegram_bot_token', '', 0);
}

function botProxy(): string {
  if (config.defaultProxy) return config.defaultProxy;
  const admin = db.prepare(`SELECT id FROM users ORDER BY id ASC LIMIT 1`).get() as any;
  if (admin) {
    const p = settings.get('proxy_telegram', '', admin.id);
    if (p) return p;
  }
  return settings.get('proxy_telegram', '', 0);
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
    ctx.reply('⛔ Akses ditolak. Chat ID Anda: ' + id + '\nTambahkan Chat ID ini di Pengaturan → Telegram.').catch(() => {});
    return null;
  }
  ctx.state.userId = userId;
  return userId;
}

function userExchangeIds(userId: number): string[] {
  const rows = db.prepare('SELECT id FROM exchanges WHERE user_id=?').all(userId) as any[];
  return rows.length > 0 ? rows.map(r => r.id) : ['indodax', 'tokocrypto', 'binance'];
}

async function buildStatus(userId: number): Promise<string> {
  const bots = (db.prepare('SELECT * FROM bots WHERE user_id=?').all(userId) as any[]);
  const running = bots.filter(b => b.status === 'running').length;
  const paused = bots.filter(b => b.status === 'paused').length;
  const usdtIdr = await getUsdtIdr();
  let totalIdr = 0;
  const lines = ['🤖 STATUS BOTANI', `Bot aktif: ${running} | pause: ${paused} | total: ${bots.length}`, ''];
  for (const id of userExchangeIds(userId)) {
    const v = await fetchExchangeBalance(id, userId);
    totalIdr += v.saldo_total_idr;
    lines.push(`${v.name} [${v.mode === 'paper' ? 'DEMO' : 'RIIL'}${v.error ? ' ⚠️' : ''}]`);
    lines.push(`  Saldo: ${fmtIDR(v.saldo_total_idr)} | Kas: ${fmtIDR(v.kas_bebas_idr)}`);
  }
  lines.push('', `💼 Total Portfolio: ${fmtIDR(totalIdr)}`);
  return lines.join('\n');
}

async function buildBalance(userId: number): Promise<string> {
  const lines = ['💰 SALDO PER EXCHANGE', ''];
  for (const id of userExchangeIds(userId)) {
    const v = await fetchExchangeBalance(id, userId);
    lines.push(`── ${v.name} ──`);
    if (v.error) { lines.push(`  ⚠️ ${v.error}`); continue; }
    lines.push(`  Kas Bebas: ${fmtIDR(v.kas_bebas_idr)}`);
    const top = v.coins.filter(c => c.symbol !== v.quote_asset).slice(0, 6);
    for (const c of top) lines.push(`  ${c.symbol}: ${c.qty.toFixed(6)} ≈ ${fmtIDR(c.value_idr)}`);
    lines.push(`  Total: ${fmtIDR(v.saldo_total_idr)}`, '');
  }
  return lines.join('\n');
}

async function buildPositions(userId: number): Promise<string> {
  const bots = (db.prepare('SELECT * FROM bots WHERE user_id=?').all(userId) as any[]).filter(b => b.status !== 'stopped');
  if (bots.length === 0) return '📭 Tidak ada posisi/bot aktif.';
  const usdtIdr = await getUsdtIdr();
  const lines = ['📌 POSISI BOT', ''];
  for (const b of bots) {
    const state = JSON.parse(b.state || '{}');
    const entries: any[] = state.entries || state.filledBuys || (state.position ? [state.position] : []);
    const qty = entries.reduce((s: number, e: any) => s + (e.qty || 0), 0);
    const cost = entries.reduce((s: number, e: any) => s + (e.cost || 0), 0);
    lines.push(`#${b.id} ${b.name} [${b.status}]`);
    lines.push(`  ${b.pair} · ${b.strategy} · budget ${fmtIDR(b.current_budget * (b.exchange_id === 'indodax' ? 1 : usdtIdr))}`);
    if (qty > 0) lines.push(`  Posisi: ${qty.toFixed(8)} (modal ${fmtIDR(cost * (b.exchange_id === 'indodax' ? 1 : usdtIdr))})`);
  }
  return lines.join('\n');
}

async function buildPnl(userId: number): Promise<string> {
  const usdtIdr = await getUsdtIdr();
  const wr = pnl.winRate(undefined, userId);
  const lines = ['📊 PROFIT & WIN RATE', ''];
  let totalRealizedIdr = 0;
  for (const id of userExchangeIds(userId)) {
    const client = registry.get(id);
    const r = pnl.realized(id, undefined, userId);
    const today = pnl.realizedToday(id, userId);
    const mult = client.quoteAsset === 'IDR' ? 1 : usdtIdr;
    const idr = r * mult;
    const todayIdr = today * mult;
    totalRealizedIdr += idr;
    const label = id === 'indodax' ? 'Indodax' : id === 'tokocrypto' ? 'Tokocrypto' : 'Binance';
    lines.push(`${label}: total ${fmtIDR(idr)} | hari ini ${fmtIDR(todayIdr)}`);
  }
  lines.push('', `Total Realized: ${fmtIDR(totalRealizedIdr)}`);
  lines.push(`Win Rate: ${wr.wins}/${wr.total} (${fmtPct(wr.rate * 100)})`);
  return lines.join('\n');
}

export function startTelegram(): boolean {
  const token = botToken();
  if (!token) {
    log('warn', 'TELEGRAM', 'Token Telegram kosong — fitur Telegram dimatikan');
    return false;
  }

  const agent = makeAgent(botProxy());
  bot = new Telegraf(token, agent ? { telegram: { agent } as any } : {});

  bot.use((ctx, next) => { if (maskChat(ctx) !== null) return next(); });

  bot.start(ctx => ctx.reply(
    '🌱 Trading Botani siap!\n\n' +
    '/status — ringkasan bot & portfolio\n' +
    '/balance — saldo per exchange\n' +
    '/positions — posisi terbuka\n' +
    '/price <PAIR> — harga (mis. /price XRPIDR)\n' +
    '/pnl — profit & win rate\n' +
    '/pause [id] /resume [id] — kontrol bot\n' +
    '/logs [n] — log terakhir\n' +
    '/panic — 🚨 kill switch (pause semua + batalkan order)\n' +
    '/help — bantuan'
  ));
  bot.help(ctx => ctx.reply('Perintah: /status /balance /positions /price /pnl /pause /resume /logs /panic\nQuick trade dari dashboard web.'));

  bot.command('status', async ctx => ctx.reply(await buildStatus(ctx.state.userId)));
  bot.command('balance', async ctx => ctx.reply(await buildBalance(ctx.state.userId)));
  bot.command('positions', async ctx => ctx.reply(await buildPositions(ctx.state.userId)));
  bot.command('pnl', async ctx => ctx.reply(await buildPnl(ctx.state.userId)));

  bot.command('price', async ctx => {
    const pair = (ctx.payload || '').toUpperCase().trim();
    if (!pair) return ctx.reply('Format: /price XRPIDR');
    const exchangeId = pair.endsWith('USDT') ? 'tokocrypto' : 'indodax';
    try {
      const t = await registry.getForUser(exchangeId, ctx.state.userId).getTicker(pair);
      const usdtIdr = exchangeId === 'indodax' ? 1 : await getUsdtIdr();
      ctx.reply(`💹 ${pair}\nLast: ${fmtIDR(t.last * usdtIdr)}\nBid: ${fmtIDR(t.bid * usdtIdr)} | Ask: ${fmtIDR(t.ask * usdtIdr)}\n24J: ${fmtIDR(t.low24 * usdtIdr)} – ${fmtIDR(t.high24 * usdtIdr)}`);
    } catch (e: any) {
      ctx.reply(`⚠️ Gagal ambil harga: ${e.message}`);
    }
  });

  bot.command('pause', ctx => {
    const userId = ctx.state.userId;
    const id = parseInt(ctx.payload || '', 10);
    if (id) {
      const botRow = db.prepare('SELECT * FROM bots WHERE id=? AND user_id=?').get(id, userId) as any;
      if (!botRow) return ctx.reply('Bot tidak ditemukan.');
      queries.setBotStatus.run('paused', now(), id);
      ctx.reply(`⏸ Bot #${id} di-pause.`);
    } else {
      db.prepare(`UPDATE bots SET status='paused' WHERE status='running' AND user_id=?`).run(userId);
      ctx.reply('⏸ Semua bot di-pause.');
    }
    log('info', 'TELEGRAM', `Pause via Telegram ${id ? '#' + id : '(semua)'} oleh chat ${ctx.chat.id}`, { user_id: userId });
  });

  bot.command('resume', ctx => {
    const userId = ctx.state.userId;
    const id = parseInt(ctx.payload || '', 10);
    if (id) {
      const botRow = db.prepare('SELECT * FROM bots WHERE id=? AND user_id=?').get(id, userId) as any;
      if (!botRow) return ctx.reply('Bot tidak ditemukan.');
      queries.setBotStatus.run('running', now(), id);
      ctx.reply(`▶️ Bot #${id} dilanjutkan.`);
    } else {
      db.prepare(`UPDATE bots SET status='running' WHERE status='paused' AND user_id=?`).run(userId);
      ctx.reply('▶️ Semua bot dilanjutkan.');
    }
  });

  bot.command('panic', async ctx => {
    await ctx.reply(
      '🚨 KILL SWITCH akan ME-PAUSE semua bot & MEMBATALKAN semua open order live.\nLanjutkan?',
      { reply_markup: { inline_keyboard: [[{ text: '✅ Ya, AKTIFKAN', callback_data: 'panic_confirm' }, { text: '❌ Batal', callback_data: 'panic_cancel' }]] } }
    );
  });

  bot.action('panic_cancel', async ctx => {
    await ctx.answerCbQuery('Dibatalkan');
    await ctx.editMessageText('✅ Kill switch dibatalkan. Bot tetap berjalan.');
  });
  bot.action('panic_confirm', async ctx => {
    await ctx.answerCbQuery('Mengaktifkan…');
    const { activateKillSwitch } = await import('../engine/killswitch.js');
    const r = await activateKillSwitch(`Telegram @${ctx.from?.username || ctx.from?.id}`, ctx.state.userId);
    const total = Object.values(r.orders_cancelled).reduce((s, n) => s + n, 0);
    await ctx.editMessageText(`🚨 KILL SWITCH AKTIF\n${r.bots_paused} bot di-pause\n${total} open order dibatalkan${r.errors.length ? `\n⚠️ ${r.errors.join('; ')}` : ''}\n\nGunakan /resume untuk menjalankan lagi.`);
  });

  bot.command('logs', ctx => {
    const n = Math.min(parseInt(ctx.payload || '5', 10) || 5, 15);
    const rows = db.prepare('SELECT * FROM logs WHERE (user_id=? OR user_id=0) ORDER BY id DESC LIMIT ?').all(ctx.state.userId, n) as any[];
    if (rows.length === 0) return ctx.reply('📭 Belum ada log.');
    const text = rows.reverse().map(r => {
      const t = r.created_at.slice(11, 19);
      const icon = r.level === 'error' ? '❌' : r.level === 'warn' ? '⚠️' : 'ℹ️';
      return `${t} ${icon} [${r.tag}] ${r.message.slice(0, 120)}`;
    }).join('\n');
    ctx.reply(`📜 ${n} LOG TERAKHIR\n\n${text}`);
  });

  // Sender untuk notifikasi otomatis — terisolasi per user
  setTelegramSender(async (userId: number | null, text: string) => {
    if (!bot) return;
    const chats = userId === null ? allChats() : userChats(userId);
    for (const chatId of chats) {
      try { await bot.telegram.sendMessage(chatId, text); } catch { /* abaikan */ }
    }
  });

  bot.launch().then(() => log('info', 'TELEGRAM', 'Bot Telegram aktif (polling)'))
    .catch(e => log('error', 'TELEGRAM', `Gagal launch: ${e.message}`));

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
  if (summaryTimer) clearInterval(summaryTimer);
  if (bot) { bot.stop(); bot = null; setTelegramSender(null); }
}

export async function restartTelegram(): Promise<boolean> {
  await stopTelegram();
  return startTelegram();
}

/** Kirim pesan tes ke chat milik user */
export async function sendTestMessage(userId = 0): Promise<{ ok: boolean; error?: string; sent_to?: number }> {
  const token = botToken();
  if (!token) return { ok: false, error: 'Token belum diisi' };
  if (!bot) startTelegram();
  const chats = userChats(userId);
  if (chats.length === 0) return { ok: false, error: 'Chat ID allowed kosong' };
  try {
    let n = 0;
    for (const chatId of chats) {
      await bot!.telegram.sendMessage(chatId, '✅ Tes koneksi Trading Botani berhasil!');
      n++;
    }
    return { ok: true, sent_to: n };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export { UserRow };
