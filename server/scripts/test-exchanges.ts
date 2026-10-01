/**
 * Tes koneksi exchange publik: ticker + klines.
 * Jalankan: npm run test:exchanges -w server
 */
import { IndodaxClient } from '../src/exchange/indodax.js';
import { TokocryptoClient } from '../src/exchange/tokocrypto.js';

const proxy = process.env.TEST_PROXY || process.env.DEFAULT_PROXY || '';

async function main() {
  console.log('=== Indodax ===');
  const idx = new IndodaxClient();
  const t1 = await idx.testConnection();
  console.log('ping:', t1);
  if (t1.ok) {
    const tk = await idx.getTicker('btcidr');
    console.log(`BTCIDR last=${tk.last} bid=${tk.bid} ask=${tk.ask}`);
    const kl = await idx.getKlines('xrp_idr', '1m', 5);
    console.log(`XRP klines (agregasi): ${kl.length} candle`);
  }

  console.log('\n=== Tokocrypto ===');
  const tko = new TokocryptoClient();
  if (proxy) { tko.setProxy(proxy); console.log(`pakai proxy: ${proxy.replace(/\/\/.*@/, '//***@')}`); }
  const t2 = await tko.testConnection();
  console.log('ping:', t2);
  try {
    const tk = await tko.getTicker('XRPUSDT');
    console.log(`XRPUSDT last=${tk.last} bid=${tk.bid} ask=${tk.ask}`);
    const kl = await tko.getKlines('XRPUSDT', '1m', 5);
    console.log(`klines: ${kl.length} candle, close terakhir=${kl.at(-1)?.[4]}`);
  } catch (e: any) {
    console.log(`market data: GAGAL (diharapkan jika IP diblokir) → ${e.message}`);
  }
}

main().catch(e => { console.error('GAGAL:', e.message); process.exit(1); });
