# 07 — Engine

## Scheduler (`engine/scheduler.ts`)
- Loop `setInterval` 5 detik; tiap iterasi proses bot `running` dengan **stagger**: bot diproses jika `now - bot.last_tick >= tick_interval_bot` (default 8s + jitter id%3s) agar request tersebar.
- Pipeline per bot: ambil ticker (cache) → `strategy.onTick` → untuk tiap `Action` → `trader.execute` → simpan state → log → notifikasi.
- Error per bot di-catch terpisah; 3 error beruntun → log `ERROR` + notif Telegram, bot tetap jalan (kecuali error kredensial → pause otomatis).

## Trader (`engine/trader.ts`)
- Eksekusi `Action`: tentukan mode dari `bot.mode`; live → client exchange, paper → simulator.
- Idempotensi: `client_order_id = bot-<id>-<cycle>`; sebelum kirim order live, cek `trades` belum ada client_order_id tsb.
- Setelah fill: insert `trades`, hitung `realized_pnl` (untuk sell: `value - fee - cost_basis` dari state strategi), update `bot_state`, panggil `compound.maybeCompound()`.
- Guard: `amount < exchange.min_lot` → skip + log warn; saldo tidak cukup (paper/live) → log error + notif.

## Auto-Compound (`engine/compound.ts`)
- Setelah realized_pnl > 0: `reinvest = pnl * auto_compound_pct/100`; `current_budget += reinvest`; hitung ulang `lot = current_budget / max_buys_atau_levels`.
- Log tag `AUTO_COMPOUND`: `Reinvested +Rp X (Y%). New Budget: Rp A, Lot: Rp B.`

## PnL (`engine/pnl.ts`)
- **Realized total**: `SUM(realized_pnl)` semua trades (mode dipisah: dashboard menampilkan per mode).
- **Win rate**: siklus menang / siklus total. Siklus dihitung dari sell trades dengan `realized_pnl != 0` → win jika > 0.
- **Profit harian**: realized hari ini (WIB) + perubahan floating hari ini (dari `balance_snapshots`).
- **Floating 24j**: nilai posisi terbuka sekarang vs cost basis.
- **Portfolio total**: Σ (saldo asset × price_idr). price_idr: IDR=1; USDT×kurs USDTIDR (fetch berkala, cache 5 menit); koin lain × ticker terkait (Indodax langsung IDR; Tokocrypto koin USDT × kurs).

## Wizard + Backtest (`engine/wizard.ts`)
1. Ambil klines (Tokocrypto native; Indodax agregasi dari `trades` history atau fallback volatilitas dari summaries).
2. Hitung metrik: volatilitas (stdev return harian %), range 7h %, tren (EMA20 vs EMA50 harian), frekuensi cross.
3. Skor preset (0–100) = base + penyesuaian metrik (aturan di tabel preset, 05-strategies.md).
4. Backtest replay: iterasi candle, jalankan state machine strategi yang sama (mode simulasi murni, tanpa DB) → hitung win rate, profit %, max drawdown. Ditampilkan di langkah 1 wizard per preset.
5. `GET /api/wizard/presets?pair=` mengembalikan 4 preset terurut skor + hasil backtest (cache 15 menit per pair).

## Balance Sync (`engine/balances.ts`)
- Interval 60s + manual. Ambil balances live (paper → tabel virtual), tulis `balance_snapshots`, broadcast `dashboard`.
- Kurs USDTIDR: Indodax `usdtidr` ticker; fallback 16.000.
