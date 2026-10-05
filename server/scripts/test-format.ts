/**
 * Format sadar-quote + jam WIB.
 * Jalankan: npx tsx server/scripts/test-format.ts
 */
let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

async function main() {
  const { fmtMoney, fmtSignedMoney, fmtTimeWib, quoteOfPair } = await import('../src/utils/format.js');

  console.log('A) Quote dari pair');
  check('XRPUSDT → USDT', quoteOfPair('XRPUSDT') === 'USDT');
  check('XRPIDR → IDR', quoteOfPair('XRPIDR') === 'IDR');
  check('BTCIDR → IDR', quoteOfPair('BTCIDR') === 'IDR');

  console.log('\nB) Nominal sadar-quote');
  check('IDR pakai Rp', fmtMoney(1500000, 'IDR') === 'Rp 1.500.000', fmtMoney(1500000, 'IDR'));
  check('USDT tanpa Rp', fmtMoney(150.5, 'USDT') === '150,50 USDT', fmtMoney(150.5, 'USDT'));
  check('USDT besar tanpa desimal', fmtMoney(1500.5, 'USDT') === '1.501 USDT', fmtMoney(1500.5, 'USDT'));
  check('harga kecil presisi 4', fmtMoney(0.5321, 'USDT') === '0,5321 USDT', fmtMoney(0.5321, 'USDT'));
  check('signed USDT', fmtSignedMoney(12.5, 'USDT') === '+12,50 USDT', fmtSignedMoney(12.5, 'USDT'));
  check('signed IDR', fmtSignedMoney(-2000, 'IDR') === '-Rp 2.000', fmtSignedMoney(-2000, 'IDR'));

  console.log('\nC) Jam WIB');
  check('10:00 UTC → 17:00 WIB', fmtTimeWib('2026-10-05T10:00:01.000Z') === '17.00.01', fmtTimeWib('2026-10-05T10:00:01.000Z'));
  check('tengah malam UTC → pagi WIB', fmtTimeWib('2026-10-05T00:30:00.000Z') === '07.30.00', fmtTimeWib('2026-10-05T00:30:00.000Z'));

  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
