# 05 — Spesifikasi Strategi

Kontrak strategi (`strategies/types.ts`):
```ts
interface StrategyContext { bot: Bot; price: Ticker; balances: Balance[]; now: number }
interface Action { type: 'buy'|'sell'; amountQuote?: number; qtyBase?: number; reason: string; tag: string }
interface Strategy {
  readonly name: string;
  init(state: any, params: any): any;            // bangun/restore state
  onTick(ctx: StrategyContext): Action[];        // dipanggil tiap tick
  describe(params: any): string;                 // ringkasan untuk UI/Telegram
}
```
Semua state persist di `bots.state` (JSON). Fee & slippage diperhitungkan di `trader`.

## 1. Grid (`grid.ts`)
**Params**: `lower_pct` (default -3), `upper_pct` (3), `levels` (6).
**State**: `anchor_price` (harga saat start), `filled_buys: [{price, qty, cost}]`, `avg_cost`, `unwound: boolean`.
**Logika**:
- Bangun level harga: `anchor * (1 + lower% .. upper%)` merata; beli saat harga turun menyentuh level bawah yang belum terisi (pakai lot), jual saat naik menyentuh level atas pasangan buy tsb.
- **GRID_UNWIND**: jika harga kembali ≥ **breakeven VWAP** = `Σ(cost) / Σ(qty)` + margin fee (0.4%) dan `filled_buys.length ≥ 1` → jual semua → profit → log tag `GRID_UNWIND` → `unwound=true`, reset anchor ke harga sekarang (siklus baru).
- Auto-compound di-handle engine setelah realized_pnl > 0.

## 2. DCA (`dca.ts`)
**Params**: `drop_pct` (2), `take_profit_pct` (3), `max_buys` (5).
**State**: `entries: [{price, qty, cost}]`, `avg_cost`.
**Logika**: beli lot pertama saat start; beli lagi tiap harga turun `drop_pct` dari entry terakhir (maks `max_buys`); jual semua saat harga ≥ `avg_cost * (1 + take_profit% + fee)` → tag `DCA_TP`. Reset siklus.

## 3. Scalper (`scalper.ts`)
**Params**: `timeframe` ('1m'), `ema_fast` (20), `ema_slow` (50), `rsi_period` (14), `rsi_oversold` (30), `rsi_overbought` (70), `tp_pct` (1.2), `sl_pct` (0.6).
**State**: `position: {entry_price, qty} | null`, `candles: number[][]` (cache).
**Logika**: fetch klines 1m tiap tick (cache 60s). Sinyal **buy**: EMA20 cross-up EMA50 **dan** RSI < overbought (momentum naik, tidak jenuh). Sinyal **sell**: TP/SL tercapai ATAU EMA20 cross-down EMA50. Tag: `SCALPER_TP`/`SCALPER_SL`/`SCALPER_EXIT`.

## 4. Inventory Harvester (`harvester.ts`)
**Params**: `drop_pct` (2.5), `harvest_pct` (2), `max_buys` (8), `lot_idr` (otomatis dari budget/max_buys).
**State**: `entries: [{price, qty, cost}]`, `total_cost`, `total_qty`.
**Logika**:
- Beli lot saat harga turun `drop_pct` dari beli terakhir (akumulasi, maks `max_buys`).
- **Harvest**: saat harga ≥ `total_cost/total_qty * (1 + harvest% + fee)` → jual qty yang cukup agar **modal kembali cair**: `qty_sell = min(total_qty, total_cost * (1+fee) / price)`. Sisa qty = "panen gratis". Log tag `INVENTORY_HARVEST_RECYCLE` dengan format seperti Telegram user: `Kas IDR Bebas: +Rp X, Net Profit Realized: +Rp Y`.
- Ulangi siklus; sisa aset ikut rata-rata siklus berikutnya.

## Preset Wizard (`engine/wizard.ts`)
| Preset | Strategi | Gaya | Param utama | Skor dasar |
|---|---|---|---|---|
| Scalper Pro 1m | scalper | Scalping | TP 1.2 / SL 0.6, EMA20/50+RSI | tinggi saat volatilitas 1m tinggi |
| Grid Sideways | grid | Range | ±3%, 6 level | tinggi saat ADX rendah/sideways |
| DCA Akumulasi | dca | Trend | drop 2%, TP 3% | tinggi saat tren turun moderat |
| Harvester Aman | harvester | Akumulasi | drop 2.5%, harvest 2% | default aman |

Skor akhir = f(metrik candle 7 hari: volatilitas rata-rata, ADX sederhana, range %, jumlah cross EMA) + backtest replay. Lihat `07-engine.md`.
