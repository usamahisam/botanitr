import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '127.0.0.1',
  secretKey: process.env.SECRET_KEY || '',
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramAllowedChats: (process.env.TELEGRAM_ALLOWED_CHAT_IDS || '')
    .split(',').map(s => s.trim()).filter(Boolean),
  defaultProxy: process.env.DEFAULT_PROXY || '',
  defaultPaperMode: (process.env.DEFAULT_PAPER_MODE || 'true') === 'true',
  dataDir: path.resolve(__dirname, '../data'),
  webDist: path.resolve(__dirname, '../../web/dist'),
  tokocryptoBaseUrl: process.env.TOKOCRYPTO_BASE_URL || 'https://www.tokocrypto.com',
  indodaxBaseUrl: process.env.INDODAX_BASE_URL || 'https://indodax.com'
};

export function validateConfig(): string[] {
  const warnings: string[] = [];
  if (!config.secretKey || config.secretKey.length < 32) {
    warnings.push('SECRET_KEY kosong atau < 32 karakter. Enkripsi API keys TIDAK aman. Isi di .env!');
  }
  return warnings;
}
