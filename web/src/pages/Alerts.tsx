import { useCallback, useEffect, useState } from 'react';
import { api, PairRow } from '../lib/api';
import { fmtIDR, fmtDateTime } from '../lib/format';
import { Icon } from '../components/icons';

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
    <div className="space-y-4 max-w-[900px]">
      <div>
        <h2 className="text-[17px] font-bold tracking-tight">Peringatan harga</h2>
        <p className="text-xs txt-3 mt-0.5">Notifikasi Telegram saat harga menyentuh target. Satu alert aktif hingga terpicu satu kali.</p>
      </div>

      <section className="panel p-4">
        <div className="lbl mb-3">Alert baru</div>
        {err && (
          <div className="flex items-start gap-2 text-[13px] txt-down border border-[rgba(246,70,93,0.3)] bg-[rgba(246,70,93,0.07)] rounded-md px-3 py-2.5 mb-3">
            <Icon.warn size={15} /> <span>{err}</span>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <div className="lbl mb-1.5">Exchange</div>
            <select value={exchange} onChange={e => setExchange(e.target.value)} className="input">
              <option value="indodax">Indodax</option>
              <option value="tokocrypto">Tokocrypto</option>
            </select>
          </div>
          <div>
            <div className="lbl mb-1.5">Pair</div>
            <select value={pair} onChange={e => setPair(e.target.value)} className="input num">
              {pairs.map(p => <option key={p.symbol} value={p.symbol}>{p.symbol}</option>)}
            </select>
          </div>
          <div>
            <div className="lbl mb-1.5">Kondisi</div>
            <select value={direction} onChange={e => setDirection(e.target.value as any)} className="input">
              <option value="above">Naik di atas</option>
              <option value="below">Turun di bawah</option>
            </select>
          </div>
          <div>
            <div className="lbl mb-1.5">Target ({exchange === 'indodax' ? 'IDR' : 'USDT'})</div>
            <input type="number" value={target} onChange={e => setTarget(e.target.value)} className="input num" placeholder="0" />
          </div>
          <div>
            <div className="lbl mb-1.5">Catatan</div>
            <input value={note} onChange={e => setNote(e.target.value)} className="input" placeholder="Opsional" />
          </div>
        </div>
        <button onClick={create} disabled={!target || Number(target) <= 0} className="btn btn-primary btn-sm mt-3">
          <Icon.plus size={14} /> Tambah alert
        </button>
      </section>

      <section className="panel">
        <div className="panel-head"><span className="lbl">Aktif · {aktif.length}</span></div>
        {aktif.length === 0 ? <div className="txt-3 text-sm p-6 text-center">Belum ada alert aktif.</div> : (
          <table className="tbl">
            <tbody>
              {aktif.map(a => (
                <tr key={a.id}>
                  <td className="w-10"><span className={a.direction === 'above' ? 'txt-up' : 'txt-down'}>{a.direction === 'above' ? <Icon.up size={15} /> : <Icon.down size={15} />}</span></td>
                  <td>
                    <span className="font-semibold">{a.pair}</span> <span className="txt-3 text-xs">· {a.exchange_id}</span>
                    <div className="text-xs txt-3 mt-0.5">{a.direction === 'above' ? 'Naik di atas' : 'Turun di bawah'}{a.note ? ` · ${a.note}` : ''}</div>
                  </td>
                  <td className="!text-right num font-semibold">{fmtIDR(a.target_price)}</td>
                  <td className="!text-right w-24">
                    <button onClick={async () => { await api.del(`/alerts/${a.id}`); load(); }} className="btn btn-ghost btn-sm">Hapus</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {riwayat.length > 0 && (
        <section className="panel">
          <div className="panel-head"><span className="lbl">Sudah terpicu · {riwayat.length}</span></div>
          <table className="tbl opacity-60">
            <tbody>
              {riwayat.map(a => (
                <tr key={a.id}>
                  <td className="w-10"><Icon.check size={15} className="txt-up" /></td>
                  <td>
                    <span className="font-semibold line-through">{a.pair} {a.direction === 'above' ? '≥' : '≤'} {fmtIDR(a.target_price)}</span>
                    <div className="text-xs txt-3 mt-0.5">Terpicu {a.triggered_at ? fmtDateTime(a.triggered_at) : '—'}</div>
                  </td>
                  <td className="!text-right w-24">
                    <button onClick={async () => { await api.del(`/alerts/${a.id}`); load(); }} className="btn btn-ghost btn-sm">Hapus</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
