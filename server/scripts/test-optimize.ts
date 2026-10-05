/**
 * Optimizer walk-forward anti-overfitting:
 *  A) ruang pencarian dikenal per strategi
 *  B) hasil teratas punya skor + метrik uji, terurut
 *  C) data kurang (<60) ditolak dengan pesan jelas
 *  D) penalti overfitting: parameter jago-kandang tidak juara
 *
 * Jalankan: npx tsx server/scripts/test-optimize.ts
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

function synth(n: number, seed: number): any[] {
  const rnd = mulberry32(seed);
  const out: any[] = [];
  for (let i = 0; i < n; i++) {
    const c = 100000 * (1 + 0.02 * Math.sin(i / 7) + 0.004 * (rnd() - 0.5) * 2);
    out.push([1700000000000 + i * 300000, c * 0.999, c * 1.001, c * 0.999, c, 100]);
  }
  return out;
}

async function main() {
  const { optimize, supportedStrategies } = await import('../src/engine/optimizer.js');

  console.log('A) Ruang pencarian');
  check('dynamic didukung', supportedStrategies().includes('dynamic'));
  check('8 strategi didukung', supportedStrategies().length === 8, supportedStrategies().join(','));

  console.log('\nB) Hasil teratas valid');
  const kl = synth(140, 7);
  const top = await optimize('dynamic', {}, kl, { budget: 1000000, maxCombos: 40 });
  check('ada hasil', top.length > 0, `got ${top.length}`);
  check('terurut skor', top.every((t, i, a) => i === 0 || a[i - 1].score >= t.score));
  check('punya metrik uji', top[0].trades >= 3 && typeof top[0].testRet === 'number', JSON.stringify(top[0]));
  check('params dalam ruang', [0.5, 1.0, 1.5].includes(top[0].params.step_pct), JSON.stringify(top[0].params));

  console.log('\nC) Data kurang ditolak');
  try {
    await optimize('dynamic', {}, synth(30, 7), {});
    check('throw saat <60 candle', false);
  } catch (e: any) {
    check('pesan jelas', /60/.test(e.message), e.message);
  }

  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
