import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../lib/api';
import { resetSocket } from '../lib/ws';
import { Icon } from '../components/icons';

export default function Auth({ onAuth }: { onAuth: () => void }) {
  const navigate = useNavigate();
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get<{ needsSetup: boolean }>('/auth/status').then(s => setNeedsSetup(s.needsSetup)).catch(() => setNeedsSetup(false));
  }, []);

  const submit = async () => {
    setLoading(true); setErr('');
    try {
      const r = await api.post<{ token: string }>('/auth/' + (needsSetup ? 'setup' : 'login'), { username, password });
      setToken(r.token);
      resetSocket();
      onAuth();
      navigate('/');
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  };

  if (needsSetup === null) return <div className="txt-3 text-sm">Memuat…</div>;

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="panel w-full max-w-[380px] p-6">
        <div className="flex items-center gap-2.5 mb-1">
          <span className="text-[#2ebd85]"><Icon.logo size={24} /></span>
          <span className="font-bold text-[16px]">BOTANI<span className="txt-3 font-medium"> / TERMINAL</span></span>
        </div>
        <p className="text-xs txt-3 mb-5">
          {needsSetup
            ? 'Setup awal: buat akun admin. Data lama (bila ada) otomatis menjadi milik admin.'
            : 'Masuk untuk mengelola bot Anda.'}
        </p>
        {err && <div className="text-[13px] txt-down border border-[rgba(246,70,93,0.3)] bg-[rgba(246,70,93,0.07)] rounded-md px-3 py-2 mb-3">{err}</div>}
        <div className="lbl mb-1.5">Username</div>
        <input value={username} onChange={e => setUsername(e.target.value)} className="input mb-3" autoComplete="username"
          onKeyDown={e => e.key === 'Enter' && submit()} />
        <div className="lbl mb-1.5">Password{needsSetup ? ' (min. 6 karakter)' : ''}</div>
        <input value={password} onChange={e => setPassword(e.target.value)} type="password" className="input mb-4" autoComplete={needsSetup ? 'new-password' : 'current-password'}
          onKeyDown={e => e.key === 'Enter' && submit()} />
        <button onClick={submit} disabled={loading || !username || !password} className="btn btn-primary w-full">
          {loading ? 'Memproses…' : needsSetup ? 'Buat admin & mulai' : 'Masuk'}
        </button>
      </div>
    </div>
  );
}
