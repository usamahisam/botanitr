import { useCallback, useEffect, useState } from 'react';
import { api, Bot, LogRow } from '../lib/api';
import { fmtIDR, fmtSignedIDR, fmtTime } from '../lib/format';
import { getSocket } from '../lib/ws';
import { AreaChart, Area, ResponsiveContainer, YAxis, Tooltip } from 'recharts';

const STRAT_LABEL: Record<string, string> = { grid: 'Grid', dca: 'DCA', scalper: 'Scalper', harvester: 'Harvester' };
const PER_PAGE = 8;

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
  const equityData = equity.map((e, i) => ({ i, equity: e.equity }));
  const equityUp = equity.length > 1 ? equity[equity.length - 1].equity >= equity[0].equity : true;

  return (
    <div className="card !p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-semibold">{bot.name}</div>
          <div className="text-xs text-gray-500">{bot.pair} · {STRAT_LABEL[bot.strategy] || bot.strategy} · {bot.exchange_id}</div>
        </div>
        <span className={`badge ${bot.status === 'running' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>
          {bot.status === 'running' ? '● Running' : '⏸ Paused'}
        </span>
      </div>
      <div className="h-16 mt-2">
        {equityData.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={equityData}>
              <defs>
                <linearGradient id={`eq-${bot.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={equityUp ? '#16a34a' : '#dc2626'} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={equityUp ? '#16a34a' : '#dc2626'} stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Tooltip formatter={(v: any) => fmtIDR(Number(v))} labelFormatter={() => ''} />
              <Area type="monotone" dataKey="equity" stroke={equityUp ? '#16a34a' : '#dc2626'} strokeWidth={2} fill={`url(#eq-${bot.id})`} />
            </AreaChart>
          </ResponsiveContainer>
        ) : <div className="text-xs text-gray-300 flex items-center h-full">Equity curve muncul setelah beberapa jam</div>}
      </div>
      <div className="grid grid-cols-3 gap-2 mt-2 text-center text-xs">
        <div className="bg-gray-50 rounded-lg py-1.5"><div className="text-gray-400">Budget</div><div className="font-semibold">{fmtIDR(bot.current_budget)}</div></div>
        <div className="bg-gray-50 rounded-lg py-1.5"><div className="text-gray-400">Profit</div><div className={`font-semibold ${bot.stats.realized >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtSignedIDR(bot.stats.realized)}</div></div>
        <div className="bg-gray-50 rounded-lg py-1.5"><div className="text-gray-400">Win</div><div className="font-semibold">{winRate.toFixed(0)}%</div></div>
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={() => act(bot.status === 'running' ? 'pause' : 'resume')} disabled={busy}
          className="flex-1 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs font-medium disabled:opacity-50">
          {bot.status === 'running' ? '⏸ Pause' : '▶️ Resume'}
        </button>
        <button onClick={() => act('delete')} disabled={busy}
          className="px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium disabled:opacity-50">🗑</button>
      </div>
    </div>
  );
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
    if (filter === 'trades') return ['TRADE', 'GRID_UNWIND', 'DCA_TP', 'SCALPER_TP', 'SCALPER_SL', 'SCALPER_EXIT', 'INVENTORY_HARVEST_RECYCLE', 'AUTO_COMPOUND'].includes(l.tag);
    return true;
  });

  return (
    <div className="card mt-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold">Log Operasional Mesin Otomatis Live</h3>
        <div className="flex gap-2">
          {(['semua', 'peringatan', 'trades'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-lg text-xs font-medium ${filter === f ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
              {f === 'semua' ? 'Semua' : f === 'peringatan' ? 'Peringatan' : 'Trades'}
            </button>
          ))}
          <button onClick={async () => { if (confirm('Bersihkan semua log?')) { await api.del('/logs'); load(); } }}
            className="px-3 py-1 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200">Bersihkan Log</button>
        </div>
      </div>
      <div className="space-y-1 max-h-96 overflow-y-auto font-mono text-xs">
        {filtered.length === 0 && <div className="text-gray-400 py-6 text-center">Belum ada log</div>}
        {[...filtered].reverse().map(l => (
          <div key={l.id} className="flex gap-3 py-1.5 border-b border-gray-50 items-start">
            <span className="text-gray-400 shrink-0">{fmtTime(l.created_at)}</span>
            <span className={`shrink-0 px-1.5 rounded ${l.tag === 'TRADE' ? 'bg-blue-100 text-blue-700' : l.tag.includes('UNWIND') || l.tag.includes('HARVEST') ? 'bg-emerald-100 text-emerald-700' : l.level === 'error' ? 'bg-red-100 text-red-700' : l.level === 'warn' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>{l.tag}</span>
            <span className="flex-1 text-gray-700">{l.message}</span>
            {l.impact_rp != null && l.impact_rp !== 0 && (
              <span className={`shrink-0 font-semibold ${l.impact_rp >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtSignedIDR(l.impact_rp)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
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
        <h2 className="text-xl font-bold">Bot Trading ({bots.length})</h2>
        <a href="/wizard" className="px-4 py-2 rounded-xl bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600">+ Bot Baru (Wizard)</a>
      </div>

      {bots.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">
          Belum ada bot. <a href="/wizard" className="text-brand-600 font-medium">Buat bot pertama via Wizard AI →</a>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {shown.map(b => <BotCard key={b.id} bot={b} onChanged={load} />)}
          </div>
          <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
            <span>Menampilkan {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, bots.length)} dari {bots.length} bot</span>
            <div className="flex gap-1">
              {Array.from({ length: totalPages }, (_, i) => (
                <button key={i} onClick={() => setPage(i + 1)}
                  className={`w-8 h-8 rounded-lg text-sm font-medium ${page === i + 1 ? 'bg-brand-500 text-white' : 'bg-white border border-gray-200'}`}>{i + 1}</button>
              ))}
            </div>
          </div>
        </>
      )}

      <LogFeed />
    </div>
  );
}
