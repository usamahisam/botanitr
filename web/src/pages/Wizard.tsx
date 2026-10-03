import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, PairRow, Preset } from '../lib/api';

const PARAM_FIELDS: Record<string, { key: string; label: string }[]> = {
  grid: [
    { key: 'lower_pct', label: 'Batas Bawah (%)' }, { key: 'upper_pct', label: 'Batas Atas (%)' }, { key: 'levels', label: 'Jumlah Level' }
  ],
  dca: [
    { key: 'drop_pct', label: 'Beli Tiap Turun (%)' }, { key: 'take_profit_pct', label: 'Target Profit (%)' }, { key: 'max_buys', label: 'Maks Pembelian' }
  ],
  scalper: [
    { key: 'ema_fast', label: 'EMA Cepat' }, { key: 'ema_slow', label: 'EMA Lambat' },
    { key: 'rsi_period', label: 'Periode RSI' }, { key: 'rsi_overbought', label: 'RSI Overbought' },
    { key: 'tp_pct', label: 'Take Profit (%)' }, { key: 'sl_pct', label: 'Stop Loss (%)' },
    { key: 'trailing_pct', label: 'Trailing Stop (% — 0=nonaktif)' }
  ],
  harvester: [
    { key: 'drop_pct', label: 'Akumulasi Tiap Turun (%)' }, { key: 'harvest_pct', label: 'Target Panen (%)' }, { key: 'max_buys', label: 'Maks Akumulasi' }
  ]
};

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
    <div className="max-w-3xl mx-auto">
      <div className="card">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center text-xl">🤖</div>
          <div>
            <h2 className="font-bold text-lg">Rekomendasi AI & Wizard Pembuat Bot</h2>
            <p className="text-sm text-gray-500">Pilih strategi terbaik & bangun bot kustomisasi siap jalan 24/7</p>
          </div>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-2 my-5">
          {['Rekomendasi AI', 'Parameter Strategi', 'Aktivasi & Deploy'].map((label, i) => (
            <div key={i} className="flex items-center gap-2 flex-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${step > i ? 'bg-brand-500 text-white' : 'bg-gray-200 text-gray-500'}`}>{i + 1}</div>
              <div className={`text-xs font-medium ${step > i ? 'text-brand-600' : 'text-gray-400'}`}>{label}</div>
              {i < 2 && <div className="flex-1 h-px bg-gray-200" />}
            </div>
          ))}
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3 mb-4">⚠️ {error}</div>}

        {/* STEP 1 */}
        {step === 1 && (
          <div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div>
                <label className="text-xs text-gray-500">Exchange</label>
                <select value={exchange} onChange={e => setExchange(e.target.value)} className="w-full mt-1 rounded-xl border border-gray-300 px-3 py-2 text-sm">
                  <option value="indodax">Indodax (IDR)</option>
                  <option value="tokocrypto">Tokocrypto (USDT)</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">Koin</label>
                <select value={pair} onChange={e => setPair(e.target.value)} className="w-full mt-1 rounded-xl border border-gray-300 px-3 py-2 text-sm">
                  {pairs.map(p => <option key={p.symbol} value={p.symbol}>{p.label} ({p.symbol})</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">Budget ({exchange === 'indodax' ? 'IDR' : 'USDT'})</label>
                <input type="number" value={budget} onChange={e => setBudget(Number(e.target.value))} className="w-full mt-1 rounded-xl border border-gray-300 px-3 py-2 text-sm" />
              </div>
            </div>
            <button onClick={analyze} disabled={loadingPresets}
              className="w-full py-2.5 rounded-xl bg-brand-500 text-white font-semibold hover:bg-brand-600 disabled:opacity-50 mb-4">
              {loadingPresets ? 'Menganalisis pasar…' : '✨ Analisis & Rekomendasikan'}
            </button>

            {presets.length > 0 && (
              <div className="space-y-3">
                <div className="text-sm font-semibold text-gray-700">Pilih Rekomendasi Bot Strategi Terbaik: <span className="badge bg-emerald-100 text-emerald-700 ml-2">{presets.length} Presets Siap Pakai</span></div>
                {presets.map((p, i) => (
                  <button key={p.id} onClick={() => pickPreset(p)}
                    className={`w-full text-left rounded-2xl border-2 p-4 transition ${selected?.id === p.id ? 'border-brand-500 bg-brand-50/50' : 'border-gray-200 hover:border-gray-300'}`}>
                    <div className="flex items-center justify-between">
                      <span className="badge bg-cyan-100 text-cyan-700">{i === 0 ? `REKOMENDASI AI #${i + 1}` : p.id === 'harvester-aman' ? 'PALING AMAN' : `OPSИ #${i + 1}`}</span>
                      <span className="text-emerald-600 font-bold">{p.skor.toFixed(1)}<span className="text-xs font-normal text-gray-400"> skor</span></span>
                    </div>
                    <div className="font-bold mt-1.5">{p.nama} <span className="text-xs font-normal text-gray-400">({p.gaya})</span></div>
                    <p className="text-xs text-gray-500 mt-1">{p.deskripsi}</p>
                    <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                      <div className="bg-gray-50 rounded-lg py-1.5"><div className="text-[10px] text-gray-400">Leverage</div><div className="text-xs font-semibold">{p.leverage_label}</div></div>
                      <div className="bg-gray-50 rounded-lg py-1.5"><div className="text-[10px] text-gray-400">TP / SL</div><div className="text-xs font-semibold">{p.tp_sl_label}</div></div>
                      <div className="bg-gray-50 rounded-lg py-1.5"><div className="text-[10px] text-gray-400">Timeframe</div><div className="text-xs font-semibold">{p.timeframe}</div></div>
                    </div>
                    <div className="flex justify-between items-center mt-3 text-xs">
                      <span className="text-gray-400">Gaya: {p.gaya}</span>
                      <span className="text-gray-500">Backtest: <b className={p.backtest.winRate >= 50 ? 'text-emerald-600' : 'text-amber-600'}>{p.backtest.winRate.toFixed(1)}% win</b> · {p.backtest.profitPct >= 0 ? '+' : ''}{p.backtest.profitPct.toFixed(2)}% · {p.backtest.trades} trades</span>
                      <span className="text-brand-600 font-medium">Pilih Presets →</span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="flex justify-between mt-5">
              <span />
              <button onClick={() => setStep(2)} disabled={!selected}
                className="px-6 py-2.5 rounded-xl bg-cyan-500 text-white font-semibold hover:bg-cyan-600 disabled:opacity-40">
                Lanjut ke Step 2 →
              </button>
            </div>
          </div>
        )}

        {/* STEP 2 */}
        {step === 2 && selected && (
          <div>
            <div className="text-sm font-semibold text-gray-700 mb-3">Parameter: {selected.nama} · {pair} · {exchange}</div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="col-span-2">
                <label className="text-xs text-gray-500">Nama Bot</label>
                <input value={botName} onChange={e => setBotName(e.target.value)} className="w-full mt-1 rounded-xl border border-gray-300 px-3 py-2 text-sm" />
              </div>
              {(PARAM_FIELDS[selected.strategi] || []).map(f => (
                <div key={f.key}>
                  <label className="text-xs text-gray-500">{f.label}</label>
                  <input type="number" step="any" value={params[f.key] ?? ''} onChange={e => setParams({ ...params, [f.key]: Number(e.target.value) })}
                    className="w-full mt-1 rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                </div>
              ))}
              <div>
                <label className="text-xs text-gray-500">Auto-Compound (%)</label>
                <input type="number" value={compound} onChange={e => setCompound(Number(e.target.value))} className="w-full mt-1 rounded-xl border border-gray-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500">Budget ({exchange === 'indodax' ? 'IDR' : 'USDT'})</label>
                <input type="number" value={budget} onChange={e => setBudget(Number(e.target.value))} className="w-full mt-1 rounded-xl border border-gray-300 px-3 py-2 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500">Batas Rugi Harian (% budget) — 0 = nonaktif. Bot auto-pause jika rugi harian melewati batas ini.</label>
                <input type="number" step="any" value={maxDailyLoss} onChange={e => setMaxDailyLoss(Number(e.target.value))} className="w-full mt-1 rounded-xl border border-gray-300 px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-between">
              <button onClick={() => setStep(1)} className="px-5 py-2.5 rounded-xl bg-gray-100 font-medium">← Kembali</button>
              <button onClick={() => setStep(3)} className="px-6 py-2.5 rounded-xl bg-cyan-500 text-white font-semibold">Lanjut ke Step 3 →</button>
            </div>
          </div>
        )}

        {/* STEP 3 */}
        {step === 3 && selected && (
          <div>
            <div className="bg-gray-50 rounded-2xl p-4 text-sm space-y-1.5 mb-4">
              <div className="font-semibold text-gray-700 mb-2">Ringkasan Deploy</div>
              <div className="flex justify-between"><span className="text-gray-500">Nama</span><b>{botName}</b></div>
              <div className="flex justify-between"><span className="text-gray-500">Exchange / Pair</span><b>{exchange} · {pair}</b></div>
              <div className="flex justify-between"><span className="text-gray-500">Strategi</span><b>{selected.nama}</b></div>
              <div className="flex justify-between"><span className="text-gray-500">Budget</span><b>{budget.toLocaleString('id-ID')} {exchange === 'indodax' ? 'IDR' : 'USDT'}</b></div>
              <div className="flex justify-between"><span className="text-gray-500">Auto-Compound</span><b>{compound}%</b></div>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4">
              <button onClick={() => setMode('paper')} className={`py-3 rounded-xl font-semibold ${mode === 'paper' ? 'bg-amber-400 text-white' : 'bg-gray-100'}`}>📄 Mode Demo</button>
              <button onClick={() => setMode('live')} className={`py-3 rounded-xl font-semibold ${mode === 'live' ? 'bg-emerald-500 text-white' : 'bg-gray-100'}`}>💰 Mode Riil</button>
            </div>

            {mode === 'live' && (
              <label className="flex items-start gap-2 text-sm text-gray-600 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
                <input type="checkbox" checked={confirmedLive} onChange={e => setConfirmedLive(e.target.checked)} className="mt-1" />
                <span>Saya paham risiko trading dengan uang riil dan API keys sudah benar. Kerugian sepenuhnya tanggung jawab saya.</span>
              </label>
            )}

            <div className="flex justify-between">
              <button onClick={() => setStep(2)} className="px-5 py-2.5 rounded-xl bg-gray-100 font-medium">← Kembali</button>
              <button onClick={activate} disabled={submitting || (mode === 'live' && !confirmedLive)}
                className="px-6 py-2.5 rounded-xl bg-brand-500 text-white font-bold hover:bg-brand-600 disabled:opacity-40">
                {submitting ? 'Mengaktifkan…' : '🚀 Aktifkan Bot'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
