import { minGrossTargetPct } from '../strategies/fees.js';
import { numParam } from '../strategies/types.js';

/**
 * Jarak ke target jual terdekat: menjawab "kenapa sulit jual" dengan angka.
 * Untuk tiap posisi terbuka, hitung harga jual yang ditunggu strategi dan
 * berapa % lagi dari harga sekarang. Negatif = seharusnya sudah terjual
 * (atau menunggu konfirmasi candle/SL).
 */
export interface SellTarget { pctAway: number; label: string }

function gross(params: any, exchangeId: string, profitKey: string, profitDef: number): number {
  return Math.max(numParam(params, profitKey, profitDef, 0, 50), minGrossTargetPct(exchangeId, params));
}

export function nearestSellTarget(
  strategy: string, state: any, params: any, exchangeId: string, price: number
): SellTarget | null {
  if (!(price > 0)) return null;
  const minLot = 0; // jarak dihitung tanpa filter debu
  void minLot;

  if (strategy === 'grid' || strategy === 'dynamic') {
    const fills: any[] = state.filledBuys || [];
    if (fills.length === 0) return null;
    const g = gross(params, exchangeId, 'profit_pct', 0.5) / 100;
    let best = Infinity;
    for (const b of fills) {
      if (!(b.price > 0)) continue;
      best = Math.min(best, (b.price * (1 + g)) / price - 1);
    }
    return { pctAway: best * 100, label: `target +${(g * 100).toFixed(2)}%/level` };
  }

  if (strategy === 'dca') {
    const entries: any[] = state.entries || [];
    if (entries.length === 0) return null;
    const cost = entries.reduce((s, e) => s + e.cost, 0);
    const qty = entries.reduce((s, e) => s + e.qty, 0);
    if (!(qty > 0)) return null;
    const avg = cost / qty;
    const tp = numParam(params, 'take_profit_pct', 3, 0.1, 100) / 100;
    if (!state.tier1Done) {
      const t1 = Math.max(tp * 0.5, minGrossTargetPct(exchangeId, params) / 100);
      return { pctAway: ((avg * (1 + t1)) / price - 1) * 100, label: 'panen parsial' };
    }
    return { pctAway: ((avg * (1 + tp + 0.004)) / price - 1) * 100, label: 'target penuh' };
  }

  if (strategy === 'harvester') {
    const entries: any[] = state.entries || [];
    if (entries.length === 0) return null;
    const cost = entries.reduce((s, e) => s + e.cost, 0);
    const qty = entries.reduce((s, e) => s + e.qty, 0);
    if (!(qty > 0)) return null;
    const avg = cost / qty;
    const h = Math.max(numParam(params, 'harvest_pct', 2, 0.1, 100) / 100, minGrossTargetPct(exchangeId, params) / 100);
    return { pctAway: ((avg * (1 + h)) / price - 1) * 100, label: 'panen' };
  }

  // Posisi tunggal: scalper/revert/bollinger/breakout
  const pos = state.position;
  if (pos && pos.entryPrice > 0) {
    const tp = Math.max(numParam(params, 'tp_pct', 1.0, 0.1, 100), minGrossTargetPct(exchangeId, params));
    return { pctAway: ((pos.entryPrice * (1 + tp / 100)) / price - 1) * 100, label: 'take-profit' };
  }
  return null;
}
