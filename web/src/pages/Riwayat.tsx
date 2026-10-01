import { useCallback, useEffect, useState } from 'react';
import { api, TradeRow } from '../lib/api';
import { fmtIDR, fmtQty, fmtDateTime, fmtSignedIDR } from '../lib/format';

export default function Riwayat() {
  const [rows, setRows] = useState<TradeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [exchange, setExchange] = useState('');
  const [mode, setMode] = useState('');
  const [page, setPage] = useState(1);
  const LIMIT = 25;

  const load = useCallback(() => {
    const q = new URLSearchParams({ limit: String(LIMIT), offset: String((page - 1) * LIMIT) });
    if (exchange) q.set('exchange', exchange);
    if (mode) q.set('mode', mode);
    api.get<{ total: number; rows: TradeRow[] }>(`/trades?${q}`).then(d => { setRows(d.rows); setTotal(d.total); });
  }, [exchange, mode, page]);

  useEffect(load, [load]);
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Riwayat Transaksi</h2>
        <div className="flex gap-2">
          <select value={exchange} onChange={e => { setExchange(e.target.value); setPage(1); }} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">Semua Exchange</option>
            <option value="indodax">Indodax</option>
            <option value="tokocrypto">Tokocrypto</option>
          </select>
          <select value={mode} onChange={e => { setMode(e.target.value); setPage(1); }} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">Semua Mode</option>
            <option value="paper">Demo</option>
            <option value="live">Riil</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b">
              <th className="py-2 pr-3">Waktu</th><th className="pr-3">Exchange</th><th className="pr-3">Pair</th>
              <th className="pr-3">Sisi</th><th className="pr-3 text-right">Harga</th><th className="pr-3 text-right">Qty</th>
              <th className="pr-3 text-right">Nilai</th><th className="pr-3 text-right">Fee</th><th className="pr-3 text-right">PnL</th>
              <th className="pr-3">Mode</th><th>Strategi</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={11} className="text-center text-gray-400 py-8">Belum ada transaksi</td></tr>}
            {rows.map(t => (
              <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{fmtDateTime(t.created_at)}</td>
                <td className="pr-3">{t.exchange_id}</td>
                <td className="pr-3 font-medium">{t.pair}</td>
                <td className="pr-3"><span className={`badge ${t.side === 'buy' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{t.side === 'buy' ? 'BELI' : 'JUAL'}</span></td>
                <td className="pr-3 text-right">{fmtIDR(t.price)}</td>
                <td className="pr-3 text-right">{fmtQty(t.qty)}</td>
                <td className="pr-3 text-right">{fmtIDR(t.value)}</td>
                <td className="pr-3 text-right text-gray-400">{fmtIDR(t.fee)}</td>
                <td className={`pr-3 text-right font-medium ${t.realized_pnl > 0 ? 'text-emerald-600' : t.realized_pnl < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                  {t.realized_pnl !== 0 ? fmtSignedIDR(t.realized_pnl) : '—'}
                </td>
                <td className="pr-3"><span className={`badge ${t.mode === 'live' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{t.mode === 'live' ? 'Riil' : 'Demo'}</span></td>
                <td className="text-xs text-gray-400">{t.strategy_tag || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
        <span>{total} transaksi</span>
        <div className="flex gap-1">
          {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => (
            <button key={i} onClick={() => setPage(i + 1)}
              className={`w-8 h-8 rounded-lg text-sm font-medium ${page === i + 1 ? 'bg-brand-500 text-white' : 'bg-white border border-gray-200'}`}>{i + 1}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
