import { db, queries, now, BotRow } from '../db/index.js';
import { log } from '../log.js';
import { fmtIDR } from '../utils/format.js';

/**
 * Auto-compound: reinvest % dari realized PnL ke budget bot.
 * Lot dihitung ulang dari parameter strategi.
 */
export const compound = {
  maybeCompound(bot: BotRow, realizedPnlQuote: number, usdtIdr: number) {
    const pct = bot.auto_compound_pct;
    if (pct <= 0 || realizedPnlQuote <= 0) return;

    const reinvest = realizedPnlQuote * (pct / 100);
    const newBudget = bot.current_budget + reinvest;

    // Hitung ulang lot sesuai strategi
    const params = JSON.parse(bot.params || '{}');
    const divisor = bot.strategy === 'grid'
      ? Math.max(2, Number(params.levels ?? 6))
      : Math.max(1, Number(params.max_buys ?? 5));
    const newLot = Math.floor(newBudget / divisor);

    queries.updateBotBudget.run(newBudget, newLot, now(), bot.id);

    log('info', 'AUTO_COMPOUND',
      `Reinvested +${fmtIDR(reinvest * usdtIdr)} (${pct}%). New Budget: ${fmtIDR(newBudget * usdtIdr)}, Lot: ${fmtIDR(newLot * usdtIdr)}.`,
      { bot_id: bot.id, impact_rp: reinvest * usdtIdr, user_id: bot.user_id });
  }
};
