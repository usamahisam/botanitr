import { db, queries } from '../db/index.js';
import { ExchangeClient, Balance, OrderResult, ExchangeError, parsePair } from './base.js';

/**
 * Simulator paper trading. Saldo virtual disimpan di tabel paper_balances.
 * Fill di harga ask (buy) / bid (sell) dari ticker live + fee exchange.
 */
export class PaperTrader {
  constructor(private liveClient: ExchangeClient) {}

  private seedIfNeeded(exchangeId: string, quoteAsset: string) {
    const row = db.prepare('SELECT free FROM paper_balances WHERE exchange_id=? AND asset=?')
      .get(exchangeId, quoteAsset) as any;
    if (!row) {
      const seed = quoteAsset === 'IDR' ? 10_000_000 : 1000;
      queries.upsertPaperBalance.run(exchangeId, quoteAsset, seed, 0);
    }
  }

  getBalances(): Balance[] {
    this.seedIfNeeded(this.liveClient.id, this.liveClient.quoteAsset);
    return (queries.paperBalances.all(this.liveClient.id) as any[])
      .map(r => ({ asset: r.asset, free: r.free, locked: r.locked }))
      .filter(b => b.free > 0 || b.locked > 0);
  }

  private setBalance(asset: string, free: number) {
    queries.upsertPaperBalance.run(this.liveClient.id, asset, Math.max(0, free), 0);
  }
  private getFree(asset: string): number {
    const row = db.prepare('SELECT free FROM paper_balances WHERE exchange_id=? AND asset=?')
      .get(this.liveClient.id, asset) as any;
    return row?.free ?? 0;
  }

  async buyMarket(pair: string, amountQuote: number): Promise<OrderResult> {
    this.seedIfNeeded(this.liveClient.id, this.liveClient.quoteAsset);
    const quote = this.liveClient.quoteAsset;
    const { base } = parsePair(pair, quote);
    const freeQuote = this.getFree(quote);
    if (amountQuote > freeQuote) throw new ExchangeError(`Saldo paper ${quote} tidak cukup (butuh ${amountQuote}, ada ${freeQuote})`);

    const ticker = await this.liveClient.getTicker(pair);
    const price = ticker.ask;
    const fee = amountQuote * this.liveClient.feeRate;
    const qty = (amountQuote - fee) / price;

    this.setBalance(quote, freeQuote - amountQuote);
    this.setBalance(base, this.getFree(base) + qty);

    return { order_id: `paper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, price, qty, fee, side: 'buy', status: 'filled' };
  }

  async sellMarket(pair: string, qtyBase: number): Promise<OrderResult> {
    this.seedIfNeeded(this.liveClient.id, this.liveClient.quoteAsset);
    const quote = this.liveClient.quoteAsset;
    const { base } = parsePair(pair, quote);
    const freeBase = this.getFree(base);
    if (qtyBase > freeBase + 1e-12) throw new ExchangeError(`Saldo paper ${base} tidak cukup (butuh ${qtyBase}, ada ${freeBase})`);

    const ticker = await this.liveClient.getTicker(pair);
    const price = ticker.bid;
    const gross = qtyBase * price;
    const fee = gross * this.liveClient.feeRate;

    this.setBalance(base, Math.max(0, freeBase - qtyBase));
    this.setBalance(quote, this.getFree(quote) + gross - fee);

    return { order_id: `paper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, price, qty: qtyBase, fee, side: 'sell', status: 'filled' };
  }
}
