import { afterEach, describe, expect, it } from 'vitest';
import { SEED_ROUNDS } from '../../server/content/seed.js';
import { TeamClient, adminClient, adminState, boot, connectSocket, correct, setupEvent, skipIntroRounds, waitFor, wrong, type Booted, type Client } from './helpers.js';

let b: Booted;
afterEach(async () => {
  await b?.close();
});

const ledger = (teamId: number, kind?: string) => b.h.ctx.db.all<{ kind: string; points: number }>(`SELECT kind, points FROM score_ledger WHERE team_id = ? ${kind ? 'AND kind = ?' : ''} ORDER BY id`, teamId, ...(kind ? [kind] : []));
const total = (teamId: number) => b.h.ctx.db.get<{ t: number }>('SELECT COALESCE(SUM(points),0) t FROM score_ledger WHERE team_id = ?', teamId)!.t;
const pub = async () => (await new TeamClient(b.base).get('/api/public/state')).json;
const tick = () => b.h.realtime.tick();

/** Event in the lobby with N teams, Level 1 already played (nobody answers), Level 2 (Reel Rush) running. */
async function reelRush(n: number, settings?: Record<string, unknown>) {
  const env = await setupEvent(b, { teams: n, settings });
  await env.admin.post('/api/admin/registration/confirm');
  await skipIntroRounds(env.admin);
  await env.admin.post('/api/admin/round/prepare');
  await env.admin.post('/api/admin/round/start');
  await env.admin.post('/api/admin/round/end'); // Level 3 (Quick Brain): nobody answers
  await env.admin.post('/api/admin/round/prepare');
  await env.admin.post('/api/admin/round/start');
  return env;
}

/** Same, but through qualification into the Showdown with every team a finalist. */
async function showdown(n: number) {
  const env = await reelRush(n, { finalists: n });
  await env.admin.post('/api/admin/round/end');
  await env.admin.post('/api/admin/qualification/open');
  await env.admin.post('/api/admin/round/prepare');
  await env.admin.post('/api/admin/round/start');
  return env;
}

const adminRound = async (admin: Client) => {
  const s = await adminState(admin);
  return s.rounds.find((r) => r.id === s.event.currentRoundId)!;
};

describe('Level 4 - Reel Rush (live)', () => {
  it('opens question 1 for everyone at once; answers are locked in silently and scored only at the reveal', async () => {
    b = await boot();
    const { admin, teams } = await reelRush(3);
    const p = await pub();
    expect(p.round).toMatchObject({ kind: 'lightning', status: 'running' });
    expect(p.live).toMatchObject({ phase: 'open', index: 0, total: 12, answered: 0, eligible: 3 });
    expect(p.live.options).toHaveLength(4);
    expect(p.live.options.every((o: { correct?: boolean; count?: number }) => o.correct === undefined && o.count === undefined)).toBe(true);
    expect(p.live.reveal).toBeNull();
    expect(JSON.stringify(p)).not.toMatch(/"answers"/);

    const first = await teams[0]!.answer(correct(4, 0));
    expect(first.json).toMatchObject({ outcome: 'locked', points: 0 }); // no hint about correctness
    const second = await teams[1]!.answer(wrong(4, 0));
    expect(second.json.outcome).toBe('locked');
    expect((await teams[0]!.me()).score.total).toBe(0); // nothing is scored during the open phase
    expect((await pub()).live.answered).toBe(2);
    expect((await teams[0]!.me()).live).toMatchObject({ locked: true, result: null });

    // time runs out -> reveal
    b.clock.advance(20_001);
    tick();
    const rev = (await pub()).live;
    expect(rev.phase).toBe('reveal');
    expect(rev.reveal).toMatchObject({ correctText: 'Sun Microsystems', answered: 2, correctCount: 1, voided: false });
    expect(rev.reveal.fastest).toMatchObject({ name: 'Team 1', bonus: 50 });
    expect(rev.reveal.options.find((o: { id: string }) => o.id === 'c')).toMatchObject({ count: 1, correct: true });
    // base 100 + full speed bonus 100 (answered instantly) + fastest finger 50
    expect((await teams[0]!.me()).score.total).toBe(250);
    expect((await teams[1]!.me()).score.total).toBe(0);
    expect((await teams[2]!.me()).live!.result).toMatchObject({ outcome: 'none', points: 0 });
    expect((await teams[0]!.me()).live!.result).toMatchObject({ outcome: 'correct', points: 250 });
    expect((await teams[0]!.me()).live!.result!.breakdown.map((x) => x.label)).toEqual(['Correct answer', 'Speed bonus', 'Fastest finger']);

    // after the reveal period the next question opens automatically
    b.clock.advance(7_001);
    tick();
    expect((await pub()).live).toMatchObject({ phase: 'open', index: 1 });
    expect(await adminRound(admin)).toMatchObject({ livePhase: 'open', liveIndex: 1 });
  });

  it('speed bonus shrinks with time, and the first correct answer is rewarded once', async () => {
    b = await boot();
    const { teams } = await reelRush(2);
    await teams[0]!.answer(correct(4, 0));
    b.clock.advance(10_000); // half of the 20 s window
    await teams[1]!.answer(correct(4, 0));
    b.clock.advance(10_001);
    tick();
    expect(ledger(teams[0]!.state.team.id).map((r) => r.kind)).toEqual(['answer', 'speed_bonus', 'fastest_bonus']);
    expect(total(teams[0]!.state.team.id)).toBe(250);
    expect(total(teams[1]!.state.team.id)).toBe(100 + 50); // half the speed bonus, no fastest finger
  });

  it('streak bonuses build over consecutive correct answers and reset on a miss', async () => {
    b = await boot();
    const { admin, teams } = await reelRush(2);
    await admin.post('/api/admin/round/live/advance'); // nobody answered Q1 -> reveal... (so streaks start at 0)
    await admin.post('/api/admin/round/live/advance');
    for (let q = 1; q <= 3; q++) {
      await teams[0]!.answer(correct(4, q));
      await teams[1]!.answer(q === 2 ? wrong(4, q) : correct(4, q));
      // all answered -> reveal opens immediately
      expect((await pub()).live.phase).toBe('reveal');
      await admin.post('/api/admin/round/live/advance');
    }
    const t0 = ledger(teams[0]!.state.team.id, 'streak_bonus').map((r) => r.points);
    const t1 = ledger(teams[1]!.state.team.id, 'streak_bonus').map((r) => r.points);
    expect(t0).toEqual([25, 50]); // 2nd and 3rd correct in a row
    expect(t1).toEqual([]); // Q1 correct, Q2 wrong (streak reset), Q3 correct = streak of 1, no bonus
    expect((await teams[0]!.me()).live!.streak).toBe(3);
    expect((await teams[1]!.me()).live!.streak).toBe(1);
  });

  it('Double Down: right doubles base+speed, wrong costs the base points, and it can only be used once', async () => {
    b = await boot();
    const { admin, teams } = await reelRush(2);
    expect((await teams[0]!.me()).live!.doubleAvailable).toBe(true);
    await teams[0]!.answer(correct(4, 0), { doubleDown: true });
    await teams[1]!.answer(wrong(4, 0), { doubleDown: true });
    await admin.post('/api/admin/round/live/advance'); // already revealed (all answered)
    expect(total(teams[0]!.state.team.id)).toBe(100 + 100 + 50 + 200); // answer + speed + fastest + double (answer + speed)
    expect(total(teams[1]!.state.team.id)).toBe(-100);
    expect((await teams[1]!.me()).live!.doubleAvailable).toBe(false);
    // second use is refused with a clear error and does not lock the answer
    const again = await teams[0]!.answer(correct(4, 1), { doubleDown: true });
    expect(again.status).toBe(409);
    expect(again.json.error?.code).toBe('DOUBLE_USED');
    expect((await teams[0]!.answer(correct(4, 1))).json.outcome).toBe('locked');
  });

  it('a late answer does not consume Double Down; the deadline is inclusive', async () => {
    b = await boot();
    const { teams } = await reelRush(2);
    b.clock.advance(20_000); // exactly at the deadline: still accepted
    expect((await teams[0]!.answer(correct(4, 0))).json.outcome).toBe('locked');
    b.clock.advance(1);
    const late = await teams[1]!.answer(correct(4, 0), { doubleDown: true });
    expect(late.json.outcome).toBe('late');
    expect((await teams[1]!.me()).live!.doubleAvailable).toBe(true);
    tick();
    expect(total(teams[1]!.state.team.id)).toBe(0);
  });

  it('one answer per question; retries with the same request id are idempotent', async () => {
    b = await boot();
    const { teams } = await reelRush(2);
    const a = await teams[0]!.answer(wrong(4, 0), { requestId: 'live-request-1' });
    const dup = await teams[0]!.answer(wrong(4, 0), { requestId: 'live-request-1' });
    expect(a.json.outcome).toBe('locked');
    expect(dup.json).toMatchObject({ outcome: 'locked', duplicate: true });
    const changed = await teams[0]!.answer(correct(4, 0)); // cannot change your mind
    expect(changed.json.outcome).toBe('rejected');
    b.clock.advance(20_001);
    tick();
    expect(total(teams[0]!.state.team.id)).toBe(0);
    expect(b.h.ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM answer_submissions WHERE team_id = ? AND outcome IN ('correct','incorrect')", teams[0]!.state.team.id)!.n).toBe(1);
  });

  it('closes the question early once every team has answered', async () => {
    b = await boot();
    const { teams } = await reelRush(3);
    await Promise.all(teams.map((t) => t.answer(correct(4, 0))));
    expect((await pub()).live.phase).toBe('reveal');
    expect(teams.map((t) => total(t.state.team.id)).sort()).toEqual([200, 200, 250]);
  });

  it('concurrent submissions from all teams are each scored exactly once', async () => {
    b = await boot();
    const { teams } = await reelRush(12);
    await Promise.all(teams.map((t) => t.answer(correct(4, 0))));
    expect(b.h.ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM score_ledger WHERE kind = 'answer' AND round_id = (SELECT id FROM rounds WHERE level = 4)")!.n).toBe(12);
    expect(b.h.ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM score_ledger WHERE kind = 'fastest_bonus'")!.n).toBe(1);
  });

  it('pausing freezes the question timer; resuming gives back exactly the remaining time', async () => {
    b = await boot();
    const { admin, teams } = await reelRush(2);
    b.clock.advance(12_000);
    await admin.post('/api/admin/round/pause');
    expect((await pub()).live).toMatchObject({ phase: 'open', phaseRemainingMs: 8_000, phaseEndsAt: null });
    b.clock.advance(600_000);
    tick();
    expect((await pub()).live.phase).toBe('open'); // nothing moved while paused
    expect((await teams[0]!.answer(correct(4, 0))).json.outcome).toBe('rejected');
    await admin.post('/api/admin/round/resume');
    const live = (await pub()).live;
    expect(live.phaseRemainingMs).toBe(8_000);
    expect(live.phaseEndsAt).toBe(b.clock.now() + 8_000);
    expect((await teams[0]!.answer(correct(4, 0))).json.outcome).toBe('locked');
    b.clock.advance(8_001);
    tick();
    expect((await pub()).live.phase).toBe('reveal');
  });

  it('host controls: reveal now, next question, and skip (void) a question', async () => {
    b = await boot();
    const { admin, teams } = await reelRush(2);
    await teams[0]!.answer(correct(4, 0));
    await admin.post('/api/admin/round/live/advance'); // reveal now
    expect((await pub()).live.phase).toBe('reveal');
    expect(total(teams[0]!.state.team.id)).toBeGreaterThan(0);
    await admin.post('/api/admin/round/live/advance'); // next question now
    expect((await pub()).live).toMatchObject({ phase: 'open', index: 1 });

    // skip voids question 2: answers are discarded, nobody scores, nobody loses a streak or life
    await teams[0]!.answer(correct(4, 1));
    const before = total(teams[0]!.state.team.id);
    const skipped = await admin.post('/api/admin/round/live/skip');
    expect(skipped.status).toBe(200);
    expect((await pub()).live).toMatchObject({ phase: 'open', index: 2, answered: 0 });
    expect(total(teams[0]!.state.team.id)).toBe(before);
    expect(b.h.ctx.db.get<{ status: string }>("SELECT status FROM live_question_log l JOIN challenges c ON c.id = l.challenge_id WHERE c.position = 1 AND l.status = 'voided'")).toBeTruthy();
    expect((await adminState(admin)).audit.some((a) => a.action === 'live.skip')).toBe(true);
    // late answers for the voided question are not accepted
    const stale = await teams[1]!.answer(correct(4, 1), { challengeId: b.h.ctx.db.get<{ id: number }>("SELECT c.id FROM challenges c JOIN rounds r ON r.id = c.round_id WHERE r.level = 4 AND position = 1")!.id });
    expect(stale.json.outcome).toBe('late');
    expect((await teams[1]!.me()).score.total).toBe(0);
  });

  it('plays all 12 questions, ends by itself and leaves a consistent ledger', async () => {
    b = await boot();
    const { admin, teams } = await reelRush(2);
    for (let q = 0; q < 12; q++) {
      b.clock.advance(20_001);
      tick(); // reveal
      b.clock.advance(7_001);
      tick(); // next / end
    }
    expect((await adminState(admin)).event.state).toBe('ROUND_ENDED');
    expect((await pub()).live).toBeNull();
    expect(total(teams[0]!.state.team.id)).toBe(0); // nobody answered anything
    expect(SEED_ROUNDS[3]!.challenges).toHaveLength(12);
  });

  it('host controls are admin-only and need a running live round', async () => {
    b = await boot();
    const { teams } = await reelRush(1);
    expect((await teams[0]!.post('/api/admin/round/live/skip')).status).toBe(401);
    expect((await new TeamClient(b.base).post('/api/admin/round/live/advance')).status).toBe(401);
    const admin = await adminClient(b);
    await admin.post('/api/admin/round/pause');
    expect((await admin.post('/api/admin/round/live/skip')).status).toBe(409);
  });

  it('survives a server restart in the middle of a question', async () => {
    b = await boot();
    const { admin, teams } = await reelRush(2);
    await teams[0]!.answer(correct(4, 0));
    b.clock.advance(5_000);
    tick();
    const cookies = new Map(teams[0]!.cookies);
    const { dbPath, clock } = b;
    await b.close();
    clock.advance(3_600_000);
    b = await boot({ dbPath, clock });
    const admin2 = await adminClient(b);
    expect((await adminState(admin2)).event.state).toBe('ROUND_PAUSED');
    const live = (await pub()).live;
    expect(live).toMatchObject({ phase: 'open', index: 0, answered: 1 });
    expect(live.phaseRemainingMs).toBeGreaterThan(13_000);
    expect(live.phaseRemainingMs).toBeLessThanOrEqual(15_000);
    await admin2.post('/api/admin/round/resume');
    const t = new TeamClient(b.base);
    t.cookies = cookies;
    expect((await t.me()).live!.locked).toBe(true);
    void admin;
  });

  it('sockets: phones and the projector receive live state without polling', async () => {
    b = await boot();
    const { admin, teams } = await reelRush(2);
    const display = await connectSocket(b, { role: 'display' });
    const phone = await connectSocket(b, { role: 'team' }, teams[0]!.cookieHeader);
    await waitFor(() => display.publicStates.at(-1)?.live?.phase === 'open');
    await phone.socket.emitWithAck('answer:submit', { requestId: 'sock-live-0001', answer: correct(4, 0) }).then((ack: { ok: boolean; result: { outcome: string } }) => expect(ack.result.outcome).toBe('locked'));
    await waitFor(() => display.publicStates.at(-1)?.live?.answered === 1);
    await admin.post('/api/admin/round/live/advance');
    await waitFor(() => display.publicStates.at(-1)?.live?.phase === 'reveal');
    const mine = await waitFor(() => phone.teamStates.at(-1)?.live?.result && phone.teamStates.at(-1));
    expect(mine!.live!.result!.outcome).toBe('correct');
    display.close();
    phone.close();
  });
});

describe('Level 5 - Final Showdown (lives, steals, last team standing)', () => {
  it('only finalists take part and everyone starts with three lives', async () => {
    b = await boot();
    const { admin, teams } = await reelRush(4, { finalists: 2 });
    await teams[0]!.answer(correct(4, 0));
    await teams[1]!.answer(correct(4, 0));
    await admin.post('/api/admin/round/end');
    await admin.post('/api/admin/qualification/open');
    await admin.post('/api/admin/round/prepare');
    await admin.post('/api/admin/round/start');
    const live = (await pub()).live;
    expect(live).toMatchObject({ eligible: 2, total: 10 });
    const outsider = [2, 3].map((i) => teams[i]!);
    expect((await outsider[0]!.answer('a')).status).toBe(403);
    expect((await teams[0]!.me()).live).toMatchObject({ lives: 3, eliminated: false, doubleAvailable: false });
    expect((await pub()).leaderboard.find((r: { name: string }) => r.name === 'Team 1')).toMatchObject({ lives: 3 });
  });

  it('a wrong or missing answer costs a life; the fastest correct team steals from the leader who slipped', async () => {
    b = await boot();
    const { admin, teams } = await showdown(3);
    // give Team 3 a head start so it is the richest team that can be robbed
    await admin.post(`/api/admin/teams/${teams[2]!.state.team.id}/score`, { points: 400, reason: 'test head start' });
    await teams[0]!.answer(correct(5, 0)); // fastest correct
    await teams[1]!.answer(wrong(5, 0)); // wrong
    // Team 3 does not answer
    await admin.post('/api/admin/round/live/advance'); // reveal
    const live = (await pub()).live;
    expect(live.reveal.steal).toEqual({ thief: 'Team 1', victim: 'Team 3', points: 75 });
    expect(total(teams[0]!.state.team.id)).toBe(200 + 150 + 100 + 75); // answer + speed + fastest + steal
    expect(total(teams[2]!.state.team.id)).toBe(400 - 75);
    expect((await teams[1]!.me()).live!.lives).toBe(2);
    expect((await teams[2]!.me()).live!.lives).toBe(2);
    expect((await teams[0]!.me()).live!.lives).toBe(3);
    expect((await teams[2]!.me()).live!.result!.breakdown.map((x) => x.label)).toContain('Points stolen from you');
  });

  it('eliminates teams on their third strike; eliminated teams cannot answer but keep their points', async () => {
    b = await boot();
    const { admin, teams } = await showdown(3);
    for (let q = 0; q < 3; q++) {
      await teams[0]!.answer(correct(5, q));
      await teams[1]!.answer(correct(5, q));
      // team 3 stays silent
      await admin.post('/api/admin/round/live/advance'); // reveal
      await admin.post('/api/admin/round/live/advance'); // next
    }
    const me = await teams[2]!.me();
    expect(me.live).toMatchObject({ lives: 0, eliminated: true });
    const out = await teams[2]!.answer(correct(5, 3));
    expect(out.status).toBe(403);
    expect(out.json.error?.code).toBe('ELIMINATED');
    expect((await pub()).live.eligible).toBe(2);
    expect((await pub()).leaderboard.find((r: { name: string }) => r.name === 'Team 3')).toMatchObject({ eliminated: true, lives: 0 });
    expect((await pub()).live.eligible).toBe(2);
  });

  it('last team standing outranks raw points: a 5000-point team that loses all 3 lives cannot win', async () => {
    b = await boot();
    const { admin, teams } = await showdown(3);
    await admin.post(`/api/admin/teams/${teams[2]!.state.team.id}/score`, { points: 5000, reason: 'test: huge lead' });
    for (let q = 0; q < 3; q++) {
      await teams[0]!.answer(correct(5, q));
      await teams[1]!.answer(correct(5, q));
      // team 3 stays silent and loses a life each question
      await admin.post('/api/admin/round/live/advance'); // reveal
      await admin.post('/api/admin/round/live/advance'); // next
    }
    const rows = (await pub()).leaderboard as { name: string; rank: number; total: number; eliminated: boolean }[];
    const rich = rows.find((r) => r.name === 'Team 3')!;
    const alive = rows.filter((r) => r.name !== 'Team 3');
    expect(rich.eliminated).toBe(true);
    expect(rich.total).toBeGreaterThan(Math.max(...alive.map((r) => r.total))); // more points...
    expect(rich.rank).toBe(3); // ...yet last: the survivors rank above it
    expect(alive.map((r) => r.rank).sort()).toEqual([1, 2]);

    await admin.post('/api/admin/round/end');
    await admin.post('/api/admin/event/complete');
    const podium = (await pub()).podium as { name: string }[];
    expect(podium[2]!.name).toBe('Team 3');
    expect(podium[0]!.name).not.toBe('Team 3');
  });

  it('the round ends early when one team is left; the survivor bonus is paid exactly once', async () => {
    b = await boot();
    const { admin, teams } = await showdown(2);
    for (let q = 0; q < 3; q++) {
      await teams[0]!.answer(correct(5, q));
      await teams[1]!.answer(wrong(5, q));
      await admin.post('/api/admin/round/live/advance');
      await admin.post('/api/admin/round/live/advance');
    }
    const s = await adminState(admin);
    expect(s.event.state).toBe('ROUND_ENDED'); // Team 2 eliminated -> last team standing
    expect(ledger(teams[0]!.state.team.id, 'survivor_bonus')).toEqual([{ kind: 'survivor_bonus', points: 300 }]);
    expect(ledger(teams[1]!.state.team.id, 'survivor_bonus')).toEqual([]);
    expect(s.audit.some((a) => a.details.includes('last team standing'))).toBe(true);
    expect((await admin.post('/api/admin/round/end')).status).toBe(409); // cannot end twice
    expect(ledger(teams[0]!.state.team.id, 'survivor_bonus')).toHaveLength(1);
  });

  it('if every team would be knocked out at the same moment, nobody is', async () => {
    b = await boot();
    const { admin, teams } = await showdown(2);
    for (let q = 0; q < 4; q++) {
      await admin.post('/api/admin/round/live/advance'); // nobody answers
      await admin.post('/api/admin/round/live/advance');
    }
    const s = await adminState(admin);
    expect(s.event.state).toBe('ROUND_RUNNING');
    expect((await teams[0]!.me()).live).toMatchObject({ lives: 1, eliminated: false });
    expect((await teams[1]!.me()).live).toMatchObject({ lives: 1, eliminated: false });
  });
});
