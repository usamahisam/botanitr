import { registry } from '../exchange/registry.js';
import { Kline } from '../exchange/base.js';

/**
 * AI Wizard rule-based: analisis metrik candle + backtest replay sederhana
 * untuk men-skor 4 preset strategi per pasangan.
 */

export interface PresetDef {
  id: string;
  nama: string;
  strategi: string;
  gaya: string;
  deskripsi: string;
  params: Record<string, number | string>;
  leverage_label: string;
  tp_sl_label: string;
  timeframe: string;
}

export const PRESETS: PresetDef[] = [
  {
    id: 'scalper-pro', nama: 'Scalper Pro 1m', strategi: 'scalper', gaya: 'Scalping',
    deskripsi: 'Sangat responsif memanfaatkan momentum mikro candle 1m. Konfirmasi ganda EMA 20/50 & RSI.',
    params: { timeframe: '1m', ema_fast: 20, ema_slow: 50, rsi_period: 14, rsi_overbought: 70, tp_pct: 1.2, sl_pct: 0.6 },
    leverage_label: '5x', tp_sl_label: '1.2% / 0.6%', timeframe: '1m'
  },
  {
    id: 'grid-sideways', nama: 'Grid Sideways', strategi: 'grid', gaya: 'Range',
    deskripsi: 'Memanen osilasi harga dalam range. Cocok untuk pasar sideways dengan volume stabil.',
    params: { lower_pct: 3, upper_pct: 3, levels: 6 },
    leverage_label: '1x', tp_sl_label: 'Auto unwind', timeframe: 'Tick'
  },
  {
    id: 'dca-akumulasi', nama: 'DCA Akumulasi', strategi: 'dca', gaya: 'Trend',
    deskripsi: 'Beli bertahap saat harga turun, jual di target. Aman untuk koin fundamental kuat.',
    params: { drop_pct: 2, take_profit_pct: 3, max_buys: 5 },
    leverage_label: '1x', tp_sl_label: 'TP 3%', timeframe: 'Tick'
  },
  {
    id: 'harvester-aman', nama: 'Harvester Aman', strategi: 'harvester', gaya: 'Akumulasi',
    deskripsi: 'PALING AMAN. Akumulasi saat turun, panen modal cair + profit saat rebound.',
    params: { drop_pct: 2.5, harvest_pct: 2, max_buys: 8 },
    leverage_label: '1x', tp_sl_label: 'Harvest 2%', timeframe: 'Tick'
  }
];

interface Metrics { volPct: number; rangePct: number; trendPct: number; candles: number }

function computeMetrics(klines: Kline[]): Metrics {
  if (klines.length < 5) return { volPct: 0, rangePct: 0, trendPct: 0, candles: klines.length };
  const closes = klines.map(k => k[4]);
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const volPct = Math.sqrt(variance) * 100;
  const high = Math.max(...klines.map(k => k[2]));
  const low = Math.min(...klines.map(k => k[3]));
  const rangePct = low > 0 ? ((high - low) / low) * 100 : 0;
  const first = closes[0], last = closes[closes.length - 1];
  const trendPct = first > 0 ? ((last - first) / first) * 100 : 0;
  return { volPct, rangePct, trendPct, candles: klines.length };
}

/** Skor preset berdasarkan metrik pasar (0–100) */
function scorePreset(preset: PresetDef, m: Metrics): number {
  let score = 50;
  switch (preset.strategi) {
    case 'scalper':
      score += Math.min(30, m.volPct * 15);       // butuh volatilitas
      if (Math.abs(m.trendPct) < 1) score += 10;   // mikro ranging
      break;
    case 'grid':
      score += Math.min(25, m.rangePct * 2);       // butuh range lebar
      if (Math.abs(m.trendPct) < 3) score += 15;   // sideways ideal
      else score -= Math.min(20, Math.abs(m.trendPct) * 3); // tren kuat buruk
      break;
    case 'dca':
      if (m.trendPct < 0 && m.trendPct > -10) score += 20; // turun moderat = akumulasi
      if (m.trendPct >= 0) score += 5;
      score += Math.min(15, m.volPct * 5);
      break;
    case 'harvester':
      score += 15;                                  // selalu cukup aman
      if (m.trendPct < 0) score += 10;
      if (m.volPct > 0.5 && m.volPct < 5) score += 10;
      break;
  }
  return Math.max(5, Math.min(98, Math.round(score * 10) / 10));
}

/** Backtest replay sederhana di atas klines (simulasi murni, tanpa DB) */
export function backtest(preset: PresetDef, klines: Kline[], budgetQuote: number): { winRate: number; profitPct: number; trades: number; maxDrawdownPct: number } {
  const closes = klines.map(k => k[4]);
  if (closes.length < 30) return { winRate: 0, profitPct: 0, trades: 0, maxDrawdownPct: 0 };
  const fee = 0.003;
  let wins = 0, total = 0, profit = 0, maxDd = 0, peak = budgetQuote;

  if (preset.strategi === 'scalper') {
    const p = preset.params;
    let pos: { entry: number; qty: number } | null = null;
    const ema = (arr: number[], per: number) => { const k = 2 / (per + 1); let e = arr[0]; for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k); return e; };
    let prevAbove: boolean | null = null;
    let equity = budgetQuote;
    for (let i = Number(p.ema_slow) + 2; i < closes.length; i++) {
      const slice = closes.slice(0, i + 1);
      const fast = ema(slice.slice(-Number(p.ema_fast) - 1), Number(p.ema_fast));
      const slow = ema(slice.slice(-Number(p.ema_slow) - 1), Number(p.ema_slow));
      const above = fast > slow;
      const price = closes[i];
      if (pos) {
        const tp = pos.entry * (1 + Number(p.tp_pct) / 100);
        const sl = pos.entry * (1 - Number(p.sl_pct) / 100);
        if (price >= tp || price <= sl || (prevAbove === true && !above)) {
          const value = pos.qty * price * (1 - fee);
          const pnl = value - budgetQuote;
          profit += pnl; total++; if (pnl > 0) wins++;
          equity = budgetQuote + profit;
          peak = Math.max(peak, equity);
          maxDd = Math.max(maxDd, peak > 0 ? (peak - equity) / peak * 100 : 0);
          pos = null;
        }
      } else if (prevAbove === false && above) {
        pos = { entry: price, qty: (budgetQuote * (1 - fee)) / price };
      }
      prevAbove = above;
    }
  } else {
    // Grid/DCA/Harvester disederhanakan: simulasi mean-reversion
    const p = preset.params;
    const stepPct = Number(p.drop_pct ?? p.lower_pct ?? 2) / 100;
    const tpPct = Number(p.take_profit_pct ?? p.harvest_pct ?? 3) / 100;
    let entries: { price: number; cost: number }[] = [];
    const lot = budgetQuote / Number(p.max_buys ?? p.levels ?? 5);
    let lastBuy = 0;
    for (const price of closes) {
      if (entries.length === 0) { entries.push({ price, cost: lot }); lastBuy = price; continue; }
      const totalCost = entries.reduce((s, e) => s + e.cost, 0);
      const avg = totalCost / entries.length;
      if (price >= avg * (1 + tpPct + fee)) {
        const pnl = totalCost * tpPct - totalCost * fee;
        profit += pnl; total++; if (pnl > 0) wins++;
        entries = [];
        continue;
      }
      if (lastBuy > 0 && price <= lastBuy * (1 - stepPct) && entries.length < Number(p.max_buys ?? p.levels ?? 5)) {
        entries.push({ price, cost: lot }); lastBuy = price;
      }
    }
    // Posisi mengambang dihitung drawdown
    if (entries.length > 0) {
      const totalCost = entries.reduce((s, e) => s + e.cost, 0);
      const lastPrice = closes[closes.length - 1];
      const floating = (lastPrice / (totalCost / entries.length) - 1) * 100;
      maxDd = Math.max(maxDd, Math.max(0, -floating));
    }
  }

  const profitPct = (profit / budgetQuote) * 100;
  return {
    winRate: total > 0 ? Math.round((wins / total) * 1000) / 10 : 0,
    profitPct: Math.round(profitPct * 100) / 100,
    trades: total,
    maxDrawdownPct: Math.round(maxDd * 100) / 100
  };
}

export interface PresetRecommendation extends PresetDef {
  skor: number;
  backtest: { winRate: number; profitPct: number; trades: number; maxDrawdownPct: number };
}

const recCache = new Map<string, { data: PresetRecommendation[]; ts: number }>();

/** Analisis + skor 4 preset untuk satu pasangan (cache 15 menit) */
export async function recommend(exchangeId: string, pair: string, budgetQuote = 100000): Promise<PresetRecommendation[]> {
  const key = `${exchangeId}:${pair}`;
  const c = recCache.get(key);
  if (c && Date.now() - c.ts < 15 * 60 * 1000) return c.data;

  const client = registry.get(exchangeId);
  // Candle harian untuk metrik + 1m/1h untuk backtest scalper
  let daily: Kline[] = [];
  let micro: Kline[] = [];
  try { daily = await client.getKlines(pair, '1d', 14); } catch { /* lanjut */ }
  try { micro = await client.getKlines(pair, '1m', 500); } catch { /* lanjut */ }
  if (daily.length < 5 && micro.length >= 30) daily = micro;
  if (micro.length < 30) micro = daily;

  const metrics = computeMetrics(daily);
  const out: PresetRecommendation[] = PRESETS.map(preset => ({
    ...preset,
    skor: scorePreset(preset, metrics),
    backtest: backtest(preset, preset.strategi === 'scalper' ? micro : daily, budgetQuote)
  })).sort((a, b) => b.skor - a.skor);

  recCache.set(key, { data: out, ts: Date.now() });
  return out;
}
