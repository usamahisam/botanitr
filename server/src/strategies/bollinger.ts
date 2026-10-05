import { Strategy, StrategyContext, Action, registerStrategy, numParam } from './types.js';
import { isNetProfitable, minGrossTargetPct } from './fees.js';
import { adaptiveCooldownMs, detectRegime } from './regime.js';
import { bollinger, closesOf } from './indicators.js';

/**
 * Bollinger %b reversal: beli saat harga menekan/melewati lower band
 * (%b rendah) lalu jual di area tengah–atas band. Klasik pasar sideways
 * yang berosilasi — frekuensi alami tinggi di grafik cepat.
 * Filter bandwidth: lewati pasar mati total (band sempit mati) agar tak
 * bayar fee untuk gerak 0,1%.
 */
interface BollingerState {
  position: { entryPrice: number; qty: number; cost: number } | null;
  candlesTs: number;
  candles: number[][];
  lastEntryTs: number;
}

const bollingerStrat: Strategy = {
  name: 'bollinger',
  label: 'Bollinger',
  defaultParams: {
    timeframe: '5m', bb_period: 20, bb_mult: 2,
    entry_b: 0.0, exit_b: 0.5, min_bandwidth_pct: 0.5,
    tp_pct: 1.0, sl_pct: 3.0, budget_pct: 100,
  },

  init(): BollingerState {
    return { position: null, candlesTs: 0, candles: [], lastEntryTs: 0 };
  },

  async onTick(ctx: StrategyContext, state: BollingerState, params: any): Promise<Action[]> {
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
    const closes = closesOf(state.candles);
    const period = Math.max(10, Math.min(50, Math.floor(numParam(params, 'bb_period', 20, 10, 50))));
    const mult = numParam(params, 'bb_mult', 2, 1, 4);
    const bb = closes.length >= period ? bollinger(closes, period, mult, price) : null;
    if (!bb) return actions;

    // Proteksi posisi: TP fee-aware / SL darurat / exit %b atas
    if (state.position) {
      const p = state.position;
      const tradable = p.qty * price >= minLot;
      const tpPct = Math.max(numParam(params, 'tp_pct', 1.0, 0.1, 100), minGrossTargetPct(ctx.bot.exchange_id, params));
      // Exit %b HANYA bila cuan bersih (band sempit bisa < fee → tahan dulu).
      const bbReady = bb.percentB >= numParam(params, 'exit_b', 0.5, 0.3, 1.5)
        && isNetProfitable(p.entryPrice, price, ctx.bot.exchange_id, params);
      if (tradable && (price >= p.entryPrice * (1 + tpPct / 100) || bbReady)) {
        actions.push({
          type: 'sell', qtyBase: p.qty, costBasis: p.cost,
          reason: `[BB_EXIT] %b ${bb.percentB.toFixed(2)} (target atas) @ ${Math.round(price)}`,
          tag: 'BB_EXIT', impactRp: (price * p.qty - p.cost) * ctx.usdtIdr
        });
        // (posisi dibersihkan scheduler saat fill terkonfirmasi)
        return actions;
      }
      const slPct = numParam(params, 'sl_pct', 3.0, 0.5, 50);
      if (tradable && price <= p.entryPrice * (1 - slPct / 100)) {
        actions.push({
          type: 'sell', qtyBase: p.qty, costBasis: p.cost,
          reason: `[BB_SL] Stop darurat -${slPct}% @ ${Math.round(price)}`,
          tag: 'BB_SL', impactRp: (price * p.qty - p.cost) * ctx.usdtIdr
        });
        // (posisi dibersihkan scheduler saat fill terkonfirmasi)
        return actions;
      }
      return actions;
    }

    // Entry: %b ≤ ambang + bandwidth hidup (pasar bergerak) + cooldown
    if (bb.percentB <= numParam(params, 'entry_b', 0.0, -0.5, 0.5)
        && bb.bandwidthPct >= numParam(params, 'min_bandwidth_pct', 0.5, 0, 10)) {
      const regime = detectRegime(state.candles, params);
      if (ctx.now - (state.lastEntryTs || 0) >= adaptiveCooldownMs(params, regime.mode)) {
        const pct = Math.max(10, Math.min(100, numParam(params, 'budget_pct', 100, 10, 100)));
        const amount = Math.floor(ctx.bot.current_budget * pct / 100);
        if (amount > 0) {
          state.lastEntryTs = ctx.now;
          actions.push({
            type: 'buy', amountQuote: amount,
            reason: `BB entry: %b ${bb.percentB.toFixed(2)} ≤ ${params.entry_b} (lower band ${Math.round(bb.lower)}) [${regime.mode}] @ ${Math.round(price)}`,
            tag: 'TRADE'
          });
        }
      }
    }
    return actions;
  },

  describe(p: any) {
    return `Beli %b≤${p.entry_b ?? 0}, jual %b≥${p.exit_b ?? 0.5}, BB(${p.bb_period ?? 20},${p.bb_mult ?? 2})`;
  }
};

registerStrategy(bollingerStrat);
export default bollingerStrat;
