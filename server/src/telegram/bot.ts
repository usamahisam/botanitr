import { Telegraf } from 'telegraf';
import { db, queries, settings, now } from '../db/index.js';
import { registry } from '../exchange/registry.js';
import { log } from '../log.js';
import { fmtIDR, fmtPct } from '../utils/format.js';
import { fetchExchangeBalance, getUsdtIdr } from '../engine/balances.js';
import { pnl } from '../engine/pnl.js';
import { setTelegramSender, notifyDailySummary } from './notify.js';
import { makeAgent } from '../exchange/http.js';
import { config } from '../config.js';

let bot: Telegraf | null = null;
let summaryTimer: NodeJS.Timeout | null = null;

function allowedChats(): Set<string> {
  const fromDb = settings.get('telegram_allowed_chat_ids', '');
  const merged = [...config.telegramAllowedChats, ...fromDb.split(',')].map(s => s.trim()).filter(Boolean);
  return new Set(merged);
}

function maskChat(ctx: any): boolean {
  const id = String(ctx.chat?.id ?? '');
  if (allowedChats().has(id)) return true;
  ctx.reply('⛔ Akses ditolak. Chat ID Anda: ' + id + '\nTambahkan ke Pengaturan → Telegram.').catch(() => {});
  return false;
}

async function buildStatus(): Promise<string> {
  const bots = queries.allBots.all() as any[];
  const running = bots.filter(b => b.status === 'running').length;
  const paused = bots.filter(b => b.status === 'paused').length;
  const usdtIdr = await getUsdtIdr();
  let totalIdr = 0;
  const lines = ['🤖 STATUS BOTANI', `Bot aktif: ${running} | pause: ${paused} | total: ${bots.length}`, ''];
  for (const client of registry.list()) {
    const v = await fetchExchangeBalance(client.id);
    totalIdr += v.saldo_total_idr;
    lines.push(`${v.name} [${v.mode === 'paper' ? 'DEMO' : 'RIIL'}${v.error ? ' ⚠️' : ''}]`);
    lines.push(`  Saldo: ${fmtIDR(v.saldo_total_idr)} | Kas: ${fmtIDR(v.kas_bebas_idr)}`);
  }
  lines.push('', `💼 Total Portfolio: ${fmtIDR(totalIdr)}`);
  return lines.join('\n');
}

async function buildBalance(): Promise<string> {
  const lines = ['💰 SALDO PER EXCHANGE', ''];
  for (const client of registry.list()) {
    const v = await fetchExchangeBalance(client.id);
    lines.push(`── ${v.name} ──`);
    if (v.error) { lines.push(`  ⚠️ ${v.error}`); continue; }
    lines.push(`  Kas Bebas: ${fmtIDR(v.kas_bebas_idr)}`);
    const top = v.coins.filter(c => c.symbol !== v.quote_asset).slice(0, 6);
    for (const c of top) lines.push(`  ${c.symbol}: ${c.qty.toFixed(6)} ≈ ${fmtIDR(c.value_idr)}`);
    lines.push(`  Total: ${fmtIDR(v.saldo_total_idr)}`, '');
  }
  return lines.join('\n');
}

async function buildPositions(): Promise<string> {
  const bots = (queries.allBots.all() as any[]).filter(b => b.status !== 'stopped');
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

async function buildPnl(): Promise<string> {
  const usdtIdr = await getUsdtIdr();
  const wr = pnl.winRate();
  const lines = ['📊 PROFIT & WIN RATE', ''];
  let totalRealizedIdr = 0;
  for (const client of registry.list()) {
    const r = pnl.realized(client.id);
    const today = pnl.realizedToday(client.id);
    const idr = r * (client.quoteAsset === 'IDR' ? 1 : usdtIdr);
    const todayIdr = today * (client.quoteAsset === 'IDR' ? 1 : usdtIdr);
    totalRealizedIdr += idr;
    lines.push(`${client.id === 'indodax' ? 'Indodax' : 'Tokocrypto'}: total ${fmtIDR(idr)} | hari ini ${fmtIDR(todayIdr)}`);
  }
  lines.push('', `Total Realized: ${fmtIDR(totalRealizedIdr)}`);
  lines.push(`Win Rate: ${wr.wins}/${wr.total} (${fmtPct(wr.rate * 100)})`);
  return lines.join('\n');
}

export function startTelegram(): boolean {
  const token = settings.get('telegram_bot_token') || config.telegramToken;
  if (!token) {
    log('warn', 'TELEGRAM', 'Token Telegram kosong — fitur Telegram dimatikan');
    return false;
  }

  const proxy = settings.get('proxy_telegram') || config.defaultProxy;
  const agent = makeAgent(proxy);
  bot = new Telegraf(token, agent ? { telegram: { agent } as any } : {});

  bot.use((ctx, next) => { if (maskChat(ctx)) return next(); });

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

  bot.command('status', async ctx => ctx.reply(await buildStatus()));
  bot.command('balance', async ctx => ctx.reply(await buildBalance()));
  bot.command('positions', async ctx => ctx.reply(await buildPositions()));
  bot.command('pnl', async ctx => ctx.reply(await buildPnl()));

  bot.command('price', async ctx => {
    const pair = (ctx.payload || '').toUpperCase().trim();
    if (!pair) return ctx.reply('Format: /price XRPIDR');
    const exchangeId = pair.endsWith('USDT') ? 'tokocrypto' : 'indodax';
    try {
      const t = await registry.get(exchangeId).getTicker(pair);
      const usdtIdr = exchangeId === 'indodax' ? 1 : await getUsdtIdr();
      ctx.reply(`💹 ${pair}\nLast: ${fmtIDR(t.last * usdtIdr)}\nBid: ${fmtIDR(t.bid * usdtIdr)} | Ask: ${fmtIDR(t.ask * usdtIdr)}\n24J: ${fmtIDR(t.low24 * usdtIdr)} – ${fmtIDR(t.high24 * usdtIdr)}`);
    } catch (e: any) {
      ctx.reply(`⚠️ Gagal ambil harga: ${e.message}`);
    }
  });

  bot.command('pause', ctx => {
    const id = parseInt(ctx.payload || '', 10);
    if (id) {
      queries.setBotStatus.run('paused', now(), id);
      ctx.reply(`⏸ Bot #${id} di-pause.`);
    } else {
      db.prepare(`UPDATE bots SET status='paused' WHERE status='running'`).run();
      ctx.reply('⏸ Semua bot di-pause.');
    }
    log('info', 'TELEGRAM', `Pause via Telegram ${id ? '#' + id : '(semua)'} oleh chat ${ctx.chat.id}`);
  });

  bot.command('resume', ctx => {
    const id = parseInt(ctx.payload || '', 10);
    if (id) {
      queries.setBotStatus.run('running', now(), id);
      ctx.reply(`▶️ Bot #${id} dilanjutkan.`);
    } else {
      db.prepare(`UPDATE bots SET status='running' WHERE status='paused'`).run();
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
    const r = await activateKillSwitch(`Telegram @${ctx.from?.username || ctx.from?.id}`);
    const total = Object.values(r.orders_cancelled).reduce((s, n) => s + n, 0);
    await ctx.editMessageText(`🚨 KILL SWITCH AKTIF\n${r.bots_paused} bot di-pause\n${total} open order dibatalkan${r.errors.length ? `\n⚠️ ${r.errors.join('; ')}` : ''}\n\nGunakan /resume untuk menjalankan lagi.`);
  });

  bot.command('logs', ctx => {
    const n = Math.min(parseInt(ctx.payload || '5', 10) || 5, 15);
    const rows = db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').all(n) as any[];
    if (rows.length === 0) return ctx.reply('📭 Belum ada log.');
    const text = rows.reverse().map(r => {
      const t = r.created_at.slice(11, 19);
      const icon = r.level === 'error' ? '❌' : r.level === 'warn' ? '⚠️' : 'ℹ️';
      return `${t} ${icon} [${r.tag}] ${r.message.slice(0, 120)}`;
    }).join('\n');
    ctx.reply(`📜 ${n} LOG TERAKHIR\n\n${text}`);
  });

  // Sender untuk notifikasi otomatis
  setTelegramSender(async (text: string) => {
    if (!bot) return;
    for (const chatId of allowedChats()) {
      await bot.telegram.sendMessage(chatId, text);
    }
  });

  bot.launch().then(() => log('info', 'TELEGRAM', 'Bot Telegram aktif (polling)'))
    .catch(e => log('error', 'TELEGRAM', `Gagal launch: ${e.message}`));

  // Ringkasan harian 00:00 WIB
  const dailyTime = settings.get('daily_summary_time', '00:00');
  summaryTimer = setInterval(async () => {
    const wib = new Date(Date.now() + 7 * 3600 * 1000);
    const hhmm = wib.toISOString().slice(11, 16);
    const today = wib.toISOString().slice(0, 10);
    if (hhmm === dailyTime && settings.get('last_summary_date') !== today) {
      settings.set('last_summary_date', today);
      await notifyDailySummary(await buildPnl());
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

/** Kirim pesan tes ke semua chat yang diizinkan */
export async function sendTestMessage(): Promise<{ ok: boolean; error?: string; sent_to?: number }> {
  const token = settings.get('telegram_bot_token') || config.telegramToken;
  if (!token) return { ok: false, error: 'Token belum diisi' };
  if (!bot) startTelegram();
  const chats = allowedChats();
  if (chats.size === 0) return { ok: false, error: 'Chat ID allowed kosong' };
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
