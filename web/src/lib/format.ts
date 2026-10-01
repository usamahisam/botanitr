export function fmtIDR(n: number, decimals = 0): string {
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
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals).replace('.', ',')}%`;
}

export function fmtQty(n: number): string {
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
