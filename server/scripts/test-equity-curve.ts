/**
 * Kurva equity hidup (bukan 2 titik statis):
 *  A) upsert per slot jam — tulis 2x slot sama = 1 baris terupdate
 *  B) multi-slot terurut + titik awal budget + titik live
 *  C) prune >45 hari
 *
 * Jalankan: npx tsx server/scripts/test-equity-curve.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.BOTANI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'botani-equity-'));
process.env.SECRET_KEY = 'test-secret-key-minimal-32-chars-abcdef';

let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

async function main() {
  const { db, queries, now } = await import('../src/db/index.js');
  const { recordEquityPoint, recordDailyEquity, getEquityCurve, hourSlotWib } = await import('../src/engine/equity.js');

  const botId = queries.insertBot.run({
    user_id: 0, name: 'EQ', exchange_id: 'indodax', pair: 'XRPIDR', strategy: 'grid',
    params: '{}', budget_idr: 1000000, current_budget: 1000000, lot: 100000, mode: 'paper',
    auto_compound_pct: 100, status: 'running', state: '{}', max_daily_loss_pct: 0,
    market_preset_id: null, created_at: now(), updated_at: now(),
  }).lastInsertRowid as number;

  // Slot realistis: jam-jam terakhir (setelah bot dibuat)
  const H = 3600000;
  const s0 = hourSlotWib(Date.now() - 3 * H);
  const s1 = hourSlotWib(Date.now() - 2 * H);
  const s2 = hourSlotWib(Date.now() - 1 * H);

  console.log('A) Upsert per slot');
  recordEquityPoint(botId, 1000000, s0);
  recordEquityPoint(botId, 1005000, s0);
  const n1 = (db.prepare('SELECT COUNT(*) c FROM bot_equity WHERE bot_id=?').get(botId) as any).c;
  const v1 = (db.prepare('SELECT equity_quote e FROM bot_equity WHERE bot_id=? AND date=?').get(botId, s0) as any).e;
  check('slot sama = 1 baris terupdate', n1 === 1 && v1 === 1005000, `got ${n1} baris, ${v1}`);

  console.log('\nB) Kurva multi-slot + live');
  recordEquityPoint(botId, 1010000, s1);
  recordEquityPoint(botId, 990000, s2);
  const curve = await getEquityCurve(botId, 30);
  check('titik awal = budget', curve[0].equity === 1000000 && curve[0].date.length === 10, JSON.stringify(curve[0]));
  check('urutan kronologis', curve.every((p, i, a) => i === 0 || a[i - 1].date <= p.date), curve.map(p => p.date).join(','));
  check('lebih dari 2 titik historis', curve.length >= 4, `got ${curve.length}`);
  check('ada slot jam', curve.some(p => p.date.length === 13), curve.map(p => p.date).join(','));

  console.log('\nC) Prune retensi');
  recordEquityPoint(botId, 5, '2020-01-01T00');
  await recordDailyEquity();
  const oldLeft = (db.prepare(`SELECT COUNT(*) c FROM bot_equity WHERE date='2020-01-01T00'`).get() as any).c;
  check('slot 2020 terprune', oldLeft === 0, `got ${oldLeft}`);
  const slotNow = hourSlotWib();
  const hasNow = (db.prepare('SELECT COUNT(*) c FROM bot_equity WHERE bot_id=? AND date=?').get(botId, slotNow) as any).c;
  check('slot jam ini terekam', hasNow === 1, `slot ${slotNow}`);

  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
