import { registry } from '../exchange/registry.js';
import { Kline } from '../exchange/base.js';

/**
 * AI Wizard rule-based: analisis metrik candle + backtest replay sederhana
 * untuk men-skor 10 preset strategi per pasangan.
 */

export interface PresetDef {
  id: string;
  nama: string;
  strategi: string;
  gaya: string;
  deskripsi: string;
  params: Record<string, any>;
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
  },
  {
    id: 'revert-pantulan', nama: 'Revert Pantulan', strategi: 'revert', gaya: 'Mean-Reversion',
    deskripsi: 'Beli saat oversold ekstrem (RSI pendek) dalam tren naik, jual saat memantul. Sering ada sinyal di grafik cepat.',
    params: { timeframe: '5m', rsi_len: 3, oversold: 20, exit_rsi: 65, trend_sma: 100, tp_pct: 1.0, sl_pct: 3.0 },
    leverage_label: '1x', tp_sl_label: 'TP 1% / SL 3%', timeframe: '5m'
  },
  {
    id: 'bollinger-band', nama: 'Bollinger Reversal', strategi: 'bollinger', gaya: 'Range',
    deskripsi: 'Beli di lower band, jual di tengah/atas band. Raja pasar sideways berosilasi.',
    params: { timeframe: '5m', bb_period: 20, bb_mult: 2, entry_b: 0.0, exit_b: 0.5, tp_pct: 1.0, sl_pct: 3.0 },
    leverage_label: '1x', tp_sl_label: 'Auto %b', timeframe: '5m'
  },
  {
    id: 'breakout-mikro', nama: 'Breakout Mikro', strategi: 'breakout', gaya: 'Momentum',
    deskripsi: 'Ikut tembusan harga tercepat + TP ketat + trailing ATR. Untuk grafik trending cepat.',
    params: { timeframe: '5m', donchian_n: 20, tp_pct: 0.8, sl_pct: 1.2, trail_atr_mult: 1.5 },
    leverage_label: '1x', tp_sl_label: 'TP 0.8% / SL 1.2%', timeframe: '5m'
  },
  {
    id: 'dynamic-pingpong', nama: 'Dynamic Ping-Pong', strategi: 'dynamic', gaya: 'Dua-Arah',
    deskripsi: 'PALING PINTAR. Beli saat turun, ikut saat naik, panen tiap level berkali-kali. Anchor mengikuti harga.',
    params: { step_pct: 1.0, levels: 8, profit_pct: 0.5, auto_step: true, rsi_filter: true, trend_lot_mult: 0.5, max_trend_buys: 3, max_exposure_pct: 100, sl_pct: 5.0 },
    leverage_label: '1x', tp_sl_label: 'Auto ping-pong', timeframe: 'Tick + 5m'
  },
  {
    id: 'flash-scalper', nama: 'Flash Scalper', strategi: 'scalper', gaya: 'Kilatturbo',
    deskripsi: 'Scalping tercepat: tick 4 detik, cooldown 60 detik, TP mikro. WAJIB fee 0,1% (Tokocrypto/Binance) — rugi di Indodax.',
    params: { timeframe: '1m', ema_fast: 12, ema_slow: 30, rsi_period: 7, rsi_entry: 60, rsi_overbought: 75, tp_pct: 1.2, sl_pct: 0.7, trailing_pct: 0.8, cooldown_min: 1, max_trades_per_day: 20, turbo: true },
    leverage_label: '1x', tp_sl_label: 'TP 1.2% / SL 0.7%', timeframe: '1m'
  },
  {
    id: 'rebalance-portfolio', nama: 'Rebalance Portfolio', strategi: 'rebalance', gaya: 'Alokasi',
    deskripsi: 'Jaga komposisi aset sesuai target. Jual yang berlebih, beli yang kurang — disiplin ala manajer dana.',
    params: { targets: { BTC: 50, ETH: 30 }, threshold_pct: 2, interval_min: 60 },
    leverage_label: '1x', tp_sl_label: 'Auto rebalance', timeframe: 'Per jam'
  }
];

interface Metrics { volPct: number; rangePct: number; trendPct: number; candles: number }

export interface MarketRegime {
  key: 'naik-kuat' | 'naik' | 'sideways' | 'turun' | 'turun-kuat';
  vol: 'volatile' | 'normal' | 'sepi';
  label: string;
  trendPct: number;
}

/**
 * Rezim pasar dari grafik pair: posisi harga vs SMA50 + kemiringan + ATR.
 * Dipakai mengarahkan peringkat strategi (tren → momentum, sideways → range).
 */
export function detectMarketRegime(klines: Kline[]): MarketRegime {
  const closes = klines.map(k => k[4]).filter(Number.isFinite);
  const last = closes[closes.length - 1] || 0;
  const first = closes[0] || 0;
  // ATR% sebagai ukuran gerak
  let tr = 0, n = 0;
  for (let i = Math.max(1, closes.length - 30); i < closes.length; i++) {
    tr += Math.abs(closes[i] - closes[i - 1]) / closes[i - 1]; n++;
  }
  const atrPct = n > 0 ? (tr / n) * 100 : 0;
  // Tren = awal-ke-akhir (selaras metrik skor), bukan vs rata-rata yang
  // mengecilkan tren bertahap (+8% total hanya +1,9% vs SMA50).
  const trendPct = first > 0 ? ((last - first) / first) * 100 : 0;

  let key: MarketRegime['key'] = 'sideways';
  if (trendPct >= 5) key = 'naik-kuat';
  else if (trendPct >= 1.5) key = 'naik';
  else if (trendPct <= -5) key = 'turun-kuat';
  else if (trendPct <= -1.5) key = 'turun';

  const vol: MarketRegime['vol'] = atrPct >= 1.2 ? 'volatile' : atrPct <= 0.25 ? 'sepi' : 'normal';
  const arah = { 'naik-kuat': 'Uptrend kuat', naik: 'Uptrend', sideways: 'Sideways', turun: 'Downtrend', 'turun-kuat': 'Downtrend kuat' }[key];
  const gerak = vol === 'volatile' ? 'bergerak cepat' : vol === 'sepi' ? 'bergerak pelan' : 'bergerak normal';
  return { key, vol, trendPct: Math.round(trendPct * 10) / 10, label: `${arah}, ${gerak} (${trendPct >= 0 ? '+' : ''}${trendPct.toFixed(1)}% sebulan)` };
}

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

/** Skor preset berdasarkan metrik pasar + rezim grafik (0–100) */
function scorePreset(preset: PresetDef, m: Metrics, regime?: MarketRegime): number {
  let score = 50;
  switch (preset.strategi) {
    case 'scalper':
      score += Math.min(30, m.volPct * 15);       // butuh volatilitas
      if (Math.abs(m.trendPct) < 1) score += 10;   // mikro ranging
      if ((preset.params as any)?.turbo) score += m.volPct >= 1.2 ? 8 : -12; // flash butuh pasar cepat
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
    case 'revert':
      score += Math.min(25, m.volPct * 12);         // butuh pantulan (volatilitas)
      if (m.trendPct > 0) score += 15;              // tren naik = filter SMA lolos
      else score -= 10;
      break;
    case 'bollinger':
      score += Math.min(25, m.rangePct * 2);        // butuh osilasi lebar
      if (Math.abs(m.trendPct) < 3) score += 15;     // sideways ideal
      else score -= Math.min(20, Math.abs(m.trendPct) * 3);
      break;
    case 'breakout':
      if (m.trendPct > 2) score += 25;               // tren naik = tembusan valid
      else if (m.trendPct < -2) score -= 15;
      score += Math.min(15, m.volPct * 6);
      break;
    case 'dynamic':
      score += 12;                                   // adaptif semua kondisi
      score += Math.min(20, m.rangePct * 1.5);       // makin osilasi makin panen
      if (Math.abs(m.trendPct) < 5) score += 8;
      break;
  }
  // Lapisan rezim grafik: dorong strategi yang cocok arah pasar, tekan yang
  // berlawanan. Ini yang membuat peringkat 1-2-3 mengikuti koinnya.
  if (regime) {
    const boost = (s: string, v: number) => { if (preset.strategi === s) score += v; };
    switch (regime.key) {
      case 'naik-kuat':
        boost('breakout', 20); boost('scalper', 12); boost('revert', 12); boost('dynamic', 8);
        boost('grid', -5); boost('harvester', -5);
        break;
      case 'naik':
        boost('breakout', 12); boost('scalper', 8); boost('revert', 8); boost('dynamic', 6);
        break;
      case 'turun-kuat':
        boost('harvester', 15); boost('dca', 15); boost('grid', 10); boost('dynamic', 8); boost('bollinger', 8);
        boost('breakout', -15); boost('scalper', -10); boost('revert', -5);
        break;
      case 'turun':
        boost('harvester', 10); boost('dca', 10); boost('grid', 8); boost('dynamic', 5);
        boost('breakout', -8);
        break;
      default: // sideways
        boost('grid', 12); boost('bollinger', 12); boost('dynamic', 10); boost('scalper', 8);
        break;
    }
    if (regime.vol === 'volatile') { boost('scalper', 8); boost('breakout', 8); boost('dynamic', 6); }
    if (regime.vol === 'sepi') { boost('scalper', -10); boost('breakout', -10); }
  }
  return Math.max(5, Math.min(98, Math.round(score * 10) / 10));
}

export interface EquityPoint { t: number; v: number }
export interface BacktestResult {
  winRate: number; profitPct: number; trades: number; maxDrawdownPct: number;
  equity: EquityPoint[];
  note?: string;
}

/** Backtest replay sederhana di atas klines (simulasi murni, tanpa DB) */
export function backtest(preset: PresetDef, klines: Kline[], budgetQuote: number): BacktestResult {
  const closes = klines.map(k => k[4]);
  const times = klines.map(k => k[0]);
  const empty: BacktestResult = { winRate: 0, profitPct: 0, trades: 0, maxDrawdownPct: 0, equity: [] };
  if (closes.length < 30) return empty;
  const fee = 0.003;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const sampleEvery = Math.max(1, Math.floor(closes.length / 150));
  const equity: EquityPoint[] = [];
  let wins = 0, total = 0, profit = 0, maxDd = 0, peak = budgetQuote;
  const trackDd = (eq: number) => {
    peak = Math.max(peak, eq);
    if (peak > 0) maxDd = Math.max(maxDd, (peak - eq) / peak * 100);
  };

  if (preset.strategi === 'scalper') {
    const p = preset.params;
    let pos: { entry: number; qty: number } | null = null;
    const ema = (arr: number[], per: number) => { const k = 2 / (per + 1); let e = arr[0]; for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k); return e; };
    let prevAbove: boolean | null = null;
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
          trackDd(budgetQuote + profit);
          pos = null;
        }
      } else if (prevAbove === false && above) {
        pos = { entry: price, qty: (budgetQuote * (1 - fee)) / price };
      }
      prevAbove = above;
      if (i % sampleEvery === 0 || i === closes.length - 1) {
        const eq = pos ? profit + pos.qty * price * (1 - fee) : budgetQuote + profit;
        equity.push({ t: times[i], v: r2(eq) });
        trackDd(eq);
      }
    }
  } else {
    // Grid/DCA/Harvester disederhanakan: simulasi mean-reversion.
    // avg = harga rata-rata tertimbang qty (satuan HARGA — bukan nominal).
    const p = preset.params;
    const stepPct = Number(p.drop_pct ?? p.lower_pct ?? 2) / 100;
    const tpPct = Number(p.take_profit_pct ?? p.harvest_pct ?? 3) / 100;
    const maxN = Number(p.max_buys ?? p.levels ?? 5);
    let entries: { price: number; qty: number; cost: number }[] = [];
    const lot = budgetQuote / maxN;
    let lastBuy = 0;
    closes.forEach((price, i) => {
      if (!(price > 0)) return;
      if (entries.length === 0) { entries.push({ price, qty: lot / price, cost: lot }); lastBuy = price; }
      else {
        const totalCost = entries.reduce((s, e) => s + e.cost, 0);
        const totalQty = entries.reduce((s, e) => s + e.qty, 0);
        const avg = totalQty > 0 ? totalCost / totalQty : 0;
        if (avg > 0 && price >= avg * (1 + tpPct + fee)) {
          const proceeds = totalQty * price * (1 - fee);
          const pnl = proceeds - totalCost;
          profit += pnl; total++; if (pnl > 0) wins++;
          entries = [];
          trackDd(budgetQuote + profit);
        } else if (lastBuy > 0 && price <= lastBuy * (1 - stepPct) && entries.length < maxN) {
          entries.push({ price, qty: lot / price, cost: lot }); lastBuy = price;
        }
      }
      if (i % sampleEvery === 0 || i === closes.length - 1) {
        const floating = entries.reduce((s, e) => s + (e.qty * price - e.cost), 0);
        const eq = budgetQuote + profit + floating;
        equity.push({ t: times[i], v: r2(eq) });
        trackDd(eq);
      }
    });
  }

  const profitPct = (profit / budgetQuote) * 100;
  return {
    winRate: total > 0 ? Math.round((wins / total) * 1000) / 10 : 0,
    profitPct: r2(profitPct),
    trades: total,
    maxDrawdownPct: r2(maxDd),
    equity
  };
}

export interface KlinesSource {
  klines: Kline[];
  source: 'exchange' | 'local';
  interval: string;
}

/**
 * Satu percobaan interval: exchange dulu, fallback riwayat lokal.
 * Tidak pernah throw saat timeout/jaringan — mengembalikan null agar
 * rantai bisa lanjut ke interval berikutnya. Throw hanya untuk error
 * pemrograman (bukan jaringan).
 */
async function tryInterval(
  exchangeId: string, pair: string, interval: string, limit: number, ms = 20000
): Promise<KlinesSource | null> {
  const client = registry.get(exchangeId);
  try {
    const kl = await klinesWithTimeout(client, pair, interval, limit, ms);
    if (kl.length >= 30) return { klines: kl, source: 'exchange', interval };
  } catch { /* jaringan/timeout/data exchange kurang — lanjut ke lokal */ }
  try {
    const { getLocalKlines } = await import('./history.js');
    const local = getLocalKlines(exchangeId, pair, interval, limit);
    if (local.length >= 30) return { klines: local, source: 'local', interval };
  } catch { /* abaikan */ }
  return null;
}

/** Detail cakupan riwayat lokal untuk pesan error yang informatif */
async function coverageDetail(exchangeId: string, pair: string): Promise<string> {
  try {
    const { localCoverage } = await import('./history.js');
    const cov = localCoverage(exchangeId, pair);
    return cov.points > 0
      ? `Riwayat lokal baru ${cov.points} titik sejak ${cov.since} — biarkan server berjalan agar terkumpul.`
      : `Riwayat lokal belum ada — biarkan server berjalan agar harga tercatat tiap menit.`;
  } catch {
    return '';
  }
}

/**
 * Ambil candle secara cerdas: exchange dulu, fallback ke riwayat lokal.
 * Mengembalikan sumber data agar UI bisa memberi catatan jujur.
 */
export async function fetchKlinesSmart(
  exchangeId: string, pair: string, interval: string, limit: number, ms = 30000
): Promise<{ klines: Kline[]; source: 'exchange' | 'local' | 'none' }> {
  const r = await tryInterval(exchangeId, pair, interval, limit, ms);
  if (r) return { klines: r.klines, source: r.source };
  throw new MarketDataError(`Data candle kurang untuk rentang ini. ${await coverageDetail(exchangeId, pair)}`);
}

/**
 * Rantai fallback adaptif: coba tiap spesifikasi interval berurutan,
 * pakai yang pertama menghasilkan ≥30 candle. Contoh:
 * harian → 12 jam → 4 jam → per jam.
 */
export async function fetchKlinesChain(
  exchangeId: string, pair: string, specs: { interval: string; limit: number }[], ms = 20000
): Promise<KlinesSource> {
  for (const s of specs) {
    const r = await tryInterval(exchangeId, pair, s.interval, s.limit, ms);
    if (r) return r;
  }
  throw new MarketDataError(`Data candle kurang untuk rentang ini. ${await coverageDetail(exchangeId, pair)}`);
}

/** Label sumber data untuk catatan jujur di UI */
export function sourceNote(source: 'exchange' | 'local', interval: string, candles: number): string {
  if (source === 'exchange') return `Sumber: exchange · ${interval} · ${candles} candle`;
  return `Sumber: riwayat lokal · ${interval} · ${candles} candle`;
}

/** Backtest kustom: strategi + parameter + rentang hari pilihan user */
export async function runCustomBacktest(
  exchangeId: string, pair: string, strategy: string, params: Record<string, any>,
  days: number, budgetQuote: number
): Promise<BacktestResult & { candles: number; note?: string }> {
  // Rebalance butuh multi-aset: tampilkan buy-and-hold pembanding untuk pair ini
  if (strategy === 'rebalance') {
    const r = await fetchKlinesChain(exchangeId, pair, [
      { interval: '1d', limit: Math.min(Math.max(days, 7), 365) },
      { interval: '12h', limit: 200 },
      { interval: '4h', limit: 300 },
      { interval: '1h', limit: 400 }
    ]);
    const closes = r.klines.map(k => k[4]);
    if (closes.length < 2) return { winRate: 0, profitPct: 0, trades: 0, maxDrawdownPct: 0, equity: [], candles: closes.length, note: 'Data kurang' };
    const first = closes[0];
    const equity = r.klines.map(k => ({ t: k[0], v: Math.round((budgetQuote * (k[4] / first)) * 100) / 100 }));
    const profitPct = ((closes[closes.length - 1] - first) / first) * 100;
    return {
      winRate: 0, profitPct: Math.round(profitPct * 100) / 100, trades: 0,
      maxDrawdownPct: 0, equity, candles: closes.length,
      note: `Buy-and-hold pembanding (rebalance butuh data multi-aset) · ${sourceNote(r.source, r.interval, closes.length)}`
    };
  }
  const specs = strategy === 'scalper'
    ? [{ interval: '1m', limit: Math.min(Math.max(days, 1) * 500, 1000) }]
    : [
        { interval: '1h', limit: Math.min(Math.max(days, 1) * 24, 1000) },
        { interval: '15m', limit: 600 },
        { interval: '5m', limit: 800 },
        { interval: '1m', limit: 1000 }
      ];
  const r = await fetchKlinesChain(exchangeId, pair, specs);
  const pseudo: PresetDef = {
    id: 'custom', nama: 'Kustom', strategi: strategy, gaya: '', deskripsi: '',
    params, leverage_label: '', tp_sl_label: '', timeframe: r.interval
  };
  const out = backtest(pseudo, r.klines, budgetQuote);
  return {
    ...out,
    candles: r.klines.length,
    note: sourceNote(r.source, r.interval, r.klines.length)
  };
}

export interface PresetRecommendation extends PresetDef {
  skor: number;
  backtest: BacktestResult;
  /** Kondisi grafik pair saat dianalisis (sama untuk semua preset) */
  market: MarketRegime & { interval: string; candles: number };
}

const recCache = new Map<string, { data: PresetRecommendation[]; ts: number }>();

export class MarketDataError extends Error {
  constructor(message: string) { super(message); this.name = 'MarketDataError'; }
}

/** Batasi waktu fetch candle agar analisis gagal cepat dengan pesan jelas (bukan hang) */
async function klinesWithTimeout(client: any, pair: string, interval: string, limit: number, ms = 25000): Promise<Kline[]> {
  return Promise.race([
    client.getKlines(pair, interval, limit),
    new Promise<Kline[]>((_, reject) =>
      setTimeout(() => reject(new MarketDataError(
        `Data pasar ${pair} tidak tersedia (timeout). Untuk Binance/Tokocrypto, isi proxy bila koneksi diblokir.`
      )), ms))
  ]);
}

/** Analisis + skor preset untuk satu pasangan (cache 15 menit) */
export async function recommend(exchangeId: string, pair: string, budgetQuote = 100000): Promise<PresetRecommendation[]> {
  const key = `${exchangeId}:${pair}`;
  const c = recCache.get(key);
  if (c && Date.now() - c.ts < 15 * 60 * 1000) return c.data;

  // Candle untuk metrik + backtest (butuh ≥30 candle) + 1m untuk scalper.
  // Adaptif: harian → 12 jam → 4 jam → per jam → 1 menit (tetap jujur via note).
  let daily: Kline[] = [];
  let dailySource: 'exchange' | 'local' = 'exchange';
  let dailyInterval = '1d';
  let micro: Kline[] = [];
  let dailyError: any = null;
  try {
    const r = await fetchKlinesChain(exchangeId, pair, [
      { interval: '1d', limit: 120 },
      { interval: '12h', limit: 180 },
      { interval: '4h', limit: 250 },
      { interval: '1h', limit: 400 }
    ]);
    daily = r.klines; dailySource = r.source; dailyInterval = r.interval;
  } catch (e: any) {
    dailyError = e;
  }
  try { micro = (await fetchKlinesSmart(exchangeId, pair, '1m', 500)).klines; } catch (e: any) {
    if (e instanceof MarketDataError && daily.length === 0) throw e;
  }
  if (daily.length === 0 && micro.length >= 30) {
    // Instansi baru (riwayat lokal minim): pakai data 1m agar analisis tetap jalan
    daily = micro; dailySource = 'exchange'; dailyInterval = '1m';
  } else if (micro.length < 30) {
    micro = daily;
  }
  if (daily.length === 0) {
    if (dailyError instanceof MarketDataError) throw dailyError;
    throw new MarketDataError(`Data candle kurang untuk rentang ini. ${await coverageDetail(exchangeId, pair)}`);
  }

  const metrics = computeMetrics(daily);
  const regime = detectMarketRegime(daily);
  const market = { ...regime, interval: dailyInterval, candles: daily.length };
  const out: PresetRecommendation[] = PRESETS.map(preset => {
    const kl = preset.strategi === 'scalper' ? micro : daily;
    const bt = backtest(preset, kl, budgetQuote);
    // Tak ada sinyal di data ini = strategi tak cocok koinnya → tekan skor
    const noSignal = bt.trades === 0;
    return {
      ...preset,
      skor: scorePreset(preset, metrics, regime) - (noSignal ? 15 : 0),
      backtest: {
        ...bt,
        note: noSignal
          ? `Tak ada sinyal di data ${dailyInterval} ini — kurang cocok untuk ${pair}`
          : preset.strategi === 'scalper' || dailyInterval === '1d'
            ? undefined
            : `Dihitung dari data ${dailyInterval} (${sourceNote(dailySource, dailyInterval, kl.length)})`
      },
      market
    };
  }).sort((a, b) => b.skor - a.skor);

  recCache.set(key, { data: out, ts: Date.now() });
  return out;
}
