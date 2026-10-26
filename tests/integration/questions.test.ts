import { afterEach, describe, expect, it } from 'vitest';
import { TeamClient, adminState, boot, correct, setupEvent, skipIntroRounds, type Booted, type Client } from './helpers.js';

let b: Booted;
afterEach(async () => {
  await b?.close();
});

const round = async (admin: Client, level: number) => (await adminState(admin)).rounds.find((r) => r.level === level)!;
const challenge = async (admin: Client, level: number, position: number) => (await round(admin, level)).challenges[position]!;
const edit = (admin: Client, id: number, body: unknown) => admin.patch(`/api/admin/challenges/${id}`, body);
const pub = async () => (await new TeamClient(b.base).get('/api/public/state')).json;

describe('editing questions and answers in the admin', () => {
  it('a reworded multiple-choice question with a new correct answer is what teams see and what scores', async () => {
    b = await boot();
    const { admin, teams } = await setupEvent(b, { teams: 2 });
    await admin.post('/api/admin/registration/confirm');
    const q = await challenge(admin, 1, 0); // Tech Faces, question 1: "Steve Jobs" is B
    expect(q.answers).toEqual(['b']);
    const r = await edit(admin, q.id, {
      title: 'Face one',
      prompt: 'Who is shown here?',
      options: [{ id: 'a', text: 'Ada Lovelace' }, { id: 'b', text: 'Alan Turing' }, { id: 'c', text: 'Grace Hopper' }, { id: 'd', text: 'Linus Torvalds' }],
      answers: ['c'],
      hint: 'Wrote the first compiler.',
    });
    expect(r.status).toBe(200);
    const after = await challenge(admin, 1, 0);
    expect(after).toMatchObject({ title: 'Face one', prompt: 'Who is shown here?', answers: ['c'], hint: 'Wrote the first compiler.', image: '/faces/01' });
    expect(after.options!.map((o) => o.text)).toEqual(['Ada Lovelace', 'Alan Turing', 'Grace Hopper', 'Linus Torvalds']);

    await admin.post('/api/admin/round/prepare');
    await admin.post('/api/admin/round/start');
    const live = (await pub()).live;
    expect(live).toMatchObject({ title: 'Face one', prompt: 'Who is shown here?' });
    expect(live.options.map((o: { text: string }) => o.text)).toEqual(['Ada Lovelace', 'Alan Turing', 'Grace Hopper', 'Linus Torvalds']);
    expect(JSON.stringify(live)).not.toMatch(/"answers"|"correct":true/); // still no key on the public side
    expect((await teams[0]!.answer('c')).json.outcome).toBe('locked');
    expect((await teams[1]!.answer('b')).json.outcome).toBe('locked'); // the OLD key is now wrong
    // both teams have answered, so the question closed by itself and the reveal is on screen
    expect((await pub()).live.phase).toBe('reveal');
    expect((await pub()).live.reveal).toMatchObject({ correctText: 'Grace Hopper', correctCount: 1, fact: 'Wrote the first compiler.' });
  });

  it('numeric and text answer lists: any listed answer counts, the old one no longer does', async () => {
    b = await boot();
    const { admin, teams } = await setupEvent(b, { teams: 1 });
    await admin.post('/api/admin/registration/confirm');
    const year = await challenge(admin, 3, 2); // "In which year was the first iPhone released?" 2007
    expect(year).toMatchObject({ kind: 'number', answers: ['2007'] });
    expect((await edit(admin, year.id, { prompt: 'In which year did the first iPhone ship?', answers: ['2008', '2009'] })).status).toBe(200);
    await skipIntroRounds(admin);
    await admin.post('/api/admin/round/prepare');
    await admin.post('/api/admin/round/start');
    for (let i = 0; i < 2; i++) await teams[0]!.answer(correct(3, i)); // questions 1-2 untouched
    const t = await teams[0]!.me();
    expect(t.challenge).toMatchObject({ title: 'First iPhone', prompt: 'In which year did the first iPhone ship?' });
    const ok = await teams[0]!.answer('2009');
    expect(ok.json).toMatchObject({ outcome: 'correct' });
  });

  it('the old key stops working: a stale answer is marked wrong', async () => {
    b = await boot();
    const { admin, teams } = await setupEvent(b, { teams: 1 });
    await admin.post('/api/admin/registration/confirm');
    const year = await challenge(admin, 3, 2);
    await edit(admin, year.id, { answers: ['2008'] });
    await skipIntroRounds(admin);
    await admin.post('/api/admin/round/prepare');
    await admin.post('/api/admin/round/start');
    for (let i = 0; i < 2; i++) await teams[0]!.answer(correct(3, i));
    expect((await teams[0]!.answer('2007')).json.outcome).toBe('incorrect');
  });

  it('rejects edits that would leave a question unplayable, changing nothing', async () => {
    b = await boot();
    const { admin } = await setupEvent(b);
    const q = await challenge(admin, 3, 0); // CPU question, options A-D, answer A
    const keep = async () => JSON.stringify(await challenge(admin, 3, 0));
    const before = await keep();
    const bad: [unknown, RegExp][] = [
      [{ answers: ['z'] }, /one of the options/],
      [{ answers: [] }, /at least|array/i],
      [{ prompt: '   ' }, /cannot be empty/],
      [{ title: 'x'.repeat(61) }, /at most 60/],
      [{ options: [{ id: 'a', text: 'Same' }, { id: 'b', text: 'same' }, { id: 'c', text: 'x' }, { id: 'd', text: 'y' }] }, /different text/],
      [{ options: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }] }, /keep its letter/],
      [{ options: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }, { id: 'c', text: 'z' }, { id: 'q', text: 'w' }] }, /keep its letter/],
      [{ kind: 'number' }, /./],
      [{ points: -5 }, /./],
    ];
    for (const [body, msg] of bad) {
      const r = await edit(admin, q.id, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(JSON.stringify(r.json), JSON.stringify(body)).toMatch(msg);
    }
    expect(await keep()).toBe(before);
    const num = await challenge(admin, 3, 2);
    const r = await edit(admin, num.id, { answers: ['about 2007'] });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('BAD_QUESTION');
    expect((await edit(admin, 999999, { prompt: 'Nope' })).status).toBe(404);
  });

  it('is locked once the round has started, but other rounds stay editable', async () => {
    b = await boot();
    const { admin } = await setupEvent(b, { teams: 1 });
    await admin.post('/api/admin/registration/confirm');
    const l1 = await challenge(admin, 1, 3);
    const l3 = await challenge(admin, 3, 0);
    await admin.post('/api/admin/round/prepare');
    await admin.post('/api/admin/round/start');
    const locked = await edit(admin, l1.id, { prompt: 'Too late' });
    expect(locked.status).toBe(409);
    expect(locked.json.error.code).toBe('LOCKED');
    expect((await challenge(admin, 1, 3)).prompt).toBe(l1.prompt);
    expect((await edit(admin, l3.id, { prompt: 'Still open for Level 3' })).status).toBe(200);
    await admin.post('/api/admin/round/end');
    expect((await edit(admin, l1.id, { prompt: 'Also too late after it ended' })).status).toBe(409);
  });

  it('records what changed in the audit log', async () => {
    b = await boot();
    const { admin } = await setupEvent(b);
    const q = await challenge(admin, 3, 0);
    await edit(admin, q.id, { prompt: 'Spell out CPU', answers: ['b'] });
    const s = await adminState(admin);
    const entry = s.audit.find((a) => a.action === 'challenge.update')!;
    const d = JSON.parse(entry.details);
    expect(d).toMatchObject({ challengeId: q.id, level: 3, changed: ['prompt', 'answers'], before: { answers: ['a'] }, after: { prompt: 'Spell out CPU', answers: ['b'] } });
  });

  it('only admins can edit', async () => {
    b = await boot();
    const { admin } = await setupEvent(b);
    const q = await challenge(admin, 3, 0);
    const anon = new TeamClient(b.base);
    expect((await anon.patch(`/api/admin/challenges/${q.id}`, { prompt: 'hacked' })).status).toBe(401);
    expect((await anon.patch('/api/admin/round/2/tiles', { tiles: [] })).status).toBe(401);
  });
});

describe('editing Tech Bingo clues and tiles', () => {
  it('a clue can point at a different tile; the card keeps the same layout', async () => {
    b = await boot();
    const { admin, teams } = await setupEvent(b, { teams: 1 });
    await admin.post('/api/admin/registration/confirm');
    const call = await challenge(admin, 2, 0);
    const tiles = call.options!;
    expect(call.answers).toEqual(['f']); // "Bug"
    const dup = tiles.find((t) => t.id === 'm')!; // Password
    expect((await edit(admin, call.id, { prompt: 'A secret you type to get in', answers: ['m'] })).status).toBe(200);
    expect((await challenge(admin, 2, 0)).answers).toEqual(['m']);
    expect(dup.text).toBe('Password');
    expect((await edit(admin, call.id, { answers: ['f', 'm'] })).status).toBe(400); // one tile per call
    expect((await edit(admin, call.id, { options: tiles.map((t) => ({ id: t.id, text: t.text })) })).status).toBe(400); // tiles live on the round
    void teams;
  });

  it('renaming the shared tiles updates every call and every team card, and refuses bad plans', async () => {
    b = await boot();
    const { admin, teams } = await setupEvent(b, { teams: 2 });
    await admin.post('/api/admin/registration/confirm');
    const tiles = (await challenge(admin, 2, 0)).options!.map((t) => ({ id: t.id, text: t.text, icon: (t as { icon?: string }).icon ?? '' }));
    expect(tiles).toHaveLength(16);
    const renamed = tiles.map((t) => (t.id === 'a' ? { ...t, text: 'Java', icon: '☕' } : t));
    expect((await admin.patch('/api/admin/round/2/tiles', { tiles: renamed })).status).toBe(200);
    const r = await round(admin, 2);
    for (const c of r.challenges) expect(c.options!.find((t) => t.id === 'a')).toMatchObject({ text: 'Java', icon: '☕' });
    const audit = JSON.parse((await adminState(admin)).audit.find((a) => a.action === 'bingo.tiles')!.details);
    expect(audit.tiles).toContain('☕ Java');

    const dupName = tiles.map((t) => (t.id === 'b' ? { ...t, text: 'Python' } : t));
    expect((await admin.patch('/api/admin/round/2/tiles', { tiles: dupName })).status).toBe(400);
    expect((await admin.patch('/api/admin/round/2/tiles', { tiles: tiles.slice(0, 15) })).status).toBe(400);
    expect((await admin.patch('/api/admin/round/2/tiles', { tiles: renamed.map((t) => (t.id === 'p' ? { ...t, id: 'z' } : t)) })).status).toBe(400);
    expect((await admin.patch('/api/admin/round/1/tiles', { tiles })).status).toBe(409); // Level 1 has no tiles
    expect((await admin.patch('/api/admin/round/2/tiles', { tiles: renamed, extra: 1 })).status).toBe(400);

    // the rename reaches the phones
    await admin.post('/api/admin/round/prepare');
    await admin.post('/api/admin/round/start');
    await admin.post('/api/admin/round/end');
    await admin.post('/api/admin/round/prepare');
    await admin.post('/api/admin/round/start');
    const me = await teams[0]!.me();
    expect(me.live!.bingo!.tiles.find((t) => t.id === 'a')).toMatchObject({ text: 'Java', icon: '☕' });

    // locked once the round runs
    expect((await admin.patch('/api/admin/round/2/tiles', { tiles })).status).toBe(409);
  });

  it('two calls naming the same tile are caught before the round can start', async () => {
    b = await boot();
    const { admin } = await setupEvent(b, { teams: 1 });
    await admin.post('/api/admin/registration/confirm');
    const a = await challenge(admin, 2, 0);
    const c = await challenge(admin, 2, 1);
    expect((await edit(admin, c.id, { answers: a.answers })).status).toBe(200); // saving is allowed so the host can swap two calls
    await admin.post('/api/admin/round/prepare'); // level 1
    await admin.post('/api/admin/round/start');
    await admin.post('/api/admin/round/end');
    const r = await admin.post('/api/admin/round/prepare');
    expect(r.status).toBe(409);
    expect(r.json.error.message).toMatch(/different tile/);
  });
});
