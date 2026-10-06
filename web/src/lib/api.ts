const BASE = '/api';
const TOKEN_KEY = 'botani_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(BASE + path, { headers, ...options });
  if (res.status === 401 && !path.startsWith('/auth/')) {
    setToken(null);
    if (window.location.pathname !== '/login') window.location.href = '/login';
    throw new Error('Sesi berakhir, silakan login ulang');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

/** Unduh file (CSV) dengan token auth */
export async function download(path: string, filename: string) {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(BASE + path, { headers });
  if (res.status === 401 && !path.startsWith('/auth/')) {
    setToken(null);
    if (window.location.pathname !== '/login') window.location.href = '/login';
    throw new Error('Sesi berakhir, silakan login ulang');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  get: <T>(path: string) => req<T>(path),
  post: <T>(path: string, body?: any) => req<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: any) => req<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  del: <T>(path: string) => req<T>(path, { method: 'DELETE' })
};

export interface AuthUser { id: number; username: string; role: string }
export interface MarketPreset {
  id: number; user_id: number; name: string; strategy: string; params: Record<string, any>;
  description: string | null; budget_quote: number; public: number; installs: number;
  created_at: string; rating: number; ratings: number;
  bots_running: number; bots_total: number;
}

// ===== Types =====
export interface DashboardData {
  portfolio: { total_idr: number; change_24h_idr: number; change_24h_pct: number; usdt_idr: number };
  realized: { total_idr: number; today_idr: number; wins: number; total: number; rate: number };
  exchanges: ExchangeView[];
}
export interface ExchangeView {
  id: string; name: string; mode: string; status: string; quote_asset: string;
  kas_bebas: number; kas_bebas_idr: number; pending_value: number; pending_count: number;
  saldo_total_quote: number; saldo_total_idr: number;
  profit_harian: number; profit_total: number; posisi_pct: number;
  coins: { symbol: string; qty: number; value_quote: number; value_idr: number; porsi_pct: number }[];
  error?: string;
}
export interface Bot {
  id: number; name: string; exchange_id: string; pair: string; strategy: string;
  params: Record<string, any>; budget_idr: number; current_budget: number; lot: number;
  cash_quote: number | null; open_cost_quote: number;
  sellDist: { pctAway: number; label: string } | null;
  mode: string; auto_compound_pct: number; status: string; user_id: number; username?: string;
  stats: { realized: number; wins: number; total: number; trades: number };
  trend: { date: string; pnl: number }[];
}
export interface LogRow {
  id: number; level: string; tag: string; bot_id: number | null;
  message: string; impact_rp: number | null; created_at: string;
}
export interface TradeRow {
  id: number; bot_id: number | null; bot_name?: string | null; exchange_id: string; pair: string; side: string;
  price: number; qty: number; fee: number; value: number; realized_pnl: number;
  mode: string; strategy_tag: string | null; note: string | null; created_at: string;
  username?: string;
}
export interface Preset {
  id: string; nama: string; strategi: string; gaya: string; deskripsi: string;
  params: Record<string, any>; leverage_label: string; tp_sl_label: string; timeframe: string;
  skor: number; backtest: { winRate: number; profitPct: number; trades: number; maxDrawdownPct: number; note?: string };
  market?: { key: string; vol: string; label: string; trendPct: number; interval: string; candles: number };
  lotWarning?: string;
}
export interface PairRow {
  exchange_id: string; symbol: string; base: string; quote: string; label: string; kategori: string; min_lot: number;
}
export interface MarketRow {
  pair: string; symbol: string; last: number; high: number; low: number;
}
