import fs from 'node:fs';
import path from 'node:path';
import { openCtx } from './lib.js';

// VACUUM INTO produces a consistent, WAL-free copy even while the server is running.
const { ctx, dbPath } = openCtx();
const dir = path.resolve(path.dirname(dbPath), 'backups');
fs.mkdirSync(dir, { recursive: true });
const target = path.join(dir, `brainbyte-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
ctx.db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
ctx.db.close();
console.log(`Backup written to ${target}`);
