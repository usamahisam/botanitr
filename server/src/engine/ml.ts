import { closesOf, rsi, ema, atrPct, bollinger } from '../strategies/indicators.js';
import { KlineTuple } from './replay.js';

/**
 * Fondasi ML (tanpa dependensi): ekstraksi fitur teknikal + evaluasi sinyal
 * secara walk-forward (latih 70% / uji 30%). Disiplin yang sama dipakai model
 * ML serius: sinyal hanya dipercaya bila bertahan di data uji yang belum
 * terlihat — anti overfitting sejak hari pertama.
 */

export interface FeatureRow {
  i: number;
  rsi14: number;
  emaSpread: number;  // (ema12-ema26)/harga
  atr: number;        // ATR% 14
  bbPos: number;      // posisi dalam Bollinger (0=bawah, 1=atas)
  ret1: number;       // return 1 candle
  futureMax: number;  // kenaikan maks H candle ke depan (label)
}

export function extractFeatures(klines: KlineTuple[], horizon = 6): FeatureRow[] {
  const closes = closesOf(klines);
  const out: FeatureRow[] = [];
  for (let i = 30; i < closes.length - horizon; i++) {
    const w = closes.slice(0, i + 1);
    const price = closes[i];
    const bb = bollinger(w, 20, 2, price);
    const fut = closes.slice(i + 1, i + 1 + horizon);
    out.push({
      i,
      rsi14: rsi(w, 14),
      emaSpread: (ema(w.slice(-27), 12) - ema(w.slice(-27), 26)) / price,
      atr: atrPct(klines.slice(0, i + 1) as any, 14),
      bbPos: bb ? bb.percentB : 0.5,
      ret1: (price - closes[i - 1]) / closes[i - 1],
      futureMax: Math.max(...fut.map(f => (f - price) / price)),
    });
  }
  return out;
}

export type SignalFn = (f: FeatureRow) => boolean;

export interface SignalReport {
  name: string;
  trainPrecision: number; testPrecision: number;
  testSignals: number; score: number;
}

/** Kandidat sinyal bawaan (ambang dipilih di data latih, dinilai di data uji) */
const CANDIDATES: { name: string; make: (t: number) => SignalFn; thresholds: number[] }[] = [
  { name: 'rsi-oversold', make: t => f => f.rsi14 <= t, thresholds: [15, 20, 25, 30] },
  { name: 'ema-cross-up', make: t => f => f.emaSpread >= t, thresholds: [0, 0.001, 0.002, 0.005] },
  { name: 'bb-bawah', make: t => f => f.bbPos <= t, thresholds: [-0.1, 0.0, 0.1, 0.2] },
];

/**
 * Sinyal dianggap benar bila harga naik ≥ target dalam horizon.
 * Skor = presisi uji − penalti gap latih/uji (pola optimizer).
 */
export function evaluateSignals(rows: FeatureRow[], target = 0.01): SignalReport[] {
  const split = Math.floor(rows.length * 0.7);
  const train = rows.slice(0, split), test = rows.slice(split);
  const out: SignalReport[] = [];
  for (const c of CANDIDATES) {
    let best = { t: c.thresholds[0], prec: 0, n: 0 };
    for (const t of c.thresholds) {
      const fn = c.make(t);
      const hits = train.filter(fn);
      if (hits.length < 5) continue;
      const prec = hits.filter(f => f.futureMax >= target).length / hits.length;
      if (prec > best.prec) best = { t, prec, n: hits.length };
    }
    const fn = c.make(best.t);
    const th = test.filter(fn);
    const testPrec = th.length > 0 ? th.filter(f => f.futureMax >= target).length / th.length : 0;
    const gap = Math.max(0, best.prec - testPrec);
    out.push({
      name: `${c.name}≤${best.t}`, trainPrecision: r2(best.prec), testPrecision: r2(testPrec),
      testSignals: th.length, score: r2(testPrec - gap * 0.5),
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

const r2 = (n: number) => Math.round(n * 100) / 100;
