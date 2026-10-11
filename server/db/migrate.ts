import type { Db } from './connection.js';
import { MIGRATIONS } from './migrations.js';

export function migrate(db: Db): number[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const done = new Set(db.all<{ id: number }>('SELECT id FROM schema_migrations').map((r) => r.id));
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    const run = () =>
      db.tx(() => {
        db.exec(m.sql);
        if (m.foreignKeysOff) {
          const broken = db.all('PRAGMA foreign_key_check');
          if (broken.length) throw new Error(`Migration ${m.id} would break foreign keys`);
        }
        db.run('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)', m.id, m.name, new Date().toISOString());
      });
    if (m.foreignKeysOff) {
      db.exec('PRAGMA foreign_keys = OFF');
      try {
        run();
      } finally {
        db.exec('PRAGMA foreign_keys = ON');
      }
    } else {
      run();
    }
    applied.push(m.id);
  }
  return applied;
}
