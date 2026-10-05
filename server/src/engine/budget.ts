import { db } from '../db/index.js';
import { registry } from '../exchange/registry.js';
import { fmtIDR } from '../utils/format.js';

export interface BudgetCheck {
  ok: boolean;
  /** true bila saldo tak terbaca sehingga validasi dilewati (fail-open) */
  skipped: boolean;
  freeQuote: number;
  quote: string;
  message: string;
}

/**
 * Validasi budget bot live terhadap kas riil exchange.
 * Dipakai saat pembuatan bot agar user langsung tahu bila budget melebihi kas
 * (bukan gagal diam-diam saat engine jalan).
 * Fail-open: bila saldo tak terbaca, bot tetap boleh dibuat (engine guard yang menilai per order).
 */
export async function validateLiveBudget(userId: number, exchangeId: string, budgetIdr: number): Promise<BudgetCheck> {
  const client = registry.getForUser(exchangeId, userId);
  const quote = client.quoteAsset;
  let balances;
  try {
    balances = await client.getBalances();
  } catch (e: any) {
    return { ok: true, skipped: true, freeQuote: 0, quote, message: `Saldo tak terbaca (${e.message}) — validasi dilewati` };
  }
  const freeQuote = balances.find(b => b.asset === quote)?.free ?? 0;
  if (budgetIdr > freeQuote) {
    return {
      ok: false, skipped: false, freeQuote, quote,
      message: `Budget ${fmtIDR(budgetIdr)} melebihi kas ${quote} tersedia ${fmtIDR(freeQuote)}. ` +
        `Turunkan budget atau pakai maksimal ${fmtIDR(Math.floor(freeQuote))}.`
    };
  }
  return { ok: true, skipped: false, freeQuote, quote, message: 'OK' };
}

/** Kas maksimal yang bisa dipakai sebagai budget (paper = seed faucet, live = saldo riil). */
export async function maxSpendable(userId: number, exchangeId: string): Promise<{ quote: string; free: number; mode: string }> {
  const row = db.prepare('SELECT * FROM exchanges WHERE id=? AND user_id=?').get(exchangeId, userId) as any;
  const client = registry.getForUser(exchangeId, userId);
  const quote = client.quoteAsset;
  const isPaper = !row || row.mode !== 'live';
  try {
    const balances = isPaper
      ? registry.getPaperForUser(exchangeId, userId).getBalances()
      : await client.getBalances();
    const free = balances.find(b => b.asset === quote)?.free ?? 0;
    return { quote, free: Math.max(0, Math.floor(free)), mode: isPaper ? 'paper' : 'live' };
  } catch {
    return { quote, free: 0, mode: isPaper ? 'paper' : 'live' };
  }
}
