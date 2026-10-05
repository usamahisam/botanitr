# TASKS — Tracking Implementasi

Status keseluruhan: ✅ **v1.0 MVP SELESAI** (semua 11 tahap tuntas & terverifikasi end-to-end).

## Todo Master List (mirror dari sesi implementasi)

| # | Task | Status |
|---|------|--------|
| 1 | Scaffold proyek + deps + struktur folder + .env.example | ✅ Selesai |
| 2 | Dokumentasi docs/ (PRD, architecture, schema, API, strategies, tasks, roadmap, dst.) | ✅ Selesai |
| 3 | Database SQLite (schema + wrapper) + enkripsi AES-256-GCM + settings service | ✅ Selesai |
| 4 | Exchange clients: Indodax + Tokocrypto + proxy agent + paper simulator + tes live | ✅ Selesai |
| 5 | Engine: scheduler multi-bot, trader, PnL, auto-compound | ✅ Selesai |
| 6 | 4 strategi: Grid (+UNWIND), DCA, Scalper EMA/RSI, Inventory Harvester | ✅ Selesai |
| 7 | Wizard: preset rekomendasi rule-based + backtest | ✅ Selesai |
| 8 | Telegram bot: proxy + commands + notifikasi + whitelist | ✅ Selesai |
| 9 | REST API + Socket.IO (routes lengkap) | ✅ Selesai |
| 10 | Frontend React 5 halaman (Dashboard, Bots, Wizard, Riwayat, Pengaturan) | ✅ Selesai |
| 11 | Verifikasi end-to-end: build, run, tes bot paper, cek log/PnL/UI | ✅ Selesai |

## Rincian per Tahap

### Tahap 1 — Scaffold ✅
- [x] Struktur monorepo (server + web + docs)
- [x] package.json + tsconfig + vite/tailwind config
- [x] .env.example
- [x] npm install
- [x] Workaround environment: pin `esbuild@0.25.12` (binary terbaru SIGSEGV di mesin ini), build native `better-sqlite3` via prebuild-install

### Tahap 2 — Dokumentasi ✅
- [x] PRD.md
- [x] 01-architecture.md
- [x] 02-database-schema.md
- [x] 03-api-spec.md
- [x] 04-exchange-integration.md
- [x] 05-strategies.md
- [x] 06-telegram-bot.md
- [x] 07-engine.md
- [x] 08-ui-pages.md
- [x] 09-default-pairs.md
- [x] 10-security.md
- [x] TASKS.md
- [x] ROADMAP.md

### Tahap 3 — Database & Crypto ✅
- [x] db/schema.sql (settings, exchanges, default_pairs, bots, trades, logs, balance_snapshots, paper_balances, ticker_cache)
- [x] db/index.ts (init + seed 2 exchange + 20 pasangan default)
- [x] crypto.ts (AES-256-GCM + mask)
- [x] settings service
- [x] utils/format.ts (fmtIDR dsb.)

### Tahap 4 — Exchange Clients ✅
- [x] exchange/http.ts (HttpsProxyAgent/SocksProxyAgent + retry exponential)
- [x] exchange/base.ts (interface ExchangeClient)
- [x] exchange/indodax.ts (ticker `xrp_idr`, trades/depth `xrpidr`, /tapi HMAC-SHA512, klines agregasi trades)
- [x] exchange/tokocrypto.ts (Binance-compatible v3, baseURL configurable, error 3701 → pesan proxy jelas)
- [x] exchange/paper.ts (saldo virtual, fee, seed otomatis 10jt IDR / 1000 USDT)
- [x] exchange/registry.ts
- [x] scripts/test-exchanges.ts — **teruji live**: Indodax ping 94ms + ticker + klines OK; Tokocrypto ping OK, market data terblokir IP (diharapkan, butuh proxy)

### Tahap 5 — Engine ✅
- [x] engine/scheduler.ts (interval 4s, stagger per bot, ticker cache 5s, auto-pause saat kredensial salah)
- [x] engine/trader.ts (eksekusi paper/live, idempotensi client_order_id, guard min lot)
- [x] engine/compound.ts (reinvest % PnL → budget + hitung ulang lot)
- [x] engine/pnl.ts (realized, win rate, profit harian WIB, statistik & tren per bot)
- [x] engine/balances.ts (kurs USDTIDR cache, fetch saldo, snapshot, sinkron 60s)

### Tahap 6 — Strategi ✅
- [x] strategies/types.ts (kontrak Strategy + registry)
- [x] strategies/grid.ts (level merata + GRID_UNWIND breakeven VWAP +0.4%)
- [x] strategies/dca.ts (drop% → beli bertahap, TP% → jual semua)
- [x] strategies/scalper.ts (EMA20/50 + RSI14 1m, TP 1.2%/SL 0.6%, cache klines 45s)
- [x] strategies/harvester.ts (akumulasi → INVENTORY_HARVEST_RECYCLE modal cair + profit)

### Tahap 7 — Wizard ✅
- [x] engine/wizard.ts (4 preset, metrik candle, skor rule-based, backtest replay)
- [x] Teruji: XRPIDR → Harvester 75.0 / DCA 70.6 / Grid 67.2 / Scalper 61.9

### Tahap 8 — Telegram ✅
- [x] telegram/bot.ts (Telegraf + proxy agent, whitelist chat_id)
- [x] Commands: /start /help /status /balance /positions /price /pnl /pause /resume /logs
- [x] telegram/notify.ts (format notifikasi per tag + ringkasan harian 00:00 WIB)
- [x] Auto nonaktif jika token kosong (aman)

### Tahap 9 — API & WS ✅
- [x] routes/api.ts: health, dashboard, exchanges (CRUD/test/sync), pairs, bots (CRUD/pause/resume/trend), trade/quick, trades, logs, wizard (presets/backtest), settings, telegram/test
- [x] Socket.IO broadcast: log, balances, bot, trade
- [x] Serve web build + SPA fallback

### Tahap 10 — Frontend ✅
- [x] Dashboard (portfolio, kartu exchange, realized & win rate, Quick Trade modal)
- [x] Bots (kartu + sparkline, pagination 8/halaman, Log Operasional live via WS + filter)
- [x] Wizard (stepper 3 langkah, preset cards + skor + backtest)
- [x] Riwayat (tabel + filter exchange/mode + pagination)
- [x] Pengaturan (exchange keys/proxy/mode + test koneksi, Telegram, umum)

### Tahap 11 — Verifikasi E2E ✅
- [x] tsc --noEmit server ✅, tsc -b web ✅
- [x] vite build ✅ (636 kB, warning chunk besar — non-blokir)
- [x] Server dev: dashboard total Rp 27.918.000 (paper seed OK)
- [x] Bot DCA paper: buy 0,7506 XRP @ 26.566, fee 60 IDR (0,3%) ✅
- [x] Bot Harvester paper: entry + trade tercatat ✅
- [x] Quick trade DOGE paper: 29,41 DOGE @ 1.695 ✅
- [x] Pause/resume/delete bot 200 ✅
- [x] Build produksi server (tsc) + schema.sql copy step ✅
- [x] Server produksi (node dist): UI 200, /api/health 200, /api/dashboard 200 ✅
- [x] Data tes dibersihkan (DB direset)
- [x] README.md

## Pasca-Audit (ditambahkan)
- [x] Audit jalur live berdasarkan docs resmi Indodax → 5 kritis + 4 menengah diperbaiki (`docs/11-audit-live-trading.md`)
- [x] Market order tanpa `price` (order_type=market)
- [x] Idempotensi `client_order_id` native exchange
- [x] Rekonsiliasi fill aktual (getOrderByClientOrderId + tradeHistory)
- [x] Guard quick trade live
- [x] Normalisasi qty Tokocrypto (exchangeInfo LOT_SIZE)
- [x] E2E mock: test:live-mock 13/13 ✅, test:live-e2e 11/11 ✅
- [x] **Kill switch global** (pause semua + cancel open orders): endpoint + tombol Dashboard + Telegram /panic → test:killswitch 7/7 ✅
- [x] Isolasi DB test via env `BOTANI_DATA_DIR`

## Security Hardening v1.1 (ditambahkan)
- [x] Migrasi Indodax TAPI v2 (`indodax-v2.ts` + auto-detect v1/v2 + rekonsiliasi via `/api/v2/myTrades`) — antisipasi decommission v1 April 2026
- [x] Max daily loss limit per bot (kolom `max_daily_loss_pct`, guard auto-pause + notif, field di Wizard)
- [x] Reconciler drift berkala (posisi bot vs saldo exchange → alert Telegram)
- [x] E2E `test:safety` 12/12 ✅; total suite 43/43 ✅
- [x] Dokumentasi `docs/12-security-hardening-v1.1.md`

## Fitur Roadmap v1 (ditambahkan)
- [x] Trailing stop Scalper (param `trailing_pct`, evaluasi pre-candle, tag SCALPER_EXIT)
- [x] Equity curve per bot (tabel `bot_equity`, recorder 6 jam, endpoint, AreaChart di kartu bot)
- [x] Price alert kustom (tabel `price_alerts`, engine 20s, endpoint, halaman Alert + navigasi)
- [x] E2E `test:features` 12/12 ✅; total suite 55/55 ✅
- [x] Dokumentasi `docs/13-features-roadmap-v1.md`

## v2.0 — Roadmap sampai 2.0 (ditambahkan)
- [x] Ekspor CSV (`GET /trades/export` + tombol unduh bertoken)
- [x] Backtest interaktif (`POST /api/backtest`, kurva equity, panel UI di Wizard)
- [x] Adapter Binance (subclass TokocryptoClient + seed + registrasi)
- [x] Strategi Rebalance (targets JSON, threshold, interval, preset, tag REBALANCE)
- [x] Auth multi-user JWT (setup admin, login, bcrypt, middleware, isolasi per-user menyeluruh, Telegram & WS per-user)
- [x] Marketplace preset (seed 5, list+search+rating, install paused, publikasi, hapus)
- [x] Docker satu-klik (Dockerfile, compose, ignore) — build sempat sukses; smoke test temukan bug dep → diperbaiki
- [x] E2E `test-v2` 21/21 ✅ + `test-auth-http` 12/12 ✅; total suite 88/88 ✅
- [x] Dokumentasi `docs/15-v2-multipengguna-marketplace.md` + ROADMAP ditandai selesai

## Revisi: Data Backtest Indodax + Pilihan Versi API (ditambahkan)
- [x] Investigasi: `/api/trades` Indodax hanya ~500 trade (±5 jam) → mustahil backtest harian; tidak ada OHLC publik lain
- [x] Perekam riwayat harga lokal (`price_history`, tiap menit, retensi 45 hari, via summaries sekaligus untuk IDR)
- [x] Smart fetch wizard (exchange → fallback lokal + catatan sumber jujur di UI)
- [x] Pilihan versi API Indodax auto/v1/v2 (client `setApiVersion`, settings, validasi, badge aktif di Pengaturan)
- [x] Verifikasi live: scalper XRPIDR 193 candle jalan; grid gagal jujur + panduan akumulasi; selector v1/auto/invalid OK
- [x] Suite tetap 88/88 ✅

## Revisi lanjutan: analisis adaptif penuh (ditambahkan)
- [x] `fetchKlinesChain` + `tryInterval` tak-pernah-throw-timeout; rantai harian→12h→4h→1h di `recommend()`
- [x] Fallback terakhir ke data 1m bila semua rantai gagal → analisis selalu jalan dengan note jujur
- [x] Note sumber data (`Sumber: exchange/lokal · interval · N candle`) di tiap preset + backtest panel
- [x] Perbaikan bug data basi `getLocalKlines` (DESC + sort kronologis)
- [x] Verifikasi live: instansi minim-data (170 titik) tetap dapat analisis + note; suite 97/97 ✅

## Redesain UI Terminal (ditambahkan)
- [x] Tema gelap profesional: index.css (token, .panel/.tbl/.btn/.tag/.input/.seg/.num), tanpa emoji
- [x] Set ikon SVG inline `components/icons.tsx` (18 ikon, stroke)
- [x] Shell App: header 52px, nav berikon, jam WIB, indikator WS LIVE/OFFLINE
- [x] Dashboard: ticker tape (`GET /api/market`), hero portofolio, panel exchange tabel, rail kinerja + Order cepat + Mode darurat
- [x] Bot: kartu terminal + equity chart + log konsol realtime; Wizard 3 langkah; Riwayat tabel mono; Peringatan; Pengaturan
- [x] Verifikasi: 0 emoji, tsc bersih, build OK, E2E 55/55 ✅
- [x] Dokumentasi `docs/14-ui-terminal-redesign.md`

## Catatan Operasional
- Server bind `127.0.0.1:3000`; `npm start` untuk produksi, `npm run dev` untuk development.
- Jika `npm install` ulang bermasalah di esbuild: `npm install -D esbuild@0.25.12 --ignore-scripts`, lalu build native better-sqlite3: `cd node_modules/better-sqlite3 && npx prebuild-install`.
- Tokocrypto dari IP Indonesia umumnya error 3701 → wajib isi proxy di Pengaturan.
