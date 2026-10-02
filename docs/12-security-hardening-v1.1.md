# 12 — Security Hardening v1.1

Tiga fitur keamanan lanjutan yang dieksekusi setelah audit live trading (lihat `11-audit-live-trading.md`). Semua terverifikasi E2E via mock (tanpa uang sungguhan).

## 1. Migrasi Indodax TAPI v2 (auto-detect)

**Latar belakang:** `tradeHistory` & `orderHistory` TAPI v1 (legacy `/tapi`) dijadwalkan **decommission April 2026** — fungsi rekonsiliasi fill saya bergantung padanya. TAPI v2 adalah pengganti resmi (Binance-style).

**Perbedaan v2 vs v1:**
| Aspek | v1 (legacy) | v2 (baru) |
|---|---|---|
| Base URL | `https://indodax.com` | `https://api.indodax.com` |
| Auth | `Key` + HMAC-**SHA512** (body) | `X-APIKEY` + HMAC-**SHA256** (query string) |
| Endpoint | `/tapi` (method=getInfo/trade/...) | `/api/v2/account`, `/api/v2/order`, `/api/v2/myTrades`, ... |
| API Key | key v1 biasa | **key khusus TAPIv2** (generate di indodax.com/trade_api) |
| IP whitelist | opsional | **wajib** untuk permission trading |

**Implementasi:**
- `exchange/indodax-v2.ts`: client v2 lengkap (`getBalances`, `getOpenOrders`, `cancelOpenOrders`, `buyMarket`/`sellMarket` dengan `quoteOrderQty`/`quantity`, rekonsiliasi fill via `GET /api/v2/myTrades`).
- `exchange/indodax.ts` **auto-detect**: saat pertama kali dipakai, `probe()` ke `/api/v2/account`; jika kredensial valid sebagai key v2 → semua operasi didelegasikan ke v2; jika tidak → fallback v1 (legacy). Hasil deteksi di-log & di-cache (reset saat kredensial berubah).
- Base URL v2 bisa dioverride via env `INDODAX_V2_BASE_URL` (untuk testing).

**Implikasi untuk pengguna:** jika Anda generate **API key TAPIv2 baru** (disarankan), bot otomatis memakai jalur v2 yang lebih stabil. Jika masih pakai key v1, tetap berfungsi sampai legacy dimatikan — tapi sebaiknya migrasi.

## 2. Max Daily Loss Limit (per bot)

Auto-pause bot jika rugi realized hari ini melewati batas persentase budget.

- Kolom baru `bots.max_daily_loss_pct` (default `0` = nonaktif). Migrasi ringan `ALTER TABLE` otomatis untuk DB lama.
- Guard di `scheduler.processBot` (dijalankan sebelum strategi tiap tick): jika `|realizedToday| >= max_daily_loss_pct% × current_budget` → `status='paused'` + log + **notifikasi Telegram**.
- Parameter `max_daily_loss_pct` tersedia di `POST /api/bots` dan field **"Batas Rugi Harian (%)"** di Wizard langkah 2.

## 3. Reconciler Drift (posisi bot vs saldo exchange)

Deteksi ketidaksesuaian antara posisi yang dicatat state bot dan saldo aktual di exchange (bisa terjadi karena order manual, partial fill, atau intervensi di luar bot).

- `engine/reconciler.ts`: tiap 10 menit, untuk setiap bot **live** dengan posisi tercatat, bandingkan `recorded_qty` (dari `bots.state`) vs saldo `free+locked` aktual di exchange.
- Jika drift > toleransi (default 5%) → log `warn` + **notifikasi Telegram** berisi rincian per bot.
- Hanya untuk mode live (paper selalu konsisten dengan simulator).
- Jalan otomatis saat server start (`startReconciler`), juga bisa dipanggil `reconcileOnce()`.

## Verifikasi E2E — `test:safety` (12/12 ✅)
- **A) TAPI v2**: auto-detect memanggil `/api/v2/account` (bukan v1), header `X-APIKEY` benar, saldo terbaca, fill buy direkonsiliasi dari `myTrades` (qty=3.75 sesuai mock).
- **B) Max daily loss**: bot dengan batas 5% (Rp 5.000) + rugi tercatat -Rp 6.000 → guard mendeteksi & bot auto-paused.
- **C) Reconciler**: bot mencatat 3.75 XRP tapi saldo mock 7.5 XRP → drift 100% terdeteksi.

## Menjalankan Tes
```bash
npm run test:safety -w server    # 3 fitur keamanan
npm run test:all                  # seluruh suite (43 tes)
```

## Suite Test Keseluruhan (43/43 ✅)
| Test | Cakupan | Hasil |
|---|---|---|
| test:live-mock | Protokol Indodax v1 (signature, market order, idempotensi) | 13/13 ✅ |
| test:live-e2e | Jalur bot live penuh | 11/11 ✅ |
| test:killswitch | Kill switch global | 7/7 ✅ |
| test:safety | TAPI v2 + max daily loss + reconciler | 12/12 ✅ |

## Checklist Go-Live Diperbarui
1. **(Disarankan)** Generate **API key TAPIv2** di indodax.com/trade_api → permission **Spot Trading**, set **IP whitelist** ke IP server. Bot akan otomatis memakai v2. (Jangan aktifkan withdrawal.)
2. Isi key/secret → Test Koneksi. Tokocrypto: isi proxy.
3. Saat buat bot, pertimbangkan isi **Batas Rugi Harian** (mis. 5%) sebagai pengaman.
4. Mode Riil dengan budget kecil dulu, pantau Log Operasional + notifikasi drift/max-loss di Telegram.
