import { db, queries, now, BotRow } from '../db/index.js';
import { log } from '../log.js';
import { fmtIDR } from '../utils/format.js';

/**
 * Auto-compound: reinvest % dari realized PnL ke budget bot.
 * Lot dihitung ulang dari parameter strategi.
 */
export const compound = {
  maybeCompound(bot: BotRow, realizedPnlQuote: number, usdtIdr: number) {
    const pct = Number(bot.auto_compound_pct);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100 || realizedPnlQuote <= 0) return;

    const reinvest = realizedPnlQuote * (pct / 100);
    const newBudget = bot.current_budget + reinvest;

    // Hitung ulang lot sesuai strategi (tahan terhadap parameter korup)
    let params: any = {};
    try { params = JSON.parse(bot.params || '{}'); } catch { /* pakai default */ }
    const stratDiv = bot.strategy === 'grid' ? params.levels : params.max_buys;
    const divisor = Math.max(1, Math.floor(Number(stratDiv ?? (bot.strategy === 'grid' ? 6 : 5)) || 0) || 1);
    const safeDivisor = bot.strategy === 'grid' ? Math.max(2, Math.min(50, divisor)) : Math.max(1, Math.min(50, divisor));
    const newLot = Math.floor(newBudget / safeDivisor);

    queries.updateBotBudget.run(newBudget, newLot, now(), bot.id);

    log('info', 'AUTO_COMPOUND',
      `Reinvested +${fmtIDR(reinvest * usdtIdr)} (${pct}%). New Budget: ${fmtIDR(newBudget * usdtIdr)}, Lot: ${fmtIDR(newLot * usdtIdr)}.`,
      { bot_id: bot.id, impact_rp: reinvest * usdtIdr, user_id: bot.user_id });
  }
};
