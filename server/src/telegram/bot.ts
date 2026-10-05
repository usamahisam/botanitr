import { Telegraf } from 'telegraf';
import { db, queries, settings, now } from '../db/index.js';
import type { UserRow } from '../db/index.js';
import { registry } from '../exchange/registry.js';
import { log } from '../log.js';
import { fmtIDR, fmtPct } from '../utils/format.js';
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
    .then(() => log('info', 'TELEGRAM', `Bot Telegram aktif (${key})`))
    .catch(e => log('error', 'TELEGRAM', `Gagal launch (${key}): ${e.message}`));
  return inst;
}

function setupHandlers(inst: Telegraf) {
  inst.use((ctx, next) => { if (maskChat(ctx) !== null) return next(); });

  inst.start(ctx => ctx.reply(
    '🌱 Trading Botani siap!\n\n' +
    '/status — ringkasan bot & portfolio\n' +
    '/balance — saldo per exchange\n' +
    '/positions — posisi terbuka\n' +
    '/price <PAIR> — harga (mis. /price XRPIDR)\n' +
    '/pnl — profit & win rate\n' +
    '/pause [id] /resume [id] — kontrol bot\n' +
    '/stop [id] — hapus bot (konfirmasi)\n' +
    '/logs [n] — log terakhir\n' +
    '/panic — 🚨 kill switch (pause semua + batalkan order)\n' +
    '/help — bantuan'
  ));
  inst.help(ctx => ctx.reply('Perintah: /status /balance /positions /price /pnl /pause /resume /stop /logs /panic\nQuick trade dari dashboard web.'));

  inst.command('status', async ctx => ctx.reply(await buildStatus(ctx.state.userId)));
  inst.command('balance', async ctx => ctx.reply(await buildBalance(ctx.state.userId)));
  inst.command('positions', async ctx => ctx.reply(await buildPositions(ctx.state.userId)));
  inst.command('pnl', async ctx => ctx.reply(await buildPnl(ctx.state.userId)));

  inst.command('price', async ctx => {
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

  inst.command('pause', ctx => {
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

  inst.command('resume', ctx => {
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

  inst.command('stop', async ctx => {
    const userId = ctx.state.userId;
    const id = parseInt(ctx.payload || '', 10);
    if (!id) return ctx.reply('Format: /stop <id> — lihat ID di /positions.');
    const botRow = db.prepare('SELECT * FROM bots WHERE id=? AND user_id=?').get(id, userId) as any;
    if (!botRow) return ctx.reply('Bot tidak ditemukan.');
    let warn = '';
    try {
      const st = JSON.parse(botRow.state || '{}');
      const entries: any[] = st.entries || st.filledBuys || (st.position ? [st.position] : []);
      const qty = entries.reduce((s: number, e: any) => s + (e.qty || 0), 0);
      if (qty > 0) warn = `\n⚠️ Masih ada posisi ±${qty.toFixed(8)} — aset tetap di exchange, hanya berhenti dipantau.`;
    } catch { /* abaikan */ }
    await ctx.reply(
      `Hapus bot #${id} "${botRow.name}" (${botRow.pair})?${warn}`,
      { reply_markup: { inline_keyboard: [[{ text: '✅ Ya, hapus', callback_data: `stop_yes_${id}` }, { text: '❌ Batal', callback_data: 'stop_no' }]] } }
    );
  });

  inst.action('stop_no', async ctx => {
    await ctx.answerCbQuery('Dibatalkan');
    await ctx.editMessageText('✅ Penghapusan dibatalkan.');
  });
  inst.action(/^stop_yes_(\d+)$/, async ctx => {
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
    log('info', 'TELEGRAM', `Bot #${id} "${botRow.name}" dihapus via Telegram oleh chat ${ctx.chat.id}`, { user_id: userId });
    await ctx.editMessageText(`🗑 Bot #${id} "${botRow.name}" dihapus.`);
  });

  inst.command('panic', async ctx => {
    await ctx.reply(
      '🚨 KILL SWITCH akan ME-PAUSE semua bot & MEMBATALKAN semua open order live.\nLanjutkan?',
      { reply_markup: { inline_keyboard: [[{ text: '✅ Ya, AKTIFKAN', callback_data: 'panic_confirm' }, { text: '❌ Batal', callback_data: 'panic_cancel' }]] } }
    );
  });

  inst.action('panic_cancel', async ctx => {
    await ctx.answerCbQuery('Dibatalkan');
    await ctx.editMessageText('✅ Kill switch dibatalkan. Bot tetap berjalan.');
  });
  inst.action('panic_confirm', async ctx => {
    await ctx.answerCbQuery('Mengaktifkan…');
    const { activateKillSwitch } = await import('../engine/killswitch.js');
    const r = await activateKillSwitch(`Telegram @${ctx.from?.username || ctx.from?.id}`, ctx.state.userId);
    const total = Object.values(r.orders_cancelled).reduce((s, n) => s + n, 0);
    await ctx.editMessageText(`🚨 KILL SWITCH AKTIF\n${r.bots_paused} bot di-pause\n${total} open order dibatalkan${r.errors.length ? `\n⚠️ ${r.errors.join('; ')}` : ''}\n\nGunakan /resume untuk menjalankan lagi.`);
  });

  inst.command('logs', ctx => {
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
        try { await inst.telegram.sendMessage(chatId, text); } catch { /* abaikan */ }
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
      await inst.telegram.sendMessage(chatId, '✅ Tes koneksi Trading Botani berhasil!');
      n++;
    }
    return { ok: true, sent_to: n };
  } catch (e: any) {
    return { ok: false, error: friendlyTelegramError(e.message) };
  }
}

export type { UserRow };
