import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Db } from '../server/db/connection.js';
import { migrate } from '../server/db/migrate.js';
import { Ctx, systemClock } from '../server/engine/context.js';

export function loadDotEnv(file = '.env'): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '');
  }
}

export function openCtx(): { ctx: Ctx; dbPath: string } {
  loadDotEnv();
  const dbPath = path.resolve(process.env.DB_PATH ?? './data/brainbyte.db');
  const db = new Db(dbPath);
  migrate(db);
  const ctx = new Ctx(db, systemClock, { nodeEnv: 'production', publicUrl: null, adminSessionHours: 12, cookieSecure: false, port: 3000 });
  return { ctx, dbPath };
}

/** Reads a password without echoing it (falls back to ADMIN_PASSWORD for non-interactive use). */
export async function askPassword(prompt: string): Promise<string> {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (!process.stdin.isTTY) throw new Error('No TTY available. Set ADMIN_PASSWORD in the environment.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    const w = (rl as unknown as { _writeToOutput: (s: string) => void });
    process.stdout.write(prompt);
    w._writeToOutput = () => undefined;
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}
