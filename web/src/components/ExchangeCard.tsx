import { useState } from 'react';
import { api, ExchangeView } from '../lib/api';
import { fmtIDR, fmtSignedIDR, fmtPct, fmtQty } from '../lib/format';
import { Icon } from './icons';

export default function ExchangeCard({ ex, onSynced }: { ex: ExchangeView; onSynced: () => void }) {
  const [syncing, setSyncing] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const sync = async () => {
    setSyncing(true);
    try { await api.post(`/exchanges/${ex.id}/sync`); onSynced(); } finally { setSyncing(false); }
  };

  const changePct = ex.profit_harian && ex.saldo_total_idr
    ? (ex.profit_harian / Math.max(1, ex.saldo_total_idr - ex.profit_harian)) * 100 : 0;
  const coins = ex.coins.filter(c => c.symbol !== ex.quote_asset);
  const visible = showAll ? coins : coins.slice(0, 5);

  return (
    <section className="panel">
      <div className="panel-head">
        <div className="flex items-center gap-2.5">
          <span className={`text-[11px] font-bold tracking-wider ${ex.mode === 'live' ? 'txt-up' : 'text-[#f0b90b]'}`}>
            {ex.mode === 'live' ? 'LIVE' : 'DEMO'}
          </span>
          <span className="text-sm font-semibold">{ex.name}</span>
          <span className={`flex items-center gap-1 text-[11px] txt-3`}>
            <span className={ex.status === 'ok' ? 'txt-up' : ex.status === 'error' ? 'txt-down' : 'txt-3'}>
              <Icon.dot size={6} />
            </span>
            {ex.status === 'ok' ? 'Terhubung' : ex.status === 'error' ? 'Gagal' : '—'}
          </span>
        </div>
        <button onClick={sync} disabled={syncing} className="btn btn-ghost btn-sm btn-icon" title="Sinkronkan saldo">
          <span className={syncing ? 'animate-spin inline-block' : 'inline-block'}><Icon.refresh size={14} /></span>
        </button>
      </div>

      <div className="px-4 pt-4 pb-3">
        {ex.error && (
          <div className="flex items-start gap-2 text-xs txt-down bg-[rgba(246,70,93,0.08)] border border-[rgba(246,70,93,0.25)] rounded-md px-3 py-2 mb-3">
            <Icon.warn size={14} /> <span>{ex.error}</span>
          </div>
        )}
        <div className="lbl">Nilai portofolio</div>
        <div className="flex items-baseline gap-3 mt-1 flex-wrap">
          <span className="num text-[24px] sm:text-[28px] font-semibold tracking-tight break-all">{fmtIDR(ex.saldo_total_idr)}</span>
          <span className={`num text-[13px] font-medium flex items-center gap-1 ${changePct >= 0 ? 'txt-up' : 'txt-down'}`}>
            {changePct >= 0 ? <Icon.up size={13} /> : <Icon.down size={13} />}
            {fmtPct(changePct)} · {fmtSignedIDR(ex.profit_harian)}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/[0.06] border border-white/[0.06] rounded-md overflow-hidden mt-4">
          {[
            { l: 'Profit 24J', v: fmtSignedIDR(ex.profit_harian), up: ex.profit_harian >= 0 },
            { l: 'Profit Total', v: fmtSignedIDR(ex.profit_total), up: ex.profit_total >= 0 },
            { l: `Kas ${ex.quote_asset}`, v: fmtIDR(ex.kas_bebas_idr), up: undefined },
            { l: `Pending ${ex.pending_count}`, v: fmtIDR(ex.pending_value), up: undefined }
          ].map((s, i) => (
            <div key={i} className="bg-[#0f151d] px-3 py-2.5">
              <div className="lbl !text-[10px] truncate">{s.l}</div>
              <div className={`num text-[13px] font-semibold mt-0.5 truncate ${s.up === undefined ? '' : s.up ? 'txt-up' : 'txt-down'}`}>{s.v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
      <table className="tbl min-w-[340px]">
        <thead>
          <tr><th>Aset</th><th className="!text-right">Jumlah</th><th className="!text-right">Nilai</th><th className="!text-right">Porsi</th></tr>
        </thead>
        <tbody>
          {coins.length === 0 && (
            <tr><td colSpan={4} className="!text-center txt-3 !py-5">Belum ada posisi</td></tr>
          )}
          {visible.map(c => (
            <tr key={c.symbol}>
              <td>
                <span className="font-semibold">{c.symbol}</span>
                <span className="txt-3 text-xs ml-1.5">/{ex.quote_asset}</span>
              </td>
              <td className="!text-right num txt-2">{fmtQty(c.qty)}</td>
              <td className="!text-right num">{fmtIDR(c.value_idr)}</td>
              <td className="!text-right">
                <div className="flex items-center justify-end gap-2">
                  <div className="w-12 h-1 rounded-full bg-white/[0.07] overflow-hidden">
                    <div className="h-full bg-[#4f7cff]" style={{ width: `${Math.min(100, c.porsi_pct)}%` }} />
                  </div>
                  <span className="num text-xs txt-2 w-11">{c.porsi_pct.toFixed(1)}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {coins.length > 5 && (
        <button onClick={() => setShowAll(!showAll)} className="w-full py-2 text-xs txt-3 hover:text-white border-t border-white/[0.06] transition-colors">
          {showAll ? 'Tampilkan lebih sedikit' : `Tampilkan semua (${coins.length})`}
        </button>
      )}
    </section>
  );
}
