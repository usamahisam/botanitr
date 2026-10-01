# PRD — Trading Botani

## 1. Ringkasan Produk
Aplikasi web **trading bot multi-bot** untuk exchange kripto Indonesia (Indodax & Tokocrypto) dengan kontrol penuh via **Telegram** dan dukungan **proxy per-exchange**. Single user, dijalankan di VPS/local pribadi.

## 2. Tujuan
- Otomatisasi trading (Grid, DCA, Scalper, Inventory Harvester) dengan budget terpisah per bot.
- Monitoring portfolio real-time dalam IDR (saldo, profit, win rate, kas bebas, order pending).
- Notifikasi & kontrol penuh via Telegram tanpa membuka dashboard.
- Akses exchange yang butuh proxy (mis. Tokocrypto dari jaringan tertentu).
- Mode **paper trading** default untuk uji strategi sebelum pakai uang riil.

## 3. Pengguna
Single user (pemilik bot). Tidak ada sistem login; proteksi lewat bind `127.0.0.1` / reverse proxy eksternal oleh user. API keys disimpan terenkripsi AES-256-GCM di SQLite.

## 4. Lingkup Fitur (v1)

### 4.1 Dashboard
- Total Portfolio (IDR) + badge perubahan 24 jam.
- Kartu per exchange: Saldo, Profit Harian, Profit Total, Kas Bebas (IDR/USDT), Nilai Pending Orders, % posisi, daftar koin (simbol, porsi %, nilai IDR), tombol **Sinkron Ulang Saldo**, badge Akun Riil / Demo.
- Panel samping: Realized Profit & Win Rate, Floating 24J, Profit per Exchange.
- Tombol **Quick Trade** (beli/jual cepat per exchange).

### 4.2 Multi-Bot
- Banyak bot berjalan paralel, masing-masing: nama, exchange, pasangan, strategi, parameter, budget IDR/USDT, status (running/paused), tren profit (mini-chart), statistik (win rate, profit total).
- Pause/resume/hapus per bot.

### 4.3 Strategi (4)
1. **Grid** — N level buy/sell dalam range %; `GRID_UNWIND`: likuidasi seluruh level di titik breakeven VWAP → profit.
2. **DCA** — beli tiap harga turun x% dari beli terakhir; jual semua saat target profit y% tercapai.
3. **Scalper 1m** — EMA20/50 crossover + RSI14 (oversold/overbought), TP/SL % dari entry.
4. **Inventory Harvester** — akumulasi saat harga turun (bertahap), jual cukup untuk **modal kembali cair + profit bersih** saat target tercapai.

### 4.4 Auto-Compound
- Setelah profit direalisasi, % (default 100%) di-reinvest ke budget bot; lot dihitung ulang.

### 4.5 AI Wizard (rule-based)
3 langkah: **Rekomendasi** (skor 4 preset via backtest candle historis) → **Parameter** (form terisi, editable) → **Aktivasi** (pilih Demo/Riil → bot jalan).

### 4.6 Telegram
- Commands: `/start /help /status /balance /positions /price <pair> /buy /sell /pause /resume /stop /pnl /logs [n]`.
- Notifikasi otomatis: eksekusi trade, error engine, ringkasan harian 00:00 WIB, alert budget < minimum.
- Whitelist chat_id.

### 4.7 Proxy
- Per exchange + Telegram. Format HTTP/HTTPS/SOCKS5. Disimpan di DB. Tombol "Test Koneksi".

### 4.8 Riwayat
- Tabel semua trades dengan filter (exchange, bot, strategi, mode, tanggal).

## 5. Non-Fungsional
- Node.js ≥ 20, TypeScript, SQLite (file di `server/data/`).
- Server bind `127.0.0.1:3000` default.
- API keys AES-256-GCM (SECRET_KEY dari `.env`), tidak pernah dikirim balik ke frontend (masked).
- Rate-limit aware: stagger per-bot tick, exponential backoff saat error.
- UI Bahasa Indonesia.

## 6. Asumsi & Risiko
| # | Risiko | Mitigasi |
|---|---|---|
| 1 | `api.tokocrypto.com` timeout dari jaringan lokal | baseURL configurable, default `www.tokocrypto.com`, proxy per exchange |
| 2 | Saldo real < budget bot | Guard saldo minimum Rp 10.000 / $1; paper mode default ON |
| 3 | Rate-limit exchange | Stagger tick 5–10s per bot, cache ticker, backoff |
| 4 | Indodax lot minimum IDR | Simpan `min_lot` per pasangan di `default_pairs` |
| 5 | SECRET_KEY lemah | `.env.example` + warning; validasi min 32 chars |

## 7. Kriteria Sukses
- Server jalan, dashboard menampilkan saldo real/paper kedua exchange.
- Bot paper Grid menghasilkan trades + log `GRID_UNWIND` dengan profit.
- Notifikasi Telegram terkirim untuk trade.
- Build & typecheck lolos; proxy Tokocrypto bekerja (test koneksi).

## 8. Di Luar Lingkup v1
- Multi-user & login, backtest UI interaktif, futures/leverage nyata, trailing stop kompleks, mobile app.
