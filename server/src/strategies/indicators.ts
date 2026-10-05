/**
 * Indikator teknikal bersama untuk semua strategi.
 * Rumus disamakan dengan implementasi lama (scalper) agar perilaku tak berubah.
 * Menerima klines tuple [t,o,h,l,c,v] maupun objek {o,h,l,c,v}.
 */

export interface Candle { o: number; h: number; l: number; c: number; v: number }

export function toCandles(klines: any[]): Candle[] {
  if (!Array.isArray(klines)) return [];
  const out: Candle[] = [];
  for (const k of klines) {
    const c: Candle = Array.isArray(k)
      ? { o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]), v: Number(k[5] ?? 0) }
      : { o: Number(k?.o), h: Number(k?.h), l: Number(k?.l), c: Number(k?.c), v: Number(k?.v ?? 0) };
    if ([c.o, c.h, c.l, c.c].every(Number.isFinite)) out.push(c);
  }
  return out;
}

export function closesOf(klines: any[]): number[] {
  return toCandles(klines).map(k => k.c);
}

export function sma(values: number[], period: number): number {
  if (values.length === 0 || period <= 0) return NaN;
  const s = values.slice(-period);
  return s.reduce((a, b) => a + b, 0) / s.length;
}

export function ema(values: number[], period: number): number {
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

export function rsi(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  if (losses === 0) return 100;
  if (gains === 0) return 0;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

/** ATR sederhana (rata-rata true range), dalam satuan harga. */
export function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].h, l = candles[i].l, pc = candles[i - 1].c;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const s = trs.slice(-Math.max(1, period));
  return s.reduce((a, b) => a + b, 0) / s.length;
}

/** ATR sebagai % dari harga terakhir — ukuran volatilitas antar-pair. */
export function atrPct(klines: any[], period = 14): number {
  const candles = toCandles(klines);
  if (candles.length < 2) return 0;
  const last = candles[candles.length - 1].c;
  if (!(last > 0)) return 0;
  return (atr(candles, period) / last) * 100;
}

export interface Bollinger { mid: number; upper: number; lower: number; bandwidthPct: number; percentB: number }

export function bollinger(closes: number[], period = 20, mult = 2, price?: number): Bollinger | null {
  if (closes.length < period) return null;
  const s = closes.slice(-period);
  const mid = s.reduce((a, b) => a + b, 0) / s.length;
  const variance = s.reduce((a, b) => a + (b - mid) ** 2, 0) / s.length;
  const sd = Math.sqrt(variance);
  const upper = mid + mult * sd, lower = mid - mult * sd;
  const px = price ?? closes[closes.length - 1];
  const bandwidthPct = mid > 0 ? ((upper - lower) / mid) * 100 : 0;
  const percentB = upper !== lower ? (px - lower) / (upper - lower) : 0.5;
  return { mid, upper, lower, bandwidthPct, percentB };
}

/** Tertinggi/terendah N candle SEBELUM candle terakhir (untuk breakout). */
export function donchian(klines: any[], n: number): { high: number; low: number } | null {
  const candles = toCandles(klines);
  if (candles.length < n + 1) return null;
  const window = candles.slice(-n - 1, -1);
  return {
    high: Math.max(...window.map(c => c.h)),
    low: Math.min(...window.map(c => c.l)),
  };
}
