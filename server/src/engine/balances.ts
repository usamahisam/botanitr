import { db, queries, now, ExchangeRow } from '../db/index.js';
import { registry } from '../exchange/registry.js';
import { log } from '../log.js';

let usdtIdrCache = { rate: 16000, ts: 0 };

/** Kurs USDT→IDR dari Indodax, cache 5 menit */
export async function getUsdtIdr(): Promise<number> {
  if (Date.now() - usdtIdrCache.ts < 5 * 60 * 1000) return usdtIdrCache.rate;
  try {
    const rate = await registry.get('indodax').getUsdtIdrRate();
    if (rate > 1000) {
      usdtIdrCache = { rate, ts: Date.now() };
    }
  } catch { /* pakai cache */ }
  return usdtIdrCache.rate;
}

export interface ExchangeBalanceView {
  id: string; name: string; mode: string; status: string;
  quote_asset: string;
  kas_bebas: number; kas_bebas_idr: number;
  pending_value: number; pending_count: number;
  saldo_total_quote: number; saldo_total_idr: number;
  coins: { symbol: string; qty: number; value_quote: number; value_idr: number; porsi_pct: number }[];
  error?: string;
}

/** Ambil saldo (paper/live) + estimasi nilai IDR per aset */
export async function fetchExchangeBalance(exchangeId: string): Promise<ExchangeBalanceView> {
  const row = queries.getExchange.get(exchangeId) as ExchangeRow;
  const client = registry.get(exchangeId);
  const quote = client.quoteAsset;
  const usdtIdr = quote === 'IDR' ? 1 : await getUsdtIdr();

  const view: ExchangeBalanceView = {
    id: exchangeId, name: row?.name || exchangeId, mode: row?.mode || 'paper',
    status: row?.status || 'unknown', quote_asset: quote,
    kas_bebas: 0, kas_bebas_idr: 0, pending_value: 0, pending_count: 0,
    saldo_total_quote: 0, saldo_total_idr: 0, coins: []
  };

  try {
    const isPaper = row?.mode === 'paper';
    const balances = isPaper ? registry.getPaper(exchangeId).getBalances() : await client.getBalances();

    let totalIdr = 0;
    const coins: ExchangeBalanceView['coins'] = [];

    for (const b of balances) {
      const qty = b.free + b.locked;
      if (qty <= 0) continue;
      let valueIdr = 0;
      let valueQuote = 0;
      if (b.asset === quote) {
        valueQuote = b.free;
        valueIdr = b.free * usdtIdr;
        view.kas_bebas = b.free;
        view.kas_bebas_idr = b.free * usdtIdr;
      } else {
        try {
          const ticker = await client.getTicker(`${b.asset}${quote}`);
          valueQuote = qty * ticker.last;
          valueIdr = valueQuote * usdtIdr;
        } catch { valueQuote = 0; valueIdr = 0; }
      }
      totalIdr += valueIdr;
      coins.push({ symbol: b.asset, qty, value_quote: valueQuote, value_idr: valueIdr, porsi_pct: 0 });
    }

    coins.sort((a, b) => b.value_idr - a.value_idr);
    for (const c of coins) c.porsi_pct = totalIdr > 0 ? (c.value_idr / totalIdr) * 100 : 0;

    view.saldo_total_idr = totalIdr;
    view.saldo_total_quote = totalIdr / usdtIdr;
    view.coins = coins;

    // Pending orders (live saja; paper tidak punya pending)
    if (!isPaper && client.hasCredentials()) {
      try {
        const orders = await client.getOpenOrders();
        view.pending_count = orders.length;
      } catch { /* abaikan */ }
    }

    if (row?.status !== 'ok') {
      db.prepare(`UPDATE exchanges SET status='ok', last_sync=? WHERE id=?`).run(now(), exchangeId);
    } else {
      db.prepare(`UPDATE exchanges SET last_sync=? WHERE id=?`).run(now(), exchangeId);
    }
  } catch (e: any) {
    view.error = e.message;
    view.status = 'error';
    db.prepare(`UPDATE exchanges SET status='error' WHERE id=?`).run(exchangeId);
  }

  return view;
}

/** Simpan snapshot untuk perhitungan profit harian & tren */
export function snapshotBalances(views: ExchangeBalanceView[]) {
  const ins = db.prepare(`INSERT INTO balance_snapshots (exchange_id, asset, free, locked, price_idr, total_idr, created_at) VALUES (?,?,?,?,?,?,?)`);
  const ts = now();
  for (const v of views) {
    for (const c of v.coins) {
      ins.run(v.id, c.symbol, c.qty, 0, c.qty > 0 ? c.value_idr / c.qty : 0, c.value_idr, ts);
    }
  }
}

let syncTimer: NodeJS.Timeout | null = null;
/** Sinkron berkala tiap 60 detik */
export function startBalanceSync(broadcast: (views: ExchangeBalanceView[]) => void) {
  const run = async () => {
    const views: ExchangeBalanceView[] = [];
    for (const client of registry.list()) {
      views.push(await fetchExchangeBalance(client.id));
    }
    snapshotBalances(views);
    broadcast(views);
  };
  run().catch(e => log('error', 'ERROR', `Sinkron saldo gagal: ${e.message}`));
  syncTimer = setInterval(() => run().catch(e => log('error', 'ERROR', `Sinkron saldo gagal: ${e.message}`)), 60000);
}

export function stopBalanceSync() { if (syncTimer) clearInterval(syncTimer); }
