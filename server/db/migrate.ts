import type { Db } from './connection.js';
import { MIGRATIONS } from './migrations.js';

export function migrate(db: Db): number[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const done = new Set(db.all<{ id: number }>('SELECT id FROM schema_migrations').map((r) => r.id));
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    db.tx(() => {
      db.exec(m.sql);
      db.run('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)', m.id, m.name, new Date().toISOString());
    });
    applied.push(m.id);
  }
  return applied;
}
