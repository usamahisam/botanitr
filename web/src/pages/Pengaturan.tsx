import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface ExchangeSettings {
  id: string; name: string; mode: string; status: string; proxy_url: string | null;
  api_key_masked: string; has_credentials: boolean;
}

function ExchangeSettingsCard({ ex, onSaved }: { ex: ExchangeSettings; onSaved: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [proxy, setProxy] = useState(ex.proxy_url || '');
  const [mode, setMode] = useState(ex.mode);
  const [testResult, setTestResult] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true); setTestResult('');
    try {
      await api.put(`/exchanges/${ex.id}`, {
        ...(apiKey ? { api_key: apiKey } : {}),
        ...(apiSecret ? { api_secret: apiSecret } : {}),
        proxy_url: proxy, mode
      });
      setTestResult('✅ Tersimpan');
      setApiKey(''); setApiSecret('');
      onSaved();
    } catch (e: any) { setTestResult(`❌ ${e.message}`); }
    finally { setSaving(false); }
  };

  const test = async () => {
    setTestResult('Menguji…');
    try {
      const r: any = await api.post(`/exchanges/${ex.id}/test`);
      setTestResult(r.ok ? `✅ Koneksi OK (${r.latency_ms} ms)` : `❌ ${r.error}`);
    } catch (e: any) { setTestResult(`❌ ${e.message}`); }
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold">{ex.name}</h3>
        <span className={`badge ${ex.mode === 'live' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
          {ex.mode === 'live' ? 'Riil' : 'Demo'}
        </span>
      </div>
      <div className="space-y-3 text-sm">
        <div>
          <label className="text-xs text-gray-500">API Key {ex.has_credentials && <span className="text-gray-400">(tersimpan: {ex.api_key_masked})</span>}</label>
          <input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Isi untuk mengganti" className="w-full mt-1 rounded-xl border border-gray-300 px-3 py-2" />
        </div>
        <div>
          <label className="text-xs text-gray-500">API Secret</label>
          <input value={apiSecret} onChange={e => setApiSecret(e.target.value)} type="password" placeholder="Isi untuk mengganti" className="w-full mt-1 rounded-xl border border-gray-300 px-3 py-2" />
        </div>
        <div>
          <label className="text-xs text-gray-500">Proxy (opsional, mis. http://user:pass@host:port atau socks5://host:port)</label>
          <input value={proxy} onChange={e => setProxy(e.target.value)} placeholder="Kosongkan untuk koneksi langsung" className="w-full mt-1 rounded-xl border border-gray-300 px-3 py-2" />
          {ex.id === 'tokocrypto' && <p className="text-xs text-amber-600 mt-1">⚠️ Tokocrypto sering memblokir IP Indonesia — isi proxy jika koneksi gagal (error 3701).</p>}
        </div>
        <div>
          <label className="text-xs text-gray-500">Mode Trading</label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <button onClick={() => setMode('paper')} className={`py-2 rounded-xl text-sm font-medium ${mode === 'paper' ? 'bg-amber-400 text-white' : 'bg-gray-100'}`}>📄 Demo</button>
            <button onClick={() => setMode('live')} className={`py-2 rounded-xl text-sm font-medium ${mode === 'live' ? 'bg-emerald-500 text-white' : 'bg-gray-100'}`}>💰 Riil</button>
          </div>
        </div>
        {testResult && <div className="p-3 rounded-xl bg-gray-50 text-sm">{testResult}</div>}
        <div className="flex gap-2">
          <button onClick={test} className="flex-1 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 font-medium">🔌 Test Koneksi</button>
          <button onClick={save} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold disabled:opacity-50">
            {saving ? 'Menyimpan…' : '💾 Simpan'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Pengaturan() {
  const [exchanges, setExchanges] = useState<ExchangeSettings[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [tgToken, setTgToken] = useState('');
  const [tgChats, setTgChats] = useState('');
  const [tgProxy, setTgProxy] = useState('');
  const [tgResult, setTgResult] = useState('');
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
    setTgResult('Menyimpan…');
    try {
      await api.put('/settings', {
        ...(tgToken ? { telegram_bot_token: tgToken } : {}),
        telegram_allowed_chat_ids: tgChats, proxy_telegram: tgProxy, default_paper_mode: defaultPaper
      });
      const r: any = await api.post('/telegram/test');
      setTgResult(r.ok ? `✅ Pesan tes terkirim ke ${r.sent_to} chat` : `⚠️ Tersimpan, tapi tes kirim gagal: ${r.error}`);
      setTgToken('');
      load();
    } catch (e: any) { setTgResult(`❌ ${e.message}`); }
  };

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-bold">Pengaturan</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {exchanges.map(ex => <ExchangeSettingsCard key={ex.id} ex={ex} onSaved={load} />)}
      </div>

      <div className="card">
        <h3 className="font-bold mb-3">Telegram Bot</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div>
            <label className="text-xs text-gray-500">Bot Token {settings.telegram_bot_token && <span className="text-gray-400">(tersimpan: {settings.telegram_bot_token})</span>}</label>
            <input value={tgToken} onChange={e => setTgToken(e.target.value)} type="password" placeholder="Dari @BotFather — isi untuk mengganti" className="w-full mt-1 rounded-xl border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="text-xs text-gray-500">Chat ID yang Diizinkan (pisahkan koma)</label>
            <input value={tgChats} onChange={e => setTgChats(e.target.value)} placeholder="mis. 123456789" className="w-full mt-1 rounded-xl border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="text-xs text-gray-500">Proxy Telegram (opsional)</label>
            <input value={tgProxy} onChange={e => setTgProxy(e.target.value)} placeholder="socks5://host:port" className="w-full mt-1 rounded-xl border border-gray-300 px-3 py-2" />
          </div>
        </div>
        {tgResult && <div className="mt-3 p-3 rounded-xl bg-gray-50 text-sm">{tgResult}</div>}
        <button onClick={saveTelegram} className="mt-3 px-5 py-2.5 rounded-xl bg-brand-500 text-white font-semibold hover:bg-brand-600">
          💾 Simpan & Test Kirim
        </button>
        <p className="text-xs text-gray-400 mt-2">Dapatkan Chat ID: kirim pesan apa saja ke bot Anda, lalu buka https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</p>
      </div>

      <div className="card">
        <h3 className="font-bold mb-3">Umum</h3>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={defaultPaper === 'true'} onChange={e => setDefaultPaper(String(e.target.checked))} />
          Mode <b>Demo</b> default untuk bot baru (disarankan)
        </label>
        <div className="mt-3 text-xs text-gray-400">
          SECRET_KEY server: {settings.secret_key_ok === 'true' ? '✅ terkonfigurasi (≥32 karakter)' : '⚠️ lemah — isi di .env'}
        </div>
        <button onClick={saveTelegram} className="mt-3 px-5 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 font-medium text-sm">💾 Simpan Umum</button>
      </div>
    </div>
  );
}
