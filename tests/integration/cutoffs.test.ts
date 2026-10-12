import { afterEach, describe, expect, it } from 'vitest';
import { TeamClient, adminState, boot, playLive, setupEvent, type Booted, type Client } from './helpers.js';

let b: Booted;
afterEach(async () => {
  await b?.close();
});

const pub = async () => (await new TeamClient(b.base).get('/api/public/state')).json;
const outAfter = async (admin: Client) => Object.fromEntries((await adminState(admin)).leaderboard.map((r) => [r.name, r.outAfter]));

/** Team i (0-based) answers the first i+1 questions of a live round correctly: strictly rising totals, Team 1 last. */
const rising = (i: number, q: number) => (q <= i ? 'LIVE_CORRECT' : null);

async function endOfLevel1(settings: Record<string, unknown>, teams = 6) {
  b = await boot();
  const env = await setupEvent(b, { teams, settings });
  await env.admin.post('/api/admin/registration/confirm');
  await env.admin.post('/api/admin/round/prepare');
  await env.admin.post('/api/admin/round/start');
  await playLive(env.admin, env.teams, rising, 1);
  expect((await adminState(env.admin)).event.state).toBe('ROUND_ENDED');
  return env;
}

describe('round cut-offs', () => {
  it('keeps the top N after a round, shows who is out and bars them from later rounds', async () => {
    const { admin, teams } = await endOfLevel1({ advance: [4, null, null], finalists: 3 });

    expect(await outAfter(admin)).toEqual({ 'Team 1': 1, 'Team 2': 1, 'Team 3': null, 'Team 4': null, 'Team 5': null, 'Team 6': null });
    const s = await adminState(admin);
    expect(s.leaderboard.map((r) => r.name)).toEqual(['Team 6', 'Team 5', 'Team 4', 'Team 3', 'Team 2', 'Team 1']);
    expect(s.teams.find((t) => t.name === 'Team 1')!.outAfter).toBe(1);
    expect((await pub()).cutoff).toEqual({ afterLevel: 1, kept: 4, out: 2 });
    expect((await teams[0]!.me()).outAfter).toBe(1);
    expect((await teams[5]!.me()).outAfter).toBeNull();
    expect(s.audit.some((a) => a.action === 'cutoff.apply')).toBe(true);

    // The next round only has the survivors in it.
    await admin.post('/api/admin/round/prepare');
    await admin.post('/api/admin/round/start');
    expect((await pub()).cutoff).toBeNull();
    const cutTeam = await teams[0]!.me();
    expect(cutTeam.eligible).toBe(false);
    expect((await teams[3]!.me()).eligible).toBe(true);
    const blocked = await teams[0]!.answer('a');
    expect(blocked.status).toBe(403);
    expect(blocked.json.error?.code).toBe('NOT_ELIGIBLE');
    expect(JSON.stringify(blocked.json)).toMatch(/cut after Level 1/);
    expect(b.h.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM live_team_state WHERE round_id = (SELECT id FROM rounds WHERE level = 2)')!.n).toBe(4);
    expect((await pub()).live.eligible).toBe(4);
  });

  it('does nothing when no cut is set or the cut is not smaller than the field', async () => {
    const { admin } = await endOfLevel1({ advance: [null, null, null] });
    expect(Object.values(await outAfter(admin)).every((v) => v === null)).toBe(true);
    expect((await pub()).cutoff).toBeNull();
    await b.close();

    const env = await endOfLevel1({ advance: [10, null, null] }, 3);
    expect(Object.values(await outAfter(env.admin)).every((v) => v === null)).toBe(true);
    expect((await pub()).cutoff).toBeNull();
  });

  it('follows the standings until the next round is prepared: a score correction or a new number moves the line', async () => {
    const { admin, teams } = await endOfLevel1({ advance: [4, null, null], finalists: 3 });
    const id = (n: number) => teams[n - 1]!.state.team.id;

    // Team 2 was cut; a big correction lifts it over the line and pushes the old 4th place (Team 3) out.
    expect((await admin.post(`/api/admin/teams/${id(2)}/score`, { points: 5000, reason: 'judge ruling' })).status).toBe(200);
    expect(await outAfter(admin)).toMatchObject({ 'Team 2': null, 'Team 3': 1, 'Team 1': 1 });

    // A different number takes effect at once.
    expect((await admin.patch('/api/admin/event', { settings: { advance: [5, null, null] } })).status).toBe(200);
    expect(await outAfter(admin)).toMatchObject({ 'Team 1': 1, 'Team 2': null, 'Team 3': null });
    expect((await pub()).cutoff).toEqual({ afterLevel: 1, kept: 5, out: 1 });
    expect((await admin.patch('/api/admin/event', { settings: { advance: [null, null, null] } })).status).toBe(200);
    expect(Object.values(await outAfter(admin)).every((v) => v === null)).toBe(true);
    await admin.patch('/api/admin/event', { settings: { advance: [4, null, null] } });

    // Preparing the next round makes the cut final.
    await admin.post('/api/admin/round/prepare');
    const late = await admin.patch('/api/admin/event', { settings: { advance: [3, null, null] } });
    expect(late.status).toBe(409);
    expect(late.json.error.code).toBe('LOCKED');
    await admin.post(`/api/admin/teams/${id(1)}/score`, { points: 9000, reason: 'too late to matter' });
    expect((await outAfter(admin))['Team 1']).toBe(1);
  });

  it('carries cuts through to qualification: only teams still in can be finalists, and the board is ordered by how far each got', async () => {
    const { admin, teams } = await endOfLevel1({ advance: [4, 3, null], finalists: 2 });

    // Level 2 (Tech Bingo) among the four survivors: Team 3 is the weakest and is cut.
    await admin.post('/api/admin/round/prepare');
    await admin.post('/api/admin/round/start');
    await playLive(admin, teams.slice(2), (j, q) => (q <= j * 3 ? 'LIVE_CORRECT' : null), 2);
    expect(await outAfter(admin)).toEqual({ 'Team 1': 1, 'Team 2': 1, 'Team 3': 2, 'Team 4': null, 'Team 5': null, 'Team 6': null });
    expect((await pub()).cutoff).toEqual({ afterLevel: 2, kept: 3, out: 1 });

    // Levels 3 and 4 with nobody scoring, then qualification.
    for (let level = 3; level <= 4; level++) {
      await admin.post('/api/admin/round/prepare');
      await admin.post('/api/admin/round/start');
      await admin.post('/api/admin/round/end');
    }
    expect((await admin.post('/api/admin/qualification/open')).status).toBe(200);
    const q = await adminState(admin);
    expect(q.leaderboard.filter((r) => r.qualified).map((r) => r.name)).toEqual(['Team 6', 'Team 5']);

    // Final: finalists first, then the survivor, then those cut after Level 2, then those cut after Level 1.
    await admin.post('/api/admin/round/prepare');
    await admin.post('/api/admin/round/start');
    const ranked = (await adminState(admin)).leaderboard.map((r) => r.name);
    expect(ranked).toEqual(['Team 6', 'Team 5', 'Team 4', 'Team 3', 'Team 2', 'Team 1']);
    expect((await teams[3]!.me()).eligible).toBe(false); // survived every cut but is no finalist
    expect((await teams[2]!.me()).eligible).toBe(false); // cut after Level 2
    expect((await teams[5]!.me()).eligible).toBe(true);

    await admin.post('/api/admin/round/end');
    await admin.post('/api/admin/event/complete');
    const csv = (await admin.get('/api/admin/export.csv')).text.replace('﻿', '').trim().split('\r\n');
    const col = csv[0]!.split(',').indexOf('Out after level');
    expect(col).toBeGreaterThan(0);
    const cell = (team: string) => csv.find((l) => l.split(',')[1] === team)!.split(',')[col];
    expect([cell('Team 1'), cell('Team 3'), cell('Team 6')]).toEqual(['1', '2', '']);
  });

  it('rejects a plan where a later cut keeps more teams than an earlier one', async () => {
    b = await boot();
    const { admin } = await setupEvent(b, { teams: 0 });
    const bad = await admin.patch('/api/admin/event', { settings: { advance: [8, 10, null] } });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe('BAD_ADVANCEMENT');
    // more finalists than teams left is fine: everyone who is left qualifies
    expect((await admin.patch('/api/admin/event', { settings: { advance: [null, null, 3] } })).status).toBe(200);
    expect((await adminState(admin)).event.settings).toMatchObject({ advance: [null, null, 3], finalists: 5 });
    // malformed input never reaches the engine
    expect((await admin.patch('/api/admin/event', { settings: { advance: [5, 5] } })).status).toBe(400);
    expect((await admin.patch('/api/admin/event', { settings: { advance: [0, null, null] } })).status).toBe(400);
    expect((await admin.patch('/api/admin/event', { settings: { advance: [21, null, null] } })).status).toBe(400);
  });

  it('upgrades an event saved before cut-offs existed', async () => {
    b = await boot();
    const { admin } = await setupEvent(b, { teams: 0 });
    b.h.ctx.db.run('UPDATE events SET settings = ?', JSON.stringify({ maxTeams: 12, autoApprove: true, finalists: 4, liveScores: true }));
    expect((await adminState(admin)).event.settings).toEqual({ maxTeams: 12, autoApprove: true, finalists: 4, liveScores: true, advance: [null, null, null] });
    expect((await admin.patch('/api/admin/event', { settings: { advance: [8, null, null] } })).status).toBe(200);
    expect((await adminState(admin)).event.settings.advance).toEqual([8, null, null]);
  });
});
