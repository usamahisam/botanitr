import { useCallback, useEffect, useState } from 'react';
import { NavLink, Route, Routes, useNavigate, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Bots from './pages/Bots';
import Wizard from './pages/Wizard';
import Riwayat from './pages/Riwayat';
import Alerts from './pages/Alerts';
import Market from './pages/Market';
import Pengaturan from './pages/Pengaturan';
import Auth from './pages/Auth';
import { Icon } from './components/icons';
import { getSocket, resetSocket } from './lib/ws';
import { api, getToken, setToken, AuthUser } from './lib/api';

const NAV = [
  { to: '/', label: 'Dashboard', icon: Icon.grid, end: true },
  { to: '/bots', label: 'Bot', icon: Icon.cpu },
  { to: '/wizard', label: 'Strategi', icon: Icon.sliders },
  { to: '/market', label: 'Marketplace', icon: Icon.wallet },
  { to: '/riwayat', label: 'Riwayat', icon: Icon.history },
  { to: '/alerts', label: 'Peringatan', icon: Icon.bell },
  { to: '/pengaturan', label: 'Pengaturan', icon: Icon.gear }
];

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="num text-xs txt-2">
      {now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} WIB
    </span>
  );
}

export default function App() {
  const [connected, setConnected] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const navigate = useNavigate();

  const loadMe = useCallback(() => {
    if (!getToken()) { setUser(null); setChecking(false); return; }
    api.get<{ user: AuthUser }>('/auth/me')
      .then(r => setUser(r.user))
      .catch(() => { setUser(null); setToken(null); })
      .finally(() => setChecking(false));
  }, []);

  useEffect(loadMe, [loadMe]);

  useEffect(() => {
    if (!user) { setConnected(false); return; }
    const s = getSocket();
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    s.on('connect', on);
    s.on('disconnect', off);
    s.on('connected', on);
    return () => { s.off('connect', on); s.off('disconnect', off); s.off('connected', on); };
  }, [user]);

  const logout = async () => {
    try { await api.post('/auth/logout'); } catch { /* abaikan */ }
    setToken(null);
    resetSocket();
    setUser(null);
    navigate('/login');
  };

  if (checking) return <div className="min-h-screen flex items-center justify-center txt-3 text-sm">Memuat…</div>;

  if (!user) {
    return (
      <div className="min-h-screen">
        <main className="max-w-[1400px] mx-auto px-4 py-6">
          <Routes>
            <Route path="/login" element={<Auth onAuth={loadMe} />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-white/[0.07]" style={{ background: 'rgba(9,13,19,0.92)', backdropFilter: 'blur(8px)' }}>
        <div className="max-w-[1400px] mx-auto px-3 sm:px-4 h-[52px] flex items-center gap-3 sm:gap-6">
          <div className="flex items-center gap-2.5 select-none">
            <img src="/logo.svg" alt="Botani" width={26} height={26} className="rounded-[7px]" />
            <span className="font-bold text-[15px] tracking-tight hidden min-[400px]:inline">BOTANI<span className="txt-3 font-medium"> / TERMINAL</span></span>
          </div>
          <nav className="hidden md:flex items-center gap-1 overflow-x-auto">
            {NAV.map(n => (
              <NavLink key={n.to} to={n.to} end={n.end as any}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 h-8 rounded-md text-[13px] font-medium transition-colors whitespace-nowrap ${isActive ? 'text-white bg-white/[0.08]' : 'txt-2 hover:text-white hover:bg-white/[0.04]'}`
                }>
                <n.icon size={15} />
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 sm:gap-4">
            <span className="hidden sm:inline"><Clock /></span>
            <span className={`flex items-center gap-1.5 text-xs font-medium ${connected ? 'txt-up' : 'txt-down'}`}>
              <Icon.dot size={7} />
              {connected ? 'LIVE' : 'OFFLINE'}
            </span>
            <span className="text-xs txt-2 hidden lg:inline" title={user.role}>{user.username}{user.role === 'admin' ? ' · admin' : ''}</span>
            <button onClick={logout} className="btn btn-ghost btn-sm btn-icon" title="Keluar">
              <Icon.power size={14} />
            </button>
          </div>
        </div>
      </header>
      {/* Navigasi bawah khusus HP portrait — di desktop tetap menu atas */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 border-t border-white/[0.08]" style={{ background: 'rgba(9,13,19,0.96)', backdropFilter: 'blur(8px)', paddingBottom: 'env(safe-area-inset-bottom)' }} aria-label="Navigasi utama">
        <div className="grid grid-cols-7 px-1">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end as any}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${isActive ? 'text-white' : 'txt-3'}`
              }>
              <n.icon size={19} />
              {n.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main className="max-w-[1400px] mx-auto px-4 py-5 pb-24 md:pb-5">
        <Routes>
          <Route path="/" element={<Dashboard admin={user.role === 'admin'} />} />
          <Route path="/bots" element={<Bots admin={user.role === 'admin'} />} />
          <Route path="/wizard" element={<Wizard admin={user.role === 'admin'} />} />
          <Route path="/market" element={<Market admin={user.role === 'admin'} />} />
          <Route path="/riwayat" element={<Riwayat admin={user.role === 'admin'} />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/pengaturan" element={<Pengaturan me={user} />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
