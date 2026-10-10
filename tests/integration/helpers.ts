import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { createApp, type AppHandle, type AppOptions } from '../../server/http/app.js';
import { createAdmin } from '../../server/http/auth.js';
import { SEED_ROUNDS } from '../../server/content/seed.js';
import type { AdminState, AnswerResult, PublicState, TeamState } from '../../shared/types.js';

export class TestClock {
  t = 1_700_000_000_000;
  now() {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
}

export const ADMIN_PW = 'correct-horse-battery';

export interface Booted {
  h: AppHandle;
  clock: TestClock;
  base: string;
  port: number;
  dbPath: string;
  close(): Promise<void>;
}

export async function boot(opts: Partial<AppOptions> & { dbPath?: string; withAdmin?: boolean } = {}): Promise<Booted> {
  const dbPath = opts.dbPath ?? path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bb-')), 'test.db');
  const clock = (opts.clock as TestClock | undefined) ?? new TestClock();
  const h = createApp({
    dbPath,
    clock,
    manualTicker: true,
    rateLimits: { join: { max: 1000, windowMs: 60_000 }, answer: { max: 1000, windowMs: 10_000 }, hint: { max: 1000, windowMs: 10_000 }, link: { max: 1000, windowMs: 60_000 }, ...opts.rateLimits },
    config: { port: 0, ...opts.config },
    webDir: undefined,
  });
  if (opts.withAdmin !== false && !h.ctx.db.get('SELECT 1 FROM admin_users')) await createAdmin(h.ctx, 'host', ADMIN_PW);
  const port = await h.listen(0, '127.0.0.1');
  return { h, clock, base: `http://127.0.0.1:${port}`, port, dbPath, close: () => h.close() };
}

/** Minimal cookie-aware HTTP client. */
export class Client {
  cookies = new Map<string, string>();
  csrf: string | null = null;
  constructor(
    readonly base: string,
    readonly headers: Record<string, string> = {},
  ) {}

  get cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request(method: string, url: string, body?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { ...this.headers, ...extra };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.cookies.size) headers.cookie = this.cookieHeader;
    if (this.csrf && method !== 'GET' && !('x-csrf-token' in headers)) headers['x-csrf-token'] = this.csrf;
    const res = await fetch(this.base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(';');
      const i = pair!.indexOf('=');
      const name = pair!.slice(0, i);
      const value = decodeURIComponent(pair!.slice(i + 1));
      if (/Max-Age=0/i.test(sc) || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not json */
    }
    return { status: res.status, json, text, headers: res.headers };
  }
  get = (u: string, extra?: Record<string, string>) => this.request('GET', u, undefined, extra);
  post = (u: string, b?: unknown, extra?: Record<string, string>) => this.request('POST', u, b ?? {}, extra);
  patch = (u: string, b: unknown) => this.request('PATCH', u, b);
}

export async function adminClient(b: Booted): Promise<Client> {
  const c = new Client(b.base);
  const r = await c.post('/api/admin/login', { username: 'host', password: ADMIN_PW });
  if (r.status !== 200) throw new Error('admin login failed ' + JSON.stringify(r.json));
  c.csrf = r.json.csrfToken;
  return c;
}

export const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export class TeamClient extends Client {
  state!: TeamState;
  async join(pin: string, name: string, players: [string, string] = ['Alice', 'Bob']) {
    const r = await this.post('/api/team/join', { pin, name, players });
    if (r.status === 201) this.state = r.json;
    return r;
  }
  async me(): Promise<TeamState> {
    const r = await this.get('/api/team/me');
    this.state = r.json;
    return r.json;
  }
  async answer(answer: string, extra: { requestId?: string; challengeId?: number } = {}) {
    const r = await this.post('/api/team/answer', { requestId: extra.requestId ?? uid(), answer, ...(extra.challengeId ? { challengeId: extra.challengeId } : {}) });
    return r as { status: number; json: AnswerResult & { error?: { code: string } } };
  }
  async hint() {
    return this.post('/api/team/hint');
  }
}

/** Right answer text for the n-th challenge of a level, straight from the seed definitions. */
export function correct(level: number, position: number): string {
  const c = SEED_ROUNDS[level - 1]!.challenges[position]!;
  return c.answers[0]!;
}
export function wrong(level: number, position: number): string {
  const c = SEED_ROUNDS[level - 1]!.challenges[position]!;
  if (c.kind === 'choice') return c.answers[0] === 'a' ? 'b' : 'a';
  if (c.kind === 'number') return '-999';
  return 'WRONGANSWER';
}

export async function setupEvent(b: Booted, opts: { teams?: number; settings?: Record<string, unknown> } = {}) {
  const admin = await adminClient(b);
  await admin.post('/api/admin/event', { name: 'Test Arena' });
  const state = (await admin.get('/api/admin/state')).json as AdminState;
  if (opts.settings) await admin.patch('/api/admin/event', { settings: opts.settings });
  await admin.post('/api/admin/registration/open');
  const teams: TeamClient[] = [];
  for (let i = 0; i < (opts.teams ?? 0); i++) {
    const t = new TeamClient(b.base);
    const r = await t.join(state.event.pin, `Team ${i + 1}`, [`P${i}a`, `P${i}b`]);
    if (r.status !== 201) throw new Error('join failed ' + JSON.stringify(r.json));
    teams.push(t);
  }
  return { admin, pin: state.event.pin, teams };
}

export async function startLevel(admin: Client, b: Booted) {
  await admin.post('/api/admin/round/prepare');
  await admin.post('/api/admin/round/start');
  void b;
}

export const adminState = async (admin: Client) => (await admin.get('/api/admin/state')).json as AdminState;

export interface SockHandle {
  socket: Socket;
  publicStates: PublicState[];
  teamStates: TeamState[];
  adminStates: AdminState[];
  events: { name: string; data: unknown }[];
  close(): void;
}

export function connectSocket(b: Booted, auth: { role: 'team' | 'admin' | 'display' }, cookie?: string): Promise<SockHandle> {
  return new Promise((resolve, reject) => {
    const socket = io(b.base, { auth, extraHeaders: cookie ? { cookie } : {}, transports: ['websocket'], reconnection: false, forceNew: true });
    const h: SockHandle = { socket, publicStates: [], teamStates: [], adminStates: [], events: [], close: () => socket.close() };
    socket.on('state:public', (s) => h.publicStates.push(s));
    socket.on('team:state', (s) => h.teamStates.push(s));
    socket.on('admin:state', (s) => h.adminStates.push(s));
    socket.onAny((name, data) => h.events.push({ name, data }));
    socket.on('connect', () => resolve(h));
    socket.on('connect_error', (e) => reject(e));
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function waitFor<T>(fn: () => T | undefined | false, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await sleep(20);
  }
}
