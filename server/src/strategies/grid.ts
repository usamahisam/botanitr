import { Strategy, StrategyContext, Action, registerStrategy, lotFromBudget, numParam } from './types.js';

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
    const lower = numParam(params, 'lower_pct', 3, 0.1, 50) / 100;
    const upper = numParam(params, 'upper_pct', 3, 0.1, 50) / 100;
    const levels = Math.max(2, Math.min(50, Math.floor(numParam(params, 'levels', 6, 2, 50))));
    const actions: Action[] = [];

    if (!state.anchor) state.anchor = price;

    // Self-healing setelah jeda/restart lama: bila harga sudah keluar jauh dari
    // grid DAN tak ada posisi terbuka (tak ada modal berisiko), ikut harga
    // sekarang agar bot kembali aktif. Dengan posisi terbuka, tunggu unwind.
    if (state.filledBuys.length === 0 &&
        (price > state.anchor * (1 + upper) || price < state.anchor * (1 - lower))) {
      state.anchor = price;
      state.levelsHit = [];
    }

    // Bangun level harga (merata dari bawah ke atas)
    const levelPrices: number[] = [];
    for (let i = 0; i <= levels; i++) {
      levelPrices.push(state.anchor * (1 - lower + ((lower + upper) * i) / levels));
    }

    // BUY: harga turun menyentuh level di bawah anchor yang belum pernah diisi di siklus ini.
    // Level ditandai HANYA setelah fill terkonfirmasi (scheduler), agar order
    // yang gagal tetap dicoba lagi tick berikutnya, bukan hangus selamanya.
    for (let i = 0; i < levels; i++) {
      const lp = levelPrices[i];
      if (lp < state.anchor && price <= lp && !state.levelsHit.includes(i)) {
        const lot = lotFromBudget(ctx.bot.current_budget, levels);
        if (lot > 0) {
          actions.push({
            type: 'buy', amountQuote: lot,
            reason: `Grid beli level ${i + 1} @ ${Math.round(lp)}`,
            tag: 'TRADE', meta: { level: i }
          });
        }
      }
    }

    // GRID_UNWIND: harga kembali ≥ breakeven VWAP semua buy + margin fee.
    // Dust-hold: nilai posisi di bawah minimum exchange → tahan, jangan emisikan
    // sell yang pasti ditolak (hindari error-loop; posisi menunggu recovery).
    if (state.filledBuys.length > 0) {
      const totalCost = state.filledBuys.reduce((s, b) => s + b.cost, 0);
      const totalQty = state.filledBuys.reduce((s, b) => s + b.qty, 0);
      const breakevenVwap = totalQty > 0 ? (totalCost / totalQty) * 1.004 : 0; // +0.4% margin fee
      if (totalQty > 0 && price >= breakevenVwap && totalQty * price >= (ctx.minLot ?? 0)) {
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
