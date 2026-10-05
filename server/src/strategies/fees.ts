/**
 * Kesadaran fee per exchange — fondasi "cuan bersih, bukan cuan kotor".
 * Target profit strategi WAJIB di atas biaya pulang-pergi + buffer,
 * jika tidak bot hanya memperkaya exchange.
 */
import { numParam } from './types.js';

/** Taker fee (fraksi) per exchange. Konservatif: pakai tier reguler. */
const TAKER_FEE: Record<string, number> = {
  indodax: 0.003,
  tokocrypto: 0.001,
  binance: 0.001,
  bittime: 0.002,
  paper: 0.003,
};

/**
 * Fee satu sisi (fraksi). Bisa dioverride via params.fee_pct (dalam %,
 * mis. 0.3 = 0,3%) bila tier akun berbeda.
 */
export function takerFee(exchangeId: string, params: any): number {
  const override = Number(params?.fee_pct);
  if (Number.isFinite(override) && override >= 0 && override <= 5) return override / 100;
  return TAKER_FEE[String(exchangeId || '').toLowerCase()] ?? 0.003;
}

/** Biaya pulang-pergi beli+jual (fraksi dari modal). */
export function roundTripFee(exchangeId: string, params: any): number {
  const f = takerFee(exchangeId, params);
  return f * 2;
}

/**
 * Target gross minimum (%) agar hasil BERSIH tetap positif:
 * fee PP + buffer slippage + laba bersih yang diinginkan.
 * - buffer_pct default 0.2 (slippage/spread)
 * - net_pct default 0.3 (laba bersih minimum per trade)
 */
export function minGrossTargetPct(exchangeId: string, params: any): number {
  const buffer = numParam(params, 'buffer_pct', 0.2, 0, 5) / 100;
  const net = numParam(params, 'net_pct', 0.3, 0, 50) / 100;
  return (roundTripFee(exchangeId, params) + buffer + net) * 100;
}

/** Cek apakah harga jual memberi laba BERSIH (setelah fee dua sisi). */
export function isNetProfitable(buyPrice: number, sellPrice: number, exchangeId: string, params: any): boolean {
  if (!(buyPrice > 0) || !(sellPrice > 0)) return false;
  const f = takerFee(exchangeId, params);
  return sellPrice * (1 - f) > buyPrice * (1 + f);
}

/** Laba bersih dalam % dari modal (negatif = rugi). */
export function netProfitPct(buyPrice: number, sellPrice: number, exchangeId: string, params: any): number {
  if (!(buyPrice > 0)) return 0;
  const f = takerFee(exchangeId, params);
  return ((sellPrice * (1 - f) - buyPrice * (1 + f)) / (buyPrice * (1 + f))) * 100;
}
