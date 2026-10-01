import { useState } from 'react';
import { api, ExchangeView } from '../lib/api';
import { fmtIDR, fmtSignedIDR, fmtPct, fmtQty } from '../lib/format';

export default function ExchangeCard({ ex, onSynced }: { ex: ExchangeView; onSynced: () => void }) {
  const [tab, setTab] = useState<'koin' | 'pending'>('koin');
  const [syncing, setSyncing] = useState(false);

  const sync = async () => {
    setSyncing(true);
    try { await api.post(`/exchanges/${ex.id}/sync`); onSynced(); } finally { setSyncing(false); }
  };

  const changePct = ex.profit_harian && ex.saldo_total_idr ? (ex.profit_harian / Math.max(1, ex.saldo_total_idr - ex.profit_harian)) * 100 : 0;
  const coins = ex.coins.filter(c => c.symbol !== ex.quote_asset);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Saldo di {ex.name}</h3>
        <div className="flex items-center gap-2">
          <span className={`badge ${ex.mode === 'live' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            {ex.mode === 'live' ? 'Akun Riil' : 'Demo'}
          </span>
          <span className={`w-2 h-2 rounded-full ${ex.status === 'ok' ? 'bg-emerald-500' : ex.status === 'error' ? 'bg-red-500' : 'bg-gray-400'}`} title={ex.status} />
        </div>
      </div>

      {ex.error && <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-2">⚠️ {ex.error}</div>}

      <div className="flex items-end justify-between">
        <div>
          <div className="text-3xl font-bold">{fmtIDR(ex.saldo_total_idr)}</div>
          <div className={`text-sm mt-1 ${changePct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            ↗ {fmtPct(changePct)} ({fmtSignedIDR(ex.profit_harian)})
          </div>
        </div>
        <div className="text-sm text-gray-500">{ex.posisi_pct.toFixed(1)}% porsi</div>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
        <div className="bg-gray-50 rounded-xl p-3">
          <div className="text-gray-500 text-xs">Profit Harian <span className="float-right">24J</span></div>
          <div className={ex.profit_harian >= 0 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>{fmtSignedIDR(ex.profit_harian)}</div>
        </div>
        <div className="bg-gray-50 rounded-xl p-3">
          <div className="text-gray-500 text-xs">Profit Total <span className="float-right">ALL</span></div>
          <div className={ex.profit_total >= 0 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>{fmtSignedIDR(ex.profit_total)}</div>
        </div>
        <div className="bg-gray-50 rounded-xl p-3">
          <div className="text-gray-500 text-xs">Kas Bebas ({ex.quote_asset})</div>
          <div className="font-semibold">{fmtIDR(ex.kas_bebas_idr)}</div>
        </div>
        <div className="bg-gray-50 rounded-xl p-3">
          <div className="text-gray-500 text-xs">Pending ({ex.pending_count})</div>
          <div className="font-semibold">{fmtIDR(ex.pending_value)}</div>
        </div>
      </div>

      <div className="flex gap-2 mt-4 border-b border-gray-200">
        <button onClick={() => setTab('koin')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === 'koin' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500'}`}>
          Semua Koin ({coins.length})
        </button>
        <button onClick={() => setTab('pending')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === 'pending' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500'}`}>
          Order Pending {ex.pending_count > 0 && <span className="badge bg-orange-100 text-orange-700 ml-1">{ex.pending_count}</span>}
        </button>
      </div>

      <div className="mt-3 max-h-56 overflow-y-auto">
        {tab === 'koin' ? (
          coins.length === 0 ? <div className="text-sm text-gray-400 py-4 text-center">Belum ada koin</div> :
          coins.map(c => (
            <div key={c.symbol} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center text-xs font-bold">{c.symbol.slice(0, 3)}</div>
                <div>
                  <div className="font-medium text-sm">{c.symbol}</div>
                  <div className="text-xs text-gray-400">{c.porsi_pct.toFixed(1)}%</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold text-sm">{fmtIDR(c.value_idr)}</div>
                <div className="text-xs text-gray-400">{fmtQty(c.qty)} {c.symbol}</div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-sm text-gray-400 py-4 text-center">{ex.pending_count === 0 ? 'Tidak ada order pending' : `${ex.pending_count} order pending`}</div>
        )}
      </div>

      <button onClick={sync} disabled={syncing}
        className="w-full mt-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-sm font-medium text-gray-700 transition disabled:opacity-50">
        {syncing ? 'Menyinkronkan…' : '⟳ Kelola / Sinkron Ulang Saldo'}
      </button>
    </div>
  );
}
