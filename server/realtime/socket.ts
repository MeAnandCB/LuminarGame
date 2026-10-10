import type http from 'node:http';
import { Server, type Socket } from 'socket.io';
import { C2S, S2C, type Announcement, type TimerSync } from '../../shared/contract.js';
import { AppError, type ChangeSignal, type Ctx, type TeamRow } from '../engine/context.js';
import * as events from '../engine/events.js';
import * as play from '../engine/play.js';
import { computeStandings } from '../engine/standings.js';
import { resolveTeamSession } from '../engine/teams.js';
import { adminState, publicState, teamState } from '../engine/views.js';
import { resolveAdminSession } from '../http/auth.js';
import { ADMIN_COOKIE, TEAM_COOKIE, parseCookies, type RateLimiter } from '../http/middleware.js';
import { answerSchema } from '../http/schemas.js';

export interface Realtime {
  io: Server;
  /** Flush pending broadcasts immediately (used by tests). */
  flush(): void;
  /** Run one ticker step (deadline check, heartbeat, timer sync). */
  tick(): void;
  stop(): void;
}

type Role = 'team' | 'admin' | 'display';
interface SocketData {
  role: Role;
  teamId?: number;
  sessionId?: number;
}

type Ack<T> = (res: { ok: true; result: T } | { ok: false; error: { code: string; message: string } }) => void;

function fail(ack: unknown, e: unknown): void {
  if (typeof ack !== 'function') return;
  if (e instanceof AppError) (ack as Ack<never>)({ ok: false, error: { code: e.code, message: e.message } });
  else if (e && typeof e === 'object' && 'issues' in e) (ack as Ack<never>)({ ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid request.' } });
  else {
    console.error('[socket error]', e);
    (ack as Ack<never>)({ ok: false, error: { code: 'INTERNAL', message: 'Something went wrong. Please retry.' } });
  }
}

export function attachRealtime(p: { server: http.Server; ctx: Ctx; limiters: { answer: RateLimiter; hint: RateLimiter }; manualTicker: boolean }): Realtime {
  const { ctx } = p;
  const io = new Server(p.server, {
    serveClient: false,
    maxHttpBufferSize: 10_000,
    // Same-origin only: browsers always send Origin on WebSocket upgrades.
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      if (!origin) return cb(null, true);
      try {
        cb(null, new URL(origin).host === req.headers.host);
      } catch {
        cb(null, false);
      }
    },
  });

  io.use((socket, next) => {
    const role = socket.handshake.auth?.role as Role | undefined;
    const cookies = parseCookies(socket.handshake.headers.cookie);
    if (role === 'display') {
      socket.data = { role } satisfies SocketData;
      return next();
    }
    if (role === 'admin') {
      if (!resolveAdminSession(ctx, cookies[ADMIN_COOKIE])) return next(new Error('unauthorized'));
      socket.data = { role } satisfies SocketData;
      return next();
    }
    if (role === 'team') {
      const s = resolveTeamSession(ctx, cookies[TEAM_COOKIE]);
      if (!s) return next(new Error('unauthorized'));
      socket.data = { role, teamId: s.team.id, sessionId: s.sessionId } satisfies SocketData;
      return next();
    }
    next(new Error('unauthorized'));
  });

  // ---- coalesced broadcasting ---------------------------------------------------
  let pendingAll = false;
  const pendingTeams = new Set<number>();
  let timer: NodeJS.Timeout | null = null;
  const announcements: Announcement[] = [];
  const kicks = new Set<number>();

  function teamRoom(id: number) {
    return `team:${id}`;
  }

  function sendTeam(team: TeamRow, standings?: ReturnType<typeof computeStandings>) {
    io.to(teamRoom(team.id)).emit(S2C.teamState, teamState(ctx, team, standings));
  }

  function flush() {
    timer = null;
    const ev = ctx.currentEvent();
    for (const id of kicks) {
      io.to(teamRoom(id)).emit(S2C.sessionEnded, {});
      io.in(teamRoom(id)).disconnectSockets(true);
    }
    kicks.clear();
    io.to('public').emit(S2C.publicState, publicState(ctx));
    if (io.sockets.adapter.rooms.get('admin')?.size) io.to('admin').emit(S2C.adminState, adminState(ctx));
    if (ev) {
      const standings = computeStandings(ctx, ev);
      const targets = pendingAll
        ? [...io.sockets.adapter.rooms.keys()].filter((r) => r.startsWith('team:')).map((r) => Number(r.slice(5)))
        : [...pendingTeams];
      for (const id of targets) {
        const team = ctx.db.get<TeamRow>('SELECT * FROM teams WHERE id = ? AND event_id = ?', id, ev.id);
        if (team) sendTeam(team, standings);
      }
    }
    pendingAll = false;
    pendingTeams.clear();
    for (const a of announcements.splice(0)) io.to('public').emit(S2C.announce, a);
  }

  const unsub = ctx.onChange((c: ChangeSignal) => {
    if (c.teams === 'all') pendingAll = true;
    else c.teams?.forEach((t) => pendingTeams.add(t));
    c.kick?.forEach((t) => kicks.add(t));
    if (c.announce) announcements.push(c.announce);
    timer ??= setTimeout(flush, 60);
  });

  io.on('connection', (socket: Socket) => {
    const data = socket.data as SocketData;
    socket.join(data.role === 'admin' ? 'admin' : 'public');
    socket.emit(S2C.publicState, publicState(ctx));

    if (data.role === 'admin') {
      const s = adminState(ctx);
      if (s) socket.emit(S2C.adminState, s);
      return;
    }
    if (data.role !== 'team' || !data.teamId) return;

    const teamId = data.teamId;
    socket.join(teamRoom(teamId));
    const set = ctx.presence.get(teamId) ?? new Set<string>();
    set.add(socket.id);
    ctx.presence.set(teamId, set);
    const team = ctx.db.get<TeamRow>('SELECT * FROM teams WHERE id = ?', teamId);
    if (team) socket.emit(S2C.teamState, teamState(ctx, team));
    ctx.emit({});

    // Every handler re-checks the live session: a removed/reset team cannot keep acting on an old socket.
    const guard = (): { teamId: number; sessionId: number } => {
      const row = ctx.db.get<{ team_id: number }>('SELECT team_id FROM team_sessions WHERE id = ?', data.sessionId);
      if (!row) throw new AppError(401, 'NO_SESSION', 'Your session has ended. Please join again.');
      return { teamId, sessionId: data.sessionId! };
    };

    socket.on(C2S.submitAnswer, (payload: unknown, ack: unknown) => {
      try {
        const g = guard();
        if (!p.limiters.answer.take(`t${g.teamId}`)) throw new AppError(429, 'RATE_LIMITED', 'Slow down a little.');
        const body = answerSchema.parse(payload);
        const result = play.submitAnswer(ctx, { ...g, ...body });
        if (typeof ack === 'function') (ack as Ack<typeof result>)({ ok: true, result });
      } catch (e) {
        fail(ack, e);
      }
    });

    socket.on(C2S.requestHint, (_payload: unknown, ack: unknown) => {
      try {
        const g = guard();
        if (!p.limiters.hint.take(`t${g.teamId}`)) throw new AppError(429, 'RATE_LIMITED', 'Slow down a little.');
        const result = play.requestHint(ctx, g.teamId);
        if (typeof ack === 'function') (ack as Ack<typeof result>)({ ok: true, result });
      } catch (e) {
        fail(ack, e);
      }
    });

    socket.on('disconnect', () => {
      const s = ctx.presence.get(teamId);
      s?.delete(socket.id);
      if (s && s.size === 0) ctx.presence.delete(teamId);
      ctx.emit({});
    });
  });

  // ---- ticker -------------------------------------------------------------------
  let lastSync = 0;
  const tickOnce = () => {
    try {
      events.tick(ctx);
      const now = ctx.clock.now();
      if (now - lastSync >= 5000) {
        lastSync = now;
        const ev = ctx.currentEvent();
        const round = ev ? ctx.currentRound(ev) : undefined;
        const sync: TimerSync = {
          serverNow: now,
          roundId: round?.id ?? null,
          status: round?.status ?? null,
          deadlineAt: round?.status === 'running' ? round.deadline_at : null,
          remainingMs: round ? Math.max(0, round.status === 'running' ? (round.deadline_at ?? now) - now : (round.remaining_ms ?? 0)) : 0,
        };
        io.to('public').emit(S2C.timerSync, sync);
      }
    } catch (e) {
      console.error('[ticker]', e);
    }
  };
  const interval = p.manualTicker ? null : setInterval(tickOnce, 500);

  return {
    io,
    flush: () => {
      if (timer) clearTimeout(timer);
      flush();
    },
    tick: tickOnce,
    stop: () => {
      if (interval) clearInterval(interval);
      if (timer) clearTimeout(timer);
      unsub();
    },
  };
}
