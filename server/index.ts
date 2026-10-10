import fs from 'node:fs';
import path from 'node:path';
import { createApp, lanAddresses } from './http/app.js';

function loadDotEnv(file = '.env'): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '');
  }
}

loadDotEnv();
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const dbPath = path.resolve(process.env.DB_PATH ?? './data/brainbyte.db');

const answerMax = Number(process.env.RATE_LIMIT_ANSWER_MAX ?? 12);

const handle = createApp({
  dbPath,
  rateLimits: { answer: { max: answerMax, windowMs: 10_000 } },
  config: {
    port,
    publicUrl: process.env.PUBLIC_URL || null,
    adminSessionHours: Number(process.env.ADMIN_SESSION_HOURS ?? 12),
    cookieSecure: process.env.COOKIE_SECURE === 'true',
  },
});

const hasAdmin = !!handle.ctx.db.get('SELECT 1 FROM admin_users LIMIT 1');
await handle.listen(port, host);

console.log('\n  BRAINBYTE ARENA is running\n');
console.log(`  Admin     : http://localhost:${port}/admin`);
console.log(`  Projector : http://localhost:${port}/display`);
for (const a of lanAddresses()) console.log(`  Teams     : http://${a}:${port}/   (open on phones, same Wi-Fi)`);
console.log(`  Database  : ${dbPath}`);
if (!hasAdmin) console.log('\n  No admin account yet. Create one with:  npm run admin:create -- <username>\n');

let closing = false;
const shutdown = async (sig: string) => {
  if (closing) return;
  closing = true;
  console.log(`\n${sig} received, shutting down...`);
  await handle.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
