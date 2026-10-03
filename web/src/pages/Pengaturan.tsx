import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Icon } from '../components/icons';

interface ExchangeSettings {
  id: string; name: string; mode: string; status: string; proxy_url: string | null;
  api_key_masked: string; has_credentials: boolean;
}

function ExchangeSettingsCard({ ex, onSaved }: { ex: ExchangeSettings; onSaved: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [proxy, setProxy] = useState(ex.proxy_url || '');
  const [mode, setMode] = useState(ex.mode);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true); setResult(null);
    try {
      await api.put(`/exchanges/${ex.id}`, {
        ...(apiKey ? { api_key: apiKey } : {}),
        ...(apiSecret ? { api_secret: apiSecret } : {}),
        proxy_url: proxy, mode
      });
      setResult({ ok: true, text: 'Konfigurasi tersimpan.' });
      setApiKey(''); setApiSecret('');
      onSaved();
    } catch (e: any) { setResult({ ok: false, text: e.message }); }
    finally { setSaving(false); }
  };

  const test = async () => {
    setResult({ ok: true, text: 'Menguji koneksi…' });
    try {
      const r: any = await api.post(`/exchanges/${ex.id}/test`);
      setResult(r.ok ? { ok: true, text: `Koneksi OK · ${r.latency_ms} ms` } : { ok: false, text: r.error });
    } catch (e: any) { setResult({ ok: false, text: e.message }); }
  };

  return (
    <section className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[14px] font-semibold">{ex.name}</span>
        <span className={`tag ${mode === 'live' ? 'tag-down' : 'tag-warn'}`}>{mode === 'live' ? 'RIIL' : 'DEMO'}</span>
      </div>
      <div className="space-y-3">
        <div>
          <div className="lbl mb-1.5">API key {ex.has_credentials && <span className="normal-case font-normal">· tersimpan {ex.api_key_masked}</span>}</div>
          <input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Isi untuk mengganti" className="input num" autoComplete="off" />
        </div>
        <div>
          <div className="lbl mb-1.5">API secret</div>
          <input value={apiSecret} onChange={e => setApiSecret(e.target.value)} type="password" placeholder="Isi untuk mengganti" className="input num" autoComplete="new-password" />
        </div>
        <div>
          <div className="lbl mb-1.5">Proxy <span className="normal-case font-normal">· opsional</span></div>
          <input value={proxy} onChange={e => setProxy(e.target.value)} placeholder="http://user:pass@host:port atau socks5://host:port" className="input num" />
          {ex.id === 'tokocrypto' && (
            <p className="text-[11px] text-[#f0b90b] mt-1.5 leading-relaxed">Tokocrypto memblokir sebagian IP Indonesia (error 3701). Isi proxy bila koneksi gagal.</p>
          )}
        </div>
        <div>
          <div className="lbl mb-1.5">Mode</div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setMode('paper')} className={`btn btn-sm ${mode === 'paper' ? 'btn-buy' : 'btn-ghost'}`}>Demo</button>
            <button onClick={() => setMode('live')} className={`btn btn-sm ${mode === 'live' ? 'btn-sell' : 'btn-ghost'}`}>Riil</button>
          </div>
        </div>
        {result && (
          <div className={`flex items-start gap-2 text-[13px] rounded-md px-3 py-2 border ${result.ok ? 'border-[rgba(46,189,133,0.3)] bg-[rgba(46,189,133,0.07)]' : 'border-[rgba(246,70,93,0.3)] bg-[rgba(246,70,93,0.07)]'}`}>
            {result.ok ? <Icon.check size={14} className="txt-up mt-0.5" /> : <Icon.warn size={14} className="txt-down mt-0.5" />}
            <span className="num">{result.text}</span>
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={test} className="btn btn-ghost btn-sm flex-1"><Icon.refresh size={13} /> Uji koneksi</button>
          <button onClick={save} disabled={saving} className="btn btn-primary btn-sm flex-1">{saving ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </div>
    </section>
  );
}

export default function Pengaturan() {
  const [exchanges, setExchanges] = useState<ExchangeSettings[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [tgToken, setTgToken] = useState('');
  const [tgChats, setTgChats] = useState('');
  const [tgProxy, setTgProxy] = useState('');
  const [tgResult, setTgResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [defaultPaper, setDefaultPaper] = useState('true');

  const load = () => {
    api.get<ExchangeSettings[]>('/exchanges').then(setExchanges);
    api.get<Record<string, string>>('/settings').then(s => {
      setSettings(s);
      setTgChats(s.telegram_allowed_chat_ids || '');
      setTgProxy(s.proxy_telegram || '');
      setDefaultPaper(s.default_paper_mode || 'true');
    });
  };
  useEffect(load, []);

  const saveTelegram = async () => {
    setTgResult({ ok: true, text: 'Menyimpan…' });
    try {
      await api.put('/settings', {
        ...(tgToken ? { telegram_bot_token: tgToken } : {}),
        telegram_allowed_chat_ids: tgChats, proxy_telegram: tgProxy, default_paper_mode: defaultPaper
      });
      const r: any = await api.post('/telegram/test');
      setTgResult(r.ok
        ? { ok: true, text: `Tersimpan. Pesan uji terkirim ke ${r.sent_to} chat.` }
        : { ok: false, text: `Tersimpan, tetapi uji kirim gagal: ${r.error}` });
      setTgToken('');
      load();
    } catch (e: any) { setTgResult({ ok: false, text: e.message }); }
  };

  return (
    <div className="space-y-4 max-w-[1000px]">
      <div>
        <h2 className="text-[17px] font-bold tracking-tight">Pengaturan</h2>
        <p className="text-xs txt-3 mt-0.5">Kredensial disimpan terenkripsi di server dan tidak pernah ditampilkan penuh.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {exchanges.map(ex => <ExchangeSettingsCard key={ex.id} ex={ex} onSaved={load} />)}
      </div>

      <section className="panel p-4">
        <div className="text-[14px] font-semibold mb-1">Telegram</div>
        <p className="text-xs txt-3 mb-3">Perintah dan notifikasi hanya dilayani untuk chat ID yang terdaftar.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <div className="lbl mb-1.5">Token bot {settings.telegram_bot_token && <span className="normal-case font-normal">· tersimpan {settings.telegram_bot_token}</span>}</div>
            <input value={tgToken} onChange={e => setTgToken(e.target.value)} type="password" placeholder="Dari @BotFather" className="input num" />
          </div>
          <div>
            <div className="lbl mb-1.5">Chat ID diizinkan</div>
            <input value={tgChats} onChange={e => setTgChats(e.target.value)} placeholder="123456789, ..." className="input num" />
          </div>
          <div>
            <div className="lbl mb-1.5">Proxy Telegram</div>
            <input value={tgProxy} onChange={e => setTgProxy(e.target.value)} placeholder="socks5://host:port" className="input num" />
          </div>
        </div>
        {tgResult && (
          <div className={`flex items-start gap-2 text-[13px] rounded-md px-3 py-2 border mt-3 ${tgResult.ok ? 'border-[rgba(46,189,133,0.3)] bg-[rgba(46,189,133,0.07)]' : 'border-[rgba(246,70,93,0.3)] bg-[rgba(246,70,93,0.07)]'}`}>
            {tgResult.ok ? <Icon.check size={14} className="txt-up mt-0.5" /> : <Icon.warn size={14} className="txt-down mt-0.5" />}
            <span>{tgResult.text}</span>
          </div>
        )}
        <button onClick={saveTelegram} className="btn btn-primary btn-sm mt-3">Simpan dan uji kirim</button>
        <p className="text-[11px] txt-3 mt-2">Cara mendapatkan Chat ID: kirim pesan ke bot, lalu buka <span className="num">api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</span></p>
      </section>

      <section className="panel p-4">
        <div className="text-[14px] font-semibold mb-3">Umum</div>
        <label className="flex items-center gap-3 text-[13px] txt-2 cursor-pointer">
          <input type="checkbox" checked={defaultPaper === 'true'} onChange={e => setDefaultPaper(String(e.target.checked))} className="accent-[#4f7cff] w-4 h-4" />
          Bot baru default memakai mode Demo
        </label>
        <div className="mt-3 text-xs txt-3 flex items-center gap-2">
          <Icon.shield size={14} />
          Kunci enkripsi server: {settings.secret_key_ok === 'true' ? <span className="txt-up">terkonfigurasi</span> : <span className="txt-down">lemah — isi SECRET_KEY di .env</span>}
        </div>
      </section>
    </div>
  );
}
