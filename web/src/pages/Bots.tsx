import { useCallback, useEffect, useState } from 'react';
import { api, Bot, LogRow } from '../lib/api';
import { fmtIDR, fmtSignedIDR, fmtTime } from '../lib/format';
import { getSocket } from '../lib/ws';
import { AreaChart, Area, ResponsiveContainer, YAxis, Tooltip } from 'recharts';
import { Icon } from '../components/icons';

const STRAT_LABEL: Record<string, string> = { grid: 'Grid', dca: 'DCA', scalper: 'Scalper', harvester: 'Harvester' };
const PER_PAGE = 8;

const TRADE_TAGS = ['TRADE', 'GRID_UNWIND', 'DCA_TP', 'SCALPER_TP', 'SCALPER_SL', 'SCALPER_EXIT', 'INVENTORY_HARVEST_RECYCLE', 'AUTO_COMPOUND'];

function BotCard({ bot, onChanged }: { bot: Bot; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [equity, setEquity] = useState<{ date: string; equity: number }[]>([]);
  useEffect(() => {
    api.get<{ date: string; equity: number }[]>(`/bots/${bot.id}/equity?days=30`).then(setEquity).catch(() => {});
  }, [bot.id, bot.current_budget]);
  const act = async (action: string) => {
    setBusy(true);
    try {
      if (action === 'delete') { if (!confirm(`Hapus bot "${bot.name}"?`)) return; await api.del(`/bots/${bot.id}`); }
      else await api.post(`/bots/${bot.id}/${action}`);
      onChanged();
    } finally { setBusy(false); }
  };
  const winRate = bot.stats.total > 0 ? (bot.stats.wins / bot.stats.total) * 100 : 0;
  const running = bot.status === 'running';
  const equityData = equity.map((e, i) => ({ i, equity: e.equity }));
  const equityUp = equity.length > 1 ? equity[equity.length - 1].equity >= equity[0].equity : bot.stats.realized >= 0;
  const line = equityUp ? '#2ebd85' : '#f6465d';

  return (
    <div className="panel p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={running ? 'txt-up' : 'txt-3'}><Icon.dot size={7} /></span>
            <span className="font-semibold text-[14px] truncate">{bot.name}</span>
          </div>
          <div className="num text-xs txt-3 mt-1">{bot.pair} · {STRAT_LABEL[bot.strategy] || bot.strategy} · {bot.exchange_id} · {bot.mode === 'live' ? 'RIIL' : 'DEMO'}</div>
        </div>
        <span className={`tag ${running ? 'tag-up' : 'tag-dim'}`}>{running ? 'JALAN' : 'BERHENTI'}</span>
      </div>

      <div className="h-[64px] mt-3 -mx-1">
        {equityData.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={equityData} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
              <defs>
                <linearGradient id={`eq-${bot.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={line} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={line} stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Tooltip formatter={(v: any) => fmtIDR(Number(v))} labelFormatter={() => ''}
                contentStyle={{ background: '#131a24', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 12 }} />
              <Area type="monotone" dataKey="equity" stroke={line} strokeWidth={1.5} fill={`url(#eq-${bot.id})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-xs txt-3 border border-dashed border-white/10 rounded-md">
            Kurva ekuitas tersedia setelah beberapa jam berjalan
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4 mt-3 pt-3 border-t border-white/[0.06]">
        <div><div className="lbl !text-[10px]">Budget</div><div className="num text-[13px] font-semibold mt-0.5">{fmtIDR(bot.current_budget)}</div></div>
        <div><div className="lbl !text-[10px]">Profit</div><div className={`num text-[13px] font-semibold mt-0.5 ${bot.stats.realized >= 0 ? 'txt-up' : 'txt-down'}`}>{fmtSignedIDR(bot.stats.realized)}</div></div>
        <div><div className="lbl !text-[10px]">Win</div><div className="num text-[13px] font-semibold mt-0.5">{winRate.toFixed(0)}% <span className="txt-3 font-normal">· {bot.stats.trades}</span></div></div>
      </div>

      <div className="flex gap-2 mt-3">
        <button onClick={() => act(running ? 'pause' : 'resume')} disabled={busy} className="btn btn-ghost btn-sm flex-1">
          {running ? <><Icon.pause size={13} /> Jeda</> : <><Icon.play size={13} /> Lanjut</>}
        </button>
        <button onClick={() => act('delete')} disabled={busy} className="btn btn-ghost btn-sm btn-icon !text-[#ff7a8c]" title="Hapus bot">
          <Icon.trash size={14} />
        </button>
      </div>
    </div>
  );
}

function tagClass(l: LogRow): string {
  if (l.tag === 'TRADE') return 'text-[#8ba6ff]';
  if (l.tag.includes('UNWIND') || l.tag.includes('HARVEST') || l.tag.includes('COMPOUND') || l.tag.includes('TP')) return 'txt-up';
  if (l.tag.includes('SL')) return 'txt-down';
  if (l.level === 'error') return 'txt-down';
  if (l.level === 'warn') return 'text-[#f0b90b]';
  return 'txt-3';
}

function LogFeed() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [filter, setFilter] = useState<'semua' | 'peringatan' | 'trades'>('semua');

  const load = useCallback(() => {
    const q = filter === 'peringatan' ? 'level=warn' : filter === 'trades' ? 'tag=trades' : '';
    api.get<LogRow[]>(`/logs?limit=100&${q}`).then(rows => setLogs(rows.reverse()));
  }, [filter]);

  useEffect(() => {
    load();
    const s = getSocket();
    const onLog = (row: LogRow) => setLogs(prev => [...prev.slice(-199), row]);
    s.on('log', onLog);
    return () => { s.off('log', onLog); };
  }, [load]);

  const filtered = logs.filter(l => {
    if (filter === 'peringatan') return l.level === 'warn' || l.level === 'error';
    if (filter === 'trades') return TRADE_TAGS.includes(l.tag);
    return true;
  });

  return (
    <section className="panel mt-4">
      <div className="panel-head !py-2.5">
        <div className="flex items-center gap-2">
          <span className="txt-up"><Icon.dot size={7} /></span>
          <span className="text-[13px] font-semibold">Log operasional</span>
          <span className="tag tag-dim">REALTIME</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="seg">
            {(['semua', 'peringatan', 'trades'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} className={filter === f ? 'on' : ''}>
                {f === 'semua' ? 'Semua' : f === 'peringatan' ? 'Peringatan' : 'Order'}
              </button>
            ))}
          </div>
          <button onClick={async () => { if (confirm('Hapus seluruh log?')) { await api.del('/logs'); load(); } }}
            className="btn btn-ghost btn-sm">Bersihkan</button>
        </div>
      </div>
      <div className="max-h-[380px] overflow-y-auto px-4 py-2 font-mono text-[12px] leading-relaxed" style={{ background: '#0a0f16' }}>
        {filtered.length === 0 && <div className="txt-3 py-8 text-center font-sans">Belum ada log.</div>}
        {[...filtered].reverse().map(l => (
          <div key={l.id} className="flex gap-3 py-[5px] border-b border-white/[0.04] items-baseline">
            <span className="txt-3 shrink-0 num">{fmtTime(l.created_at)}</span>
            <span className={`shrink-0 font-semibold ${tagClass(l)}`}>[{l.tag}]</span>
            <span className="flex-1 txt-2 break-words">{l.message}</span>
            {l.impact_rp != null && l.impact_rp !== 0 && (
              <span className={`shrink-0 num font-semibold ${l.impact_rp >= 0 ? 'txt-up' : 'txt-down'}`}>{fmtSignedIDR(l.impact_rp)}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Bots() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    api.get<Bot[]>('/bots').then(b => setBots(b.filter(x => x.status !== 'stopped')));
  }, []);

  useEffect(() => {
    load();
    const s = getSocket();
    s.on('bot', load);
    const t = setInterval(load, 20000);
    return () => { s.off('bot', load); clearInterval(t); };
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(bots.length / PER_PAGE));
  const shown = bots.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-[17px] font-bold tracking-tight">Bot</h2>
          <p className="text-xs txt-3 mt-0.5">{bots.length} bot terdaftar · {bots.filter(b => b.status === 'running').length} berjalan</p>
        </div>
        <a href="/wizard" className="btn btn-primary btn-sm"><Icon.plus size={14} /> Bot baru</a>
      </div>

      {bots.length === 0 ? (
        <div className="panel p-10 text-center">
          <p className="txt-2 text-sm">Belum ada bot yang berjalan.</p>
          <a href="/wizard" className="btn btn-primary btn-sm mt-4">Buat bot pertama</a>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {shown.map(b => <BotCard key={b.id} bot={b} onChanged={load} />)}
          </div>
          <div className="flex items-center justify-between mt-3 text-xs txt-3">
            <span className="num">{(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, bots.length)} dari {bots.length}</span>
            <div className="flex gap-1">
              {Array.from({ length: totalPages }, (_, i) => (
                <button key={i} onClick={() => setPage(i + 1)}
                  className={`w-7 h-7 rounded-md text-xs num font-medium border ${page === i + 1 ? 'bg-[#4f7cff] border-[#4f7cff] text-white' : 'border-white/10 txt-3 hover:text-white'}`}>{i + 1}</button>
              ))}
            </div>
          </div>
        </>
      )}

      <LogFeed />
    </div>
  );
}
