import { db, queries, now, ExchangeRow } from '../db/index.js';
import { registry, KNOWN_EXCHANGES } from '../exchange/registry.js';
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

/** Ambil saldo (paper/live) + estimasi nilai IDR per aset — terisolasi per user */
export async function fetchExchangeBalance(exchangeId: string, userId = 0): Promise<ExchangeBalanceView> {
  const row = db.prepare('SELECT * FROM exchanges WHERE id=? AND user_id=?').get(exchangeId, userId) as ExchangeRow | undefined;
  const client = registry.getForUser(exchangeId, userId);
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
    const balances = isPaper ? registry.getPaperForUser(exchangeId, userId).getBalances() : await client.getBalances();

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
          // getTicker sudah tervalidasi; pengaman ganda agar satu koin korup
          // tak meracuni total portofolio menjadi NaN
          if (!Number.isFinite(ticker.last) || ticker.last <= 0) continue;
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
      db.prepare(`UPDATE exchanges SET status='ok', last_sync=? WHERE id=? AND user_id=?`).run(now(), exchangeId, userId);
    } else {
      db.prepare(`UPDATE exchanges SET last_sync=? WHERE id=? AND user_id=?`).run(now(), exchangeId, userId);
    }
  } catch (e: any) {
    view.error = e.message;
    view.status = 'error';
    db.prepare(`UPDATE exchanges SET status='error' WHERE id=? AND user_id=?`).run(exchangeId, userId);
  }

  return view;
}

/** Simpan snapshot untuk perhitungan profit harian & tren */
export function snapshotBalances(views: ExchangeBalanceView[], userId = 0) {
  const ins = db.prepare(`INSERT INTO balance_snapshots (user_id, exchange_id, asset, free, locked, price_idr, total_idr, created_at) VALUES (?,?,?,?,?,?,?,?)`);
  const ts = now();
  for (const v of views) {
    for (const c of v.coins) {
      ins.run(userId, v.id, c.symbol, c.qty, 0, c.qty > 0 ? c.value_idr / c.qty : 0, c.value_idr, ts);
    }
  }
}

export interface BalanceNeed {
  bot_id: number; name: string; lot: number; mode: string; ok: boolean;
}
export interface BalanceHealth {
  exchange_id: string; quote: string; free_quote: number; error: string | null;
  bots: BalanceNeed[]; short: number;
  /** Total modal diklaim bot running + flag bila melebihi kas (double-spend) */
  committed_quote: number; overallocated: boolean;
}

/**
 * Health check saldo: kas tersedia per exchange + kecukupan lot tiap bot running.
 * Dipakai Dashboard untuk peringatan dini sebelum order gagal.
 */
export async function checkBalancesHealth(userId: number): Promise<BalanceHealth[]> {
  const rows = db.prepare('SELECT id FROM exchanges WHERE user_id=?').all(userId) as any[];
  const ids = rows.length > 0 ? rows.map(r => r.id) : [...KNOWN_EXCHANGES];
  const bots = db.prepare(`SELECT * FROM bots WHERE user_id=? AND status='running'`).all(userId) as any[];
  const out: BalanceHealth[] = [];
  for (const id of ids) {
    const client = registry.getForUser(id, userId);
    const quote = client.quoteAsset;
    let freeQuote = 0;
    let error: string | null = null;
    try {
      const row = db.prepare('SELECT * FROM exchanges WHERE id=? AND user_id=?').get(id, userId) as any;
      const balances = row?.mode === 'paper'
        ? registry.getPaperForUser(id, userId).getBalances()
        : await client.getBalances();
      freeQuote = balances.find(b => b.asset === quote)?.free ?? 0;
    } catch (e: any) { error = e.message; }
    const { unspentClaim } = await import('./budget.js');
    // Kebutuhan riil bot = lot TERKECIL vs sisa kas ledgernya. Bot yang sudah
    // membelikan seluruh kasnya jadi barang (sisa klaim ~0) tidak butuh kas
    // lagi — menagih full lot ke dia adalah alarm palsu (kasus #46: lot 99rb
    // padahal kas bot sudah jadi barang XRP). Guard ledger di trader yang
    // akan menolak bila ia memaksa beli melebihi sisa kasnya.
    const needs: BalanceNeed[] = bots
      .filter(b => b.exchange_id === id)
      .map(b => {
        const need = Math.min(Number(b.lot) || 0, unspentClaim(b));
        return { bot_id: b.id, name: b.name, lot: b.lot, mode: b.mode, ok: error ? false : freeQuote >= need };
      });
    // Monitor alokasi ganda: total SISA klaim (kas ledger) bot running vs kas.
    // Quick-trade manual / bot lama bisa membuat klaim melebihi kas nyata.
    // PENTING: pakai sisa kas, bukan full budget — barang yang sudah dibeli
    // sudah keluar dari kas bebas (menghitung full = hitung ganda = alarm palsu).
    const committed = bots
      .filter(x => x.exchange_id === id && x.status === 'running')
      .reduce((s: number, b: any) => s + unspentClaim(b), 0);
    const overallocated = !error && committed > freeQuote;
    if (overallocated) {
      log('warn', 'ENGINE', `Alokasi berlebih di ${id}: klaim bot ${Math.round(committed)} > kas ${Math.round(freeQuote)} ${quote}`, { user_id: userId });
    }
    out.push({ exchange_id: id, quote, free_quote: freeQuote, error, bots: needs, short: needs.filter(n => !n.ok).length, committed_quote: committed, overallocated });
  }
  return out;
}

let syncTimer: NodeJS.Timeout | null = null;
/** Sinkron berkala tiap 60 detik — untuk semua user yang punya bot/data */
export function startBalanceSync(broadcast: (views: ExchangeBalanceView[], userId: number) => void) {
  const syncUser = async (userId: number) => {
    const rows = db.prepare('SELECT id FROM exchanges WHERE user_id=?').all(userId) as any[];
    const ids = rows.length > 0 ? rows.map(r => r.id) : [...KNOWN_EXCHANGES];
    const views: ExchangeBalanceView[] = [];
    for (const id of ids) {
      views.push(await fetchExchangeBalance(id, userId));
    }
    snapshotBalances(views, userId);
    broadcast(views, userId);
  };
  const run = async () => {
    const users = db.prepare('SELECT id FROM users').all() as any[];
    const ids = users.length > 0 ? users.map(u => u.id) : [0];
    for (const uid of ids) {
      await syncUser(uid).catch(e => log('error', 'ERROR', `Sinkron saldo gagal: ${e.message}`, { user_id: uid }));
    }
  };
  run().catch(e => log('error', 'ERROR', `Sinkron saldo gagal: ${e.message}`));
  syncTimer = setInterval(() => run().catch(e => log('error', 'ERROR', `Sinkron saldo gagal: ${e.message}`)), 60000);
}

export function stopBalanceSync() { if (syncTimer) clearInterval(syncTimer); }
