# 15 — v2.0: Multi-User, Marketplace, Binance, Backtest UI, CSV, Rebalance, Docker

## Ringkasan
Versi 2.0 menyelesaikan seluruh sisa roadmap v1.1–v2.0:
- v1.1: **Ekspor CSV** riwayat trades (alert, trailing, equity sudah ada).
- v1.2: **Backtest UI interaktif**, **adapter Binance**, **strategi Rebalance**.
- v2.0: **Multi-user + login (JWT)**, **Marketplace preset**, **Docker satu-klik**.

Total suite E2E: **100/100 ✅** (`npm run test:all`).

## 1. Ekspor CSV (v1.1)
- `GET /trades/export?exchange=&mode=&...` → CSV (BOM UTF-8 agar rapi di Excel), header Indonesia, maks 50.000 baris, filter sama seperti `/trades`.
- Tombol "Ekspor CSV" di Riwayat (unduh via fetch+blob agar token auth terkirim).

## 2. Backtest Interaktif (v1.2)
- `backtest()` kini mengembalikan **kurva equity** (maks ~150 titik) + metrik seperti sebelumnya.
- `POST /api/backtest {exchange_id, pair, strategy, params, days 1–90, budget}` → candle (`1m` untuk scalper, `1h` lainnya, maks 1000) → hasil + `candles` + `note`.
- Khusus rebalance (butuh multi-aset): mengembalikan **buy-and-hold pembanding** pair tersebut dengan catatan jujur.
- UI: panel "Uji backtest" di Wizard langkah 2 — pilih 7/14/30 hari → grafik equity + Return/Win/Trade/MaxDD + jumlah candle.

## 3. Adapter Binance (v1.2)
- `BinanceClient extends TokocryptoClient` (protokol Binance v3 sama; beda base URL `https://api.binance.com`, bisa dioverride via `BINANCE_BASE_URL`).
- `TokocryptoClient` direfactor agar bisa di-subclass (`baseUrl()`, `label`, `normalizeError` berlabel).
- Seed otomatis: baris exchange `binance` + 10 pair USDT untuk DB baru maupun lama.
- Catatan: `api.binance.com` juga geo-restricted dari sebagian IP Indonesia → gunakan proxy seperti Tokocrypto.

## 4. Strategi Rebalance (v1.2)
- `strategies/rebalance.ts`: jaga alokasi aset sesuai `targets` (mis. `{"BTC": 50, "ETH": 30}`, sisa = kas). Jual yang berlebih, beli yang kurang bila deviasi ≥ `threshold_pct` (default 2%). Cek berkala tiap `interval_min` (default 60), maks 2 aksi/siklus, dibatasi `max_trade_quote`.
- `StrategyContext` bertambah `getBalances()` (cache 60s per user+exchange) dan `getPrice(pair)` (cache ticker 5s).
- Preset wizard ke-5 "Rebalance Portfolio" + editor JSON targets di Wizard + label di halaman Bot.
- Tag trade: `REBALANCE` (masuk filter Order & statistik).

## 5. Multi-User + Login JWT (v2.0)
- Tabel `users(id, username UNIQUE, pass_hash bcrypt, role, created_at)`.
- Semua tabel data mendapat `user_id` (settings & exchanges: composite PK; paper_balances: composite PK 3 kolom). Migrasi otomatis untuk DB lama (tambah kolom + rebuild PK + seed).
- **Setup pertama**: `POST /api/auth/setup` (hanya bila belum ada user) → buat admin + klaim seluruh data legacy + seed exchange miliknya.
- **Login**: `POST /api/auth/login` → JWT 30 hari (cookie httpOnly `botani_token` + header `Authorization: Bearer`). Password bcrypt(10).
- **Manajemen user** (admin): tambah/hapus/daftar user; tiap user baru otomatis dapat baris exchange + seed paper sendiri.
- **Isolasi data**: semua endpoint & engine memakai `user_id` — bots, trades, logs, alerts, settings, exchange (kredensial+proxy), paper balance, snapshot, equity (via bot).
- **Registry per-user**: client exchange di-cache per `(exchange, user)` dengan kredensial+proxy masing-masing; `reloadUser()` saat pengaturan berubah.
- **Telegram per-user**: tabel `telegram_chats(chat_id → user_id)` + fallback pindai allowed-list; semua command & builder di-scope per user; notifikasi hanya ke chat pemilik; ringkasan harian per user yang punya chat.
- **WebSocket per-user**: auth JWT saat handshake → room `user-<id>`; broadcast log/balances hanya ke pemilik.
- **Frontend**: halaman Login/Setup, guard route (redirect `/login`), token di localStorage + header, tombol logout + nama user + LIVE/OFFLINE, halaman Pengaturan punya seksi Pengguna (admin).
- Keamanan: 401 tanpa token; rute admin 403 untuk non-admin; tidak bisa hapus diri sendiri / admin terakhir.

## 6. Marketplace Preset (v2.0)
- Tabel `market_presets` (seed 5 preset bawaan sistem) + `market_ratings`.
- API: `GET /marketplace?search=` (rating rata-rata + jumlah), `POST /marketplace` (publikasi preset sendiri), `POST /marketplace/:id/install` (buat bot **paused** + counter installs; bisa pilih exchange, pair, budget), `POST /marketplace/:id/rate` (1–5, satu nilai per user), `DELETE /marketplace/:id` (milik sendiri).
- UI halaman Marketplace: kartu preset (nama, strategi, deskripsi, rating bintang + jumlah, installs, budget saran), instal ke exchange+pair pilihan, beri rating.

## 7. Docker Satu-Klik (v2.0)
- `Dockerfile` multi-stage (build + runtime), `docker-compose.yml` (`docker compose up --build -d`, volume `botani-data`, healthcheck `/api/health`), `.dockerignore`.
- Catatan: image sempat ter-build sukses; smoke test menemukan runtime kekurangan dep workspace → diperbaiki (install prod workspace di root + bawa hasil compile better-sqlite3 dari build stage). Verifikasi container penuh ditunda (Docker di-uninstall dari mesin dev karena berat) — jalankan `docker compose up --build -d` di server tujuan.

## Verifikasi E2E Baru
| Test | Cakupan | Hasil |
|---|---|---|
| test-v2 | bcrypt/JWT, isolasi user, rebalance (jual/beli/jeda), marketplace (seed/install/rating), backtest equity, registrasi Binance | 21/21 ✅ |
| test-auth-http | setup→login→401/403→admin buat user→isolasi uid | 12/12 ✅ |

## Suite Keseluruhan (100/100 ✅)
test-live-mock 13 · test-live-e2e 11 · test-killswitch 7 · test-safety 12 · test-features-v11 12 · test-v2 21 · test-auth-http 12.

## Checklist Go-Live v2.0
1. Isi `SECRET_KEY` (≥32 char) — dipakai enkripsi API key **dan** JWT.
2. Buka UI → setup akun admin → login.
3. Tambah user lain via Pengaturan → Pengguna (bila perlu).
4. Tiap user isi API key + proxy + Chat ID Telegram sendiri-sendiri.
