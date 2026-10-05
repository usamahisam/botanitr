import { db, settings } from '../db/index.js';
import { fmtMoney, fmtQty, quoteOfPair } from '../utils/format.js';
import { Action } from '../strategies/types.js';

/** Modul ini di-bridge ke bot telegram agar tidak circular import */
type Sender = (userId: number | null, text: string) => Promise<void>;
let sender: Sender | null = null;
export function setTelegramSender(fn: Sender | null) { sender = fn; }

/** Kirim notifikasi. userId null = ke semua chat terdaftar (untuk pesan sistem). */
export async function notify(text: string, userId?: number | null) {
  if (!sender) return;
  try { await sender(userId ?? null, text); } catch { /* abaikan error telegram */ }
}

/** Chat Telegram milik user (dari telegram_chats + settings miliknya) */
export function userChats(userId: number): string[] {
  const linked = (db.prepare('SELECT chat_id FROM telegram_chats WHERE user_id=?').all(userId) as any[]).map(r => String(r.chat_id));
  const fromSettings = settings.get('telegram_allowed_chat_ids', '', userId).split(',').map(s => s.trim()).filter(Boolean);
  return [...new Set([...linked, ...fromSettings])];
}

export function allChats(): string[] {
  const rows = db.prepare('SELECT chat_id FROM telegram_chats').all() as any[];
  const s = new Set<string>(rows.map(r => String(r.chat_id)));
  // Fallback legacy: settings global (user_id=0) bila belum ada mapping
  if (s.size === 0) {
    for (const c of settings.get('telegram_allowed_chat_ids', '', 0).split(',')) {
      const t = c.trim();
      if (t) s.add(t);
    }
  }
  return [...s];
}

const TAG_TITLES: Record<string, string> = {
  INVENTORY_HARVEST_RECYCLE: '🌾 INVENTORY HARVESTER: MODAL KEMBALI CAIR',
  GRID_SELL: '📊 GRID: LEVEL PANEN',
  GRID_UNWIND: '📊 GRID UNWIND: LIKUIDASI BREAKEVEN',
  DCA_TP: '🎯 DCA: TARGET PROFIT TERCAPAI',
  DCA_TP1: '🎯 DCA: PANEN PARSIAL',
  SCALPER_TP: '⚡ SCALPER: TAKE PROFIT',
  SCALPER_SL: '🛑 SCALPER: STOP LOSS',
  SCALPER_EXIT: '↩️ SCALPER: EXIT SIGNAL',
  REVERT_TP: '🔄 REVERT: PANTULAN DIKUNCI',
  REVERT_SL: '🛑 REVERT: STOP DARURAT',
  REVERT_EXIT: '🔄 REVERT: EXIT MOMENTUM',
  BB_EXIT: '📉 BOLLINGER: EXIT BAND',
  BB_SL: '🛑 BOLLINGER: STOP DARURAT',
  BRK_TP: '🚀 BREAKOUT: TAKE PROFIT',
  BRK_SL: '🛑 BREAKOUT: STOP DARURAT',
  BRK_EXIT: '🚀 BREAKOUT: MOMENTUM HABIS',
  DYN_SELL: '🔄 DYNAMIC: LEVEL PANEN',
  DYN_SL: '🛑 DYNAMIC: STOP DARURAT',
  REBALANCE: '⚖️ REBALANCE PORTFOLIO',
  AUTO_COMPOUND: '📈 AUTO-COMPOUND'
};

/**
 * Notifikasi trade SADAR QUOTE: nilai ditampilkan dalam quote pair
 * (USDT untuk pair *USDT, IDR untuk *IDR) — bukan semuanya di-Rp-kan.
 */
export async function notifyTrade(trade: any, action: Action, _usdtIdr: number) {
  const title = TAG_TITLES[action.tag] || (trade.side === 'buy' ? '🟢 BELI' : '🔴 JUAL');
  const exchange = trade.exchange_id.toUpperCase();
  const base = trade.pair.replace(/IDR$|USDT$/, '');
  const quote = quoteOfPair(trade.pair);
  const modeBadge = trade.mode === 'paper' ? '📄 DEMO' : '💰 RIIL';
  const lines = [
    `${title}`,
    `Bursa: ${exchange} ${modeBadge}`,
    `Aset: ${base} (${fmtQty(trade.qty)})`,
    `Harga ${trade.side === 'buy' ? 'Beli' : 'Jual'}: ${fmtMoney(trade.price, quote)}`
  ];
  if (trade.side === 'sell') {
    lines.push(`Nilai: ${fmtMoney(trade.value, quote)}`);
    if (trade.realized_pnl !== 0) {
      const sign = trade.realized_pnl >= 0 ? '+' : '';
      lines.push(`Net Profit Realized: ${sign}${fmtMoney(trade.realized_pnl, quote)}`);
    }
  } else {
    lines.push(`Nominal: ${fmtMoney(trade.value, quote)}`);
  }
  await notify(lines.join('\n'), trade.user_id ?? null);
}

export async function notifyDailySummary(summary: string, userId?: number | null) {
  await notify(`📅 RINGKASAN HARIAN\n${summary}`, userId ?? null);
}

export function telegramConfigured(userId = 0): boolean {
  return !!(settings.get('telegram_bot_token', '', userId) && userChats(userId).length > 0);
}
