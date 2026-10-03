# ROADMAP

## v1.0 — MVP (target sekarang)
- Dashboard portfolio multi-exchange (Indodax + Tokocrypto)
- Multi-bot dengan 4 strategi (Grid, DCA, Scalper, Harvester)
- Paper trading default + live mode berguard
- Auto-compound, PnL & win rate
- Telegram kontrol penuh + notifikasi + ringkasan harian
- Proxy per-exchange + Telegram
- AI Wizard rule-based + backtest sederhana
- Dokumentasi lengkap di docs/

## v1.1 — ✅ SELESAI
- [x] Ekspor CSV riwayat trades
- [x] Notifikasi harga (alert custom per koin)
- [x] Trailing stop untuk Scalper
- [x] Grafik equity curve per bot (dari balance_snapshots)

## v1.2 — ✅ SELESAI
- [x] Backtest UI interaktif (pilih rentang tanggal, lihat equity)
- [x] Dukungan exchange tambahan via adapter (Binance langsung)
- [x] Mode "portfolio rebalancing"

## v2.0 — ✅ SELESAI
- [x] Multi-user + login (JWT)
- [x] Marketplace preset strategi
- [x] Deployment satu klik (Docker) — file jadi & sempat ter-build; verifikasi container penuh di server tujuan

Lihat `15-v2-multipengguna-marketplace.md` untuk detail implementasi & verifikasi (100/100 tes).
