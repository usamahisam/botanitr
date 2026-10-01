import { Strategy, StrategyContext, Action, registerStrategy, lotFromBudget } from './types.js';

/**
 * DCA: beli bertahap tiap harga turun x% dari entry terakhir,
 * jual semua saat target profit y% dari rata-rata tercapai.
 */
interface DcaState {
  entries: { price: number; qty: number; cost: number }[];
  lastEntryPrice: number;
}

const dca: Strategy = {
  name: 'dca',
  label: 'DCA',
  defaultParams: { drop_pct: 2, take_profit_pct: 3, max_buys: 5 },

  init(): DcaState {
    return { entries: [], lastEntryPrice: 0 };
  },

  onTick(ctx: StrategyContext, state: DcaState, params: any): Action[] {
    const price = ctx.ticker.last;
    const drop = Number(params.drop_pct) / 100;
    const tp = Number(params.take_profit_pct) / 100;
    const maxBuys = Math.max(1, Number(params.max_buys));
    const lot = lotFromBudget(ctx.bot.current_budget, maxBuys);
    const actions: Action[] = [];

    const totalCost = state.entries.reduce((s, e) => s + e.cost, 0);
    const totalQty = state.entries.reduce((s, e) => s + e.qty, 0);
    const avgCost = totalQty > 0 ? totalCost / totalQty : 0;

    // SELL: target profit tercapai
    if (totalQty > 0 && avgCost > 0 && price >= avgCost * (1 + tp + 0.004)) {
      actions.push({
        type: 'sell', qtyBase: totalQty, costBasis: totalCost,
        reason: `[DCA_TP] Target profit +${params.take_profit_pct}% tercapai. Jual ${totalQty.toFixed(8)} @ ${Math.round(price)} (avg ${Math.round(avgCost)})`,
        tag: 'DCA_TP',
        impactRp: (price * totalQty - totalCost) * ctx.usdtIdr
      });
      state.entries = [];
      state.lastEntryPrice = 0;
      return actions;
    }

    // BUY pertama
    if (state.entries.length === 0 && lot > 0) {
      actions.push({ type: 'buy', amountQuote: lot, reason: `DCA entry pertama @ ${Math.round(price)}`, tag: 'TRADE' });
      state.lastEntryPrice = price;
      return actions;
    }

    // BUY bertahap saat turun
    if (state.entries.length > 0 && state.entries.length < maxBuys && state.lastEntryPrice > 0
        && price <= state.lastEntryPrice * (1 - drop) && lot > 0) {
      actions.push({
        type: 'buy', amountQuote: lot,
        reason: `DCA beli ke-${state.entries.length + 1} saat turun ${params.drop_pct}% @ ${Math.round(price)}`,
        tag: 'TRADE'
      });
      state.lastEntryPrice = price;
    }

    return actions;
  },

  describe(p: any) {
    return `Beli tiap turun ${p.drop_pct}% (maks ${p.max_buys}x), TP +${p.take_profit_pct}%`;
  }
};

registerStrategy(dca);
export default dca;
