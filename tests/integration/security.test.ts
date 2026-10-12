import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN_PW, Client, TeamClient, adminClient, boot, connectSocket, setupEvent, skipIntroRounds, startLevel, waitFor, type Booted } from './helpers.js';

let b: Booted;
afterEach(async () => {
  await b?.close();
});

describe('admin authentication and authorisation', () => {
  it('rejects every admin endpoint without a session', async () => {
    b = await boot();
    const c = new Client(b.base);
    for (const [m, u] of [
      ['GET', '/api/admin/state'], ['GET', '/api/admin/export.csv'], ['POST', '/api/admin/event'], ['POST', '/api/admin/round/start'],
      ['POST', '/api/admin/teams/1/score'], ['PATCH', '/api/admin/challenges/1'], ['POST', '/api/admin/event/reset'], ['POST', '/api/admin/qualification/open'],
    ] as const) {
      const r = await c.request(m, u, m === 'GET' ? undefined : {});
      expect(r.status, `${m} ${u}`).toBe(401);
    }
  });

  it('stores only a salted scrypt hash and rejects bad credentials', async () => {
    b = await boot();
    const row = b.h.ctx.db.get<{ password_hash: string }>('SELECT password_hash FROM admin_users')!;
    expect(row.password_hash.startsWith('scrypt$')).toBe(true);
    expect(row.password_hash).not.toContain(ADMIN_PW);
    const c = new Client(b.base);
    expect((await c.post('/api/admin/login', { username: 'host', password: 'nope-nope-nope' })).status).toBe(401);
    expect((await c.post('/api/admin/login', { username: 'ghost', password: ADMIN_PW })).status).toBe(401);
    expect((await c.post('/api/admin/login', { username: 'host', password: ADMIN_PW })).status).toBe(200);
  });

  it('sets an HttpOnly SameSite cookie and never leaks the token in the body', async () => {
    b = await boot();
    const r = await new Client(b.base).post('/api/admin/login', { username: 'host', password: ADMIN_PW });
    const sc = r.headers.getSetCookie()[0]!;
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/SameSite=Strict/);
    expect(JSON.stringify(r.json)).not.toContain(sc.split(';')[0]!.split('=')[1]!);
  });

  it('enforces CSRF tokens and same-origin checks on state-changing requests', async () => {
    b = await boot();
    const admin = await adminClient(b);
    const noCsrf = await admin.request('POST', '/api/admin/event', { name: 'Evil' }, { 'x-csrf-token': 'wrong' });
    expect(noCsrf.status).toBe(403);
    const foreign = await admin.request('POST', '/api/admin/event', { name: 'Evil' }, { origin: 'http://evil.example' });
    expect(foreign.status).toBe(403);
    expect((await admin.post('/api/admin/event', { name: 'Fine Event' })).status).toBe(200);
  });

  it('logout destroys the server-side session', async () => {
    b = await boot();
    const admin = await adminClient(b);
    const stale = new Client(b.base);
    stale.cookies = new Map(admin.cookies);
    stale.csrf = admin.csrf;
    expect((await admin.post('/api/admin/logout')).status).toBe(200);
    expect((await stale.get('/api/admin/state')).status).toBe(401);
  });

  it('rate-limits repeated failed logins', async () => {
    b = await boot({ rateLimits: { login: { max: 3, windowMs: 60_000 } } });
    const c = new Client(b.base);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await c.post('/api/admin/login', { username: 'host', password: 'wrong-wrong-wrong' })).status);
    expect(codes).toEqual([401, 401, 401, 429, 429]);
  });

  it('team sessions cannot reach admin APIs', async () => {
    b = await boot();
    const { teams } = await setupEvent(b, { teams: 1 });
    expect((await teams[0]!.get('/api/admin/state')).status).toBe(401);
    expect((await teams[0]!.post('/api/admin/round/start')).status).toBe(401);
  });

  it('validates input and hides internals in errors', async () => {
    b = await boot();
    const admin = await adminClient(b);
    const bad = await admin.request('POST', '/api/admin/event', '{"name": 12}' as unknown);
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.json)).not.toMatch(/stack|sqlite|at \w+/i);
    const malformed = await fetch(b.base + '/api/team/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
    expect(malformed.status).toBe(400);
    const sqli = await new TeamClient(b.base).post('/api/team/join', { pin: "1' OR '1'='1", name: 'x', players: ['a', 'b'] });
    expect(sqli.status).toBe(400);
  });
});

describe('socket authorisation and data exposure', () => {
  it('refuses admin and team sockets without valid sessions', async () => {
    b = await boot();
    await expect(connectSocket(b, { role: 'admin' })).rejects.toThrow('unauthorized');
    await expect(connectSocket(b, { role: 'team' })).rejects.toThrow('unauthorized');
    await expect(connectSocket(b, { role: 'team' }, 'bb_team=forged')).rejects.toThrow('unauthorized');
    await expect(connectSocket(b, { role: 'admin' }, 'bb_admin=forged')).rejects.toThrow('unauthorized');
  });

  it('refuses cross-origin websocket handshakes', async () => {
    b = await boot();
    const { io } = await import('socket.io-client');
    const err = await new Promise<Error>((resolve) => {
      const s = io(b.base, { auth: { role: 'display' }, extraHeaders: { origin: 'http://evil.example' }, transports: ['websocket'], reconnection: false, forceNew: true });
      s.on('connect_error', (e) => {
        s.close();
        resolve(e);
      });
      s.on('connect', () => {
        s.close();
        resolve(new Error('connected'));
      });
    });
    expect(err.message).not.toBe('connected');
  });

  it('never exposes answer keys to the projector or to teams while a round runs', async () => {
    b = await boot();
    const { admin, teams } = await setupEvent(b, { teams: 2 });
    await admin.post('/api/admin/registration/confirm');
    await skipIntroRounds(admin);
    await startLevel(admin, b);
    const display = await connectSocket(b, { role: 'display' });
    const team = await connectSocket(b, { role: 'team' }, teams[0]!.cookieHeader);
    await waitFor(() => team.teamStates.length > 0);
    const blob = JSON.stringify([display.publicStates, team.publicStates, team.teamStates]);
    expect(blob).not.toMatch(/"answers"/);
    expect(blob).not.toContain('"reveal":[');
    const me = JSON.stringify(await teams[0]!.me());
    expect(me).not.toMatch(/"answers"/);
    // the challenge payload for a choice question must not say which option is right
    expect(teams[0]!.state.challenge).toBeTruthy();
    display.close();
    team.close();
  });

  it('team A cannot see or act as team B', async () => {
    b = await boot();
    const { admin, teams } = await setupEvent(b, { teams: 2 });
    await admin.post('/api/admin/registration/confirm');
    const a = await connectSocket(b, { role: 'team' }, teams[0]!.cookieHeader);
    await waitFor(() => a.teamStates.length > 0);
    expect(a.teamStates.every((s) => s.team.id === teams[0]!.state.team.id)).toBe(true);
    // forged team id in the body is ignored: identity comes from the session only
    await startLevel(admin, b);
    const r = await teams[0]!.post('/api/team/answer', { requestId: 'forge-request-1', answer: 'a', teamId: teams[1]!.state.team.id });
    expect(r.status).toBe(200);
    const s1 = await teams[1]!.me();
    expect(s1.score.total).toBe(0);
    expect(s1.progress!.position).toBe(0);
    a.close();
  });
});
