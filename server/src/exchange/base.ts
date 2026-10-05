export interface Ticker {
  pair: string; bid: number; ask: number; last: number;
  high24: number; low24: number; vol24: number; ts: number;
}
export interface Balance { asset: string; free: number; locked: number }
export interface OrderResult {
  order_id: string; price: number; qty: number; fee: number;
  side: 'buy' | 'sell'; status: string;
}
/** Kline: [openTime, open, high, low, close, volume] (number) */
export type Kline = [number, number, number, number, number, number];

export interface ExchangeClient {
  readonly id: string;
  readonly quoteAsset: string; // 'IDR' | 'USDT'
  readonly feeRate: number;
  setProxy(url?: string | null): void;
  setCredentials(key: string, secret: string): void;
  hasCredentials(): boolean;
  testConnection(): Promise<{ ok: boolean; latency_ms: number; error?: string }>;
  getTicker(pair: string): Promise<Ticker>;
  getBalances(): Promise<Balance[]>;
  getOpenOrders(pair?: string): Promise<any[]>;
  /** Batalkan semua open order (untuk kill switch). Mengembalikan jumlah yang dibatalkan. */
  cancelOpenOrders(pair?: string): Promise<number>;
  /** Beli MARKET dengan nominal quote. clientOrderId untuk idempotensi. */
  buyMarket(pair: string, amountQuote: number, clientOrderId?: string): Promise<OrderResult>;
  /** Jual MARKET dengan qty base. clientOrderId untuk idempotensi. */
  sellMarket(pair: string, qtyBase: number, clientOrderId?: string): Promise<OrderResult>;
  getKlines(pair: string, interval: string, limit: number): Promise<Kline[]>;
  /** USDT→IDR rate; 1 untuk exchange IDR */
  getUsdtIdrRate(): Promise<number>;
}

export class ExchangeError extends Error {
  constructor(message: string, public readonly code?: string | number) { super(message); this.name = 'ExchangeError'; }
}

/**
 * Validasi ticker mentah dari exchange. Harga korup (NaN/<=0) pernah terjadi
 * (halaman maintenance, respons terpotong) dan bila lolos akan meracuni
 * saldo paper (NaN), EMA scalper, dan PnL — semuanya diam-diam.
 */
export function assertTicker(t: Ticker, label: string): Ticker {
  const bad = !t || !Number.isFinite(t.last) || t.last <= 0 ||
    !Number.isFinite(t.bid) || t.bid <= 0 ||
    !Number.isFinite(t.ask) || t.ask <= 0;
  if (bad) throw new ExchangeError(`${label}: respons ticker tidak valid`);
  if (!Number.isFinite(t.high24)) t.high24 = t.last;
  if (!Number.isFinite(t.low24)) t.low24 = t.last;
  if (!Number.isFinite(t.vol24)) t.vol24 = 0;
  return t;
}

/** Validasi satu baris kline hasil agregasi; baris korup dibuang, bukan diracuni. */
export function validKline(k: any[]): k is Kline {
  if (!Array.isArray(k) || k.length < 6) return false;
  const [, o, h, l, c] = k;
  return [o, h, l, c].every(v => Number.isFinite(v) && (v as number) > 0) && Number.isFinite(k[0]);
}

export function parsePair(pair: string, quote: string): { base: string; quote: string } {
  const p = pair.toUpperCase();
  if (p.endsWith(quote)) return { base: p.slice(0, -quote.length), quote };
  return { base: p, quote };
}
