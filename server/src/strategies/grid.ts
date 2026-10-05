import { Strategy, StrategyContext, Action, registerStrategy, lotFromBudget, numParam } from './types.js';
import { minGrossTargetPct } from './fees.js';
import { atrPct, closesOf, rsi } from './indicators.js';

/**
 * Grid pintar:
 * - PARTIAL UNWIND per level: tiap level yang terisi dijual sendiri-sendiri
 *   saat mencapai target BERSIH (bukan all-or-nothing) → sell jauh lebih sering.
 * - Fee-aware: target tak boleh di bawah biaya PP + buffer + laba bersih.
 * - Auto-range ATR: lebar grid mengikuti volatilitas (rapat saat pasar cepat).
 * - Filter RSI: jangan beli saat longsor tajam (tangkap pisau jatuh).
 */
interface GridState {
  anchor: number;
  filledBuys: { price: number; qty: number; cost: number; level?: number }[];
  levelsHit: number[];
  autoRangeTs: number;
  autoHalfRange: number;
}

const grid: Strategy = {
  name: 'grid',
  label: 'Grid',
  defaultParams: {
    lower_pct: 3, upper_pct: 3, levels: 6,
    profit_pct: 0.5,      // laba BERSIH di atas fee per level
    auto_range: true,      // lebar grid ikut ATR
    rsi_filter: true,      // lewati buy saat longsor
    rsi_longslide: 30,
  },

  init(params: any): GridState {
    return { anchor: 0, filledBuys: [], levelsHit: [], autoRangeTs: 0, autoHalfRange: 0 };
  },

  async onTick(ctx: StrategyContext, state: GridState, params: any): Promise<Action[]> {
    const price = ctx.ticker.last;
    const actions: Action[] = [];
    if (!(price > 0)) return actions;

    let lower = numParam(params, 'lower_pct', 3, 0.1, 50) / 100;
    let upper = numParam(params, 'upper_pct', 3, 0.1, 50) / 100;
    const levels = Math.max(2, Math.min(50, Math.floor(numParam(params, 'levels', 6, 2, 50))));
    // Target gross per level: laba bersih diinginkan ATAU floor fee, mana yg besar
    const grossPct = Math.max(numParam(params, 'profit_pct', 0.5, 0, 50), minGrossTargetPct(ctx.bot.exchange_id, params));

    if (!state.anchor) state.anchor = price;

    // Auto-range ATR (refresh tiap 5 menit): half-range = ATR% × 2.5, clamp 1–12%
    if (params.auto_range !== false && ctx.now - (state.autoRangeTs || 0) > 300000) {
      try {
        const kl = await ctx.getKlines('15m', 60);
        const a = atrPct(kl, 14);
        if (a > 0) {
          state.autoHalfRange = Math.max(1, Math.min(12, a * 2.5));
          state.autoRangeTs = ctx.now;
        }
      } catch { /* pakai range manual */ }
    }
    if (params.auto_range !== false && state.autoHalfRange > 0) {
      lower = upper = state.autoHalfRange / 100;
    }

    // Self-healing: keluar jauh dari grid & tak ada posisi → ikut harga
    if (state.filledBuys.length === 0 &&
        (price > state.anchor * (1 + upper) || price < state.anchor * (1 - lower))) {
      state.anchor = price;
      state.levelsHit = [];
    }

    const levelPrices: number[] = [];
    for (let i = 0; i <= levels; i++) {
      levelPrices.push(state.anchor * (1 - lower + ((lower + upper) * i) / levels));
    }

    // PARTIAL UNWIND: tiap fill yang sudah ≥ target bersih → jual sendiri.
    // PENTING: state TIDAK diubah di sini — penghapusan fill + pembebasan
    // level + reset anchor terjadi di scheduler HANYA saat fill TERKONFIRMASI.
    // (Menghapus saat emit = posisi hilang bila eksekusi gagal.)
    const minLot = ctx.minLot ?? 0;
    for (const b of state.filledBuys) {
      const target = b.price * (1 + grossPct / 100);
      if (price >= target && b.qty * price >= minLot) {
        actions.push({
          type: 'sell', qtyBase: b.qty, costBasis: b.cost,
          reason: `[GRID_SELL] Level ${b.level != null ? b.level + 1 : '?'} panen +${((price / b.price - 1) * 100).toFixed(2)}% @ ${Math.round(price)}`,
          tag: 'GRID_SELL',
          impactRp: (price * b.qty - b.cost) * ctx.usdtIdr,
          meta: { level: b.level }
        });
      }
    }
    if (actions.length > 0) return actions;

    // Filter RSI: RSI(7) di 5m < longslide → pasar longsor, tunda buy (sell tetap jalan)
    if (params.rsi_filter !== false) {
      try {
        const kl = await ctx.getKlines('5m', 30);
        const r = rsi(closesOf(kl), 7);
        if (r < numParam(params, 'rsi_longslide', 30, 5, 50)) return actions;
      } catch { /* tanpa data → tetap beli */ }
    }

    // BUY: level di bawah anchor yang tersentuh & belum terisi siklus ini
    for (let i = 0; i < levels; i++) {
      const lp = levelPrices[i];
      if (lp < state.anchor && price <= lp && !state.levelsHit.includes(i)) {
        const lot = lotFromBudget(ctx.bot.current_budget, levels);
        if (lot > 0) {
          actions.push({
            type: 'buy', amountQuote: lot,
            reason: `Grid beli level ${i + 1} @ ${Math.round(lp)} (target +${grossPct.toFixed(2)}%)`,
            tag: 'TRADE', meta: { level: i }
          });
        }
      }
    }

    return actions;
  },

  describe(p: any) {
    return `Partial-unwind per level +${p.profit_pct ?? 0.5}% bersih, auto-range ${p.auto_range !== false ? 'ON' : 'OFF'}, ${p.levels ?? 6} level`;
  }
};

registerStrategy(grid);
export default grid;
