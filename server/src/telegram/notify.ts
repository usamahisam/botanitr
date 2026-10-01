import { settings } from '../db/index.js';
import { fmtIDR, fmtQty } from '../utils/format.js';
import { Action } from '../strategies/types.js';

/** Modul ini di-bridge ke bot telegram agar tidak circular import */
type Sender = (text: string) => Promise<void>;
let sender: Sender | null = null;
export function setTelegramSender(fn: Sender | null) { sender = fn; }

export async function notify(text: string) {
  if (!sender) return;
  try { await sender(text); } catch { /* abaikan error telegram */ }
}

const TAG_TITLES: Record<string, string> = {
  INVENTORY_HARVEST_RECYCLE: '🌾 INVENTORY HARVESTER: MODAL KEMBALI CAIR',
  GRID_UNWIND: '📊 GRID UNWIND: LIKUIDASI BREAKEVEN',
  DCA_TP: '🎯 DCA: TARGET PROFIT TERCAPAI',
  SCALPER_TP: '⚡ SCALPER: TAKE PROFIT',
  SCALPER_SL: '🛑 SCALPER: STOP LOSS',
  SCALPER_EXIT: '↩️ SCALPER: EXIT SIGNAL',
  AUTO_COMPOUND: '📈 AUTO-COMPOUND'
};

export async function notifyTrade(trade: any, action: Action, usdtIdr: number) {
  const title = TAG_TITLES[action.tag] || (trade.side === 'buy' ? '🟢 BELI' : '🔴 JUAL');
  const exchange = trade.exchange_id.toUpperCase();
  const base = trade.pair.replace(/IDR$|USDT$/, '');
  const modeBadge = trade.mode === 'paper' ? '📄 DEMO' : '💰 RIIL';
  const lines = [
    `${title}`,
    `Bursa: ${exchange} ${modeBadge}`,
    `Aset: ${base} (${fmtQty(trade.qty)})`,
    `Harga ${trade.side === 'buy' ? 'Beli' : 'Jual'}: ${fmtIDR(trade.price * usdtIdr)}`
  ];
  if (trade.side === 'sell') {
    lines.push(`Nilai: ${fmtIDR(trade.value * usdtIdr)}`);
    if (trade.realized_pnl !== 0) {
      const pnlIdr = trade.realized_pnl * usdtIdr;
      lines.push(`Net Profit Realized: ${pnlIdr >= 0 ? '+' : ''}${fmtIDR(pnlIdr)}`);
    }
  } else {
    lines.push(`Nominal: ${fmtIDR(trade.value * usdtIdr)}`);
  }
  await notify(lines.join('\n'));
}

export async function notifyDailySummary(summary: string) {
  await notify(`📅 RINGKASAN HARIAN\n${summary}`);
}

export function telegramConfigured(): boolean {
  return !!(settings.get('telegram_bot_token') && settings.get('telegram_allowed_chat_ids'));
}
