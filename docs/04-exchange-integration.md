# 04 — Integrasi Exchange & Proxy

## Interface (`exchange/base.ts`)
```ts
interface Ticker { pair: string; bid: number; ask: number; last: number; high24: number; low24: number; vol24: number; ts: number }
interface Balance { asset: string; free: number; locked: number }
interface OrderResult { order_id: string; price: number; qty: number; fee: number; side: 'buy'|'sell'; status: string }
interface ExchangeClient {
  readonly id: string;
  setProxy(url?: string): void;
  setCredentials(key: string, secret: string): void;
  testConnection(): Promise<{ ok: boolean; latency_ms: number; error?: string }>;
  getTicker(pair: string): Promise<Ticker>;
  getBalances(): Promise<Balance[]>;
  getOpenOrders(pair?: string): Promise<any[]>;
  buyMarket(pair: string, amountQuote: number): Promise<OrderResult>;
  sellMarket(pair: string, qtyBase: number): Promise<OrderResult>;
  getKlines(pair: string, interval: string, limit: number): Promise<number[][]>; // [t,o,h,l,c,v]
}
```

## Indodax (`exchange/indodax.ts`)
- Base: `https://indodax.com`
- Public: `GET /api/{pair}/ticker` (pair lowercase tanpa pemisah, mis. `btcidr`), `GET /api/{pair}/depth`, `GET /api/{pair}/trades`, klines tidak tersedia → ambil `GET /api/summaries` atau gunakan history trades; untuk backtest gunakan `GET https://indodax.com/api/{pair}/trades` (agregasi ke candle sederhana).
- Private: `POST /tapi` header `Key: <apiKey>`, `Sign: HMAC_SHA512(postBody, secret)`; body `method=<m>&timestamp=<ms>`. Method: `getInfo`, `trade` (params: pair, type, price, idr/btc), `getOrder`, `openOrders`, `cancelOrder`, `tradeHistory`, `transactions`.
- Fee: 0.3% (taker).
- Ticker map: `buy`→bid, `sell`→ask, `last`→last.

## Tokocrypto (`exchange/tokocrypto.ts`)
- Binance-compatible REST v3.
- Base URL configurable (env `TOKOCRYPTO_BASE_URL`, default `https://www.tokocrypto.com`; `api.tokocrypto.com` terbukti timeout dari beberapa jaringan → wajib proxy).
- Public: `GET /api/v3/ticker/24hr?symbol=XRPUSDT`, `GET /api/v3/depth`, `GET /api/v3/klines?symbol=&interval=1m&limit=`.
- Private (HMAC-SHA256): query `...&timestamp=<ms>&signature=<hex>` header `X-MBX-APIKEY: <key>`: `GET /api/v3/account`, `GET /api/v3/openOrders`, `POST /api/v3/order` (`side=BUY&type=MARKET&quoteOrderQty=` untuk beli nominal; `quantity=` untuk jual), `GET /api/v3/myTrades`.
- Fee: 0.1%.

## Proxy (`exchange/http.ts`)
```ts
function makeAgent(proxyUrl?: string) {
  if (!proxyUrl) return undefined;
  return proxyUrl.startsWith('socks') ? new SocksProxyAgent(proxyUrl) : new HttpsProxyAgent(proxyUrl);
}
```
Diterapkan sebagai `httpsAgent`+`httpAgent` pada axios instance per client. Telegram pakai agent yang sama via `Telegraf` `telegram: { agent }`? Tidak — Telegraf v4 pakai `client`/`apiRoot`; kita pakai `node-fetch` custom atau `telegraf` dengan `telegram.agent` (didukung lewat `Telegraf` options → `telegram: { agent }` memang ada di `telegraf/typings/telegram`). Verifikasi saat implementasi; fallback: set env `HTTPS_PROXY` untuk proses.

## Paper Simulator (`exchange/paper.ts`)
- Saldo virtual per exchange disimpan di tabel `paper_balances(exchange_id, asset, free, locked)`.
- `buyMarket`: pakai `ticker.ask`, fee%, update saldo; `order_id = paper-<ts>-<rand>`.
- Seed awal: IDR 10.000.000 / USDT 1000 saat pertama kali bot paper dibuat untuk exchange tsb.
- Guard: tolak jika saldo quote < amount atau saldo base < qty.

## Rate-limit & Resilience
- Timeout axios 15s. Retry 3x exponential (500ms, 1.5s, 4.5s) untuk error jaringan/5xx, **tidak** untuk 4xx (salah kredensial → tandai `exchanges.status='error'`).
- Cache ticker 5 detik per pair (Map in-memory) untuk kurangi beban.

## Test Koneksi
`testConnection()`: Indodax → `GET /api/server_time` (public); Tokocrypto → `GET /api/v3/ping`. Ukur latency. Kembalikan error message mentah untuk ditampilkan di UI.
