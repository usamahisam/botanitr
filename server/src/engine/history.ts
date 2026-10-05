import { db } from '../db/index.js';
import { registry } from '../exchange/registry.js';
import { Kline } from '../exchange/base.js';
import { log } from '../log.js';

/**
 * Perekam riwayat harga lokal.
 *
 * Latar belakang: Indodax tidak punya endpoint OHLC publik — /api/trades
 * hanya mengembalikan ~500 trade terakhir (±5 jam), sehingga backtest
 * rentang harian mustahil dari data exchange saja. Modul ini mengakumulasi
 * snapshot ticker tiap menit ke tabel price_history, lalu membentuk candle
 * OHLC sesuai interval yang diminta.
 *
 * Retensi 45 hari, prune tiap siklus.
 */

const RETENTION_MS = 45 * 24 * 3600 * 1000;

export function intervalMs(interval: string): number {
  const m = /^(\d+)([mhd])$/.exec(interval);
  if (!m) return 3600000;
  const n = Number(m[1]);
  if (m[2] === 'm') return n * 60000;
  if (m[2] === 'h') return n * 3600000;
  return n * 86400000;
}

/** Kumpulkan pair yang layak direkam: bot berjalan + alert aktif + default pairs */
function collectPairs(): { exchange_id: string; pair: string }[] {
  const seen = new Map<string, { exchange_id: string; pair: string }>();
  const add = (exchange_id: string, pair: string) => {
    seen.set(`${exchange_id}:${pair.toUpperCase()}`, { exchange_id, pair: pair.toUpperCase() });
  };
  try {
    for (const b of db.prepare(`SELECT exchange_id, pair FROM bots WHERE status='running'`).all() as any[]) {
      add(b.exchange_id, b.pair);
    }
    for (const a of db.prepare(`SELECT exchange_id, pair FROM price_alerts WHERE active=1`).all() as any[]) {
      add(a.exchange_id, a.pair);
    }
    for (const p of db.prepare(`SELECT exchange_id, symbol FROM default_pairs`).all() as any[]) {
      add(p.exchange_id, p.symbol);
    }
  } catch { /* DB belum siap */ }
  return [...seen.values()];
}

async function recordOnce() {
  const pairs = collectPairs();
  if (pairs.length === 0) return;
  const ts = Date.now();
  const ins = db.prepare(`INSERT OR IGNORE INTO price_history (exchange_id, pair, ts, price) VALUES (?,?,?,?)`);

  // Indodax: satu panggilan summaries untuk semua pair IDR (hemat rate-limit)
  const idxPairs = pairs.filter(p => p.exchange_id === 'indodax');
  if (idxPairs.length > 0) {
    try {
      const { createHttp } = await import('../exchange/http.js');
      const { config } = await import('../config.js');
      const row = db.prepare(`SELECT proxy_url FROM exchanges WHERE id='indodax' LIMIT 1`).get() as any;
      const http = createHttp(config.indodaxBaseUrl, row?.proxy_url || undefined);
      const { data } = await http.get('/api/summaries');
      const tickers = data.tickers || {};
      for (const p of idxPairs) {
        const flat = p.pair.toLowerCase();
        const under = flat.replace(/idr$/, '_idr').replace(/usdt$/, '_usdt');
        const t = tickers[under] || tickers[flat];
        const last = parseFloat(t?.last || '0');
        if (last > 0) ins.run('indodax', p.pair, ts, last);
      }
    } catch { /* lewati siklus ini */ }
  }

  // Exchange lain: ticker per pair (dipakai untuk bot/alert yang berjalan)
  for (const p of pairs.filter(x => x.exchange_id !== 'indodax')) {
    try {
      const t = await registry.get(p.exchange_id).getTicker(p.pair);
      if (t.last > 0) ins.run(p.exchange_id, p.pair, ts, t.last);
    } catch { /* lewati pair gagal */ }
  }

  // Prune retensi
  try {
    db.prepare(`DELETE FROM price_history WHERE ts < ?`).run(Date.now() - RETENTION_MS);
  } catch { /* abaikan */ }
}

/**
 * Bentuk candle OHLC dari tick lokal. Ambil baris TERBARU dulu agar tidak
 * memakai data basi saat histori melebihi batas (20.000 tick ≈ 14 hari).
 */
export function getLocalKlines(exchangeId: string, pair: string, interval: string, limit: number): Kline[] {
  const step = intervalMs(interval);
  const rows = db.prepare(
    `SELECT ts, price FROM price_history WHERE exchange_id=? AND pair=? ORDER BY ts DESC LIMIT 20000`
  ).all(exchangeId, pair.toUpperCase()) as any[];
  if (rows.length < 2) return [];
  const buckets = new Map<number, { o: number; h: number; l: number; c: number; v: number; n: number }>();
  // Iterasi kronologis agar open = harga pertama bucket
  for (const r of [...rows].reverse()) {
    const b = Math.floor(r.ts / step) * step;
    const e = buckets.get(b);
    if (!e) buckets.set(b, { o: r.price, h: r.price, l: r.price, c: r.price, v: 0, n: 1 });
    else { e.h = Math.max(e.h, r.price); e.l = Math.min(e.l, r.price); e.c = r.price; e.n++; }
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0])
    .slice(-limit)
    .map(([t, x]) => [t, x.o, x.h, x.l, x.c, x.n] as Kline);
}

/** Info cakupan data lokal (untuk catatan di UI) */
export function localCoverage(exchangeId: string, pair: string): { points: number; since: string | null } {
  try {
    const r = db.prepare(
      `SELECT COUNT(*) c, MIN(ts) mn FROM price_history WHERE exchange_id=? AND pair=?`
    ).get(exchangeId, pair.toUpperCase()) as any;
    return {
      points: r.c || 0,
      since: r.mn ? new Date(r.mn).toISOString().slice(0, 10) : null
    };
  } catch {
    return { points: 0, since: null };
  }
}

let timer: NodeJS.Timeout | null = null;
export function startHistoryRecorder(intervalMsRec = 60000) {
  const run = () => recordOnce().catch(e => log('error', 'ERROR', `Perekam riwayat gagal: ${e.message}`));
  setTimeout(run, 10000); // mulai 10 detik setelah boot
  timer = setInterval(run, intervalMsRec);
  log('info', 'ENGINE', 'Perekam riwayat harga aktif (tiap 1 menit, retensi 45 hari)');
}
export function stopHistoryRecorder() { if (timer) clearInterval(timer); }
