/**
 * Local load test: 20 teams register, connect over Socket.IO and submit answers at (nearly) the same instant.
 *
 *   1. Start the server with a spare database and a high answer rate limit:
 *        DB_PATH=./data/loadtest.db RATE_LIMIT_ANSWER_MAX=1000 npm start
 *   2. Create an admin for it (npm run admin:create -- host) and run:
 *        ADMIN_USER=host ADMIN_PASSWORD=... npm run loadtest -- http://localhost:3000
 *
 * It creates a NEW event (archiving the current one), so never point it at a live event.
 */
import { io, type Socket } from 'socket.io-client';
import { SEED_ROUNDS } from '../server/content/seed.js';

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const TEAMS = Number(process.env.TEAMS ?? 20);
const user = process.env.ADMIN_USER ?? 'host';
const password = process.env.ADMIN_PASSWORD;
if (!password) {
  console.error('Set ADMIN_PASSWORD (and optionally ADMIN_USER).');
  process.exit(1);
}

class Http {
  cookies = new Map<string, string>();
  csrf = '';
  async call(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (this.csrf && method !== 'GET') headers['x-csrf-token'] = this.csrf;
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(';');
      const i = pair!.indexOf('=');
      this.cookies.set(pair!.slice(0, i), decodeURIComponent(pair!.slice(i + 1)));
    }
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
    return json;
  }
}

const pct = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]!;

async function main() {
  const admin = new Http();
  admin.csrf = (await admin.call('POST', '/api/admin/login', { username: user, password })).csrfToken;
  await admin.call('POST', '/api/admin/event', { name: `Load test ${new Date().toISOString()}` });
  await admin.call('POST', '/api/admin/registration/open');
  const pin = (await admin.call('GET', '/api/admin/state')).event.pin as string;

  const t0 = performance.now();
  const teams = await Promise.all(
    Array.from({ length: TEAMS }, async (_, i) => {
      const h = new Http();
      await h.call('POST', '/api/team/join', { pin, name: `Load Team ${i + 1}`, players: ['A', 'B'] });
      return h;
    }),
  );
  console.log(`registered ${TEAMS} teams in ${(performance.now() - t0).toFixed(0)} ms`);

  await admin.call('POST', '/api/admin/registration/confirm');
  await admin.call('POST', '/api/admin/round/prepare');
  await admin.call('POST', '/api/admin/round/start');

  const sockets: Socket[] = await Promise.all(
    teams.map(
      (h) =>
        new Promise<Socket>((resolve, reject) => {
          const s = io(base, { auth: { role: 'team' }, extraHeaders: { cookie: [...h.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }, transports: ['websocket'], forceNew: true });
          s.on('connect', () => resolve(s));
          s.on('connect_error', reject);
        }),
    ),
  );
  const display = io(base, { auth: { role: 'display' }, transports: ['websocket'], forceNew: true });
  let displayUpdates = 0;
  display.on('state:public', () => displayUpdates++);

  const questions = SEED_ROUNDS[0]!.challenges;
  const latencies: number[] = [];
  let failures = 0;
  let wrongScores = 0;
  for (let q = 0; q < questions.length; q++) {
    const answer = questions[q]!.answers[0]!;
    const start = performance.now();
    await Promise.all(
      sockets.map(
        (s, i) =>
          new Promise<void>((resolve) => {
            const sent = performance.now();
            s.emit('answer:submit', { requestId: `lt-${i}-${q}-${Math.random().toString(36).slice(2)}`, answer }, (ack: { ok: boolean; result?: { outcome: string } }) => {
              latencies.push(performance.now() - sent);
              if (!ack.ok) failures++;
              else if (ack.result?.outcome !== 'correct') wrongScores++;
              resolve();
            });
          }),
      ),
    );
    void start;
  }
  await new Promise((r) => setTimeout(r, 500));

  const state = await admin.call('GET', '/api/admin/state');
  const expected = questions.reduce((n, c) => n + c.points, 0);
  const totals = (state.leaderboard as { total: number }[]).map((r) => r.total);
  const allAtLeast = totals.every((t) => t >= expected && t <= expected + 10 * questions.length);

  console.log(`${TEAMS} teams x ${questions.length} questions = ${latencies.length} simultaneous-burst submissions`);
  console.log(`ack latency ms  p50=${pct(latencies, 50).toFixed(1)}  p95=${pct(latencies, 95).toFixed(1)}  max=${Math.max(...latencies).toFixed(1)}`);
  console.log(`failures=${failures} unexpected-outcomes=${wrongScores} displayUpdates=${displayUpdates}`);
  console.log(`scores: min=${Math.min(...totals)} max=${Math.max(...totals)} expected base=${expected} (+speed bonus) -> ${allAtLeast ? 'OK' : 'MISMATCH'}`);
  sockets.forEach((s) => s.close());
  display.close();
  await admin.call('POST', '/api/admin/round/end');
  if (failures || wrongScores || !allAtLeast) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
