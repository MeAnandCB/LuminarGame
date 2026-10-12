import { afterEach, describe, expect, it } from 'vitest';
import { SEED_ROUNDS } from '../../server/content/seed.js';
import { TeamClient, adminState, boot, correct, setupEvent, skipIntroRounds, wrong, type Booted } from './helpers.js';

let b: Booted;
afterEach(async () => {
  await b?.close();
});

const REEL_RUSH = 4;

/** Reel Rush (Level 4, live, 20 s question + 7 s reveal) running with N teams; Levels 1-3 skipped. */
async function reelRush(n: number) {
  const env = await setupEvent(b, { teams: n });
  await env.admin.post('/api/admin/registration/confirm');
  await skipIntroRounds(env.admin);
  await env.admin.post('/api/admin/round/prepare');
  await env.admin.post('/api/admin/round/start');
  await env.admin.post('/api/admin/round/end'); // Quick Brain: nobody answers
  await env.admin.post('/api/admin/round/prepare');
  await env.admin.post('/api/admin/round/start');
  return env;
}

const advance = (admin: Awaited<ReturnType<typeof reelRush>>['admin'], expect?: { index: number; phase: string }) =>
  admin.post('/api/admin/round/live/advance', expect ? { expect } : {});

describe('Coordinator desk: admin state for the live question', () => {
  it('is empty before a live round runs, then carries the timer, the answers-in count and the answer key', async () => {
    b = await boot();
    const env = await setupEvent(b, { teams: 3 });
    expect((await adminState(env.admin)).live).toBeNull();
    await env.admin.post('/api/admin/registration/confirm');
    expect((await adminState(env.admin)).live).toBeNull();

    const { admin, teams } = await reelRush(3);
    let s = await adminState(admin);
    expect(s.live).toMatchObject({ phase: 'open', index: 0, total: 12, answered: 0, eligible: 3, phaseTotalMs: 20_000, phaseRemainingMs: 20_000 });
    expect(s.live!.phaseEndsAt).toBe(s.serverNow + 20_000);
    expect(s.live!.reveal).toBeNull();

    // the coordinator reads the key from the round's own challenge, which the public state never carries
    const round = s.rounds.find((r) => r.id === s.event.currentRoundId)!;
    expect(round.challenges[s.live!.index]!.answers).toEqual([correct(REEL_RUSH, 0)]);
    expect(round.challenges[s.live!.index]!.prompt).toBe(s.live!.prompt);

    await teams[0]!.answer(correct(REEL_RUSH, 0));
    b.clock.advance(5_000);
    s = await adminState(admin);
    expect(s.live).toMatchObject({ answered: 1, phaseRemainingMs: 15_000 });

    const pub = (await new TeamClient(b.base).get('/api/public/state')).json;
    expect(JSON.stringify(pub)).not.toMatch(/"answers"/);
  });

  it('adds the reveal statistics once the question is closed, and freezes the timer while paused', async () => {
    b = await boot();
    const { admin, teams } = await reelRush(3);
    await teams[0]!.answer(correct(REEL_RUSH, 0));
    await teams[1]!.answer(wrong(REEL_RUSH, 0));
    await advance(admin);
    let s = await adminState(admin);
    expect(s.live).toMatchObject({ phase: 'reveal', index: 0, answered: 2, phaseTotalMs: 7_000 });
    expect(s.live!.reveal).toMatchObject({ answered: 2, correctCount: 1, voided: false });
    expect(s.live!.reveal!.fastest).toMatchObject({ name: 'Team 1' });
    const right = SEED_ROUNDS[REEL_RUSH - 1]!.challenges[0]!.answers[0]!;
    expect(s.live!.reveal!.options.find((o) => o.id === right)).toMatchObject({ count: 1, correct: true });

    b.clock.advance(2_000);
    const before = (await adminState(admin)).live!.phaseRemainingMs;
    expect(before).toBeLessThanOrEqual(5_000);
    await admin.post('/api/admin/round/pause');
    b.clock.advance(60_000);
    s = await adminState(admin);
    expect(s.event.state).toBe('ROUND_PAUSED');
    expect(s.live).toMatchObject({ phase: 'reveal', phaseEndsAt: null, phaseRemainingMs: before });
    expect((await advance(admin)).status).toBe(409); // the coordinator must resume first
  });
});

describe('Coordinator desk: reveal answer -> next question -> repeat', () => {
  it('walks the loop with guarded clicks', async () => {
    b = await boot();
    const { admin } = await reelRush(2);
    const where = async () => {
      const s = await adminState(admin);
      return `${s.live!.index}:${s.live!.phase}`;
    };
    expect(await where()).toBe('0:open');
    expect((await advance(admin, { index: 0, phase: 'open' })).status).toBe(200); // reveal answer
    expect(await where()).toBe('0:reveal');
    expect((await advance(admin, { index: 0, phase: 'reveal' })).status).toBe(200); // next question
    expect(await where()).toBe('1:open');
    await advance(admin, { index: 1, phase: 'open' });
    await advance(admin, { index: 1, phase: 'reveal' });
    expect(await where()).toBe('2:open');
  });

  it('ignores a click made on a stale screen instead of skipping a phase', async () => {
    b = await boot();
    const { admin } = await reelRush(2);
    // the timer ran out and the game revealed question 1 while the coordinator was still looking at "open"
    b.clock.advance(20_001);
    b.h.realtime.tick();
    expect((await advance(admin, { index: 0, phase: 'open' })).status).toBe(200);
    let s = await adminState(admin);
    expect(s.live).toMatchObject({ index: 0, phase: 'reveal' }); // still on the reveal, not jumped ahead

    // the reveal ended by itself and question 2 is open; a late "Next question" must not close it before anyone answers
    b.clock.advance(7_001);
    b.h.realtime.tick();
    expect((await advance(admin, { index: 0, phase: 'reveal' })).status).toBe(200);
    s = await adminState(admin);
    expect(s.live).toMatchObject({ index: 1, phase: 'open', answered: 0 });

    // an unguarded click (the admin dashboard) still works as before
    expect((await advance(admin)).status).toBe(200);
    s = await adminState(admin);
    expect(s.live).toMatchObject({ index: 1, phase: 'reveal' });
  });

  it('rejects a malformed guard and still requires an admin', async () => {
    b = await boot();
    const { admin } = await reelRush(2);
    expect((await advance(admin, { index: 0, phase: 'bogus' })).status).toBe(400);
    expect((await admin.post('/api/admin/round/live/advance', { expect: { index: 0, phase: 'open' }, extra: 1 })).status).toBe(400);
    expect((await new TeamClient(b.base).post('/api/admin/round/live/advance', { expect: { index: 0, phase: 'open' } })).status).toBe(401);
    expect((await adminState(admin)).live).toMatchObject({ index: 0, phase: 'open' });
  });
});
