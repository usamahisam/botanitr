import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Bots from './pages/Bots';
import Wizard from './pages/Wizard';
import Riwayat from './pages/Riwayat';
import Alerts from './pages/Alerts';
import Pengaturan from './pages/Pengaturan';
import { Icon } from './components/icons';
import { getSocket } from './lib/ws';

const NAV = [
  { to: '/', label: 'Dashboard', icon: Icon.grid, end: true },
  { to: '/bots', label: 'Bot', icon: Icon.cpu },
  { to: '/wizard', label: 'Strategi', icon: Icon.sliders },
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
  const loc = useLocation();

  useEffect(() => {
    const s = getSocket();
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    s.on('connect', on);
    s.on('disconnect', off);
    s.on('connected', on);
    return () => { s.off('connect', on); s.off('disconnect', off); s.off('connected', on); };
  }, [loc.pathname]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-white/[0.07]" style={{ background: 'rgba(9,13,19,0.92)', backdropFilter: 'blur(8px)' }}>
        <div className="max-w-[1400px] mx-auto px-4 h-[52px] flex items-center gap-6">
          <div className="flex items-center gap-2.5 select-none">
            <span className="text-[#2ebd85]"><Icon.logo size={22} /></span>
            <span className="font-bold text-[15px] tracking-tight">BOTANI<span className="txt-3 font-medium"> / TERMINAL</span></span>
          </div>
          <nav className="flex items-center gap-1">
            {NAV.map(n => (
              <NavLink key={n.to} to={n.to} end={n.end as any}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 h-8 rounded-md text-[13px] font-medium transition-colors ${isActive ? 'text-white bg-white/[0.08]' : 'txt-2 hover:text-white hover:bg-white/[0.04]'}`
                }>
                <n.icon size={15} />
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-4">
            <Clock />
            <span className={`flex items-center gap-1.5 text-xs font-medium ${connected ? 'txt-up' : 'txt-down'}`}>
              <Icon.dot size={7} />
              {connected ? 'LIVE' : 'OFFLINE'}
            </span>
          </div>
        </div>
      </header>
      <main className="max-w-[1400px] mx-auto px-4 py-5">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/bots" element={<Bots />} />
          <Route path="/wizard" element={<Wizard />} />
          <Route path="/riwayat" element={<Riwayat />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/pengaturan" element={<Pengaturan />} />
        </Routes>
      </main>
    </div>
  );
}
