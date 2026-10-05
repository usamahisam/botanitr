import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, PairRow, Preset } from '../lib/api';
import { Icon } from '../components/icons';
import { EXCHANGES, QUOTE } from '../lib/exchanges';
import { AreaChart, Area, ResponsiveContainer, YAxis, Tooltip } from 'recharts';

interface BtResult {
  winRate: number; profitPct: number; trades: number; maxDrawdownPct: number;
  equity: { t: number; v: number }[]; candles: number; note?: string;
}

function MaxBudgetBox({ exchange, budget, mode, onMax }: {
  exchange: string; budget: number; mode: 'paper' | 'live'; onMax: (v: number) => void;
}) {
  const [info, setInfo] = useState<{ quote: string; free: number; mode: string } | null>(null);
  useEffect(() => {
    setInfo(null);
    api.get<{ quote: string; free: number; mode: string }>(`/exchanges/${exchange}/max-spendable?mode=${mode}`)
      .then(setInfo).catch(() => {});
  }, [exchange, mode]);
  if (!info) return null;
  const over = budget > info.free;
  return (
    <div className={`mt-2 rounded-md border px-3 py-2 text-[12px] ${over ? 'border-[rgba(246,70,93,0.35)] bg-[rgba(246,70,93,0.07)]' : 'border-white/10 bg-white/[0.03]'}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="txt-2">
          Kas tersedia ({info.mode === 'live' ? 'Riil' : 'Demo'}): <b className="num txt-2">{info.free.toLocaleString('id-ID')} {info.quote}</b>
        </span>
        <button onClick={() => onMax(Math.floor(info.free))} disabled={info.free <= 0}
          className="btn btn-ghost btn-sm shrink-0" title="Isi budget dengan seluruh kas tersedia">
          Pakai maksimal
        </button>
      </div>
      {over && (
        <div className="txt-down mt-1">Budget melebihi kas — bot {info.mode === 'live' ? 'akan ditolak saat aktivasi' : 'bisa kehabisan kas saat jalan'}.</div>
      )}
    </div>
  );
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/[0.06] border border-white/[0.06] rounded-md overflow-hidden mt-3">
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
  revert: [
    { key: 'rsi_len', label: 'Panjang RSI' }, { key: 'oversold', label: 'Batas oversold' },
    { key: 'exit_rsi', label: 'RSI keluar' }, { key: 'tp_pct', label: 'Take profit (%)' }, { key: 'sl_pct', label: 'Stop loss (%)' }
  ],
  bollinger: [
    { key: 'bb_period', label: 'Periode BB' }, { key: 'bb_mult', label: 'Lebar band' },
    { key: 'entry_b', label: '%b masuk' }, { key: 'exit_b', label: '%b keluar' },
    { key: 'tp_pct', label: 'Take profit (%)' }, { key: 'sl_pct', label: 'Stop loss (%)' }
  ],
  breakout: [
    { key: 'donchian_n', label: 'Tertinggi N candle' }, { key: 'tp_pct', label: 'Take profit (%)' },
    { key: 'sl_pct', label: 'Stop loss (%)' }, { key: 'trail_atr_mult', label: 'Trailing (×ATR)', hint: '0 = nonaktif' }
  ],
  dynamic: [
    { key: 'step_pct', label: 'Jarak level (%)' }, { key: 'levels', label: 'Jumlah level/sisi' },
    { key: 'profit_pct', label: 'Target bersih (%)' }, { key: 'max_exposure_pct', label: 'Eksposur maks (%)' },
    { key: 'sl_pct', label: 'Stop darurat (%)' }
  ],
  rebalance: [
    { key: 'threshold_pct', label: 'Threshold deviasi (%)' }, { key: 'interval_min', label: 'Cek tiap (menit)' }, { key: 'max_trade_quote', label: 'Maks nominal per order' }
  ]
};

const STEPS = ['Mulai', 'Strategi', 'Aktivasi'];

/** Exchange siap untuk bot Riil? (API key terpasang + setting exchange mode Riil) */
function liveReady(exList: ExchangeInfo[], exchange: string): boolean {
  const row = exList.find(e => e.id === exchange);
  return !!row && row.has_credentials && row.mode === 'live';
}

function LiveReadiness({ exchange, exList }: { exchange: string; exList: ExchangeInfo[] }) {
  const row = exList.find(e => e.id === exchange);
  if (!row) return null;
  const items: [boolean, string][] = [
    [row.has_credentials, row.has_credentials ? 'API key terpasang' : 'Belum ada API key — isi di Pengaturan → Exchange'],
    [row.mode === 'live', row.mode === 'live' ? `Exchange mode Riil` : 'Exchange masih mode Demo — ubah ke Riil di Pengaturan']
  ];
  const ok = items.every(([v]) => v);
  return (
    <div className={`mt-2 rounded-md border px-3 py-2 text-[12px] ${ok ? 'border-[rgba(46,189,133,0.3)] bg-[rgba(46,189,133,0.06)]' : 'border-[rgba(240,185,11,0.35)] bg-[rgba(240,185,11,0.06)]'}`}>
      <div className="font-semibold mb-1">Syarat bot Riil di {row.name}:</div>
      {items.map(([v, t], i) => (
        <div key={i} className={`flex items-center gap-2 ${v ? 'txt-up' : 'text-[#f0b90b]'}`}>
          <span className="num">{v ? '✓' : '!'}</span><span>{t}</span>
        </div>
      ))}
      {!ok && <div className="txt-2 mt-1">Lengkapi dulu — tombol lanjut terkunci sampai syarat terpenuhi.</div>}
    </div>
  );
}

/** Penjelasan polos tiap strategi untuk orang awam */
const STRAT_EXPLAIN: Record<string, string> = {
  grid: 'Cocok saat harga naik-turun di tempat. Bot membeli ketika harga turun, menjual ketika naik kembali.',
  dca: 'Cocok untuk koin bagus yang sedang turun. Bot mencicil beli sedikit-sedikit, jual sekaligus saat target tercapai.',
  scalper: 'Cocok saat pasar aktif. Bot masuk-keluar cepat mengejar untung kecil berkali-kali dalam sehari.',
  harvester: 'Paling aman untuk pemula. Bot menabung saat harga murah, menjual secukupnya saat sudah untung.',
  rebalance: 'Untuk banyak koin sekaligus. Bot menjaga komposisi portofolio sesuai target persen Anda.',
  revert: 'Beli saat harga anjlok sesaat tapi tren besar masih naik, jual begitu memantul. Sinyal paling sering muncul.',
  bollinger: 'Beli saat harga menyentuh pita bawah, jual saat kembali ke tengah. Cocok pasar naik-turun di tempat.',
  breakout: 'Ikut saat harga menembus rekor tertingginya, lepas cepat dengan untung kecil. Untuk pasar yang sedang lari.',
  dynamic: 'Paling pintar: beli saat turun, ikut saat naik, panen tiap level berkali-kali. Anchor mengikuti harga.'
};

interface ExchangeInfo { id: string; name: string; mode: string; has_credentials: boolean }

export default function Wizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<'paper' | 'live'>('paper');
  const [exchange, setExchange] = useState('indodax');
  const [exList, setExList] = useState<ExchangeInfo[]>([]);
  const [pairs, setPairs] = useState<PairRow[]>([]);
  const [pair, setPair] = useState('XRPIDR');
  const [budget, setBudget] = useState(100000);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [selected, setSelected] = useState<Preset | null>(null);
  const [params, setParams] = useState<Record<string, any>>({});
  const [botName, setBotName] = useState('');
  const [compound, setCompound] = useState(100);
  const [maxDailyLoss, setMaxDailyLoss] = useState(0);
  const [confirmedLive, setConfirmedLive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<ExchangeInfo[]>('/exchanges').then(setExList).catch(() => {});
  }, []);

  useEffect(() => {
    api.get<PairRow[]>(`/pairs?exchange=${exchange}`).then(p => {
      setPairs(p);
      if (p.length) setPair(p[0].symbol);
    });
  }, [exchange]);

  // Ganti pair/exchange -> rekomendasi lama tidak berlaku lagi
  const changePair = (v: string) => { setPair(v); setPresets([]); setSelected(null); };
  const changeExchange = (v: string) => { setExchange(v); setPresets([]); setSelected(null); };

  // Analisis otomatis saat masuk langkah 2 (hemat 1 klik)
  useEffect(() => {
    if (step === 2 && presets.length === 0 && !loadingPresets && pair) analyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

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
        <h2 className="text-[17px] font-bold tracking-tight">Buat Bot Baru</h2>
        <p className="text-xs txt-3 mt-0.5">Tiga langkah: pilih mode & pasar, pilih strategi, aktifkan. Bisa dijeda/dihapus kapan saja.</p>
      </div>

      <div className="flex items-center gap-0 mb-5 border border-white/[0.07] rounded-lg overflow-hidden">
        {STEPS.map((label, i) => (
          <div key={i} className={`flex-1 flex items-center gap-2 px-2.5 sm:px-4 py-2.5 text-[13px] min-w-0 ${i + 1 === step ? 'bg-white/[0.06]' : ''} ${i > 0 ? 'border-l border-white/[0.07]' : ''}`}>
            <span className={`num w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs font-bold border ${i + 1 <= step ? 'bg-[#4f7cff] border-[#4f7cff] text-white' : 'border-white/15 txt-3'}`}>{i + 1}</span>
            <span className={`truncate ${i + 1 === step ? 'font-semibold' : 'txt-3'}`}>{label}</span>
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 text-[13px] txt-down border border-[rgba(246,70,93,0.3)] bg-[rgba(246,70,93,0.07)] rounded-md px-3 py-2.5 mb-4">
          <Icon.warn size={15} />
          <span className="flex-1">{error}</span>
          {step === 2 && <button onClick={analyze} disabled={loadingPresets} className="btn btn-ghost btn-sm shrink-0">Coba lagi</button>}
        </div>
      )}

      {step === 1 && (
        <section className="panel p-4">
          <div className="lbl mb-1.5">1 · Uang apa yang dipakai? <span className="normal-case font-normal">(tidak bisa diganti setelah bot dibuat)</span></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            <button onClick={() => setMode('paper')}
              className={`text-left rounded-md border p-3 transition-colors ${mode === 'paper' ? 'border-[#2ebd85]/70 bg-[#2ebd85]/[0.06]' : 'border-white/[0.08] hover:border-white/20'}`}>
              <div className="font-semibold text-[14px] txt-up">Demo — uang mainan</div>
              <p className="text-xs txt-2 mt-1 leading-relaxed">Saldo virtual {QUOTE[exchange] === 'USDT' ? '1.000 USDT' : 'Rp 10 juta'}. Aman untuk belajar & uji strategi. Bisa di-reset kapan saja.</p>
            </button>
            <button onClick={() => setMode('live')}
              className={`text-left rounded-md border p-3 transition-colors ${mode === 'live' ? 'border-[#f6465d]/70 bg-[#f6465d]/[0.06]' : 'border-white/[0.08] hover:border-white/20'}`}>
              <div className="font-semibold text-[14px] txt-down">Riil — uang sungguhan</div>
              <p className="text-xs txt-2 mt-1 leading-relaxed">Memakai saldo asli exchange. Untung & rugi nyata. Butuh API key + saldo cukup.</p>
            </button>
          </div>

          <div className="lbl mb-1.5">2 · Pasar mana?</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div>
              <select value={exchange} onChange={e => changeExchange(e.target.value)} className="input" aria-label="Exchange">
                {EXCHANGES.map(x => <option key={x.id} value={x.id}>{x.label} ({x.quote})</option>)}
              </select>
            </div>
            <div>
              <select value={pair} onChange={e => changePair(e.target.value)} className="input num" aria-label="Pair">
                {pairs.map(p => <option key={p.symbol} value={p.symbol}>{p.label} ({p.symbol})</option>)}
              </select>
            </div>
          </div>

          <div className="lbl mb-1.5">3 · Berapa modalnya? ({QUOTE[exchange] || 'IDR'})</div>
          <input type="number" value={budget} onChange={e => setBudget(Number(e.target.value))} className="input num" aria-label="Budget" />
          <MaxBudgetBox exchange={exchange} budget={budget} mode={mode} onMax={setBudget} />
          {mode === 'live' && <LiveReadiness exchange={exchange} exList={exList} />}

          <div className="flex justify-end mt-4">
            <button onClick={() => setStep(2)} disabled={mode === 'live' && !liveReady(exList, exchange)} className="btn btn-primary" title={mode === 'live' && !liveReady(exList, exchange) ? 'Lengkapi API key & mode Riil exchange di Pengaturan dulu' : ''}>
              Lanjut pilih strategi <Icon.arrowRight size={14} />
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="panel p-4">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <span className={`tag ${mode === 'live' ? 'tag-down' : 'tag-up'}`}>{mode === 'live' ? 'RIIL' : 'DEMO'} · <span className="num">{pair} · {budget.toLocaleString('id-ID')}</span></span>
            <button onClick={() => setStep(1)} className="text-xs txt-3 hover:text-white">Ubah mode/pasar →</button>
          </div>

          {loadingPresets && <div className="text-sm txt-3 py-6 text-center">Menganalisis kondisi pasar…</div>}

          {presets.length > 0 && !selected && (
            <div>
              <div className="lbl mb-2">Pilih satu strategi untuk {pair}</div>
              <div className="space-y-2">
                {presets.map((p, i) => {
                  return (
                    <button key={p.id} onClick={() => pickPreset(p)}
                      className="w-full text-left rounded-md border p-3.5 transition-colors border-white/[0.08] hover:border-white/20 bg-transparent">
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

          {selected && (<>
          <div className="text-[13px] txt-2 mb-1">Strategi: <b className="text-white">{selected.nama}</b> <button onClick={() => setSelected(null)} className="text-xs txt-3 hover:text-white ml-1">ganti</button></div>
          {STRAT_EXPLAIN[selected.strategi] && (
            <p className="text-xs txt-2 mb-3 leading-relaxed border-l-2 border-[#4f7cff]/50 pl-2.5">{STRAT_EXPLAIN[selected.strategi]}</p>
          )}
          <div className="text-[13px] txt-2 mb-3 sr-only">Parameter · <b className="text-white">{selected.nama}</b> · <span className="num">{pair} · {exchange}</span></div>
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
          </>)}
        </section>
      )}

      {step === 3 && selected && (
        <section className="panel p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="lbl">Ringkasan — periksa sekali lagi</span>
            <span className={`tag ${mode === 'live' ? 'tag-down' : 'tag-up'}`}>{mode === 'live' ? 'UANG SUNGGUHAN' : 'UANG MAINAN'}</span>
          </div>
          <table className="tbl mb-4">
            <tbody>
              {[
                ['Nama', botName], ['Exchange / Pair', `${exchange} · ${pair}`], ['Strategi', selected.nama],
                ['Budget', `${budget.toLocaleString('id-ID')} ${QUOTE[exchange] || 'IDR'}`],
                ['Auto-compound', `${compound}%`], ['Batas rugi harian', maxDailyLoss > 0 ? `${maxDailyLoss}%` : 'Nonaktif']
              ].map(([k, v]) => (
                <tr key={k}><td className="txt-3 !py-2">{k}</td><td className="!text-right font-medium num !py-2">{v}</td></tr>
              ))}
            </tbody>
          </table>
          <button onClick={() => setStep(1)} className="text-xs txt-3 hover:text-white mb-3">← Ubah mode, pasar, atau budget</button>

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
