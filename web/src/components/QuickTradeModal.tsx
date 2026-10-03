import { useEffect, useState } from 'react';
import { api, PairRow } from '../lib/api';
import { fmtIDR } from '../lib/format';
import { Icon } from './icons';

export default function QuickTradeModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [exchange, setExchange] = useState('indodax');
  const [pairs, setPairs] = useState<PairRow[]>([]);
  const [pair, setPair] = useState('XRPIDR');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('100000');
  const [mode, setMode] = useState<'paper' | 'live'>('paper');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.get<PairRow[]>(`/pairs?exchange=${exchange}`).then(p => {
      setPairs(p);
      if (p.length) setPair(p[0].symbol);
    });
  }, [exchange]);

  const submit = async () => {
    setLoading(true); setResult(null);
    try {
      const r: any = await api.post('/trade/quick', { exchange_id: exchange, pair, side, amount: Number(amount), mode });
      setResult({ ok: true, text: `${side === 'buy' ? 'Beli' : 'Jual'} ${Number(r.qty).toFixed(8)} @ ${fmtIDR(r.price)}` });
      onDone();
    } catch (e: any) {
      setResult({ ok: false, text: e.message });
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(4,6,10,0.7)' }} onClick={onClose}>
      <div className="panel w-full max-w-[420px]" onClick={e => e.stopPropagation()}>
        <div className="panel-head">
          <span className="text-sm font-semibold flex items-center gap-2"><Icon.zap size={15} className="text-[#4f7cff]" /> Perdagangan Cepat</span>
          <button onClick={onClose} className="txt-3 hover:text-white"><Icon.x size={16} /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="lbl mb-1.5">Exchange</div>
              <select value={exchange} onChange={e => setExchange(e.target.value)} className="input">
                <option value="indodax">Indodax (IDR)</option>
                <option value="tokocrypto">Tokocrypto (USDT)</option>
              </select>
            </div>
            <div>
              <div className="lbl mb-1.5">Pair</div>
              <select value={pair} onChange={e => setPair(e.target.value)} className="input num">
                {pairs.map(p => <option key={p.symbol} value={p.symbol}>{p.symbol}</option>)}
              </select>
            </div>
          </div>

          <div>
            <div className="lbl mb-1.5">Sisi</div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setSide('buy')} className={`btn ${side === 'buy' ? 'btn-buy' : 'btn-ghost'}`}>Beli</button>
              <button onClick={() => setSide('sell')} className={`btn ${side === 'sell' ? 'btn-sell' : 'btn-ghost'}`}>Jual</button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="lbl mb-1.5">{side === 'buy' ? `Nominal (${exchange === 'indodax' ? 'IDR' : 'USDT'})` : 'Qty aset'}</div>
              <input value={amount} onChange={e => setAmount(e.target.value)} type="number" className="input num" />
            </div>
            <div>
              <div className="lbl mb-1.5">Mode</div>
              <div className="seg w-full">
                <button onClick={() => setMode('paper')} className={mode === 'paper' ? 'on flex-1' : 'flex-1'}>Demo</button>
                <button onClick={() => setMode('live')} className={mode === 'live' ? 'on flex-1' : 'flex-1'}>Riil</button>
              </div>
            </div>
          </div>

          {result && (
            <div className={`flex items-start gap-2 text-[13px] rounded-md px-3 py-2.5 border ${result.ok ? 'border-[rgba(46,189,133,0.3)] bg-[rgba(46,189,133,0.07)]' : 'border-[rgba(246,70,93,0.3)] bg-[rgba(246,70,93,0.07)]'}`}>
              {result.ok ? <Icon.check size={15} className="txt-up mt-0.5" /> : <Icon.warn size={15} className="txt-down mt-0.5" />}
              <span className="num">{result.text}</span>
            </div>
          )}

          <button onClick={submit} disabled={loading} className={`btn w-full ${side === 'buy' ? 'btn-buy' : 'btn-sell'} !py-2.5`}>
            {loading ? 'Memproses…' : `Eksekusi ${side === 'buy' ? 'Beli' : 'Jual'} ${mode === 'live' ? '· Riil' : '· Demo'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
