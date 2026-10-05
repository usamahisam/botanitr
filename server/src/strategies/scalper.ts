import { Strategy, StrategyContext, Action, registerStrategy, numParam } from './types.js';
import { minGrossTargetPct } from './fees.js';
import { adaptiveCooldownMs, detectRegime } from './regime.js';
import { closesOf, ema, rsi } from './indicators.js';

/**
 * Scalper pintar (candle cepat, default 1m):
 * - Entry longgar: cukup EMA fast > slow + RSI tidak panas (tak wajib cross
 *   tepat) + cooldown → sinyal jauh lebih sering, tetap anti-fomo.
 * - TP fee-aware + adaptif rezim (kecil & sering saat volatile).
 * - Trailing stop default aktif; SL darurat tetap ada.
 */
interface ScalperState {
  position: { entryPrice: number; qty: number; cost: number; peakPrice?: number } | null;
  prevFastAbove: boolean | null;
  candlesTs: number;
  candles: number[][];
  lastEntryTs: number;
}

const scalper: Strategy = {
  name: 'scalper',
  label: 'Scalper',
  defaultParams: {
    timeframe: '1m', ema_fast: 20, ema_slow: 50, rsi_period: 14,
    rsi_entry: 55, rsi_overbought: 70,
    tp_pct: 1.0, sl_pct: 0.8, trailing_pct: 0.8,
  },

  init(): ScalperState {
    return { position: null, prevFastAbove: null, candlesTs: 0, candles: [], lastEntryTs: 0 };
  },

  async onTick(ctx: StrategyContext, state: ScalperState, params: any): Promise<Action[]> {
    const actions: Action[] = [];
    const price = ctx.ticker.last;
    if (!(price > 0)) return actions;

    // TP/SL/Trailing dievaluasi DULU (tidak butuh candle)
    if (state.position) {
      const p = state.position;
      // TP tak boleh di bawah floor fee (agar tiap TP = cuan bersih)
      const tpPct = Math.max(numParam(params, 'tp_pct', 1.0, 0.1, 100), minGrossTargetPct(ctx.bot.exchange_id, params));
      const tpPrice = p.entryPrice * (1 + tpPct / 100);
      const slPrice = p.entryPrice * (1 - numParam(params, 'sl_pct', 0.8, 0.1, 100) / 100);
      const trailingPct = numParam(params, 'trailing_pct', 0.8, 0, 50);
      const tradable = p.qty * price >= (ctx.minLot ?? 0);

      if (trailingPct > 0) {
        if (p.peakPrice === undefined || price > p.peakPrice) p.peakPrice = price;
        const trailPrice = p.peakPrice * (1 - trailingPct / 100);
        if (tradable && p.peakPrice > p.entryPrice * (1 + trailingPct / 100) && price <= trailPrice) {
          actions.push({
            type: 'sell', qtyBase: p.qty, costBasis: p.cost,
            reason: `[SCALPER_TRAIL] Trailing stop: turun ${trailingPct}% dari puncak ${Math.round(p.peakPrice)} → jual @ ${Math.round(price)}`,
            tag: 'SCALPER_EXIT', impactRp: (price * p.qty - p.cost) * ctx.usdtIdr
          });
          // (posisi dibersihkan scheduler saat fill terkonfirmasi)
          return actions;
        }
      }

      if (tradable && price >= tpPrice) {
        actions.push({
          type: 'sell', qtyBase: p.qty, costBasis: p.cost,
          reason: `[SCALPER_TP] Take profit +${tpPct.toFixed(2)}% @ ${Math.round(price)}`,
          tag: 'SCALPER_TP', impactRp: (price * p.qty - p.cost) * ctx.usdtIdr
        });
        // (posisi dibersihkan scheduler saat fill terkonfirmasi)
        return actions;
      }
      if (tradable && price <= slPrice) {
        actions.push({
          type: 'sell', qtyBase: p.qty, costBasis: p.cost,
          reason: `[SCALPER_SL] Stop loss -${params.sl_pct}% @ ${Math.round(price)}`,
          tag: 'SCALPER_SL', impactRp: (price * p.qty - p.cost) * ctx.usdtIdr
        });
        // (posisi dibersihkan scheduler saat fill terkonfirmasi)
        return actions;
      }
    }

    // === Bagian berbasis candle ===
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
    const closes = closesOf(state.candles);
    if (closes.length < emaSlow + 2) return actions;

    const fast = ema(closes.slice(-emaFast - 1), emaFast);
    const slow = ema(closes.slice(-emaSlow - 1), emaSlow);
    const rsiNow = rsi(closes, numParam(params, 'rsi_period', 14, 2, 100));
    const fastAbove = fast > slow;

    // Exit jika EMA cross turun (dust-hold)
    if (state.position && state.prevFastAbove === true && !fastAbove && state.position.qty * price >= (ctx.minLot ?? 0)) {
      const p = state.position;
      actions.push({
        type: 'sell', qtyBase: p.qty, costBasis: p.cost,
        reason: `[SCALPER_EXIT] EMA${params.ema_fast} cross-down EMA${params.ema_slow} @ ${Math.round(price)}`,
        tag: 'SCALPER_EXIT', impactRp: (price * p.qty - p.cost) * ctx.usdtIdr
      });
      // (posisi dibersihkan scheduler saat fill terkonfirmasi)
      state.prevFastAbove = fastAbove;
      return actions;
    }

    // ENTRY longgar: tren naik + RSI adem + cooldown lewat.
    // (Cross tepat tetap termasuk; pullback sehat juga diambil.)
    if (!state.position && fastAbove && rsiNow <= numParam(params, 'rsi_entry', 55, 5, 95)) {
      const regime = detectRegime(state.candles, params);
      if (ctx.now - (state.lastEntryTs || 0) >= adaptiveCooldownMs(params, regime.mode)) {
        state.lastEntryTs = ctx.now;
        actions.push({
          type: 'buy', amountQuote: ctx.bot.current_budget,
          reason: `Scalper entry: EMA${params.ema_fast}>EMA${params.ema_slow}, RSI ${rsiNow.toFixed(1)} [${regime.mode}] @ ${Math.round(price)}`,
          tag: 'TRADE'
        });
      }
    }

    state.prevFastAbove = fastAbove;
    return actions;
  },

  describe(p: any) {
    return `EMA${p.ema_fast}/${p.ema_slow} + RSI≤${p.rsi_entry ?? 55}, TP fee-aware, trailing ${p.trailing_pct ?? 0.8}%, TF ${p.timeframe}`;
  }
};

registerStrategy(scalper);
export default scalper;
