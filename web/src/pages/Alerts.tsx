import { useCallback, useEffect, useState } from 'react';
import { api, PairRow } from '../lib/api';
import { fmtIDR, fmtDateTime } from '../lib/format';

interface Alert {
  id: number; exchange_id: string; pair: string; direction: 'above' | 'below';
  target_price: number; note: string | null; active: number; triggered_at: string | null; created_at: string;
}

export default function Alerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [exchange, setExchange] = useState('indodax');
  const [pairs, setPairs] = useState<PairRow[]>([]);
  const [pair, setPair] = useState('XRPIDR');
  const [direction, setDirection] = useState<'above' | 'below'>('above');
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    api.get<Alert[]>('/alerts').then(setAlerts).catch(() => {});
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    api.get<PairRow[]>(`/pairs?exchange=${exchange}`).then(p => { setPairs(p); if (p.length) setPair(p[0].symbol); });
  }, [exchange]);

  const create = async () => {
    setErr('');
    try {
      await api.post('/alerts', { exchange_id: exchange, pair, direction, target_price: Number(target), note });
      setTarget(''); setNote('');
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const aktif = alerts.filter(a => a.active === 1);
  const riwayat = alerts.filter(a => a.active === 0);

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-bold">🔔 Price Alert</h2>
      <p className="text-sm text-gray-500 -mt-3">Dapatkan notifikasi Telegram saat harga menyentuh target. Alert one-shot (nonaktif setelah terpicu).</p>

      {/* Form buat alert */}
      <div className="card">
        <h3 className="font-semibold mb-3">Buat Alert Baru</h3>
        {err && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">⚠️ {err}</div>}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="text-xs text-gray-500">Exchange</label>
            <select value={exchange} onChange={e => setExchange(e.target.value)} className="w-full mt-1 rounded-xl border border-gray-300 px-3 py-2 text-sm">
              <option value="indodax">Indodax</option>
              <option value="tokocrypto">Tokocrypto</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">Pair</label>
            <select value={pair} onChange={e => setPair(e.target.value)} className="w-full mt-1 rounded-xl border border-gray-300 px-3 py-2 text-sm">
              {pairs.map(p => <option key={p.symbol} value={p.symbol}>{p.symbol}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">Kondisi</label>
            <select value={direction} onChange={e => setDirection(e.target.value as any)} className="w-full mt-1 rounded-xl border border-gray-300 px-3 py-2 text-sm">
              <option value="above">📈 Naik di atas</option>
              <option value="below">📉 Turun di bawah</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">Harga Target ({exchange === 'indodax' ? 'IDR' : 'USDT'})</label>
            <input type="number" value={target} onChange={e => setTarget(e.target.value)} className="w-full mt-1 rounded-xl border border-gray-300 px-3 py-2 text-sm" placeholder="0" />
          </div>
          <div>
            <label className="text-xs text-gray-500">Catatan (opsional)</label>
            <input value={note} onChange={e => setNote(e.target.value)} className="w-full mt-1 rounded-xl border border-gray-300 px-3 py-2 text-sm" placeholder="mis. resistance kuat" />
          </div>
        </div>
        <button onClick={create} disabled={!target || Number(target) <= 0}
          className="mt-3 px-5 py-2.5 rounded-xl bg-brand-500 text-white font-semibold hover:bg-brand-600 disabled:opacity-40">
          + Tambah Alert
        </button>
      </div>

      {/* Alert aktif */}
      <div className="card">
        <h3 className="font-semibold mb-3">Alert Aktif ({aktif.length})</h3>
        {aktif.length === 0 ? <div className="text-sm text-gray-400 py-4 text-center">Belum ada alert aktif</div> : (
          <div className="space-y-2">
            {aktif.map(a => (
              <div key={a.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="text-lg">{a.direction === 'above' ? '📈' : '📉'}</span>
                  <div>
                    <div className="font-medium text-sm">{a.pair} <span className="text-gray-400">· {a.exchange_id}</span></div>
                    <div className="text-xs text-gray-500">{a.direction === 'above' ? 'Naik di atas' : 'Turun di bawah'} <b>{fmtIDR(a.target_price)}</b>{a.note ? ` — ${a.note}` : ''}</div>
                  </div>
                </div>
                <button onClick={async () => { await api.del(`/alerts/${a.id}`); load(); }}
                  className="px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium">Hapus</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Riwayat terpicu */}
      {riwayat.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-3">Riwayat Terpicu ({riwayat.length})</h3>
          <div className="space-y-2">
            {riwayat.map(a => (
              <div key={a.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0 opacity-60">
                <div className="flex items-center gap-3">
                  <span className="text-lg">✅</span>
                  <div>
                    <div className="font-medium text-sm line-through">{a.pair} {a.direction === 'above' ? '≥' : '≤'} {fmtIDR(a.target_price)}</div>
                    <div className="text-xs text-gray-500">Terpicu {a.triggered_at ? fmtDateTime(a.triggered_at) : '—'}</div>
                  </div>
                </div>
                <button onClick={async () => { await api.del(`/alerts/${a.id}`); load(); }}
                  className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 text-xs">Hapus</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
