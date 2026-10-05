import crypto from 'node:crypto';
import { config } from '../config.js';
import { createHttp } from './http.js';
import { ExchangeClient, Ticker, Balance, OrderResult, Kline, ExchangeError, parsePair, assertTicker, validKline } from './base.js';
import { sleep } from '../utils/format.js';
import { IndodaxV2Client } from './indodax-v2.js';
import { log } from '../log.js';

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
  /** Client TAPI v2 (dipakai otomatis jika kredensial adalah key v2) */
  private v2 = new IndodaxV2Client();
  private useV2: boolean | null = null; // null = belum dideteksi
  /** Paksa versi API: 'auto' | 'v1' | 'v2' (dari Pengaturan) */
  private forceVersion: 'auto' | 'v1' | 'v2' = 'auto';

  setApiVersion(v: string) {
    const mode = v === 'v1' || v === 'v2' ? v : 'auto';
    if (mode !== this.forceVersion) {
      this.forceVersion = mode;
      this.useV2 = null; // reset deteksi saat pilihan berubah
    }
  }
  /** Versi yang sedang aktif: 'v1' | 'v2' | null (belum dipakai/dideteksi) */
  get activeVersion(): 'v1' | 'v2' | null {
    return this.useV2 === null ? null : (this.useV2 ? 'v2' : 'v1');
  }

  setProxy(url?: string | null) {
    this.proxyUrl = url || null;
    this.http = createHttp(config.indodaxBaseUrl, this.proxyUrl);
    this.v2.setProxy(url);
  }
  setCredentials(key: string, secret: string) {
    this.apiKey = key; this.apiSecret = secret;
    this.v2.setCredentials(key, secret);
    this.useV2 = null; // reset deteksi saat kredensial berubah
  }
  hasCredentials() { return !!(this.apiKey && this.apiSecret); }

  private detectPromise: Promise<boolean> | null = null;

  /** Deteksi versi API: true jika kredensial valid sebagai key TAPI v2.
   *  Promise di-cache agar probe konkuren (banyak bot satu tick) tak membanjiri API. */
  private async detectV2(): Promise<boolean> {
    if (this.useV2 !== null) return this.useV2;
    if (this.forceVersion === 'v1') { this.useV2 = false; return false; }
    if (!this.hasCredentials()) { this.useV2 = false; return false; }
    if (!this.detectPromise) {
      this.detectPromise = this.v2.probe().then(ok => {
        this.useV2 = ok;
        if (this.forceVersion === 'v2' && !ok) {
          throw new ExchangeError(
            'Mode paksa v2 tetapi kredensial bukan kunci TAPI v2 yang valid. ' +
            'Buat kunci khusus di indodax.com/trade_api, atau pilih Otomatis.'
          );
        }
        log('info', 'SYSTEM', `Indodax: menggunakan TAPI ${ok ? 'v2' : 'v1 (legacy)'} untuk akun ini`);
        return ok;
      }).finally(() => { this.detectPromise = null; });
    }
    return this.detectPromise;
  }

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
    return assertTicker({
      pair: pair.toUpperCase(),
      bid: parseFloat(t.buy), ask: parseFloat(t.sell), last: parseFloat(t.last),
      high24: parseFloat(t.high), low24: parseFloat(t.low),
      vol24: parseFloat(t.vol_idr || '0'), ts: (t.server_time || Date.now() / 1000) * 1000
    }, 'Indodax');
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
        .map(([t, b]) => [t, b.o, b.h, b.l, b.c, b.v] as Kline)
        .filter(validKline);
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
    if (await this.detectV2()) return this.v2.getBalances();
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
    if (await this.detectV2()) return this.v2.getOpenOrders(pair);
    const ret = await this.tapi('openOrders', pair ? { pair: IndodaxClient.pairUnderscore(pair) } : {});
    const orders = ret?.orders;
    if (Array.isArray(orders)) return orders;
    // Tanpa pair: { orders: { btc_idr: [...], ... } } → flatten
    if (orders && typeof orders === 'object') {
      return Object.entries(orders).flatMap(([p, arr]: [string, any]) =>
        (Array.isArray(arr) ? arr : []).map((o: any) => ({ ...o, pair: o.pair || p })));
    }
    return [];
  }

  async cancelOpenOrders(pair?: string): Promise<number> {
    if (await this.detectV2()) return this.v2.cancelOpenOrders(pair);
    const orders = await this.getOpenOrders(pair);
    let cancelled = 0;
    for (const o of orders) {
      try {
        await this.tapi('cancelOrder', {
          pair: IndodaxClient.pairUnderscore(o.pair || pair || 'btc_idr'),
          order_id: o.order_id, type: o.type, order_type: o.order_type || 'limit'
        });
        cancelled++;
      } catch { /* lanjut order berikutnya */ }
    }
    return cancelled;
  }

  /** Ambil order by client_order_id (untuk rekonsiliasi fill aktual) */
  private async getOrderByClientOrderId(clientOrderId: string): Promise<any | null> {
    try {
      const ret = await this.tapi('getOrderByClientOrderId', { client_order_id: clientOrderId });
      return ret?.order || null;
    } catch {
      return null;
    }
  }

  /** Ambil trades untuk satu order (harga & fee aktual) */
  private async getTradesForOrder(pair: string, orderId: string): Promise<any[]> {
    try {
      const ret = await this.tapi('tradeHistory', { pair: IndodaxClient.pairUnderscore(pair), order_id: orderId, count: 50 });
      return ret?.trades || [];
    } catch {
      return [];
    }
  }

  /** Rekonsiliasi fill aktual dari tradeHistory. Kunci qty = base asset lowercase (btc/xrp/dll). */
  private async reconcileFill(pair: string, clientOrderId: string, fallbackPrice: number, fallbackQty: number, fallbackFee: number) {
    const { base } = parsePair(pair, this.quoteAsset);
    const baseKey = base.toLowerCase();
    let price = fallbackPrice, qty = fallbackQty, fee = fallbackFee;
    await sleep(700);
    const order = await this.getOrderByClientOrderId(clientOrderId);
    if (order) {
      const trades = await this.getTradesForOrder(pair, String(order.order_id));
      if (trades.length > 0) {
        let q = 0, val = 0, f = 0;
        for (const t of trades) {
          const tq = parseFloat(t[baseKey] ?? '0');
          const tp = parseFloat(t.price);
          q += tq; val += tq * tp; f += parseFloat(t.fee || '0');
        }
        if (q > 0) { qty = q; price = val / q; fee = f > 0 ? f : val * this.feeRate; }
      }
    }
    return { price, qty, fee };
  }

  /**
   * BUY MARKET dengan nominal IDR.
   * Sesuai docs resmi: order_type=market TANPA price; hanya parameter idr.
   * Fill aktual direkonsiliasi via getOrderByClientOrderId + tradeHistory.
   */
  async buyMarket(pair: string, amountQuote: number, clientOrderId?: string): Promise<OrderResult> {
    if (await this.detectV2()) return this.v2.buyMarket(pair, amountQuote, clientOrderId);
    const p = IndodaxClient.pairUnderscore(pair);
    const idr = Math.floor(amountQuote);
    const ret = await this.tapi('trade', {
      pair: p, type: 'buy', order_type: 'market', idr,
      ...(clientOrderId ? { client_order_id: clientOrderId } : {})
    });

    // Rekonsiliasi fill aktual (order bisa under-filled)
    const ticker = await this.getTicker(pair);
    let price = ticker.ask;
    let qty = idr / ticker.ask;
    let fee = idr * this.feeRate;

    if (clientOrderId) {
      const r = await this.reconcileFill(pair, clientOrderId, price, qty, fee);
      price = r.price; qty = r.qty; fee = r.fee;
    }
    return { order_id: String(ret.order_id ?? ''), price, qty, fee, side: 'buy', status: 'filled' };
  }

  /** SELL MARKET dengan qty base coin */
  async sellMarket(pair: string, qtyBase: number, clientOrderId?: string): Promise<OrderResult> {
    if (await this.detectV2()) return this.v2.sellMarket(pair, qtyBase, clientOrderId);
    const { base } = parsePair(pair, this.quoteAsset);
    const p = IndodaxClient.pairUnderscore(pair);
    const reqQty = parseFloat(qtyBase.toFixed(8));
    const ret = await this.tapi('trade', {
      pair: p, type: 'sell', order_type: 'market', [base.toLowerCase()]: reqQty,
      ...(clientOrderId ? { client_order_id: clientOrderId } : {})
    });

    const ticker = await this.getTicker(pair);
    let price = ticker.bid;
    let qty = reqQty;
    let fee = qty * price * this.feeRate;

    if (clientOrderId) {
      const r = await this.reconcileFill(pair, clientOrderId, price, qty, fee);
      price = r.price; qty = r.qty; fee = r.fee;
    }
    return { order_id: String(ret.order_id ?? ''), price, qty, fee, side: 'sell', status: 'filled' };
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
