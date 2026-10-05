import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, PairRow, Preset } from '../lib/api';
import { Icon } from '../components/icons';
import { AreaChart, Area, ResponsiveContainer, YAxis, Tooltip } from 'recharts';

interface BtResult {
  winRate: number; profitPct: number; trades: number; maxDrawdownPct: number;
  equity: { t: number; v: number }[]; candles: number; note?: string;
}

function BacktestPanel({ exchange, pair, strategy, params, budget }: {
  exchange: string; pair: string; strategy: string; params: Record<string, any>; budget: number;
}) {
  const [days, setDays] = useState(14);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BtResult | null>(null);
  const [err, setErr] = useState('');

  const run = async () => {
    setLoading(true); setErr(''); setResult(null);
    try {
      const r = await api.post<BtResult>('/backtest', { exchange_id: exchange, pair, strategy, params, days, budget });
      setResult(r);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  };

  const up = (result?.profitPct ?? 0) >= 0;
  return (
    <div className="mt-4 border-t border-white/[0.07] pt-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="lbl">Uji backtest · {pair}</span>
        <div className="flex items-center gap-2">
          <div className="seg">
            {[7, 14, 30].map(d => (
              <button key={d} onClick={() => setDays(d)} className={days === d ? 'on' : ''}>{d} hari</button>
            ))}
          </div>
          <button onClick={run} disabled={loading} className="btn btn-ghost btn-sm">
            {loading ? 'Menguji…' : 'Jalankan uji'}
          </button>
        </div>
      </div>
      {err && <div className="text-[13px] txt-down mt-2">{err}</div>}
      {result && (
        <div className="mt-3">
          {result.note && <div className="text-xs txt-3 mb-2">{result.note}</div>}
          <div className="h-[140px]">
            {result.equity.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={result.equity.map((e, i) => ({ i, v: e.v }))} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
                  <defs>
                    <linearGradient id="bt-eq" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={up ? '#2ebd85' : '#f6465d'} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={up ? '#2ebd85' : '#f6465d'} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <YAxis hide domain={['dataMin', 'dataMax']} />
                  <Tooltip formatter={(v: any) => Number(v).toLocaleString('id-ID')} labelFormatter={() => ''}
                    contentStyle={{ background: '#131a24', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 12 }} />
                  <Area type="monotone" dataKey="v" stroke={up ? '#2ebd85' : '#f6465d'} strokeWidth={1.5} fill="url(#bt-eq)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <div className="h-full flex items-center justify-center text-xs txt-3 border border-dashed border-white/10 rounded-md">Data candle kurang untuk rentang ini.</div>}
          </div>
          <div className="grid grid-cols-4 gap-px bg-white/[0.06] border border-white/[0.06] rounded-md overflow-hidden mt-3">
            {[
              { l: 'Return', v: `${result.profitPct >= 0 ? '+' : ''}${result.profitPct.toFixed(2)}%`, up: result.profitPct >= 0 },
              { l: 'Win rate', v: `${result.winRate.toFixed(1)}%`, up: result.winRate >= 50 },
              { l: 'Trade', v: String(result.trades), up: undefined },
              { l: 'Max DD', v: `${result.maxDrawdownPct.toFixed(1)}%`, up: result.maxDrawdownPct < 10 }
            ].map((s, i) => (
              <div key={i} className="bg-[#0f151d] px-3 py-2">
                <div className="lbl !text-[10px]">{s.l}</div>
                <div className={`num text-[13px] font-semibold mt-0.5 ${s.up === undefined ? '' : s.up ? 'txt-up' : 'txt-down'}`}>{s.v}</div>
              </div>
            ))}
          </div>
          <div className="text-[11px] txt-3 mt-1.5 num">{result.candles} candle · hasil simulasi, bukan jaminan performa.</div>
        </div>
      )}
    </div>
  );
}

const PARAM_FIELDS: Record<string, { key: string; label: string; hint?: string }[]> = {
  grid: [
    { key: 'lower_pct', label: 'Batas bawah (%)' }, { key: 'upper_pct', label: 'Batas atas (%)' }, { key: 'levels', label: 'Jumlah level' }
  ],
  dca: [
    { key: 'drop_pct', label: 'Beli tiap turun (%)' }, { key: 'take_profit_pct', label: 'Target profit (%)' }, { key: 'max_buys', label: 'Maks pembelian' }
  ],
  scalper: [
    { key: 'ema_fast', label: 'EMA cepat' }, { key: 'ema_slow', label: 'EMA lambat' },
    { key: 'rsi_period', label: 'Periode RSI' }, { key: 'rsi_overbought', label: 'RSI overbought' },
    { key: 'tp_pct', label: 'Take profit (%)' }, { key: 'sl_pct', label: 'Stop loss (%)' },
    { key: 'trailing_pct', label: 'Trailing stop (%)', hint: '0 = nonaktif' }
  ],
  harvester: [
    { key: 'drop_pct', label: 'Akumulasi tiap turun (%)' }, { key: 'harvest_pct', label: 'Target panen (%)' }, { key: 'max_buys', label: 'Maks akumulasi' }
  ],
  rebalance: [
    { key: 'threshold_pct', label: 'Threshold deviasi (%)' }, { key: 'interval_min', label: 'Cek tiap (menit)' }, { key: 'max_trade_quote', label: 'Maks nominal per order' }
  ]
};

const STEPS = ['Rekomendasi', 'Parameter', 'Aktivasi'];

export default function Wizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [exchange, setExchange] = useState('indodax');
  const [pairs, setPairs] = useState<PairRow[]>([]);
  const [pair, setPair] = useState('XRPIDR');
  const [budget, setBudget] = useState(100000);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [selected, setSelected] = useState<Preset | null>(null);
  const [params, setParams] = useState<Record<string, any>>({});
  const [botName, setBotName] = useState('');
  const [mode, setMode] = useState<'paper' | 'live'>('paper');
  const [compound, setCompound] = useState(100);
  const [maxDailyLoss, setMaxDailyLoss] = useState(0);
  const [confirmedLive, setConfirmedLive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<PairRow[]>(`/pairs?exchange=${exchange}`).then(p => {
      setPairs(p);
      if (p.length) setPair(p[0].symbol);
    });
  }, [exchange]);

  const analyze = async () => {
    setLoadingPresets(true); setError(''); setPresets([]); setSelected(null);
    try {
      const data = await api.get<Preset[]>(`/wizard/presets?exchange=${exchange}&pair=${pair}&budget=${budget}`);
      setPresets(data);
    } catch (e: any) { setError(e.message); }
    finally { setLoadingPresets(false); }
  };

  const pickPreset = (p: Preset) => {
    setSelected(p);
    setParams({ ...p.params });
    setBotName(`${p.nama} ${pair.replace(/IDR|USDT/, '')}`);
  };

  const activate = async () => {
    if (!selected) return;
    setSubmitting(true); setError('');
    try {
      await api.post('/bots', {
        name: botName, exchange_id: exchange, pair, strategy: selected.strategi,
        params, budget_idr: budget, auto_compound_pct: compound, mode,
        max_daily_loss_pct: maxDailyLoss,
        confirmed_live: mode === 'live' ? confirmedLive : undefined
      });
      navigate('/bots');
    } catch (e: any) { setError(e.message); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="max-w-[760px] mx-auto">
      <div className="mb-4">
        <h2 className="text-[17px] font-bold tracking-tight">Pembuat Bot</h2>
        <p className="text-xs txt-3 mt-0.5">Analisis kondisi pasar, pilih strategi, atur parameter, aktifkan.</p>
      </div>

      <div className="flex items-center gap-0 mb-5 border border-white/[0.07] rounded-lg overflow-hidden">
        {STEPS.map((label, i) => (
          <div key={i} className={`flex-1 flex items-center gap-2.5 px-4 py-2.5 text-[13px] ${i + 1 === step ? 'bg-white/[0.06]' : ''} ${i > 0 ? 'border-l border-white/[0.07]' : ''}`}>
            <span className={`num w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border ${i + 1 <= step ? 'bg-[#4f7cff] border-[#4f7cff] text-white' : 'border-white/15 txt-3'}`}>{i + 1}</span>
            <span className={i + 1 === step ? 'font-semibold' : 'txt-3'}>{label}</span>
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 text-[13px] txt-down border border-[rgba(246,70,93,0.3)] bg-[rgba(246,70,93,0.07)] rounded-md px-3 py-2.5 mb-4">
          <Icon.warn size={15} /> <span>{error}</span>
        </div>
      )}

      {step === 1 && (
        <section className="panel p-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="lbl mb-1.5">Exchange</div>
              <select value={exchange} onChange={e => setExchange(e.target.value)} className="input">
                <option value="indodax">Indodax (IDR)</option>
                <option value="binance">Binance (USDT)</option>
                <option value="tokocrypto">Tokocrypto (USDT)</option>
              </select>
            </div>
            <div>
              <div className="lbl mb-1.5">Pair</div>
              <select value={pair} onChange={e => setPair(e.target.value)} className="input num">
                {pairs.map(p => <option key={p.symbol} value={p.symbol}>{p.label} ({p.symbol})</option>)}
              </select>
            </div>
            <div>
              <div className="lbl mb-1.5">Budget ({exchange === 'indodax' ? 'IDR' : 'USDT'})</div>
              <input type="number" value={budget} onChange={e => setBudget(Number(e.target.value))} className="input num" />
            </div>
          </div>
          <button onClick={analyze} disabled={loadingPresets} className="btn btn-primary w-full mt-3">
            {loadingPresets ? 'Menganalisis…' : 'Analisis pasar'}
          </button>

          {presets.length > 0 && (
            <div className="mt-4">
              <div className="lbl mb-2">{presets.length} strategi teratas untuk {pair}</div>
              <div className="space-y-2">
                {presets.map((p, i) => {
                  const active = selected?.id === p.id;
                  return (
                    <button key={p.id} onClick={() => pickPreset(p)}
                      className={`w-full text-left rounded-md border p-3.5 transition-colors ${active ? 'border-[#4f7cff]/70 bg-[#4f7cff]/[0.06]' : 'border-white/[0.08] hover:border-white/20 bg-transparent'}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="num text-xs txt-3 w-6">0{i + 1}</span>
                          <span className="font-semibold text-[14px]">{p.nama}</span>
                          <span className="tag tag-dim">{p.gaya}</span>
                        </div>
                        <span className="num text-[13px] font-semibold txt-up shrink-0">{p.skor.toFixed(1)}</span>
                      </div>
                      <p className="text-xs txt-2 mt-1.5 leading-relaxed">{p.deskripsi}</p>
                      {p.backtest.note && (
                        <p className="text-[11px] txt-3 mt-1 num">{p.backtest.note}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2.5 text-xs txt-3">
                        <span>TP/SL <b className="txt-2 font-medium">{p.tp_sl_label}</b></span>
                        <span>TF <b className="txt-2 font-medium">{p.timeframe}</b></span>
                        <span className="ml-auto num">
                          Backtest <b className={p.backtest.winRate >= 50 ? 'txt-up' : 'text-[#f0b90b]'}>{p.backtest.winRate.toFixed(1)}%</b>
                          <span className="txt-3"> · {p.backtest.profitPct >= 0 ? '+' : ''}{p.backtest.profitPct.toFixed(2)}% · {p.backtest.trades}n</span>
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end mt-4">
            <button onClick={() => setStep(2)} disabled={!selected} className="btn btn-primary">
              Lanjut <Icon.arrowRight size={14} />
            </button>
          </div>
        </section>
      )}

      {step === 2 && selected && (
        <section className="panel p-4">
          <div className="text-[13px] txt-2 mb-3">Parameter · <b className="text-white">{selected.nama}</b> · <span className="num">{pair} · {exchange}</span></div>
          <div className="mb-3">
            <div className="lbl mb-1.5">Nama bot</div>
            <input value={botName} onChange={e => setBotName(e.target.value)} className="input" />
          </div>
          {selected.strategi === 'rebalance' && (
            <div className="mb-3">
              <div className="lbl mb-1.5">Target alokasi (JSON, contoh: {'{"BTC": 50, "ETH": 30}'} — sisa jadi kas)</div>
              <textarea
                value={typeof params.targets === 'string' ? params.targets : JSON.stringify(params.targets ?? { BTC: 50, ETH: 30 })}
                onChange={e => setParams({ ...params, targets: e.target.value })}
                rows={2} spellCheck={false}
                className="input num" />
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(PARAM_FIELDS[selected.strategi] || []).map(f => (
              <div key={f.key}>
                <div className="lbl mb-1.5">{f.label}</div>
                <input type="number" step="any" value={params[f.key] ?? ''} onChange={e => setParams({ ...params, [f.key]: Number(e.target.value) })}
                  className="input num" />
                {f.hint && <div className="text-[11px] txt-3 mt-1">{f.hint}</div>}
              </div>
            ))}
            <div>
              <div className="lbl mb-1.5">Auto-compound (%)</div>
              <input type="number" value={compound} onChange={e => setCompound(Number(e.target.value))} className="input num" />
            </div>
            <div>
              <div className="lbl mb-1.5">Budget</div>
              <input type="number" value={budget} onChange={e => setBudget(Number(e.target.value))} className="input num" />
            </div>
            <div>
              <div className="lbl mb-1.5">Batas rugi harian (%)</div>
              <input type="number" step="any" value={maxDailyLoss} onChange={e => setMaxDailyLoss(Number(e.target.value))} className="input num" />
            </div>
          </div>
          <p className="text-[11px] txt-3 mt-2">Batas rugi 0 = nonaktif. Bot dijeda otomatis bila rugi harian melewati batas.</p>
          <BacktestPanel exchange={exchange} pair={pair} strategy={selected.strategi} params={params} budget={budget} />
          <div className="flex justify-between mt-4">
            <button onClick={() => setStep(1)} className="btn btn-ghost">Kembali</button>
            <button onClick={() => setStep(3)} className="btn btn-primary">Lanjut <Icon.arrowRight size={14} /></button>
          </div>
        </section>
      )}

      {step === 3 && selected && (
        <section className="panel p-4">
          <div className="lbl mb-2">Ringkasan</div>
          <table className="tbl mb-4">
            <tbody>
              {[
                ['Nama', botName], ['Exchange / Pair', `${exchange} · ${pair}`], ['Strategi', selected.nama],
                ['Budget', `${budget.toLocaleString('id-ID')} ${exchange === 'indodax' ? 'IDR' : 'USDT'}`],
                ['Auto-compound', `${compound}%`], ['Batas rugi harian', maxDailyLoss > 0 ? `${maxDailyLoss}%` : 'Nonaktif']
              ].map(([k, v]) => (
                <tr key={k}><td className="txt-3 !py-2">{k}</td><td className="!text-right font-medium num !py-2">{v}</td></tr>
              ))}
            </tbody>
          </table>

          <div className="lbl mb-1.5">Mode</div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setMode('paper')} className={`btn ${mode === 'paper' ? 'btn-buy' : 'btn-ghost'}`}>Demo</button>
            <button onClick={() => setMode('live')} className={`btn ${mode === 'live' ? 'btn-sell' : 'btn-ghost'}`}>Riil</button>
          </div>

          {mode === 'live' && (
            <label className="flex items-start gap-2.5 text-[13px] txt-2 border border-[rgba(240,185,11,0.3)] bg-[rgba(240,185,11,0.06)] rounded-md p-3 mt-3">
              <input type="checkbox" checked={confirmedLive} onChange={e => setConfirmedLive(e.target.checked)} className="mt-1 accent-[#f0b90b]" />
              <span>Saya memahami risiko trading dengan dana riil dan API key sudah benar. Kerugian menjadi tanggung jawab saya.</span>
            </label>
          )}

          <div className="flex justify-between mt-4">
            <button onClick={() => setStep(2)} className="btn btn-ghost">Kembali</button>
            <button onClick={activate} disabled={submitting || (mode === 'live' && !confirmedLive) || !botName} className="btn btn-primary">
              {submitting ? 'Mengaktifkan…' : 'Aktifkan bot'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
