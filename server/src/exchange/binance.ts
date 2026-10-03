import { config } from '../config.js';
import { TokocryptoClient } from './tokocrypto.js';

/**
 * Client Binance spot — memakai protokol yang sama dengan Tokocrypto
 * (Binance REST v3, HMAC-SHA256), hanya beda base URL & identitas.
 * Fee spot standar 0.1% (tanpa BNB discount).
 */
export class BinanceClient extends TokocryptoClient {
  readonly id = 'binance';
  protected label = 'Binance';
  protected override baseUrl(): string { return config.binanceBaseUrl; }
}
