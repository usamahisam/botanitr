import { Strategy, StrategyContext, Action, registerStrategy } from './types.js';

/**
 * Scalper 1m: EMA fast/slow cross + RSI filter, TP/SL % dari entry.
 */
interface ScalperState {
  position: { entryPrice: number; qty: number; cost: number } | null;
  prevFastAbove: boolean | null;
  candlesTs: number;
  candles: number[][];
}

function ema(values: number[], period: number): number {
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function rsi(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

const scalper: Strategy = {
  name: 'scalper',
  label: 'Scalper',
  defaultParams: { timeframe: '1m', ema_fast: 20, ema_slow: 50, rsi_period: 14, rsi_overbought: 70, tp_pct: 1.2, sl_pct: 0.6 },

  init(): ScalperState {
    return { position: null, prevFastAbove: null, candlesTs: 0, candles: [] };
  },

  async onTick(ctx: StrategyContext, state: ScalperState, params: any): Promise<Action[]> {
    const actions: Action[] = [];
    const price = ctx.ticker.last;

    // Cache klines 45 detik
    if (ctx.now - state.candlesTs > 45000) {
      try {
        state.candles = await ctx.getKlines(String(params.timeframe || '1m'), 120);
        state.candlesTs = ctx.now;
      } catch { /* pakai cache lama */ }
    }
    const closes = state.candles.map(c => c[4]);
    if (closes.length < Number(params.ema_slow) + 2) return actions;

    const fast = ema(closes.slice(-Number(params.ema_fast) - 1), Number(params.ema_fast));
    const slow = ema(closes.slice(-Number(params.ema_slow) - 1), Number(params.ema_slow));
    const rsiNow = rsi(closes, Number(params.rsi_period));
    const fastAbove = fast > slow;

    // TP/SL untuk posisi terbuka
    if (state.position) {
      const p = state.position;
      const tpPrice = p.entryPrice * (1 + Number(params.tp_pct) / 100);
      const slPrice = p.entryPrice * (1 - Number(params.sl_pct) / 100);
      if (price >= tpPrice) {
        actions.push({
          type: 'sell', qtyBase: p.qty, costBasis: p.cost,
          reason: `[SCALPER_TP] Take profit +${params.tp_pct}% @ ${Math.round(price)}`,
          tag: 'SCALPER_TP', impactRp: (price * p.qty - p.cost) * ctx.usdtIdr
        });
        state.position = null;
        state.prevFastAbove = fastAbove;
        return actions;
      }
      if (price <= slPrice) {
        actions.push({
          type: 'sell', qtyBase: p.qty, costBasis: p.cost,
          reason: `[SCALPER_SL] Stop loss -${params.sl_pct}% @ ${Math.round(price)}`,
          tag: 'SCALPER_SL', impactRp: (price * p.qty - p.cost) * ctx.usdtIdr
        });
        state.position = null;
        state.prevFastAbove = fastAbove;
        return actions;
      }
      // Exit jika EMA cross turun
      if (state.prevFastAbove === true && !fastAbove) {
        actions.push({
          type: 'sell', qtyBase: p.qty, costBasis: p.cost,
          reason: `[SCALPER_EXIT] EMA${params.ema_fast} cross-down EMA${params.ema_slow} @ ${Math.round(price)}`,
          tag: 'SCALPER_EXIT', impactRp: (price * p.qty - p.cost) * ctx.usdtIdr
        });
        state.position = null;
      }
    }

    // Entry: cross-up + RSI tidak overbought
    if (!state.position && state.prevFastAbove === false && fastAbove && rsiNow < Number(params.rsi_overbought)) {
      actions.push({
        type: 'buy', amountQuote: ctx.bot.current_budget,
        reason: `Scalper entry: EMA${params.ema_fast} cross-up EMA${params.ema_slow}, RSI ${rsiNow.toFixed(1)} @ ${Math.round(price)}`,
        tag: 'TRADE'
      });
    }

    state.prevFastAbove = fastAbove;
    return actions;
  },

  describe(p: any) {
    return `EMA${p.ema_fast}/${p.ema_slow} + RSI${p.rsi_period}, TP ${p.tp_pct}% / SL ${p.sl_pct}%, TF ${p.timeframe}`;
  }
};

registerStrategy(scalper);
export default scalper;
