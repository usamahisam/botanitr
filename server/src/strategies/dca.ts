import { Strategy, StrategyContext, Action, registerStrategy, lotFromBudget, numParam } from './types.js';
import { minGrossTargetPct } from './fees.js';

/**
 * DCA pintar: beli bertahap tiap turun, panen 2 tingkat —
 * tingkat-1 (parsial, cepat, fee-aware) + tingkat-2 (sisa, target penuh).
 * Hasil: sell lebih sering, modal berputar lebih cepat.
 */
interface DcaState {
  entries: { price: number; qty: number; cost: number }[];
  lastEntryPrice: number;
  tier1Done: boolean;
}

const dca: Strategy = {
  name: 'dca',
  label: 'DCA',
  defaultParams: { drop_pct: 2, take_profit_pct: 3, max_buys: 5, partial_pct: 50, all_in: 'mati', sl_pct: 4 },

  init(): DcaState {
    return { entries: [], lastEntryPrice: 0, tier1Done: false };
  },

  onTick(ctx: StrategyContext, state: DcaState, params: any): Action[] {
    const price = ctx.ticker.last;
    if (!(price > 0)) return [];
    const drop = numParam(params, 'drop_pct', 2, 0.1, 50) / 100;
    const tp = numParam(params, 'take_profit_pct', 3, 0.1, 100) / 100;
    const maxBuys = Math.max(1, Math.min(50, Math.floor(numParam(params, 'max_buys', 5, 1, 50))));
    const partial = Math.max(10, Math.min(90, numParam(params, 'partial_pct', 50, 10, 90))) / 100;
    const lot = lotFromBudget(ctx.bot.current_budget, maxBuys);
    const actions: Action[] = [];
    const minLot = ctx.minLot ?? 0;

    const totalCost = state.entries.reduce((s, e) => s + e.cost, 0);
    const totalQty = state.entries.reduce((s, e) => s + e.qty, 0);
    const avgCost = totalQty > 0 ? totalCost / totalQty : 0;

    if (totalQty > 0 && avgCost > 0) {
      // STOP-RUGI: tebak arah meleset → potong, jangan kunci modal berminggu-minggu
      const sl = numParam(params, 'sl_pct', 4, 0.5, 50) / 100;
      if (price <= avgCost * (1 - sl) && totalQty * price >= minLot) {
        actions.push({
          type: 'sell', qtyBase: totalQty, costBasis: totalCost,
          reason: `[DCA_SL] Stop-rugi -${((1 - price / avgCost) * 100).toFixed(2)}% @ ${Math.round(price)} (avg ${Math.round(avgCost)})`,
          tag: 'DCA_SL',
          impactRp: (price * totalQty - totalCost) * ctx.usdtIdr
        });
        state.entries = [];
        state.lastEntryPrice = 0;
        state.tier1Done = false;
        return actions;
      }
      // TINGKAT-2: target penuh → jual SEMUA (kunci profit besar)
      if (price >= avgCost * (1 + tp + 0.004) && totalQty * price >= minLot) {
        actions.push({
          type: 'sell', qtyBase: totalQty, costBasis: totalCost,
          reason: `[DCA_TP] Target profit +${params.take_profit_pct}% tercapai. Jual ${totalQty.toFixed(8)} @ ${Math.round(price)} (avg ${Math.round(avgCost)})`,
          tag: 'DCA_TP',
          impactRp: (price * totalQty - totalCost) * ctx.usdtIdr
        });
        state.entries = [];
        state.lastEntryPrice = 0;
        state.tier1Done = false;
        return actions;
      }
      // TINGKAT-1: cepat & parsial — floor fee agar selalu cuan bersih
      const tier1Gross = Math.max(tp * 0.5, minGrossTargetPct(ctx.bot.exchange_id, params) / 100);
      if (!state.tier1Done && price >= avgCost * (1 + tier1Gross)) {
        const qtySell = totalQty * partial;
        if (qtySell * price >= minLot && qtySell < totalQty) {
          const costPart = totalCost * partial;
          actions.push({
            type: 'sell', qtyBase: qtySell, costBasis: costPart,
            reason: `[DCA_TP1] Panen parsial +${(tier1Gross * 100).toFixed(2)}% (${Math.round(partial * 100)}% posisi) @ ${Math.round(price)}`,
            tag: 'DCA_TP1',
            impactRp: (price * qtySell - costPart) * ctx.usdtIdr
          });
          const ratio = 1 - partial;
          state.entries = state.entries.map(e => ({ ...e, qty: e.qty * ratio, cost: e.cost * ratio }));
          state.tier1Done = true;
          return actions;
        }
      }
    }

    // BUY pertama — mode all_in:
    // 'agresif': lot 1-4 SEMUA dibelikan sekaligus di harga sekarang.
    // 'cadangan'/'mati': lot 1 saja, sisanya siaga averaging saat turun.
    if (state.entries.length === 0 && lot > 0) {
      const n = String(params.all_in || 'mati') === 'agresif' ? maxBuys : 1;
      for (let k = 0; k < n; k++) {
        actions.push({ type: 'buy', amountQuote: lot, reason: `DCA entry ${k + 1}/${n} @ ${Math.round(price)}${n > 1 ? ' [ALL-IN]' : ''}`, tag: 'TRADE' });
      }
      return actions;
    }

    // BUY bertahap saat turun
    if (state.entries.length > 0 && state.entries.length < maxBuys && state.lastEntryPrice > 0
        && price <= state.lastEntryPrice * (1 - drop) && lot > 0) {
      actions.push({
        type: 'buy', amountQuote: lot,
        reason: `DCA beli ke-${state.entries.length + 1} saat turun ${numParam(params, 'drop_pct', 2)}% @ ${Math.round(price)}`,
        tag: 'TRADE'
      });
    }

    return actions;
  },

  describe(p: any) {
    const mode = String(p.all_in || 'mati');
    const gaya = mode === 'agresif' ? 'ALL-IN agresif, ' : mode === 'cadangan' ? 'all-in cadangan, ' : '';
    return `${gaya}Beli tiap turun ${p.drop_pct}% (maks ${p.max_buys}x), panen parsial ${p.partial_pct ?? 50}% + TP +${p.take_profit_pct}%, SL -${p.sl_pct ?? 4}%`;
  }
};

registerStrategy(dca);
export default dca;
