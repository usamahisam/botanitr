import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

fs.mkdirSync(config.dataDir, { recursive: true });
export const db: Database.Database = new Database(path.join(config.dataDir, 'trading-botani.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Jalankan schema
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Migrasi ringan: tambah kolom jika belum ada (untuk DB yang sudah ada)
function ensureColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  if (!cols.some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('bots', 'max_daily_loss_pct', 'max_daily_loss_pct REAL NOT NULL DEFAULT 0');

// ===== Seed =====
const now = () => new Date().toISOString();

export function seedIfEmpty() {
  const exCount = (db.prepare('SELECT COUNT(*) c FROM exchanges').get() as any).c;
  if (exCount === 0) {
    const ins = db.prepare(`INSERT INTO exchanges (id, name, mode, min_lot_idr) VALUES (?, ?, 'paper', ?)`);
    ins.run('indodax', 'Indodax', 10000);
    ins.run('tokocrypto', 'Tokocrypto', 2);
  }

  const pairCount = (db.prepare('SELECT COUNT(*) c FROM default_pairs').get() as any).c;
  if (pairCount === 0) {
    const ins = db.prepare(`INSERT INTO default_pairs (exchange_id, symbol, base, quote, label, kategori, min_lot, sort) VALUES (?,?,?,?,?,?,?,?)`);
    const indodaxPairs: [string, string, string, string, number, number][] = [
      ['BTCIDR', 'BTC', 'Bitcoin', 'Blue-chip', 50000, 1],
      ['ETHIDR', 'ETH', 'Ethereum', 'Blue-chip', 25000, 2],
      ['XRPIDR', 'XRP', 'XRP', 'Mid-cap likuid', 10000, 3],
      ['SOLIDR', 'SOL', 'Solana', 'Mid-cap likuid', 10000, 4],
      ['DOGEIDR', 'DOGE', 'Dogecoin', 'Meme likuid', 10000, 5],
      ['ADAIDR', 'ADA', 'Cardano', 'Mid-cap', 10000, 6],
      ['SUIIDR', 'SUI', 'Sui', 'Layer-1', 10000, 7],
      ['ONDOIDR', 'ONDO', 'Ondo', 'RWA', 10000, 8],
      ['LINKIDR', 'LINK', 'Chainlink', 'Blue-chip', 25000, 9],
      ['TRXIDR', 'TRX', 'Tron', 'Mid-cap', 10000, 10]
    ];
    for (const [symbol, base, label, kategori, minLot, sort] of indodaxPairs) {
      ins.run('indodax', symbol, base, 'IDR', label, kategori, minLot, sort);
    }
    const tokoPairs: [string, string, string, number, number][] = [
      ['BTCUSDT', 'BTC', 'Bitcoin', 5, 1],
      ['ETHUSDT', 'ETH', 'Ethereum', 5, 2],
      ['XRPUSDT', 'XRP', 'XRP', 2, 3],
      ['SOLUSDT', 'SOL', 'Solana', 2, 4],
      ['DOGEUSDT', 'DOGE', 'Dogecoin', 2, 5],
      ['ADAUSDT', 'ADA', 'Cardano', 2, 6],
      ['SUIUSDT', 'SUI', 'Sui', 2, 7],
      ['LINKUSDT', 'LINK', 'Chainlink', 2, 8],
      ['BNBUSDT', 'BNB', 'BNB', 2, 9],
      ['AVAXUSDT', 'AVAX', 'Avalanche', 2, 10]
    ];
    for (const [symbol, base, label, minLot, sort] of tokoPairs) {
      ins.run('tokocrypto', symbol, base, 'USDT', label, 'Blue-chip', minLot, sort);
    }
  }
}
seedIfEmpty();

// ===== Settings =====
export const settings = {
  get(key: string, def = ''): string {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as any;
    return row?.value ?? def;
  },
  set(key: string, value: string) {
    db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  },
  all(): Record<string, string> {
    const rows = db.prepare('SELECT key,value FROM settings').all() as any[];
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  }
};

// ===== Typed rows =====
export interface ExchangeRow {
  id: string; name: string; api_key_enc: string | null; api_secret_enc: string | null;
  mode: 'paper' | 'live'; proxy_url: string | null; min_lot_idr: number;
  enabled: number; last_sync: string | null; status: string;
}
export interface BotRow {
  id: number; name: string; exchange_id: string; pair: string; strategy: string;
  params: string; budget_idr: number; current_budget: number; lot: number;
  mode: 'paper' | 'live'; auto_compound_pct: number; status: 'running' | 'paused' | 'stopped';
  state: string; error_count: number; max_daily_loss_pct: number; created_at: string; updated_at: string;
}
export interface TradeRow {
  id: number; bot_id: number | null; exchange_id: string; pair: string; side: 'buy' | 'sell';
  price: number; qty: number; fee: number; value: number; realized_pnl: number; cost_basis: number;
  mode: 'paper' | 'live'; order_id: string | null; client_order_id: string | null;
  strategy_tag: string | null; note: string | null; created_at: string;
}
export interface LogRow {
  id: number; level: string; tag: string; bot_id: number | null; message: string;
  impact_rp: number | null; meta: string | null; created_at: string;
}

export const queries = {
  getExchange: db.prepare('SELECT * FROM exchanges WHERE id=?'),
  allExchanges: db.prepare('SELECT * FROM exchanges ORDER BY id'),
  insertBot: db.prepare(`INSERT INTO bots (name, exchange_id, pair, strategy, params, budget_idr, current_budget, lot, mode, auto_compound_pct, status, state, max_daily_loss_pct, created_at, updated_at)
    VALUES (@name, @exchange_id, @pair, @strategy, @params, @budget_idr, @current_budget, @lot, @mode, @auto_compound_pct, @status, @state, @max_daily_loss_pct, @created_at, @updated_at)`),
  getBot: db.prepare('SELECT * FROM bots WHERE id=?'),
  allBots: db.prepare('SELECT * FROM bots ORDER BY id DESC'),
  runningBots: db.prepare(`SELECT * FROM bots WHERE status='running'`),
  updateBotState: db.prepare('UPDATE bots SET state=?, updated_at=? WHERE id=?'),
  updateBotBudget: db.prepare('UPDATE bots SET current_budget=?, lot=?, updated_at=? WHERE id=?'),
  setBotStatus: db.prepare('UPDATE bots SET status=?, updated_at=? WHERE id=?'),
  setBotError: db.prepare('UPDATE bots SET error_count=?, updated_at=? WHERE id=?'),
  deleteBot: db.prepare('DELETE FROM bots WHERE id=?'),
  insertTrade: db.prepare(`INSERT INTO trades (bot_id, exchange_id, pair, side, price, qty, fee, value, realized_pnl, cost_basis, mode, order_id, client_order_id, strategy_tag, note, created_at)
    VALUES (@bot_id, @exchange_id, @pair, @side, @price, @qty, @fee, @value, @realized_pnl, @cost_basis, @mode, @order_id, @client_order_id, @strategy_tag, @note, @created_at)`),
  tradeByClientId: db.prepare('SELECT * FROM trades WHERE client_order_id=?'),
  insertLog: db.prepare('INSERT INTO logs (level, tag, bot_id, message, impact_rp, meta, created_at) VALUES (?,?,?,?,?,?,?)'),
  latestSnapshot: db.prepare(`SELECT * FROM balance_snapshots WHERE exchange_id=? ORDER BY created_at DESC LIMIT 200`),
  upsertPaperBalance: db.prepare(`INSERT INTO paper_balances (exchange_id, asset, free, locked) VALUES (?,?,?,?)
    ON CONFLICT(exchange_id, asset) DO UPDATE SET free=excluded.free, locked=excluded.locked`),
  paperBalances: db.prepare('SELECT * FROM paper_balances WHERE exchange_id=?'),
  cacheTicker: db.prepare(`INSERT INTO ticker_cache (exchange_id, pair, data, fetched_at) VALUES (?,?,?,?)
    ON CONFLICT(exchange_id, pair) DO UPDATE SET data=excluded.data, fetched_at=excluded.fetched_at`),
  getCachedTicker: db.prepare('SELECT data, fetched_at FROM ticker_cache WHERE exchange_id=? AND pair=?')
};

export { now };
