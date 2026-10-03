# 14 — Redesain UI: Terminal Gelap (tanpa AI slop)

Tanggal: setelah v1.1. Tujuan: menghilangkan tampilan generik "AI slop" (emoji di mana-mana, kartu pastel, copy berlebihan) dan menggantinya dengan **terminal trading profesional**.

## Prinsip Desain
1. **Data dulu, dekorasi kemudian** — angka mono tabular, tabel padat, bukan kartu besar.
2. **Nol emoji di UI** — semua ikon memakai set SVG inline `components/icons.tsx` (stroke 1.8px).
3. **Disiplin warna** — naik `#2ebd85`, turun `#f6465d`, aksen `#4f7cff`, peringatan `#f0b90b`. Tidak ada gradien pastel/glow.
4. **Salinan profesional** — Bahasa Indonesia ringkas: "Order cepat", "Mode darurat", "Jeda/Lanjut", "Bersihkan". Tanpa tanda seru & ajakan berlebihan.
5. **Angka stabil** — kelas `.num` (monospace + tabular-nums) untuk semua uang/harga/qty agar tidak "bergetar" saat refresh.

## Tema (`index.css`)
- Latar `#090d13`, panel `#0f151d`, garis `white 7%`, radius 6–8px, tanpa shadow besar.
- Utilitas bersama: `.panel`, `.panel-head`, `.lbl` (label mikro uppercase), `.input`, `.btn` (+varian primary/ghost/buy/sell/danger), `.tag` (+up/down/dim/warn/accent), `.tbl` (tabel terminal), `.seg` (segmented control).
- Scrollbar tipis; animasi tape marquee (pause saat hover); `color-scheme: dark`.

## Shell (`App.tsx`)
- Header 52px: logo candlestick SVG + "BOTANI / TERMINAL", nav tab berikon, jam WIB live, indikator koneksi WebSocket (LIVE/OFFLINE).
- `index.html`: judul "Botani Terminal", theme-color gelap, anti-flash putih.

## Halaman
- **Dashboard**: ticker tape (marquee 14 pair top-volume, `/api/market`, refresh 60s) → hero portofolio (angka 34px + delta 24J + USDT/IDR + win rate) → 2 panel exchange (header LIVE/DEMO + status, 4-stat grid, tabel aset + bar porsi) → rail kanan (kinerja terealisasi, Order cepat, Mode darurat).
- **Bot**: ringkasan jumlah, kartu bot (status dot, equity AreaChart tanpa animasi, budget/profit/win, tombol Jeda/Lanjut + hapus ikon), paginasi; **Log operasional** gaya konsol gelap (`#0a0f16`, mono 12px, tag berwarna teks, impact kanan).
- **Strategi (Wizard)**: stepper rail 3 langkah, preset sebagai baris bernomor + skor, tabel ringkasan deploy, mode Demo/Riil sebagai tombol buy/sell-style, checkbox risiko amber.
- **Riwayat**: tabel mono padat (BELI hijau / JUAL merah teks, tag RIIL/DEMO), filter, paginasi.
- **Peringatan**: form 5 kolom, tabel aktif + riwayat terpicu.
- **Pengaturan**: panel per exchange (key tersamar, proxy, mode, uji + simpan), panel Telegram, panel Umum + status enkripsi.

## Backend Pendukung
- `GET /api/market` — top 14 pair IDR by volume dari Indodax `summaries` (pakai proxy exchange bila ada), cache 60 detik.
- `fmtNum()` di `web/src/lib/format.ts` untuk angka tape.

## Verifikasi
- `grep` emoji di `web/src`: **0 hasil**.
- `tsc` server + web bersih, `vite build` OK.
- Suite E2E tetap **55/55 ✅** (redesign murni frontend + 1 endpoint read-only).
