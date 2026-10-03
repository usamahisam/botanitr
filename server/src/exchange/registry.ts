import { db, queries, ExchangeRow } from '../db/index.js';
import { decrypt } from '../crypto.js';
import { ExchangeClient } from './base.js';
import { IndodaxClient } from './indodax.js';
import { TokocryptoClient } from './tokocrypto.js';
import { BinanceClient } from './binance.js';
import { PaperTrader } from './paper.js';

/**
 * Registry per-user: instance client exchange per (exchange, user),
 * disinkronkan dengan baris DB milik user tersebut.
 * Proxy & kredensial diterapkan ulang setiap reload.
 */
function createClient(id: string): ExchangeClient {
  if (id === 'indodax') return new IndodaxClient();
  if (id === 'tokocrypto') return new TokocryptoClient();
  if (id === 'binance') return new BinanceClient();
  throw new Error(`Exchange tidak dikenal: ${id}`);
}

const KNOWN = ['indodax', 'tokocrypto', 'binance'];

class ExchangeRegistry {
  private clients = new Map<string, ExchangeClient>();
  private paperTraders = new Map<string, PaperTrader>();

  private key(exchangeId: string, userId: number) {
    return `${exchangeId}:u${userId}`;
  }

  /** Client publik (tanpa kredensial) — untuk ticker/klines. */
  get(id: string): ExchangeClient {
    if (!this.clients.has(id)) this.clients.set(id, createClient(id));
    return this.clients.get(id)!;
  }

  /** Client dengan kredensial + proxy milik user. */
  getForUser(exchangeId: string, userId: number): ExchangeClient {
    const k = this.key(exchangeId, userId);
    if (!this.clients.has(k)) {
      const c = createClient(exchangeId);
      this.applyRow(c, exchangeId, userId);
      this.clients.set(k, c);
    }
    return this.clients.get(k)!;
  }

  getPaper(id: string): PaperTrader {
    if (!this.paperTraders.has(id)) this.paperTraders.set(id, new PaperTrader(this.get(id), 0));
    return this.paperTraders.get(id)!;
  }

  getPaperForUser(exchangeId: string, userId: number): PaperTrader {
    const k = this.key(exchangeId, userId);
    if (!this.paperTraders.has(k)) this.paperTraders.set(k, new PaperTrader(this.get(exchangeId), userId));
    return this.paperTraders.get(k)!;
  }

  private applyRow(client: ExchangeClient, exchangeId: string, userId: number) {
    const row = db.prepare('SELECT * FROM exchanges WHERE id=? AND user_id=?').get(exchangeId, userId) as ExchangeRow | undefined;
    if (!row) return;
    client.setProxy(row.proxy_url || undefined);
    if (row.api_key_enc && row.api_secret_enc) {
      try {
        client.setCredentials(decrypt(row.api_key_enc), decrypt(row.api_secret_enc));
      } catch { /* SECRET_KEY berubah → kredensial tidak bisa didekripsi */ }
    }
  }

  /** Terapkan ulang kredensial + proxy milik user ke client miliknya */
  reloadUser(userId: number) {
    for (const id of KNOWN) {
      const k = this.key(id, userId);
      const client = this.clients.get(k);
      if (client) this.applyRow(client, id, userId);
    }
  }

  /** Muat ulang semua user (dipakai saat boot) */
  reloadFromDb() {
    const users = db.prepare('SELECT id FROM users').all() as any[];
    const ids = users.length > 0 ? users.map(u => u.id) : [0];
    for (const uid of ids) this.reloadUser(uid);
  }

  list(): ExchangeClient[] {
    return KNOWN.map(id => this.get(id));
  }
}

export const registry = new ExchangeRegistry();
