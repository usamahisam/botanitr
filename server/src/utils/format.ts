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

export function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
