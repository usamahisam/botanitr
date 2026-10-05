/**
 * Unit tampilan bot Telegram: menu slash lengkap, escape HTML, format log.
 *
 * Jalankan: npx tsx server/scripts/test-telegram-ui.ts
 */
process.env.BOTANI_DATA_DIR = '/tmp/botani-tgui-' + Date.now();
process.env.SECRET_KEY = 'test-secret-key-minimal-32-chars-abcdef';

let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { console.log(`  ✅ ${n}`); passed++; } else { console.log(`  ❌ ${n} ${d}`); failed++; } };

async function main() {
  const { BOT_COMMANDS, esc, formatLogs } = await import('../src/telegram/bot.js');

  // A) Menu slash: tiap perintah yang didaftarkan handler harus ada di menu
  console.log('A) Menu slash (/)');
  const cmds = BOT_COMMANDS.map((c: any) => c.command);
  for (const need of ['start', 'menu', 'status', 'balance', 'positions', 'bots', 'price', 'pnl', 'pause', 'resume', 'stop', 'logs', 'panic', 'help']) {
    check(`/${need} ada di menu`, cmds.includes(need));
  }
  check('semua entri punya deskripsi', BOT_COMMANDS.every((c: any) => typeof c.description === 'string' && c.description.length > 3));
  check('tanpa duplikat', new Set(cmds).size === cmds.length, cmds.join(','));

  // B) Escape HTML: nama bot jahat tak boleh merusak parse_mode
  console.log('\nB) Escape HTML');
  check('escape <>&', esc('<b>"x"&') === '&lt;b&gt;"x"&amp;', esc('<b>"x"&'));
  check('non-string aman', esc(null) === '' && esc(123) === '123');

  // C) Format log: ringkas, ikon level, escape pesan
  console.log('\nC) Format log');
  const out = formatLogs([
    { created_at: '2026-10-05T10:00:01.000Z', level: 'error', tag: 'T', message: '<hack>' },
    { created_at: '2026-10-05T10:00:02.000Z', level: 'info', tag: 'S', message: 'ok' },
  ]);
  check('penanda [ERR] + [INFO]', out.includes('[ERR]') && out.includes('[INFO]'), out);
  check('pesan di-escape', out.includes('&lt;hack&gt;') && !out.includes('<hack>'));
  check('jam WIB (10 UTC → 17 WIB)', out.includes('17.00.01'), out);

  console.log(`\n═══════════════════════════════`);
  console.log(`HASIL: ${passed} lolos, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
