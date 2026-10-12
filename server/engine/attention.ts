import { AWAY_GRACE_MS } from '../../shared/contract.js';
import type { Ctx, EventRow } from './context.js';

/**
 * Once registration is closed, teams are expected to stay on the game screen until the event is over.
 * (Before that people leave the page to scan the QR code or copy the PIN, so it is not watched.)
 */
const WATCHED = new Set(['LOBBY', 'ROUND_READY', 'ROUND_RUNNING', 'ROUND_PAUSED', 'ROUND_ENDED', 'QUALIFICATION']);

export const watching = (ev: EventRow): boolean => WATCHED.has(ev.state);

/** The host-facing value: when the team left the game screen, or null if it is on it (or nobody is being watched). */
export function awaySince(ctx: Ctx, ev: EventRow, teamId: number): number | null {
  return watching(ev) && ctx.isAway(teamId) ? (ctx.awaySince.get(teamId) ?? null) : null;
}

/** Keeps `awaySince` in step with isAway(); records the departure in the audit log when the team is back (or gone). */
function sync(ctx: Ctx, teamId: number, wasAway: boolean): void {
  const isAway = ctx.isAway(teamId);
  if (!wasAway && isAway) ctx.awaySince.set(teamId, ctx.clock.now());
  if (wasAway && !isAway) {
    const since = ctx.awaySince.get(teamId);
    ctx.awaySince.delete(teamId);
    const ev = ctx.currentEvent();
    const ms = since === undefined ? 0 : ctx.clock.now() - since;
    if (ev && watching(ev) && ms >= AWAY_GRACE_MS) {
      const name = ctx.db.get<{ name: string }>('SELECT name FROM teams WHERE id = ?', teamId)?.name ?? '?';
      ctx.audit(ev.id, `team:${teamId}`, 'team.left_screen', { name, seconds: Math.round(ms / 1000) });
    }
  }
  ctx.emit({});
}

/** A phone reported that its game screen was hidden or is visible again. */
export function reportVisibility(ctx: Ctx, teamId: number, socketId: string, visible: boolean): void {
  const wasAway = ctx.isAway(teamId);
  const hidden = ctx.hiddenSockets.get(teamId) ?? new Set<string>();
  if (visible) hidden.delete(socketId);
  else hidden.add(socketId);
  if (hidden.size > 0) ctx.hiddenSockets.set(teamId, hidden);
  else ctx.hiddenSockets.delete(teamId);
  sync(ctx, teamId, wasAway);
}

/** Call after a socket has left `ctx.presence`: forget what it said (a closed phone shows nothing, so it is offline, not away). */
export function forgetSocket(ctx: Ctx, teamId: number, socketId: string, wasAway: boolean): void {
  const hidden = ctx.hiddenSockets.get(teamId);
  if (hidden) {
    hidden.delete(socketId);
    if (hidden.size === 0) ctx.hiddenSockets.delete(teamId);
  }
  sync(ctx, teamId, wasAway);
}

export function clearAttention(ctx: Ctx): void {
  ctx.hiddenSockets.clear();
  ctx.awaySince.clear();
}
