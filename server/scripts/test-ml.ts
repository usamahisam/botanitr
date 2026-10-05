/**
 * Fondasi ML walk-forward:
 *  A) fitur terekstrak lengkap per candle
 *  B) pola oversold-bounce sintetik terdeteksi (presisi uji > 50%)
 *  C) data acak: tidak ada sinyal yang dipercaya (skor rendah)
 *
 * Jalankan: npx tsx server/scripts/test-ml.ts
 */
let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toK(closes: number[]): any[] {
  return closes.map((c, i) => [1700000000000 + i * 300000, c * 0.999, c * 1.001, c * 0.999, c, 100]);
}

async function main() {
  const { extractFeatures, evaluateSignals } = await import('../src/engine/ml.js');

  console.log('A) Fitur');
  const rnd = mulberry32(5);
  const choppy: number[] = [];
  for (let i = 0; i < 200; i++) choppy.push(100000 * (1 + 0.02 * Math.sin(i / 7) + 0.004 * (rnd() - 0.5) * 2));
  const rows = extractFeatures(toK(choppy));
  check('baris fitur lengkap', rows.length > 100 && rows[0].futureMax !== undefined, `got ${rows.length}`);
  check('rsi dalam 0-100', rows.every(r => r.rsi14 >= 0 && r.rsi14 <= 100));

  console.log('\nB) Pola bounce terdeteksi');
  // V-shape berulang: tiap 20 candle jatuh 3% lalu pulih 4% (pola teruji)
  const v: number[] = [];
  let p = 100000;
  for (let i = 0; i < 240; i++) {
    const ph = i % 20;
    p = ph < 5 ? p * 0.994 : p * 1.002;
    v.push(p);
  }
  const rep = evaluateSignals(extractFeatures(toK(v)), 0.01);
  const best = rep[0];
  check('sinyal terbaik presisi uji > 50%', best.testPrecision > 0.5, JSON.stringify(best));
  check('terurut skor', rep.every((r, i, a) => i === 0 || a[i - 1].score >= r.score));

  console.log('\nC) Acak: tak ada yang dipercaya');
  const rnd2 = mulberry32(99);
  const walk: number[] = [100000];
  for (let i = 1; i < 240; i++) walk.push(walk[i - 1] * (1 + (rnd2() - 0.5) * 0.01));
  const repR = evaluateSignals(extractFeatures(toK(walk)), 0.01);
  check('skor terbaik acak rendah (<0.7)', repR[0].score < 0.7, JSON.stringify(repR[0]));

  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
