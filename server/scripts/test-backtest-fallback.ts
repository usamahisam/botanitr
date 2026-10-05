/**
 * E2E fallback adaptif backtest:
 *  A) getLocalKlines memakai data TERBARU (bukan tertua) saat >20.000 baris
 *  B) fetchKlinesChain turun interval bila harian kurang (1d -> 1h)
 *  C) MarketDataError informatif bila semua sumber kosong
 *  D) backtest() jalan di atas data lokal (grid, 55 candle per jam)
 *
 * Jalankan: npx tsx server/scripts/test-backtest-fallback.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.BOTANI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'botani-bt-'));

let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

async function main() {
  const { db } = await import('../src/db/index.js');
  const { getLocalKlines, intervalMs } = await import('../src/engine/history.js');
  const { fetchKlinesChain, MarketDataError, backtest } = await import('../src/engine/wizard.js');
  const { registry } = await import('../src/exchange/registry.js');

  const nowMs = Date.now();

  // ===== A) Data terbaru, bukan tertua =====
  console.log('A) getLocalKlines memakai data terbaru');
  // Seed 21.000 tick: 20.000 lama (harga 100) + 1.000 baru (harga 200)
  const ins = db.prepare(`INSERT OR IGNORE INTO price_history (exchange_id, pair, ts, price) VALUES (?,?,?,?)`);
  const oldBase = nowMs - 25 * 86400000;
  for (let i = 0; i < 20000; i++) ins.run('indodax', 'TSTIDR', oldBase + i * 60000, 100);
  for (let i = 0; i < 1000; i++) ins.run('indodax', 'TSTIDR', nowMs - (1000 - i) * 60000, 200);
  const kl = getLocalKlines('indodax', 'TSTIDR', '1h', 50);
  check('mengembalikan candle', kl.length > 0, `got ${kl.length}`);
  const lastClose = kl[kl.length - 1][4];
  check('candle terakhir dari data BARU (close≈200)', Math.abs(lastClose - 200) < 1, `got ${lastClose}`);
  check('intervalMs 1h benar', intervalMs('1h') === 3600000);

  // ===== B) Chain turun interval =====
  console.log('\nB) fetchKlinesChain fallback adaptif');
  // Seed 60 tick 1 menit (= ~1 jam) untuk pair CHAINIDR: tidak cukup untuk 1d,
  // tapi cukup untuk 1h (1 bucket? tidak — 1 jam = 1 bucket 1h!). Pakai 15m: 4 bucket. Hmm.
  // Skenario realistis: 3.300 tick (±55 jam) → 1h memberi ~55 bucket.
  for (let i = 0; i < 3300; i++) {
    ins.run('indodax', 'CHAINIDR', nowMs - (3300 - i) * 60000, 26000 + Math.sin(i / 20) * 300);
  }
  // Stub client exchange: selalu kembalikan <30 candle (simulasi Indodax)
  const client = registry.get('indodax') as any;
  const origKlines = client.getKlines.bind(client);
  client.getKlines = async () => [[nowMs, 1, 1, 1, 1, 1]];
  try {
    const r = await fetchKlinesChain('indodax', 'CHAINIDR', [
      { interval: '1d', limit: 120 },
      { interval: '1h', limit: 100 }
    ]);
    check('rantai menemukan data di 1h', r.interval === '1h' && r.klines.length >= 30,
      `got ${r.interval} x${r.klines.length}`);
    check('sumber = local', r.source === 'local', `got ${r.source}`);
  } finally {
    client.getKlines = origKlines;
  }

  // ===== C) Error informatif saat kosong =====
  console.log('\nC) MarketDataError informatif');
  client.getKlines = async () => [];
  try {
    await fetchKlinesChain('indodax', 'KOSONGIDR', [
      { interval: '1d', limit: 120 },
      { interval: '1h', limit: 100 }
    ]);
    check('throw saat semua kosong', false);
  } catch (e: any) {
    check('throw MarketDataError', e instanceof MarketDataError, `got ${e?.constructor?.name}`);
    check('pesan menyebut riwayat lokal', /riwayat lokal/i.test(e.message), e.message.slice(0, 80));
  } finally {
    client.getKlines = origKlines;
  }

  // ===== D) backtest di atas data lokal =====
  console.log('\nD) backtest jalan di data lokal');
  const local = getLocalKlines('indodax', 'CHAINIDR', '1h', 100);
  const pseudo: any = {
    id: 'custom', nama: 'Kustom', strategi: 'dca', gaya: '', deskripsi: '',
    params: { drop_pct: 2, take_profit_pct: 3, max_buys: 5 },
    leverage_label: '', tp_sl_label: '', timeframe: '1h'
  };
  const bt = backtest(pseudo, local, 100000);
  check('backtest menghasilkan trades', bt.trades > 0, `got ${bt.trades}`);
  check('equity terisi', bt.equity.length > 0, `got ${bt.equity.length}`);

  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
