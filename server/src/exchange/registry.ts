import { queries, ExchangeRow } from '../db/index.js';
import { decrypt } from '../crypto.js';
import { ExchangeClient } from './base.js';
import { IndodaxClient } from './indodax.js';
import { TokocryptoClient } from './tokocrypto.js';
import { PaperTrader } from './paper.js';

/**
 * Registry: instance client exchange tunggal, disinkronkan dengan baris DB.
 * Proxy & kredensial diterapkan ulang setiap reload.
 */
class ExchangeRegistry {
  private clients = new Map<string, ExchangeClient>();
  private paperTraders = new Map<string, PaperTrader>();

  constructor() {
    this.clients.set('indodax', new IndodaxClient());
    this.clients.set('tokocrypto', new TokocryptoClient());
  }

  get(id: string): ExchangeClient {
    const c = this.clients.get(id);
    if (!c) throw new Error(`Exchange tidak dikenal: ${id}`);
    return c;
  }

  getPaper(id: string): PaperTrader {
    if (!this.paperTraders.has(id)) this.paperTraders.set(id, new PaperTrader(this.get(id)));
    return this.paperTraders.get(id)!;
  }

  /** Terapkan kredensial + proxy dari DB ke semua client */
  reloadFromDb() {
    const rows = queries.allExchanges.all() as ExchangeRow[];
    for (const row of rows) {
      const client = this.clients.get(row.id);
      if (!client) continue;
      client.setProxy(row.proxy_url || undefined);
      if (row.api_key_enc && row.api_secret_enc) {
        try {
          client.setCredentials(decrypt(row.api_key_enc), decrypt(row.api_secret_enc));
        } catch { /* SECRET_KEY berubah → kredensial tidak bisa didekripsi */ }
      }
    }
  }

  list(): ExchangeClient[] { return [...this.clients.values()]; }
}

export const registry = new ExchangeRegistry();
