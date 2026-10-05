/**
 * Deteksi rezim pasar: scalp (volatile cepat) / normal / hemat (datar sepi).
 * Strategi membaca mode ini lalu menyesuaikan target profit & cooldown —
 * agresif saat grafik bergerak cepat, hemat fee saat pasar tidur.
 */
import { numParam } from './types.js';
import { atrPct, bollinger, closesOf } from './indicators.js';

export type RegimeMode = 'scalp' | 'normal' | 'hemat';

export interface Regime {
  mode: RegimeMode;
  atrPct: number;
  bandwidthPct: number;
  reason: string;
}

/**
 * Aturan (bisa dioverride via params):
 * - ATR% >= scalp_atr (def 1.2) ATAU bandwidth >= scalp_bw (def 3) → scalp
 * - ATR% <= flat_atr (def 0.25) DAN bandwidth <= flat_bw (def 0.8) → hemat
 * - selain itu → normal
 */
export function detectRegime(klines: any[], params: any): Regime {
  const a = atrPct(klines, 14);
  const closes = closesOf(klines);
  const bb = closes.length >= 20 ? bollinger(closes, 20, 2) : null;
  const bw = bb?.bandwidthPct ?? 0;
  const scalpAtr = numParam(params, 'scalp_atr', 1.2, 0.05, 20);
  const scalpBw = numParam(params, 'scalp_bw', 3, 0.1, 50);
  const flatAtr = numParam(params, 'flat_atr', 0.25, 0.01, 5);
  const flatBw = numParam(params, 'flat_bw', 0.8, 0.05, 10);

  if (klines.length < 20) {
    return { mode: 'normal', atrPct: a, bandwidthPct: bw, reason: 'data kurang (<20 candle)' };
  }
  if (a >= scalpAtr || bw >= scalpBw) {
    return { mode: 'scalp', atrPct: a, bandwidthPct: bw, reason: `volatile ATR ${a.toFixed(2)}% / BW ${bw.toFixed(2)}%` };
  }
  if (a <= flatAtr && bw <= flatBw) {
    return { mode: 'hemat', atrPct: a, bandwidthPct: bw, reason: `datar ATR ${a.toFixed(2)}% / BW ${bw.toFixed(2)}%` };
  }
  return { mode: 'normal', atrPct: a, bandwidthPct: bw, reason: `normal ATR ${a.toFixed(2)}%` };
}

/**
 * Target profit adaptif: scalp → kecil & sering (tak di bawah floor fee),
 * hemat → besar & jarang (kompensasi fee + waktu tunggu).
 */
export function adaptiveTargetPct(basePct: number, mode: RegimeMode, feeFloorPct: number): number {
  const scaled = mode === 'scalp' ? basePct * 0.6 : mode === 'hemat' ? basePct * 1.8 : basePct;
  return Math.max(scaled, feeFloorPct);
}

/** Cooldown antar-entry: scalp 2 mnt, normal 5 mnt, hemat 15 mnt (override via params.cooldown_min). */
export function adaptiveCooldownMs(params: any, mode: RegimeMode): number {
  const override = Number(params?.cooldown_min);
  if (Number.isFinite(override) && override > 0) return override * 60000;
  return (mode === 'scalp' ? 2 : mode === 'hemat' ? 15 : 5) * 60000;
}
