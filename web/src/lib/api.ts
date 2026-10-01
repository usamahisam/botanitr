const BASE = '/api';

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  get: <T>(path: string) => req<T>(path),
  post: <T>(path: string, body?: any) => req<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: any) => req<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  del: <T>(path: string) => req<T>(path, { method: 'DELETE' })
};

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
  mode: string; auto_compound_pct: number; status: string;
  stats: { realized: number; wins: number; total: number; trades: number };
  trend: { date: string; pnl: number }[];
}
export interface LogRow {
  id: number; level: string; tag: string; bot_id: number | null;
  message: string; impact_rp: number | null; created_at: string;
}
export interface TradeRow {
  id: number; bot_id: number | null; exchange_id: string; pair: string; side: string;
  price: number; qty: number; fee: number; value: number; realized_pnl: number;
  mode: string; strategy_tag: string | null; note: string | null; created_at: string;
}
export interface Preset {
  id: string; nama: string; strategi: string; gaya: string; deskripsi: string;
  params: Record<string, any>; leverage_label: string; tp_sl_label: string; timeframe: string;
  skor: number; backtest: { winRate: number; profitPct: number; trades: number; maxDrawdownPct: number };
}
export interface PairRow {
  exchange_id: string; symbol: string; base: string; quote: string; label: string; kategori: string; min_lot: number;
}
