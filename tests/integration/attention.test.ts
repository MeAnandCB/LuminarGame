import { afterEach, describe, expect, it } from 'vitest';
import { AWAY_GRACE_MS, C2S } from '../../shared/contract.js';
import { adminState, boot, connectSocket, setupEvent, sleep, waitFor, type Booted, type TeamClient } from './helpers.js';

let b: Booted;
afterEach(async () => {
  await b?.close();
});

const away = async (admin: Awaited<ReturnType<typeof setupEvent>>['admin'], teamId: number) => (await adminState(admin)).teams.find((t) => t.id === teamId)!.awaySince;
const phone = (t: TeamClient) => connectSocket(b, { role: 'team' }, t.cookieHeader);
const settle = () => sleep(120); // the server coalesces its broadcasts for ~60 ms; the report itself is fire-and-forget

/** Lobby with N teams: the point from which the host expects everyone to stay on the game screen. */
async function lobby(n: number) {
  b = await boot();
  const env = await setupEvent(b, { teams: n });
  await env.admin.post('/api/admin/registration/confirm');
  return env;
}

describe('teams that leave the game screen', () => {
  it('marks a team away while its only phone is hidden, and clears it when the screen is back', async () => {
    const { admin, teams } = await lobby(2);
    const id = teams[0]!.state.team.id;
    const p = await phone(teams[0]!);
    await phone(teams[1]!);
    expect(await away(admin, id)).toBeNull();

    b.clock.advance(1000);
    p.socket.emit(C2S.screenVisibility, { visible: false });
    await settle();
    expect(await away(admin, id)).toBe(b.clock.now());
    expect(await away(admin, teams[1]!.state.team.id)).toBeNull(); // the other team is untouched

    p.socket.emit(C2S.screenVisibility, { visible: true });
    await settle();
    expect(await away(admin, id)).toBeNull();
    p.close();
  });

  it('is host-only: the projector and phones never learn who left', async () => {
    const { teams } = await lobby(1);
    const p = await phone(teams[0]!);
    p.socket.emit(C2S.screenVisibility, { visible: false });
    await settle();
    const pub = (await teams[0]!.get('/api/public/state')).json;
    expect(JSON.stringify(pub)).not.toMatch(/away/i);
    expect(JSON.stringify(await teams[0]!.me())).not.toMatch(/away/i);
    p.close();
  });

  it('a team with two phones is only away when both are hidden', async () => {
    const { admin, teams } = await lobby(1);
    const id = teams[0]!.state.team.id;
    const one = await phone(teams[0]!);
    const two = await phone(teams[0]!);
    one.socket.emit(C2S.screenVisibility, { visible: false });
    await settle();
    expect(await away(admin, id)).toBeNull(); // the teammate's phone still shows the game
    two.socket.emit(C2S.screenVisibility, { visible: false });
    await settle();
    expect(await away(admin, id)).not.toBeNull();
    one.socket.emit(C2S.screenVisibility, { visible: true });
    await settle();
    expect(await away(admin, id)).toBeNull();
    one.close();
    two.close();
  });

  it('a hidden phone that disconnects is offline, not away', async () => {
    const { admin, teams } = await lobby(1);
    const id = teams[0]!.state.team.id;
    const p = await phone(teams[0]!);
    p.socket.emit(C2S.screenVisibility, { visible: false });
    await settle();
    expect(await away(admin, id)).not.toBeNull();
    p.close();
    await waitFor(() => !b.h.ctx.isConnected(id));
    await settle();
    const t = (await adminState(admin)).teams.find((t) => t.id === id)!;
    expect(t).toMatchObject({ connected: false, awaySince: null });
    expect(b.h.ctx.hiddenSockets.size).toBe(0);
  });

  it('only watches once registration is closed (people open other apps to find the PIN or scan the QR code)', async () => {
    b = await boot();
    const { admin, teams } = await setupEvent(b, { teams: 1 }); // registration open
    const id = teams[0]!.state.team.id;
    const p = await phone(teams[0]!);
    p.socket.emit(C2S.screenVisibility, { visible: false });
    await settle();
    expect(await away(admin, id)).toBeNull();
    await admin.post('/api/admin/registration/confirm'); // game state from here on
    await settle();
    expect(await away(admin, id)).not.toBeNull(); // they never came back, so they are still away
    p.close();
  });

  it('stops watching when the event is over', async () => {
    const { admin, teams } = await lobby(1);
    const id = teams[0]!.state.team.id;
    const p = await phone(teams[0]!);
    p.socket.emit(C2S.screenVisibility, { visible: false });
    await settle();
    expect(await away(admin, id)).not.toBeNull();
    b.h.ctx.db.run("UPDATE events SET state = 'EVENT_COMPLETED'");
    expect(await away(admin, id)).toBeNull();
    p.close();
  });

  it('writes an audit entry when a team was away longer than the grace period, and none for a quick glance', async () => {
    const { admin, teams } = await lobby(1);
    const p = await phone(teams[0]!);
    const entries = async () => (await adminState(admin)).audit.filter((a) => a.action === 'team.left_screen');

    p.socket.emit(C2S.screenVisibility, { visible: false });
    await settle();
    b.clock.advance(AWAY_GRACE_MS - 500);
    p.socket.emit(C2S.screenVisibility, { visible: true });
    await settle();
    expect(await entries()).toHaveLength(0);

    p.socket.emit(C2S.screenVisibility, { visible: false });
    await settle();
    b.clock.advance(12_000);
    p.socket.emit(C2S.screenVisibility, { visible: true });
    await settle();
    const [entry] = await entries();
    expect(entry).toMatchObject({ actor: `team:${teams[0]!.state.team.id}` });
    expect(JSON.parse(entry!.details)).toMatchObject({ name: 'Team 1', seconds: 12 });
    p.close();
  });

  it('ignores malformed reports and the reset wipes the bookkeeping', async () => {
    const { admin, teams } = await lobby(1);
    const id = teams[0]!.state.team.id;
    const p = await phone(teams[0]!);
    for (const junk of [null, 'hidden', { visible: 'no' }, {}, [1, 2]]) p.socket.emit(C2S.screenVisibility, junk);
    await settle();
    expect(await away(admin, id)).toBeNull();
    expect(p.socket.connected).toBe(true);

    p.socket.emit(C2S.screenVisibility, { visible: false });
    await settle();
    await admin.post('/api/admin/event/reset', { confirm: 'RESET' });
    expect(b.h.ctx.hiddenSockets.size).toBe(0);
    expect(b.h.ctx.awaySince.size).toBe(0);
    p.close();
  });
});
