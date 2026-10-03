# 13 — Fitur Roadmap v1 (Trailing Stop, Equity Curve, Price Alert)

Tiga fitur lanjutan dari roadmap yang dieksekusi sekaligus. Semua terverifikasi E2E via `test:features` (12/12 ✅).

## 1. Trailing Stop Scalper

Mengunci profit saat harga berbalik dari puncak.

- Param baru `trailing_pct` (default `0` = nonaktif). Nama param tampil sebagai "Trailing Stop (% — 0=nonaktif)" di Wizard.
- Logika di `strategies/scalper.ts`: setiap tick, `position.peakPrice` diperbarui ke harga tertinggi; exit otomatis jika harga turun `trailing_pct%` dari puncak. Hanya aktif setelah profit (puncak harus > entry + trailing agar tidak langsung kena noise entry).
- Tag exit memakai `SCALPER_EXIT` agar masuk statistik win rate dan filter Trades.
- **Refactor penting**: TP/SL/trailing dievaluasi **sebelum** bagian candle (EMA/RSI) — posisi selalu terproteksi meski data klines belum cukup.

## 2. Equity Curve per Bot

Grafik performa equity harian di kartu bot.

- Tabel baru `bot_equity(bot_id, date, equity_quote, recorded_at)` + `bot_equity` upsert harian per bot.
- `engine/equity.ts`: `recordDailyEquity()` (current_budget + floating PnL posisi), dijalankan 30 detik setelah boot lalu tiap 6 jam. `getEquityCurve(botId, days)` menggabungkan titik awal budget (saat pembuatan) + equity harian.
- Endpoint `GET /api/bots/:id/equity?days=30`.
- UI: kartu bot menampilkan **AreaChart equity** (hijau jika naik, merah jika turun) menggantikan sparkline PnL, dengan tooltip `fmtIDR`.

## 3. Price Alert Kustom

Notifikasi Telegram one-shot saat harga menyentuh target.

- Tabel `price_alerts(id, exchange_id, pair, direction, target_price, note, active, triggered_at, created_at)`.
- `engine/alerts.ts`: cek tiap 20 detik (mulai 15 detik setelah boot); saat terpicu → alert dinonaktifkan (`active=0`), log + notifikasi Telegram format `🔔 PRICE ALERT: PAIR 📈/📉 target`.
- Endpoint: `GET /alerts`, `POST /alerts` (validasi direction + target), `DELETE /alerts/:id`.
- UI: halaman baru **Alert** di navigasi — form buat alert (exchange, pair, kondisi above/below, target, catatan), daftar aktif, dan riwayat terpicu.

## Verifikasi E2E — `test:features` (12/12 ✅)

| Grup | Kasus | Hasil |
|---|---|---|
| A) Trailing | peakPrice tercatat saat harga naik | ✅ |
| | belum exit di atas trail price | ✅ |
| | trailing exit terpicu di bawah trail price | ✅ |
| | posisi ditutup setelah trailing | ✅ |
| B) Equity | recordDailyEquity ≥1 bot | ✅ |
| | curve tidak kosong + titik hari ini | ✅✅ |
| | titik awal budget (kasus sama-hari) | ✅ |
| C) Alert | alert above terpicu saat harga ≥ target | ✅ |
| | nonaktif + triggered_at tercatat setelah terpicu | ✅✅ |
| | alert below tidak terpicu saat harga di atas | ✅ |

## Suite Test Keseluruhan (55/55 ✅)

| Test | Cakupan | Hasil |
|---|---|---|
| test:live-mock | Protokol Indodax v1 | 13/13 ✅ |
| test:live-e2e | Jalur bot live penuh | 11/11 ✅ |
| test:killswitch | Kill switch global | 7/7 ✅ |
| test:safety | TAPI v2 + max daily loss + reconciler | 12/12 ✅ |
| test:features | Trailing + equity + alert | 12/12 ✅ |

Jalankan: `npm run test:all`
