import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request } from 'express';
import { Db } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { Ctx, systemClock, type AppConfig, type Clock } from '../engine/context.js';
import * as events from '../engine/events.js';
import * as teams from '../engine/teams.js';
import * as play from '../games/index.js';
import * as live from '../games/live.js';
import * as admin from '../engine/admin.js';
import { adminState, publicState, teamState } from '../engine/views.js';
import * as auth from './auth.js';
import { ADMIN_COOKIE, TEAM_COOKIE, RateLimiter, clearCookie, cookieHeader, errorHandler, limit, originCheck, parseCookies, requireAdmin, requireTeam } from './middleware.js';
import * as S from './schemas.js';
import { attachRealtime, type Realtime } from '../realtime/socket.js';

export interface AppOptions {
  dbPath: string;
  clock?: Clock;
  config?: Partial<AppConfig>;
  /** Disable the background ticker (tests drive time themselves). */
  manualTicker?: boolean;
  /** Override rate limits (tests / load tests). */
  rateLimits?: Partial<Record<'join' | 'link' | 'login' | 'answer' | 'hint', { max: number; windowMs: number }>>;
  webDir?: string;
}

export interface AppHandle {
  ctx: Ctx;
  app: express.Express;
  server: http.Server;
  realtime: Realtime;
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

const ip = (req: Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown';

function findWebDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const c of [path.resolve(here, '../../../web'), path.resolve(here, '../../dist/web'), path.resolve(process.cwd(), 'dist/web')]) {
    if (fs.existsSync(path.join(c, 'index.html'))) return c;
  }
  return null;
}

export function createApp(opts: AppOptions): AppHandle {
  const clock = opts.clock ?? systemClock;
  const config: AppConfig = { nodeEnv: 'production', publicUrl: null, adminSessionHours: 12, cookieSecure: false, port: 3000, ...opts.config };
  const db = new Db(opts.dbPath);
  migrate(db);
  const ctx = new Ctx(db, clock, config);
  ctx.joinUrlFor = (pin) => {
    const base = config.publicUrl ?? `http://${lanAddresses()[0] ?? 'localhost'}:${config.port}`;
    return `${base.replace(/\/$/, '')}/join?pin=${pin}`;
  };
  events.recoverAfterRestart(ctx);

  const rl = {
    join: new RateLimiter(opts.rateLimits?.join?.max ?? 100, opts.rateLimits?.join?.windowMs ?? 60_000),
    link: new RateLimiter(opts.rateLimits?.link?.max ?? 30, opts.rateLimits?.link?.windowMs ?? 60_000),
    login: new RateLimiter(opts.rateLimits?.login?.max ?? 8, opts.rateLimits?.login?.windowMs ?? 600_000),
    answer: new RateLimiter(opts.rateLimits?.answer?.max ?? 12, opts.rateLimits?.answer?.windowMs ?? 10_000),
    hint: new RateLimiter(opts.rateLimits?.hint?.max ?? 10, opts.rateLimits?.hint?.windowMs ?? 60_000),
  };

  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; frame-ancestors 'none'");
    next();
  });
  app.use(express.json({ limit: '20kb' }));
  app.use('/api', originCheck);

  const api = express.Router();
  app.use('/api', api);
  const secure = config.cookieSecure;
  const needAdmin = requireAdmin(ctx);
  const needTeam = requireTeam(ctx);
  const actor = (req: Request) => `admin:${req.admin!.username}`;

  // ---- public -----------------------------------------------------------------
  api.get('/health', (_req, res) => {
    res.json({ ok: true, time: clock.now() });
  });
  api.get('/public/state', (_req, res) => {
    res.json(publicState(ctx));
  });
  api.get('/public/event', limit(rl.link, ip), (req, res) => {
    const pin = S.pinSchema.safeParse(req.query.pin);
    const ev = ctx.currentEvent();
    if (!pin.success || !ev || ev.pin !== pin.data) {
      res.json({ found: false });
      return;
    }
    res.json({ found: true, name: ev.name, registrationOpen: ev.state === 'REGISTRATION_OPEN' });
  });

  // ---- team -------------------------------------------------------------------
  const setTeamCookie = (res: express.Response, token: string) =>
    res.setHeader('Set-Cookie', cookieHeader(TEAM_COOKIE, token, { maxAgeSec: 3 * 86400, sameSite: 'Lax', secure }));

  api.post('/team/join', limit(rl.join, ip), (req, res) => {
    const body = S.joinSchema.parse(req.body);
    const { token, team } = teams.joinTeam(ctx, body);
    setTeamCookie(res, token);
    res.status(201).json(teamState(ctx, team));
  });
  api.post('/team/link', limit(rl.link, ip), (req, res) => {
    const body = S.linkSchema.parse(req.body);
    const { token, team } = teams.linkDevice(ctx, body.pin, body.code);
    setTeamCookie(res, token);
    res.status(201).json(teamState(ctx, team));
  });
  api.get('/team/me', needTeam, (req, res) => {
    teams.touchSession(ctx, req.teamSession!.sessionId);
    res.json(teamState(ctx, req.teamSession!.team));
  });
  api.post('/team/answer', needTeam, limit(rl.answer, (r) => `t${r.teamSession!.team.id}`), (req, res) => {
    const body = S.answerSchema.parse(req.body);
    const s = req.teamSession!;
    res.json(play.submitAnswer(ctx, { teamId: s.team.id, sessionId: s.sessionId, ...body }));
  });
  api.post('/team/skip', needTeam, limit(rl.answer, (r) => `t${r.teamSession!.team.id}`), (req, res) => {
    const body = S.skipSchema.parse(req.body);
    const s = req.teamSession!;
    res.json(play.skipQuestion(ctx, { teamId: s.team.id, sessionId: s.sessionId, ...body }));
  });
  api.post('/team/hint', needTeam, limit(rl.hint, (r) => `t${r.teamSession!.team.id}`), (req, res) => {
    res.json(play.requestHint(ctx, req.teamSession!.team.id));
  });
  api.post('/team/logout', (req, res) => {
    const session = teams.resolveTeamSession(ctx, parseCookies(req.headers.cookie)[TEAM_COOKIE]);
    if (session) ctx.db.run('DELETE FROM team_sessions WHERE id = ?', session.sessionId);
    res.setHeader('Set-Cookie', clearCookie(TEAM_COOKIE));
    res.json({ ok: true });
  });

  // ---- admin auth ---------------------------------------------------------------
  api.post('/admin/login', limit(rl.login, ip, 'Too many sign-in attempts. Wait a few minutes.'), async (req, res) => {
    const body = S.loginSchema.parse(req.body);
    const { token, csrf, username } = await auth.login(ctx, body.username, body.password);
    res.setHeader('Set-Cookie', cookieHeader(ADMIN_COOKIE, token, { maxAgeSec: config.adminSessionHours * 3600, sameSite: 'Strict', secure }));
    res.json({ username, csrfToken: csrf });
  });
  api.post('/admin/logout', needAdmin, (req, res) => {
    auth.logout(ctx, req.adminToken);
    res.setHeader('Set-Cookie', clearCookie(ADMIN_COOKIE));
    res.json({ ok: true });
  });
  api.get('/admin/me', needAdmin, (req, res) => {
    res.json({ username: req.admin!.username, csrfToken: req.admin!.csrf });
  });

  // ---- admin game control (every route is behind needAdmin) ---------------------
  const adm = express.Router();
  api.use('/admin', needAdmin, adm);
  adm.get('/state', (_req, res) => {
    res.json(adminState(ctx));
  });
  adm.get('/export.csv', (_req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="brainbyte-results.csv"');
    res.send('﻿' + admin.exportCsv(ctx));
  });
  const ok = (res: express.Response) => res.json({ ok: true });

  adm.post('/event', (req, res) => {
    const b = S.createEventSchema.parse(req.body);
    events.createEvent(ctx, actor(req), b);
    ctx.emit({ teams: 'all' });
    ok(res);
  });
  adm.patch('/event', (req, res) => {
    events.updateEvent(ctx, actor(req), S.updateEventSchema.parse(req.body));
    ok(res);
  });
  adm.post('/event/reset', (req, res) => {
    S.resetSchema.parse(req.body);
    events.resetEvent(ctx, actor(req));
    ok(res);
  });
  adm.post('/event/complete', (req, res) => {
    events.completeEvent(ctx, actor(req));
    ok(res);
  });
  adm.post('/registration/open', (req, res) => {
    events.openRegistration(ctx, actor(req));
    ok(res);
  });
  adm.post('/registration/pause', (req, res) => {
    events.pauseRegistration(ctx, actor(req));
    ok(res);
  });
  adm.post('/registration/confirm', (req, res) => {
    events.confirmTeams(ctx, actor(req));
    ok(res);
  });
  adm.post('/teams/:id/status', (req, res) => {
    teams.setTeamStatus(ctx, actor(req), Number(req.params.id), S.teamStatusSchema.parse(req.body).status);
    ok(res);
  });
  adm.post('/teams/:id/score', (req, res) => {
    const b = S.scoreSchema.parse(req.body);
    res.json({ total: admin.adjustScore(ctx, actor(req), Number(req.params.id), b.points, b.reason) });
  });
  adm.post('/round/prepare', (req, res) => {
    events.prepareRound(ctx, actor(req));
    ok(res);
  });
  adm.post('/round/start', (req, res) => {
    events.startRound(ctx, actor(req));
    ok(res);
  });
  adm.post('/round/pause', (req, res) => {
    events.pauseRound(ctx, actor(req));
    ok(res);
  });
  adm.post('/round/resume', (req, res) => {
    events.resumeRound(ctx, actor(req));
    ok(res);
  });
  adm.post('/round/end', (req, res) => {
    events.endRound(ctx, actor(req));
    ok(res);
  });
  adm.post('/round/live/advance', (req, res) => {
    live.hostAdvance(ctx, actor(req));
    ok(res);
  });
  adm.post('/round/live/skip', (req, res) => {
    live.hostSkip(ctx, actor(req));
    ok(res);
  });
  adm.post('/round/:level/reveal', (req, res) => {
    events.revealAnswers(ctx, actor(req), Number(req.params.level), S.revealSchema.parse(req.body).reveal);
    ok(res);
  });
  adm.patch('/round/:level/config', (req, res) => {
    res.json(admin.updateRoundConfig(ctx, actor(req), Number(req.params.level), S.configPatchSchema.parse(req.body)));
  });
  adm.patch('/challenges/:id', (req, res) => {
    admin.updateChallenge(ctx, actor(req), Number(req.params.id), S.challengePatchSchema.parse(req.body));
    ok(res);
  });
  adm.post('/qualification/open', (req, res) => {
    res.json({ finalists: events.openQualification(ctx, actor(req)) });
  });

  api.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown endpoint.' } });
  });

  // ---- static frontend ---------------------------------------------------------
  const webDir = opts.webDir ?? findWebDir();
  if (webDir) {
    app.use(express.static(webDir, { index: false, maxAge: '1h', setHeaders: (res, p) => p.endsWith('.html') && res.setHeader('Cache-Control', 'no-cache') }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/socket.io')) return next();
      // A missing file (e.g. a face photo that was not added) must be a real 404, not the app shell.
      if (path.extname(req.path)) {
        res.status(404).end();
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(webDir, 'index.html'));
    });
  }
  app.use(errorHandler());

  const server = http.createServer(app);
  const realtime = attachRealtime({ server, ctx, limiters: { answer: rl.answer, hint: rl.hint }, manualTicker: opts.manualTicker ?? false });

  return {
    ctx,
    app,
    server,
    realtime,
    listen: (port, host = '0.0.0.0') =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve((server.address() as { port: number }).port));
      }),
    close: async () => {
      realtime.stop();
      await new Promise<void>((r) => {
        realtime.io.close(() => r());
      });
      if (server.listening) await new Promise<void>((r) => server.close(() => r()));
      db.close();
    },
  };
}
