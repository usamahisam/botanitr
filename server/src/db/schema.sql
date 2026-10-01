PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS exchanges (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key_enc TEXT,
  api_secret_enc TEXT,
  mode TEXT NOT NULL DEFAULT 'paper',
  proxy_url TEXT,
  min_lot_idr REAL NOT NULL DEFAULT 10000,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_sync TEXT,
  status TEXT NOT NULL DEFAULT 'unknown'
);

CREATE TABLE IF NOT EXISTS default_pairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  label TEXT NOT NULL,
  kategori TEXT,
  min_lot REAL NOT NULL DEFAULT 10000,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE(exchange_id, symbol)
);

CREATE TABLE IF NOT EXISTS bots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  exchange_id TEXT NOT NULL,
  pair TEXT NOT NULL,
  strategy TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  budget_idr REAL NOT NULL,
  current_budget REAL NOT NULL,
  lot REAL NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'paper',
  auto_compound_pct REAL NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'running',
  state TEXT NOT NULL DEFAULT '{}',
  error_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id INTEGER,
  exchange_id TEXT NOT NULL,
  pair TEXT NOT NULL,
  side TEXT NOT NULL,
  price REAL NOT NULL,
  qty REAL NOT NULL,
  fee REAL NOT NULL DEFAULT 0,
  value REAL NOT NULL,
  realized_pnl REAL NOT NULL DEFAULT 0,
  cost_basis REAL NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'paper',
  order_id TEXT,
  client_order_id TEXT,
  strategy_tag TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trades_bot ON trades(bot_id, created_at);
CREATE INDEX IF NOT EXISTS idx_trades_exchange ON trades(exchange_id, created_at);
CREATE INDEX IF NOT EXISTS idx_trades_mode ON trades(mode, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_client ON trades(client_order_id) WHERE client_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL DEFAULT 'info',
  tag TEXT NOT NULL DEFAULT 'SYSTEM',
  bot_id INTEGER,
  message TEXT NOT NULL,
  impact_rp REAL,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);

CREATE TABLE IF NOT EXISTS balance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  free REAL NOT NULL,
  locked REAL NOT NULL,
  price_idr REAL NOT NULL DEFAULT 0,
  total_idr REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snap ON balance_snapshots(exchange_id, created_at);

CREATE TABLE IF NOT EXISTS paper_balances (
  exchange_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  free REAL NOT NULL DEFAULT 0,
  locked REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (exchange_id, asset)
);

CREATE TABLE IF NOT EXISTS ticker_cache (
  exchange_id TEXT NOT NULL,
  pair TEXT NOT NULL,
  data TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (exchange_id, pair)
);
