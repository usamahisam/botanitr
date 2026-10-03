import { useCallback, useEffect, useState } from 'react';
import { api, DashboardData, MarketRow } from '../lib/api';
import { fmtIDR, fmtSignedIDR, fmtPct, fmtNum } from '../lib/format';
import { getSocket } from '../lib/ws';
import ExchangeCard from '../components/ExchangeCard';
import QuickTradeModal from '../components/QuickTradeModal';
import { Icon } from '../components/icons';

function Tape() {
  const [rows, setRows] = useState<MarketRow[]>([]);
  useEffect(() => {
    api.get<MarketRow[]>('/market').then(setRows).catch(() => {});
    const t = setInterval(() => api.get<MarketRow[]>('/market').then(setRows).catch(() => {}), 60000);
    return () => clearInterval(t);
  }, []);
  if (rows.length === 0) return null;
  const items = [...rows, ...rows];
  return (
    <div className="overflow-hidden border-b border-white/[0.07] bg-[#0c1118]">
      <div className="tape-track py-1.5">
        {items.map((r, i) => {
          const mid = (r.high + r.low) / 2;
          const up = mid > 0 ? r.last >= mid : true;
          return (
            <span key={i} className="flex items-center gap-2 px-4 text-xs whitespace-nowrap border-r border-white/[0.05]">
              <span className="font-bold tracking-wide">{r.symbol}</span>
              <span className={`num ${up ? 'txt-up' : 'txt-down'}`}>{fmtNum(r.last, r.last < 1000 ? 2 : 0)}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [showQuick, setShowQuick] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    api.get<DashboardData>('/dashboard').then(d => { setData(d); setErr(''); }).catch(e => setErr(e.message));
  }, []);

  useEffect(() => {
    load();
    const s = getSocket();
    const onBalances = () => load();
    s.on('balances', onBalances);
    const t = setInterval(load, 30000);
    return () => { s.off('balances', onBalances); clearInterval(t); };
  }, [load]);

  if (err) return <div className="panel p-5 txt-down text-sm">Koneksi gagal: {err}</div>;
  if (!data) return <div className="txt-3 text-sm">Memuat data…</div>;

  const p = data.portfolio;
  const r = data.realized;
  const up = p.change_24h_pct >= 0;

  const killswitch = async () => {
    if (!confirm('Mode darurat akan menghentikan semua bot dan membatalkan semua order terbuka di akun riil.\n\nLanjutkan?')) return;
    try {
      const res: any = await api.post('/killswitch');
      const total = Object.values(res.orders_cancelled || {}).reduce((s: number, n: any) => s + Number(n), 0);
      alert(`Mode darurat aktif.\n${res.bots_paused} bot dihentikan · ${total} order dibatalkan${res.errors?.length ? `\n${res.errors.join('; ')}` : ''}`);
      load();
    } catch (e: any) { alert(e.message); }
  };

  return (
    <div className="space-y-4">
      <Tape />

      {/* Hero portofolio */}
      <section className="panel px-5 py-4 flex items-center gap-6 flex-wrap">
        <div className="min-w-0">
          <div className="lbl">Total portofolio · IDR</div>
          <div className="num text-[34px] leading-tight font-semibold tracking-tight">{fmtIDR(p.total_idr)}</div>
          <div className={`num text-[13px] font-medium flex items-center gap-1.5 mt-0.5 ${up ? 'txt-up' : 'txt-down'}`}>
            {up ? <Icon.up size={14} /> : <Icon.down size={14} />}
            {fmtPct(p.change_24h_pct)} · {fmtSignedIDR(p.change_24h_idr)}
            <span className="txt-3 font-normal">/ 24J</span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-6 text-right">
          <div>
            <div className="lbl">USDT / IDR</div>
            <div className="num text-[15px] font-semibold mt-1">{fmtIDR(p.usdt_idr)}</div>
          </div>
          <div className="w-px h-10 bg-white/[0.07]" />
          <div>
            <div className="lbl">Win rate</div>
            <div className="num text-[15px] font-semibold mt-1">{r.total > 0 ? `${((r.wins / r.total) * 100).toFixed(1)}%` : '—'} <span className="txt-3 font-normal text-xs">({r.wins}/{r.total})</span></div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data.exchanges.map(ex => <ExchangeCard key={ex.id} ex={ex} onSynced={load} />)}
        </div>

        <div className="space-y-4">
          <section className="panel">
            <div className="panel-head"><span className="lbl">Kinerja terealisasi</span></div>
            <div className="px-4 py-3">
              <div className={`num text-[26px] font-semibold ${r.total_idr >= 0 ? 'txt-up' : 'txt-down'}`}>{fmtSignedIDR(r.total_idr)}</div>
              <div className="mt-3 space-y-2 text-[13px]">
                <div className="flex justify-between"><span className="txt-2">Hari ini</span><span className={`num font-medium ${r.today_idr >= 0 ? 'txt-up' : 'txt-down'}`}>{fmtSignedIDR(r.today_idr)}</span></div>
                {data.exchanges.map(ex => (
                  <div key={ex.id} className="flex justify-between border-t border-white/[0.05] pt-2">
                    <span className="txt-2">{ex.name}</span>
                    <span className={`num font-medium ${ex.profit_total >= 0 ? 'txt-up' : 'txt-down'}`}>{fmtSignedIDR(ex.profit_total)}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setShowQuick(true)} className="btn btn-primary !py-3">
              <Icon.zap size={15} /> Order cepat
            </button>
            <button onClick={killswitch} className="btn btn-danger !py-3">
              <Icon.power size={15} /> Mode darurat
            </button>
          </div>
          <p className="text-[11px] txt-3 leading-relaxed px-1">
            Mode darurat menghentikan seluruh bot dan membatalkan order terbuka pada akun riil.
          </p>
        </div>
      </div>

      {showQuick && <QuickTradeModal onClose={() => setShowQuick(false)} onDone={load} />}
    </div>
  );
}
