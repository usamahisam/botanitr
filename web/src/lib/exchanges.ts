/** Daftar exchange + quote currency. Satu sumber untuk semua dropdown. */
export const EXCHANGES = [
  { id: 'indodax', label: 'Indodax', quote: 'IDR' },
  { id: 'bittime', label: 'Bittime', quote: 'IDR' },
  { id: 'binance', label: 'Binance', quote: 'USDT' },
  { id: 'tokocrypto', label: 'Tokocrypto', quote: 'USDT' }
] as const;

export const QUOTE: Record<string, string> = Object.fromEntries(
  EXCHANGES.map(e => [e.id, e.quote])
);

export function quoteOf(exchangeId: string): string {
  return QUOTE[exchangeId] || 'IDR';
}
