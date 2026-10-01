# 11 — Audit Jalur Live Trading & Hasil E2E

Tanggal audit: sesi implementasi v1.0. Auditor: AI. Ruang lingkup: kesiapan mode **Riil** (live) untuk Indodax & Tokocrypto.

## Ringkasan Eksekutif
Jalur live trading **aman digunakan dengan catatan**: selalu uji kecil dulu (nominal minimum), gunakan API key dengan permission **view+trade saja (TANPA withdraw)**, dan pantau log. Seluruh temuan kritis telah diperbaiki dan diverifikasi dengan **mock exchange** (24 tes lolos) — tanpa memakai uang sungguhan.

## Temuan & Perbaikan

### 🔴 Kritis (diperbaiki)
| # | Temuan | Dampak | Perbaikan | Status |
|---|---|---|---|---|
| 1 | Indodax `trade` dikirim `price: 0` untuk market order | Order live akan **ditolak** exchange (docs: market tidak boleh bawa `price`) | Market order kini `order_type: 'market'` **tanpa** `price`; buy pakai `idr`, sell pakai qty base | ✅ |
| 2 | Limit buy dengan `idr` + `order_type` default LIMIT → reject | Buy live gagal | Dipisah jelas: market tidak menyertakan kombinasi terlarang | ✅ |
| 3 | Fill diasumsikan dari ticker (bukan fill aktual); market buy bisa "under-filled" | Qty/PnL tercatat salah, bisa jual lebih dari yang dimiliki | Rekonsiliasi fill via `getOrderByClientOrderId` + `tradeHistory` (harga VWAP, qty, fee aktual) | ✅ |
| 4 | Idempotensi hanya cek DB lokal → double order saat restart sebelum commit | **Double spend** | `client_order_id` dikirim ke exchange (native Indodax & `newClientOrderId` Binance-style) + cek DB | ✅ |
| 5 | Quick trade live tanpa guard kredensial/mode | Bisa kirim order live tanpa sadar | Guard: exchange harus mode live + kredensial ada + validasi min lot & side | ✅ |

### 🟡 Menengah (diperbaiki)
| # | Temuan | Perbaikan | Status |
|---|---|---|---|
| 6 | Tokocrypto sell qty tidak dinormalisasi → bisa kena filter LOT_SIZE | Tambah `exchangeInfo` filter (stepSize/minQty) + roundDown | ✅ |
| 7 | `client_order_id` mengandung karakter tak valid & bisa >36 char | Sanitasi alfanumerik `_-`, potong 36 char | ✅ |
| 8 | Error Tokocrypto 3701 (IP diblokir) tidak jelas | Pesan spesifik: "isi proxy di Pengaturan" | ✅ |
| 9 | Error kredensial di-retry terus oleh scheduler | Bot live auto-pause saat error kredensial/izin | ✅ |

### 🟢 Catatan (bukan bug, batasan diketahui)
- **Tokocrypto dari IP Indonesia** diblokir (3701) → wajib proxy. Sudah didukung per-exchange.
- **Fee** diasumsikan 0.3% (Indodax) / 0.1% (Tokocrypto) untuk kalkulasi paper; live memakai fee aktual dari tradeHistory.
- Indodax tidak punya endpoint OHLC resmi → klines diagregasi dari `/trades` (cukup untuk scalper jangka pendek).
- Market buy Indodax hanya mendukung nominal `idr` (bukan qty) — sudah sesuai desain.

## Verifikasi E2E (mock exchange, tanpa uang sungguhan)

### `test:live-mock` — validasi protokol Indodax (13/13 ✅)
- Signature HMAC-SHA512 diterima; kredensial salah ditolak
- BUY MARKET: `order_type=market`, tanpa `price`, pakai `idr`, `client_order_id` terkirim
- SELL MARKET: `order_type=market`, qty base, tanpa `price`
- Duplikat `client_order_id` → ditolak (idempotensi bekerja)

### `test:live-e2e` — jalur bot live penuh (11/11 ✅)
- Exchange di-set mode live + kredensial termuat dari DB terenkripsi
- Bot live dibuat, strategi DCA menghasilkan aksi buy
- `executeAction` → order live ke mock, tercatat `mode='live'`, `order_id`, `client_order_id`, qty terisi
- Saldo mock berkurang (mutasi benar), tidak ada order nyata keluar

## Cara Menjalankan Tes
```bash
npm run test:live-mock -w server   # protokol Indodax vs mock
npm run test:live-e2e -w server    # jalur bot live penuh vs mock
npm run test:exchanges -w server   # koneksi publik nyata (ticker)
```

## Checklist Go-Live untuk Pengguna
1. API key Indodax: permission **view + trade**, **JANGAN** aktifkan withdraw.
2. Isi API key/secret di Pengaturan → Exchange → **Test Koneksi** → OK.
3. Untuk Tokocrypto: isi **proxy** bila Test Koneksi gagal (3701).
4. Ubah exchange ke mode **Riil** (butuh kredensial valid).
5. Buat bot mode Riil dengan **budget kecil** dulu (mis. Rp 50.000) + centang konfirmasi risiko.
6. Pantau halaman **Bot → Log Operasional** & Telegram selama beberapa siklus.
7. Naikkan budget bertahap setelah yakin.

## Rekomendasi Lanjutan (roadmap v1.1+)
- Migrasi `tradeHistory`/`orderHistory` ke Indodax Trade API v2 (`/api/v2/myTrades`) sebelum deprecasi April 2026.
- Tambah "kill switch" global (pause semua + batalkan open orders) satu tombol.
- Reconciler berkala: bandingkan posisi bot vs saldo exchange aktual, peringatkan jika drift.
- Trailing stop & max daily loss limit per bot.
