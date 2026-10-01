import crypto from 'node:crypto';
import { config } from '../config.js';
import { createHttp } from './http.js';
import { ExchangeClient, Ticker, Balance, OrderResult, Kline, ExchangeError, parsePair } from './base.js';

/**
 * Client Indodax.
 * Public: GET /api/{pair}/ticker dsb (pair lowercase tanpa pemisah: 'btcidr')
 * Private: POST /tapi — header Key + Sign=HMAC_SHA512(body, secret)
 */
export class IndodaxClient implements ExchangeClient {
  readonly id = 'indodax';
  readonly quoteAsset = 'IDR';
  readonly feeRate = 0.003;
  private apiKey = '';
  private apiSecret = '';
  private proxyUrl: string | null = null;
  private http = createHttp(config.indodaxBaseUrl);

  setProxy(url?: string | null) {
    this.proxyUrl = url || null;
    this.http = createHttp(config.indodaxBaseUrl, this.proxyUrl);
  }
  setCredentials(key: string, secret: string) { this.apiKey = key; this.apiSecret = secret; }
  hasCredentials() { return !!(this.apiKey && this.apiSecret); }

  /** Format pair per endpoint: ticker → 'xrp_idr'; trades/depth → 'xrpidr' */
  private static pairUnderscore(pair: string): string {
    const p = pair.toLowerCase();
    if (p.includes('_')) return p;
    return p.replace(/idr$/, '_idr').replace(/usdt$/, '_usdt');
  }
  private static pairFlat(pair: string): string {
    return pair.toLowerCase().replace(/_/g, '');
  }

  async testConnection() {
    const t0 = Date.now();
    try {
      await this.http.get('/api/server_time');
      return { ok: true, latency_ms: Date.now() - t0 };
    } catch (e: any) {
      return { ok: false, latency_ms: Date.now() - t0, error: e.message };
    }
  }

  async getTicker(pair: string): Promise<Ticker> {
    const { data } = await this.http.get(`/api/${IndodaxClient.pairUnderscore(pair)}/ticker`);
    const t = data.ticker;
    return {
      pair: pair.toUpperCase(),
      bid: parseFloat(t.buy), ask: parseFloat(t.sell), last: parseFloat(t.last),
      high24: parseFloat(t.high), low24: parseFloat(t.low),
      vol24: parseFloat(t.vol_idr || '0'), ts: (t.server_time || Date.now() / 1000) * 1000
    };
  }

  /**
   * Klines Indodax: tidak ada endpoint OHLC resmi.
   * Agregasi endpoint /trades (pair flat, ~500 trade terakhir) → bucket per interval.
   * Cukup untuk scalper/backtest jangka pendek; untuk horizon panjang gunakan
   * cache ticker yang dikumpulkan engine.
   */
  async getKlines(pair: string, interval: string, limit: number): Promise<Kline[]> {
    const stepMs = interval === '1m' ? 60000 : interval === '5m' ? 300000 : interval === '1h' ? 3600000 : 86400000;
    try {
      const { data } = await this.http.get(`/api/trades/${IndodaxClient.pairFlat(pair)}`);
      const trades: any[] = Array.isArray(data) ? data : [];
      const buckets = new Map<number, { o: number; h: number; l: number; c: number; v: number }>();
      for (const tr of trades) {
        const ts = Number(tr.date) * 1000;
        const bucket = Math.floor(ts / stepMs) * stepMs;
        const price = parseFloat(tr.price);
        const amount = parseFloat(tr.amount);
        const b = buckets.get(bucket);
        if (!b) buckets.set(bucket, { o: price, h: price, l: price, c: price, v: amount });
        else { b.h = Math.max(b.h, price); b.l = Math.min(b.l, price); b.c = price; b.v += amount; }
      }
      const out = [...buckets.entries()].sort((a, b) => a[0] - b[0])
        .map(([t, b]) => [t, b.o, b.h, b.l, b.c, b.v] as Kline);
      if (out.length >= 3) return out.slice(-limit);
    } catch { /* lanjut fallback */ }
    // Fallback: candle degenerate dari ticker
    const t = await this.getTicker(pair);
    const now = Date.now();
    return Array.from({ length: 3 }, (_, i) =>
      [now - (3 - i) * stepMs, t.last, t.last, t.last, t.last, 0] as Kline);
  }

  /** POST /tapi dengan signature */
  private async tapi(method: string, params: Record<string, string | number> = {}): Promise<any> {
    if (!this.hasCredentials()) throw new ExchangeError('Kredensial Indodax belum diisi');
    const body = new URLSearchParams({ method, timestamp: Date.now().toString(), ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) }).toString();
    const sign = crypto.createHmac('sha512', this.apiSecret).update(body).digest('hex');
    try {
      const { data } = await this.http.post('/tapi', body, {
        headers: { Key: this.apiKey, Sign: sign, 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      if (data.success !== 1) throw new ExchangeError(data.error || `Indodax ${method} gagal`, data.error_code);
      return data.return;
    } catch (e: any) {
      if (e instanceof ExchangeError) throw e;
      throw new ExchangeError(e.response?.data?.error || e.message);
    }
  }

  async getBalances(): Promise<Balance[]> {
    const ret = await this.tapi('getInfo');
    const out: Balance[] = [];
    const balance = ret.balance || {};
    const hold = ret.balance_hold || {};
    for (const [asset, free] of Object.entries(balance)) {
      out.push({ asset: asset.toUpperCase(), free: parseFloat(free as string) || 0, locked: parseFloat(hold[asset] as string) || 0 });
    }
    return out.filter(b => b.free > 0 || b.locked > 0);
  }

  async getOpenOrders(pair?: string): Promise<any[]> {
    const ret = await this.tapi('openOrders', pair ? { pair: IndodaxClient.pairUnderscore(pair) } : {});
    return ret?.orders || [];
  }

  async buyMarket(pair: string, amountQuote: number): Promise<OrderResult> {
    const p = IndodaxClient.pairUnderscore(pair);
    const ret = await this.tapi('trade', { pair: p, type: 'buy', price: 0, idr: Math.floor(amountQuote) });
    const ticker = await this.getTicker(pair);
    const qty = amountQuote / ticker.ask;
    return { order_id: String(ret.order_id), price: ticker.ask, qty, fee: amountQuote * this.feeRate, side: 'buy', status: 'filled' };
  }

  async sellMarket(pair: string, qtyBase: number): Promise<OrderResult> {
    const { base } = parsePair(pair, this.quoteAsset);
    const p = IndodaxClient.pairUnderscore(pair);
    const ret = await this.tapi('trade', { pair: p, type: 'sell', price: 0, [base.toLowerCase()]: qtyBase });
    const ticker = await this.getTicker(pair);
    return { order_id: String(ret.order_id), price: ticker.bid, qty: qtyBase, fee: qtyBase * ticker.bid * this.feeRate, side: 'sell', status: 'filled' };
  }

  async getUsdtIdrRate(): Promise<number> {
    try {
      const t = await this.getTicker('usdtidr');
      return t.last;
    } catch {
      return 16000; // fallback
    }
  }
}
