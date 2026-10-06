/**
 * Regresi kasus Flash BTC 0.00011 -> terisi 0.0001 (truncation LOT_SIZE):
 *  A) sellMarket membulatkan ke step (0.00010989 -> req 0.00010)
 *  B) di bawah minQty -> error debu yang jelas (bukan fill misterius)
 *  C) posisi dikecilkan proporsional saat fill parsial (sisa tak yatim)
 *
 * Jalankan: npx tsx server/scripts/test-lotsize.ts
 */
let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

async function main() {
  const { TokocryptoClient } = await import('../src/exchange/tokocrypto.js');
  const { applyFillToState } = await import('../src/engine/scheduler.js');

  console.log('A+B) Normalisasi LOT_SIZE Binance-family');
  const client: any = new TokocryptoClient();
  // BTCUSDT: step 0.00001, min 0.00001 — cache langsung tanpa network
  client.symbolFilters.set('BTCUSDT', { stepSize: 0.00001, minQty: 0.00001, minNotional: 10, ts: Date.now() });
  let sentQty = '';
  client.signed = async (_m: string, _p: string, params: any) => {
    sentQty = String(params.quantity);
    const q = parseFloat(params.quantity);
    return { orderId: '1', fills: [{ qty: String(q), commission: '0' }], executedQty: String(q), cummulativeQuoteQty: String(q * 85590), status: 'FILLED' };
  };
  await client.sellMarket('BTCUSDT', 0.00010989);
  check('0.00010989 -> req 0.00010', sentQty === '0.0001', `got ${sentQty}`);
  try {
    await client.sellMarket('BTCUSDT', 0.000001);
    check('debu di bawah minQty ditolak', false);
  } catch (e: any) {
    check('debu di bawah minQty ditolak', /minimum order|debu/i.test(e.message), e.message);
  }

  console.log('\nC) Fill parsial tak menghapus posisi');
  const st: any = { position: { entryPrice: 85670, qty: 0.00011, cost: 9.4237 } };
  applyFillToState('scalper', st, { price: 85590, qty: 0.0001, value: 8.559, fee: 0.0086 }, { type: 'sell' });
  check('sisa 0.00001 tertinggal di state', st.position !== null && Math.abs(st.position.qty - 0.00001) < 1e-9, JSON.stringify(st.position));
  applyFillToState('scalper', st, { price: 85590, qty: 0.00001, value: 0.8559, fee: 0.0009 }, { type: 'sell' });
  check('fill penuh bersihkan posisi', st.position === null);

  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
