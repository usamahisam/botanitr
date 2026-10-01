import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { Server as SocketIOServer } from 'socket.io';
import { config, validateConfig } from './config.js';
import { registry } from './exchange/registry.js';
import { api, apiErrorHandler } from './routes/api.js';
import { setBroadcaster, log } from './log.js';
import { startScheduler, stopScheduler } from './engine/scheduler.js';
import { startBalanceSync, stopBalanceSync } from './engine/balances.js';
import { startTelegram, stopTelegram } from './telegram/bot.js';

async function main() {
  // Validasi config
  for (const w of validateConfig()) log('warn', 'SYSTEM', w);

  // Terapkan kredensial + proxy dari DB
  registry.reloadFromDb();

  // Express + Socket.IO
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api', api);
  app.use(apiErrorHandler);

  // Serve frontend build jika ada
  if (fs.existsSync(config.webDist)) {
    app.use(express.static(config.webDist));
    app.get('*', (_req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
  }

  const server = http.createServer(app);
  const io = new SocketIOServer(server, { cors: { origin: '*' } });

  // Broadcaster → WS
  const broadcast = (event: string, payload: any) => io.emit(event, payload);
  setBroadcaster(broadcast);

  io.on('connection', socket => {
    socket.emit('connected', { time: new Date().toISOString() });
  });

  // Jalankan engine
  startScheduler(broadcast);
  startBalanceSync(views => broadcast('balances', views));
  startTelegram();

  server.listen(config.port, config.host, () => {
    log('info', 'SYSTEM', `Server berjalan di http://${config.host}:${config.port}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    log('info', 'SYSTEM', 'Mematikan server...');
    stopScheduler();
    stopBalanceSync();
    stopTelegram();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
