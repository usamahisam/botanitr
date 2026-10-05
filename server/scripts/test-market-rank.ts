/**
 * Peringkat strategi mengikuti koin + grafiknya:
 *  A) Uptrend kuat -> momentum (breakout/scalper/revert/dynamic) di atas, grid bukan #1
 *  B) Downtrend kuat -> akumulasi (harvester/dca/grid) di atas, breakout bukan #1
 *  C) Sideways berosilasi -> range (grid/bollinger/dynamic) di atas
 *  D) Label market terbawa (arah + gerak + data)
 *
 * Jalankan: npx tsx server/scripts/test-market-rank.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.BOTANI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'botani-rank-'));
process.env.SECRET_KEY = 'test-secret-key-minimal-32-chars-abcdef';

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

/** Klines sintetik: tren linear + osilasi + noise */
function synth(n: number, trend: number, wave: number, seed: number): any[] {
  const rnd = mulberry32(seed);
  const out: any[] = [];
  for (let i = 0; i < n; i++) {
    const c = 100 * (1 + trend * i) * (1 + wave * Math.sin(i / 7) + 0.002 * (rnd() - 0.5) * 2);
    out.push([1700000000000 + i * 86400000, c * 0.999, c * 1.001, c * 0.999, c, 100]);
  }
  return out;
}

async function main() {
  await import('../src/db/index.js');
  const { registry } = await import('../src/exchange/registry.js');
  const { recommend, detectMarketRegime } = await import('../src/engine/wizard.js');
  const pub: any = registry.get('indodax');
  const orig = pub.getKlines.bind(pub);

  console.log('A) Rezim terdeteksi benar');
  check('uptrend +8% -> naik-kuat', detectMarketRegime(synth(150, 0.0006, 0.005, 1)).key === 'naik-kuat');
  check('downtrend -8% -> turun-kuat', detectMarketRegime(synth(150, -0.0006, 0.005, 2)).key === 'turun-kuat');
  check('flat total -> sideways/sepi', ['sideways'].includes(detectMarketRegime(synth(150, 0, 0.0005, 3)).key));

  console.log('\nB) Uptrend -> momentum di atas');
  pub.getKlines = async () => synth(150, 0.0006, 0.008, 11);
  try {
    const recs = await recommend('indodax', 'UPIDR', 100000);
    const top3 = recs.slice(0, 3).map(r => r.strategi);
    check('top-3 ada breakout/scalper', top3.includes('breakout') || top3.includes('scalper'), top3.join(','));
    check('grid bukan #1 saat uptrend kuat', recs[0].strategi !== 'grid', `#1=${recs[0].strategi}`);
    check('label market naik', /uptrend/i.test(recs[0].market.label), recs[0].market.label);
  } finally { pub.getKlines = orig; }

  console.log('\nC) Downtrend -> akumulasi di atas');
  pub.getKlines = async () => synth(150, -0.0006, 0.008, 22);
  try {
    const recs = await recommend('indodax', 'DOWNIDR', 100000);
    const top3 = recs.slice(0, 3).map(r => r.strategi);
    check('top-3 ada harvester/dca/grid', top3.includes('harvester') || top3.includes('dca') || top3.includes('grid'), top3.join(','));
    check('breakout bukan #1 saat turun kuat', recs[0].strategi !== 'breakout', `#1=${recs[0].strategi}`);
    check('label market turun', /downtrend/i.test(recs[0].market.label), recs[0].market.label);
  } finally { pub.getKlines = orig; }

  console.log('\nD) Sideways -> range di atas');
  pub.getKlines = async () => synth(150, 0, 0.02, 33);
  try {
    const recs = await recommend('indodax', 'FLATIDR', 100000);
    const top3 = recs.slice(0, 3).map(r => r.strategi);
    check('top-3 ada grid/bollinger/dynamic', top3.includes('grid') || top3.includes('bollinger') || top3.includes('dynamic'), top3.join(','));
    check('breakout bukan #1 saat sideways', recs[0].strategi !== 'breakout', `#1=${recs[0].strategi}`);
  } finally { pub.getKlines = orig; }

  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
