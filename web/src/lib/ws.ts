import { io, Socket } from 'socket.io-client';
import { getToken } from './api';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({ path: '/socket.io', auth: { token: getToken() } });
  }
  return socket;
}

/** Putuskan & buat ulang koneksi (dipakai setelah login/logout) */
export function resetSocket() {
  if (socket) { socket.disconnect(); socket = null; }
}
