import { Strategy, StrategyContext, Action, registerStrategy, lotFromBudget, numParam } from './types.js';
import { minGrossTargetPct } from './fees.js';
import { adaptiveCooldownMs, detectRegime, higherTrend } from './regime.js';
import { atrPct, closesOf, rsi, sma } from './indicators.js';

/**
 * Dynamic Ping-Pong — grid dua arah yang "hidup":
 *
 * 1. ANCHOR IKUT HARGA: saat tak pegang barang, anchor = harga sekarang
 *    (bot selalu di tengah pasar, tak pernah ketinggalan). Saat pegang
 *    barang, anchor dikunci agar level tetap konsisten.
 * 2. PING-PONG DUA ARAH:
 *    - Bawah (beli-murah): beli tiap level di bawah anchor, jual tiap fill
 *      saat cuan bersih → satu level bisa panen BERKALI-KALI.
 *    - Atas (ikut-tren): saat uptrend terkonfirmasi, berani beli di atas
 *      anchor (lot lebih kecil), jual lebih tinggi lagi.
 * 3. PINTAR: spacing ikut ATR, filter RSI (tahan beli saat longsor/pucuk),
 *    floor fee tiap trade, batas eksposur, cooldown, stop darurat.
 *
 * Spot long-only: jual hanya dari barang yang dimiliki (tak bisa short).
 */
interface DynamicState {
  anchor: number;
  filledBuys: { price: number; qty: number; cost: number; level?: number }[];
  levelsHit: number[];
  lastTrendBuyTs: number;
  stepTs: number;
  autoStep: number;
}

/** Level garis atas ditandai 100+i agar tak tabrakan dengan garis bawah. */
const TOP_OFF = 100;

const dynamic: Strategy = {
  name: 'dynamic',
  label: 'Dynamic',
  defaultParams: {
    step_pct: 1.0,        // jarak antar level (dioverride ATR bila auto_step)
    levels: 8,            // garis beli di tiap sisi
    profit_pct: 0.5,      // laba BERSIH minimum per round-trip
    auto_step: true,      // spacing ikut volatilitas
    rsi_filter: true,     // tahan beli bawah saat longsor, tahan beli atas saat pucuk
    trend_lot_mult: 0.5,  // lot ikut-tren = separuh lot normal
    max_trend_buys: 3,    // maks posisi ikut-tren bersamaan
    max_exposure_pct: 100,// total modal nyangkut maks (% budget)
    sl_pct: 5.0,          // stop darurat dari harga beli (%)
  },

  init(): DynamicState {
    return { anchor: 0, filledBuys: [], levelsHit: [], lastTrendBuyTs: 0, stepTs: 0, autoStep: 0 };
  },

  async onTick(ctx: StrategyContext, state: DynamicState, params: any): Promise<Action[]> {
    const price = ctx.ticker.last;
    if (!(price > 0)) return [];
    const actions: Action[] = [];
    const minLot = ctx.minLot ?? 0;
    const levels = Math.max(2, Math.min(20, Math.floor(numParam(params, 'levels', 8, 2, 20))));
    const grossPct = Math.max(numParam(params, 'profit_pct', 0.5, 0, 50), minGrossTargetPct(ctx.bot.exchange_id, params));
    const slPct = numParam(params, 'sl_pct', 5.0, 1, 50) / 100;

    // Spacing adaptif ATR (refresh 5 mnt): step = ATR% × 1, clamp 0.3–5%
    let step = numParam(params, 'step_pct', 1.0, 0.1, 10) / 100;
    if (params.auto_step !== false) {
      if (ctx.now - (state.stepTs || 0) > 300000) {
        try {
          const a = atrPct(await ctx.getKlines('15m', 60), 14);
          if (a > 0) { state.autoStep = Math.max(0.3, Math.min(5, a)); state.stepTs = ctx.now; }
        } catch { /* manual */ }
      }
      if (state.autoStep > 0) step = state.autoStep / 100;
    }

    // Data pasar untuk keputusan pintar
    let rsi7 = 50, trendUp = true, regimeMode: 'scalp' | 'normal' | 'hemat' = 'normal';
    let closes: number[] = [];
    try {
      const kl = await ctx.getKlines('5m', 60);
      closes = closesOf(kl);
      if (closes.length >= 9) {
        rsi7 = rsi(closes, 7);
        trendUp = closes.length >= 50 ? price > sma(closes, 50) : true;
        regimeMode = detectRegime(kl, params).mode;
      }
    } catch { /* tanpa data → mode netral */ }

    // ANCHOR DINAMIS: dikunci saat pegang barang (level konsisten); saat kosong,
    // diam di tempat agar osilasi memicu ping-pong, dan HANYA pindah mengikuti
    // harga bila pasar sudah kabur jauh (± setengah bentang grid) — ke rata-rata
    // 20 candle terakhir (halus, tak kejar sumbu sesaat).
    if (!state.anchor) { state.anchor = price; state.levelsHit = []; }
    else if (state.filledBuys.length === 0) {
      const halfSpan = (levels * step) / 2;
      if (price > state.anchor * (1 + halfSpan) || price < state.anchor * (1 - halfSpan)) {
        state.anchor = closes.length >= 20 ? sma(closes, 20) : price;
        state.levelsHit = [];
      }
    }

    const lot = lotFromBudget(ctx.bot.current_budget, levels);
    const exposure = state.filledBuys.reduce((s, b) => s + b.cost, 0);
    const maxExposure = ctx.bot.current_budget * (numParam(params, 'max_exposure_pct', 100, 10, 200) / 100);
    const canBuy = (need: number) => lot > 0 && exposure + need <= maxExposure;

    // === 1) JUAL: tiap fill yang sudah cuan bersih → lepas (ping), level bebas (pong lagi) ===
    const hold: typeof state.filledBuys = [];
    for (const b of state.filledBuys) {
      const target = b.price * (1 + grossPct / 100);
      const stop = b.price * (1 - slPct);
      if (price >= target && b.qty * price >= minLot) {
        actions.push({
          type: 'sell', qtyBase: b.qty, costBasis: b.cost,
          reason: `[DYN_SELL] Panen +${((price / b.price - 1) * 100).toFixed(2)}% @ ${Math.round(price)}`,
          tag: 'DYN_SELL', impactRp: (price * b.qty - b.cost) * ctx.usdtIdr
        });
        if (b.level != null) state.levelsHit = state.levelsHit.filter(l => l !== b.level);
      } else if (price <= stop && b.qty * price >= minLot) {
        // Stop darurat per fill: potong rugi, jangan seret seluruh modal
        actions.push({
          type: 'sell', qtyBase: b.qty, costBasis: b.cost,
          reason: `[DYN_SL] Stop darurat -${(slPct * 100).toFixed(1)}% @ ${Math.round(price)}`,
          tag: 'DYN_SL', impactRp: (price * b.qty - b.cost) * ctx.usdtIdr
        });
        if (b.level != null) state.levelsHit = state.levelsHit.filter(l => l !== b.level);
      } else {
        hold.push(b);
      }
    }
    state.filledBuys = hold;
    if (state.filledBuys.length === 0 && actions.length > 0) {
      state.anchor = price; // siklus bersih → re-center ke harga kini
      return actions;
    }

    const longslide = params.rsi_filter !== false && rsi7 < 25; // longsor: tahan beli bawah
    const toppy = params.rsi_filter !== false && rsi7 > 78;     // pucuk: tahan beli atas

    // === 2) BELI BAWAH (beli-murah): level tersentuh & belum terisi ===
    if (!longslide) {
      for (let i = 1; i <= levels; i++) {
        const line = state.anchor * (1 - i * step);
        if (price <= line && !state.levelsHit.includes(i) && canBuy(lot)) {
          actions.push({
            type: 'buy', amountQuote: lot,
            reason: `Dynamic beli-murah L${i} @ ${Math.round(line)} (target +${grossPct.toFixed(2)}%)`,
            tag: 'TRADE', meta: { level: i }
          });
          // Level ditandai scheduler HANYA saat fill sukses (bukan di sini).
          break; // satu level per tick — antre rapi, tidak borong sekaligus
        }
      }
    }

    // === 3) BELI ATAS (ikut-tren): tembus garis atas + tren naik + 1h selaras + tidak pucuk ===
    const trendCount = state.filledBuys.filter(b => (b.level ?? 0) >= TOP_OFF).length;
    const trendLot = Math.floor(lot * numParam(params, 'trend_lot_mult', 0.5, 0.1, 1));
    const htf = params.mtf_confirm === false ? 'flat' : await higherTrend(ctx.getKlines);
    if (!toppy && trendUp && htf !== 'down' && trendCount < Math.max(1, Math.min(10, Math.floor(numParam(params, 'max_trend_buys', 3, 1, 10))))
        && ctx.now - (state.lastTrendBuyTs || 0) >= adaptiveCooldownMs(params, regimeMode)) {
      for (let i = 1; i <= levels; i++) {
        const line = state.anchor * (1 + i * step);
        const lvl = TOP_OFF + i;
        if (price >= line && !state.levelsHit.includes(lvl) && trendLot > 0 && canBuy(trendLot)) {
          state.lastTrendBuyTs = ctx.now;
          actions.push({
            type: 'buy', amountQuote: trendLot,
            reason: `Dynamic ikut-tren T${i} tembus ${Math.round(line)} [${regimeMode}] @ ${Math.round(price)}`,
            tag: 'TRADE', meta: { level: lvl }
          });
          break; // satu per tick
        }
      }
    }

    return actions;
  },

  describe(p: any) {
    return `Ping-pong 2 arah, ${p.levels ?? 8} level @${p.step_pct ?? 1}% (auto-ATR), target +${p.profit_pct ?? 0.5}% bersih`;
  }
};

registerStrategy(dynamic);
export default dynamic;
