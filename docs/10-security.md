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

## Telegram
- Whitelist chat_id wajib; command tanpa whitelist → ditolak.
- Command destruktif (`/stop`, `/buy`, `/sell` live) pakai konfirmasi inline button.

## Lainnya
- Tidak ada dependency berisiko: package npm `indodax` publik dibuang (203 byte, tanpa docs) — client ditulis sendiri.
- Rate-limit & retry dengan backoff; kredensial salah → tidak retry, tandai status error.
- `.env` di-gitignore; `.env.example` berisi placeholder.
- Backup: file SQLite di `server/data/` bisa disalin saat server berhenti (WAL di-checkpoint saat shutdown graceful).
