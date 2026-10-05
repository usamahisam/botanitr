import crypto from 'node:crypto';
import { config } from '../config.js';
import { createHttp } from './http.js';
import { Ticker, Balance, OrderResult, ExchangeError } from './base.js';

/**
 * Client Indodax TAPI v2 (Binance-style).
 * Base: https://api.indodax.com  —  X-APIKEY + HMAC-SHA256(queryString, secret)
 *
 * PENTING: TAPIv2 butuh API key KHUSUS (generate di indodax.com/trade_api, beda
 * dari key v1) dan IP whitelist wajib untuk permission trading.
 */
export class IndodaxV2Client {
  readonly id = 'indodax';
  readonly quoteAsset = 'IDR';
  readonly feeRate = 0.003;
  private apiKey = '';
  private apiSecret = '';
  private http = createHttp(config.indodaxV2BaseUrl);
  private apiHttp = createHttp(config.indodaxBaseUrl); // untuk ticker publik v1

  setProxy(url?: string | null) {
    this.http = createHttp(config.indodaxV2BaseUrl, url);
    this.apiHttp = createHttp(config.indodaxBaseUrl, url);
  }
  setCredentials(key: string, secret: string) { this.apiKey = key; this.apiSecret = secret; }
  hasCredentials() { return !!(this.apiKey && this.apiSecret); }

  private sign(query: string): string {
    return crypto.createHmac('sha256', this.apiSecret).update(query).digest('hex');
  }

  private async signed<T = any>(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, string | number> = {}): Promise<T> {
    if (!this.hasCredentials()) throw new ExchangeError('Kredensial Indodax v2 belum diisi');
    const query = new URLSearchParams({
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      timestamp: Date.now().toString()
    }).toString();
    const signature = this.sign(query);
    try {
      // POST: parameter HARUS di body (urlencoded) + signature di header Sign,
      // mengikuti contoh resmi Python. Backend Java Indodax tidak membaca
      // parameter POST dari query string (error -1102 bila dikirim di URL).
      if (method === 'POST') {
        const { data } = await this.http.post<T>(path, query, {
          headers: {
            'X-APIKEY': this.apiKey,
            'Sign': signature,
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });
        return data;
      }
      const { data } = await this.http.request<T>({
        method,
        url: `${path}?${query}&signature=${signature}`,
        headers: {
          'X-APIKEY': this.apiKey,
          'Accept': 'application/json'
        }
      });
      return data;
    } catch (e: any) {
      const code = e.response?.data?.code;
      const msg = e.response?.data?.msg || e.message;
      throw new ExchangeError(`Indodax v2: ${msg}`, code);
    }
  }

  /** Deteksi apakah kredensial ini key TAPIv2 yang valid */
  async probe(): Promise<boolean> {
    try {
      await this.signed('GET', '/api/v2/account', { omitZeroBalances: 'true' });
      return true;
    } catch {
      return false;
    }
  }

  async getBalances(): Promise<Balance[]> {
    const data = await this.signed('GET', '/api/v2/account', { omitZeroBalances: 'true' });
    return (data.balances as any[])
      .map(b => ({ asset: b.asset.toUpperCase(), free: parseFloat(b.free), locked: parseFloat(b.locked) }))
      .filter(b => b.free > 0 || b.locked > 0);
  }

  async getOpenOrders(symbol?: string): Promise<any[]> {
    return this.signed('GET', '/api/v2/openOrders', symbol ? { symbol: symbol.toUpperCase().replace(/_/, '') } : {});
  }

  async cancelOpenOrders(symbol?: string): Promise<number> {
    const orders = await this.getOpenOrders(symbol);
    let cancelled = 0;
    for (const o of orders) {
      try {
        await this.signed('DELETE', '/api/v2/order', { symbol: o.symbol, orderId: o.orderId });
        cancelled++;
      } catch { /* lanjut */ }
    }
    return cancelled;
  }

  private static symbol(pair: string): string {
    return pair.toUpperCase().replace(/_/, '');
  }

  async buyMarket(pair: string, amountQuote: number, clientOrderId?: string): Promise<OrderResult> {
    const data = await this.signed('POST', '/api/v2/order', {
      symbol: IndodaxV2Client.symbol(pair), side: 'BUY', type: 'MARKET',
      quoteOrderQty: Math.floor(amountQuote),
      ...(clientOrderId ? { newClientOrderId: clientOrderId } : {})
    });
    // Rekonsiliasi fill via myTrades
    return this.reconcile(pair, 'BUY', String(data.orderId), amountQuote, clientOrderId);
  }

  async sellMarket(pair: string, qtyBase: number, clientOrderId?: string): Promise<OrderResult> {
    const data = await this.signed('POST', '/api/v2/order', {
      symbol: IndodaxV2Client.symbol(pair), side: 'SELL', type: 'MARKET',
      quantity: parseFloat(qtyBase.toFixed(8)),
      ...(clientOrderId ? { newClientOrderId: clientOrderId } : {})
    });
    return this.reconcile(pair, 'SELL', String(data.orderId), qtyBase, clientOrderId);
  }

  /** Ambil fill aktual dari myTrades berdasarkan orderId */
  private async reconcile(pair: string, side: 'BUY' | 'SELL', orderId: string, fallbackQtyOrAmount: number, clientOrderId?: string): Promise<OrderResult> {
    const ticker = await this.getTicker(pair);
    let price = side === 'BUY' ? ticker.ask : ticker.bid;
    let qty = side === 'BUY' ? fallbackQtyOrAmount / price : fallbackQtyOrAmount;
    let fee = qty * price * this.feeRate;
    try {
      await new Promise(r => setTimeout(r, 500));
      const trades = await this.signed<any[]>('GET', '/api/v2/myTrades', { symbol: IndodaxV2Client.symbol(pair), orderId, limit: 50 });
      if (Array.isArray(trades) && trades.length > 0) {
        let q = 0, val = 0, f = 0;
        for (const t of trades) {
          const tq = parseFloat(t.qty);
          const tp = parseFloat(t.price);
          q += tq; val += tq * tp; f += parseFloat(t.commission || '0');
        }
        if (q > 0) { qty = q; price = val / q; fee = f > 0 ? f : val * this.feeRate; }
      }
    } catch { /* pakai fallback */ }
    return { order_id: orderId, price, qty, fee, side: side === 'BUY' ? 'buy' : 'sell', status: 'filled' };
  }

  async getTicker(pair: string): Promise<Ticker> {
    const p = pair.toLowerCase().includes('_') ? pair.toLowerCase() : pair.toLowerCase().replace(/idr$/, '_idr');
    const { data } = await this.apiHttp.get(`/api/${p}/ticker`);
    const t = data.ticker;
    return {
      pair: pair.toUpperCase(), bid: parseFloat(t.buy), ask: parseFloat(t.sell), last: parseFloat(t.last),
      high24: parseFloat(t.high), low24: parseFloat(t.low), vol24: parseFloat(t.vol_idr || '0'), ts: Date.now()
    };
  }
}
