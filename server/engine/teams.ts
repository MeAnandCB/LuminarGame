import crypto from 'node:crypto';
import { AppError, hashToken, newToken, type Ctx, type TeamRow } from './context.js';
import type { TeamStatus } from '../../shared/types.js';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function nameKey(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function newTeamCode(ctx: Ctx, eventId: number): string {
  for (let i = 0; i < 50; i++) {
    let code = '';
    for (let j = 0; j < 6; j++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!ctx.db.get('SELECT 1 FROM teams WHERE event_id = ? AND team_code = ?', eventId, code)) return code;
  }
  throw new AppError(500, 'CODE_EXHAUSTED', 'Could not generate a team code.');
}

export interface JoinInput {
  pin: string;
  name: string;
  players: [string, string];
}

function createSession(ctx: Ctx, teamId: number): string {
  const token = newToken();
  ctx.db.run('INSERT INTO team_sessions (team_id, token_hash, created_at, last_seen_at) VALUES (?,?,?,?)', teamId, hashToken(token), ctx.nowIso(), ctx.nowIso());
  return token;
}

/** Registers a team. State, capacity and name checks all happen inside one transaction. */
export function joinTeam(ctx: Ctx, input: JoinInput): { token: string; team: TeamRow } {
  const result = ctx.db.tx(() => {
    const ev = ctx.currentEvent();
    if (!ev || ev.pin !== input.pin) throw new AppError(404, 'BAD_PIN', 'That room PIN was not found. Check the screen and try again.');
    if (ev.state !== 'REGISTRATION_OPEN') throw new AppError(409, 'REGISTRATION_CLOSED', 'Registration is closed.');
    const settings = ctx.settings(ev);
    const active = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM teams WHERE event_id = ? AND status IN ('pending','approved')", ev.id)!.n;
    if (active >= settings.maxTeams) throw new AppError(409, 'EVENT_FULL', `All ${settings.maxTeams} team slots are taken.`);
    const key = nameKey(input.name);
    if (ctx.db.get("SELECT 1 FROM teams WHERE event_id = ? AND name_key = ? AND status IN ('pending','approved')", ev.id, key)) {
      throw new AppError(409, 'NAME_TAKEN', 'Another team already uses that name. Please choose a different one.');
    }
    const status: TeamStatus = settings.autoApprove ? 'approved' : 'pending';
    const code = newTeamCode(ctx, ev.id);
    let id: number;
    try {
      id = ctx.db.run('INSERT INTO teams (event_id, name, name_key, player1, player2, team_code, status, created_at) VALUES (?,?,?,?,?,?,?,?)', ev.id, input.name, key, input.players[0], input.players[1], code, status, ctx.nowIso()).lastId;
    } catch (e) {
      if (String((e as Error).message).includes('UNIQUE')) throw new AppError(409, 'NAME_TAKEN', 'Another team already uses that name. Please choose a different one.');
      throw e;
    }
    const token = createSession(ctx, id);
    ctx.audit(ev.id, `team:${id}`, 'team.join', { name: input.name, status });
    return { token, team: ctx.db.get<TeamRow>('SELECT * FROM teams WHERE id = ?', id)! };
  });
  ctx.emit({ teams: [result.team.id] });
  return result;
}

/** A second phone joins an existing team using the team's private code. */
export function linkDevice(ctx: Ctx, pin: string, code: string): { token: string; team: TeamRow } {
  const result = ctx.db.tx(() => {
    const ev = ctx.currentEvent();
    if (!ev || ev.pin !== pin) throw new AppError(404, 'BAD_PIN', 'That room PIN was not found.');
    const team = ctx.db.get<TeamRow>("SELECT * FROM teams WHERE event_id = ? AND team_code = ? AND status IN ('pending','approved')", ev.id, code.trim().toUpperCase());
    if (!team) throw new AppError(404, 'BAD_CODE', 'That team code was not recognised.');
    const count = ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM team_sessions WHERE team_id = ?', team.id)!.n;
    if (count >= 6) throw new AppError(409, 'TOO_MANY_DEVICES', 'This team already has the maximum number of devices.');
    ctx.audit(ev.id, `team:${team.id}`, 'team.link_device');
    return { token: createSession(ctx, team.id), team };
  });
  ctx.emit({ teams: [result.team.id] });
  return result;
}

export interface TeamSession {
  team: TeamRow;
  sessionId: number;
}

export function resolveTeamSession(ctx: Ctx, token: string | undefined): TeamSession | null {
  if (!token || token.length > 100) return null;
  const row = ctx.db.get<{ sid: number; team_id: number }>('SELECT s.id AS sid, s.team_id FROM team_sessions s WHERE s.token_hash = ?', hashToken(token));
  if (!row) return null;
  const team = ctx.db.get<TeamRow>('SELECT t.* FROM teams t JOIN events e ON e.id = t.event_id WHERE t.id = ? AND e.archived = 0', row.team_id);
  if (!team) return null;
  return { team, sessionId: row.sid };
}

export function touchSession(ctx: Ctx, sessionId: number): void {
  ctx.db.run('UPDATE team_sessions SET last_seen_at = ? WHERE id = ?', ctx.nowIso(), sessionId);
}

export function setTeamStatus(ctx: Ctx, actor: string, teamId: number, status: 'approved' | 'rejected' | 'removed'): void {
  const ev = ctx.requireEvent();
  const team = ctx.db.get<TeamRow>('SELECT * FROM teams WHERE id = ? AND event_id = ?', teamId, ev.id);
  if (!team) throw new AppError(404, 'NO_TEAM', 'Team not found.');
  const early = ev.state === 'SETUP' || ev.state === 'REGISTRATION_OPEN' || ev.state === 'LOBBY';
  if (!early) throw new AppError(409, 'LOCKED', 'Teams can only be approved, rejected or removed before the first round starts.');
  ctx.db.tx(() => {
    if (status === 'approved') {
      const active = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM teams WHERE event_id = ? AND status IN ('pending','approved') AND id <> ?", ev.id, team.id)!.n;
      if (team.status !== 'pending' && team.status !== 'approved' && active >= ctx.settings(ev).maxTeams) throw new AppError(409, 'EVENT_FULL', 'No free team slot.');
      try {
        ctx.db.run('UPDATE teams SET status = ? WHERE id = ?', status, team.id);
      } catch {
        throw new AppError(409, 'NAME_TAKEN', 'Another active team already uses that name.');
      }
    } else {
      ctx.db.run('UPDATE teams SET status = ?, qualified = 0 WHERE id = ?', status, team.id);
      if (status === 'removed') ctx.db.run('DELETE FROM team_sessions WHERE team_id = ?', team.id);
    }
    ctx.audit(ev.id, actor, `team.${status}`, { teamId, name: team.name });
  });
  ctx.emit({ teams: [teamId], kick: status === 'removed' ? [teamId] : undefined });
}
