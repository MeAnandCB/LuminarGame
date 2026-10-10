import { openCtx } from './lib.js';

const { ctx, dbPath } = openCtx();
const rows = ctx.db.all<{ id: number; name: string }>('SELECT id, name FROM schema_migrations ORDER BY id');
console.log(`Database ${dbPath} is up to date. Applied migrations: ${rows.map((r) => `${r.id}:${r.name}`).join(', ')}`);
ctx.db.close();
