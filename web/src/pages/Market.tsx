import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, MarketPreset, PairRow } from '../lib/api'
import { EXCHANGES } from '../lib/exchanges';
import { Icon } from '../components/icons';

const STRAT_LABEL: Record<string, string> = { grid: 'Grid', dca: 'DCA', scalper: 'Scalper', harvester: 'Harvester', rebalance: 'Rebalance' };

function Stars({ value, onRate }: { value: number; onRate?: (s: number) => void }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(s => (
        <button key={s} disabled={!onRate} onClick={() => onRate?.(s)}
          className={`${onRate ? 'cursor-pointer hover:scale-110' : 'cursor-default'} ${s <= Math.round(value) ? 'text-[#f0b90b]' : 'txt-3'}`}
          title={`${s} bintang`}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />
          </svg>
        </button>
      ))}
    </span>
  );
}

export default function Market() {
  const navigate = useNavigate();
  const [presets, setPresets] = useState<MarketPreset[]>([]);
  const [search, setSearch] = useState('');
  const [exchange, setExchange] = useState('indodax');
  const [pairs, setPairs] = useState<PairRow[]>([]);
  const [pair, setPair] = useState('XRPIDR');
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    api.get<MarketPreset[]>(`/marketplace${search ? `?search=${encodeURIComponent(search)}` : ''}`).then(setPresets).catch(() => {});
  }, [search]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    api.get<PairRow[]>(`/pairs?exchange=${exchange}`).then(p => { setPairs(p); if (p.length) setPair(p[0].symbol); }).catch(() => {});
  }, [exchange]);

  const install = async (p: MarketPreset) => {
    setMsg('');
    try {
      const bot: any = await api.post('/marketplace/' + p.id + '/install', { exchange_id: exchange, pair, budget_quote: p.budget_quote, status: 'paused' });
      setMsg(`Preset "${p.name}" terpasang sebagai bot #${bot.id} (${pair}, dijeda — periksa dulu di halaman Bot).`);
    } catch (e: any) { setMsg(e.message); }
  };

  const rate = async (p: MarketPreset, stars: number) => {
    try {
      await api.post(`/marketplace/${p.id}/rate`, { stars });
      load();
    } catch (e: any) { setMsg(e.message); }
  };

  return (
    <div className="max-w-[1000px]">
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h2 className="text-[17px] font-bold tracking-tight">Marketplace strategi</h2>
          <p className="text-xs txt-3 mt-0.5">Preset siap pakai dari sistem & komunitas. Instalasi selalu dimulai dalam keadaan dijeda.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari preset…" className="input !w-full sm:!w-48" />
          <select value={exchange} onChange={e => setExchange(e.target.value)} className="input !w-auto">
            {EXCHANGES.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
          <select value={pair} onChange={e => setPair(e.target.value)} className="input !w-auto num">
            {pairs.map(p => <option key={p.symbol} value={p.symbol}>{p.symbol}</option>)}
          </select>
        </div>
      </div>

      {msg && <div className="text-[13px] txt-2 border border-white/10 rounded-md px-3 py-2.5 mb-4">{msg}</div>}

      {presets.length === 0 ? (
        <div className="panel p-10 text-center txt-3 text-sm">Belum ada preset yang cocok.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {presets.map(p => (
            <div key={p.id} className="panel p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-[14px]">{p.name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="tag tag-dim">{STRAT_LABEL[p.strategy] || p.strategy}</span>
                    {p.user_id === 0 && <span className="tag tag-accent">SISTEM</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <Stars value={p.rating} onRate={s => rate(p, s)} />
                  <div className="text-[11px] txt-3 mt-0.5 num">{p.rating.toFixed(1)} · {p.ratings} nilai · {p.installs} instal</div>
                </div>
              </div>
              {p.description && <p className="text-xs txt-2 mt-2 leading-relaxed">{p.description}</p>}
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.06]">
                <span className="text-xs txt-3 num">Budget saran {Number(p.budget_quote).toLocaleString('id-ID')}</span>
                <div className="flex gap-2">
                  <button onClick={() => install(p)} className="btn btn-primary btn-sm">
                    <Icon.plus size={13} /> Instal ke {exchange}
                  </button>
                  <button onClick={() => navigate('/bots')} className="btn btn-ghost btn-sm">Lihat bot</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
