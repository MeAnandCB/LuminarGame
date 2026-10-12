import { afterEach, describe, expect, it } from 'vitest';
import { SEED_ROUNDS } from '../../server/content/seed.js';
import { BINGO_LINES, completedLines } from '../../server/game/bingo.js';
import { TeamClient, adminState, boot, correct, playLive, setupEvent, wrong, type Booted, type Client } from './helpers.js';

let b: Booted;
afterEach(async () => {
  await b?.close();
});

const pub = async () => (await new TeamClient(b.base).get('/api/public/state')).json;
const ledger = (teamId: number, kind?: string) => b.h.ctx.db.all<{ kind: string; points: number }>(`SELECT kind, points FROM score_ledger WHERE team_id = ? ${kind ? 'AND kind = ?' : ''} ORDER BY id`, teamId, ...(kind ? [kind] : []));
const total = (teamId: number) => b.h.ctx.db.get<{ t: number }>('SELECT COALESCE(SUM(points),0) t FROM score_ledger WHERE team_id = ?', teamId)!.t;

async function startRound(n: number, settings?: Record<string, unknown>) {
  const env = await setupEvent(b, { teams: n, settings });
  await env.admin.post('/api/admin/registration/confirm');
  await env.admin.post('/api/admin/round/prepare');
  await env.admin.post('/api/admin/round/start');
  return env;
}
async function startBingo(n: number) {
  const env = await startRound(n);
  await env.admin.post('/api/admin/round/end'); // Level 1 (faces): nobody answers
  await env.admin.post('/api/admin/round/prepare');
  await env.admin.post('/api/admin/round/start');
  return env;
}
const liveIdx = async (admin: Client) => {
  const s = await adminState(admin);
  return s.rounds.find((r) => r.id === s.event.currentRoundId)!.liveIndex;
};

describe('Level 1 - Tech Faces', () => {
  it('shows the picture to everyone, scores like a live round and reveals a fact afterwards', async () => {
    b = await boot();
    const { admin, teams } = await startRound(3);
    const p = await pub();
    expect(p.round).toMatchObject({ kind: 'faces', status: 'running', level: 1 });
    expect(p.live).toMatchObject({ phase: 'open', index: 0, total: 10, image: '/faces/01', bingo: null });
    expect(p.live.options).toHaveLength(4);
    expect(JSON.stringify(p)).not.toMatch(/"answers"|Steve Jobs.*"correct"/);
    expect(p.live.reveal).toBeNull();

    expect((await teams[0]!.answer(correct(1, 0))).json.outcome).toBe('locked');
    expect((await teams[1]!.answer(wrong(1, 0))).json.outcome).toBe('locked');
    await admin.post('/api/admin/round/live/advance');
    const rev = (await pub()).live;
    expect(rev.phase).toBe('reveal');
    expect(rev.reveal).toMatchObject({ correctText: 'Steve Jobs', answered: 2, correctCount: 1 });
    expect(rev.reveal.fact).toMatch(/Apple/);
    // base 100 + full speed 50 + fastest finger 30
    expect(total(teams[0]!.state.team.id)).toBe(180);
    expect(total(teams[1]!.state.team.id)).toBe(0);
    expect((await teams[0]!.me()).live).toMatchObject({ bingo: null, doubleAvailable: false, lives: null });
  });

  it('a streak of correct answers adds a bonus on the third question onwards', async () => {
    b = await boot();
    const { admin, teams } = await startRound(1);
    await playLive(admin, teams, () => 'LIVE_CORRECT', 1);
    const bonus = ledger(teams[0]!.state.team.id, 'streak_bonus').map((r) => r.points);
    expect(bonus).toEqual([20, 40, 60, 60, 60, 60, 60, 60, 60]); // 1..3 steps then capped at 3
    expect((await adminState(admin)).event.state).toBe('ROUND_ENDED');
  });

  it('refuses to start without pictures configured', async () => {
    b = await boot();
    const { admin } = await setupEvent(b, { teams: 1 });
    await admin.post('/api/admin/registration/confirm');
    b.h.ctx.db.run("UPDATE challenges SET image = NULL WHERE round_id = (SELECT id FROM rounds WHERE level = 1) AND position = 3");
    const r = await admin.post('/api/admin/round/prepare');
    expect(r.status).toBe(409);
    expect(r.json.error.message).toMatch(/no picture/);
  });
});

describe('ending a live round early', () => {
  it('scores the question that was still open instead of dropping the locked-in answers', async () => {
    b = await boot();
    const { admin, teams } = await startRound(2);
    await teams[0]!.answer(correct(1, 0));
    await teams[1]!.answer(wrong(1, 0)); // both locked in -> closes by itself; use a third question state instead
    await admin.post('/api/admin/round/live/advance'); // leave reveal -> question 2 open
    await teams[0]!.answer(correct(1, 1)); // open, not yet resolved
    const before = total(teams[0]!.state.team.id);
    expect((await admin.post('/api/admin/round/end')).status).toBe(200);
    expect(total(teams[0]!.state.team.id)).toBeGreaterThan(before);
    expect(ledger(teams[0]!.state.team.id, 'answer')).toHaveLength(2);
  });
});

describe('Level 2 - Tech Bingo', () => {
  it('gives each team its own shuffled 4x4 card; nothing is marked until the reveal', async () => {
    b = await boot();
    const { admin, teams } = await startBingo(3);
    const p = await pub();
    expect(p.round).toMatchObject({ kind: 'bingo', level: 2 });
    expect(p.live.bingo).toMatchObject({ called: [], teamsWithLine: 0 });
    expect(p.live.bingo.tiles).toHaveLength(16);
    expect(p.live.options).toEqual([]);
    expect(JSON.stringify(p)).not.toMatch(/"answers"/);

    const cards = [] as string[][];
    for (const t of teams) {
      const live = (await t.me()).live!;
      expect(live.bingo!.layout).toHaveLength(16);
      expect(new Set(live.bingo!.layout).size).toBe(16);
      cards.push(live.bingo!.layout);
    }
    expect(new Set(cards.map((c) => c.join(''))).size).toBe(3);

    await teams[0]!.answer(correct(2, 0));
    expect((await teams[0]!.me()).live!.bingo!.marked).toEqual([]); // locked in, not yet resolved
    await admin.post('/api/admin/round/live/advance');
    const after = (await teams[0]!.me()).live!;
    expect(after.bingo!.marked).toEqual([SEED_ROUNDS[1]!.challenges[0]!.answers[0]]);
    expect((await pub()).live.bingo.called).toEqual([SEED_ROUNDS[1]!.challenges[0]!.answers[0]]);
    expect((await teams[1]!.me()).live!.bingo!.missed).toEqual([SEED_ROUNDS[1]!.challenges[0]!.answers[0]]);
  });

  it('pays a bonus for every completed line and a blackout bonus for the full card, exactly once', async () => {
    b = await boot();
    const { admin, teams } = await startBingo(2);
    await playLive(admin, teams, (i) => (i === 0 ? 'LIVE_CORRECT' : null), 2);
    const s = await adminState(admin);
    expect(s.event.state).toBe('ROUND_ENDED');
    const t0 = teams[0]!.state.team.id;
    expect(ledger(t0, 'bingo_line')).toHaveLength(BINGO_LINES.length);
    expect(ledger(t0, 'bingo_line').every((r) => r.points === 75)).toBe(true);
    expect(ledger(t0, 'bingo_blackout')).toEqual([{ kind: 'bingo_blackout', points: 250 }]);
    // 16 calls x (50 base + 25 speed) + 10 lines x 75 + blackout 250
    expect(total(t0)).toBe(16 * 75 + 10 * 75 + 250);
    expect(ledger(teams[1]!.state.team.id)).toEqual([]);
    const card = (await teams[0]!.me()).live!.bingo!;
    expect(card).toMatchObject({ lines: 10, marked: expect.any(Array), missed: [] });
    expect(card.marked).toHaveLength(16);
    expect(card.lineCells).toHaveLength(16);
  });

  it('lines are paid when they complete on that team\'s own card', async () => {
    b = await boot();
    const { admin, teams } = await startBingo(1);
    // answer the first 6 calls correctly, miss call 7, answer the rest correctly
    await playLive(admin, teams, (_i, q) => (q === 6 ? 'LIVE_WRONG' : 'LIVE_CORRECT'), 2);
    const layout = (await teams[0]!.me()).live!.bingo!.layout;
    const marked = new Set(SEED_ROUNDS[1]!.challenges.filter((_c, q) => q !== 6).map((c) => c.answers[0]!));
    const expected = completedLines(layout, marked);
    expect(ledger(teams[0]!.state.team.id, 'bingo_line')).toHaveLength(expected.length);
    expect(ledger(teams[0]!.state.team.id, 'bingo_blackout')).toEqual([]); // one tile was missed
    const card = (await teams[0]!.me()).live!.bingo!;
    expect(card.lines).toBe(expected.length);
    expect(card.missed).toEqual([SEED_ROUNDS[1]!.challenges[6]!.answers[0]]);
  });

  it('the reveal announces who completed a line, and a skipped call is not marked as called', async () => {
    b = await boot();
    const { admin, teams } = await startBingo(1);
    await admin.post('/api/admin/round/live/skip'); // void call 1
    expect(await liveIdx(admin)).toBe(1);
    expect((await pub()).live.bingo.called).toEqual([]);
    await teams[0]!.answer(correct(2, 1)); // the only team has answered, so the call closes by itself
    const rev = (await pub()).live;
    expect(rev.phase).toBe('reveal');
    expect(rev.reveal.bingos).toEqual([]);
    expect(rev.bingo.called).toEqual([SEED_ROUNDS[1]!.challenges[1]!.answers[0]]);
  });
});

describe('replaying a live round after the event was reset', () => {
  /** Reset, let one fresh team register again, and start Level 1. */
  async function resetAndRestart(admin: Client) {
    expect((await admin.post('/api/admin/event/reset', { confirm: 'RESET' })).status).toBe(200);
    expect(b.h.ctx.db.get('SELECT 1 FROM live_question_log')).toBeUndefined(); // no question of the old run is left over
    const pin = (await adminState(admin)).event.pin;
    await admin.post('/api/admin/registration/open');
    const team = new TeamClient(b.base);
    expect((await team.join(pin, 'Second Run', ['Ann', 'Bob'])).status).toBe(201);
    await admin.post('/api/admin/registration/confirm');
    await admin.post('/api/admin/round/prepare');
    await admin.post('/api/admin/round/start');
    return team;
  }

  it('Tech Faces: scores the very first question again instead of treating it as already played', async () => {
    b = await boot();
    const { admin, teams } = await startRound(1);
    await teams[0]!.answer(correct(1, 0)); // the only team has answered, so the question closes by itself
    expect(total(teams[0]!.state.team.id)).toBe(180); // the first run does score

    const team = await resetAndRestart(admin);
    await team.answer(correct(1, 0));
    expect(total(team.state.team.id)).toBe(180);
    expect((await team.me()).score.total).toBe(180);
    expect((await pub()).leaderboard[0]).toMatchObject({ name: 'Second Run', total: 180 });
    expect((await pub()).live.reveal).toMatchObject({ correctCount: 1, fastest: { name: 'Second Run' } });
  });

  it('Tech Bingo: calls from the old run are not pre-called and the card starts empty', async () => {
    b = await boot();
    const { admin, teams } = await startBingo(1);
    await teams[0]!.answer(correct(2, 0));
    await admin.post('/api/admin/round/live/advance');
    expect((await pub()).live.bingo.called).toHaveLength(1);

    await admin.post('/api/admin/event/reset', { confirm: 'RESET' });
    const pin = (await adminState(admin)).event.pin;
    await admin.post('/api/admin/registration/open');
    const team = new TeamClient(b.base);
    await team.join(pin, 'Second Run', ['Ann', 'Bob']);
    await admin.post('/api/admin/registration/confirm');
    for (let i = 0; i < 2; i++) {
      await admin.post('/api/admin/round/prepare');
      await admin.post('/api/admin/round/start');
      if (i === 0) await admin.post('/api/admin/round/end');
    }
    expect((await pub()).live.bingo).toMatchObject({ called: [], teamsWithLine: 0 });
    expect((await team.me()).live!.bingo).toMatchObject({ marked: [], missed: [] });
    await team.answer(correct(2, 0));
    await admin.post('/api/admin/round/live/advance');
    expect(total(team.state.team.id)).toBe(50 + 25 + 0); // base + full speed bonus
    expect((await team.me()).live!.bingo!.marked).toHaveLength(1);
  });
});
