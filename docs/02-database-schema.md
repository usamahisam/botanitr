# 02 — Skema Database (SQLite)

File: `server/data/trading-botani.db`. WAL mode aktif.

## Tabel

### `settings`
| Kolom | Tipe | Keterangan |
|---|---|---|
| key | TEXT PK | nama setting |
| value | TEXT | nilai (string; JSON jika kompleks) |

Keys: `telegram_bot_token`, `telegram_allowed_chat_ids`, `proxy_indodax`, `proxy_tokocrypto`, `proxy_telegram`, `default_paper_mode`, `daily_summary_time`, `last_summary_date`.

### `exchanges`
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | TEXT PK | `indodax` / `tokocrypto` |
| name | TEXT | label tampilan |
| api_key_enc | TEXT | API key terenkripsi (nullable jika belum diset) |
| api_secret_enc | TEXT | secret terenkripsi |
| mode | TEXT | `paper` / `live` |
| proxy_url | TEXT | override proxy (nullable → pakai `proxy_<id>` di settings) |
| min_lot_idr | INTEGER | minimal order dalam IDR/USDT |
| enabled | INTEGER | 0/1 |
| last_sync | TEXT | ISO timestamp sinkron saldo terakhir |
| status | TEXT | `ok` / `error` / `unknown` |

### `default_pairs`
| Kolom | Tipe |
|---|---|
| id | INTEGER PK AUTOINCREMENT |
| exchange_id | TEXT FK→exchanges |
| symbol | TEXT (`BTCIDR`, `BTCUSDT`) |
| base | TEXT (`BTC`) |
| quote | TEXT (`IDR`/`USDT`) |
| label | TEXT |
| kategori | TEXT |
| min_lot | REAL |
| sort | INTEGER |

### `bots`
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| name | TEXT | |
| exchange_id | TEXT FK | |
| pair | TEXT | |
| strategy | TEXT | `grid`/`dca`/`scalper`/`harvester` |
| params | TEXT(JSON) | parameter strategi |
| budget_idr | REAL | budget kerja (IDR atau USDT) |
| current_budget | REAL | budget setelah compound |
| lot | REAL | lot per order |
| mode | TEXT | `paper`/`live` (default dari settings) |
| auto_compound_pct | REAL | 0–100 |
| status | TEXT | `running`/`paused`/`stopped` |
| state | TEXT(JSON) | state strategi (grid levels, avg cost, dll) |
| created_at / updated_at | TEXT | ISO |

### `trades`
| Kolom | Tipe |
|---|---|
| id | INTEGER PK AUTOINCREMENT |
| bot_id | INTEGER FK (nullable untuk quick trade) |
| exchange_id | TEXT |
| pair | TEXT |
| side | TEXT `buy`/`sell` |
| price | REAL |
| qty | REAL |
| fee | REAL (dalam quote) |
| value | REAL (price*qty) |
| realized_pnl | REAL (quote; 0 untuk buy murni) |
| mode | TEXT `paper`/`live` |
| order_id | TEXT (id dari exchange atau `paper-*`) |
| client_order_id | TEXT (idempotensi) |
| strategy_tag | TEXT |
| note | TEXT |
| created_at | TEXT ISO |

Index: `(bot_id, created_at)`, `(exchange_id, created_at)`, `(mode, created_at)`.

### `logs`
| Kolom | Tipe |
|---|---|
| id | INTEGER PK AUTOINCREMENT |
| level | TEXT `info`/`warn`/`error` |
| tag | TEXT (`GRID_UNWIND`, `INVENTORY_HARVEST_RECYCLE`, `AUTO_COMPOUND`, `TRADE`, `ERROR`, `ENGINE`, `TELEGRAM`, `SYSTEM`) |
| bot_id | INTEGER NULL |
| message | TEXT |
| impact_rp | REAL NULL (nilai Rp terkait) |
| meta | TEXT(JSON) NULL |
| created_at | TEXT ISO |

### `balance_snapshots`
| Kolom | Tipe |
|---|---|
| id | INTEGER PK AUTOINCREMENT |
| exchange_id | TEXT |
| asset | TEXT |
| free | REAL |
| locked | REAL |
| price_idr | REAL (estimasi nilai IDR; 1 untuk IDR) |
| total_idr | REAL |
| created_at | TEXT ISO (per menit) |

### `wizard_presets` (statis di kode, bukan tabel)
Preset disimpan sebagai konstanta di `engine/wizard.ts` agar mudah dikembangkan; tidak perlu migrasi.

## Inisialisasi
`db/index.ts` menjalankan `schema.sql` via `db.exec()` dengan `CREATE TABLE IF NOT EXISTS`, lalu seed `exchanges` (2 baris) dan `default_pairs` (20 baris) jika kosong.
