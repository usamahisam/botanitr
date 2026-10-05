# 10 — Keamanan

## Penyimpanan Kredensial
- API key/secret exchange & token Telegram disimpan **terenkripsi AES-256-GCM** di SQLite (`server/crypto.ts`).
- Kunci: `SECRET_KEY` env (wajib ≥ 32 chars; derive via scrypt → 32 byte). IV acak 12 byte per enkripsi; format `iv.tag.cipher` (base64).
- Frontend hanya menerima versi masked: `••••` + 4 karakter terakhir. Update hanya jika field diisi.

## Live Trading Guard
- Bot baru default `paper` (setting `default_paper_mode=true`).
- Aktivasi live butuh: exchange mode `live` + kredensial valid (test koneksi) + konfirmasi checkbox "Saya paham risiko" di UI (flag `confirmed_live` pada request).
- Guard saldo: order < min_lot atau saldo kurang → ditolak + log + notif Telegram.

## Jaringan
- Server bind `127.0.0.1` default (`HOST` env). Untuk akses publik, user wajib pakai reverse proxy + auth sendiri (di luar scope).
- Proxy disimpan plaintext di DB (bukan rahasia selevel API key; berisi kredensial proxy opsional — didokumentasikan di UI).

## Whitelist IP API Key Indodax
- Indodax menilai izin API berdasarkan **IP publik mesin yang memanggil API** (bukan IP server web / IP rumah Anda).
- Bot berjalan di VPS → yang dilihat Indodax adalah **IP outbound VPS**. Cek dengan perintah ini di VPS:
  ```bash
  curl -s ifconfig.me
  ```
  Isi hasilnya ke whitelist IP di pengaturan API key Indodax (biasanya `43.134.232.199` untuk instalasi ini).
- **Pengecualian penting**: bila di Pengaturan → Indodax Anda mengisi **proxy**, maka yang dilihat Indodax adalah **IP exit proxy tersebut**, bukan IP VPS. Whitelist IP proxy-nya (tanyakan ke penyedia proxy / cek via proxy: `curl -x <proxy> -s ifconfig.me`).
- Kunci **TAPIv2 mewajibkan** IP whitelist untuk permission trading — tanpa ini order live ditolak (`-2015`), dan bot live akan auto-pause oleh engine.
- Jangan whitelist IP rumah/kantor kecuali Anda juga menjalankan bot dari sana.
- **Jalankan dari rumah/koneksi dinamis**: whitelist **kedua** alamat ini (IPv4 + IPv6) karena koneksi ke Indodax (Cloudflare) umumnya lewat IPv6 bila tersedia. Cek IP Anda via `curl https://ifconfig.me` (IPv6) dan `curl -4 https://icanhazip.com` (IPv4). Catatan: IP rumahan bisa berubah sewaktu-waktu (DHCP/ISP) — bila order tiba-tiba ditolak `-2015`, cek ulang IP Anda. Untuk kestabilan, VPS ber-IP statis tetap disarankan.

## Telegram
- Whitelist chat_id wajib; command tanpa whitelist → ditolak.
- Command destruktif (`/stop`, `/buy`, `/sell` live) pakai konfirmasi inline button.

## Lainnya
- Tidak ada dependency berisiko: package npm `indodax` publik dibuang (203 byte, tanpa docs) — client ditulis sendiri.
- Rate-limit & retry dengan backoff; kredensial salah → tidak retry, tandai status error.
- `.env` di-gitignore; `.env.example` berisi placeholder.
- Backup: file SQLite di `server/data/` bisa disalin saat server berhenti (WAL di-checkpoint saat shutdown graceful).
