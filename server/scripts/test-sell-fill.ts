/**
 * Fill-terkonfirmasi untuk SELL (regresi skenario bot-74):
 *  A) Emit jual TAK mengubah state; applyFill yang membersihkan
 *  B) Sell gagal (tanpa fill) -> posisi utuh -> sinyal diulang (tak yatim)
 *  C) recoverPosition: state kehilangan posisi tapi koin ada -> pulih dari buy terakhir
 *  D) trimSellQty: selisih receh dipangkas, selisih besar ditolak (0)
 *  E) Grid: fill hapus level-nya saja + anchor re-center saat siklus selesai
 *
 * Jalankan: npx tsx server/scripts/test-sell-fill.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.BOTANI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'botani-sellfill-'));
process.env.SECRET_KEY = 'test-secret-key-minimal-32-chars-abcdef';

let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

const klinesUp = (n: number, start: number, step: number) =>
  Array.from({ length: n }, (_, i) => [i, start + i * step, start + i * step + 1, start + i * step - 1, start + i * step, 1]);
const mkCtx = (price: number, extra: any = {}): any => ({
  bot: { id: 1, current_budget: 100000, pair: 'XRPIDR', exchange_id: 'indodax' },
  ticker: { pair: 'XRPIDR', bid: price - 1, ask: price + 1, last: price, high24: price, low24: price, vol24: 0, ts: 1 },
  usdtIdr: 1, now: Date.now(), minLot: 0,
  getKlines: async () => klinesUp(60, 90, 0.5), getBalances: async () => [], getPrice: async () => price, ...extra,
});

async function main() {
  const { db, queries, now } = await import('../src/db/index.js');
  const { getStrategy } = await import('../src/strategies/types.js');
  const { applyFillToState, recoverPosition } = await import('../src/engine/scheduler.js');
  await import('../src/strategies/revert.js');
  await import('../src/strategies/grid.js');
  const revert = getStrategy('revert');
  const grid = getStrategy('grid');

  console.log('A+B) Skenario bot-74: exit di-emit, eksekusi gagal, posisi bertahan');
  const st: any = { position: { entryPrice: 100, qty: 10, cost: 1000 }, candlesTs: 0, candles: [], lastEntryTs: 0 };
  const hotCtx = mkCtx(130, { getKlines: async () => klinesUp(120, 100, 0.5) });
  const acts1 = await revert.onTick(hotCtx, st, { rsi_len: 3, oversold: 20, exit_rsi: 65, tp_pct: 50, sl_pct: 50 });
  const sell1 = acts1.find(a => a.type === 'sell');
  check('sinyal sell teremisi', !!sell1, JSON.stringify(acts1.map(a => a.type)));
  check('posisi TETAP ada setelah emit (belum fill)', st.position !== null, JSON.stringify(st.position));
  // Eksekusi gagal (saldo kurang) -> tanpa applyFill -> tick berikut sinyal diulang
  const acts2 = await revert.onTick(hotCtx, st, { rsi_len: 3, oversold: 20, exit_rsi: 65, tp_pct: 50, sl_pct: 50 });
  check('sinyal diulang (tak yatim)', acts2.some(a => a.type === 'sell'), JSON.stringify(acts2.map(a => a.type)));
  // Eksekusi sukses -> applyFill membersihkan
  applyFillToState('revert', st, { price: 130, qty: 10, value: 1300, fee: 4 }, sell1);
  check('posisi bersih setelah fill', st.position === null);

  console.log('\nC) recoverPosition');
  const botId = queries.insertBot.run({
    user_id: 0, name: 'Rec', exchange_id: 'indodax', pair: 'XRPIDR', strategy: 'revert',
    params: '{}', budget_idr: 100000, current_budget: 100000, lot: 100000, mode: 'paper',
    auto_compound_pct: 100, status: 'paused', state: '{}', max_daily_loss_pct: 0,
    market_preset_id: null, created_at: now(), updated_at: now(),
  }).lastInsertRowid as number;
  db.prepare(`INSERT INTO trades (user_id, bot_id, exchange_id, pair, side, price, qty, fee, value, realized_pnl, cost_basis, mode, created_at)
    VALUES (0, ?, 'indodax','XRPIDR','buy',100,10,30,1000,0,1000,'paper',?)`).run(botId, now());
  const lost: any = { position: null, candlesTs: 0, candles: [], lastEntryTs: 0 };
  const rec = await recoverPosition({ id: botId } as any, lost, async () => 9.5);
  check('posisi pulih dari buy terakhir (dibatasi saldo)', rec === true && lost.position.qty === 9.5 && lost.position.entryPrice === 100, JSON.stringify(lost.position));
  const noRec = await recoverPosition({ id: botId } as any, { position: null }, async () => 0);
  check('saldo nol -> tak pulih', noRec === false);
  // Skenario over-recovery VPS: sell sukses lalu balance lag -> JANGAN bangkitkan
  db.prepare(`INSERT INTO trades (user_id, bot_id, exchange_id, pair, side, price, qty, fee, value, realized_pnl, cost_basis, mode, created_at)
    VALUES (0, ?, 'indodax','XRPIDR','sell',110,9.5,0,1045,45,1000,'paper',?)`).run(botId, now());
  const ghost: any = { position: null };
  check('trade terakhir sell -> tak pulih (balance lag)', (await recoverPosition({ id: botId } as any, ghost, async () => 9.5)) === false && ghost.position === null);

  console.log('\nD) trimSellQty');
  const { trimSellQty } = await import('../src/engine/trader.js');
  const fakeBot: any = { id: 1, user_id: 0, exchange_id: 'indodax', pair: 'XRPIDR', mode: 'paper' };
  db.prepare(`INSERT INTO paper_balances (exchange_id, asset, free, locked, user_id) VALUES ('indodax','XRP',9.95,0,0)`).run();
  const trimmed = await trimSellQty(fakeBot, 10, true);
  check('selisih 0,5% dipangkas ke saldo', Math.abs(trimmed - 9.95) < 1e-9, `got ${trimmed}`);
  db.prepare(`UPDATE paper_balances SET free=5 WHERE exchange_id='indodax' AND asset='XRP' AND user_id=0`).run();
  check('selisih besar ditolak (0)', (await trimSellQty(fakeBot, 10, true)) === 0);

  console.log('\nE) Grid fill hapus level-nya + re-center');
  const gs: any = { anchor: 100, filledBuys: [{ price: 98, qty: 1, cost: 98, level: 1 }, { price: 96, qty: 1, cost: 96, level: 0 }], levelsHit: [0, 1] };
  applyFillToState('grid', gs, { price: 101, qty: 1, value: 101, fee: 0 }, { type: 'sell', meta: { level: 1 } });
  check('level 1 hilang, level 0 bertahan', gs.filledBuys.length === 1 && gs.levelsHit.length === 1 && gs.levelsHit[0] === 0, JSON.stringify(gs));
  applyFillToState('grid', gs, { price: 102, qty: 1, value: 102, fee: 0 }, { type: 'sell', meta: { level: 0 } });
  check('anchor re-center saat siklus selesai', gs.filledBuys.length === 0 && gs.anchor === 102, `anchor=${gs.anchor}`);

  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
