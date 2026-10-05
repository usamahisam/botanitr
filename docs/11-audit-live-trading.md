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

## Insiden nyata: error -1102 berulang di bot live (dipicu 2026-10-05, diperbaiki hari yang sama)
- **Gejala**: bot live Grid DOGE melempar `Indodax v2: ... Mandatory parameters symbol, side, type were not sent` (kode -1102) setiap tick. Dana AMAN — gagal tertutup, tak ada order terkirim.
- **Root cause**: `signed()` mengirim parameter POST di **query string**. Backend Java Indodax hanya membaca parameter POST dari **body** (`@FormParam`), persis seperti contoh Python resmi (body + header `Sign`), bukan contoh curl-nya. Contoh curl di dokumentasi vendor ternyata tidak mencerminkan perilaku server.
- **Perbaikan**: POST → body urlencoded + signature di header `Sign`. GET/DELETE tidak berubah (terbukti jalan live: probe, saldo, sinkron OK).
- **Celah mock yang ditutup**: mock lama menerima POST query-string sehingga bug lolos. Mock kini meniru server ketat (tolak POST tanpa body → 412/-1102). Terbukti: tanpa fix, tes FATAL dengan error -1102 persis produksi; dengan fix, 12/12 lolos.
- **Pelajaran audit**: mock E2E harus meniru *validasi* server nyata, bukan sekadar format respons. Berlaku juga untuk Bittime (dokumentasinya membolehkan query-string POST — dibiarkan mengikuti dok sampai ada kunci live untuk verifikasi; bila kena dinding yang sama, perbaikannya satu baris yang sama).

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
- Reconciler berkala: bandingkan posisi bot vs saldo exchange aktual, peringatkan jika drift.
- Trailing stop & max daily loss limit per bot.

## 🚨 Kill Switch Global (ditambahkan pasca-audit)
Fitur darurat satu aksi: **pause semua bot + batalkan semua open order live**.

**Implementasi:**
- `ExchangeClient.cancelOpenOrders(pair?)` di Indodax (`cancelOrder` per order; `openOrders` tanpa pair mengembalikan object per-pair → di-flatten) & Tokocrypto (`DELETE /api/v3/openOrders`, fallback per-order). Paper → 0.
- `engine/killswitch.ts` `activateKillSwitch(triggeredBy)`: pause semua bot running → cancel open order live semua exchange → log `SYSTEM` + notifikasi Telegram.
- Endpoint `POST /api/killswitch`.
- Tombol merah **"Kill Switch (Darurat)"** di Dashboard (dengan konfirmasi).
- Telegram `/panic` dengan konfirmasi inline button.

**Verifikasi E2E:** `test:killswitch` **7/7 ✅** — 2 bot running + 2 open order mock → semua paused + semua order dibatalkan, tanpa error.

Jalankan: `npm run test:killswitch -w server`

## Audit Putaran 2 — Stop/Resume & Seluruh Alur (Okt 2026)
Audit sistematis backend + frontend + HTTP menemukan dan memperbaiki:

**Strategi (anti dust-loop → dust-hold):** grid/harvester/scalper menahan
(dust-hold) aksi di bawah `ctx.minLot` alih-alih menjual paksa atau menghapus
state (menghapus = abandon aset riil). Fill-deferral: `levelsHit`/`lastEntryPrice`/
`position` maju hanya via `applyFillToState` setelah fill terkonfirmasi.
Grid re-anchor saat keluar range tanpa posisi. Scalper tahan crash saat
`state.candles` undefined (state legacy) + filter candle korup.
Rebalance: normalisasi targets + fallback quote bila `ctx.quote` kosong.

**Engine:** stagger per-bot via `shouldTick` + `pruneTickCache`; skip log
di-throttle (`logSkipOnce`, 1/15 mnt per sebab) agar DB tak bloat;
koersi defensif hasil fill; compound dijepit ke budget.

**API:** helper `num()` untuk semua query numerik (tak ada lagi 500 karena
`LIMIT 'rusak'`); validasi budget/mode/strategi/compound/target/alert/
marketplace; quick-trade pre-flight saldo; alert tolak exchange tak dikenal.

**Auth:** `loginRateLimit` (10/5 mnt/IP), hapus user kaskade penuh
(bots, exchanges, settings, dsb.) + token user terhapus jadi 401.

**Telegram/Index:** guard `ctx.chat` di `/panic`, tangkap `unhandledRejection`.

**Frontend:** `safeNum` di format, guard hapus alert, ExchangeCard refresh
sinkron, download CSV tangani 401, Pengaturan sinkron state, Wizard retry analisis.

**Verifikasi:** `npm run test:all` **215/215 ✅** termasuk file baru
`test:audit-http` (23 cek lapisan HTTP) dan `test:resume` (38 cek).
