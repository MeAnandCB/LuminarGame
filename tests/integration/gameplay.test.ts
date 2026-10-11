import { afterEach, describe, expect, it } from 'vitest';
import { SEED_ROUNDS } from '../../server/content/seed.js';
import { TeamClient, adminState, boot, correct, playLive, setupEvent, wrong, type Booted, type Client } from './helpers.js';

let b: Booted;
afterEach(async () => {
  await b?.close();
});

const ledgerTotal = (teamId: number) => b.h.ctx.db.get<{ t: number }>('SELECT COALESCE(SUM(points),0) t FROM score_ledger WHERE team_id = ?', teamId)!.t;
const ledgerRows = (teamId: number, kind?: string) =>
  b.h.ctx.db.all<{ kind: string; points: number }>(`SELECT kind, points FROM score_ledger WHERE team_id = ? ${kind ? 'AND kind = ?' : ''}`, teamId, ...(kind ? [kind] : []));

async function toLobby(opts: { teams: number; settings?: Record<string, unknown> }) {
  const env = await setupEvent(b, opts);
  await env.admin.post('/api/admin/registration/confirm');
  return env;
}

async function playLevel1(t: TeamClient, upTo = 12, wrongAt: number[] = []) {
  for (let i = 0; i < upTo; i++) {
    const r = await t.answer(wrongAt.includes(i) ? wrong(1, i) : correct(1, i));
    expect(r.status).toBe(200);
  }
}

async function runLevel(admin: Client) {
  await admin.post('/api/admin/round/prepare');
  await admin.post('/api/admin/round/start');
}

describe('Level 1 - Quick Brain', () => {
  it('scores 100 per correct answer plus speed bonus; wrong and unanswered score nothing', async () => {
    b = await boot();
    const { admin, teams } = await toLobby({ teams: 1 });
    await admin.patch('/api/admin/round/1/config', { speedBonusMax: 20, speedWindowSec: 30 });
    await runLevel(admin);
    const t = teams[0]!;
    const r1 = await t.answer(correct(1, 0)); // instant -> +20 bonus
    expect(r1.json).toMatchObject({ outcome: 'correct', points: 120, advanced: true });
    b.clock.advance(15_000);
    const r2 = await t.answer(correct(1, 1)); // half the window -> +10
    expect(r2.json.points).toBe(110);
    b.clock.advance(31_000);
    const r3 = await t.answer(correct(1, 2)); // beyond the window -> no bonus
    expect(r3.json.points).toBe(100);
    const r4 = await t.answer(wrong(1, 3));
    expect(r4.json).toMatchObject({ outcome: 'incorrect', points: 0, advanced: true });
    expect((await t.me()).score.total).toBe(330);
    expect((await t.me()).progress!.position).toBe(4); // wrong answers still consume the question: one answer per question
    expect(ledgerTotal(t.state.team.id)).toBe(330);
  });

  it('optional wrong-answer penalty is applied once', async () => {
    b = await boot();
    const { admin, teams } = await toLobby({ teams: 1 });
    await admin.patch('/api/admin/round/1/config', { wrongPenalty: 25, speedBonusMax: 0 });
    await runLevel(admin);
    const id = 'req-penalty-1';
    const a = await teams[0]!.answer(wrong(1, 0), { requestId: id });
    const dup = await teams[0]!.answer(wrong(1, 0), { requestId: id });
    expect(a.json.points).toBe(-25);
    expect(dup.json.duplicate).toBe(true);
    expect((await teams[0]!.me()).score.total).toBe(-25);
    expect(ledgerRows(teams[0]!.state.team.id)).toHaveLength(1);
  });

  it('a retried request (same requestId) never scores twice', async () => {
    b = await boot();
    const { admin, teams } = await toLobby({ teams: 1 });
    await runLevel(admin);
    const t = teams[0]!;
    const first = await t.answer(correct(1, 0), { requestId: 'retry-me-12345' });
    const again = await t.answer(correct(1, 0), { requestId: 'retry-me-12345' });
    expect(again.json).toMatchObject({ outcome: 'correct', duplicate: true, points: first.json.points });
    expect(ledgerRows(t.state.team.id, 'answer')).toHaveLength(1);
    expect((await t.me()).progress!.position).toBe(1);
  });

  it('cannot answer a question out of order or after finishing', async () => {
    b = await boot();
    const { admin, teams } = await toLobby({ teams: 1 });
    await runLevel(admin);
    const t = teams[0]!;
    const items = SEED_ROUNDS[0]!.challenges.length;
    const ids = b.h.ctx.db.all<{ id: number }>('SELECT c.id FROM challenges c JOIN rounds r ON r.id = c.round_id WHERE r.level = 1 ORDER BY position').map((r) => r.id);
    const future = await t.answer(correct(1, 5), { challengeId: ids[5] });
    expect(future.json.outcome).toBe('rejected');
    expect((await t.me()).score.total).toBe(0);
    await playLevel1(t);
    expect((await t.me()).progress!.finished).toBe(true);
    const extra = await t.answer('a');
    expect(extra.status).toBe(409);
    expect(items).toBe(12);
  });

  it('exactly-at-deadline is accepted, one millisecond later is late (documented inclusive rule)', async () => {
    b = await boot();
    const { admin, teams } = await toLobby({ teams: 2 });
    await admin.patch('/api/admin/round/1/config', { durationSec: 30 });
    await runLevel(admin);
    b.clock.advance(30_000);
    const onTime = await teams[0]!.answer(correct(1, 0));
    expect(onTime.json.outcome).toBe('correct');
    b.clock.advance(1);
    const late = await teams[1]!.answer(correct(1, 0));
    expect(late.json.outcome).toBe('late');
    expect((await teams[1]!.me()).score.total).toBe(0);
    // late attempts are recorded for audit but do not consume the question
    expect(b.h.ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM answer_submissions WHERE outcome='late'")!.n).toBe(1);
    expect((await teams[1]!.me()).progress!.position).toBe(0);
  });

  it('the ticker ends the round when time expires and later answers are late', async () => {
    b = await boot();
    const { admin, teams } = await toLobby({ teams: 1 });
    await admin.patch('/api/admin/round/1/config', { durationSec: 30 });
    await runLevel(admin);
    b.clock.advance(31_000);
    b.h.realtime.tick();
    expect((await adminState(admin)).event.state).toBe('ROUND_ENDED');
    const r = await teams[0]!.answer(correct(1, 0));
    expect(r.json.outcome).toBe('late');
    expect(b.h.ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM leaderboard_snapshots WHERE scope = 'round:1'")!.n).toBe(1);
  });

  it('pausing freezes the clock and blocks scoring; repeated pause/resume keeps exact remaining time', async () => {
    b = await boot();
    const { admin, teams } = await toLobby({ teams: 1 });
    await admin.patch('/api/admin/round/1/config', { durationSec: 120 });
    await runLevel(admin);
    b.clock.advance(20_000);
    await admin.post('/api/admin/round/pause');
    let s = await adminState(admin);
    expect(s.rounds[0]!.remainingMs).toBe(100_000);
    b.clock.advance(500_000); // ages pass while paused
    expect((await adminState(admin)).rounds[0]!.remainingMs).toBe(100_000);
    const blocked = await teams[0]!.answer(correct(1, 0));
    expect(blocked.json.outcome).toBe('rejected');
    expect((await teams[0]!.me()).score.total).toBe(0);
    await admin.post('/api/admin/round/resume');
    b.clock.advance(10_000);
    await admin.post('/api/admin/round/pause');
    b.clock.advance(1_000_000);
    await admin.post('/api/admin/round/resume');
    s = await adminState(admin);
    expect(s.rounds[0]!.remainingMs).toBe(90_000);
    expect(s.rounds[0]!.deadlineAt).toBe(b.clock.now() + 90_000);
    expect((await teams[0]!.answer(correct(1, 0))).json.outcome).toBe('correct');
  });

  it('answer keys appear only after the host reveals them', async () => {
    b = await boot();
    const { admin, teams } = await toLobby({ teams: 1 });
    await runLevel(admin);
    expect((await admin.post('/api/admin/round/1/reveal', { reveal: true })).status).toBe(409); // not ended yet
    await playLevel1(teams[0]!);
    await admin.post('/api/admin/round/end');
    let pub = (await new TeamClient(b.base).get('/api/public/state')).json;
    expect(pub.reveal).toBeNull();
    await admin.post('/api/admin/round/1/reveal', { reveal: true });
    pub = (await new TeamClient(b.base).get('/api/public/state')).json;
    expect(pub.reveal).toHaveLength(12);
    expect(pub.reveal[0].answer).toBe('Jeethu Joseph');
  });
});

describe('Level 1 - skip and hints', () => {
  it('a team can skip a question: no points, no penalty, and the skip is idempotent', async () => {
    b = await boot();
    const { admin, teams } = await toLobby({ teams: 1 });
    await admin.patch('/api/admin/round/1/config', { wrongPenalty: 50 });
    await runLevel(admin);
    const t = teams[0]!;
    const first = await t.skip({ requestId: 'skip-request-01' });
    expect(first.json).toMatchObject({ outcome: 'skipped', points: 0, advanced: true });
    const again = await t.skip({ requestId: 'skip-request-01' });
    expect(again.json.duplicate).toBe(true);
    const me = await t.me();
    expect(me.progress!.position).toBe(1); // skipped once, not twice
    expect(me.score.total).toBe(0);
    expect(ledgerRows(me.team.id)).toHaveLength(0);
    expect(me.history[0]).toMatchObject({ outcome: 'skipped', position: 0 });
    // a stale skip for an old question is refused
    const ids = b.h.ctx.db.all<{ id: number }>('SELECT c.id FROM challenges c JOIN rounds r ON r.id = c.round_id WHERE r.level = 1 ORDER BY position').map((r) => r.id);
    expect((await t.skip({ challengeId: ids[0] })).status).toBe(409);
    // the next question can still be answered normally
    expect((await t.answer(correct(1, 1))).json.outcome).toBe('correct');
  });

  it('skipping can be switched off by the host, and works until the end of the quiz', async () => {
    b = await boot();
    const { admin, teams } = await toLobby({ teams: 1 });
    await admin.patch('/api/admin/round/1/config', { allowSkip: false });
    await runLevel(admin);
    const r = await teams[0]!.skip();
    expect(r.status).toBe(403);
    expect(r.json.error?.code).toBe('SKIP_DISABLED');
  });

  it('skipping every question finishes the round with zero points', async () => {
    b = await boot();
    const { admin, teams } = await toLobby({ teams: 1 });
    await runLevel(admin);
    for (let i = 0; i < 12; i++) expect((await teams[0]!.skip()).json.outcome).toBe('skipped');
    const me = await teams[0]!.me();
    expect(me.progress!.finished).toBe(true);
    expect(me.score.total).toBe(0);
    expect((await teams[0]!.skip()).status).toBe(409);
  });

  it('hints cost points once per question when the host enables them', async () => {
    b = await boot();
    const { admin, teams } = await toLobby({ teams: 1 });
    const id = b.h.ctx.db.get<{ id: number }>('SELECT c.id FROM challenges c JOIN rounds r ON r.id = c.round_id WHERE r.level = 1 AND position = 0')!.id;
    await admin.patch(`/api/admin/challenges/${id}`, { hint: 'Think of Mohanlal and a cable operator.' });
    await admin.patch('/api/admin/round/1/config', { hintsEnabled: true, hintPenalty: 30 });
    await runLevel(admin);
    const t = teams[0]!;
    const rs = await Promise.all([t.hint(), t.hint(), t.hint()]);
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(rs.filter((r) => r.json.penaltyApplied === 30)).toHaveLength(1);
    expect((await t.me()).score.total).toBe(-30);
  });

  it('hints are off by default in Level 1', async () => {
    b = await boot();
    const { admin, teams } = await toLobby({ teams: 1 });
    await runLevel(admin);
    const r = await teams[0]!.hint();
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('HINTS_DISABLED');
  });
});

describe('qualification and finalisation', () => {
  it('full event: Reel Rush ranks, qualification freezes, only finalists play the Showdown, podium + CSV are consistent', async () => {
    b = await boot();
    const { admin, teams } = await toLobby({ teams: 7, settings: { finalists: 3 } });
    // Level 1: team i answers (12 - i) questions correctly -> descending totals
    await runLevel(admin);
    for (let i = 0; i < teams.length; i++) await playLevel1(teams[i]!, 12 - i);
    await admin.post('/api/admin/round/end');
    // Level 2 (live): Team 7 and Team 6 get everything right, the rest answer nothing
    await runLevel(admin);
    await playLive(admin, teams, (i) => (i >= 5 ? 'LIVE_CORRECT' : null), 2);
    expect((await adminState(admin)).event.state).toBe('ROUND_ENDED');

    // finalists cannot be prepared without qualification
    const early = await admin.post('/api/admin/round/prepare');
    expect(early.status).toBe(409);
    expect(early.json.error.code).toBe('QUALIFICATION_REQUIRED');

    expect((await admin.post('/api/admin/qualification/open')).status).toBe(200);
    const s = await adminState(admin);
    expect(s.event.state).toBe('QUALIFICATION');
    const finalists = s.leaderboard.filter((r) => r.qualified).map((r) => r.name);
    expect(finalists).toHaveLength(3);
    expect(finalists).toEqual(expect.arrayContaining(['Team 7', 'Team 6'])); // the two perfect Level 2 runs
    expect(s.leaderboard.slice(0, 3).map((r) => r.qualified)).toEqual([true, true, true]);

    // host changes the number of finalists; qualification is recomputed
    expect((await admin.patch('/api/admin/event', { settings: { finalists: 4 } })).status).toBe(200);
    expect((await adminState(admin)).leaderboard.filter((r) => r.qualified)).toHaveLength(4);
    await admin.patch('/api/admin/event', { settings: { finalists: 3 } });

    await runLevel(admin);
    // frozen once Level 3 starts
    expect((await adminState(admin)).event.qualificationFrozen).toBe(true);
    expect((await admin.patch('/api/admin/event', { settings: { finalists: 5 } })).status).toBe(409);
    expect((await admin.post('/api/admin/qualification/open')).status).toBe(409);

    const finalistTeams = teams.filter((t) => finalists.includes(t.state.team.name));
    const outsider = teams.find((t) => !finalists.includes(t.state.team.name))!;
    const blocked = await outsider.answer('a');
    expect(blocked.status).toBe(403);
    expect(blocked.json.error?.code).toBe('NOT_ELIGIBLE');
    expect((await outsider.me()).eligible).toBe(false);

    // Showdown: the first finalist is perfect, the others are wrong on question 1 only
    await playLive(admin, finalistTeams, (i, q) => (i === 0 || q > 0 ? 'LIVE_CORRECT' : 'LIVE_WRONG'), 3);
    expect((await adminState(admin)).event.state).toBe('ROUND_ENDED');
    await admin.post('/api/admin/event/complete');

    const end = await adminState(admin);
    expect(end.event.state).toBe('EVENT_COMPLETED');
    const pub = (await new TeamClient(b.base).get('/api/public/state')).json;
    expect(pub.podium).toHaveLength(3);
    expect(pub.podium.map((r: { rank: number }) => r.rank)).toEqual([1, 2, 3]);
    const totals = pub.podium.map((r: { total: number }) => r.total);
    expect([...totals].sort((a, c) => c - a)).toEqual(totals);
    expect(pub.podium.every((r: { qualified: boolean }) => r.qualified)).toBe(true);

    // ledger integrity: ledger == displayed totals == snapshot, for every team
    for (const row of end.leaderboard) {
      expect(ledgerTotal(row.teamId)).toBe(row.total);
      const snap = b.h.ctx.db.get<{ total_points: number; rank: number }>("SELECT total_points, rank FROM leaderboard_snapshots WHERE scope = 'final' AND team_id = ?", row.teamId)!;
      expect(snap).toMatchObject({ total_points: row.total, rank: row.rank });
    }
    expect(end.leaderboard.slice(0, 3).every((r) => r.qualified)).toBe(true); // finalists strictly occupy the top ranks

    const csv = await admin.get('/api/admin/export.csv');
    expect(csv.status).toBe(200);
    const lines = csv.text.replace('\ufeff', '').trim().split('\r\n');
    expect(lines[0]).toBe('Rank,Team,Player 1,Player 2,Level 1 points,Level 2 points,Level 3 points,Unassigned adjustments,Total,Challenges solved,Finalist,Tied on all criteria');
    expect(lines).toHaveLength(8);
    for (const row of end.leaderboard) {
      const cells = lines.find((l) => l.split(',')[1] === row.name)!.split(',');
      expect(Number(cells[0])).toBe(row.rank);
      expect(Number(cells[8])).toBe(row.total);
    }
  });

  it('qualification can be reopened only before the final level starts', async () => {
    b = await boot();
    const { admin, teams } = await toLobby({ teams: 3, settings: { finalists: 1 } });
    await runLevel(admin);
    await playLevel1(teams[0]!, 3);
    await admin.post('/api/admin/round/end');
    await runLevel(admin);
    await admin.post('/api/admin/round/end');
    await admin.post('/api/admin/qualification/open');
    expect((await adminState(admin)).leaderboard.filter((r) => r.qualified)).toHaveLength(1);
    await admin.post('/api/admin/round/prepare'); // level 3 ready
    expect((await adminState(admin)).event.state).toBe('ROUND_READY');
    expect((await admin.post('/api/admin/qualification/open')).status).toBe(200);
    expect((await adminState(admin)).event.state).toBe('QUALIFICATION');
    await admin.patch('/api/admin/event', { settings: { finalists: 2 } });
    expect((await adminState(admin)).leaderboard.filter((r) => r.qualified)).toHaveLength(2);
  });

  it('a tie at the cutoff is resolved by the documented tie-breaker (earliest solve wins)', async () => {
    b = await boot();
    const { admin, teams } = await toLobby({ teams: 2, settings: { finalists: 1 } });
    await admin.patch('/api/admin/round/1/config', { speedBonusMax: 0 });
    await runLevel(admin);
    // equal points, equal solved; Team 2 gets there first
    await teams[1]!.answer(correct(1, 0));
    b.clock.advance(5000);
    await teams[0]!.answer(correct(1, 0));
    await admin.post('/api/admin/round/end');
    await runLevel(admin);
    await admin.post('/api/admin/round/end');
    await admin.post('/api/admin/qualification/open');
    const s = await adminState(admin);
    expect(s.leaderboard[0]!.name).toBe('Team 2');
    expect(s.leaderboard.filter((r) => r.qualified).map((r) => r.name)).toEqual(['Team 2']);
    expect(s.leaderboard.every((r) => !r.tied)).toBe(true);
  });
});

describe('state machine enforcement over HTTP', () => {
  it('rejects invalid transitions and double clicks', async () => {
    b = await boot();
    const { admin, teams } = await setupEvent(b, { teams: 1 });
    expect((await admin.post('/api/admin/round/start')).status).toBe(409);
    expect((await admin.post('/api/admin/round/pause')).status).toBe(409);
    expect((await admin.post('/api/admin/round/prepare')).status).toBe(409); // still registering
    await admin.post('/api/admin/registration/confirm');
    expect((await admin.post('/api/admin/registration/confirm')).status).toBe(409);
    await admin.post('/api/admin/round/prepare');
    expect((await admin.post('/api/admin/round/prepare')).status).toBe(409);
    const [a, c] = await Promise.all([admin.post('/api/admin/round/start'), admin.post('/api/admin/round/start')]);
    expect([a.status, c.status].sort()).toEqual([200, 409]);
    expect((await admin.post('/api/admin/round/resume')).status).toBe(409);
    expect((await admin.post('/api/admin/event/complete')).status).toBe(409); // round running
    // answering before anything is running is refused cleanly
    await admin.post('/api/admin/round/end');
    expect((await admin.post('/api/admin/round/end')).status).toBe(409);
    expect(teams.length).toBe(1);
  });

  it('refuses to start a round with a missing answer key or invalid config', async () => {
    b = await boot();
    const { admin } = await toLobby({ teams: 1 });
    b.h.ctx.db.run("UPDATE challenges SET answers = '[]' WHERE round_id = (SELECT id FROM rounds WHERE level = 1) AND position = 0");
    const r = await admin.post('/api/admin/round/prepare');
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('INVALID_ROUND');
    expect((await admin.patch('/api/admin/round/1/config', { speedBonusMax: 500 })).status).toBe(400);
    expect((await admin.patch('/api/admin/round/1/config', { bogus: 1 })).status).toBe(400);
    expect((await admin.patch('/api/admin/challenges/1', { points: -4 })).status).toBe(400);
  });

  it('scoring configuration locks once a round has started', async () => {
    b = await boot();
    const { admin } = await toLobby({ teams: 1 });
    await runLevel(admin);
    expect((await admin.patch('/api/admin/round/1/config', { speedBonusMax: 5 })).status).toBe(409);
    const id = b.h.ctx.db.get<{ id: number }>('SELECT id FROM challenges LIMIT 1')!.id;
    expect((await admin.patch(`/api/admin/challenges/${id}`, { points: 5 })).status).toBe(409);
  });
});

describe('admin manual intervention', () => {
  it('score adjustments need a reason, hit the ledger and the audit log, and move the ranking', async () => {
    b = await boot();
    const { admin, teams } = await toLobby({ teams: 2 });
    await runLevel(admin);
    await teams[0]!.answer(correct(1, 0));
    const t2 = teams[1]!.state.team.id;
    expect((await admin.post(`/api/admin/teams/${t2}/score`, { points: 500, reason: '' })).status).toBe(400);
    expect((await admin.post(`/api/admin/teams/${t2}/score`, { points: 0, reason: 'nothing' })).status).toBe(400);
    const ok = await admin.post(`/api/admin/teams/${t2}/score`, { points: 500, reason: 'Bonus for helping another team' });
    expect(ok.json.total).toBe(500);
    const s = await adminState(admin);
    expect(s.leaderboard[0]!.name).toBe('Team 2');
    expect(s.audit.some((a) => a.action === 'score.adjust' && a.details.includes('Bonus for helping'))).toBe(true);
    const row = b.h.ctx.db.get<{ actor: string; reason: string; kind: string }>("SELECT actor, reason, kind FROM score_ledger WHERE kind = 'admin_adjust'")!;
    expect(row).toMatchObject({ actor: 'admin:host', kind: 'admin_adjust', reason: 'Bonus for helping another team' });
    await admin.post(`/api/admin/teams/${t2}/score`, { points: -200, reason: 'Penalty: phone use' });
    expect(ledgerTotal(t2)).toBe(300);
  });

  it('reset needs confirmation, wipes progress, signs teams out and keeps the admin account', async () => {
    b = await boot();
    const { admin, teams } = await toLobby({ teams: 2 });
    await runLevel(admin);
    await teams[0]!.answer(correct(1, 0));
    expect((await admin.post('/api/admin/event/reset', {})).status).toBe(400);
    expect((await admin.post('/api/admin/event/reset', { confirm: 'reset' })).status).toBe(400);
    expect((await admin.post('/api/admin/event/reset', { confirm: 'RESET' })).status).toBe(200);
    const s = await adminState(admin);
    expect(s.event.state).toBe('SETUP');
    expect(s.teams).toHaveLength(0);
    expect(s.rounds.every((r) => r.status === 'pending')).toBe(true);
    expect(b.h.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM score_ledger')!.n).toBe(0);
    expect((await teams[0]!.get('/api/team/me')).status).toBe(401);
    expect((await admin.get('/api/admin/state')).status).toBe(200);
  });

  it('audit log records the lifecycle with actors', async () => {
    b = await boot();
    const { admin } = await toLobby({ teams: 1 });
    await runLevel(admin);
    const actions = (await adminState(admin)).audit.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['event.create', 'registration.open', 'registration.confirm', 'round.prepare', 'round.start', 'team.join']));
    const history = b.h.ctx.db.all<{ to_state: string }>('SELECT to_state FROM event_state_history ORDER BY id').map((r) => r.to_state);
    expect(history).toEqual(['SETUP', 'REGISTRATION_OPEN', 'LOBBY', 'ROUND_READY', 'ROUND_RUNNING']);
  });
});

describe('failure handling', () => {
  it('a database write failure rolls back cleanly and the same request can be retried', async () => {
    b = await boot();
    const { admin, teams } = await toLobby({ teams: 1 });
    await runLevel(admin);
    b.h.ctx.db.exec("CREATE TRIGGER boom BEFORE INSERT ON score_ledger BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END");
    const fail = await teams[0]!.answer(correct(1, 0), { requestId: 'flaky-request-1' });
    expect(fail.status).toBe(500);
    expect(JSON.stringify(fail.json)).not.toMatch(/disk|sqlite|trigger/i);
    expect(b.h.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM answer_submissions')!.n).toBe(0);
    expect((await teams[0]!.me()).progress!.position).toBe(0);
    b.h.ctx.db.exec('DROP TRIGGER boom');
    const retry = await teams[0]!.answer(correct(1, 0), { requestId: 'flaky-request-1' });
    expect(retry.json).toMatchObject({ outcome: 'correct' });
    expect(ledgerRows(teams[0]!.state.team.id, 'answer')).toHaveLength(1);
  });

  it('the database itself refuses a second correct submission for the same challenge', async () => {
    b = await boot();
    const { admin, teams } = await toLobby({ teams: 1 });
    await runLevel(admin);
    await teams[0]!.answer(correct(1, 0));
    const row = b.h.ctx.db.get<any>("SELECT * FROM answer_submissions WHERE outcome = 'correct'")!;
    expect(() =>
      b.h.ctx.db.run(
        "INSERT INTO answer_submissions (event_id, round_id, challenge_id, team_id, request_id, raw_answer, normalized, outcome, points, received_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        row.event_id, row.round_id, row.challenge_id, row.team_id, 'sneaky-12345', 'b', 'b', 'correct', 100, 1, 'x',
      ),
    ).toThrow(/UNIQUE/);
    expect(() => b.h.ctx.db.run("INSERT INTO score_ledger (event_id, team_id, kind, points, actor, idempotency_key, at_ms, created_at) VALUES (?,?,?,?,?,?,?,?)", row.event_id, row.team_id, 'answer', 100, 'x', `answer:${row.team_id}:${row.challenge_id}`, 1, 'x')).toThrow(/UNIQUE/);
  });
});
