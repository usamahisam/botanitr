import { NavLink, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Bots from './pages/Bots';
import Wizard from './pages/Wizard';
import Riwayat from './pages/Riwayat';
import Alerts from './pages/Alerts';
import Pengaturan from './pages/Pengaturan';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/bots', label: 'Bot' },
  { to: '/wizard', label: 'Wizard AI' },
  { to: '/riwayat', label: 'Riwayat' },
  { to: '/alerts', label: 'Alert' },
  { to: '/pengaturan', label: 'Pengaturan' }
];

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 flex items-center gap-6 h-14">
          <div className="font-bold text-lg text-brand-600">🌱 Trading Botani</div>
          <nav className="flex gap-1">
            {NAV.map(n => (
              <NavLink key={n.to} to={n.to} end={n.end as any}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-lg text-sm font-medium transition ${isActive ? 'bg-brand-50 text-brand-600' : 'text-gray-600 hover:bg-gray-100'}`
                }>
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6">
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
