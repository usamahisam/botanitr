/** Nilai tak valid (NaN/Infinity/undefined) tak boleh tampil sebagai "Rp NaN". */
function safeNum(n: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

export function fmtIDR(n: number, decimals = 0): string {
  n = safeNum(n);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const fixed = abs.toFixed(decimals);
  const [int, dec] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}Rp ${grouped}${dec ? ',' + dec : ''}`;
}

export function fmtSignedIDR(n: number): string {
  n = safeNum(n);
  return `${n > 0 ? '+' : ''}${fmtIDR(n)}`;
}

export function fmtPct(n: number, decimals = 2): string {
  n = safeNum(n);
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals).replace('.', ',')}%`;
}

/** Angka polos bergaya ID (pemisah ribuan titik, desimal koma) */
export function fmtNum(n: number, decimals = 0): string {
  n = safeNum(n);
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, dec] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${n < 0 ? '-' : ''}${grouped}${dec ? ',' + dec : ''}`;
}

export function fmtQty(n: number): string {
  n = safeNum(n);
  let s = n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  const [int, dec] = s.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dec ? `${grouped},${dec}` : grouped;
}

/** Quote dari suffix pair (XRPUSDT → USDT, selain itu IDR) */
export function quoteOfPair(pair: string): string {
  return /USDT$/i.test(String(pair || '')) ? 'USDT' : 'IDR';
}

/**
 * Nominal sadar-quote: IDR → "Rp 1.234.567", USDT → "1.234,56 USDT".
 * Pakai ini untuk nilai dalam quote pair (harga, budget, PnL bot/trade).
 * Nilai yang SUDAH dikonversi ke IDR (total portfolio, impact_rp) tetap fmtIDR.
 */
export function fmtMoney(n: number, quote = 'IDR', decimals?: number): string {
  if (String(quote).toUpperCase() !== 'USDT') return fmtIDR(n, decimals ?? 0);
  n = safeNum(n);
  const d = decimals ?? (n === 0 ? 2 : Math.abs(n) < 10 ? 4 : Math.abs(n) < 1000 ? 2 : 0);
  return `${fmtNum(n, d)} USDT`;
}

export function fmtSignedMoney(n: number, quote = 'IDR', decimals?: number): string {
  n = safeNum(n);
  return `${n > 0 ? '+' : ''}${fmtMoney(n, quote, decimals)}`;
}

/** Jam selalu WIB (Asia/Jakarta) — DB menyimpan UTC, slice mentah = jam UTC. */
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(11, 19)
    : d.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
