import { Router } from 'express';
import { db, queries, settings, now, BotRow, ExchangeRow } from '../db/index.js';
import { encrypt, decrypt, mask } from '../crypto.js';
import { registry } from '../exchange/registry.js';
import { fetchExchangeBalance, getUsdtIdr } from '../engine/balances.js';
import { pnl } from '../engine/pnl.js';
import { recommend, backtest, PRESETS } from '../engine/wizard.js';
import { restartTelegram, sendTestMessage } from '../telegram/bot.js';
import { notify } from '../telegram/notify.js';
import { registry as stratRegistry } from '../strategies/types.js';
import { config } from '../config.js';
import '../strategies/grid.js';
import '../strategies/dca.js';
import '../strategies/scalper.js';
import '../strategies/harvester.js';

export const api = Router();

const asyncH = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next);

// ===== Health =====
api.get('/health', asyncH(async (_req: any, res: any) => {
  const exchanges = (queries.allExchanges.all() as ExchangeRow[]).map(e => ({ id: e.id, mode: e.mode, status: e.status }));
  res.json({ ok: true, time: now(), exchanges });
}));

// ===== Dashboard =====
api.get('/dashboard', asyncH(async (_req: any, res: any) => {
  const usdtIdr = await getUsdtIdr();
  const views = [];
  for (const client of registry.list()) views.push(await fetchExchangeBalance(client.id));

  const totalIdr = views.reduce((s, v) => s + v.saldo_total_idr, 0);

  // Perubahan 24j dari snapshot
  let change24Idr = 0;
  for (const v of views) {
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const snap = db.prepare(`SELECT COALESCE(SUM(total_idr),0) s FROM balance_snapshots WHERE exchange_id=? AND created_at <= ? ORDER BY created_at DESC LIMIT 100`).get(v.id, dayAgo) as any;
    if (snap.s > 0) change24Idr += v.saldo_total_idr - snap.s;
  }
  const change24Pct = totalIdr - change24Idr > 0 ? (change24Idr / (totalIdr - change24Idr)) * 100 : 0;

  // Win rate & realized (gabungan, konversi IDR)
  let realizedIdr = 0, realizedTodayIdr = 0;
  for (const v of views) {
    const mult = v.quote_asset === 'IDR' ? 1 : usdtIdr;
    realizedIdr += pnl.realized(v.id) * mult;
    realizedTodayIdr += pnl.realizedToday(v.id) * mult;
  }
  const wr = pnl.winRate();

  // Per-exchange profit
  const exCards = await Promise.all(views.map(async v => {
    const mult = v.quote_asset === 'IDR' ? 1 : usdtIdr;
    return {
      ...v,
      profit_harian: pnl.realizedToday(v.id) * mult,
      profit_total: pnl.realized(v.id) * mult,
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
api.get('/exchanges', asyncH(async (_req: any, res: any) => {
  const rows = queries.allExchanges.all() as ExchangeRow[];
  res.json(rows.map(e => ({
    id: e.id, name: e.name, mode: e.mode, status: e.status, enabled: e.enabled,
    proxy_url: e.proxy_url, min_lot_idr: e.min_lot_idr, last_sync: e.last_sync,
    api_key_masked: e.api_key_enc ? mask(safeDecrypt(e.api_key_enc)) : '',
    has_credentials: !!(e.api_key_enc && e.api_secret_enc)
  })));
}));

function safeDecrypt(enc: string): string {
  try { return decrypt(enc); } catch { return ''; }
}

api.put('/exchanges/:id', asyncH(async (req: any, res: any) => {
  const id = req.params.id;
  const row = queries.getExchange.get(id) as ExchangeRow | undefined;
  if (!row) return res.status(404).json({ error: 'Exchange tidak ditemukan' });
  const { api_key, api_secret, proxy_url, mode } = req.body || {};

  if (api_key) db.prepare('UPDATE exchanges SET api_key_enc=? WHERE id=?').run(encrypt(api_key), id);
  if (api_secret) db.prepare('UPDATE exchanges SET api_secret_enc=? WHERE id=?').run(encrypt(api_secret), id);
  if (proxy_url !== undefined) db.prepare('UPDATE exchanges SET proxy_url=? WHERE id=?').run(proxy_url || null, id);
  if (mode && ['paper', 'live'].includes(mode)) {
    // Guard: live butuh kredensial
    if (mode === 'live') {
      const fresh = queries.getExchange.get(id) as ExchangeRow;
      if (!fresh.api_key_enc || !fresh.api_secret_enc) {
        return res.status(400).json({ error: 'Isi API key & secret dulu sebelum mode Riil' });
      }
    }
    db.prepare('UPDATE exchanges SET mode=? WHERE id=?').run(mode, id);
  }
  registry.reloadFromDb();
  res.json({ ok: true });
}));

api.post('/exchanges/:id/test', asyncH(async (req: any, res: any) => {
  const client = registry.get(req.params.id);
  res.json(await client.testConnection());
}));

api.post('/exchanges/:id/sync', asyncH(async (req: any, res: any) => {
  res.json(await fetchExchangeBalance(req.params.id));
}));

// ===== Pairs =====
api.get('/pairs', asyncH(async (req: any, res: any) => {
  const ex = String(req.query.exchange || '');
  const rows = ex
    ? db.prepare('SELECT * FROM default_pairs WHERE exchange_id=? ORDER BY sort').all(ex)
    : db.prepare('SELECT * FROM default_pairs ORDER BY exchange_id, sort').all();
  res.json(rows);
}));

// ===== Bots =====
api.get('/bots', asyncH(async (req: any, res: any) => {
  const status = String(req.query.status || '');
  const bots = (status
    ? db.prepare('SELECT * FROM bots WHERE status=? ORDER BY id DESC').all(status)
    : queries.allBots.all()) as BotRow[];
  res.json(bots.map(b => ({
    ...b, params: JSON.parse(b.params), state: undefined,
    stats: pnl.botStats(b.id),
    trend: pnl.botTrend(b.id)
  })));
}));

api.get('/bots/:id', asyncH(async (req: any, res: any) => {
  const bot = queries.getBot.get(req.params.id) as BotRow | undefined;
  if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' });
  res.json({ ...bot, params: JSON.parse(bot.params), state: JSON.parse(bot.state), stats: pnl.botStats(bot.id), trend: pnl.botTrend(bot.id) });
}));

api.post('/bots', asyncH(async (req: any, res: any) => {
  const { name, exchange_id, pair, strategy, params, budget_idr, auto_compound_pct, mode, confirmed_live, max_daily_loss_pct } = req.body || {};
  if (!name || !exchange_id || !pair || !strategy || !budget_idr) {
    return res.status(400).json({ error: 'Field wajib: name, exchange_id, pair, strategy, budget_idr' });
  }
  const strat = stratRegistry.get(strategy);
  if (!strat) return res.status(400).json({ error: `Strategi tidak dikenal: ${strategy}` });
  const exRow = queries.getExchange.get(exchange_id) as ExchangeRow | undefined;
  if (!exRow) return res.status(400).json({ error: 'Exchange tidak dikenal' });

  const finalMode = mode || (settings.get('default_paper_mode', String(config.defaultPaperMode)) === 'true' ? 'paper' : 'paper');
  if (finalMode === 'live') {
    if (exRow.mode !== 'live') return res.status(400).json({ error: 'Exchange masih mode Demo. Ubah di Pengaturan.' });
    if (!confirmed_live) return res.status(400).json({ error: 'Konfirmasi live trading diperlukan (confirmed_live)' });
  }

  const mergedParams = { ...strat.defaultParams, ...(params || {}) };
  const divisor = strategy === 'grid' ? Math.max(2, Number(mergedParams.levels ?? 6)) : Math.max(1, Number(mergedParams.max_buys ?? 5));
  const lot = Math.floor(Number(budget_idr) / divisor);

  const info = queries.insertBot.run({
    name, exchange_id, pair: pair.toUpperCase(), strategy,
    params: JSON.stringify(mergedParams), budget_idr: Number(budget_idr),
    current_budget: Number(budget_idr), lot,
    mode: finalMode, auto_compound_pct: Number(auto_compound_pct ?? 100),
    status: 'running', state: JSON.stringify(strat.init(mergedParams)),
    max_daily_loss_pct: Math.max(0, Number(max_daily_loss_pct ?? 0)),
    created_at: now(), updated_at: now()
  });
  const bot = queries.getBot.get(info.lastInsertRowid) as BotRow;
  res.status(201).json({ ...bot, params: JSON.parse(bot.params), state: JSON.parse(bot.state) });
}));

api.post('/bots/:id/pause', asyncH(async (req: any, res: any) => {
  queries.setBotStatus.run('paused', now(), req.params.id);
  res.json({ ok: true });
}));
api.post('/bots/:id/resume', asyncH(async (req: any, res: any) => {
  queries.setBotStatus.run('running', now(), req.params.id);
  res.json({ ok: true });
}));
api.delete('/bots/:id', asyncH(async (req: any, res: any) => {
  queries.deleteBot.run(req.params.id);
  res.json({ ok: true });
}));
api.get('/bots/:id/trend', asyncH(async (req: any, res: any) => {
  res.json(pnl.botTrend(Number(req.params.id), Number(req.query.days || 7)));
}));

// Equity curve per bot
api.get('/bots/:id/equity', asyncH(async (req: any, res: any) => {
  const { getEquityCurve } = await import('../engine/equity.js');
  res.json(getEquityCurve(Number(req.params.id), Number(req.query.days || 30)));
}));

// ===== Quick Trade =====
api.post('/trade/quick', asyncH(async (req: any, res: any) => {
  const { exchange_id, pair, side, amount, mode } = req.body || {};
  if (!exchange_id || !pair || !side || !amount) {
    return res.status(400).json({ error: 'Field wajib: exchange_id, pair, side, amount' });
  }
  if (!['buy', 'sell'].includes(side)) {
    return res.status(400).json({ error: 'side harus buy atau sell' });
  }
  const exRow = queries.getExchange.get(exchange_id) as ExchangeRow;
  if (!exRow) return res.status(404).json({ error: 'Exchange tidak ditemukan' });
  const usePaper = mode ? mode === 'paper' : exRow.mode === 'paper';
  const client = registry.get(exchange_id);

  // Guard live: kredensial + exchange mode
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

  const trader = usePaper ? registry.getPaper(exchange_id) : client;
  const clientOrderId = `quick-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.slice(0, 36);

  try {
    let result;
    if (side === 'buy') {
      result = await trader.buyMarket(pair, numAmount, clientOrderId);
    } else {
      result = await trader.sellMarket(pair, numAmount, clientOrderId);
    }
    const info = queries.insertTrade.run({
      bot_id: null, exchange_id, pair: pair.toUpperCase(), side,
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
api.get('/trades', asyncH(async (req: any, res: any) => {
  const { exchange, mode, strategy_tag, bot_id, limit = 50, offset = 0, from, to } = req.query as any;
  let sql = 'SELECT * FROM trades WHERE 1=1';
  const args: any[] = [];
  if (exchange) { sql += ' AND exchange_id=?'; args.push(exchange); }
  if (mode) { sql += ' AND mode=?'; args.push(mode); }
  if (strategy_tag) { sql += ' AND strategy_tag=?'; args.push(strategy_tag); }
  if (bot_id) { sql += ' AND bot_id=?'; args.push(bot_id); }
  if (from) { sql += ' AND created_at>=?'; args.push(from); }
  if (to) { sql += ' AND created_at<=?'; args.push(to); }
  const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) c');
  const total = (db.prepare(countSql).get(...args) as any).c;
  sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
  args.push(Number(limit), Number(offset));
  res.json({ total, rows: db.prepare(sql).all(...args) });
}));

// ===== Logs =====
api.get('/logs', asyncH(async (req: any, res: any) => {
  const { level, tag, limit = 100 } = req.query as any;
  let sql = 'SELECT * FROM logs WHERE 1=1';
  const args: any[] = [];
  if (level === 'warn') sql += ` AND level IN ('warn','error')`;
  else if (level) { sql += ' AND level=?'; args.push(level); }
  if (tag === 'trades') sql += ` AND tag IN ('TRADE','GRID_UNWIND','DCA_TP','SCALPER_TP','SCALPER_SL','SCALPER_EXIT','INVENTORY_HARVEST_RECYCLE','AUTO_COMPOUND')`;
  else if (tag) { sql += ' AND tag=?'; args.push(tag); }
  sql += ' ORDER BY id DESC LIMIT ?';
  args.push(Number(limit));
  res.json(db.prepare(sql).all(...args));
}));
api.delete('/logs', asyncH(async (_req: any, res: any) => {
  db.prepare('DELETE FROM logs').run();
  res.json({ ok: true });
}));

// ===== Wizard =====
api.get('/wizard/presets', asyncH(async (req: any, res: any) => {
  const { exchange = 'indodax', pair = 'XRPIDR', budget = 100000 } = req.query as any;
  try {
    res.json(await recommend(String(exchange), String(pair).toUpperCase(), Number(budget)));
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

// ===== Settings =====
const SECRET_SETTINGS = new Set(['telegram_bot_token']);
api.get('/settings', asyncH(async (_req: any, res: any) => {
  const all = settings.all();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) {
    out[k] = SECRET_SETTINGS.has(k) ? (v ? mask(v) : '') : v;
  }
  out['telegram_configured'] = String(!!(settings.get('telegram_bot_token') && settings.get('telegram_allowed_chat_ids')));
  out['secret_key_ok'] = String(config.secretKey.length >= 32);
  res.json(out);
}));

api.put('/settings', asyncH(async (req: any, res: any) => {
  const body = req.body || {};
  const allowed = ['telegram_bot_token', 'telegram_allowed_chat_ids', 'proxy_telegram', 'default_paper_mode', 'daily_summary_time'];
  for (const k of allowed) {
    if (body[k] !== undefined && body[k] !== '') settings.set(k, String(body[k]));
  }
  // Restart telegram jika konfigurasi berubah
  if (body.telegram_bot_token !== undefined || body.telegram_allowed_chat_ids !== undefined || body.proxy_telegram !== undefined) {
    await restartTelegram();
  }
  res.json({ ok: true });
}));

api.post('/telegram/test', asyncH(async (_req: any, res: any) => {
  res.json(await sendTestMessage());
}));

// ===== Kill Switch =====
api.post('/killswitch', asyncH(async (_req: any, res: any) => {
  const { activateKillSwitch } = await import('../engine/killswitch.js');
  res.json(await activateKillSwitch('Dashboard'));
}));

// ===== Price Alerts =====
api.get('/alerts', asyncH(async (_req: any, res: any) => {
  res.json(db.prepare('SELECT * FROM price_alerts ORDER BY id DESC LIMIT 100').all());
}));
api.post('/alerts', asyncH(async (req: any, res: any) => {
  const { exchange_id, pair, direction, target_price, note } = req.body || {};
  if (!exchange_id || !pair || !direction || !target_price) {
    return res.status(400).json({ error: 'Field wajib: exchange_id, pair, direction, target_price' });
  }
  if (!['above', 'below'].includes(direction)) return res.status(400).json({ error: 'direction harus above atau below' });
  const info = db.prepare('INSERT INTO price_alerts (exchange_id, pair, direction, target_price, note, active, created_at) VALUES (?,?,?,?,?,1,?)')
    .run(exchange_id, pair.toUpperCase(), direction, Number(target_price), note || null, now());
  res.status(201).json(db.prepare('SELECT * FROM price_alerts WHERE id=?').get(info.lastInsertRowid));
}));
api.delete('/alerts/:id', asyncH(async (req: any, res: any) => {
  db.prepare('DELETE FROM price_alerts WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));

// ===== Error handler =====
export function apiErrorHandler(err: any, _req: any, res: any, _next: any) {
  console.error('API error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
}
