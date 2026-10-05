import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, MarketPreset } from '../lib/api'
import { Icon } from '../components/icons';

const STRAT_LABEL: Record<string, string> = { grid: 'Grid', dca: 'DCA', scalper: 'Scalper', harvester: 'Harvester', rebalance: 'Rebalance', revert: 'Revert', bollinger: 'Bollinger', breakout: 'Breakout', dynamic: 'Dynamic' };

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
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    api.get<MarketPreset[]>(`/marketplace${search ? `?search=${encodeURIComponent(search)}` : ''}`).then(setPresets).catch(() => {});
  }, [search]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const rate = async (p: MarketPreset, stars: number) => {
    try {
      await api.post(`/marketplace/${p.id}/rate`, { stars });
      load();
    } catch (e: any) { setMsg(e.message); }
  };

  const totalRunning = presets.reduce((s, p) => s + (p.bots_running || 0), 0);
  const totalBots = presets.reduce((s, p) => s + (p.bots_total || 0), 0);

  return (
    <div className="max-w-[1000px]">
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h2 className="text-[17px] font-bold tracking-tight">Marketplace strategi</h2>
          <p className="text-xs txt-3 mt-0.5">
            Preset siap pakai dari sistem & komunitas. Bot dibuat lewat Wizard (mode Demo/Riil di langkah awal).
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari preset…" className="input !w-full sm:!w-48" />
        </div>
      </div>

      <div className="panel px-4 py-3 mb-4 flex items-center gap-5 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="txt-up"><Icon.dot size={7} /></span>
          <span className="num text-[15px] font-semibold">{totalRunning}</span>
          <span className="text-xs txt-2">bot berjalan</span>
        </div>
        <div className="w-px h-6 bg-white/[0.07]" />
        <div className="flex items-center gap-2">
          <Icon.cpu size={15} className="txt-3" />
          <span className="num text-[15px] font-semibold">{totalBots}</span>
          <span className="text-xs txt-2">total bot dari preset</span>
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
                <div className="flex items-center gap-2">
                  {(p.bots_running || 0) > 0 ? (
                    <span className="tag tag-up">
                      <Icon.dot size={6} /> {p.bots_running} berjalan
                      {p.bots_total > p.bots_running ? ` · ${p.bots_total - p.bots_running} jeda` : ''}
                    </span>
                  ) : (p.bots_total || 0) > 0 ? (
                    <span className="tag tag-dim">{p.bots_total} dijeda</span>
                  ) : (
                    <span className="text-xs txt-3">Belum dipakai</span>
                  )}
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
