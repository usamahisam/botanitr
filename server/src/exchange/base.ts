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
  buyMarket(pair: string, amountQuote: number): Promise<OrderResult>;
  sellMarket(pair: string, qtyBase: number): Promise<OrderResult>;
  getKlines(pair: string, interval: string, limit: number): Promise<Kline[]>;
  /** USDT→IDR rate; 1 untuk exchange IDR */
  getUsdtIdrRate(): Promise<number>;
}

export class ExchangeError extends Error {
  constructor(message: string, public readonly code?: string | number) { super(message); this.name = 'ExchangeError'; }
}

export function parsePair(pair: string, quote: string): { base: string; quote: string } {
  const p = pair.toUpperCase();
  if (p.endsWith(quote)) return { base: p.slice(0, -quote.length), quote };
  return { base: p, quote };
}
