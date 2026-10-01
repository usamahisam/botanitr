# 🌱 Trading Botani

Aplikasi web **trading bot multi-bot** untuk **Indodax** & **Tokocrypto** dengan kontrol penuh via **Telegram** dan dukungan **proxy per-exchange**. Mode **paper trading (Demo)** aktif secara default.

## Fitur
- 📊 Dashboard portfolio real-time (saldo, profit, win rate, kas bebas per exchange)
- 🤖 Multi-bot paralel, masing-masing budget & strategi sendiri
- 📈 4 strategi: **Grid** (unwind breakeven VWAP), **DCA**, **Scalper** (EMA/RSI 1m), **Inventory Harvester**
- 📈 Auto-compound profit ke budget bot
- 🧙 Wizard AI 3 langkah (rekomendasi preset + backtest)
- ✈️ Telegram: `/status /balance /positions /price /pnl /pause /resume /logs` + notifikasi otomatis
- 🌐 Proxy per-exchange & Telegram (HTTP/HTTPS/SOCKS5)
- 🔒 API keys terenkripsi AES-256-GCM

## Menjalankan

```bash
# 1. Install
npm install

# 2. Konfigurasi
cp .env.example .env
# Edit .env — WAJIB isi SECRET_KEY (min 32 karakter acak)

# 3. Build
npm run build

# 4. Jalankan (server melayani API + web)
npm start
# Buka http://127.0.0.1:3000
```

Mode development (hot reload):
```bash
npm run dev   # server :3000 + vite :5173 (proxy ke server)
```

## Setup Awal
1. **Pengaturan → Exchange**: isi API key/secret Indodax & Tokocrypto, pilih mode (Demo dulu!), isi proxy Tokocrypto jika koneksi diblokir (error 3701). Klik **Test Koneksi**.
2. **Pengaturan → Telegram**: isi Bot Token (dari @BotFather) + Chat ID Anda. Klik **Simpan & Test Kirim**.
3. **Wizard AI**: pilih exchange + koin → Analisis → pilih preset → atur parameter → **Aktifkan Bot** (mode Demo).
4. Pantau di **Dashboard** & **Bot**. Jika performa bagus di Demo, baru aktifkan mode Riil.

## Tes Koneksi Exchange (CLI)
```bash
npm run test:exchanges
# Dengan proxy: TEST_PROXY="http://user:pass@host:port" npm run test:exchanges
```

## Dokumentasi
Semua perencanaan & rancangan ada di [`docs/`](docs/): PRD, arsitektur, skema DB, spesifikasi API, strategi, engine, Telegram, UI, pasangan default, keamanan, tasks, roadmap.

## Catatan Penting
- ⚠️ `api.tokocrypto.com` diblokir dari banyak IP Indonesia → gunakan proxy (Pengaturan → Tokocrypto). Base URL bisa dioverride via env `TOKOCRYPTO_BASE_URL`.
- ⚠️ Trading kripto berisiko tinggi. Selalu uji di mode Demo dulu. Bot ini alat bantu, bukan jaminan profit.
- Server bind `127.0.0.1` — untuk akses publik gunakan reverse proxy + autentikasi sendiri.
