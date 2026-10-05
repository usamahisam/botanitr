# 06 — Telegram Bot

Library: **Telegraf 4**. Proxy via agent (lihat 04). Polling (bukan webhook) agar tidak perlu domain.

## Instance per-user (multi-bot Telegram)
Satu token Telegram = satu polling loop. Server menjalankan **satu instance Telegraf per pemilik token**: token env (`TELEGRAM_BOT_TOKEN`) + token milik tiap user (`telegram_bot_token` di settings masing-masing). Token yang sama hanya dijalankan sekali (hindari konflik polling 409). Proxy juga per pemilik token (`proxy_telegram` masing-masing user).
- Notifikasi otomatis dirutekan ke instance milik user yang bersangkutan — chat user A tidak pernah dikirimi lewat bot user B.
- Pesan sistem (`user_id` null) dikirim lewat instance yang relevan dengan tiap chat tujuan.
- Tanpa token sama sekali → fitur Telegram mati (aman default).

## Whitelist
`telegram_allowed_chat_ids` (settings per user; env `TELEGRAM_ALLOWED_CHAT_IDS` sebagai fallback). Tabel `telegram_chats` memetakan chat_id → user untuk routing perintah & notifikasi. Middleware menolak chat_id tak dikenal dengan pesan "Akses ditolak". Jika kosong → bot menolak semua (aman default).

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
