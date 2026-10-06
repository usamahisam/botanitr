import { db } from '../db/index.js';
import { registry } from '../exchange/registry.js';
import { fmtMoney } from '../utils/format.js';

export interface OthersBalance { asset: string; free: number; locked: number }

export interface BudgetCheck {
  ok: boolean;
  /** true bila saldo tak terbaca sehingga validasi dilewati (fail-open) */
  skipped: boolean;
  freeQuote: number;
  quote: string;
  message: string;
  /** Aset lain bersaldo (Earn/koin) — tak bisa dipakai trading langsung */
  others: OthersBalance[];
}

/**
 * Sisa klaim bot atas kas bebas: kas ledger (state.cash) bila sudah ada,
 * jika tidak = budget - modal nyangkut. WAJIB sisa (bukan full budget) —
 * uang yang sudah dibelikan barang sudah keluar dari kas bebas, menghitung
 * full budget berarti menghitung uang yang sama dua kali (alarm palsu
 * "klaim 99rb > kas 10rb" padahal 89rb-nya sudah jadi barang).
 */
export function unspentClaim(bot: any): number {
  try {
    const state = JSON.parse(bot.state || '{}');
    if (Number.isFinite(state.cash)) return Math.max(0, state.cash);
    const open: any[] = state.entries || state.filledBuys || (state.position ? [state.position] : []);
    const openCost = open.reduce((s: number, e: any) => s + (Number(e.cost) || 0), 0);
    return Math.max(0, (Number(bot.current_budget) || 0) - openCost);
  } catch {
    return Math.max(0, Number(bot.current_budget) || 0);
  }
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
    return { ok: true, skipped: true, freeQuote: 0, quote, message: `Saldo tak terbaca (${e.message}) — validasi dilewati`, others: [] };
  }
  const freeQuote = balances.find(b => b.asset === quote)?.free ?? 0;
  // Aset lain yang bersaldo (mis. LDUSDT produk Earn, koin lain): tak bisa
  // dipakai trading langsung, tapi user perlu tahu dananya ada di sana.
  const others = balances
    .filter(b => b.asset !== quote && (b.free > 0 || b.locked > 0))
    .map(b => ({ asset: b.asset, free: b.free, locked: b.locked }));
  // Satu akun dipakai ramai-ramai: kurangi SISA klaim bot running lain
  // (kas ledger, bukan full budget) agar dua bot tak mengklaim kas yang
  // sama (double-spend) — tanpa alarm palsu untuk uang yang sudah jadi barang.
  const running = db.prepare(`SELECT * FROM bots
    WHERE user_id=? AND exchange_id=? AND mode=? AND status='running'`).all(userId, exchangeId, mode) as any[];
  const committed = running.reduce((s: number, b: any) => s + unspentClaim(b), 0);
  const available = freeQuote - committed;
  if (budgetQuote > available) {
    const hint = mode === 'paper'
      ? `Turunkan budget ke maksimal ${fmtMoney(Math.max(0, Math.floor(available)), quote)} atau reset saldo demo di Pengaturan.`
      : `Turunkan budget atau tambah dana (maksimal ${fmtMoney(Math.max(0, Math.floor(available)), quote)}).`;
    const claimed = committed > 0 ? ` (sudah diklaim bot berjalan: ${fmtMoney(committed, quote)})` : '';
    const earnHint = others.length > 0
      ? ` Dana terdeteksi di ${others.map(o => `${o.asset} ${o.free}`).join(', ')} — produk Earn/terkunci tidak bisa dipakai trading langsung, redeem dulu di aplikasi exchange.`
      : '';
    return {
      ok: false, skipped: false, freeQuote, quote, others,
      message: `Budget ${fmtMoney(budgetQuote, quote)} melebihi kas ${quote} tersedia ${fmtMoney(freeQuote, quote)}${claimed}. ${hint}${earnHint}`
    };
  }
  return { ok: true, skipped: false, freeQuote, quote, message: 'OK', others };
}

/** Kompat lama: validasi live (dipakai tes + kode lama). */
export async function validateLiveBudget(userId: number, exchangeId: string, budgetIdr: number): Promise<BudgetCheck> {
  return validateBudget(userId, exchangeId, budgetIdr, 'live');
}

/** Kas maksimal yang bisa dipakai sebagai budget (paper = seed faucet, live = saldo riil).
 * modeOverride ('paper'|'live') memaksa memakai kas mode tertentu — dipakai
 * Wizard langkah 1 yang modenya dipilih user, bukan dari setting exchange.
 * available = free - sisa klaim bot running (sama dengan aturan validateBudget),
 * agar angka di Wizard selalu sama dengan yang diloloskan saat aktivasi. */
export async function maxSpendable(userId: number, exchangeId: string, modeOverride?: string): Promise<{ quote: string; free: number; committed: number; available: number; mode: string; others: OthersBalance[] }> {
  const row = db.prepare('SELECT * FROM exchanges WHERE id=? AND user_id=?').get(exchangeId, userId) as any;
  const client = registry.getForUser(exchangeId, userId);
  const quote = client.quoteAsset;
  const isPaper = modeOverride ? modeOverride !== 'live' : (!row || row.mode !== 'live');
  const m = isPaper ? 'paper' : 'live';
  try {
    const balances = isPaper
      ? registry.getPaperForUser(exchangeId, userId).getBalances()
      : await client.getBalances();
    const free = balances.find(b => b.asset === quote)?.free ?? 0;
    const others = balances
      .filter(b => b.asset !== quote && (b.free > 0 || b.locked > 0))
      .map(b => ({ asset: b.asset, free: b.free, locked: b.locked }));
    const running = db.prepare(`SELECT * FROM bots WHERE user_id=? AND exchange_id=? AND mode=? AND status='running'`).all(userId, exchangeId, m) as any[];
    const committed = running.reduce((s: number, b: any) => s + unspentClaim(b), 0);
    return { quote, free: Math.max(0, Math.floor(free)), committed: Math.max(0, Math.floor(committed)), available: Math.max(0, Math.floor(free - committed)), mode: m, others };
  } catch {
    return { quote, free: 0, committed: 0, available: 0, mode: m, others: [] };
  }
}
