import { describe, expect, it } from 'vitest';
import { Db } from '../../server/db/connection.js';
import { migrate } from '../../server/db/migrate.js';
import { MIGRATIONS } from '../../server/db/migrations.js';

describe('database migrations', () => {
  it('upgrades a database created by version 1 without losing data', () => {
    const db = new Db(':memory:');
    // Recreate the version-1 database exactly as an older install would have it, with data in it.
    db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
    db.exec(MIGRATIONS[0]!.sql);
    db.run("INSERT INTO schema_migrations VALUES (1, 'init', 'x')");
    db.run("INSERT INTO events (id, name, pin, state, settings, created_at, updated_at) VALUES (1, 'Old event', '123456', 'ROUND_ENDED', '{}', 'x', 'x')");
    db.run("INSERT INTO rounds (id, event_id, level, name, kind, config, instructions, status) VALUES (1, 1, 1, 'Quiz', 'quiz', '{}', 'i', 'ended')");
    db.run("INSERT INTO challenges (id, round_id, position, kind, title, prompt, answers, points) VALUES (1, 1, 0, 'text', 't', 'p', '[\"x\"]', 100)");
    db.run("INSERT INTO teams (id, event_id, name, name_key, player1, player2, team_code, status, created_at) VALUES (1, 1, 'Old Team', 'old team', 'a', 'b', 'ABC123', 'approved', 'x')");
    db.run("INSERT INTO answer_submissions (event_id, round_id, challenge_id, team_id, request_id, raw_answer, normalized, outcome, points, received_at, created_at) VALUES (1,1,1,1,'req-12345','x','X','correct',100,1,'x')");
    db.run("INSERT INTO score_ledger (event_id, team_id, round_id, challenge_id, kind, points, actor, idempotency_key, at_ms, created_at) VALUES (1,1,1,1,'answer',100,'team:1','answer:1:1',5,'x')");

    expect(migrate(db)).toEqual(MIGRATIONS.slice(1).map((m) => m.id));

    expect(db.get<{ n: number }>('SELECT COUNT(*) n FROM events')!.n).toBe(1);
    expect(db.get<{ points: number }>('SELECT points FROM score_ledger')!.points).toBe(100);
    expect(db.get<{ outcome: string; double_down: number }>('SELECT outcome, double_down FROM answer_submissions')).toMatchObject({ outcome: 'correct', double_down: 0 });
    expect(db.get<{ live_phase: string | null }>('SELECT live_phase FROM rounds')!.live_phase).toBeNull();
    // new capabilities exist
    db.run("INSERT INTO score_ledger (event_id, team_id, kind, points, actor, idempotency_key, at_ms, created_at) VALUES (1,1,'steal',75,'system','k',6,'x')");
    db.run("INSERT INTO rounds (id, event_id, level, name, kind, config, instructions) VALUES (2, 1, 2, 'Live', 'lightning', '{}', 'i')");
    expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
    expect(db.get<{ foreign_keys: number }>('PRAGMA foreign_keys')!.foreign_keys).toBe(1);
    // uniqueness guarantees survived the table rebuilds
    expect(() => db.run("INSERT INTO score_ledger (event_id, team_id, kind, points, actor, idempotency_key, at_ms, created_at) VALUES (1,1,'answer',1,'x','answer:1:1',7,'x')")).toThrow(/UNIQUE/);
    expect(() => db.run("INSERT INTO answer_submissions (event_id, round_id, challenge_id, team_id, request_id, raw_answer, normalized, outcome, points, received_at, created_at) VALUES (1,1,1,1,'req-other','x','X','correct',100,1,'x')")).toThrow(/UNIQUE/);
    // running again is a no-op
    expect(migrate(db)).toEqual([]);
  });

  it('refuses to start a round that was built by the older puzzle version', async () => {
    const { boot, setupEvent } = await import('./helpers.js');
    const b = await boot();
    try {
      const { admin } = await setupEvent(b, { teams: 1 });
      await admin.post('/api/admin/registration/confirm');
      b.h.ctx.db.run("UPDATE rounds SET kind = 'puzzle' WHERE level = 1");
      const r = await admin.post('/api/admin/round/prepare');
      expect(r.status).toBe(409);
      expect(r.json.error.message).toMatch(/older version/);
    } finally {
      await b.close();
    }
  });
});
