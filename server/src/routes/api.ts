import { Router } from 'express';
import { db, queries, settings, now, BotRow, ExchangeRow, ensureUserExchanges } from '../db/index.js';
import { encrypt, decrypt, mask } from '../crypto.js';
import { registry } from '../exchange/registry.js';
import { fetchExchangeBalance, getUsdtIdr } from '../engine/balances.js';
import { pnl } from '../engine/pnl.js';
import { recommend, backtest, PRESETS } from '../engine/wizard.js';
import { restartTelegram, sendTestMessage } from '../telegram/bot.js';
import { registry as stratRegistry } from '../strategies/types.js';
import { config } from '../config.js';
import { createHttp } from '../exchange/http.js';
import { uid } from '../auth.js';
import '../strategies/grid.js';
import '../strategies/dca.js';
import '../strategies/scalper.js';
import '../strategies/harvester.js';
import '../strategies/rebalance.js';
import '../strategies/revert.js';
import '../strategies/bollinger.js';
import '../strategies/breakout.js';
import '../strategies/dynamic.js';

export const api = Router();

const asyncH = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Ambil angka query/body dengan aman. Parameter tak valid (NaN, "abc")
 * sebelumnya lolos menjadi NaN dan menyebabkan respons 500/aneh.
 */
function num(v: any, def: number, min?: number, max?: number): number {
  let n = Number(v);
  if (!Number.isFinite(n)) n = def;
  if (min !== undefined) n = Math.max(min, n);
  if (max !== undefined) n = Math.min(max, n);
  return n;
}

/** Parse JSON aman — data korup di DB tak boleh menumbangkan seluruh respons. */
function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function getUserExchange(userId: number, id: string) {
  return db.prepare('SELECT * FROM exchanges WHERE id=? AND user_id=?').get(id, userId) as ExchangeRow | undefined;
}

function getUserBot(userId: number, id: string | number) {
  return db.prepare('SELECT * FROM bots WHERE id=? AND user_id=?').get(id, userId) as BotRow | undefined;
}

// ===== Health (publik) =====
api.get('/health', asyncH(async (_req: any, res: any) => {
  res.json({ ok: true, time: now() });
}));

// ===== Dashboard =====
api.get('/dashboard', asyncH(async (req: any, res: any) => {
  const userId = uid(req);
  const usdtIdr = await getUsdtIdr();
  const rows = db.prepare('SELECT id FROM exchanges WHERE user_id=?').all(userId) as any[];
  const ids = rows.length > 0 ? rows.map(r => r.id) : ['indodax', 'tokocrypto', 'binance'];
  const views = [];
  for (const id of ids) views.push(await fetchExchangeBalance(id, userId));

  const totalIdr = views.reduce((s, v) => s + v.saldo_total_idr, 0);

  // Perubahan 24j dari snapshot milik user
  let change24Idr = 0;
  for (const v of views) {
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const snap = db.prepare(`SELECT COALESCE(SUM(total_idr),0) s FROM balance_snapshots WHERE user_id=? AND exchange_id=? AND created_at <= ? ORDER BY created_at DESC LIMIT 100`).get(userId, v.id, dayAgo) as any;
    if (snap.s > 0) change24Idr += v.saldo_total_idr - snap.s;
  }
  const change24Pct = totalIdr - change24Idr > 0 ? (change24Idr / (totalIdr - change24Idr)) * 100 : 0;

  let realizedIdr = 0, realizedTodayIdr = 0;
  for (const v of views) {
    const mult = v.quote_asset === 'IDR' ? 1 : usdtIdr;
    realizedIdr += pnl.realized(v.id, undefined, userId) * mult;
    realizedTodayIdr += pnl.realizedToday(v.id, userId) * mult;
  }
  const wr = pnl.winRate(undefined, userId);

  const exCards = await Promise.all(views.map(async v => {
    const mult = v.quote_asset === 'IDR' ? 1 : usdtIdr;
    return {
      ...v,
      profit_harian: pnl.realizedToday(v.id, userId) * mult,
      profit_total: pnl.realized(v.id, undefined, userId) * mult,
      posisi_pct: v.saldo_total_idr > 0 ? ((v.saldo_total_idr - v.kas_bebas_idr) / v.saldo_total_idr) * 100 : 0
    };
  }));

  res.json({
    portfolio: { total_idr: totalIdr, change_24h_idr: change24Idr, change_24h_pct: change24Pct, usdt_idr: usdtIdr },
    realized: { total_idr: realizedIdr, today_idr: realizedTodayIdr, wins: wr.wins, total: wr.total, rate: wr.rate },
    exchanges: exCards
  });
}));

// ===== Exchanges =====
api.get('/exchanges', asyncH(async (req: any, res: any) => {
  const userId = uid(req);
  ensureUserExchanges(userId);
  const rows = db.prepare('SELECT * FROM exchanges WHERE user_id=? ORDER BY id').all(userId) as ExchangeRow[];
  const { IndodaxClient } = await import('../exchange/indodax.js');
  res.json(rows.map(e => {
    const out: any = {
      id: e.id, name: e.name, mode: e.mode, status: e.status, enabled: e.enabled,
      proxy_url: e.proxy_url, min_lot_idr: e.min_lot_idr, last_sync: e.last_sync,
      api_key_masked: e.api_key_enc ? mask(safeDecrypt(e.api_key_enc)) : '',
      has_credentials: !!(e.api_key_enc && e.api_secret_enc)
    };
    // Info versi API Indodax: pilihan user + hasil deteksi terakhir
    if (e.id === 'indodax') {
      const client = registry.getForUser('indodax', userId);
      out.api_version_setting = settings.get('indodax_api_version', 'auto', userId);
      out.api_version_active = client instanceof IndodaxClient ? client.activeVersion : null;
    }
    return out;
  }));
}));

function safeDecrypt(enc: string): string {
  try { return decrypt(enc); } catch { return ''; }
}

api.put('/exchanges/:id', asyncH(async (req: any, res: any) => {
  const userId = uid(req);
  const id = req.params.id;
  const row = getUserExchange(userId, id);
  if (!row) return res.status(404).json({ error: 'Exchange tidak ditemukan' });
  const { api_key, api_secret, proxy_url, mode } = req.body || {};

  if (api_key) db.prepare('UPDATE exchanges SET api_key_enc=? WHERE id=? AND user_id=?').run(encrypt(api_key), id, userId);
  if (api_secret) db.prepare('UPDATE exchanges SET api_secret_enc=? WHERE id=? AND user_id=?').run(encrypt(api_secret), id, userId);
  if (proxy_url !== undefined) db.prepare('UPDATE exchanges SET proxy_url=? WHERE id=? AND user_id=?').run(proxy_url || null, id, userId);
  if (mode && ['paper', 'live'].includes(mode)) {
    if (mode === 'live') {
      const fresh = getUserExchange(userId, id)!;
      if (!fresh.api_key_enc || !fresh.api_secret_enc) {
        return res.status(400).json({ error: 'Isi API key & secret dulu sebelum mode Riil' });
      }
    }
    db.prepare('UPDATE exchanges SET mode=? WHERE id=? AND user_id=?').run(mode, id, userId);
  }
  registry.reloadUser(userId);
  res.json({ ok: true });
}));

api.post('/exchanges/:id/test', asyncH(async (req: any, res: any) => {
  const client = registry.getForUser(req.params.id, uid(req));
  res.json(await client.testConnection());
}));

api.post('/exchanges/:id/sync', asyncH(async (req: any, res: any) => {
  res.json(await fetchExchangeBalance(req.params.id, uid(req)));
}));

// Faucet: reset saldo demo exchange ke seed awal
api.post('/exchanges/:id/paper-reset', asyncH(async (req: any, res: any) => {
  const userId = uid(req);
  const result = registry.getPaperForUser(req.params.id, userId).resetToSeed();
  res.json({ ok: true, ...result });
}));

// Hapus TUNTAS data demo: bot paper + riwayat paper + log + snapshot, saldo kembali ke seed.
// Data live tidak disentuh. Body opsional { exchange_id } untuk satu exchange saja.
api.post('/demo/purge', asyncH(async (req: any, res: any) => {
  const { purgePaperData } = await import('../engine/demo.js');
  const { exchange_id } = req.body || {};
  res.json({ ok: true, ...purgePaperData(uid(req), exchange_id || undefined) });
}));

// Health check saldo: kecukupan kas per exchange + per bot yang running
api.get('/balances/check', asyncH(async (req: any, res: any) => {
  const { checkBalancesHealth } = await import('../engine/balances.js');
  res.json(await checkBalancesHealth(uid(req)));
}));

// ===== Pairs (global) =====
api.get('/pairs', asyncH(async (req: any, res: any) => {
  const ex = String(req.query.exchange || '');
  const rows = ex
    ? db.prepare('SELECT * FROM default_pairs WHERE exchange_id=? ORDER BY sort').all(ex)
    : db.prepare('SELECT * FROM default_pairs ORDER BY exchange_id, sort').all();
  res.json(rows);
}));

// ===== Market tape (publik per user login; data publik Indodax) =====
let marketCache: { data: any[]; ts: number } | null = null;
api.get('/market', asyncH(async (req: any, res: any) => {
  if (marketCache && Date.now() - marketCache.ts < 60000) return res.json(marketCache.data);
  const row = getUserExchange(uid(req), 'indodax');
  const http = createHttp(config.indodaxBaseUrl, row?.proxy_url || undefined);
  const { data } = await http.get('/api/summaries');
  const tickers = data.tickers || {};
  const rows = Object.entries(tickers)
    .filter(([k]: any) => k.endsWith('idr'))
    .map(([k, v]: any) => ({
      pair: k.toUpperCase(),
      symbol: String(v.name || k).toUpperCase(),
      last: parseFloat(v.last || '0'),
      high: parseFloat(v.high || '0'),
      low: parseFloat(v.low || '0'),
      vol: parseFloat(v.vol_idr || '0')
    }))
    .filter(r => r.last > 0)
    .sort((a, b) => b.vol - a.vol)
    .slice(0, 14)
    .map(({ vol, ...r }) => r);
  marketCache = { data: rows, ts: Date.now() };
  res.json(rows);
}));

// ===== Bots =====
api.get('/bots', asyncH(async (req: any, res: any) => {
  const userId = uid(req);
  const status = String(req.query.status || '');
  const bots = (status
    ? db.prepare('SELECT * FROM bots WHERE user_id=? AND status=? ORDER BY id DESC').all(userId, status)
    : db.prepare('SELECT * FROM bots WHERE user_id=? ORDER BY id DESC').all(userId)) as BotRow[];
  res.json(bots.map(b => ({
    ...b, params: safeJson(b.params, {}), state: undefined,
    stats: pnl.botStats(b.id),
    trend: pnl.botTrend(b.id)
  })));
}));

api.get('/bots/:id', asyncH(async (req: any, res: any) => {
  const bot = getUserBot(uid(req), req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' });
  res.json({ ...bot, params: safeJson(bot.params, {}), state: safeJson(bot.state, {}), stats: pnl.botStats(bot.id), trend: pnl.botTrend(bot.id) });
}));

api.post('/bots', asyncH(async (req: any, res: any) => {
  const userId = uid(req);
  const { name, exchange_id, pair, strategy, params, budget_idr, auto_compound_pct, mode, confirmed_live, max_daily_loss_pct, status } = req.body || {};
  if (!name || !exchange_id || !pair || !strategy || !budget_idr) {
    return res.status(400).json({ error: 'Field wajib: name, exchange_id, pair, strategy, budget_idr' });
  }
  const budgetNum = Number(budget_idr);
  if (!Number.isFinite(budgetNum) || budgetNum <= 0) {
    return res.status(400).json({ error: 'budget_idr harus angka lebih dari 0' });
  }
  if (mode !== undefined && mode !== 'paper' && mode !== 'live') {
    return res.status(400).json({ error: "mode harus 'paper' atau 'live'" });
  }
  const strat = stratRegistry.get(strategy);
  if (!strat) return res.status(400).json({ error: `Strategi tidak dikenal: ${strategy}` });
  const exRow = getUserExchange(userId, exchange_id);
  if (!exRow) return res.status(400).json({ error: 'Exchange tidak dikenal' });

  const defaultPaper = settings.get('default_paper_mode', String(config.defaultPaperMode), userId) !== 'false';
  const finalMode = mode || (defaultPaper ? 'paper' : 'paper');
  if (finalMode === 'live') {
    if (exRow.mode !== 'live') return res.status(400).json({ error: 'Exchange masih mode Demo. Ubah di Pengaturan.' });
    if (!confirmed_live) return res.status(400).json({ error: 'Konfirmasi live trading diperlukan (confirmed_live)' });
  }
  // Validasi budget vs kas (demo maupun riil) agar gagal cepat dengan pesan
  // jelas — bukan bot jalan tapi tak pernah bisa trade (kasus budget 1M vs kas 99rb).
  {
    const { validateBudget } = await import('../engine/budget.js');
    const check = await validateBudget(userId, exchange_id, budgetNum, finalMode);
    if (!check.ok) return res.status(400).json({ error: check.message, free_quote: check.freeQuote, quote: check.quote });
  }

  const mergedParams = { ...strat.defaultParams, ...((params && typeof params === 'object' ? params : {})) };
  const rawDiv = strategy === 'grid' ? mergedParams.levels : mergedParams.max_buys;
  const divisor = Math.max(strategy === 'grid' ? 2 : 1, Math.min(50, Math.floor(Number(rawDiv)) || 0) || 1);
  const lot = Math.floor(budgetNum / divisor);
  const finalStatus = status === 'paused' ? 'paused' : 'running';
  const compoundPct = Number(auto_compound_pct ?? 100);
  const safeCompound = Number.isFinite(compoundPct) ? Math.min(100, Math.max(0, compoundPct)) : 100;

  const info = queries.insertBot.run({
    user_id: userId, name: String(name).slice(0, 80), exchange_id, pair: String(pair).toUpperCase().slice(0, 20), strategy,
    params: JSON.stringify(mergedParams), budget_idr: budgetNum,
    current_budget: budgetNum, lot,
    mode: finalMode, auto_compound_pct: safeCompound,
    status: finalStatus, state: JSON.stringify(strat.init(mergedParams)),
    max_daily_loss_pct: Math.max(0, Number(max_daily_loss_pct ?? 0)),
    market_preset_id: null,
    created_at: now(), updated_at: now()
  });
  const bot = queries.getBot.get(info.lastInsertRowid) as BotRow;
  res.status(201).json({ ...bot, params: JSON.parse(bot.params), state: JSON.parse(bot.state) });
}));

api.post('/bots/:id/pause', asyncH(async (req: any, res: any) => {
  if (!getUserBot(uid(req), req.params.id)) return res.status(404).json({ error: 'Bot tidak ditemukan' });
  queries.setBotStatus.run('paused', now(), req.params.id);
  res.json({ ok: true });
}));
api.post('/bots/:id/resume', asyncH(async (req: any, res: any) => {
  const userId = uid(req);
  const bot = getUserBot(userId, req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' });
  // Resume = klaim kas lagi: tolak bila kas sudah diklaim bot lain (anti double-spend).
  if (bot.status !== 'running') {
    const { validateBudget } = await import('../engine/budget.js');
    const check = await validateBudget(userId, bot.exchange_id, bot.current_budget, bot.mode as 'paper' | 'live');
    if (!check.ok) return res.status(400).json({ error: check.message, free_quote: check.freeQuote, quote: check.quote });
  }
  queries.setBotStatus.run('running', now(), req.params.id);
  res.json({ ok: true });
}));
api.delete('/bots/:id', asyncH(async (req: any, res: any) => {
  const bot = getUserBot(uid(req), req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' });
  // Bot demo: ikut hapus riwayat + lognya agar tak ada transaksi menggantung.
  // Bot live: riwayat dipertahankan sebagai jejak audit.
  if (bot.mode === 'paper') {
    db.prepare('DELETE FROM trades WHERE bot_id=?').run(bot.id);
    db.prepare('DELETE FROM logs WHERE bot_id=?').run(bot.id);
  }
  queries.deleteBot.run(req.params.id);
  res.json({ ok: true });
}));
api.get('/bots/:id/trend', asyncH(async (req: any, res: any) => {
  if (!getUserBot(uid(req), req.params.id)) return res.status(404).json({ error: 'Bot tidak ditemukan' });
  res.json(pnl.botTrend(Number(req.params.id), num(req.query.days, 7, 1, 90)));
}));

// Equity curve per bot (termasuk titik live agar langsung tampil)
api.get('/bots/:id/equity', asyncH(async (req: any, res: any) => {
  if (!getUserBot(uid(req), req.params.id)) return res.status(404).json({ error: 'Bot tidak ditemukan' });
  const { getEquityCurve } = await import('../engine/equity.js');
  res.json(await getEquityCurve(Number(req.params.id), num(req.query.days, 30, 1, 365)));
}));

// Kas maksimal yang bisa dipakai sebagai budget bot (per exchange milik user).
// Query ?mode=paper|live memaksa kas mode tertentu (untuk Wizard langkah 1).
api.get('/exchanges/:id/max-spendable', asyncH(async (req: any, res: any) => {
  const { maxSpendable } = await import('../engine/budget.js');
  try {
    const mode = String(req.query.mode || '');
    res.json(await maxSpendable(uid(req), req.params.id, mode === 'paper' || mode === 'live' ? mode : undefined));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
}));

// ===== Quick Trade =====
api.post('/trade/quick', asyncH(async (req: any, res: any) => {
  const userId = uid(req);
  const { exchange_id, pair, side, amount, mode } = req.body || {};
  if (!exchange_id || !pair || !side || !amount) {
    return res.status(400).json({ error: 'Field wajib: exchange_id, pair, side, amount' });
  }
  if (!['buy', 'sell'].includes(side)) {
    return res.status(400).json({ error: 'side harus buy atau sell' });
  }
  const exRow = getUserExchange(userId, exchange_id);
  if (!exRow) return res.status(404).json({ error: 'Exchange tidak ditemukan' });
  const usePaper = mode ? mode === 'paper' : exRow.mode === 'paper';
  const client = registry.getForUser(exchange_id, userId);

  if (!usePaper) {
    if (exRow.mode !== 'live') return res.status(400).json({ error: 'Exchange masih mode Demo. Ubah ke Riil di Pengaturan untuk quick trade live.' });
    if (!client.hasCredentials()) return res.status(400).json({ error: 'API key/secret belum diisi' });
  }

  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    return res.status(400).json({ error: 'amount harus angka > 0' });
  }
  const minLot = exRow.min_lot_idr ?? 10000;
  if (side === 'buy' && numAmount < minLot) {
    return res.status(400).json({ error: `Nominal buy minimal ${minLot} ${client.quoteAsset}` });
  }

  const trader = usePaper ? registry.getPaperForUser(exchange_id, userId) : client;
  const clientOrderId = `quick-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.slice(0, 36);

  // Pre-flight yang sama dengan engine agar gagal cepat berpesan jelas
  try {
    const { checkBalance } = await import('../engine/trader.js');
    const { getUsdtIdr } = await import('../engine/balances.js');
    const probeRate = client.quoteAsset === 'IDR' ? 1 : await getUsdtIdr();
    const balErr = await checkBalance(
      { id: 0, user_id: userId, exchange_id, pair } as any,
      side === 'buy'
        ? { type: 'buy', amountQuote: numAmount, reason: '', tag: 'QUICK' }
        : { type: 'sell', qtyBase: numAmount, reason: '', tag: 'QUICK' },
      usePaper, probeRate
    );
    if (balErr) return res.status(400).json({ error: balErr });
  } catch {
    // Gagal baca saldo → biarkan exchange yang memutuskan (fail-open)
  }

  try {
    let result;
    if (side === 'buy') {
      result = await trader.buyMarket(pair, numAmount, clientOrderId);
    } else {
      result = await trader.sellMarket(pair, numAmount, clientOrderId);
    }
    const info = queries.insertTrade.run({
      user_id: userId, bot_id: null, exchange_id, pair: pair.toUpperCase(), side,
      price: result.price, qty: result.qty, fee: result.fee, value: result.qty * result.price,
      realized_pnl: 0, cost_basis: 0, mode: usePaper ? 'paper' : 'live',
      order_id: result.order_id, client_order_id: clientOrderId, strategy_tag: 'QUICK',
      note: 'Quick trade manual', created_at: now()
    });
    res.json({ id: info.lastInsertRowid, ...result, mode: usePaper ? 'paper' : 'live' });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
}));

// ===== Trades =====
function tradeFilter(req: any) {
  const { exchange, mode, strategy_tag, bot_id, from, to } = req.query as any;
  let sql = 'SELECT * FROM trades WHERE user_id=?';
  const args: any[] = [uid(req)];
  if (exchange) { sql += ' AND exchange_id=?'; args.push(exchange); }
  if (mode) { sql += ' AND mode=?'; args.push(mode); }
  if (strategy_tag) { sql += ' AND strategy_tag=?'; args.push(strategy_tag); }
  if (bot_id) { sql += ' AND bot_id=?'; args.push(bot_id); }
  if (from) { sql += ' AND created_at>=?'; args.push(from); }
  if (to) { sql += ' AND created_at<=?'; args.push(to); }
  return { sql, args };
}

api.get('/trades', asyncH(async (req: any, res: any) => {
  const { limit = 50, offset = 0 } = req.query as any;
  const { sql, args } = tradeFilter(req);
  const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) c');
  const total = (db.prepare(countSql).get(...args) as any).c;
  res.json({ total, rows: db.prepare(sql + ' ORDER BY id DESC LIMIT ? OFFSET ?').all(...args, num(limit, 50, 1, 200), num(offset, 0, 0, 1000000)) });
}));

// Ekspor CSV riwayat trades (filter sama, tanpa pagination)
api.get('/trades/export', asyncH(async (req: any, res: any) => {
  const { sql, args } = tradeFilter(req);
  const rows = db.prepare(sql + ' ORDER BY id ASC LIMIT 50000').all(...args) as any[];
  const header = ['id', 'waktu', 'bot_id', 'exchange', 'pair', 'sisi', 'harga', 'qty', 'nilai', 'fee', 'pnl', 'cost_basis', 'mode', 'order_id', 'strategi', 'catatan'];
  const esc = (v: any) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([r.id, r.created_at, r.bot_id ?? '', r.exchange_id, r.pair, r.side, r.price, r.qty, r.value, r.fee, r.realized_pnl, r.cost_basis, r.mode, r.order_id ?? '', r.strategy_tag ?? '', r.note ?? ''].map(esc).join(','));
  }
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="trades-${stamp}.csv"`);
  res.send('\uFEFF' + lines.join('\n'));
}));

// ===== Logs =====
api.get('/logs', asyncH(async (req: any, res: any) => {
  const userId = uid(req);
  const { level, tag, limit = 100 } = req.query as any;
  let sql = 'SELECT * FROM logs WHERE (user_id=? OR user_id=0)';
  const args: any[] = [userId];
  if (level === 'warn') sql += ` AND level IN ('warn','error')`;
  else if (level) { sql += ' AND level=?'; args.push(level); }
  if (tag === 'trades') sql += ` AND tag IN ('TRADE','GRID_UNWIND','DCA_TP','SCALPER_TP','SCALPER_SL','SCALPER_EXIT','INVENTORY_HARVEST_RECYCLE','REBALANCE','AUTO_COMPOUND')`;
  else if (tag) { sql += ' AND tag=?'; args.push(tag); }
  sql += ' ORDER BY id DESC LIMIT ?';
  args.push(num(limit, 100, 1, 500));
  res.json(db.prepare(sql).all(...args));
}));
api.delete('/logs', asyncH(async (req: any, res: any) => {
  // Samakan dengan yang dibaca GET /logs (milik user + global user_id=0),
  // kalau tidak feed tetap penuh log sistem dan terlihat "tidak bisa dibersihkan".
  db.prepare('DELETE FROM logs WHERE (user_id=? OR user_id=0)').run(uid(req));
  res.json({ ok: true });
}));

// ===== Wizard =====
api.get('/wizard/presets', asyncH(async (req: any, res: any) => {
  const { exchange = 'indodax', pair = 'XRPIDR', budget = 100000 } = req.query as any;
  try {
    res.json(await recommend(String(exchange), String(pair).toUpperCase(), num(budget, 100000, 1, 1e12)));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
}));
api.post('/wizard/backtest', asyncH(async (req: any, res: any) => {
  const { exchange_id, pair, preset_id } = req.body || {};
  const preset = PRESETS.find(p => p.id === preset_id);
  if (!preset) return res.status(404).json({ error: 'Preset tidak ditemukan' });
  try {
    const client = registry.get(exchange_id || 'indodax');
    const klines = await client.getKlines(pair, preset.strategi === 'scalper' ? '1m' : '1d', 500);
    res.json(backtest(preset, klines, 100000));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
}));

// Backtest interaktif: strategi + parameter + rentang hari pilihan user
api.post('/backtest', asyncH(async (req: any, res: any) => {
  const { exchange_id, pair, strategy, params, days = 14, budget = 100000 } = req.body || {};
  if (!exchange_id || !pair || !strategy) {
    return res.status(400).json({ error: 'Field wajib: exchange_id, pair, strategy' });
  }
  if (!stratRegistry.get(strategy)) return res.status(400).json({ error: `Strategi tidak dikenal: ${strategy}` });
  const d = num(days, 14, 1, 90);
  const b = num(budget, 100000, 1, 1e12);
  try {
    const { runCustomBacktest } = await import('../engine/wizard.js');
    res.json(await runCustomBacktest(exchange_id, pair.toUpperCase(), strategy, params || {}, d, b));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
}));

// ===== Settings =====
const SECRET_SETTINGS = new Set(['telegram_bot_token']);
api.get('/settings', asyncH(async (req: any, res: any) => {
  const userId = uid(req);
  const all = settings.all(userId);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) {
    out[k] = SECRET_SETTINGS.has(k) ? (v ? mask(v) : '') : v;
  }
  const { telegramConfigured, userChats } = await import('../telegram/notify.js');
  out['telegram_configured'] = String(telegramConfigured(userId) && userChats(userId).length > 0);
  out['secret_key_ok'] = String(config.secretKey.length >= 32);
  res.json(out);
}));

api.put('/settings', asyncH(async (req: any, res: any) => {
  const userId = uid(req);
  const body = req.body || {};
  if (body.indodax_api_version !== undefined && body.indodax_api_version !== '' &&
      !['auto', 'v1', 'v2'].includes(String(body.indodax_api_version))) {
    return res.status(400).json({ error: 'indodax_api_version harus auto, v1, atau v2' });
  }
  if (body.daily_summary_time !== undefined && body.daily_summary_time !== '' &&
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.daily_summary_time))) {
    return res.status(400).json({ error: 'daily_summary_time harus format JJ:MM (00:00–23:59)' });
  }
  const allowed = ['telegram_bot_token', 'telegram_allowed_chat_ids', 'proxy_telegram', 'default_paper_mode', 'daily_summary_time', 'indodax_api_version', 'paper_seed_idr', 'paper_seed_usdt'];
  for (const k of allowed) {
    if (body[k] !== undefined && body[k] !== '') settings.set(k, String(body[k]), userId);
  }
  // Pilihan versi API berubah → terapkan ulang ke client Indodax milik user
  if (body.indodax_api_version !== undefined) {
    registry.reloadUser(userId);
  }
  // Sinkron chat Telegram milik user
  if (body.telegram_allowed_chat_ids !== undefined) {
    const { syncUserChats } = await import('../telegram/bot.js');
    syncUserChats(userId);
  }
  if (body.telegram_bot_token !== undefined || body.proxy_telegram !== undefined) {
    await restartTelegram();
  }
  res.json({ ok: true });
}));

api.post('/telegram/test', asyncH(async (req: any, res: any) => {
  res.json(await sendTestMessage(uid(req)));
}));

// ===== Kill Switch =====
api.post('/killswitch', asyncH(async (req: any, res: any) => {
  const { activateKillSwitch } = await import('../engine/killswitch.js');
  res.json(await activateKillSwitch('Dashboard', uid(req)));
}));

// ===== Price Alerts =====
api.get('/alerts', asyncH(async (req: any, res: any) => {
  res.json(db.prepare('SELECT * FROM price_alerts WHERE user_id=? ORDER BY id DESC LIMIT 100').all(uid(req)));
}));
api.post('/alerts', asyncH(async (req: any, res: any) => {
  const userId = uid(req);
  const { exchange_id, pair, direction, target_price, note } = req.body || {};
  if (!exchange_id || !pair || !direction || !target_price) {
    return res.status(400).json({ error: 'Field wajib: exchange_id, pair, direction, target_price' });
  }
  // Exchange tak dikenal/diverifikasi di sini agar alert tak mati diam-diam selamanya
  try {
    registry.getForUser(exchange_id, userId);
  } catch {
    return res.status(400).json({ error: 'Exchange tidak dikenal' });
  }
  if (!['above', 'below'].includes(direction)) return res.status(400).json({ error: 'direction harus above atau below' });
  const targetNum = Number(target_price);
  if (!Number.isFinite(targetNum) || targetNum <= 0) {
    return res.status(400).json({ error: 'target_price harus angka lebih dari 0' });
  }
  const info = db.prepare('INSERT INTO price_alerts (user_id, exchange_id, pair, direction, target_price, note, active, created_at) VALUES (?,?,?,?,?,?,1,?)')
    .run(userId, exchange_id, pair.toUpperCase(), direction, targetNum, (note ? String(note) : null)?.slice(0, 200) ?? null, now());
  res.status(201).json(db.prepare('SELECT * FROM price_alerts WHERE id=? AND user_id=?').get(info.lastInsertRowid, userId));
}));
api.delete('/alerts/:id', asyncH(async (req: any, res: any) => {
  const row = db.prepare('SELECT * FROM price_alerts WHERE id=? AND user_id=?').get(req.params.id, uid(req)) as any;
  if (!row) return res.status(404).json({ error: 'Alert tidak ditemukan' });
  db.prepare('DELETE FROM price_alerts WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));

// ===== Marketplace preset strategi (v2.0) =====
api.get('/marketplace', asyncH(async (req: any, res: any) => {
  const userId = uid(req);
  const search = String(req.query.search || '').trim();
  // Hitungan bot per preset: link eksak dulu; bot tanpa link (dibuat via Wizard/API)
  // ikut terhitung di preset berstrategi sama (seed bawaan 1 strategi = 1 preset).
  let sql = `SELECT m.*, COALESCE(AVG(r.stars),0) rating, COUNT(r.stars) ratings,
             (SELECT COUNT(*) FROM bots b WHERE b.user_id=?
               AND (b.market_preset_id=m.id OR (b.market_preset_id IS NULL AND b.strategy=m.strategy))) bots_total,
             (SELECT COUNT(*) FROM bots b WHERE b.user_id=? AND b.status='running'
               AND (b.market_preset_id=m.id OR (b.market_preset_id IS NULL AND b.strategy=m.strategy))) bots_running
             FROM market_presets m LEFT JOIN market_ratings r ON r.preset_id=m.id
             WHERE m.public=1`;
  const args: any[] = [userId, userId];
  if (search) {
    const esc = search.replace(/[%_\\]/g, m => `\\${m}`);
    sql += ` AND (m.name LIKE ? ESCAPE '\\' OR m.description LIKE ? ESCAPE '\\')`;
    args.push(`%${esc}%`, `%${esc}%`);
  }
  sql += ' GROUP BY m.id ORDER BY m.installs DESC, m.id ASC LIMIT 100';
  const rows = db.prepare(sql).all(...args) as any[];
  res.json(rows.map(r => ({ ...r, params: JSON.parse(r.params || '{}'), rating: Math.round(r.rating * 10) / 10 })));
}));

api.post('/marketplace', asyncH(async (req: any, res: any) => {
  const userId = uid(req);
  const { name, strategy, params, description, budget_quote } = req.body || {};
  if (!name || !strategy) return res.status(400).json({ error: 'Field wajib: name, strategy' });
  const strat = stratRegistry.get(strategy);
  if (!strat) return res.status(400).json({ error: `Strategi tidak dikenal: ${strategy}` });
  if (params !== undefined && (typeof params !== 'object' || params === null || Array.isArray(params))) {
    return res.status(400).json({ error: 'params harus objek' });
  }
  const merged = { ...strat.defaultParams, ...(params || {}) };
  const info = db.prepare(`INSERT INTO market_presets (user_id, name, strategy, params, description, budget_quote, public, installs, created_at)
    VALUES (?,?,?,?,?,?,1,0,?)`).run(userId, String(name).slice(0, 80), strategy, JSON.stringify(merged), String(description || '').slice(0, 500), num(budget_quote, 100000, 1, 1e12), now());
  res.status(201).json({ id: info.lastInsertRowid });
}));

// Install preset → buat bot (default paused agar direview dulu)
api.post('/marketplace/:id/install', asyncH(async (req: any, res: any) => {
  const userId = uid(req);
  const preset = db.prepare('SELECT * FROM market_presets WHERE id=? AND public=1').get(req.params.id) as any;
  if (!preset) return res.status(404).json({ error: 'Preset tidak ditemukan' });
  const { exchange_id, budget_quote, status, pair } = req.body || {};
  if (!exchange_id) return res.status(400).json({ error: 'Field wajib: exchange_id' });
  const exRow = getUserExchange(userId, exchange_id);
  if (!exRow) return res.status(400).json({ error: 'Exchange tidak dikenal' });
  const strat = stratRegistry.get(preset.strategy);
  if (!strat) return res.status(400).json({ error: `Strategi tidak dikenal: ${preset.strategy}` });
  const presetParams = safeJson<Record<string, any>>(preset.params, {});
  const budgetRaw = Number(budget_quote ?? preset.budget_quote ?? 100000);
  const budget = Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : 100000;
  // Install marketplace selalu paper — tolak sejak awal bila budget > kas demo.
  {
    const { validateBudget } = await import('../engine/budget.js');
    const check = await validateBudget(userId, exchange_id, budget, 'paper');
    if (!check.ok) return res.status(400).json({ error: check.message, free_quote: check.freeQuote, quote: check.quote });
  }
  const divisor = preset.strategy === 'grid' ? 6 : 5;
  const info = queries.insertBot.run({
    user_id: userId, name: `${preset.name} (market)`.slice(0, 80), exchange_id, pair: String(pair || 'XRPIDR').toUpperCase().slice(0, 20),
    strategy: preset.strategy, params: JSON.stringify(presetParams),
    budget_idr: budget, current_budget: budget, lot: Math.floor(budget / divisor),
    mode: 'paper', auto_compound_pct: 100,
    status: status === 'running' ? 'running' : 'paused',
    state: JSON.stringify(strat.init(presetParams)),
    max_daily_loss_pct: 0, market_preset_id: preset.id,
    created_at: now(), updated_at: now()
  });
  db.prepare('UPDATE market_presets SET installs=installs+1 WHERE id=?').run(preset.id);
  const bot = queries.getBot.get(info.lastInsertRowid) as BotRow;
  res.status(201).json({ ...bot, params: safeJson(bot.params, {}), state: safeJson(bot.state, {}) });
}));

// Rating preset (1-5)
api.post('/marketplace/:id/rate', asyncH(async (req: any, res: any) => {
  const userId = uid(req);
  const preset = db.prepare('SELECT * FROM market_presets WHERE id=? AND public=1').get(req.params.id) as any;
  if (!preset) return res.status(404).json({ error: 'Preset tidak ditemukan' });
  const stars = Math.min(5, Math.max(1, Number(req.body?.stars) || 5));
  db.prepare(`INSERT INTO market_ratings (preset_id, user_id, stars) VALUES (?,?,?)
    ON CONFLICT(preset_id, user_id) DO UPDATE SET stars=excluded.stars`).run(preset.id, userId, stars);
  res.json({ ok: true });
}));

// Hapus preset milik sendiri
api.delete('/marketplace/:id', asyncH(async (req: any, res: any) => {
  const preset = db.prepare('SELECT * FROM market_presets WHERE id=? AND user_id=?').get(req.params.id, uid(req)) as any;
  if (!preset) return res.status(404).json({ error: 'Preset tidak ditemukan' });
  db.prepare('DELETE FROM market_presets WHERE id=?').run(req.params.id);
  db.prepare('DELETE FROM market_ratings WHERE preset_id=?').run(req.params.id);
  res.json({ ok: true });
}));

// ===== Error handler =====
export function apiErrorHandler(err: any, _req: any, res: any, _next: any) {
  console.error('API error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
}
