import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, download, TradeRow, Bot } from '../lib/api'
import { EXCHANGES } from '../lib/exchanges';
import { fmtQty, fmtDateTime, fmtMoney, fmtSignedMoney, quoteOfPair } from '../lib/format';

interface BotSummary {
  bot: { id: number; name: string; pair: string; strategy: string; mode: string };
  buys: number; sells: number; realized: number; trades: number;
  drift: { recorded: number; actual: number; pct: number } | null;
  sellDist: { pctAway: number; label: string } | null;
}

export default function Riwayat({ admin = false }: { admin?: boolean }) {
  const [params, setParams] = useSearchParams();
  const botId = params.get('bot_id') || '';
  const [rows, setRows] = useState<TradeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [exchange, setExchange] = useState('');
  const [mode, setMode] = useState('');
  const [allUsers, setAllUsers] = useState(false);
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState<BotSummary | null>(null);
  const [bots, setBots] = useState<Bot[]>([]);
  const LIMIT = 25;

  // Daftar bot untuk dropdown (sinkron dengan ?bot_id= dari tombol Riwayat)
  useEffect(() => {
    api.get<Bot[]>(`/bots${admin && allUsers ? '?all=1' : ''}`).then(setBots).catch(() => {});
  }, [admin, allUsers]);

  const pickBot = (v: string) => {
    setPage(1);
    if (v) params.set('bot_id', v);
    else params.delete('bot_id');
    setParams(params);
  };

  const load = useCallback(() => {
    const q = new URLSearchParams({ limit: String(LIMIT), offset: String((page - 1) * LIMIT) });
    if (exchange) q.set('exchange', exchange);
    if (mode) q.set('mode', mode);
    if (botId) q.set('bot_id', botId);
    if (admin && allUsers) q.set('all', '1');
    api.get<{ total: number; rows: TradeRow[] }>(`/trades?${q}`).then(d => { setRows(d.rows); setTotal(d.total); });
  }, [exchange, mode, page, botId, admin, allUsers]);

  useEffect(() => {
    if (botId) api.get<BotSummary>(`/bots/${botId}/summary`).then(setSummary).catch(() => setSummary(null));
    else setSummary(null);
  }, [botId]);

  useEffect(load, [load]);
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <section className="panel">
      {summary && (
        <div className="panel px-4 py-3 mb-3 flex items-center gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="font-semibold text-[14px]">{summary.bot.name}</div>
            <div className="text-xs txt-3 num mt-0.5">{summary.bot.pair} · {summary.bot.strategy} · {summary.bot.mode === 'live' ? 'Riil' : 'Demo'}</div>
          </div>
          <div className="flex items-center gap-4 text-xs ml-auto">
            <span className="txt-2">Beli <b className="num txt-up">{summary.buys}</b></span>
            <span className="txt-2">Jual <b className="num txt-down">{summary.sells}</b></span>
            <span className="txt-2">PnL <b className={`num ${summary.realized >= 0 ? 'txt-up' : 'txt-down'}`}>{fmtSignedMoney(summary.realized, quoteOfPair(summary.bot.pair))}</b></span>
            {summary.sellDist && (
              <span className="txt-2" title="Kenaikan harga yang ditunggu hingga posisi terjual">Target <b className="num">{summary.sellDist.pctAway >= 0 ? '+' : ''}{summary.sellDist.pctAway.toFixed(2)}%</b> <span className="txt-3">{summary.sellDist.label}</span></span>
            )}
            <Link to="/riwayat" className="btn btn-ghost btn-sm">Semua bot</Link>
          </div>
        </div>
      )}
      {summary?.drift && (
        <div className="rounded-md border border-[rgba(240,185,11,0.4)] bg-[rgba(240,185,11,0.07)] px-4 py-3 mb-3 text-[12px] flex items-center gap-3 flex-wrap">
          <span className="txt-2">
            Catatan bot ({summary.drift.recorded.toFixed(6)}) ≠ saldo exchange ({summary.drift.actual.toFixed(6)}) — drift {summary.drift.pct.toFixed(1)}%.
            Kemungkinan order manual/partial fill.
          </span>
          <button
            onClick={async () => {
              if (!confirm(`Sesuaikan catatan bot ke saldo exchange (${summary.drift!.actual.toFixed(6)})?`)) return;
              try {
                const r: any = await api.post(`/bots/${summary.bot.id}/reconcile`, {});
                alert(r.adjusted ? `Disesuaikan: ${r.recorded.toFixed(6)} → ${r.actual.toFixed(6)}` : (r.message || 'Tidak ada drift'));
                api.get<BotSummary>(`/bots/${summary.bot.id}/summary`).then(s => setSummary(s)).catch(() => {});
                load();
              } catch (e: any) { alert(e.message || 'Gagal'); }
            }}
            className="btn btn-ghost btn-sm shrink-0">Sesuaikan</button>
        </div>
      )}
      <div className="panel-head !flex-wrap gap-y-2">
        <div>
          <span className="text-[14px] font-semibold">Riwayat transaksi</span>
          <span className="num text-xs txt-3 ml-2">{total} baris{botId ? ' · bot ini' : ''}</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          {admin && (
            <label className="flex items-center gap-2 text-xs txt-2 cursor-pointer self-center">
              <input type="checkbox" checked={allUsers} onChange={e => { setAllUsers(e.target.checked); setPage(1); }} className="accent-[#4f7cff] w-4 h-4" />
              Semua user
            </label>
          )}
          <select value={botId} onChange={e => pickBot(e.target.value)} className="input !w-auto !py-1.5 text-xs" aria-label="Filter bot">
            <option value="">Semua bot</option>
            {bots.map(b => (
              <option key={b.id} value={b.id}>
                #{b.id} {b.name}{b.status === 'running' ? ' · jalan' : b.status === 'paused' ? ' · jeda' : ''}
              </option>
            ))}
          </select>
          <select value={exchange} onChange={e => { setExchange(e.target.value); setPage(1); }} className="input !w-auto !py-1.5 text-xs">
            <option value="">Semua exchange</option>
            {EXCHANGES.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
          <select value={mode} onChange={e => { setMode(e.target.value); setPage(1); }} className="input !w-auto !py-1.5 text-xs">
            <option value="">Semua mode</option>
            <option value="paper">Demo</option>
            <option value="live">Riil</option>
          </select>
          <button
            onClick={() => {
              const q = new URLSearchParams({ ...(exchange ? { exchange } : {}), ...(mode ? { mode } : {}), ...(botId ? { bot_id: botId } : {}), ...(admin && allUsers ? { all: '1' } : {}) }).toString();
              download(`/trades/export${q ? `?${q}` : ''}`, `trades-${new Date().toISOString().slice(0, 10)}.csv`).catch(e => alert(e.message));
            }}
            className="btn btn-ghost btn-sm">
            Ekspor CSV
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="tbl num">
          <thead>
            <tr>
              <th>Waktu</th><th>Bot</th><th>Pair</th><th>Sisi</th>
              <th className="!text-right">Harga</th><th className="!text-right">Qty</th>
              <th className="!text-right">Nilai</th><th className="!text-right">Fee</th><th className="!text-right">PnL</th>
              <th>Mode</th><th>Sumber</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={11} className="!text-center txt-3 !py-8 font-sans">Belum ada transaksi.</td></tr>}
            {rows.map(t => (
              <tr key={t.id}>
                <td className="txt-3 whitespace-nowrap !text-[12px]">{fmtDateTime(t.created_at)}</td>
                <td className="text-xs font-sans max-w-[140px] truncate" title={t.bot_name || (t.bot_id ? `#${t.bot_id}` : '')}>{t.bot_name || (t.bot_id ? `#${t.bot_id}` : '—')}</td>
                <td><span className="font-semibold font-sans">{t.pair}</span> <span className="txt-3 text-[11px] font-sans">{t.exchange_id}{t.username ? ` · ${t.username}` : ''}</span></td>
                <td><span className={`text-[12px] font-bold tracking-wide ${t.side === 'buy' ? 'txt-up' : 'txt-down'}`}>{t.side === 'buy' ? 'BELI' : 'JUAL'}</span></td>
                <td className="!text-right">{fmtMoney(t.price, quoteOfPair(t.pair))}</td>
                <td className="!text-right txt-2">{fmtQty(t.qty)}</td>
                <td className="!text-right">{fmtMoney(t.value, quoteOfPair(t.pair))}</td>
                <td className="!text-right txt-3">{fmtMoney(t.fee, quoteOfPair(t.pair))}</td>
                <td className={`!text-right font-semibold ${t.realized_pnl > 0 ? 'txt-up' : t.realized_pnl < 0 ? 'txt-down' : 'txt-3'}`}>
                  {t.realized_pnl !== 0 ? fmtSignedMoney(t.realized_pnl, quoteOfPair(t.pair)) : '—'}
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
