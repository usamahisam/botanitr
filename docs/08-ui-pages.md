# 08 — Halaman UI (Bahasa Indonesia)

Tema terang, Tailwind. Router: `/` Dashboard, `/bots`, `/wizard`, `/riwayat`, `/pengaturan`. Komponen bersama di `web/src/components/`.

## 1. Dashboard (`/`)
- Header: "Total Portfolio (IDR)" besar + badge `+0,15% (+Rp 8.140) 24J` (hijau/merah).
- Grid 2 kolom kartu exchange:
  - Judul "Saldo di Indodax / Tokocrypto" + badge `Akun Riil`/`Demo` + status koneksi.
  - Angka saldo besar, `+x% (+Rp y)`, `porsi %` posisi.
  - Baris: Profit Harian 24J / Profit Total ALL; Kas Bebas (IDR/USDT) / Pending (nilai + jumlah order).
  - Tab "Semua Koin (n)" | "Order Pending"; list koin: simbol, perubahan %, nilai Rp, qty.
  - Tombol "Kelola / Sinkron Ulang Saldo".
- Panel kanan: "Realized Profit & Win Rate": `+Rp 55.706`, `Win Rate (11/113)`, `Floating 24J`, `Profit Per Exchange` per baris. Tombol "Quick Trade" (modal: exchange, pair, side, nominal, mode).

## 2. Bots (`/bots`)
- Grid kartu bot: nama, pair, strategi badge, status (Running hijau/Paused abu), sparkline tren profit (Recharts), statistik kecil (budget, profit, win), tombol Pause/Resume + Hapus.
- Pagination "Menampilkan 1–8 dari N bot".
- **Log Operasional Mesin Otomatis Live** di bawah: filter `Semua|Peringatan|Trades`, tombol "Bersihkan Log", feed live (Socket.IO) dengan timestamp, tag berwarna, pesan, `+Rp impact` di kanan.

## 3. Wizard (`/wizard`)
Modal/halaman 3 langkah dengan indikator step:
1. **Rekomendasi AI**: pilih exchange + koin → tombol "Analisis" → daftar preset terurut skor: nama, gaya, badge skor & win rate backtest, parameter ringkas (Leverage/TP-SL/Timeframe), tombol "Pilih Preset".
2. **Parameter Strategi**: form terisi dari preset (budget, mode Demo/Riil, parameter strategi, auto-compound %).
3. **Aktivasi & Deploy**: ringkasan + tombol "Aktifkan Bot" → redirect ke /bots.

## 4. Riwayat (`/riwayat`)
Tabel trades: waktu, exchange, pair, side, harga, qty, nilai, fee, PnL, mode, strategi. Filter: exchange, mode, strategi, rentang tanggal. Pagination server-side (`limit/offset`).

## 5. Pengaturan (`/pengaturan`)
- **Exchange**: per kartu — API Key (masked, input baru menimpa), Secret (masked), dropdown Mode Demo/Riil, field Proxy, tombol "Test Koneksi" (hasil latency/error), tombol Simpan.
- **Telegram**: Bot Token (masked), Chat ID allowed, tombol "Simpan & Test Kirim".
- **Umum**: toggle "Mode paper default untuk bot baru", jam ringkasan harian.
- Info: `SECRET_KEY` di server, warning live trading.

## Komponen Kunci
`ExchangeCard`, `CoinRow`, `ProfitPanel`, `BotCard`, `LogFeed`, `QuickTradeModal`, `PresetCard`, `Stepper`, `MaskedInput`, `StatusBadge`, `fmtIDR` util (sama format dgn server).
