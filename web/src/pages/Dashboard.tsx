import { useCallback, useEffect, useState } from 'react';
import { api, DashboardData } from '../lib/api';
import { fmtIDR, fmtSignedIDR, fmtPct } from '../lib/format';
import { getSocket } from '../lib/ws';
import ExchangeCard from '../components/ExchangeCard';
import QuickTradeModal from '../components/QuickTradeModal';

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [showQuick, setShowQuick] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    api.get<DashboardData>('/dashboard').then(setData).catch(e => setErr(e.message));
  }, []);

  useEffect(() => {
    load();
    const s = getSocket();
    const onBalances = () => load();
    s.on('balances', onBalances);
    const t = setInterval(load, 30000);
    return () => { s.off('balances', onBalances); clearInterval(t); };
  }, [load]);

  if (err) return <div className="card text-red-600">⚠️ {err}</div>;
  if (!data) return <div className="text-gray-400">Memuat dashboard…</div>;

  const p = data.portfolio;
  const r = data.realized;

  return (
    <div className="space-y-5">
      {/* Total Portfolio */}
      <div className="card flex items-center justify-between">
        <div>
          <div className="text-sm text-gray-500 uppercase tracking-wide">Total Portfolio (IDR)</div>
          <div className="text-4xl font-bold mt-1">{fmtIDR(p.total_idr)}</div>
          <div className={`mt-1 ${p.change_24h_pct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            ↗ {fmtPct(p.change_24h_pct)} ({fmtSignedIDR(p.change_24h_idr)}) <span className="text-gray-400 text-sm">24J</span>
          </div>
        </div>
        <div className="text-right text-sm text-gray-500">
          <div>Kurs USDT/IDR</div>
          <div className="font-semibold text-gray-700">{fmtIDR(p.usdt_idr)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Kartu exchange */}
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-5">
          {data.exchanges.map(ex => <ExchangeCard key={ex.id} ex={ex} onSynced={load} />)}
        </div>

        {/* Panel kanan */}
        <div className="space-y-5">
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Realized Profit & Win Rate</h3>
            <div className="text-3xl font-bold text-emerald-600">{fmtSignedIDR(r.total_idr)}</div>
            <div className="text-sm text-gray-500 mt-1">Win Rate ({r.wins}/{r.total}) — {fmtPct(r.rate * 100, 1)}</div>
            <div className="mt-4 pt-4 border-t border-gray-100 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Profit Hari Ini</span><span className="font-semibold text-emerald-600">{fmtSignedIDR(r.today_idr)}</span></div>
            </div>
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="text-xs text-gray-400 mb-2">Profit Per Exchange</div>
              {data.exchanges.map(ex => (
                <div key={ex.id} className="flex justify-between text-sm py-1">
                  <span className="text-gray-600">{ex.name}</span>
                  <span className={`font-medium ${ex.profit_total >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtSignedIDR(ex.profit_total)}</span>
                </div>
              ))}
            </div>
          </div>

          <button onClick={() => setShowQuick(true)}
            className="w-full py-3.5 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-lg shadow-lg shadow-brand-500/20 transition">
            ⚡ Quick Trade
          </button>

          <button onClick={async () => {
              if (!confirm('🚨 KILL SWITCH akan ME-PAUSE semua bot & MEMBATALKAN semua open order live.\n\nLanjutkan?')) return;
              try {
                const r: any = await api.post('/killswitch');
                const total = Object.values(r.orders_cancelled || {}).reduce((s: number, n: any) => s + Number(n), 0);
                alert(`🚨 Kill switch aktif!\n${r.bots_paused} bot di-pause\n${total} open order dibatalkan${r.errors?.length ? `\n⚠️ ${r.errors.join('; ')}` : ''}`);
                load();
              } catch (e: any) { alert(`❌ ${e.message}`); }
            }}
            className="w-full py-3 rounded-2xl bg-red-500 hover:bg-red-600 text-white font-bold shadow-lg shadow-red-500/20 transition">
            🚨 Kill Switch (Darurat)
          </button>
        </div>
      </div>

      {showQuick && <QuickTradeModal onClose={() => setShowQuick(false)} onDone={load} />}
    </div>
  );
}
