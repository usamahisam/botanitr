import { BotRow } from '../db/index.js';
import { Ticker } from '../exchange/base.js';

export interface StrategyContext {
  bot: BotRow;
  ticker: Ticker;
  /** Kurs USDT→IDR untuk konversi (1 jika exchange IDR) */
  usdtIdr: number;
  /** Ambil klines (untuk scalper). Bisa lempar error jika tidak tersedia. */
  getKlines(interval: string, limit: number): Promise<number[][]>;
  /** Saldo akun (untuk rebalance). Cache ringan di engine. */
  getBalances(): Promise<{ asset: string; free: number; locked: number }[]>;
  /** Harga last pair apa saja (untuk rebalance multi-aset). */
  getPrice(pair: string): Promise<number>;
  now: number;
}

export interface Action {
  type: 'buy' | 'sell';
  /** Untuk buy: nominal quote (IDR/USDT). Untuk sell: qty base. */
  amountQuote?: number;
  qtyBase?: number;
  reason: string;
  tag: string;
  /** Cost basis posisi yang ditutup (untuk realized PnL sell) */
  costBasis?: number;
  /** Impact Rp untuk log/notifikasi (estimasi) */
  impactRp?: number;
}

export interface Strategy {
  readonly name: string;
  readonly label: string;
  readonly defaultParams: Record<string, any>;
  init(params: any): any;
  onTick(ctx: StrategyContext, state: any, params: any): Action[] | Promise<Action[]>;
  describe(params: any): string;
}

export const registry = new Map<string, Strategy>();
export function registerStrategy(s: Strategy) { registry.set(s.name, s); }
export function getStrategy(name: string): Strategy {
  const s = registry.get(name);
  if (!s) throw new Error(`Strategi tidak dikenal: ${name}`);
  return s;
}

/** Helper: hitung lot dari budget */
export function lotFromBudget(budget: number, divisor: number): number {
  return Math.floor(budget / Math.max(1, divisor));
}
