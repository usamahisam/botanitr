import { Strategy, StrategyContext, Action, registerStrategy, numParam } from './types.js';

/**
 * Rebalance Portfolio: jaga alokasi aset sesuai target %.
 * - params.targets: { BTC: 50, ETH: 30 } (sisa = kas quote)
 * - params.threshold_pct: deviasi minimum untuk eksekusi (default 2)
 * - params.interval_min: jeda antar cek rebalance (default 60)
 * - params.max_trade_quote: batas nominal per aksi agar tidak borong sekaligus (default = budget)
 *
 * Berjalan per pasangan target: bot rebalance sebaiknya dibuat per exchange
 * dengan pair apa saja (pair hanya untuk ticker referensi); alokasi dibaca
 * dari seluruh saldo akun.
 */
interface RebalanceState {
  lastRun: number;
}

const rebalance: Strategy = {
  name: 'rebalance',
  label: 'Rebalance',
  defaultParams: { targets: { BTC: 50, ETH: 30 }, threshold_pct: 2, interval_min: 60 },

  init(): RebalanceState {
    return { lastRun: 0 };
  },

  async onTick(ctx: StrategyContext, state: RebalanceState, params: any): Promise<Action[]> {
    const actions: Action[] = [];
    const intervalMs = numParam(params, 'interval_min', 60, 1, 1440) * 60000;
    if (ctx.now - state.lastRun < intervalMs) return actions;

    let rawTargets: Record<string, number> = {};
    try {
      rawTargets = typeof params.targets === 'string' ? JSON.parse(params.targets) : (params.targets || {});
    } catch { return actions; }
    // Normalisasi: abaikan entri non-angka, skala agar total = 100%
    const clean = Object.entries(rawTargets)
      .map(([k, v]) => [String(k).toUpperCase(), Number(v)] as const)
      .filter(([, v]) => Number.isFinite(v) && v > 0);
    const sum = clean.reduce((s, [, v]) => s + v, 0);
    if (clean.length === 0 || sum <= 0) return actions;
    const targets: Record<string, number> = Object.fromEntries(clean.map(([k, v]) => [k, (v / sum) * 100]));
    const threshold = numParam(params, 'threshold_pct', 2, 0.1, 50) / 100;
    const maxTrade = Math.max(numParam(params, 'max_trade_quote', ctx.bot.current_budget, 0), 0);
    if (maxTrade <= 0) return actions;

    // Fallback derivasi lama bila pemanggil tak mengisi ctx.quote (ctx manual/tes)
    const quote = String(ctx.quote || (ctx.bot.exchange_id === 'indodax' ? 'IDR' : 'USDT') || 'IDR').toUpperCase();
    const balances = await ctx.getBalances();
    const byAsset = new Map(balances.map(b => [b.asset.toUpperCase(), b.free + b.locked]));

    // Nilai total portfolio (quote) — harga tiap aset diambil via ticker client.
    // Karena strategi tidak punya akses client langsung, gunakan harga dari
    // getBalances? Tidak ada harga. Pendekatan: minta ticker per aset lewat
    // trik — ctx hanya punya ticker pair bot. Untuk multi-aset kita butuh harga.
    // Solusi: strategi ini memakai ctx.getKlines? Tidak efisien.
    // => Kita sediakan harga via (ctx as any).getPrice yang diisi engine.
    const getPrice = (ctx as any).getPrice as ((pair: string) => Promise<number>) | undefined;
    if (!getPrice) return actions;

    const prices = new Map<string, number>();
    for (const asset of Object.keys(targets)) {
      try { prices.set(asset.toUpperCase(), await getPrice(`${asset}${quote}`)); }
      catch { /* aset tidak tersedia di exchange → lewati */ }
    }

    let total = byAsset.get(quote) || 0;
    const values = new Map<string, number>();
    for (const [asset, qty] of byAsset) {
      if (asset === quote || qty <= 0) continue;
      const price = prices.get(asset);
      if (!price) continue;
      const v = qty * price;
      values.set(asset, v);
      total += v;
    }
    if (total <= 0) return actions;

    state.lastRun = ctx.now;

    // Hitung deviasi per aset target; eksekusi yang paling jauh dulu (maks 2 aksi per siklus)
    const jobs: { asset: string; diff: number }[] = [];
    for (const [assetRaw, pctRaw] of Object.entries(targets)) {
      const asset = assetRaw.toUpperCase();
      const targetVal = total * (Number(pctRaw) / 100);
      const curVal = values.get(asset) || 0;
      const diff = curVal - targetVal; // >0 = kelebihan → jual; <0 = kekurangan → beli
      if (Math.abs(diff) / total >= threshold) jobs.push({ asset, diff });
    }
    jobs.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    for (const job of jobs.slice(0, 2)) {
      const price = prices.get(job.asset);
      if (!price || price <= 0) continue;
      if (job.diff > 0) {
        // Kelebihan → jual
        const sellVal = Math.min(job.diff, maxTrade);
        const qty = sellVal / price;
        const free = byAsset.get(job.asset) || 0;
        const qtySell = Math.min(qty, free);
        if (qtySell > 0) {
          actions.push({
            type: 'sell', qtyBase: qtySell, costBasis: qtySell * price,
            reason: `[REBALANCE] Alokasi ${job.asset} berlebih — jual ${qtySell.toFixed(8)} @ ${Math.round(price)}`,
            tag: 'REBALANCE', impactRp: 0
          });
        }
      } else {
        // Kekurangan → beli
        const buyVal = Math.min(-job.diff, maxTrade);
        const freeQuote = byAsset.get(quote) || 0;
        const amount = Math.min(buyVal, freeQuote);
        if (amount > 0) {
          actions.push({
            type: 'buy', amountQuote: amount,
            reason: `[REBALANCE] Alokasi ${job.asset} kurang — beli senilai ${Math.round(amount)} ${quote}`,
            tag: 'REBALANCE'
          });
        }
      }
    }
    return actions;
  },

  describe(p: any) {
    const t = typeof p.targets === 'string' ? p.targets : JSON.stringify(p.targets || {});
    return `Target ${t}, threshold ${p.threshold_pct ?? 2}%, cek tiap ${p.interval_min ?? 60} mnt`;
  }
};

registerStrategy(rebalance);
export default rebalance;
