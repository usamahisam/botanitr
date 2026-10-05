import { db } from '../db/index.js';
import { registry } from '../exchange/registry.js';
import { fmtMoney } from '../utils/format.js';

export interface BudgetCheck {
  ok: boolean;
  /** true bila saldo tak terbaca sehingga validasi dilewati (fail-open) */
  skipped: boolean;
  freeQuote: number;
  quote: string;
  message: string;
}

/**
 * Validasi budget bot terhadap kas exchange (demo = saldo virtual, live = riil).
 * Dipakai saat pembuatan bot agar user langsung tahu bila budget melebihi kas
 * (bukan gagal diam-diam saat engine jalan — kasus bot paper 1M vs kas 99rb).
 * Fail-open: bila saldo tak terbaca, bot tetap boleh dibuat (engine guard yang menilai per order).
 */
export async function validateBudget(userId: number, exchangeId: string, budgetQuote: number, mode: 'paper' | 'live'): Promise<BudgetCheck> {
  const client = registry.getForUser(exchangeId, userId);
  const quote = client.quoteAsset;
  let balances;
  try {
    balances = mode === 'live'
      ? await client.getBalances()
      : registry.getPaperForUser(exchangeId, userId).getBalances();
  } catch (e: any) {
    return { ok: true, skipped: true, freeQuote: 0, quote, message: `Saldo tak terbaca (${e.message}) — validasi dilewati` };
  }
  const freeQuote = balances.find(b => b.asset === quote)?.free ?? 0;
  // Satu akun dipakai ramai-ramai: kurangi modal yang sudah diklaim bot running
  // lain (mode sama) agar dua bot tak mengklaim kas yang sama (double-spend).
  const committed = (db.prepare(`SELECT COALESCE(SUM(current_budget),0) s FROM bots
    WHERE user_id=? AND exchange_id=? AND mode=? AND status='running'`).get(userId, exchangeId, mode) as any).s || 0;
  const available = freeQuote - committed;
  if (budgetQuote > available) {
    const hint = mode === 'paper'
      ? `Turunkan budget ke maksimal ${fmtMoney(Math.max(0, Math.floor(available)), quote)} atau reset saldo demo di Pengaturan.`
      : `Turunkan budget atau tambah dana (maksimal ${fmtMoney(Math.max(0, Math.floor(available)), quote)}).`;
    const claimed = committed > 0 ? ` (sudah diklaim bot berjalan: ${fmtMoney(committed, quote)})` : '';
    return {
      ok: false, skipped: false, freeQuote, quote,
      message: `Budget ${fmtMoney(budgetQuote, quote)} melebihi kas ${quote} tersedia ${fmtMoney(freeQuote, quote)}${claimed}. ${hint}`
    };
  }
  return { ok: true, skipped: false, freeQuote, quote, message: 'OK' };
}

/** Kompat lama: validasi live (dipakai tes + kode lama). */
export async function validateLiveBudget(userId: number, exchangeId: string, budgetIdr: number): Promise<BudgetCheck> {
  return validateBudget(userId, exchangeId, budgetIdr, 'live');
}

/** Kas maksimal yang bisa dipakai sebagai budget (paper = seed faucet, live = saldo riil).
 * modeOverride ('paper'|'live') memaksa memakai kas mode tertentu — dipakai
 * Wizard langkah 1 yang modenya dipilih user, bukan dari setting exchange. */
export async function maxSpendable(userId: number, exchangeId: string, modeOverride?: string): Promise<{ quote: string; free: number; mode: string }> {
  const row = db.prepare('SELECT * FROM exchanges WHERE id=? AND user_id=?').get(exchangeId, userId) as any;
  const client = registry.getForUser(exchangeId, userId);
  const quote = client.quoteAsset;
  const isPaper = modeOverride ? modeOverride !== 'live' : (!row || row.mode !== 'live');
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
