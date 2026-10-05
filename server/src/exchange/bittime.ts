import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { createHttp } from './http.js';
import { ExchangeClient, Ticker, Balance, OrderResult, Kline, ExchangeError, assertTicker, validKline } from './base.js';

/**
 * Client Bittime spot — https://openapi.bittime.com (dok: bittime-docs.github.io).
 * Protokol mirip Binance v1 (/api/v1/*, X-MBX-APIKEY, HMAC-SHA256) dengan perbedaan:
 * - ticker/24hr SELALU array (walau 1 simbol)
 * - TIDAK ADA endpoint klines -> agregasi /api/v1/trades seperti Indodax
 * - MARKET order wajib `quantity` (tak ada quoteOrderQty) -> nominal dihitung dari ticker
 * - LOT_SIZE memakai minVal (min notional), bukan filter MIN_NOTIONAL terpisah
 * - myTrades di /api/v2; rekonsiliasi fill via GET /api/v1/order (executedQty)
 * - getOpenOrders WAJIB symbol -> tanpa pair, iterasi default_pairs bittime
 */
function normalizeError(e: any): ExchangeError {
  const code = e.response?.data?.code;
  const msg = e.response?.data?.msg || e.message;
  if (code === -1022) {
    return new ExchangeError(`Bittime: kredensial/signature salah atau IP belum di-whitelist. ${msg}`, code);
  }
  return new ExchangeError(`Bittime: ${msg}${code !== undefined ? ` (${code})` : ''}`, code);
}

export class BittimeClient implements ExchangeClient {
  readonly id = 'bittime';
  readonly quoteAsset = 'IDR';
  feeRate = 0.001; // default; diadopsi dari takerCommission akun bila tersedia
  protected label = 'Bittime';
  private apiKey = '';
  private apiSecret = '';
  private http = createHttp(config.bittimeBaseUrl);

  setProxy(url?: string | null) {
    this.http = createHttp(config.bittimeBaseUrl, url || undefined);
  }
  setCredentials(key: string, secret: string) { this.apiKey = key; this.apiSecret = secret; }
  hasCredentials() { return !!(this.apiKey && this.apiSecret); }

  async testConnection() {
    const t0 = Date.now();
    try {
      await this.http.get('/api/v1/ping');
      return { ok: true, latency_ms: Date.now() - t0 };
    } catch (e: any) {
      return { ok: false, latency_ms: Date.now() - t0, error: e.message };
    }
  }

  private static symbol(pair: string): string {
    return pair.toUpperCase().replace(/[_-]/g, '');
  }

  async getTicker(pair: string): Promise<Ticker> {
    const symbol = BittimeClient.symbol(pair);
    try {
      const [{ data: t24raw }, { data: book }] = await Promise.all([
        this.http.get('/api/v1/ticker/24hr', { params: { symbol } }),
        this.http.get('/api/v1/ticker/bookTicker', { params: { symbol } })
      ]);
      // Bittime selalu mengembalikan ARRAY walau 1 simbol
      const t24 = Array.isArray(t24raw)
        ? (t24raw.find((t: any) => String(t.symbol).toUpperCase() === symbol) ?? t24raw[0])
        : t24raw;
      if (!t24) throw new ExchangeError(`Bittime: simbol ${symbol} tidak ditemukan`, -1121);
      const last = parseFloat(t24.lastPrice);
      if (!Number.isFinite(last)) throw new ExchangeError(`Bittime: respons ticker tidak valid`, t24?.code);
      return assertTicker({
        pair: symbol,
        bid: parseFloat(book.bidPrice), ask: parseFloat(book.askPrice), last,
        high24: parseFloat(t24.highPrice ?? t24.high24h ?? '0'),
        low24: parseFloat(t24.lowPrice ?? t24.low24h ?? '0'),
        vol24: parseFloat(t24.quoteVolume || '0'), ts: Date.now()
      }, this.label);
    } catch (e: any) {
      if (e instanceof ExchangeError) throw e;
      throw normalizeError(e);
    }
  }

  /** Klines via agregasi recent trades (maks 1000 trade terakhir) */
  async getKlines(pair: string, interval: string, limit: number): Promise<Kline[]> {
    const stepMs = intervalMs(interval);
    try {
      const { data } = await this.http.get('/api/v1/trades', {
        params: { symbol: BittimeClient.symbol(pair), limit: 1000 }
      });
      const trades: any[] = Array.isArray(data) ? data : [];
      const buckets = new Map<number, { o: number; h: number; l: number; c: number; v: number }>();
      for (const tr of trades) {
        const ts = Number(tr.time || tr.T || 0);
        if (!ts) continue;
        const bucket = Math.floor(ts / stepMs) * stepMs;
        const price = parseFloat(tr.price);
        const amount = parseFloat(tr.qty || tr.q || '0');
        if (!Number.isFinite(price)) continue;
        const b = buckets.get(bucket);
        if (!b) buckets.set(bucket, { o: price, h: price, l: price, c: price, v: amount });
        else { b.h = Math.max(b.h, price); b.l = Math.min(b.l, price); b.c = price; b.v += amount; }
      }
      const out = [...buckets.entries()].sort((a, b) => a[0] - b[0])
        .map(([t, b]) => [t, b.o, b.h, b.l, b.c, b.v] as Kline)
        .filter(validKline);
      if (out.length >= 3) return out.slice(-limit);
    } catch { /* lanjut fallback */ }
    const t = await this.getTicker(pair);
    const now = Date.now();
    return Array.from({ length: 3 }, (_, i) =>
      [now - (3 - i) * stepMs, t.last, t.last, t.last, t.last, 0] as Kline);
  }

  private sign(query: string): string {
    return crypto.createHmac('sha256', this.apiSecret).update(query).digest('hex');
  }

  private async signed(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, string | number> = {}): Promise<any> {
    if (!this.hasCredentials()) throw new ExchangeError('Kredensial Bittime belum diisi');
    const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), timestamp: Date.now().toString() }).toString();
    const signature = this.sign(query);
    try {
      const { data } = await this.http.request({
        method, url: `${path}?${query}&signature=${signature}`,
        headers: { 'X-MBX-APIKEY': this.apiKey }
      });
      if (data && typeof data.code === 'number' && data.code !== 200 && data.code > 0) {
        throw new ExchangeError(`Bittime: ${data.msg || 'error'}`, data.code);
      }
      return data;
    } catch (e: any) {
      if (e instanceof ExchangeError) throw e;
      throw normalizeError(e);
    }
  }

  async getBalances(): Promise<Balance[]> {
    const data = await this.signed('GET', '/api/v1/account');
    // Adopsi fee aktual akun (basis points -> desimal)
    if (data.takerCommission != null) {
      const r = Number(data.takerCommission) / 10000;
      if (Number.isFinite(r) && r > 0 && r < 0.05) this.feeRate = r;
    }
    return ((data.balances || []) as any[])
      .map(b => ({ asset: String(b.asset).toUpperCase(), free: parseFloat(b.free), locked: parseFloat(b.locked) }))
      .filter(b => b.free > 0 || b.locked > 0);
  }

  private bittimePairs(): string[] {
    try {
      const rows = db.prepare(`SELECT symbol FROM default_pairs WHERE exchange_id='bittime' ORDER BY sort`).all() as any[];
      if (rows.length > 0) return rows.map(r => r.symbol);
    } catch { /* abaikan */ }
    return ['BTCIDR', 'ETHIDR', 'XRPIDR'];
  }

  async getOpenOrders(pair?: string): Promise<any[]> {
    if (pair) return this.signed('GET', '/api/v1/openOrders', { symbol: BittimeClient.symbol(pair) });
    const out: any[] = [];
    for (const s of this.bittimePairs()) {
      try {
        const arr = await this.signed('GET', '/api/v1/openOrders', { symbol: s });
        if (Array.isArray(arr)) out.push(...arr);
      } catch { /* lewati pair gagal */ }
    }
    return out;
  }

  async cancelOpenOrders(pair?: string): Promise<number> {
    const orders = await this.getOpenOrders(pair);
    let cancelled = 0;
    for (const o of orders) {
      try {
        await this.signed('DELETE', '/api/v1/order', { symbol: o.symbol, orderId: o.orderId });
        cancelled++;
      } catch { /* lanjut */ }
    }
    return cancelled;
  }

  private symbolFilters = new Map<string, { stepSize: number; minQty: number; minNotional: number; ts: number }>();
  private async getFilters(symbol: string) {
    const c = this.symbolFilters.get(symbol);
    if (c && Date.now() - c.ts < 600000) return c;
    try {
      const { data } = await this.http.get('/api/v1/exchangeInfo', { params: { symbol } });
      const s = (data.symbols || [])[0] || data;
      const lot = (s?.filters || []).find((f: any) => f.filterType === 'LOT_SIZE');
      const f = {
        stepSize: parseFloat(lot?.stepSize || '0.00000001'),
        minQty: parseFloat(lot?.minQty || '0'),
        minNotional: parseFloat(lot?.minVal || '1'),
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
    const v = Math.floor(qty / step) * step;
    return v === 0 ? 0 : parseFloat(v.toFixed(precision));
  }

  /** Ambil fill aktual via query order (executedQty + cummulativeQuoteQty) */
  private async reconcile(symbol: string, orderId: string | number, fallbackPrice: number, fallbackQty: number): Promise<{ price: number; qty: number }> {
    try {
      await new Promise(r => setTimeout(r, 700));
      const o = await this.signed('GET', '/api/v1/order', { symbol, orderId });
      const qty = parseFloat(o.executedQty || '0');
      const value = parseFloat(o.cummulativeQuoteQty || '0');
      if (qty > 0 && value > 0) return { price: value / qty, qty };
    } catch { /* pakai fallback */ }
    return { price: fallbackPrice, qty: fallbackQty };
  }

  async buyMarket(pair: string, amountQuote: number, clientOrderId?: string): Promise<OrderResult> {
    const symbol = BittimeClient.symbol(pair);
    const ticker = await this.getTicker(pair);
    const filters = await this.getFilters(symbol);
    if (amountQuote < filters.minNotional) {
      throw new ExchangeError(`Nominal ${amountQuote} di bawah min notional ${filters.minNotional} (${symbol})`);
    }
    const qty = this.roundDown(amountQuote / ticker.ask, filters.stepSize);
    if (qty <= 0) throw new ExchangeError(`Qty hasil hitung 0 untuk nominal ${amountQuote} (${symbol})`);
    const data = await this.signed('POST', '/api/v1/order', {
      symbol, side: 'BUY', type: 'MARKET', quantity: String(qty),
      ...(clientOrderId ? { newClientOrderId: clientOrderId.slice(0, 36) } : {})
    });
    const fill = await this.reconcile(symbol, data.orderId, ticker.ask, qty);
    const fee = fill.qty * fill.price * this.feeRate;
    return { order_id: String(data.orderId), price: fill.price, qty: fill.qty, fee, side: 'buy', status: 'filled' };
  }

  async sellMarket(pair: string, qtyBase: number, clientOrderId?: string): Promise<OrderResult> {
    const symbol = BittimeClient.symbol(pair);
    const filters = await this.getFilters(symbol);
    const qty = this.roundDown(qtyBase, filters.stepSize);
    if (qty <= 0 || qty < filters.minQty) {
      throw new ExchangeError(`Qty ${qtyBase} di bawah minimum ${filters.minQty} (${symbol})`);
    }
    const ticker = await this.getTicker(pair);
    const data = await this.signed('POST', '/api/v1/order', {
      symbol, side: 'SELL', type: 'MARKET', quantity: String(qty),
      ...(clientOrderId ? { newClientOrderId: clientOrderId } : {})
    });
    const fill = await this.reconcile(symbol, data.orderId, ticker.bid, qty);
    const fee = fill.qty * fill.price * this.feeRate;
    return { order_id: String(data.orderId), price: fill.price, qty: fill.qty, fee, side: 'sell', status: data.status || 'filled' };
  }

  async getUsdtIdrRate(): Promise<number> {
    try {
      const t = await this.getTicker('usdtidr');
      return t.last;
    } catch {
      return 16000;
    }
  }
}

function intervalMs(interval: string): number {
  const m = /^(\d+)([mhd])$/.exec(interval);
  if (!m) return 3600000;
  const n = Number(m[1]);
  if (m[2] === 'm') return n * 60000;
  if (m[2] === 'h') return n * 3600000;
  return n * 86400000;
}
