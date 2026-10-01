import { db, queries, now, BotRow, TradeRow } from '../db/index.js';
import { registry } from '../exchange/registry.js';
import { log } from '../log.js';
import { Action } from '../strategies/types.js';
import { fmtIDR } from '../utils/format.js';
import { compound } from './compound.js';

let tradeCounter = 0;

/**
 * Eksekusi Action dari strategi → order (paper/live) → catat trade → compound.
 * Idempoten via client_order_id.
 */
export async function executeAction(bot: BotRow, action: Action, usdtIdr: number): Promise<TradeRow | null> {
  const cycle = `${Date.now()}-${tradeCounter++}`;
  // client_order_id: maks 36 char, alfanumerik _- (aturan Indodax)
  const clientOrderId = `bot${bot.id}-${action.type}${cycle}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 36);

  // Idempotensi lokal (double-tick dalam satu proses)
  if (queries.tradeByClientId.get(clientOrderId)) return null;

  const client = registry.get(bot.exchange_id);
  const paper = bot.mode === 'paper';
  const trader = paper ? registry.getPaper(bot.exchange_id) : client;

  const minLot = (queries.getExchange.get(bot.exchange_id) as any)?.min_lot_idr ?? 10000;

  try {
    let result: { order_id: string; price: number; qty: number; fee: number; side: 'buy' | 'sell' };
    let value = 0;

    if (action.type === 'buy') {
      const amount = action.amountQuote ?? 0;
      if (amount < minLot) {
        log('warn', 'TRADE', `Order buy ${fmtIDR(amount * usdtIdr)} < lot minimum ${fmtIDR(minLot * usdtIdr)}, dilewati`, { bot_id: bot.id });
        return null;
      }
      result = await trader.buyMarket(bot.pair, amount, clientOrderId);
      value = result.qty * result.price;
    } else {
      const qty = action.qtyBase ?? 0;
      if (qty <= 0) return null;
      result = await trader.sellMarket(bot.pair, qty, clientOrderId);
      value = result.qty * result.price;
    }

    const realized = action.type === 'sell' ? value - result.fee - (action.costBasis ?? 0) : 0;
    const row: Omit<TradeRow, 'id'> = {
      bot_id: bot.id, exchange_id: bot.exchange_id, pair: bot.pair,
      side: action.type, price: result.price, qty: result.qty, fee: result.fee,
      value, realized_pnl: realized, cost_basis: action.costBasis ?? 0,
      mode: bot.mode, order_id: result.order_id, client_order_id: clientOrderId,
      strategy_tag: action.tag, note: action.reason, created_at: now()
    };
    const info = queries.insertTrade.run(row);
    const trade: TradeRow = { id: Number(info.lastInsertRowid), ...row };

    const modeBadge = paper ? '📄' : '💰';
    const sideLabel = action.type === 'buy' ? 'BELI' : 'JUAL';
    log('info', (action.tag as any) || 'TRADE',
      `${modeBadge} ${sideLabel} ${bot.pair} ${result.qty.toFixed(8)} @ ${Math.round(result.price)} — ${action.reason}`,
      { bot_id: bot.id, impact_rp: action.impactRp ?? (realized * usdtIdr || undefined) });

    // Auto-compound setelah profit
    if (realized > 0) {
      compound.maybeCompound(bot, realized, usdtIdr);
    }

    return trade;
  } catch (e: any) {
    log('error', 'ERROR', `Eksekusi ${action.type} ${bot.pair} gagal: ${e.message}`, { bot_id: bot.id });
    throw e;
  }
}
