import crypto from 'node:crypto';
import { config } from './config.js';

let keyCache: Buffer | null = null;

function getKey(): Buffer {
  if (!keyCache) {
    const secret = config.secretKey || 'insecure_dev_key_change_me________';
    keyCache = crypto.scryptSync(secret, 'trading-botani-salt', 32);
  }
  return keyCache;
}

/** Enkripsi AES-256-GCM → format base64: iv.tag.cipher */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

/** Mask kredensial untuk tampilan: ••••abcd */
export function mask(secret: string | null | undefined): string {
  if (!secret) return '';
  const tail = secret.slice(-4);
  return `••••${tail}`;
}
