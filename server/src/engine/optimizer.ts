import { replay, KlineTuple } from './replay.js';

/**
 * Optimasi parameter otomatis (grid-search + walk-forward):
 * data dibagi latih 70% / uji 30%. Skor = return bersih di data UJI,
 * dikurangi penalti overfitting (|latih-uji|). Mencegah parameter yang
 * hanya bagus di masa lalu (curve-fitting).
 */

export interface OptimizeOpts {
  budget?: number;
  fee?: number;
  slippagePct?: number;
  minTrades?: number;   // abaikan kombinasi dengan trade terlalu sedikit
  maxDdPct?: number;     // abaikan kombinasi dengan drawdown berlebihan
  maxCombos?: number;
}

export interface OptimizeResult {
  params: Record<string, any>;
  trainRet: number; testRet: number; score: number;
  trades: number; maxDd: number;
}

/** Ruang pencarian per strategi (sengaja kecil agar cepat) */
const SPACES: Record<string, Record<string, number[]>> = {
  dynamic: {
    step_pct: [0.5, 1.0, 1.5], levels: [6, 8, 12],
    profit_pct: [0.3, 0.5, 0.8], max_trend_buys: [2, 3],
  },
  grid: {
    lower_pct: [2, 3, 5], upper_pct: [2, 3, 5], levels: [4, 6, 8],
    profit_pct: [0.3, 0.5, 0.8],
  },
  scalper: {
    ema_fast: [10, 20], ema_slow: [30, 50], rsi_entry: [45, 55],
    tp_pct: [0.8, 1.2], sl_pct: [0.6, 1.0], trailing_pct: [0.5, 0.8],
  },
  dca: {
    drop_pct: [1.5, 2, 3], take_profit_pct: [2, 3, 5], max_buys: [4, 6],
  },
  harvester: {
    drop_pct: [2, 2.5, 3.5], harvest_pct: [1.5, 2, 3], max_buys: [6, 8],
  },
  revert: {
    rsi_len: [2, 3], oversold: [15, 20, 25], tp_pct: [0.8, 1.2], sl_pct: [2, 3],
  },
  bollinger: {
    bb_period: [15, 20], entry_b: [-0.1, 0.0], exit_b: [0.5, 0.8], sl_pct: [2, 3],
  },
  breakout: {
    donchian_n: [15, 20, 30], tp_pct: [0.6, 0.8, 1.2], sl_pct: [1.0, 1.5],
  },
};

function combos(space: Record<string, number[]>, max: number): Record<string, any>[] {
  const keys = Object.keys(space);
  const out: Record<string, any>[] = [];
  const rec = (i: number, cur: Record<string, any>) => {
    if (out.length >= max) return;
    if (i === keys.length) { out.push({ ...cur }); return; }
    for (const v of space[keys[i]]) {
      cur[keys[i]] = v;
      rec(i + 1, cur);
      if (out.length >= max) return;
    }
  };
  rec(0, {});
  return out;
}

export async function optimize(
  strategy: string, baseParams: Record<string, any>, klines: KlineTuple[],
  opts: OptimizeOpts & { exchangeId?: string; stepMs?: number } = {}
): Promise<OptimizeResult[]> {
  const space = SPACES[strategy];
  if (!space) throw new Error(`Strategi ${strategy} belum punya ruang pencarian`);
  if (klines.length < 60) throw new Error('Data kurang untuk walk-forward (butuh ≥60 candle)');
  const minTrades = opts.minTrades ?? 3;
  const maxDd = opts.maxDdPct ?? 30;
  const split = Math.floor(klines.length * 0.7);
  const train = klines.slice(0, split), test = klines.slice(split);
  const results: OptimizeResult[] = [];

  for (const c of combos(space, opts.maxCombos ?? 200)) {
    const params = { ...baseParams, ...c };
    const rTrain = await replay(strategy, params, train, {
      budget: opts.budget ?? 1000000, fee: opts.fee ?? 0.003,
      slippagePct: opts.slippagePct ?? 0.05, exchangeId: opts.exchangeId,
      stepMs: opts.stepMs,
    });
    if (rTrain.buys + rTrain.sells < minTrades) continue;
    const rTest = await replay(strategy, params, test, {
      budget: opts.budget ?? 1000000, fee: opts.fee ?? 0.003,
      slippagePct: opts.slippagePct ?? 0.05, exchangeId: opts.exchangeId,
      stepMs: opts.stepMs,
    });
    if (rTest.buys + rTest.sells < minTrades || rTest.maxDdPct > maxDd) continue;
    // Penalti overfitting: bagus di latih tapi jeblok di uji = tidak dipercaya
    const gap = Math.max(0, rTrain.retPct - rTest.retPct);
    const score = rTest.retPct - gap * 0.5;
    results.push({
      params: c, trainRet: rTrain.retPct, testRet: rTest.retPct,
      score, trades: rTest.buys + rTest.sells, maxDd: rTest.maxDdPct,
    });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 5);
}

export function supportedStrategies(): string[] {
  return Object.keys(SPACES);
}
