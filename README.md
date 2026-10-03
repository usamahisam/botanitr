# Botani Terminal — v2.0

Aplikasi web **trading bot multi-bot, multi-user** untuk **Indodax**, **Tokocrypto**, & **Binance** dengan kontrol penuh via **Telegram** dan dukungan **proxy per-exchange**. Mode **paper trading (Demo)** aktif secara default.

## Fitur
- Dashboard portfolio real-time (saldo, profit, win rate, kas bebas per exchange) + ticker tape
- Multi-bot paralel, masing-masing budget & strategi sendiri
- 5 strategi: **Grid** (unwind breakeven VWAP), **DCA**, **Scalper** (EMA/RSI + trailing stop), **Inventory Harvester**, **Rebalance** portfolio
- Auto-compound, batas rugi harian (auto-pause), kill switch global, reconciler drift
- Wizard 3 langkah (rekomendasi + **backtest interaktif** dengan kurva equity)
- **Marketplace** preset strategi (instal 1 klik, rating)
- **Multi-user + login JWT** — tiap user punya bot, kredensial, dan notifikasi sendiri
- **Ekspor CSV** riwayat, price alert, equity curve per bot
- Telegram: `/status /balance /positions /price /pnl /pause /resume /logs /panic` + notifikasi otomatis
- Proxy per-exchange & Telegram (HTTP/HTTPS/SOCKS5)
- API keys terenkripsi AES-256-GCM

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
# Buka http://127.0.0.1:3000 → buat akun admin (setup pertama) → login
```

Mode development (hot reload):
```bash
npm run dev   # server :3000 + vite :5173 (proxy ke server)
```

### Dengan Docker (satu klik)
```bash
SECRET_KEY="isi_min_32_karakter_acak" docker compose up --build -d
# Buka http://127.0.0.1:3000
```

## Setup Awal (per user)
1. **Login** → buka **Pengaturan → Exchange**: isi API key/secret, pilih mode (Demo dulu!), isi proxy bila koneksi diblokir (error 3701). Klik **Uji koneksi**.
2. **Pengaturan → Telegram**: isi Bot Token (dari @BotFather) + Chat ID Anda. Klik **Simpan dan uji kirim**.
3. **Marketplace**: instal preset ke exchange pilihan (bot dibuat dalam keadaan dijeda).
4. Atau **Strategi**: pilih exchange + koin → Analisis → pilih preset → uji backtest → atur parameter → **Aktifkan Bot** (mode Demo).
5. Pantau di **Dashboard** & **Bot**. Jika performa bagus di Demo, baru aktifkan mode Riil.
6. Admin dapat menambah user lain via **Pengaturan → Pengguna**.

## Tes (88 tes E2E, tanpa uang sungguhan)
```bash
npm run test:all
# Tes koneksi exchange publik:
npm run test:exchanges
# Dengan proxy: TEST_PROXY="http://user:pass@host:port" npm run test:exchanges
```

## Dokumentasi
Semua perencanaan & rancangan ada di [`docs/`](docs/): PRD, arsitektur, skema DB, spesifikasi API, strategi, engine, Telegram, UI, audit live-trading, hardening, fitur roadmap, multi-user/marketplace, tasks, roadmap.

## Catatan Penting
- `api.tokocrypto.com` dan `api.binance.com` diblokir dari banyak IP Indonesia → gunakan proxy (Pengaturan → exchange terkait). Base URL bisa dioverride via env `TOKOCRYPTO_BASE_URL` / `BINANCE_BASE_URL`.
- Untuk Indodax disarankan generate **API key TAPIv2** (bot otomatis memakai jalur v2 bila key valid).
- Trading kripto berisiko tinggi. Selalu uji di mode Demo dulu. Bot ini alat bantu, bukan jaminan profit.
- Server bind `127.0.0.1` secara default.
