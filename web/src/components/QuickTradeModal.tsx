import { useEffect, useState } from 'react';
import { api, PairRow } from '../lib/api';
import { fmtIDR } from '../lib/format';

export default function QuickTradeModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [exchange, setExchange] = useState('indodax');
  const [pairs, setPairs] = useState<PairRow[]>([]);
  const [pair, setPair] = useState('XRPIDR');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('100000');
  const [mode, setMode] = useState<'paper' | 'live'>('paper');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');

  useEffect(() => {
    api.get<PairRow[]>(`/pairs?exchange=${exchange}`).then(p => {
      setPairs(p);
      if (p.length) setPair(p[0].symbol);
    });
  }, [exchange]);

  const submit = async () => {
    setLoading(true); setResult('');
    try {
      const r: any = await api.post('/trade/quick', { exchange_id: exchange, pair, side, amount: Number(amount), mode });
      setResult(`✅ Berhasil: ${side === 'buy' ? 'Beli' : 'Jual'} ${r.qty?.toFixed(8)} @ ${fmtIDR(r.price)}`);
      onDone();
    } catch (e: any) {
      setResult(`❌ ${e.message}`);
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-lg">Quick Trade</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        <label className="text-sm text-gray-600">Exchange</label>
        <select value={exchange} onChange={e => setExchange(e.target.value)} className="w-full mt-1 mb-3 rounded-xl border-gray-300 border px-3 py-2">
          <option value="indodax">Indodax (IDR)</option>
          <option value="tokocrypto">Tokocrypto (USDT)</option>
        </select>

        <label className="text-sm text-gray-600">Pasangan</label>
        <select value={pair} onChange={e => setPair(e.target.value)} className="w-full mt-1 mb-3 rounded-xl border-gray-300 border px-3 py-2">
          {pairs.map(p => <option key={p.symbol} value={p.symbol}>{p.label} ({p.symbol})</option>)}
        </select>

        <label className="text-sm text-gray-600">Sisi</label>
        <div className="grid grid-cols-2 gap-2 mt-1 mb-3">
          <button onClick={() => setSide('buy')} className={`py-2 rounded-xl font-medium ${side === 'buy' ? 'bg-emerald-500 text-white' : 'bg-gray-100'}`}>Beli</button>
          <button onClick={() => setSide('sell')} className={`py-2 rounded-xl font-medium ${side === 'sell' ? 'bg-red-500 text-white' : 'bg-gray-100'}`}>Jual</button>
        </div>

        <label className="text-sm text-gray-600">{side === 'buy' ? `Nominal (${exchange === 'indodax' ? 'IDR' : 'USDT'})` : 'Qty (base asset)'}</label>
        <input value={amount} onChange={e => setAmount(e.target.value)} type="number" className="w-full mt-1 mb-3 rounded-xl border-gray-300 border px-3 py-2" />

        <label className="text-sm text-gray-600">Mode</label>
        <div className="grid grid-cols-2 gap-2 mt-1 mb-4">
          <button onClick={() => setMode('paper')} className={`py-2 rounded-xl text-sm font-medium ${mode === 'paper' ? 'bg-amber-400 text-white' : 'bg-gray-100'}`}>📄 Demo</button>
          <button onClick={() => setMode('live')} className={`py-2 rounded-xl text-sm font-medium ${mode === 'live' ? 'bg-emerald-500 text-white' : 'bg-gray-100'}`}>💰 Riil</button>
        </div>

        {result && <div className="text-sm mb-3 p-3 rounded-xl bg-gray-50">{result}</div>}

        <button onClick={submit} disabled={loading}
          className="w-full py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold transition disabled:opacity-50">
          {loading ? 'Memproses…' : `Eksekusi ${side === 'buy' ? 'Beli' : 'Jual'}`}
        </button>
      </div>
    </div>
  );
}
