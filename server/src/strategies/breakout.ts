import { Strategy, StrategyContext, Action, registerStrategy, numParam } from './types.js';
import { minGrossTargetPct } from './fees.js';
import { adaptiveCooldownMs, detectRegime } from './regime.js';
import { atr, closesOf, donchian, toCandles } from './indicators.js';

/**
 * Micro-breakout Donchian: beli saat harga menembus tertinggi N candle
 * terakhir (momentum cepat) + TP ketat fee-aware + trailing ATR.
 * Menangkap grafik trending cepat; stop darurat memotong tren palsu.
 */
interface BreakoutState {
  position: { entryPrice: number; qty: number; cost: number; peakPrice?: number } | null;
  candlesTs: number;
  candles: number[][];
  lastEntryTs: number;
}

const breakout: Strategy = {
  name: 'breakout',
  label: 'Breakout',
  defaultParams: {
    timeframe: '5m', donchian_n: 20, tp_pct: 0.8, sl_pct: 1.2,
    trail_atr_mult: 1.5, budget_pct: 100,
  },

  init(): BreakoutState {
    return { position: null, candlesTs: 0, candles: [], lastEntryTs: 0 };
  },

  async onTick(ctx: StrategyContext, state: BreakoutState, params: any): Promise<Action[]> {
    const actions: Action[] = [];
    const price = ctx.ticker.last;
    if (!(price > 0)) return actions;
    const minLot = ctx.minLot ?? 0;

    if (!Array.isArray(state.candles) || state.candles.length === 0 || ctx.now - (state.candlesTs || 0) > 45000) {
      try {
        const fresh = await ctx.getKlines(String(params.timeframe || '5m'), 120);
        if (Array.isArray(fresh) && fresh.length > 0) { state.candles = fresh; state.candlesTs = ctx.now; }
      } catch { /* cache lama */ }
    }
    const n = Math.max(5, Math.min(60, Math.floor(numParam(params, 'donchian_n', 20, 5, 60))));
    const dc = donchian(state.candles, n);
    if (!dc) return actions;
    const candles = toCandles(state.candles);
    const a = atr(candles, 14);

    // Proteksi posisi: trailing ATR / TP ketat / SL darurat
    if (state.position) {
      const p = state.position;
      const tradable = p.qty * price >= minLot;
      const trailMult = numParam(params, 'trail_atr_mult', 1.5, 0, 10);
      if (trailMult > 0 && a > 0) {
        if (p.peakPrice === undefined || price > p.peakPrice) p.peakPrice = price;
        if (tradable && p.peakPrice > p.entryPrice && price <= p.peakPrice - a * trailMult) {
          actions.push({
            type: 'sell', qtyBase: p.qty, costBasis: p.cost,
            reason: `[BRK_TRAIL] Momentum habis (turun ${trailMult}×ATR dari puncak) @ ${Math.round(price)}`,
            tag: 'BRK_EXIT', impactRp: (price * p.qty - p.cost) * ctx.usdtIdr
          });
          state.position = null;
          return actions;
        }
      }
      const tpPct = Math.max(numParam(params, 'tp_pct', 0.8, 0.1, 100), minGrossTargetPct(ctx.bot.exchange_id, params));
      if (tradable && price >= p.entryPrice * (1 + tpPct / 100)) {
        actions.push({
          type: 'sell', qtyBase: p.qty, costBasis: p.cost,
          reason: `[BRK_TP] Breakout TP +${tpPct.toFixed(2)}% @ ${Math.round(price)}`,
          tag: 'BRK_TP', impactRp: (price * p.qty - p.cost) * ctx.usdtIdr
        });
        state.position = null;
        return actions;
      }
      if (tradable && price <= p.entryPrice * (1 - numParam(params, 'sl_pct', 1.2, 0.3, 50) / 100)) {
        actions.push({
          type: 'sell', qtyBase: p.qty, costBasis: p.cost,
          reason: `[BRK_SL] Breakout gagal -${params.sl_pct}% @ ${Math.round(price)}`,
          tag: 'BRK_SL', impactRp: (price * p.qty - p.cost) * ctx.usdtIdr
        });
        state.position = null;
        return actions;
      }
      return actions;
    }

    // Entry: tembus high N candle + cooldown
    if (price > dc.high) {
      const regime = detectRegime(state.candles, params);
      if (ctx.now - (state.lastEntryTs || 0) >= adaptiveCooldownMs(params, regime.mode)) {
        const pct = Math.max(10, Math.min(100, numParam(params, 'budget_pct', 100, 10, 100)));
        const amount = Math.floor(ctx.bot.current_budget * pct / 100);
        if (amount > 0) {
          state.lastEntryTs = ctx.now;
          actions.push({
            type: 'buy', amountQuote: amount,
            reason: `Breakout entry: tembus high-${n} ${Math.round(dc.high)} [${regime.mode}] @ ${Math.round(price)}`,
            tag: 'TRADE'
          });
        }
      }
    }
    return actions;
  },

  describe(p: any) {
    return `Tembus high-${p.donchian_n ?? 20}, TP fee-aware +${p.tp_pct ?? 0.8}%, trailing ${p.trail_atr_mult ?? 1.5}×ATR`;
  }
};

registerStrategy(breakout);
export default breakout;
