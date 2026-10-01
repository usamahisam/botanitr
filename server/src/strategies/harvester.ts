import { Strategy, StrategyContext, Action, registerStrategy, lotFromBudget } from './types.js';

/**
 * Inventory Harvester: akumulasi saat turun, saat target tercapai jual cukup
 * untuk MODAL KEMBALI CAIR + profit bersih. Sisa aset = panen gratis.
 */
interface HarvesterState {
  entries: { price: number; qty: number; cost: number }[];
  lastBuyPrice: number;
}

const harvester: Strategy = {
  name: 'harvester',
  label: 'Inventory Harvester',
  defaultParams: { drop_pct: 2.5, harvest_pct: 2, max_buys: 8 },

  init(): HarvesterState {
    return { entries: [], lastBuyPrice: 0 };
  },

  onTick(ctx: StrategyContext, state: HarvesterState, params: any): Action[] {
    const price = ctx.ticker.last;
    const drop = Number(params.drop_pct) / 100;
    const harvestPct = Number(params.harvest_pct) / 100;
    const maxBuys = Math.max(1, Number(params.max_buys));
    const lot = lotFromBudget(ctx.bot.current_budget, maxBuys);
    const actions: Action[] = [];

    const totalCost = state.entries.reduce((s, e) => s + e.cost, 0);
    const totalQty = state.entries.reduce((s, e) => s + e.qty, 0);
    const avgCost = totalQty > 0 ? totalCost / totalQty : 0;

    // HARVEST: harga ≥ avgCost * (1 + harvest% + fee) → jual secukupnya agar modal cair
    if (totalQty > 0 && avgCost > 0 && price >= avgCost * (1 + harvestPct + 0.004)) {
      // qty_sell * price = totalCost * (1 + fee) → modal kembali
      const targetCair = totalCost * 1.003;
      let qtySell = targetCair / price;
      qtySell = Math.min(qtySell, totalQty);
      const kasCair = qtySell * price;
      const profit = kasCair - (totalCost * (qtySell / totalQty));
      actions.push({
        type: 'sell', qtyBase: qtySell,
        costBasis: totalCost * (qtySell / totalQty),
        reason: `[INVENTORY HARVESTER] Likuidasi modal berhasil: Menjual ${qtySell.toFixed(8)} @ ${Math.round(price)}. Kas kembali cair ${Math.round(kasCair)} dengan profit bersih +${Math.round(profit)}`,
        tag: 'INVENTORY_HARVEST_RECYCLE',
        impactRp: profit * ctx.usdtIdr
      });
      // Kurangi entries secara proporsional
      const ratio = 1 - qtySell / totalQty;
      state.entries = state.entries.map(e => ({ ...e, qty: e.qty * ratio, cost: e.cost * ratio }));
      return actions;
    }

    // BUY pertama
    if (state.entries.length === 0 && lot > 0) {
      actions.push({ type: 'buy', amountQuote: lot, reason: `Harvester entry @ ${Math.round(price)}`, tag: 'TRADE' });
      state.lastBuyPrice = price;
      return actions;
    }

    // BUY akumulasi saat turun
    if (state.entries.length > 0 && state.entries.length < maxBuys && state.lastBuyPrice > 0
        && price <= state.lastBuyPrice * (1 - drop) && lot > 0) {
      actions.push({
        type: 'buy', amountQuote: lot,
        reason: `Harvester akumulasi ke-${state.entries.length + 1} @ ${Math.round(price)}`,
        tag: 'TRADE'
      });
      state.lastBuyPrice = price;
    }

    return actions;
  },

  describe(p: any) {
    return `Akumulasi tiap turun ${p.drop_pct}% (maks ${p.max_buys}x), panen modal cair saat +${p.harvest_pct}%`;
  }
};

registerStrategy(harvester);
export default harvester;
