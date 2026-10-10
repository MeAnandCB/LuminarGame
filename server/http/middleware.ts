import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { AppError, type Ctx } from '../engine/context.js';
import { InvalidTransitionError } from '../game/stateMachine.js';
import { resolveAdminSession, type AdminSession } from './auth.js';
import { resolveTeamSession, type TeamSession } from '../engine/teams.js';

export const ADMIN_COOKIE = 'bb_admin';
export const TEAM_COOKIE = 'bb_team';

declare module 'express-serve-static-core' {
  interface Request {
    admin?: AdminSession;
    teamSession?: TeamSession;
    adminToken?: string;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      /* ignore malformed cookie */
    }
  }
  return out;
}

export function cookieHeader(name: string, value: string, opts: { maxAgeSec: number; sameSite: 'Strict' | 'Lax'; secure: boolean }): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=${opts.sameSite}; Max-Age=${opts.maxAgeSec}${opts.secure ? '; Secure' : ''}`;
}

export const clearCookie = (name: string): string => `${name}=; Path=/; HttpOnly; Max-Age=0`;

/** Sliding-window limiter, in memory. Good enough for a single-process LAN deployment. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private max: number,
    private windowMs: number,
    private now: () => number = Date.now,
  ) {}
  take(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.sweep(t);
    return true;
  }
  private sweep(t: number) {
    for (const [k, v] of this.hits) if (v.every((x) => t - x >= this.windowMs)) this.hits.delete(k);
  }
}

export function limit(limiter: RateLimiter, keyOf: (req: Request) => string, message = 'Too many requests. Slow down and try again shortly.'): RequestHandler {
  return (req, _res, next) => (limiter.take(keyOf(req)) ? next() : next(new AppError(429, 'RATE_LIMITED', message)));
}

/** Rejects cross-origin state-changing requests (CSRF defence in depth on top of SameSite cookies). */
export const originCheck: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      return next(new AppError(403, 'BAD_ORIGIN', 'Request origin not allowed.'));
    }
    if (host !== req.headers.host) return next(new AppError(403, 'BAD_ORIGIN', 'Request origin not allowed.'));
  }
  if (req.headers['content-length'] !== '0' && req.headers['content-length'] !== undefined && !req.is('application/json')) {
    return next(new AppError(415, 'BAD_CONTENT_TYPE', 'JSON required.'));
  }
  next();
};

export const requireAdmin = (ctx: Ctx): RequestHandler => (req, _res, next) => {
  const token = parseCookies(req.headers.cookie)[ADMIN_COOKIE];
  const session = resolveAdminSession(ctx, token);
  if (!session) return next(new AppError(401, 'UNAUTHENTICATED', 'Please sign in as admin.'));
  if (!['GET', 'HEAD'].includes(req.method)) {
    const sent = String(req.headers['x-csrf-token'] ?? '');
    const a = Buffer.from(sent);
    const b = Buffer.from(session.csrf);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return next(new AppError(403, 'BAD_CSRF', 'Missing or invalid CSRF token. Reload the page.'));
  }
  req.admin = session;
  req.adminToken = token;
  next();
};

export const requireTeam = (ctx: Ctx): RequestHandler => (req, _res, next) => {
  const session = resolveTeamSession(ctx, parseCookies(req.headers.cookie)[TEAM_COOKIE]);
  if (!session) return next(new AppError(401, 'NO_SESSION', 'Your session has ended. Please join again.'));
  req.teamSession = session;
  next();
};

export function errorHandler(): (err: unknown, req: Request, res: Response, next: NextFunction) => void {
  return (err, _req, res, _next) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err instanceof InvalidTransitionError) {
      res.status(409).json({ error: { code: 'INVALID_STATE', message: `That action is not available right now (the event is in ${err.from}).` } });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: { code: 'INVALID_INPUT', message: err.issues[0] ? `${err.issues[0].path.join('.') || 'input'}: ${err.issues[0].message}` : 'Invalid input.' } });
      return;
    }
    const e = err as { type?: string; status?: number };
    if (e?.type === 'entity.parse.failed' || e?.type === 'entity.too.large') {
      res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed request body.' } });
      return;
    }
    console.error('[error]', err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on the server. Please retry.' } });
  };
}
