import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { Ctx } from '../engine/context.js';
import { AppError, hashToken, newToken } from '../engine/context.js';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const MIN_PASSWORD_LENGTH = 10;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 32, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export async function createAdmin(ctx: Ctx, username: string, password: string): Promise<void> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) throw new Error('Username must be 3-32 characters (letters, digits, . _ -).');
  const hash = await hashPassword(password);
  ctx.db.run('INSERT INTO admin_users (username, password_hash, created_at) VALUES (?,?,?)', username, hash, ctx.nowIso());
}

export async function resetAdminPassword(ctx: Ctx, username: string, password: string): Promise<void> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  const user = ctx.db.get<{ id: number }>('SELECT id FROM admin_users WHERE username = ?', username);
  if (!user) throw new Error(`No admin named "${username}".`);
  const hash = await hashPassword(password);
  ctx.db.tx(() => {
    ctx.db.run('UPDATE admin_users SET password_hash = ? WHERE id = ?', hash, user.id);
    ctx.db.run('DELETE FROM admin_sessions WHERE admin_id = ?', user.id); // sign out everywhere
  });
}

// A fixed hash so unknown usernames cost the same time as wrong passwords.
let dummyHash: Promise<string> | null = null;

export async function login(ctx: Ctx, username: string, password: string): Promise<{ token: string; csrf: string; username: string }> {
  const user = ctx.db.get<{ id: number; username: string; password_hash: string }>('SELECT id, username, password_hash FROM admin_users WHERE username = ?', username);
  dummyHash ??= hashPassword('not-a-real-password');
  const ok = await verifyPassword(password, user?.password_hash ?? (await dummyHash));
  if (!user || !ok) {
    ctx.audit(null, 'anonymous', 'admin.login_failed', { username });
    throw new AppError(401, 'BAD_CREDENTIALS', 'Incorrect username or password.');
  }
  const token = newToken();
  const csrf = newToken(16);
  const expires = ctx.clock.now() + ctx.config.adminSessionHours * 3600_000;
  ctx.db.run('INSERT INTO admin_sessions (admin_id, token_hash, csrf_token, expires_at, created_at) VALUES (?,?,?,?,?)', user.id, hashToken(token), csrf, expires, ctx.nowIso());
  ctx.db.run('DELETE FROM admin_sessions WHERE expires_at < ?', ctx.clock.now());
  ctx.audit(null, user.username, 'admin.login');
  return { token, csrf, username: user.username };
}

export interface AdminSession {
  username: string;
  csrf: string;
  sessionId: number;
}

export function resolveAdminSession(ctx: Ctx, token: string | undefined): AdminSession | null {
  if (!token || token.length > 100) return null;
  const row = ctx.db.get<{ id: number; username: string; csrf_token: string; expires_at: number }>(
    'SELECT s.id, u.username, s.csrf_token, s.expires_at FROM admin_sessions s JOIN admin_users u ON u.id = s.admin_id WHERE s.token_hash = ?',
    hashToken(token),
  );
  if (!row || row.expires_at < ctx.clock.now()) return null;
  return { username: row.username, csrf: row.csrf_token, sessionId: row.id };
}

export function logout(ctx: Ctx, token: string | undefined): void {
  if (token) ctx.db.run('DELETE FROM admin_sessions WHERE token_hash = ?', hashToken(token));
}
