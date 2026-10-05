import { Strategy, StrategyContext, Action, registerStrategy, numParam } from './types.js';
import { minGrossTargetPct } from './fees.js';
import { adaptiveCooldownMs, detectRegime, higherTrend } from './regime.js';
import { closesOf, rsi, sma } from './indicators.js';

/**
 * Mean-Reversion RSI ekstrem (ala Connors RSI-2):
 * tren besar masih naik (harga di atas SMA panjang) TAPI pullback tajam
 * sesaat (RSI pendek oversold) → beli murah, jual saat memantul.
 * Cocok untuk grafik cepat yang sering spike naik-turun.
 */
interface RevertState {
  position: { entryPrice: number; qty: number; cost: number } | null;
  candlesTs: number;
  candles: number[][];
  lastEntryTs: number;
}

const revert: Strategy = {
  name: 'revert',
  label: 'Revert',
  defaultParams: {
    timeframe: '5m', rsi_len: 3, oversold: 20, exit_rsi: 65,
    trend_sma: 100, tp_pct: 1.0, sl_pct: 3.0, budget_pct: 100,
  },

  init(): RevertState {
    return { position: null, candlesTs: 0, candles: [], lastEntryTs: 0 };
  },

  async onTick(ctx: StrategyContext, state: RevertState, params: any): Promise<Action[]> {
    const actions: Action[] = [];
    const price = ctx.ticker.last;
    if (!(price > 0)) return actions;
    const minLot = ctx.minLot ?? 0;

    // Proteksi posisi: TP fee-aware / SL darurat (dust-hold)
    if (state.position) {
      const p = state.position;
      const tpPct = Math.max(numParam(params, 'tp_pct', 1.0, 0.1, 100), minGrossTargetPct(ctx.bot.exchange_id, params));
      const tradable = p.qty * price >= minLot;
      if (tradable && price >= p.entryPrice * (1 + tpPct / 100)) {
        actions.push({
          type: 'sell', qtyBase: p.qty, costBasis: p.cost,
          reason: `[REVERT_TP] Pantulan +${tpPct.toFixed(2)}% dari dasar @ ${Math.round(price)}`,
          tag: 'REVERT_TP', impactRp: (price * p.qty - p.cost) * ctx.usdtIdr
        });
        // (posisi dibersihkan scheduler saat fill terkonfirmasi)
        return actions;
      }
      if (tradable && price <= p.entryPrice * (1 - numParam(params, 'sl_pct', 3.0, 0.5, 50) / 100)) {
        actions.push({
          type: 'sell', qtyBase: p.qty, costBasis: p.cost,
          reason: `[REVERT_SL] Stop darurat -${params.sl_pct}% @ ${Math.round(price)}`,
          tag: 'REVERT_SL', impactRp: (price * p.qty - p.cost) * ctx.usdtIdr
        });
        // (posisi dibersihkan scheduler saat fill terkonfirmasi)
        return actions;
      }
    }

    // Data candle (cache 45 dtk)
    if (!Array.isArray(state.candles) || state.candles.length === 0 || ctx.now - (state.candlesTs || 0) > 45000) {
      try {
        const fresh = await ctx.getKlines(String(params.timeframe || '5m'), 150);
        if (Array.isArray(fresh) && fresh.length > 0) { state.candles = fresh; state.candlesTs = ctx.now; }
      } catch { /* cache lama */ }
    }
    const closes = closesOf(state.candles);
    const rsiLen = Math.max(2, Math.min(14, Math.floor(numParam(params, 'rsi_len', 3, 2, 14))));
    if (closes.length < rsiLen + 2) return actions;

    // Exit momentum: RSI pendek sudah panas → kunci pantulan
    if (state.position && state.position.qty * price >= minLot
        && rsi(closes, rsiLen) >= numParam(params, 'exit_rsi', 65, 50, 95)) {
      const p = state.position;
      actions.push({
        type: 'sell', qtyBase: p.qty, costBasis: p.cost,
        reason: `[REVERT_EXIT] RSI(${rsiLen}) panas — kunci pantulan @ ${Math.round(price)}`,
        tag: 'REVERT_EXIT', impactRp: (price * p.qty - p.cost) * ctx.usdtIdr
      });
      // (posisi dibersihkan scheduler saat fill terkonfirmasi)
      return actions;
    }

    // Entry: oversold ekstrem + tren besar masih naik + 1h selaras + cooldown
    if (!state.position) {
      const r = rsi(closes, rsiLen);
      const trendLen = Math.max(20, Math.min(200, Math.floor(numParam(params, 'trend_sma', 100, 20, 200))));
      const trendOk = closes.length < trendLen ? true : price > sma(closes, trendLen);
      const htfOk = params.mtf_confirm === false || (await higherTrend(ctx.getKlines)) !== 'down';
      const regime = detectRegime(state.candles, params);
      if (r <= numParam(params, 'oversold', 20, 2, 40) && trendOk && htfOk
          && ctx.now - (state.lastEntryTs || 0) >= adaptiveCooldownMs(params, regime.mode)) {
        const pct = Math.max(10, Math.min(100, numParam(params, 'budget_pct', 100, 10, 100)));
        const amount = Math.floor(ctx.bot.current_budget * pct / 100);
        if (amount > 0) {
          state.lastEntryTs = ctx.now;
          actions.push({
            type: 'buy', amountQuote: amount,
            reason: `Revert entry: RSI(${rsiLen}) ${r.toFixed(1)} oversold + tren naik [${regime.mode}] @ ${Math.round(price)}`,
            tag: 'TRADE'
          });
        }
      }
    }
    return actions;
  },

  describe(p: any) {
    return `RSI(${p.rsi_len ?? 3})≤${p.oversold ?? 20} + tren SMA${p.trend_sma ?? 100}, exit RSI≥${p.exit_rsi ?? 65}/TP fee-aware`;
  }
};

registerStrategy(revert);
export default revert;
