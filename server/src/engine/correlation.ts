import { db } from '../db/index.js';
import { getLocalKlines } from './history.js';

/**
 * Guard korelasi: jangan buka banyak bot yang bergerak sama persis.
 * 5 bot long coin berkorelasi 0.95 = 1 taruhan raksasa, bukan diversifikasi.
 * Korelasi Pearson dari return per-jam 7 hari terakhir (data lokal).
 */

export interface PairCorr { a: string; b: string; corr: number }

function closes(exchangeId: string, pair: string, n = 168): number[] {
  try {
    return getLocalKlines(exchangeId, pair, '1h', n).map(k => k[4]).filter(v => v > 0);
  } catch {
    return [];
  }
}

export function pearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 10) return 0;
  const a = x.slice(-n), b = y.slice(-n);
  const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2;
  }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
}

export interface CorrelationReport {
  pairs: string[];
  high: PairCorr[];   // korelasi ≥ 0.85 antar pair bot berjalan
  note: string;
}

/**
 * Korelasi antar pair yang dipakai bot running UANG RIIL milik user.
 * Bot demo (paper) disengaja dikecualikan: uang mainan tidak menumpuk risiko,
 * dan pola umum (uji strategi di demo sambil jalan live di pair sama)
 * tidak boleh memicu alarm palsu.
 */
export function correlationReport(userId: number): CorrelationReport {
  const rows = db.prepare(`SELECT DISTINCT exchange_id, pair FROM bots
    WHERE user_id=? AND status='running' AND mode='live'`).all(userId) as any[];
  const keys = rows.map(r => `${r.exchange_id}:${String(r.pair).toUpperCase()}`);
  const series = new Map<string, number[]>();
  for (const r of rows) {
    const k = `${r.exchange_id}:${String(r.pair).toUpperCase()}`;
    series.set(k, closes(r.exchange_id, r.pair));
  }
  const high: PairCorr[] = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const c = pearson(series.get(keys[i]) || [], series.get(keys[j]) || []);
      if (c >= 0.85) high.push({ a: keys[i], b: keys[j], corr: Math.round(c * 100) / 100 });
    }
  }
  return {
    pairs: keys, high,
    note: high.length > 0
      ? `${high.length} pasangan bot riil bergerak nyaris sama (≥0.85) — risiko menumpuk, pertimbangkan jeda salah satunya`
      : 'Tidak ada korelasi berbahaya antar bot riil berjalan',
  };
}
