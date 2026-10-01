# 01 — Arsitektur Sistem

## Gambaran
```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (React)                       │
│  Dashboard │ Bots │ Wizard │ Riwayat │ Pengaturan            │
└──────────────▲──────────────────────────▲───────────────────┘
               │ HTTP /api                │ WS /socket.io
┌──────────────▼──────────────────────────▼───────────────────┐
│                    Express Server (Node 20)                  │
│  routes/api.ts ◄── services ──► engine (scheduler/strategies)│
│       │                             │                        │
│  db (better-sqlite3) ◄──────────────┘                        │
│  telegram/bot.ts ──► notifikasi & command                    │
└──────────────▲──────────────────────────▲───────────────────┘
               │ REST (+proxy)            │ Bot API (+proxy)
        ┌──────┴──────┐            ┌──────▼──────┐
        │  Indodax    │            │  Telegram   │
        │  Tokocrypto │            └─────────────┘
        └─────────────┘
```

## Modul Server
| Modul | Tanggung jawab |
|---|---|
| `index.ts` | Bootstrap: env → db → exchanges → engine → telegram → http/ws |
| `config.ts` | Load & validasi env, default settings |
| `db/` | SQLite wrapper, schema, migrasi, query helpers |
| `crypto.ts` | AES-256-GCM encrypt/decrypt API keys |
| `exchange/` | Interface `ExchangeClient` + implementasi Indodax/Tokocrypto + paper simulator + proxy agent |
| `strategies/` | 4 strategi dengan kontrak `onTick/onFill`, state machine |
| `engine/` | Scheduler multi-bot, trader (eksekusi+retry), auto-compound, PnL, wizard+backtest |
| `telegram/` | Telegraf bot, commands, format notifikasi, proxy |
| `routes/` | REST API + broadcast WS |
| `log.ts` | Log operasional bertag → DB + WS + Telegram |

## Alur Data Utama
1. **Tick bot** → `scheduler` memanggil `exchange.getTicker(pair)` (proxy jika ada) → `strategy.onTick(price)` menghasilkan aksi (`buy/sell/hold`) → `trader.execute()` (paper: simulasi; live: REST order) → simpan `trades` + update `bot_state` → `log()` → notifikasi Telegram + broadcast WS.
2. **Saldo** → `exchange.getBalances()` tiap 60s / manual "Sinkron Ulang" → snapshot `balance_snapshots` → hitung portfolio total + profit harian.
3. **PnL** → dari `trades` (realized per siklus) + posisi terbuka (floating) dihitung di `engine/pnl.ts`.

## Keputusan Teknis
- **Single process** server (engine + API + telegram) agar sederhana; state bot persist di DB agar restart aman.
- **Idempotensi order**: `client_order_id` per siklus untuk cegah double-order saat retry.
- **Paper vs Live** diputus per bot (`mode` kolom di `bots`), bukan global, agar bisa campur.
- **Proxy** di-applied di level axios `httpsAgent`, per instance client exchange/telegram.

## Struktur Folder
Lihat `TASKS.md` / tree di root README. Semua dokumen desain ada di `docs/`.
