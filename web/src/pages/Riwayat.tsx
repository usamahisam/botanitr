import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, download, TradeRow } from '../lib/api'
import { EXCHANGES } from '../lib/exchanges';
import { fmtQty, fmtDateTime, fmtMoney, fmtSignedMoney, quoteOfPair } from '../lib/format';

interface BotSummary { bot: { id: number; name: string; pair: string; strategy: string; mode: string }; buys: number; sells: number; realized: number; trades: number }

export default function Riwayat() {
  const [params] = useSearchParams();
  const botId = params.get('bot_id') || '';
  const [rows, setRows] = useState<TradeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [exchange, setExchange] = useState('');
  const [mode, setMode] = useState('');
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState<BotSummary | null>(null);
  const LIMIT = 25;

  const load = useCallback(() => {
    const q = new URLSearchParams({ limit: String(LIMIT), offset: String((page - 1) * LIMIT) });
    if (exchange) q.set('exchange', exchange);
    if (mode) q.set('mode', mode);
    if (botId) q.set('bot_id', botId);
    api.get<{ total: number; rows: TradeRow[] }>(`/trades?${q}`).then(d => { setRows(d.rows); setTotal(d.total); });
  }, [exchange, mode, page, botId]);

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
            <Link to="/riwayat" className="btn btn-ghost btn-sm">Semua bot</Link>
          </div>
        </div>
      )}
      <div className="panel-head !flex-wrap gap-y-2">
        <div>
          <span className="text-[14px] font-semibold">Riwayat transaksi</span>
          <span className="num text-xs txt-3 ml-2">{total} baris{botId ? ' · bot ini' : ''}</span>
        </div>
        <div className="flex gap-2 flex-wrap">
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
              const q = new URLSearchParams({ ...(exchange ? { exchange } : {}), ...(mode ? { mode } : {}), ...(botId ? { bot_id: botId } : {}) }).toString();
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
