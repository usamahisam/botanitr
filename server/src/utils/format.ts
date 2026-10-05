/** Format Rupiah: Rp 1.234.567 (grup titik) */
export function fmtIDR(n: number, decimals = 0): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const fixed = abs.toFixed(decimals);
  const [int, dec] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}Rp ${grouped}${dec ? ',' + dec : ''}`;
}

/** Format angka polos dengan grup titik & desimal koma */
export function fmtNum(n: number, decimals = 2): string {
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, dec] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${n < 0 ? '-' : ''}${grouped}${dec ? ',' + dec : ''}`;
}

/** Qty aset: maks 8 desimal, trim nol */
export function fmtQty(n: number): string {
  let s = n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  const [int, dec] = s.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dec ? `${grouped},${dec}` : grouped;
}

export function fmtPct(n: number, decimals = 2): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals).replace('.', ',')}%`;
}

/** Quote dari suffix pair (XRPUSDT → USDT, selain itu IDR) */
export function quoteOfPair(pair: string): string {
  return /USDT$/i.test(String(pair || '')) ? 'USDT' : 'IDR';
}

/**
 * Nominal sadar-quote: IDR → "Rp 1.234.567", USDT → "1.234,56 USDT".
 * Desimal USDT adaptif (harga kecil butuh presisi lebih).
 */
export function fmtMoney(n: number, quote = 'IDR', decimals?: number): string {
  if (String(quote).toUpperCase() !== 'USDT') return fmtIDR(n, decimals ?? 0);
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  const d = decimals ?? (v === 0 ? 2 : Math.abs(v) < 10 ? 4 : Math.abs(v) < 1000 ? 2 : 0);
  return `${fmtNum(v, d)} USDT`;
}

export function fmtSignedMoney(n: number, quote = 'IDR', decimals?: number): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return `${v > 0 ? '+' : ''}${fmtMoney(v, quote, decimals)}`;
}

/** Jam lokal WIB (Asia/Jakarta) dari ISO UTC — DB menyimpan UTC. */
const wibTime = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const wibDateTime = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
});

export function fmtTimeWib(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso).slice(11, 19) : wibTime.format(d);
}

export function fmtDateTimeWib(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : wibDateTime.format(d);
}

export function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
