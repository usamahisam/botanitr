import { useEffect, useState } from 'react';
import { api, AuthUser } from '../lib/api';
import { Icon } from '../components/icons';

interface ManagedUser { id: number; username: string; role: string; created_at: string }

function UserManager({ me, onChanged }: { me: AuthUser; onChanged?: () => void }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [msg, setMsg] = useState('');

  const load = () => { api.get<ManagedUser[]>('/auth/users').then(setUsers).catch(() => {}); };
  useEffect(load, []);

  if (me.role !== 'admin') return null;

  const create = async () => {
    setMsg('');
    try {
      await api.post('/auth/users', { username, password, role });
      setUsername(''); setPassword(''); setMsg('User dibuat.');
      load(); onChanged?.();
    } catch (e: any) { setMsg(e.message); }
  };

  const remove = async (u: ManagedUser) => {
    if (!confirm(`Hapus user "${u.username}"? Data miliknya ikut terhapus? (bot & trade miliknya tetap tersimpan)`)) return;
    try { await api.del(`/auth/users/${u.id}`); load(); }
    catch (e: any) { setMsg(e.message); }
  };

  return (
    <section className="panel p-4">
      <div className="text-[14px] font-semibold mb-1">Pengguna</div>
      <p className="text-xs txt-3 mb-3">Setiap user punya bot, saldo paper, kredensial, dan notifikasi sendiri.</p>
      <table className="tbl mb-3">
        <thead><tr><th>ID</th><th>Username</th><th>Peran</th><th>Dibuat</th><th className="!text-right">Aksi</th></tr></thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id}>
              <td className="num txt-3">{u.id}</td>
              <td className="font-medium">{u.username}{u.id === me.id && <span className="tag tag-accent ml-2">ANDA</span>}</td>
              <td><span className={`tag ${u.role === 'admin' ? 'tag-warn' : 'tag-dim'}`}>{u.role === 'admin' ? 'ADMIN' : 'USER'}</span></td>
              <td className="txt-3 text-xs">{u.created_at.slice(0, 10)}</td>
              <td className="!text-right">
                {u.id !== me.id && <button onClick={() => remove(u)} className="btn btn-ghost btn-sm">Hapus</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 items-end">
        <div>
          <div className="lbl mb-1.5">Username baru</div>
          <input value={username} onChange={e => setUsername(e.target.value)} className="input" />
        </div>
        <div>
          <div className="lbl mb-1.5">Password (min. 6)</div>
          <input value={password} onChange={e => setPassword(e.target.value)} type="password" className="input" />
        </div>
        <div>
          <div className="lbl mb-1.5">Peran</div>
          <select value={role} onChange={e => setRole(e.target.value)} className="input">
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button onClick={create} disabled={!username || !password} className="btn btn-primary btn-sm !py-2">Tambah user</button>
      </div>
      {msg && <div className="text-[13px] txt-2 mt-2">{msg}</div>}
    </section>
  );
}

interface ExchangeSettings {
  id: string; name: string; mode: string; status: string; proxy_url: string | null;
  api_key_masked: string; has_credentials: boolean;
  api_version_setting?: string; api_version_active?: string | null;
}

function ExchangeSettingsCard({ ex, onSaved }: { ex: ExchangeSettings; onSaved: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [proxy, setProxy] = useState(ex.proxy_url || '');
  const [mode, setMode] = useState(ex.mode);
  const [apiVersion, setApiVersion] = useState(ex.api_version_setting || 'auto');
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
      if (ex.id === 'indodax') {
        await api.put('/settings', { indodax_api_version: apiVersion });
      }
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
        {ex.id === 'indodax' && (
          <div>
            <div className="lbl mb-1.5">Versi API {ex.api_version_active && (
              <span className="tag tag-accent ml-1">aktif: {ex.api_version_active}</span>
            )}</div>
            <select value={apiVersion} onChange={e => setApiVersion(e.target.value)} className="input">
              <option value="auto">Otomatis (deteksi dari kunci)</option>
              <option value="v1">v1 Legacy (/tapi)</option>
              <option value="v2">v2 (api.indodax.com)</option>
            </select>
            <p className="text-[11px] txt-3 mt-1.5 leading-relaxed">
              v2 butuh kunci khusus TAPIv2 (buat di indodax.com/trade_api). Paksa v2 dengan kunci v1 akan error —
              pilih Otomatis bila ragu.
            </p>
          </div>
        )}
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
        <button
          onClick={async () => {
            if (!confirm(`Reset saldo DEMO ${ex.name} ke nilai awal? Posisi demo berjalan ikut terhapus dari simulasi.`)) return;
            try {
              const r: any = await api.post(`/exchanges/${ex.id}/paper-reset`);
              setResult({ ok: true, text: `Saldo demo di-reset: ${r.seed.toLocaleString('id-ID')} ${r.quote}` });
              onSaved();
            } catch (e: any) { setResult({ ok: false, text: e.message }); }
          }}
          className="w-full mt-2 py-1.5 rounded-md bg-white/[0.03] hover:bg-white/[0.06] text-[11px] txt-3 hover:text-white transition-colors">
          Reset saldo demo ke awal
        </button>
      </div>
    </section>
  );
}

function PasswordChanger() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setMsg(null);
    try {
      await api.post('/auth/password', { current, password: next });
      setMsg({ ok: true, text: 'Password berhasil diganti.' });
      setCurrent(''); setNext('');
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
  };

  return (
    <section className="panel p-4">
      <div className="text-[14px] font-semibold mb-1">Ganti password</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <div>
          <div className="lbl mb-1.5">Password saat ini</div>
          <input value={current} onChange={e => setCurrent(e.target.value)} type="password" className="input" autoComplete="current-password" />
        </div>
        <div>
          <div className="lbl mb-1.5">Password baru (min. 6)</div>
          <input value={next} onChange={e => setNext(e.target.value)} type="password" className="input" autoComplete="new-password" />
        </div>
        <button onClick={save} disabled={!current || !next} className="btn btn-primary btn-sm !py-2">Ganti password</button>
      </div>
      {msg && <div className={`text-[13px] mt-2 ${msg.ok ? 'txt-up' : 'txt-down'}`}>{msg.text}</div>}
    </section>
  );
}

export default function Pengaturan({ me }: { me: AuthUser }) {
  const [exchanges, setExchanges] = useState<ExchangeSettings[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [tgToken, setTgToken] = useState('');
  const [tgChats, setTgChats] = useState('');
  const [tgProxy, setTgProxy] = useState('');
  const [tgResult, setTgResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [defaultPaper, setDefaultPaper] = useState('true');
  const [seedIdr, setSeedIdr] = useState('10000000');
  const [seedUsdt, setSeedUsdt] = useState('1000');
  const [seedMsg, setSeedMsg] = useState('');

  const load = () => {
    api.get<ExchangeSettings[]>('/exchanges').then(setExchanges);
    api.get<Record<string, string>>('/settings').then(s => {
      setSettings(s);
      setTgChats(s.telegram_allowed_chat_ids || '');
      setTgProxy(s.proxy_telegram || '');
      setDefaultPaper(s.default_paper_mode || 'true');
      if (s.paper_seed_idr) setSeedIdr(s.paper_seed_idr);
      if (s.paper_seed_usdt) setSeedUsdt(s.paper_seed_usdt);
    });
  };
  useEffect(load, []);

  const saveSeeds = async () => {
    setSeedMsg('');
    try {
      await api.put('/settings', { paper_seed_idr: seedIdr, paper_seed_usdt: seedUsdt });
      setSeedMsg('Modal awal demo tersimpan. Berlaku untuk reset berikutnya.');
    } catch (e: any) { setSeedMsg(e.message); }
  };

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

      <UserManager me={me} />
      <PasswordChanger />

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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {exchanges.map(ex => <ExchangeSettingsCard key={ex.id} ex={ex} onSaved={load} />)}
      </div>

      <section className="panel p-4">
        <div className="text-[14px] font-semibold mb-3">Umum</div>
        <label className="flex items-center gap-3 text-[13px] txt-2 cursor-pointer">
          <input type="checkbox" checked={defaultPaper === 'true'} onChange={e => setDefaultPaper(String(e.target.checked))} className="accent-[#4f7cff] w-4 h-4" />
          Bot baru default memakai mode Demo
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <div>
            <div className="lbl mb-1.5">Modal awal demo (IDR)</div>
            <input type="number" value={seedIdr} onChange={e => setSeedIdr(e.target.value)} className="input num" />
          </div>
          <div>
            <div className="lbl mb-1.5">Modal awal demo (USDT)</div>
            <input type="number" value={seedUsdt} onChange={e => setSeedUsdt(e.target.value)} className="input num" />
          </div>
        </div>
        <button onClick={saveSeeds} className="btn btn-ghost btn-sm mt-3">Simpan modal demo</button>
        {seedMsg && <div className="text-[13px] txt-up mt-2">{seedMsg}</div>}
        <div className="mt-3 text-xs txt-3 flex items-center gap-2">
          <Icon.shield size={14} />
          Kunci enkripsi server: {settings.secret_key_ok === 'true' ? <span className="txt-up">terkonfigurasi</span> : <span className="txt-down">lemah — isi SECRET_KEY di .env</span>}
        </div>
      </section>
    </div>
  );
}
