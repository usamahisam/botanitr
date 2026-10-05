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
  return `${n >= 0 ? '+' : ''}${fmtIDR(n)}`;
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

export function fmtTime(iso: string): string {
  return iso.slice(11, 19);
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
