import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { Server as SocketIOServer } from 'socket.io';
import { config, validateConfig } from './config.js';
import { registry } from './exchange/registry.js';
import { api, apiErrorHandler } from './routes/api.js';
import { authRouter } from './routes/auth.js';
import { requireAuth, verifyToken } from './auth.js';
import { setBroadcaster, log } from './log.js';
import { startScheduler, stopScheduler } from './engine/scheduler.js';
import { startBalanceSync, stopBalanceSync } from './engine/balances.js';
import { startTelegram, stopTelegram } from './telegram/bot.js';
import { startReconciler, stopReconciler } from './engine/reconciler.js';
import { startEquityRecorder, stopEquityRecorder } from './engine/equity.js';
import { startAlertEngine, stopAlertEngine } from './engine/alerts.js';
import { startHistoryRecorder, stopHistoryRecorder } from './engine/history.js';

async function main() {
  // Validasi config
  for (const w of validateConfig()) log('warn', 'SYSTEM', w);

  // Terapkan kredensial + proxy dari DB
  registry.reloadFromDb();

  // Express + Socket.IO
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api', authRouter);
  app.use('/api', requireAuth, api);
  app.use(apiErrorHandler);

  // Serve frontend build jika ada
  if (fs.existsSync(config.webDist)) {
    app.use(express.static(config.webDist));
    app.get('*', (_req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
  }

  const server = http.createServer(app);
  const io = new SocketIOServer(server, { cors: { origin: '*' } });

  // Socket auth: token JWT → gabung room user-N (isolasi data antar user)
  io.use((socket, next) => {
    const token = (socket.handshake.auth as any)?.token;
    const user = token ? verifyToken(String(token)) : null;
    if (!user) return next(new Error('unauthorized'));
    socket.data.userId = user.id;
    next();
  });

  // Broadcaster → room user (tidak bocor antar akun)
  const broadcast = (event: string, payload: any, userId?: number) => {
    if (userId === undefined) io.emit(event, payload);
    else io.to(`user-${userId}`).emit(event, payload);
  };
  setBroadcaster(broadcast);

  io.on('connection', socket => {
    socket.join(`user-${socket.data.userId}`);
    socket.emit('connected', { time: new Date().toISOString() });
  });

  // Jalankan engine
  startScheduler(broadcast);
  startBalanceSync((views, userId) => broadcast('balances', views, userId));
  startTelegram();
  startReconciler();
  startEquityRecorder();
  startAlertEngine();
  startHistoryRecorder();

  server.listen(config.port, config.host, () => {
    log('info', 'SYSTEM', `Server berjalan di http://${config.host}:${config.port}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    log('info', 'SYSTEM', 'Mematikan server...');
    stopScheduler();
    stopBalanceSync();
    stopTelegram();
    stopReconciler();
    stopEquityRecorder();
    stopAlertEngine();
    stopHistoryRecorder();
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

// Jaring pengaman terakhir: catat rejection tak tertangani ke DB + konsol
// agar tak hilang diam-diam (proses tetap hidup; crash fatal tetap exit via handler di atas).
process.on('unhandledRejection', (reason: any) => {
  const msg = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
  try {
    log('error', 'ERROR', `Unhandled rejection: ${msg.slice(0, 300)}`);
  } catch { /* DB belum siap */ }
  console.error('Unhandled rejection:', msg);
});
