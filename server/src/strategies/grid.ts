import { Strategy, StrategyContext, Action, registerStrategy, lotFromBudget } from './types.js';

/**
 * Grid: level buy/sell merata dalam range %.
 * GRID_UNWIND: saat harga ≥ breakeven VWAP + margin → likuidasi semua → profit.
 */
interface GridState {
  anchor: number;
  filledBuys: { price: number; qty: number; cost: number }[];
  levelsHit: number[];
}

const grid: Strategy = {
  name: 'grid',
  label: 'Grid',
  defaultParams: { lower_pct: 3, upper_pct: 3, levels: 6 },

  init(params: any): GridState {
    return { anchor: 0, filledBuys: [], levelsHit: [] };
  },

  onTick(ctx: StrategyContext, state: GridState, params: any): Action[] {
    const price = ctx.ticker.last;
    const lower = Number(params.lower_pct) / 100;
    const upper = Number(params.upper_pct) / 100;
    const levels = Math.max(2, Number(params.levels));
    const actions: Action[] = [];

    if (!state.anchor) state.anchor = price;

    // Bangun level harga (merata dari bawah ke atas)
    const levelPrices: number[] = [];
    for (let i = 0; i <= levels; i++) {
      levelPrices.push(state.anchor * (1 - lower + ((lower + upper) * i) / levels));
    }

    // BUY: harga turun menyentuh level di bawah anchor yang belum pernah diisi di siklus ini
    for (let i = 0; i < levels; i++) {
      const lp = levelPrices[i];
      if (lp < state.anchor && price <= lp && !state.levelsHit.includes(i)) {
        const lot = lotFromBudget(ctx.bot.current_budget, levels);
        if (lot > 0) {
          actions.push({
            type: 'buy', amountQuote: lot,
            reason: `Grid beli level ${i + 1} @ ${Math.round(lp)}`,
            tag: 'TRADE'
          });
          state.levelsHit.push(i);
        }
      }
    }

    // GRID_UNWIND: harga kembali ≥ breakeven VWAP semua buy + margin fee
    if (state.filledBuys.length > 0) {
      const totalCost = state.filledBuys.reduce((s, b) => s + b.cost, 0);
      const totalQty = state.filledBuys.reduce((s, b) => s + b.qty, 0);
      const breakevenVwap = totalQty > 0 ? (totalCost / totalQty) * 1.004 : 0; // +0.4% margin fee
      if (totalQty > 0 && price >= breakevenVwap) {
        actions.push({
          type: 'sell', qtyBase: totalQty, costBasis: totalCost,
          reason: `[GRID_UNWIND] Seluruh ${state.filledBuys.length} level grid dilikuidasi pada titik Breakeven VWAP ${Math.round(breakevenVwap)} @ ${Math.round(price)}`,
          tag: 'GRID_UNWIND',
          impactRp: (price * totalQty - totalCost) * ctx.usdtIdr
        });
        // Reset siklus: anchor baru di harga sekarang
        state.filledBuys = [];
        state.levelsHit = [];
        state.anchor = price;
      }
    }

    return actions;
  },

  describe(p: any) {
    return `Range ±${p.lower_pct}%/${p.upper_pct}%, ${p.levels} level, unwind di breakeven VWAP`;
  }
};

registerStrategy(grid);
export default grid;
