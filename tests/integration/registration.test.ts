import { afterEach, describe, expect, it } from 'vitest';
import { TeamClient, adminState, boot, setupEvent, type Booted } from './helpers.js';

let b: Booted;
afterEach(async () => {
  await b?.close();
});

describe('registration', () => {
  it('only accepts joins while registration is open and the PIN matches', async () => {
    b = await boot();
    const admin = (await setupEvent(b)).admin;
    await admin.post('/api/admin/registration/pause');
    const pin = (await adminState(admin)).event.pin;
    const t = new TeamClient(b.base);
    expect((await t.join(pin, 'Early Birds')).json.error.code).toBe('REGISTRATION_CLOSED');
    await admin.post('/api/admin/registration/open');
    expect((await t.join('000000', 'Wrong Pin')).json.error.code).toBe('BAD_PIN');
    expect((await t.join(pin, 'Early Birds')).status).toBe(201);
  });

  it('rejects duplicate team names regardless of case and spacing', async () => {
    b = await boot();
    const { pin } = await setupEvent(b, { teams: 1 }); // "Team 1"
    for (const name of ['team 1', 'TEAM  1', '  Team 1 ']) {
      const r = await new TeamClient(b.base).join(pin, name);
      expect(r.status, name).toBe(409);
      expect(r.json.error.code).toBe('NAME_TAKEN');
    }
  });

  it('admin sees duplicate flags only for genuinely clashing pending names, and rejection frees the name', async () => {
    b = await boot();
    const { admin, pin } = await setupEvent(b, { settings: { autoApprove: false } });
    const t1 = new TeamClient(b.base);
    expect((await t1.join(pin, 'Binary Bandits')).status).toBe(201);
    expect((await new TeamClient(b.base).join(pin, 'binary bandits')).status).toBe(409);
    let s = await adminState(admin);
    expect(s.teams[0]!.status).toBe('pending');
    await admin.post(`/api/admin/teams/${s.teams[0]!.id}/status`, { status: 'rejected' });
    expect((await new TeamClient(b.base).join(pin, 'binary bandits')).status).toBe(201);
    s = await adminState(admin);
    expect(s.teams.some((t) => t.duplicateName)).toBe(false); // the rejected one no longer clashes
  });

  it('flags near-duplicate names for the host', async () => {
    b = await boot();
    const { admin, pin } = await setupEvent(b);
    await new TeamClient(b.base).join(pin, 'Byte Force');
    expect((await new TeamClient(b.base).join(pin, 'Byte-Force')).status).toBe(201);
    const s = await adminState(admin);
    expect(s.teams.every((t) => t.duplicateName)).toBe(true);
  });

  it('caps the event at 20 teams, even under concurrent joins', async () => {
    b = await boot();
    const { pin } = await setupEvent(b);
    const results = await Promise.all(Array.from({ length: 26 }, (_, i) => new TeamClient(b.base).join(pin, `Squad ${i}`)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(20);
    const full = results.filter((r) => r.status === 409);
    expect(full).toHaveLength(6);
    expect(full.every((r) => r.json.error.code === 'EVENT_FULL')).toBe(true);
    expect(b.h.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM teams')!.n).toBe(20);
  });

  it('concurrent joins with the same name create exactly one team', async () => {
    b = await boot();
    const { pin } = await setupEvent(b);
    const rs = await Promise.all(Array.from({ length: 8 }, () => new TeamClient(b.base).join(pin, 'Clone Squad')));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
  });

  it('closing registration while teams are joining leaves a consistent roster', async () => {
    b = await boot();
    const { admin, pin } = await setupEvent(b);
    const joins = Array.from({ length: 10 }, (_, i) => new TeamClient(b.base).join(pin, `Racer ${i}`));
    const close = admin.post('/api/admin/registration/confirm');
    const results = await Promise.all([...joins, close]);
    const ok = results.slice(0, 10).filter((r) => r.status === 201).length;
    const rejected = results.slice(0, 10).filter((r) => r.status === 409);
    expect(rejected.every((r) => r.json.error.code === 'REGISTRATION_CLOSED')).toBe(true);
    expect(b.h.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM teams')!.n).toBe(ok);
    expect((await adminState(admin)).event.state).toBe('LOBBY');
  });

  it('validates names and players', async () => {
    b = await boot();
    const { pin } = await setupEvent(b);
    expect((await new TeamClient(b.base).join(pin, 'x')).status).toBe(400);
    expect((await new TeamClient(b.base).join(pin, '<script>alert(1)</script>')).status).toBe(400);
    expect((await new TeamClient(b.base).join(pin, 'OK Name', ['', 'b'])).status).toBe(400);
    expect((await new TeamClient(b.base).post('/api/team/join', { pin, name: 'Solo Team', players: ['one'] })).status).toBe(400);
  });

  it('confirming requires all pending teams to be decided', async () => {
    b = await boot();
    const { admin, pin } = await setupEvent(b, { settings: { autoApprove: false } });
    await new TeamClient(b.base).join(pin, 'Waiting Room');
    const r = await admin.post('/api/admin/registration/confirm');
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('PENDING_TEAMS');
    const s = await adminState(admin);
    await admin.post(`/api/admin/teams/${s.teams[0]!.id}/status`, { status: 'approved' });
    expect((await admin.post('/api/admin/registration/confirm')).status).toBe(200);
  });

  it('a session survives a page refresh (cookie) and a second device can link with the team code', async () => {
    b = await boot();
    const { pin, teams } = await setupEvent(b, { teams: 1 });
    const refreshed = new TeamClient(b.base);
    refreshed.cookies = new Map(teams[0]!.cookies);
    expect((await refreshed.me()).team.name).toBe('Team 1');
    const phone2 = new TeamClient(b.base);
    expect((await phone2.post('/api/team/link', { pin, code: 'ZZZZZZ' })).status).toBe(404);
    const link = await phone2.post('/api/team/link', { pin, code: teams[0]!.state.team.code.toLowerCase() });
    expect(link.status).toBe(201);
    expect(link.json.team.id).toBe(teams[0]!.state.team.id);
    expect(link.json.team.code).toBe(teams[0]!.state.team.code);
    // tampering with the cookie value yields nothing
    const forged = new TeamClient(b.base);
    forged.cookies.set('bb_team', 'AAAA' + [...teams[0]!.cookies.values()][0]!.slice(4));
    expect((await forged.get('/api/team/me')).status).toBe(401);
  });

  it('removed teams lose their session and slot', async () => {
    b = await boot();
    const { admin, pin, teams } = await setupEvent(b, { teams: 2 });
    const id = teams[1]!.state.team.id;
    await admin.post(`/api/admin/teams/${id}/status`, { status: 'removed' });
    expect((await teams[1]!.get('/api/team/me')).status).toBe(401);
    expect((await new TeamClient(b.base).join(pin, 'Team 2')).status).toBe(201); // name is free again
  });

  it('PIN can be changed during setup but not after play starts', async () => {
    b = await boot();
    const { admin } = await setupEvent(b, { teams: 1 });
    expect((await admin.patch('/api/admin/event', { pin: '424242' })).status).toBe(200);
    expect((await adminState(admin)).event.pin).toBe('424242');
    await admin.post('/api/admin/registration/confirm');
    await admin.post('/api/admin/round/prepare');
    await admin.post('/api/admin/round/start');
    expect((await admin.patch('/api/admin/event', { pin: '111111' })).status).toBe(409);
  });
});
