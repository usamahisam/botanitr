import crypto from 'node:crypto';
import { config } from '../config.js';
import { createHttp } from './http.js';
import { ExchangeClient, Ticker, Balance, OrderResult, Kline, ExchangeError, assertTicker, validKline } from './base.js';

/** Error 3701 = IP diblokir/geo-restrict. Pesan jelas agar user tahu harus pakai proxy. */
export function normalizeError(e: any, label = 'Tokocrypto'): ExchangeError {
  const code = e.response?.data?.code;
  if (code === 3701 || code === -2015) {
    return new ExchangeError(`${label} memblokir IP ini (geo-restrict). Isi proxy di Pengaturan → Exchange.`, code);
  }
  return new ExchangeError(`${label}: ${e.response?.data?.msg || e.message}`, code);
}

/**
 * Client Tokocrypto — kompatibel Binance REST v3 (HMAC-SHA256).
 * Base URL configurable karena api.tokocrypto.com sering timeout dari jaringan ID.
 */
export class TokocryptoClient implements ExchangeClient {
  readonly id: string = 'tokocrypto';
  readonly quoteAsset = 'USDT';
  readonly feeRate = 0.001;
  protected label = 'Tokocrypto';
  protected baseUrl(): string { return config.tokocryptoBaseUrl; }
  /** Host khusus data publik (ticker/klines). Default = host trading. */
  protected publicBaseUrl(): string { return this.baseUrl(); }
  private apiKey = '';
  private apiSecret = '';
  private proxyUrl: string | null = null;
  private http = createHttp(this.baseUrl());
  private pubHttp = createHttp(this.publicBaseUrl());

  setProxy(url?: string | null) {
    this.proxyUrl = url || null;
    this.http = createHttp(this.baseUrl(), this.proxyUrl);
    this.pubHttp = createHttp(this.publicBaseUrl(), this.proxyUrl);
  }
  setCredentials(key: string, secret: string) { this.apiKey = key; this.apiSecret = secret; }
  hasCredentials() { return !!(this.apiKey && this.apiSecret); }

  async testConnection() {
    const t0 = Date.now();
    try {
      await this.pubHttp.get('/api/v3/ping');
      return { ok: true, latency_ms: Date.now() - t0 };
    } catch (e: any) {
      return { ok: false, latency_ms: Date.now() - t0, error: e.message };
    }
  }

  async getTicker(pair: string): Promise<Ticker> {
    const symbol = pair.toUpperCase();
    try {
      const [{ data: t24 }, { data: book }] = await Promise.all([
        this.pubHttp.get('/api/v3/ticker/24hr', { params: { symbol } }),
        this.pubHttp.get('/api/v3/ticker/bookTicker', { params: { symbol } })
      ]);
      const last = parseFloat(t24.lastPrice);
      if (!Number.isFinite(last)) throw new ExchangeError(`${this.label}: respons ticker tidak valid`, t24?.code);
      return assertTicker({
        pair: symbol,
        bid: parseFloat(book.bidPrice), ask: parseFloat(book.askPrice), last,
        high24: parseFloat(t24.highPrice), low24: parseFloat(t24.lowPrice),
        vol24: parseFloat(t24.quoteVolume || '0'), ts: Date.now()
      }, this.label);
    } catch (e: any) { throw normalizeError(e, this.label); }
  }

  async getKlines(pair: string, interval: string, limit: number): Promise<Kline[]> {
    try {
      const { data } = await this.pubHttp.get('/api/v3/klines', {
        params: { symbol: pair.toUpperCase(), interval, limit: Math.min(limit, 1000) }
      });
      if (!Array.isArray(data)) throw new ExchangeError(`${this.label}: respons klines tidak valid`, data?.code);
      return (data.map((k: any[]) => [k[0], parseFloat(k[1]), parseFloat(k[2]), parseFloat(k[3]), parseFloat(k[4]), parseFloat(k[5])] as Kline)).filter(validKline);
    } catch (e: any) {
      if (e instanceof ExchangeError) throw e;
      throw normalizeError(e, this.label);
    }
  }

  private sign(query: string): string {
    return crypto.createHmac('sha256', this.apiSecret).update(query).digest('hex');
  }

  private async signed(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, string | number> = {}): Promise<any> {
    if (!this.hasCredentials()) throw new ExchangeError(`Kredensial ${this.label} belum diisi`);
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
      throw new ExchangeError(`${this.label}: ${msg}`, e.response?.data?.code);
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

  async cancelOpenOrders(pair?: string): Promise<number> {
    const symbol = pair?.toUpperCase();
    try {
      // Binance-style: DELETE /api/v3/openOrders membatalkan semua (untuk symbol atau semua)
      const data = await this.signed('DELETE', '/api/v3/openOrders', symbol ? { symbol } : {});
      return Array.isArray(data) ? data.length : (data ? 1 : 0);
    } catch (e: any) {
      // Fallback: cancel satu per satu
      const orders = await this.getOpenOrders(symbol);
      let cancelled = 0;
      for (const o of orders) {
        try {
          await this.signed('DELETE', '/api/v3/order', { symbol: o.symbol, orderId: o.orderId });
          cancelled++;
        } catch { /* lanjut */ }
      }
      return cancelled;
    }
  }

  /** Normalisasi qty sesuai stepSize dari exchangeInfo (cache 10 menit) */
  private symbolFilters = new Map<string, { stepSize: number; minQty: number; minNotional: number; ts: number }>();
  private async getFilters(symbol: string) {
    const c = this.symbolFilters.get(symbol);
    if (c && Date.now() - c.ts < 600000) return c;
    try {
      const { data } = await this.pubHttp.get('/api/v3/exchangeInfo', { params: { symbol } });
      const s = data.symbols?.[0];
      const lot = s?.filters?.find((f: any) => f.filterType === 'LOT_SIZE');
      const notional = s?.filters?.find((f: any) => f.filterType === 'MIN_NOTIONAL' || f.filterType === 'NOTIONAL');
      const f = {
        stepSize: parseFloat(lot?.stepSize || '0.00000001'),
        minQty: parseFloat(lot?.minQty || '0'),
        minNotional: parseFloat(notional?.minNotional || '1'),
        ts: Date.now()
      };
      this.symbolFilters.set(symbol, f);
      return f;
    } catch {
      return { stepSize: 0.00000001, minQty: 0, minNotional: 1, ts: Date.now() };
    }
  }
  private roundDown(qty: number, step: number): number {
    const precision = Math.max(0, Math.ceil(-Math.log10(step)));
    return Math.floor(qty / step) * step === 0 ? 0 : parseFloat((Math.floor(qty / step) * step).toFixed(precision));
  }

  async buyMarket(pair: string, amountQuote: number, clientOrderId?: string): Promise<OrderResult> {
    const data = await this.signed('POST', '/api/v3/order', {
      symbol: pair.toUpperCase(), side: 'BUY', type: 'MARKET', quoteOrderQty: amountQuote.toFixed(2),
      ...(clientOrderId ? { newClientOrderId: clientOrderId } : {})
    });
    const fills = data.fills || [];
    const qty = fills.reduce((s: number, f: any) => s + parseFloat(f.qty), 0) || parseFloat(data.executedQty || '0');
    const value = parseFloat(data.cummulativeQuoteQty || '0');
    const fee = fills.reduce((s: number, f: any) => s + parseFloat(f.commission || '0'), 0);
    return { order_id: String(data.orderId), price: qty > 0 ? value / qty : 0, qty, fee, side: 'buy', status: data.status };
  }

  async sellMarket(pair: string, qtyBase: number, clientOrderId?: string): Promise<OrderResult> {
    const symbol = pair.toUpperCase();
    const filters = await this.getFilters(symbol);
    const reqQty = this.roundDown(qtyBase, filters.stepSize);
    // Jangan bump ke minQty: melebihi saldo pasti ditolak exchange.
    // Di bawah minQty = debu tak terjual → error jelas (bukan fill misterius).
    if (reqQty <= 0) throw new ExchangeError(`Qty ${qtyBase} di bawah stepSize ${filters.stepSize} — debu tak bisa dijual`);
    if (reqQty < filters.minQty) throw new ExchangeError(`Qty ${reqQty} di bawah minimum order ${filters.minQty} (${symbol})`);
    const data = await this.signed('POST', '/api/v3/order', {
      symbol, side: 'SELL', type: 'MARKET', quantity: String(reqQty),
      ...(clientOrderId ? { newClientOrderId: clientOrderId } : {})
    });
    const fills = data.fills || [];
    const qty = fills.reduce((s: number, f: any) => s + parseFloat(f.qty), 0) || parseFloat(data.executedQty || '0');
    const value = parseFloat(data.cummulativeQuoteQty || '0');
    const fee = fills.reduce((s: number, f: any) => s + parseFloat(f.commission || '0'), 0);
    return { order_id: String(data.orderId), price: qty > 0 ? value / qty : 0, qty, fee, side: 'sell', status: data.status };
  }

  async getUsdtIdrRate(): Promise<number> { return 1; } // quote sudah USDT; kurs di-handle engine
}
