import crypto from 'node:crypto';
import { config } from '../config.js';
import { createHttp } from './http.js';
import { ExchangeClient, Ticker, Balance, OrderResult, Kline, ExchangeError } from './base.js';

/** Error 3701 = IP diblokir/geo-restrict. Pesan jelas agar user tahu harus pakai proxy. */
function normalizeError(e: any): ExchangeError {
  const code = e.response?.data?.code;
  if (code === 3701 || code === -2015) {
    return new ExchangeError('Tokocrypto memblokir IP ini (geo-restrict). Isi proxy di Pengaturan → Exchange.', code);
  }
  return new ExchangeError(`Tokocrypto: ${e.response?.data?.msg || e.message}`, code);
}

/**
 * Client Tokocrypto — kompatibel Binance REST v3 (HMAC-SHA256).
 * Base URL configurable karena api.tokocrypto.com sering timeout dari jaringan ID.
 */
export class TokocryptoClient implements ExchangeClient {
  readonly id = 'tokocrypto';
  readonly quoteAsset = 'USDT';
  readonly feeRate = 0.001;
  private apiKey = '';
  private apiSecret = '';
  private proxyUrl: string | null = null;
  private http = createHttp(config.tokocryptoBaseUrl);

  setProxy(url?: string | null) {
    this.proxyUrl = url || null;
    this.http = createHttp(config.tokocryptoBaseUrl, this.proxyUrl);
  }
  setCredentials(key: string, secret: string) { this.apiKey = key; this.apiSecret = secret; }
  hasCredentials() { return !!(this.apiKey && this.apiSecret); }

  async testConnection() {
    const t0 = Date.now();
    try {
      await this.http.get('/api/v3/ping');
      return { ok: true, latency_ms: Date.now() - t0 };
    } catch (e: any) {
      return { ok: false, latency_ms: Date.now() - t0, error: e.message };
    }
  }

  async getTicker(pair: string): Promise<Ticker> {
    const symbol = pair.toUpperCase();
    try {
      const [{ data: t24 }, { data: book }] = await Promise.all([
        this.http.get('/api/v3/ticker/24hr', { params: { symbol } }),
        this.http.get('/api/v3/ticker/bookTicker', { params: { symbol } })
      ]);
      const last = parseFloat(t24.lastPrice);
      if (!Number.isFinite(last)) throw new ExchangeError('Tokocrypto: respons ticker tidak valid', t24?.code);
      return {
        pair: symbol,
        bid: parseFloat(book.bidPrice), ask: parseFloat(book.askPrice), last,
        high24: parseFloat(t24.highPrice), low24: parseFloat(t24.lowPrice),
        vol24: parseFloat(t24.quoteVolume || '0'), ts: Date.now()
      };
    } catch (e: any) { throw normalizeError(e); }
  }

  async getKlines(pair: string, interval: string, limit: number): Promise<Kline[]> {
    try {
      const { data } = await this.http.get('/api/v3/klines', {
        params: { symbol: pair.toUpperCase(), interval, limit: Math.min(limit, 1000) }
      });
      if (!Array.isArray(data)) throw new ExchangeError(`Tokocrypto: respons klines tidak valid`, data?.code);
      return data.map((k: any[]) => [k[0], parseFloat(k[1]), parseFloat(k[2]), parseFloat(k[3]), parseFloat(k[4]), parseFloat(k[5])] as Kline);
    } catch (e: any) {
      if (e instanceof ExchangeError) throw e;
      throw normalizeError(e);
    }
  }

  private sign(query: string): string {
    return crypto.createHmac('sha256', this.apiSecret).update(query).digest('hex');
  }

  private async signed(method: 'GET' | 'POST', path: string, params: Record<string, string | number> = {}): Promise<any> {
    if (!this.hasCredentials()) throw new ExchangeError('Kredensial Tokocrypto belum diisi');
    const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), timestamp: Date.now().toString() }).toString();
    const signature = this.sign(query);
    try {
      const { data } = await this.http.request({
        method, url: `${path}?${query}&signature=${signature}`,
        headers: { 'X-MBX-APIKEY': this.apiKey }
      });
      return data;
    } catch (e: any) {
      const msg = e.response?.data?.msg || e.message;
      throw new ExchangeError(`Tokocrypto: ${msg}`, e.response?.data?.code);
    }
  }

  async getBalances(): Promise<Balance[]> {
    const data = await this.signed('GET', '/api/v3/account');
    return (data.balances as any[])
      .map(b => ({ asset: b.asset, free: parseFloat(b.free), locked: parseFloat(b.locked) }))
      .filter(b => b.free > 0 || b.locked > 0);
  }

  async getOpenOrders(pair?: string): Promise<any[]> {
    return this.signed('GET', '/api/v3/openOrders', pair ? { symbol: pair.toUpperCase() } : {});
  }

  async buyMarket(pair: string, amountQuote: number): Promise<OrderResult> {
    const data = await this.signed('POST', '/api/v3/order', {
      symbol: pair.toUpperCase(), side: 'BUY', type: 'MARKET', quoteOrderQty: amountQuote.toFixed(2)
    });
    const fills = data.fills || [];
    const qty = fills.reduce((s: number, f: any) => s + parseFloat(f.qty), 0) || parseFloat(data.executedQty || '0');
    const value = parseFloat(data.cummulativeQuoteQty || '0');
    const fee = fills.reduce((s: number, f: any) => s + parseFloat(f.commission || '0'), 0);
    return { order_id: String(data.orderId), price: qty > 0 ? value / qty : 0, qty, fee, side: 'buy', status: data.status };
  }

  async sellMarket(pair: string, qtyBase: number): Promise<OrderResult> {
    const data = await this.signed('POST', '/api/v3/order', {
      symbol: pair.toUpperCase(), side: 'SELL', type: 'MARKET', quantity: qtyBase.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
    });
    const fills = data.fills || [];
    const qty = fills.reduce((s: number, f: any) => s + parseFloat(f.qty), 0) || parseFloat(data.executedQty || '0');
    const value = parseFloat(data.cummulativeQuoteQty || '0');
    const fee = fills.reduce((s: number, f: any) => s + parseFloat(f.commission || '0'), 0);
    return { order_id: String(data.orderId), price: qty > 0 ? value / qty : 0, qty, fee, side: 'sell', status: data.status };
  }

  async getUsdtIdrRate(): Promise<number> { return 1; } // quote sudah USDT; kurs di-handle engine
}
