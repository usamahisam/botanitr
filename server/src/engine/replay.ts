/**
 * Replay harness: menjalankan kode strategi ASLI (onTick) di atas deretan
 * klines, dengan ctx mock + simulasi fill di harga close.
 * Dipakai untuk validasi strategi baru/upgrade tanpa mempertaruhkan uang.
 */
import { getStrategy } from '../strategies/types.js';

export type KlineTuple = [number, number, number, number, number, number];

export interface ReplayOpts {
  budget?: number;
  fee?: number;          // fraksi per sisi (def 0.003 = Indodax)
  minLot?: number;
  exchangeId?: string;
  stepMs?: number;       // waktu antar candle (def 5 mnt)
  maxActionsPerTick?: number;
}

export interface ReplayResult {
  buys: number;
  sells: number;
  realized: number;      // PnL terealisasi (quote, setelah fee)
  retPct: number;        // realized / budget * 100
  endEquity: number;
  maxDdPct: number;
  lastPrice: number;
}

/** Cermin logika fill scheduler.applyFillToState (cabang buy). */
function applyFill(strategyName: string, state: any, action: any, price: number, fee: number) {
  const amount = Number(action.amountQuote ?? 0);
  if (!(amount > 0) || !(price > 0)) return { qty: 0 };
  const qty = (amount * (1 - fee)) / price;
  const entry: any = { price, qty, cost: amount };
  if (Number.isInteger(action?.meta?.level)) entry.level = action.meta.level;
  if (Array.isArray(state.filledBuys)) state.filledBuys.push(entry);
  else if (Array.isArray(state.entries)) state.entries.push(entry);
  else if ('position' in state && state.position == null) {
    state.position = { entryPrice: price, qty, cost: amount };
  }
  if (typeof state.lastEntryPrice === 'number') state.lastEntryPrice = price;
  if (typeof state.lastBuyPrice === 'number') state.lastBuyPrice = price;
  const lvl = action?.meta?.level;
  if (strategyName === 'grid' && Number.isInteger(lvl) && Array.isArray(state.levelsHit) && !state.levelsHit.includes(lvl)) {
    state.levelsHit.push(lvl);
  }
  return { qty };
}

export async function replay(
  strategyName: string, params: any, klines: KlineTuple[], opts: ReplayOpts = {}
): Promise<ReplayResult> {
  const budget = opts.budget ?? 1000000;
  const fee = opts.fee ?? 0.003;
  const stepMs = opts.stepMs ?? 300000;
  const maxPer = opts.maxActionsPerTick ?? 10;

  // Registrasi strategi (efek samping import)
  await import('../strategies/grid.js');
  await import('../strategies/dca.js');
  await import('../strategies/scalper.js');
  await import('../strategies/harvester.js');
  await import('../strategies/revert.js');
  await import('../strategies/bollinger.js');
  await import('../strategies/breakout.js');
  const strat = getStrategy(strategyName);
  const state = strat.init(params);
  const t0 = klines.length > 0 ? klines[0][0] : Date.now();

  let cash = budget, invQty = 0, realized = 0, buys = 0, sells = 0;
  let peak = budget, maxDd = 0;

  for (let i = 0; i < klines.length; i++) {
    const k = klines[i];
    const price = k[4];
    if (!(price > 0)) continue;
    const ctx: any = {
      bot: { current_budget: budget, exchange_id: opts.exchangeId ?? 'indodax' },
      ticker: { last: price },
      quote: 'IDR',
      minLot: opts.minLot ?? 0,
      usdtIdr: 1,
      getKlines: async () => klines.slice(0, i + 1),
      getBalances: async () => [],
      getPrice: async () => price,
      now: t0 + i * stepMs,
    };
    const actions = (await strat.onTick(ctx, state, params)) ?? [];
    let n = 0;
    for (const a of actions) {
      if (++n > maxPer) break;
      if (a.type === 'buy') {
        const amount = Number(a.amountQuote ?? 0);
        if (!(amount > 0) || cash < amount) continue;
        const { qty } = applyFill(strategyName, state, a, price, fee);
        if (qty <= 0) continue;
        cash -= amount;
        invQty += qty;
        buys++;
      } else if (a.type === 'sell') {
        let qty = Number(a.qtyBase ?? 0);
        if (!(qty > 0)) continue;
        qty = Math.min(qty, invQty); // tak bisa jual melebihi punya
        if (qty <= 0) continue;
        const ratio = qty / Number(a.qtyBase);
        const proceeds = qty * price * (1 - fee);
        const costPart = Number(a.costBasis ?? qty * price) * ratio;
        cash += proceeds;
        invQty -= qty;
        realized += proceeds - costPart;
        sells++;
      }
    }
    const eq = cash + invQty * price;
    peak = Math.max(peak, eq);
    if (peak > 0) maxDd = Math.max(maxDd, ((peak - eq) / peak) * 100);
  }

  const lastPrice = klines.length > 0 ? klines[klines.length - 1][4] : 0;
  const endEquity = cash + invQty * lastPrice;
  return {
    buys, sells, realized,
    retPct: (realized / budget) * 100,
    endEquity, maxDdPct: maxDd, lastPrice,
  };
}
