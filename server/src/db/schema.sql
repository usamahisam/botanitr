PRAGMA journal_mode = WAL;

-- v2.0: tabel pengguna (multi-user). user_id=0 = data legacy sebelum setup.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT NOT NULL,
  value TEXT,
  user_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, user_id)
);

CREATE TABLE IF NOT EXISTS exchanges (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  api_key_enc TEXT,
  api_secret_enc TEXT,
  mode TEXT NOT NULL DEFAULT 'paper',
  proxy_url TEXT,
  min_lot_idr REAL NOT NULL DEFAULT 10000,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_sync TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  user_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (id, user_id)
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
  user_id INTEGER NOT NULL DEFAULT 0,
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
  max_daily_loss_pct REAL NOT NULL DEFAULT 0,
  market_preset_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bots_user ON bots(user_id, status);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,
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
CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_client ON trades(client_order_id) WHERE client_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,
  level TEXT NOT NULL DEFAULT 'info',
  tag TEXT NOT NULL DEFAULT 'SYSTEM',
  bot_id INTEGER,
  message TEXT NOT NULL,
  impact_rp REAL,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_user ON logs(user_id, created_at);

CREATE TABLE IF NOT EXISTS balance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,
  exchange_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  free REAL NOT NULL,
  locked REAL NOT NULL,
  price_idr REAL NOT NULL DEFAULT 0,
  total_idr REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snap ON balance_snapshots(exchange_id, created_at);
CREATE INDEX IF NOT EXISTS idx_snap_user ON balance_snapshots(user_id, exchange_id, created_at);

CREATE TABLE IF NOT EXISTS paper_balances (
  exchange_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  free REAL NOT NULL DEFAULT 0,
  locked REAL NOT NULL DEFAULT 0,
  user_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (exchange_id, asset, user_id)
);

CREATE TABLE IF NOT EXISTS ticker_cache (
  exchange_id TEXT NOT NULL,
  pair TEXT NOT NULL,
  data TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (exchange_id, pair)
);

-- Equity per bot untuk grafik (resolusi per jam WIB).
-- Kolom date menampung slot 'YYYY-MM-DDTHH' (baris lama harian 'YYYY-MM-DD'
-- tetap valid & terurut). Retensi 45 hari.
CREATE TABLE IF NOT EXISTS bot_equity (
  bot_id INTEGER NOT NULL,
  date TEXT NOT NULL,           -- slot jam WIB 'YYYY-MM-DDTHH'
  equity_quote REAL NOT NULL,   -- nilai equity dalam quote (IDR/USDT)
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (bot_id, date)
);

-- Alert harga kustom (notifikasi Telegram)
CREATE TABLE IF NOT EXISTS price_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,
  exchange_id TEXT NOT NULL,
  pair TEXT NOT NULL,
  direction TEXT NOT NULL,      -- 'above' | 'below'
  target_price REAL NOT NULL,
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  triggered_at TEXT,
  created_at TEXT NOT NULL
);

-- Pemetaan chat Telegram -> pengguna (untuk routing perintah & notifikasi)
CREATE TABLE IF NOT EXISTS telegram_chats (
  chat_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL
);

-- Marketplace preset strategi (v2.0)
CREATE TABLE IF NOT EXISTS market_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,   -- 0 = bawaan sistem
  name TEXT NOT NULL,
  strategy TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  description TEXT,
  budget_quote REAL NOT NULL DEFAULT 100000,
  public INTEGER NOT NULL DEFAULT 1,
  installs INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS market_ratings (
  preset_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  stars INTEGER NOT NULL,
  PRIMARY KEY (preset_id, user_id)
);

-- Riwayat harga lokal (ticker snapshot, untuk backtest & analisis)
CREATE TABLE IF NOT EXISTS price_history (
  exchange_id TEXT NOT NULL,
  pair TEXT NOT NULL,
  ts INTEGER NOT NULL,          -- epoch ms
  price REAL NOT NULL,
  PRIMARY KEY (exchange_id, pair, ts)
);

-- Index bantu
CREATE INDEX IF NOT EXISTS idx_equity_bot ON bot_equity(bot_id, date);
CREATE INDEX IF NOT EXISTS idx_alerts_active ON price_alerts(active);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON price_alerts(user_id, active);
CREATE INDEX IF NOT EXISTS idx_market_public ON market_presets(public, installs);
CREATE INDEX IF NOT EXISTS idx_price_hist ON price_history(exchange_id, pair, ts);
