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

// Migrasi ringan: tambah kolom jika belum ada (HARUS sebelum schema,
// karena schema membuat index atas kolom-kolom ini)
function ensureColumn(table: string, column: string, ddl: string) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    if (cols.length > 0 && !cols.some(c => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  } catch { /* tabel belum ada → schema di bawah yang membuatnya */ }
}
ensureColumn('bots', 'max_daily_loss_pct', 'max_daily_loss_pct REAL NOT NULL DEFAULT 0');
ensureColumn('bots', 'market_preset_id', 'market_preset_id INTEGER');
for (const t of ['bots', 'trades', 'logs', 'balance_snapshots', 'paper_balances', 'price_alerts']) {
  ensureColumn(t, 'user_id', 'user_id INTEGER NOT NULL DEFAULT 0');
}

// Jalankan schema
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Migrasi v2: settings & exchanges ke composite PK (key,user_id) / (id,user_id)
function tablePk(table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as any[])
    .filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk).map(c => c.name);
}
function migrateComposite(table: string, cols: string, pk: string) {
  const current = tablePk(table);
  const want = pk.split(',').map(s => s.trim());
  if (JSON.stringify(current) === JSON.stringify(want)) return;
  db.exec(`CREATE TABLE ${table}_new (${cols}, PRIMARY KEY (${pk}))`);
  const existing = (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map(c => c.name);
  const common = cols.split(',').map(c => c.trim().split(' ')[0]).filter(c => existing.includes(c));
  const list = common.join(',');
  db.exec(`INSERT INTO ${table}_new (${list}) SELECT ${list} FROM ${table}`);
  db.exec(`DROP TABLE ${table}`);
  db.exec(`ALTER TABLE ${table}_new RENAME TO ${table}`);
}
migrateComposite('settings', 'key TEXT NOT NULL, value TEXT, user_id INTEGER NOT NULL DEFAULT 0', 'key, user_id');
migrateComposite('exchanges', `id TEXT NOT NULL, name TEXT NOT NULL, api_key_enc TEXT, api_secret_enc TEXT,
  mode TEXT NOT NULL DEFAULT 'paper', proxy_url TEXT, min_lot_idr REAL NOT NULL DEFAULT 10000,
  enabled INTEGER NOT NULL DEFAULT 1, last_sync TEXT, status TEXT NOT NULL DEFAULT 'unknown',
  user_id INTEGER NOT NULL DEFAULT 0`, 'id, user_id');
migrateComposite('paper_balances', `exchange_id TEXT NOT NULL, asset TEXT NOT NULL,
  free REAL NOT NULL DEFAULT 0, locked REAL NOT NULL DEFAULT 0, user_id INTEGER NOT NULL DEFAULT 0`,
  'exchange_id, asset, user_id');

// ===== Seed =====
const now = () => new Date().toISOString();

const DEFAULT_EXCHANGES: [string, string, number][] = [
  ['indodax', 'Indodax', 10000],
  ['tokocrypto', 'Tokocrypto', 2],
  ['binance', 'Binance', 5],
  ['bittime', 'Bittime', 10000]
];

/** Pastikan baris exchange ada untuk user (dipakai saat user baru dibuat) */
export function ensureUserExchanges(userId: number) {
  const ins = db.prepare(`INSERT OR IGNORE INTO exchanges (id, name, mode, min_lot_idr, user_id) VALUES (?, ?, 'paper', ?, ?)`);
  for (const [id, name, minLot] of DEFAULT_EXCHANGES) ins.run(id, name, minLot, userId);
}

const INDODAX_PAIRS: [string, string, string, string, number, number][] = [
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
const USDT_PAIRS: [string, string, string, number, number][] = [
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

export function seedIfEmpty() {
  const exCount = (db.prepare('SELECT COUNT(*) c FROM exchanges').get() as any).c;
  if (exCount === 0) ensureUserExchanges(0);

  const pairCount = (db.prepare('SELECT COUNT(*) c FROM default_pairs').get() as any).c;
  if (pairCount === 0) {
    const ins = db.prepare(`INSERT INTO default_pairs (exchange_id, symbol, base, quote, label, kategori, min_lot, sort) VALUES (?,?,?,?,?,?,?,?)`);
    for (const [symbol, base, label, kategori, minLot, sort] of INDODAX_PAIRS) {
      ins.run('indodax', symbol, base, 'IDR', label, kategori, minLot, sort);
    }
    for (const [symbol, base, label, minLot, sort] of USDT_PAIRS) {
      ins.run('tokocrypto', symbol, base, 'USDT', label, 'Blue-chip', minLot, sort);
    }
  }
  // Pair Binance bila belum ada (untuk DB lama)
  const binCount = (db.prepare(`SELECT COUNT(*) c FROM default_pairs WHERE exchange_id='binance'`).get() as any).c;
  if (binCount === 0) {
    const ins = db.prepare(`INSERT INTO default_pairs (exchange_id, symbol, base, quote, label, kategori, min_lot, sort) VALUES (?,?,?,?,?,?,?,?)`);
    for (const [symbol, base, label, minLot, sort] of USDT_PAIRS) {
      ins.run('binance', symbol, base, 'USDT', label, 'Blue-chip', minLot, sort);
    }
  }
  // Binance exchange row bila belum ada
  const hasBinance = (db.prepare(`SELECT COUNT(*) c FROM exchanges WHERE id='binance'`).get() as any).c;
  if (!hasBinance) {
    db.prepare(`INSERT OR IGNORE INTO exchanges (id, name, mode, min_lot_idr, user_id) VALUES ('binance', 'Binance', 'paper', 5, 0)`).run();
  }
  // Pair Bittime (IDR, terkonfirmasi live) bila belum ada
  const bittimeCount = (db.prepare(`SELECT COUNT(*) c FROM default_pairs WHERE exchange_id='bittime'`).get() as any).c;
  if (bittimeCount === 0) {
    const ins = db.prepare(`INSERT INTO default_pairs (exchange_id, symbol, base, quote, label, kategori, min_lot, sort) VALUES (?,?,?,?,?,?,?,?)`);
    const bittimePairs: [string, string, string, string, number, number][] = [
      ['BTCIDR', 'BTC', 'Bitcoin', 'Blue-chip', 50000, 1],
      ['ETHIDR', 'ETH', 'Ethereum', 'Blue-chip', 25000, 2],
      ['XRPIDR', 'XRP', 'XRP', 'Mid-cap likuid', 10000, 3],
      ['TRXIDR', 'TRX', 'Tron', 'Mid-cap', 10000, 4],
      ['BNBIDR', 'BNB', 'BNB', 'Blue-chip', 20000, 5],
      ['LTCIDR', 'LTC', 'Litecoin', 'Blue-chip', 25000, 6],
      ['NEARIDR', 'NEAR', 'NEAR Protocol', 'Mid-cap', 10000, 7],
      ['DOTIDR', 'DOT', 'Polkadot', 'Mid-cap', 10000, 8],
      ['UNIIDR', 'UNI', 'Uniswap', 'DeFi', 10000, 9],
      ['SUIIDR', 'SUI', 'Sui', 'Layer-1', 10000, 10]
    ];
    for (const [symbol, base, label, kategori, minLot, sort] of bittimePairs) {
      ins.run('bittime', symbol, base, 'IDR', label, kategori, minLot, sort);
    }
  }
  // Bittime exchange row bila belum ada
  const hasBittime = (db.prepare(`SELECT COUNT(*) c FROM exchanges WHERE id='bittime'`).get() as any).c;
  if (!hasBittime) {
    db.prepare(`INSERT OR IGNORE INTO exchanges (id, name, mode, min_lot_idr, user_id) VALUES ('bittime', 'Bittime', 'paper', 10000, 0)`).run();
  }
  seedMarketplace();
}

/**
 * Seed marketplace preset bawaan sistem. Idempoten per nama: DB lama yang
 * hanya punya 5 preset otomatis dilengkapi preset baru + preset lama
 * disegarkan ke parameter terbaru (tanpa menyentuh preset milik user).
 */
function seedMarketplace() {
  const rows: [string, string, string, string, number][] = [
    ['Scalper Pro 1m', 'scalper', JSON.stringify({ timeframe: '1m', ema_fast: 20, ema_slow: 50, rsi_period: 14, rsi_entry: 55, rsi_overbought: 70, tp_pct: 1.0, sl_pct: 0.8, trailing_pct: 0.8 }), 'Scalping cepat: masuk saat tren naik + RSI adem, TP fee-aware + trailing.', 100000],
    ['Grid Sideways', 'grid', JSON.stringify({ lower_pct: 3, upper_pct: 3, levels: 6, profit_pct: 0.5, auto_range: true, rsi_filter: true }), 'Panen tiap level sendiri-sendiri saat cuan bersih. Lebar grid ikut volatilitas.', 100000],
    ['DCA Akumulasi', 'dca', JSON.stringify({ drop_pct: 2, take_profit_pct: 3, max_buys: 5, partial_pct: 50 }), 'Beli bertahap tiap turun 2%, panen parsial cepat + sisa di target +3%.', 100000],
    ['DCA All-In Cadangan', 'dca', JSON.stringify({ drop_pct: 2, take_profit_pct: 2, max_buys: 4, partial_pct: 50, all_in: 'cadangan', sl_pct: 4 }), 'Lot 1 langsung masuk, sisanya averaging. Stop-rugi -4%.', 100000],
    ['Flash Scalper', 'scalper', JSON.stringify({ timeframe: '1m', ema_fast: 12, ema_slow: 30, rsi_period: 7, rsi_entry: 60, rsi_overbought: 75, tp_pct: 1.2, sl_pct: 0.7, trailing_pct: 0.8, cooldown_min: 1, max_trades_per_day: 20, turbo: true }), 'Tervalidasi replay 3 hari trending: ~13 trade/hari, bersih 0,38%/trade, DD 2,5% (fee 0,1% + selip). Butuh pasar bergerak — jangan dipakai di Indodax/pasar datar.', 100000],
    ['Harvester Aman', 'harvester', JSON.stringify({ drop_pct: 2.5, harvest_pct: 2, max_buys: 8 }), 'Akumulasi saat turun, panen modal cair + profit (ambang ikut fee exchange).', 100000],
    ['Rebalance 50/30', 'rebalance', JSON.stringify({ targets: { BTC: 50, ETH: 30 }, threshold_pct: 2, interval_min: 60 }), 'Jaga alokasi BTC 50% + ETH 30%, sisanya kas. Cek tiap jam.', 100000],
    ['Revert Pantulan', 'revert', JSON.stringify({ timeframe: '5m', rsi_len: 3, oversold: 20, exit_rsi: 65, trend_sma: 100, tp_pct: 1.0, sl_pct: 3.0 }), 'Beli saat oversold ekstrem dalam tren naik, jual saat memantul. Sinyal sering.', 100000],
    ['Bollinger Reversal', 'bollinger', JSON.stringify({ timeframe: '5m', bb_period: 20, bb_mult: 2, entry_b: 0.0, exit_b: 0.5, tp_pct: 1.0, sl_pct: 3.0 }), 'Beli di lower band, jual di tengah band. Raja pasar sideways berosilasi.', 100000],
    ['Breakout Mikro', 'breakout', JSON.stringify({ timeframe: '5m', donchian_n: 20, tp_pct: 0.8, sl_pct: 1.2, trail_atr_mult: 1.5 }), 'Ikut tembusan harga tercepat + TP ketat + trailing ATR.', 100000],
    ['Dynamic Ping-Pong', 'dynamic', JSON.stringify({ step_pct: 1.0, levels: 8, profit_pct: 0.5, auto_step: true, rsi_filter: true, trend_lot_mult: 0.5, max_trend_buys: 3, max_exposure_pct: 100, sl_pct: 5.0 }), 'Beli saat turun, ikut saat naik, panen tiap level berkali-kali. Paling pintar.', 100000]
  ];
  const have = new Set((db.prepare('SELECT name FROM market_presets WHERE user_id=0').all() as any[]).map(r => r.name));
  const ins = db.prepare(`INSERT INTO market_presets (user_id, name, strategy, params, description, budget_quote, public, installs, created_at)
    VALUES (0,?,?,?,?,?,1,0,?)`);
  const upd = db.prepare('UPDATE market_presets SET strategy=?, params=?, description=? WHERE user_id=0 AND name=?');
  for (const [name, strategy, params, desc, budget] of rows) {
    if (have.has(name)) upd.run(strategy, params, desc, name);
    else ins.run(name, strategy, params, desc, budget, now());
  }
}
seedIfEmpty();

// ===== Settings (per-user) =====
export const settings = {
  get(key: string, def = '', userId = 0): string {
    const row = db.prepare('SELECT value FROM settings WHERE key=? AND user_id=?').get(key, userId) as any;
    return row?.value ?? def;
  },
  set(key: string, value: string, userId = 0) {
    db.prepare('INSERT INTO settings (key,value,user_id) VALUES (?,?,?) ON CONFLICT(key,user_id) DO UPDATE SET value=excluded.value').run(key, value, userId);
  },
  all(userId = 0): Record<string, string> {
    const rows = db.prepare('SELECT key,value FROM settings WHERE user_id=?').all(userId) as any[];
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  }
};

// ===== Typed rows =====
export interface UserRow { id: number; username: string; pass_hash: string; role: string; created_at: string }
export interface ExchangeRow {
  id: string; name: string; api_key_enc: string | null; api_secret_enc: string | null;
  mode: 'paper' | 'live'; proxy_url: string | null; min_lot_idr: number;
  enabled: number; last_sync: string | null; status: string; user_id: number;
}
export interface BotRow {
  id: number; user_id: number; name: string; exchange_id: string; pair: string; strategy: string;
  params: string; budget_idr: number; current_budget: number; lot: number;
  mode: 'paper' | 'live'; auto_compound_pct: number; status: 'running' | 'paused' | 'stopped';
  state: string; error_count: number; max_daily_loss_pct: number; market_preset_id: number | null; created_at: string; updated_at: string;
}
export interface TradeRow {
  id: number; user_id: number; bot_id: number | null; exchange_id: string; pair: string; side: 'buy' | 'sell';
  price: number; qty: number; fee: number; value: number; realized_pnl: number; cost_basis: number;
  mode: 'paper' | 'live'; order_id: string | null; client_order_id: string | null;
  strategy_tag: string | null; note: string | null; created_at: string;
}
export interface LogRow {
  id: number; user_id: number; level: string; tag: string; bot_id: number | null; message: string;
  impact_rp: number | null; meta: string | null; created_at: string;
}
export interface MarketPresetRow {
  id: number; user_id: number; name: string; strategy: string; params: string;
  description: string | null; budget_quote: number; public: number; installs: number; created_at: string;
}

export const queries = {
  getExchange: db.prepare('SELECT * FROM exchanges WHERE id=? AND user_id=?'),
  allExchanges: db.prepare('SELECT * FROM exchanges WHERE user_id=? ORDER BY id'),
  insertBot: db.prepare(`INSERT INTO bots (user_id, name, exchange_id, pair, strategy, params, budget_idr, current_budget, lot, mode, auto_compound_pct, status, state, max_daily_loss_pct, market_preset_id, created_at, updated_at)
    VALUES (@user_id, @name, @exchange_id, @pair, @strategy, @params, @budget_idr, @current_budget, @lot, @mode, @auto_compound_pct, @status, @state, @max_daily_loss_pct, @market_preset_id, @created_at, @updated_at)`),
  getBot: db.prepare('SELECT * FROM bots WHERE id=?'),
  allBots: db.prepare('SELECT * FROM bots WHERE user_id=? ORDER BY id DESC'),
  runningBots: db.prepare(`SELECT * FROM bots WHERE status='running'`),
  updateBotState: db.prepare('UPDATE bots SET state=?, updated_at=? WHERE id=?'),
  updateBotBudget: db.prepare('UPDATE bots SET current_budget=?, lot=?, updated_at=? WHERE id=?'),
  setBotStatus: db.prepare('UPDATE bots SET status=?, updated_at=? WHERE id=?'),
  setBotError: db.prepare('UPDATE bots SET error_count=?, updated_at=? WHERE id=?'),
  deleteBot: db.prepare('DELETE FROM bots WHERE id=?'),
  insertTrade: db.prepare(`INSERT INTO trades (user_id, bot_id, exchange_id, pair, side, price, qty, fee, value, realized_pnl, cost_basis, mode, order_id, client_order_id, strategy_tag, note, created_at)
    VALUES (@user_id, @bot_id, @exchange_id, @pair, @side, @price, @qty, @fee, @value, @realized_pnl, @cost_basis, @mode, @order_id, @client_order_id, @strategy_tag, @note, @created_at)`),
  tradeByClientId: db.prepare('SELECT * FROM trades WHERE client_order_id=?'),
  insertLog: db.prepare('INSERT INTO logs (user_id, level, tag, bot_id, message, impact_rp, meta, created_at) VALUES (?,?,?,?,?,?,?,?)'),
  latestSnapshot: db.prepare(`SELECT * FROM balance_snapshots WHERE exchange_id=? ORDER BY created_at DESC LIMIT 200`),
  upsertPaperBalance: db.prepare(`INSERT INTO paper_balances (exchange_id, asset, free, locked, user_id) VALUES (?,?,?,?,?)
    ON CONFLICT(exchange_id, asset, user_id) DO UPDATE SET free=excluded.free, locked=excluded.locked`),
  paperBalances: db.prepare('SELECT * FROM paper_balances WHERE exchange_id=? AND user_id=?'),
  cacheTicker: db.prepare(`INSERT INTO ticker_cache (exchange_id, pair, data, fetched_at) VALUES (?,?,?,?)
    ON CONFLICT(exchange_id, pair) DO UPDATE SET data=excluded.data, fetched_at=excluded.fetched_at`),
  getCachedTicker: db.prepare('SELECT data, fetched_at FROM ticker_cache WHERE exchange_id=? AND pair=?'),
  getUser: db.prepare('SELECT * FROM users WHERE id=?'),
  getUserByName: db.prepare('SELECT * FROM users WHERE username=?'),
  allUsers: db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id'),
  insertUser: db.prepare(`INSERT INTO users (username, pass_hash, role, created_at) VALUES (?,?,?,?)`)
};

export { now };
