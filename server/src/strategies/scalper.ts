import { Strategy, StrategyContext, Action, registerStrategy, numParam } from './types.js';

/**
 * Scalper 1m: EMA fast/slow cross + RSI filter, TP/SL % dari entry.
 */
interface ScalperState {
  position: { entryPrice: number; qty: number; cost: number; peakPrice?: number } | null;
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
  defaultParams: { timeframe: '1m', ema_fast: 20, ema_slow: 50, rsi_period: 14, rsi_overbought: 70, tp_pct: 1.2, sl_pct: 0.6, trailing_pct: 0 },

  init(): ScalperState {
    return { position: null, prevFastAbove: null, candlesTs: 0, candles: [] };
  },

  async onTick(ctx: StrategyContext, state: ScalperState, params: any): Promise<Action[]> {
    const actions: Action[] = [];
    const price = ctx.ticker.last;

    // TP/SL/Trailing dievaluasi DULU (tidak butuh candle) — penting agar posisi
    // selalu terproteksi walau data klines belum cukup.
    if (state.position) {
      const p = state.position;
      const tpPrice = p.entryPrice * (1 + numParam(params, 'tp_pct', 1.2, 0.1, 100) / 100);
      const slPrice = p.entryPrice * (1 - numParam(params, 'sl_pct', 0.6, 0.1, 100) / 100);
      const trailingPct = numParam(params, 'trailing_pct', 0, 0, 50);
      // Dust-hold: posisi di bawah minimum exchange tak bisa dijual — tahan diam.
      // (trader juga punya pengaman yang sama sebagai lapis kedua)
      const tradable = p.qty * price >= (ctx.minLot ?? 0);

      // Trailing stop: catat puncak; exit jika turun trailing_pct% dari puncak
      if (trailingPct > 0) {
        if (p.peakPrice === undefined || price > p.peakPrice) p.peakPrice = price;
        const trailPrice = p.peakPrice * (1 - trailingPct / 100);
        if (tradable && p.peakPrice > p.entryPrice * (1 + trailingPct / 100) && price <= trailPrice) {
          actions.push({
            type: 'sell', qtyBase: p.qty, costBasis: p.cost,
            reason: `[SCALPER_TRAIL] Trailing stop: turun ${trailingPct}% dari puncak ${Math.round(p.peakPrice)} → jual @ ${Math.round(price)}`,
            tag: 'SCALPER_EXIT', impactRp: (price * p.qty - p.cost) * ctx.usdtIdr
          });
          state.position = null;
          return actions;
        }
      }

      if (tradable && price >= tpPrice) {
        actions.push({
          type: 'sell', qtyBase: p.qty, costBasis: p.cost,
          reason: `[SCALPER_TP] Take profit +${params.tp_pct}% @ ${Math.round(price)}`,
          tag: 'SCALPER_TP', impactRp: (price * p.qty - p.cost) * ctx.usdtIdr
        });
        state.position = null;
        return actions;
      }
      if (tradable && price <= slPrice) {
        actions.push({
          type: 'sell', qtyBase: p.qty, costBasis: p.cost,
          reason: `[SCALPER_SL] Stop loss -${params.sl_pct}% @ ${Math.round(price)}`,
          tag: 'SCALPER_SL', impactRp: (price * p.qty - p.cost) * ctx.usdtIdr
        });
        state.position = null;
        return actions;
      }
    }

    // === Bagian berbasis candle (entry & exit cross) ===
    // Cache klines 45 detik; toleran state lama/korup tanpa cache (jangan crash)
    const candlesStale = !Array.isArray(state.candles) || state.candles.length === 0
      || ctx.now - (state.candlesTs || 0) > 45000;
    if (candlesStale) {
      try {
        const fresh = await ctx.getKlines(String(params.timeframe || '1m'), 120);
        if (Array.isArray(fresh) && fresh.length > 0) {
          state.candles = fresh;
          state.candlesTs = ctx.now;
        }
      } catch { /* pakai cache lama */ }
    }
    const emaSlow = Math.max(2, Math.min(200, Math.floor(numParam(params, 'ema_slow', 50, 2, 200))));
    const emaFast = Math.max(1, Math.min(emaSlow - 1, Math.floor(numParam(params, 'ema_fast', 20, 1, 200))));
    // Terima tuple [t,o,h,l,c,v] maupun objek {c}; buang candle korup
    const closes = (Array.isArray(state.candles) ? state.candles : [])
      .map((c: any) => (Array.isArray(c) ? c[4] : c?.c))
      .filter((v: any): v is number => Number.isFinite(v));
    if (closes.length < emaSlow + 2) return actions;

    const fast = ema(closes.slice(-emaFast - 1), emaFast);
    const slow = ema(closes.slice(-emaSlow - 1), emaSlow);
    const rsiNow = rsi(closes, numParam(params, 'rsi_period', 14, 2, 100));
    const fastAbove = fast > slow;

    // Exit jika EMA cross turun (posisi terbuka & tradable — dust-hold)
    if (state.position && state.prevFastAbove === true && !fastAbove && state.position.qty * price >= (ctx.minLot ?? 0)) {
      const p = state.position;
      actions.push({
        type: 'sell', qtyBase: p.qty, costBasis: p.cost,
        reason: `[SCALPER_EXIT] EMA${params.ema_fast} cross-down EMA${params.ema_slow} @ ${Math.round(price)}`,
        tag: 'SCALPER_EXIT', impactRp: (price * p.qty - p.cost) * ctx.usdtIdr
      });
      state.position = null;
      state.prevFastAbove = fastAbove;
      return actions;
    }

    // Entry: cross-up + RSI tidak overbought
    if (!state.position && state.prevFastAbove === false && fastAbove && rsiNow < numParam(params, 'rsi_overbought', 70, 1, 100)) {
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
