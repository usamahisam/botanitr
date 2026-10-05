/**
 * Backfill SATU KALI: suntik 30 hari candle per-jam ke price_history agar
 * backtest 7/14/30 hari langsung punya data.
 *
 * Sumber: klines publik Binance (tanpa key). Pair USDT dipakai langsung;
 * pair IDR = harga USDT × kurs harian USD/IDR (Frankfurter, forward-fill
 * akhir pekan). BUKAN data Indodax asli — proksi arah yang jujur dilabeli
 * "riwayat lokal" oleh UI (memang tersimpan di tabel lokal).
 *
 * Pakai: npx tsx server/scripts/backfill-history.ts [--days=30] [--dump=backfill.sql]
 *   - tanpa --dump: tulis ke DB $BOTANI_DATA_DIR
 *   - dengan --dump: tulis file SQL (untuk disuntik ke DB VPS via sqlite3)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

if (!process.env.BOTANI_DATA_DIR) {
  process.env.BOTANI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'botani-backfill-'));
}
process.env.SECRET_KEY = process.env.SECRET_KEY || 'test-secret-key-minimal-32-chars-abcdef';

const DAYS = Number((process.argv.find(a => a.startsWith('--days=')) || '--days=30').split('=')[1]) || 30;
const DUMP = (process.argv.find(a => a.startsWith('--dump=')) || '').split('=')[1] || '';

const BINANCE = 'https://data-api.binance.vision';
// Basis unik yang dibutuhkan semua market (USDT di Binance)
const BASES = ['BTC', 'ETH', 'XRP', 'SOL', 'DOGE', 'ADA', 'SUI', 'LINK', 'BNB', 'AVAX', 'ONDO', 'TRX', 'LTC', 'NEAR', 'DOT', 'UNI'];
const INDODAX_IDR = ['BTC', 'ETH', 'XRP', 'SOL', 'DOGE', 'ADA', 'SUI', 'ONDO', 'LINK', 'TRX'];
const BITTIME_IDR = ['BTC', 'ETH', 'XRP', 'TRX', 'BNB', 'LTC', 'NEAR', 'DOT', 'UNI', 'SUI'];
const USDT_PAIRS = ['BTC', 'ETH', 'XRP', 'SOL', 'DOGE', 'ADA', 'SUI', 'LINK', 'BNB', 'AVAX'];

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'User-Agent': 'botanitr-backfill/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} untuk ${url.slice(0, 80)}`);
  return res.json();
}

/** Kurs harian USD→IDR (bisnis day saja) → map YYYY-MM-DD → rate, forward-fill. */
async function fetchRates(days: number): Promise<Map<string, number>> {
  const end = new Date();
  const start = new Date(Date.now() - (days + 5) * 86400000);
  const f = (d: Date) => d.toISOString().slice(0, 10);
  const url = `https://api.frankfurter.dev/v1/${f(start)}..${f(end)}?from=USD&to=IDR`;
  const j = await getJson(url);
  const byDate = new Map<string, number>();
  for (const [d, r] of Object.entries<any>(j.rates || {})) byDate.set(d, Number(r.IDR));
  // Forward-fill tiap hari kalender
  const out = new Map<string, number>();
  let last = 0;
  for (let i = days + 1; i >= 0; i--) {
    const d = f(new Date(Date.now() - i * 86400000));
    if (byDate.has(d)) last = byDate.get(d)!;
    if (last > 0) out.set(d, last);
  }
  if (out.size === 0) throw new Error('Kurs kosong');
  return out;
}

async function main() {
  const limit = Math.min(DAYS * 24, 1000);
  console.log(`Mengambil ${BASES.length} simbol × ${limit} candle 1h + kurs harian…`);

  const rates = await fetchRates(DAYS);
  const dayRate = (ts: number) => {
    const d = new Date(ts).toISOString().slice(0, 10);
    return rates.get(d) ?? [...rates.values()].pop()!;
  };

  // [exchange, pair, ts, price]
  const rows: [string, string, number, number][] = [];
  for (const b of BASES) {
    const kl = await getJson(`${BINANCE}/api/v3/klines?symbol=${b}USDT&interval=1h&limit=${limit}`);
    if (!Array.isArray(kl) || kl.length === 0) throw new Error(`Klines kosong untuk ${b}USDT`);
    for (const k of kl) {
      const ts = Number(k[0]);
      const close = Number(k[4]);
      if (!(close > 0)) continue;
      const pairU = `${b}USDT`;
      rows.push(['tokocrypto', pairU, ts, close]);
      rows.push(['binance', pairU, ts, close]);
      if (INDODAX_IDR.includes(b) || BITTIME_IDR.includes(b)) {
        const idr = close * dayRate(ts);
        if (INDODAX_IDR.includes(b)) rows.push(['indodax', `${b}IDR`, ts, Math.round(idr * 100) / 100]);
        if (BITTIME_IDR.includes(b)) rows.push(['bittime', `${b}IDR`, ts, Math.round(idr * 100) / 100]);
      }
    }
    console.log(`  ${b}USDT: ${kl.length} candle`);
  }
  void USDT_PAIRS;

  if (DUMP) {
    const lines = rows.map(([e, p, ts, pr]) =>
      `INSERT OR IGNORE INTO price_history (exchange_id, pair, ts, price) VALUES ('${e}','${p}',${ts},${pr});`);
    fs.writeFileSync(DUMP, lines.join('\n') + '\n');
    console.log(`SQL ditulis: ${DUMP} (${lines.length} baris)`);
  } else {
    const { db } = await import('../src/db/index.js');
    const ins = db.prepare('INSERT OR IGNORE INTO price_history (exchange_id, pair, ts, price) VALUES (?,?,?,?)');
    const tx = db.transaction((rs: typeof rows) => { for (const r of rs) ins.run(...r); });
    tx(rows);
    const c = (db.prepare('SELECT COUNT(*) c FROM price_history').get() as any).c;
    console.log(`Masuk DB: ${rows.length} baris (total tabel: ${c})`);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
