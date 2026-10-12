/**
 * Round cut-offs. After Level 1, 2 or 3 the host may keep only the top N teams (Event tab -> Advancement).
 * A cut team is stamped with `teams.out_level` = the level it was cut after; it plays no later round and ranks
 * below every team that got further. The cut after Level 4 is the finalist qualification (events.ts), not this.
 *
 * The cut is applied the moment the round ends and stays adjustable (score corrections, a different N) until the
 * next round is prepared. Re-applying is idempotent: it first clears the stamp it set and then ranks again.
 */
import { CUTOFF_LEVELS } from '../../shared/types.js';
import { selectFinalists } from '../game/ranking.js';
import type { Ctx, EventRow, RoundRow } from './context.js';
import { computeStandings } from './standings.js';

export const isCutoffLevel = (level: number): boolean => (CUTOFF_LEVELS as readonly number[]).includes(level);

/** How many teams carry on after `level`; null when the host set no cut there. */
export function advanceCount(ctx: Ctx, ev: EventRow, level: number): number | null {
  return isCutoffLevel(level) ? (ctx.settings(ev).advance[level - 1] ?? null) : null;
}

/** The cut after `level` is final once that round has ended and the host has moved on to prepare the next one. */
export function cutoffLocked(ctx: Ctx, ev: EventRow, level: number): boolean {
  const round = ctx.rounds(ev.id).find((r) => r.level === level);
  if (!round || round.status !== 'ended') return false;
  return !(ev.state === 'ROUND_ENDED' && ev.current_round_id === round.id);
}

/** Ranks the teams still in and cuts everyone below the top N. Returns the names of the teams that were cut. */
export function applyCutoff(ctx: Ctx, evRow: EventRow, level: number, actor: string): string[] {
  if (!isCutoffLevel(level)) return [];
  const ev = ctx.event(evRow.id); // the caller's row may predate a settings change
  ctx.db.run('UPDATE teams SET out_level = NULL WHERE event_id = ? AND out_level = ?', ev.id, level);
  const keep = advanceCount(ctx, ev, level);
  if (keep === null) return [];
  // Teams cut by an earlier level carry a worse tier, so they never compete for a place here.
  const standing = computeStandings(ctx, ev).filter((s) => s.outLevel === null);
  const kept = new Set(selectFinalists(standing, keep));
  const cut = standing.filter((s) => !kept.has(s.teamId));
  for (const s of cut) ctx.db.run('UPDATE teams SET out_level = ? WHERE id = ?', level, s.teamId);
  ctx.audit(ev.id, actor, 'cutoff.apply', { level, keep, kept: kept.size, out: cut.map((s) => s.name) });
  return cut.map((s) => s.name);
}

/** Right after a round ends: how many teams carry on and how many were cut. Null when nobody was cut. */
export function cutoffSummary(ctx: Ctx, ev: EventRow, round: RoundRow | undefined): { afterLevel: number; kept: number; out: number } | null {
  if (!round || ev.state !== 'ROUND_ENDED' || !isCutoffLevel(round.level)) return null;
  const count = (cond: string, ...args: number[]) => ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM teams WHERE event_id = ? AND status = 'approved' AND ${cond}`, ev.id, ...args)!.n;
  const out = count('out_level = ?', round.level);
  return out > 0 ? { afterLevel: round.level, kept: count('out_level IS NULL'), out } : null;
}
