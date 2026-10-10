// Starts a throwaway production server for the Playwright suite (fresh database each run).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const db = path.resolve('data/e2e.db');
for (const f of [db, `${db}-wal`, `${db}-shm`]) fs.rmSync(f, { force: true });
const env = { ...process.env, DB_PATH: db, PORT: '3100', ADMIN_PASSWORD: 'e2e-admin-password', RATE_LIMIT_ANSWER_MAX: '1000' };

const made = spawnSync(process.execPath, ['dist/server/scripts/admin.js', 'create', 'e2eadmin'], { env, stdio: 'inherit' });
if (made.status !== 0) process.exit(made.status ?? 1);

const server = spawn(process.execPath, ['dist/server/server/index.js'], { env, stdio: 'inherit' });
process.on('SIGTERM', () => server.kill());
process.on('SIGINT', () => server.kill());
server.on('exit', (c) => process.exit(c ?? 0));
