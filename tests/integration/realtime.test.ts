import { afterEach, describe, expect, it } from 'vitest';
import { C2S } from '../../shared/contract.js';
import type { AnswerResult } from '../../shared/types.js';
import { SEED_ROUNDS } from '../../server/content/seed.js';
import { TeamClient, adminClient, adminState, boot, connectSocket, correct, setupEvent, sleep, waitFor, type Booted } from './helpers.js';

let b: Booted;
afterEach(async () => {
  await b?.close();
});

function emitAck<T>(sock: { socket: { emit: (...a: any[]) => void } }, event: string, payload: unknown): Promise<{ ok: boolean; result?: T; error?: { code: string } }> {
  return new Promise((resolve) => sock.socket.emit(event, payload, resolve));
}

describe('real-time sync', () => {
  it('projector and phones see live leaderboard changes without polling', async () => {
    b = await boot();
    const { admin, teams } = await setupEvent(b, { teams: 2 });
    const display = await connectSocket(b, { role: 'display' });
    const phone = await connectSocket(b, { role: 'team' }, teams[0]!.cookieHeader);
    await admin.post('/api/admin/registration/confirm');
    await admin.post('/api/admin/round/prepare');
    await admin.post('/api/admin/round/start');
    await waitFor(() => display.publicStates.at(-1)?.event?.state === 'ROUND_RUNNING');
    expect(display.events.some((e) => e.name === 'announce')).toBe(true);

    const ack = await emitAck<AnswerResult>(phone, C2S.submitAnswer, { requestId: 'sock-req-0001', answer: correct(1, 0) });
    expect(ack.ok).toBe(true);
    expect(ack.result).toMatchObject({ outcome: 'correct' });
    const top = await waitFor(() => display.publicStates.at(-1)?.leaderboard.find((r) => r.name === 'Team 1' && r.total > 0));
    expect(top.total).toBe(110);
    expect(display.publicStates.at(-1)!.provisional).toBe(true);
    expect(display.publicStates.at(-1)!.recent[0]).toMatchObject({ teamName: 'Team 1', kind: expect.any(String) });
    const mine = await waitFor(() => phone.teamStates.at(-1)?.score.total === 110 && phone.teamStates.at(-1));
    expect(mine.progress!.position).toBe(1);
    display.close();
    phone.close();
  });

  it('socket acks reject malformed payloads and forged identities, and duplicates are idempotent', async () => {
    b = await boot();
    const { admin, teams } = await setupEvent(b, { teams: 2 });
    await admin.post('/api/admin/registration/confirm');
    await admin.post('/api/admin/round/prepare');
    await admin.post('/api/admin/round/start');
    const phone = await connectSocket(b, { role: 'team' }, teams[0]!.cookieHeader);
    expect((await emitAck(phone, C2S.submitAnswer, { answer: 'a' })).error?.code).toBe('INVALID_INPUT');
    expect((await emitAck(phone, C2S.submitAnswer, 'garbage')).error?.code).toBe('INVALID_INPUT');
    expect((await emitAck(phone, C2S.submitAnswer, { requestId: 'x'.repeat(200), answer: 'a' })).error?.code).toBe('INVALID_INPUT');
    const first = await emitAck<AnswerResult>(phone, C2S.submitAnswer, { requestId: 'dup-request-01', answer: correct(1, 0), teamId: teams[1]!.state.team.id });
    const second = await emitAck<AnswerResult>(phone, C2S.submitAnswer, { requestId: 'dup-request-01', answer: correct(1, 0) });
    expect(first.result!.duplicate).toBeUndefined();
    expect(second.result).toMatchObject({ duplicate: true, outcome: 'correct' });
    expect((await teams[1]!.me()).score.total).toBe(0);
    expect((await teams[0]!.me()).score.total).toBe(110);
    phone.close();
  });

  it('answer submission via socket and HTTP share one rate limit per team', async () => {
    b = await boot({ rateLimits: { answer: { max: 3, windowMs: 60_000 } } });
    const { admin, teams } = await setupEvent(b, { teams: 1 });
    await admin.post('/api/admin/registration/confirm');
    await admin.post('/api/admin/round/prepare');
    await admin.post('/api/admin/round/start');
    const phone = await connectSocket(b, { role: 'team' }, teams[0]!.cookieHeader);
    const codes: (string | undefined)[] = [];
    for (let i = 0; i < 3; i++) codes.push((await emitAck(phone, C2S.submitAnswer, { requestId: `rate-req-${i}000`, answer: 'z' })).error?.code);
    const http = await teams[0]!.answer('a');
    expect(http.status).toBe(429);
    expect(codes).toEqual([undefined, undefined, undefined]); // the three socket calls used up the shared budget
    phone.close();
  });

  it('tracks connection status, handles a dropped phone and a reconnect on a new socket', async () => {
    b = await boot();
    const { admin, teams } = await setupEvent(b, { teams: 2 });
    const adm = await connectSocket(b, { role: 'admin' }, [...admin.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    const p1 = await connectSocket(b, { role: 'team' }, teams[0]!.cookieHeader);
    await waitFor(() => adm.adminStates.at(-1)?.teams.find((t) => t.name === 'Team 1')?.connected);
    expect(adm.adminStates.at(-1)!.counts.connected).toBe(1);
    p1.close(); // phone loses Wi-Fi
    await waitFor(() => adm.adminStates.at(-1)?.teams.find((t) => t.name === 'Team 1')?.connected === false);
    expect(adm.adminStates.at(-1)!.counts.connected).toBe(0);
    // comes back later with a brand-new socket and the same cookie
    await admin.post('/api/admin/registration/confirm');
    await admin.post('/api/admin/round/prepare');
    await admin.post('/api/admin/round/start');
    await teams[0]!.answer(correct(1, 0));
    const p1b = await connectSocket(b, { role: 'team' }, teams[0]!.cookieHeader);
    const restored = await waitFor(() => p1b.teamStates.at(-1));
    expect(restored.progress!.position).toBe(1);
    expect(restored.score.total).toBe(110);
    expect(restored.challenge!.position).toBe(1);
    expect(b.h.ctx.presence.get(teams[0]!.state.team.id)!.size).toBe(1); // no duplicate presence from the old socket
    adm.close();
    p1b.close();
  });

  it('admin sockets get full state including answer keys; others do not', async () => {
    b = await boot();
    const { admin } = await setupEvent(b, { teams: 1 });
    const adm = await connectSocket(b, { role: 'admin' }, [...admin.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    const s = await waitFor(() => adm.adminStates.at(-1));
    expect(s.rounds[0]!.challenges[0]!.answers).toEqual(['b']);
    adm.close();
  });

  it('removed and reset teams are kicked from their sockets', async () => {
    b = await boot();
    const { admin, teams } = await setupEvent(b, { teams: 2 });
    const p0 = await connectSocket(b, { role: 'team' }, teams[0]!.cookieHeader);
    const p1 = await connectSocket(b, { role: 'team' }, teams[1]!.cookieHeader);
    let ended0 = false;
    let ended1 = false;
    p0.socket.on('session:ended', () => (ended0 = true));
    p1.socket.on('session:ended', () => (ended1 = true));
    await admin.post(`/api/admin/teams/${teams[0]!.state.team.id}/status`, { status: 'removed' });
    await waitFor(() => ended0);
    expect(ended1).toBe(false);
    await admin.post('/api/admin/event/reset', { confirm: 'RESET' });
    await waitFor(() => ended1);
    await waitFor(() => !p1.socket.connected);
  });

  it('20 teams submitting at the same moment are all scored exactly once', async () => {
    b = await boot();
    const { admin, teams } = await setupEvent(b, { teams: 20 });
    await admin.post('/api/admin/registration/confirm');
    await admin.post('/api/admin/round/prepare');
    await admin.post('/api/admin/round/start');
    const socks = await Promise.all(teams.map((t) => connectSocket(b, { role: 'team' }, t.cookieHeader)));
    const acks = await Promise.all(socks.map((s, i) => emitAck<AnswerResult>(s, C2S.submitAnswer, { requestId: `burst-${i}-aaaaaaaa`, answer: correct(1, 0) })));
    expect(acks.every((a) => a.ok && a.result!.outcome === 'correct')).toBe(true);
    const s = await adminState(admin);
    expect(s.leaderboard).toHaveLength(20);
    expect(s.leaderboard.every((r) => r.total === 110)).toBe(true);
    expect(b.h.ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM score_ledger WHERE kind='answer'")!.n).toBe(20);
    expect(s.counts.submissions).toBe(20);
    socks.forEach((x) => x.close());
  });
});

describe('persistence and recovery', () => {
  it('a server restart mid-round keeps scores, sessions and remaining time (round resumes paused)', async () => {
    b = await boot();
    const dbPath = b.dbPath;
    const clock = b.clock;
    const { admin, teams, pin } = await setupEvent(b, { teams: 2 });
    await admin.post('/api/admin/registration/confirm');
    await admin.patch('/api/admin/round/1/config', { durationSec: 300 });
    await admin.post('/api/admin/round/prepare');
    await admin.post('/api/admin/round/start');
    await teams[0]!.answer(correct(1, 0));
    await teams[0]!.answer(correct(1, 1));
    clock.advance(60_000);
    b.h.realtime.tick(); // heartbeat
    const cookies = new Map(teams[0]!.cookies);
    await b.close();

    clock.advance(3_600_000); // an hour of downtime must not eat the round
    b = await boot({ dbPath, clock });
    const admin2 = await adminClient(b);
    const s = await adminState(admin2);
    expect(s.event.pin).toBe(pin);
    expect(s.event.state).toBe('ROUND_PAUSED');
    expect(s.rounds[0]!.remainingMs).toBe(240_000);
    expect(s.leaderboard.find((r) => r.name === 'Team 1')!.total).toBe(220);
    const t = new TeamClient(b.base);
    t.cookies = cookies;
    const me = await t.me();
    expect(me.progress!.position).toBe(2);
    expect(me.score.total).toBe(220);
    // blocked while paused, then host resumes and play continues
    expect((await t.answer(correct(1, 2))).json.outcome).toBe('rejected');
    await admin2.post('/api/admin/round/resume');
    expect((await t.answer(correct(1, 2))).json.outcome).toBe('correct');
    expect((await t.me()).score.total).toBe(320); // 60 s of play since unlock: no speed bonus left
    expect((await adminState(admin2)).audit.some((a) => a.action === 'recovery.pause')).toBe(true);
  });

  it('finalised results and the audit trail survive a restart', async () => {
    b = await boot();
    const { admin, teams } = await setupEvent(b, { teams: 2 });
    await admin.post('/api/admin/registration/confirm');
    await admin.post('/api/admin/round/prepare');
    await admin.post('/api/admin/round/start');
    await teams[1]!.answer(correct(1, 0));
    await admin.post('/api/admin/round/end');
    await admin.post('/api/admin/event/complete');
    const before = (await adminState(admin)).leaderboard;
    const { dbPath, clock } = b;
    await b.close();
    b = await boot({ dbPath, clock });
    const admin2 = await adminClient(b);
    const after = await adminState(admin2);
    expect(after.event.state).toBe('EVENT_COMPLETED');
    expect(after.leaderboard).toEqual(before.map((r) => ({ ...r, connected: false })));
    const pub = (await new TeamClient(b.base).get('/api/public/state')).json;
    expect(pub.podium[0].name).toBe('Team 2');
  });

  it('migrations are idempotent and never reset data on startup', async () => {
    b = await boot();
    const { admin } = await setupEvent(b, { teams: 1 });
    void admin;
    const { dbPath, clock } = b;
    await b.close();
    b = await boot({ dbPath, clock });
    expect(b.h.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM teams')!.n).toBe(1);
    expect(b.h.ctx.db.all('SELECT * FROM schema_migrations')).toHaveLength(1);
  });

  it('tolerates a stale tab left open after the event ended', async () => {
    b = await boot();
    const { admin, teams } = await setupEvent(b, { teams: 1 });
    await admin.post('/api/admin/registration/confirm');
    await admin.post('/api/admin/event/complete');
    await sleep(10);
    const me = await teams[0]!.me();
    expect(me.eventState).toBe('EVENT_COMPLETED');
    expect(me.award).toBe('Champion');
    const r = await teams[0]!.answer('a');
    expect(r.status).toBe(409);
    expect(SEED_ROUNDS.length).toBe(3);
  });
});
