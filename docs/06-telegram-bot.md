# 06 — Telegram Bot

Library: **Telegraf 4**. Proxy via agent (lihat 04). Aktif hanya jika `TELEGRAM_BOT_TOKEN` terisi (env atau settings DB). Polling (bukan webhook) agar tidak perlu domain.

## Whitelist
`TELEGRAM_ALLOWED_CHAT_IDS` (env) atau `telegram_allowed_chat_ids` (settings). Middleware menolak chat_id lain dengan pesan "Akses ditolak". Jika kosong → bot menolak semua (aman default).

## Commands
| Command | Deskripsi |
|---|---|
| /start, /help | daftar command |
| /status | ringkasan: jumlah bot running/paused, portfolio total IDR, mode tiap exchange |
| /balance | saldo per exchange (kas bebas + koin utama + nilai IDR) |
| /positions | posisi terbuka semua bot (pair, qty, avg cost, floating %) |
| /price <PAIR> | harga terkini (contoh: `/price XRPIDR`) |
| /buy <PAIR> <NOMINAL> | quick buy (mode sesuai exchange; konfirmasi inline button) |
| /sell <PAIR> <QTY|100%> | quick sell |
| /pause [id], /resume [id] | pause/resume semua atau bot tertentu |
| /stop <id> | stop + hapus bot (konfirmasi) |
| /pnl | realized total, win rate, profit harian, floating 24j |
| /logs [n] | n log terakhir (default 5) |

## Format Notifikasi Trade
Dikirim otomatis oleh `engine` setelah eksekusi:
```
🌾 INVENTORY HARVESTER: MODAL KEMBALI CAIR
Bursa: TOKOCRYPTO
Aset: XRP (3,787291)
Harga Jual: Rp 25.230
Kas IDR Bebas: +Rp 95.564
Net Profit Realized: +Rp 964
```
Template lain: `GRID_UNWIND`, `DCA_TP`, `SCALPER_TP/SL`, `AUTO_COMPOUND` (`New Budget: Rp X, Lot: Rp Y`), `ERROR` (alert engine/API gagal), `SYSTEM` (bot start/stop).

## Ringkasan Harian
Cron sederhana (setInterval 60s cek jam `daily_summary_time`, default `00:00` WIB, dedup via `last_summary_date`): kirim total portfolio, profit harian per exchange, jumlah trade, win rate.

## Format Angka
`fmtIDR()` di `utils/format.ts`: `Rp 1.234.567` (grup titik, desimal koma). Qty aset: 6 digit signifikan dengan koma desimal.
