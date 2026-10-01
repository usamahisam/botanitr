import { db, queries, now } from './db/index.js';

type Level = 'info' | 'warn' | 'error';
export type LogTag =
  | 'SYSTEM' | 'ENGINE' | 'TRADE' | 'ERROR'
  | 'GRID_UNWIND' | 'DCA_TP' | 'SCALPER_TP' | 'SCALPER_SL' | 'SCALPER_EXIT'
  | 'INVENTORY_HARVEST_RECYCLE' | 'AUTO_COMPOUND' | 'TELEGRAM' | 'SYNC';

type Broadcaster = (event: string, payload: any) => void;
let broadcast: Broadcaster = () => {};
export function setBroadcaster(fn: Broadcaster) { broadcast = fn; }

export function log(level: Level, tag: LogTag, message: string, opts: { bot_id?: number; impact_rp?: number; meta?: any } = {}) {
  const created_at = now();
  const info = queries.insertLog.run(level, tag, opts.bot_id ?? null, message, opts.impact_rp ?? null, opts.meta ? JSON.stringify(opts.meta) : null, created_at);
  const row = { id: Number(info.lastInsertRowid), level, tag, bot_id: opts.bot_id ?? null, message, impact_rp: opts.impact_rp ?? null, created_at };
  const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
  console.log(`${prefix} [${tag}] ${message}`);
  broadcast('log', row);
  return row;
}
