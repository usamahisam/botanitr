import axios, { AxiosInstance } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { sleep } from '../utils/format.js';

/** Buat agent proxy sesuai skema URL */
export function makeAgent(proxyUrl?: string | null) {
  if (!proxyUrl) return undefined;
  if (/^socks/i.test(proxyUrl)) return new SocksProxyAgent(proxyUrl);
  return new HttpsProxyAgent(proxyUrl);
}

/** Factory axios instance dengan proxy + retry exponential untuk error jaringan/5xx */
export function createHttp(baseURL: string, proxyUrl?: string | null): AxiosInstance {
  const agent = makeAgent(proxyUrl);
  const instance = axios.create({
    baseURL,
    timeout: 15000,
    httpAgent: agent,
    httpsAgent: agent,
    headers: { 'User-Agent': 'TradingBotani/1.0' }
  });

  instance.interceptors.response.use(undefined, async (err) => {
    const cfg: any = err.config || {};
    const status = err.response?.status;
    const is429 = status === 429;
    const retryable = !status || status >= 500 || is429;
    cfg.__retryCount = cfg.__retryCount || 0;
    // 429 (rate-limit): mundur lebih sopan, maks 2x — selebihnya biarkan
    // failStreak trader yang menurunkan mode, bukan retry membabi-buta.
    const maxRetry = is429 ? 2 : 3;
    if (retryable && cfg.__retryCount < maxRetry) {
      cfg.__retryCount++;
      const wait = is429 ? 2000 * Math.pow(4, cfg.__retryCount - 1) : 500 * Math.pow(3, cfg.__retryCount - 1);
      await sleep(wait);
      return instance(cfg);
    }
    return Promise.reject(err);
  });

  return instance;
}
