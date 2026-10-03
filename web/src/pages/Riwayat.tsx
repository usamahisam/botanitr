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
    <section className="panel">
      <div className="panel-head">
        <div>
          <span className="text-[14px] font-semibold">Riwayat transaksi</span>
          <span className="num text-xs txt-3 ml-2">{total} baris</span>
        </div>
        <div className="flex gap-2">
          <select value={exchange} onChange={e => { setExchange(e.target.value); setPage(1); }} className="input !w-auto !py-1.5 text-xs">
            <option value="">Semua exchange</option>
            <option value="indodax">Indodax</option>
            <option value="tokocrypto">Tokocrypto</option>
          </select>
          <select value={mode} onChange={e => { setMode(e.target.value); setPage(1); }} className="input !w-auto !py-1.5 text-xs">
            <option value="">Semua mode</option>
            <option value="paper">Demo</option>
            <option value="live">Riil</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="tbl num">
          <thead>
            <tr>
              <th>Waktu</th><th>Pair</th><th>Sisi</th>
              <th className="!text-right">Harga</th><th className="!text-right">Qty</th>
              <th className="!text-right">Nilai</th><th className="!text-right">Fee</th><th className="!text-right">PnL</th>
              <th>Mode</th><th>Sumber</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={10} className="!text-center txt-3 !py-8 font-sans">Belum ada transaksi.</td></tr>}
            {rows.map(t => (
              <tr key={t.id}>
                <td className="txt-3 whitespace-nowrap !text-[12px]">{fmtDateTime(t.created_at)}</td>
                <td><span className="font-semibold font-sans">{t.pair}</span> <span className="txt-3 text-[11px] font-sans">{t.exchange_id}</span></td>
                <td><span className={`text-[12px] font-bold tracking-wide ${t.side === 'buy' ? 'txt-up' : 'txt-down'}`}>{t.side === 'buy' ? 'BELI' : 'JUAL'}</span></td>
                <td className="!text-right">{fmtIDR(t.price)}</td>
                <td className="!text-right txt-2">{fmtQty(t.qty)}</td>
                <td className="!text-right">{fmtIDR(t.value)}</td>
                <td className="!text-right txt-3">{fmtIDR(t.fee)}</td>
                <td className={`!text-right font-semibold ${t.realized_pnl > 0 ? 'txt-up' : t.realized_pnl < 0 ? 'txt-down' : 'txt-3'}`}>
                  {t.realized_pnl !== 0 ? fmtSignedIDR(t.realized_pnl) : '—'}
                </td>
                <td><span className={`tag ${t.mode === 'live' ? 'tag-down' : 'tag-dim'}`}>{t.mode === 'live' ? 'RIIL' : 'DEMO'}</span></td>
                <td className="txt-3 text-xs font-sans">{t.strategy_tag || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06] text-xs txt-3">
        <span className="num">Halaman {page} / {totalPages}</span>
        <div className="flex gap-1">
          {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => (
            <button key={i} onClick={() => setPage(i + 1)}
              className={`w-7 h-7 rounded-md text-xs num font-medium border ${page === i + 1 ? 'bg-[#4f7cff] border-[#4f7cff] text-white' : 'border-white/10 txt-3 hover:text-white'}`}>{i + 1}</button>
          ))}
        </div>
      </div>
    </section>
  );
}
