import type { AnswerOutcome, AnswerResult } from '../../shared/types.js';
import type { Ctx, EventRow, RoundRow, TeamRow } from '../engine/context.js';

export interface ProgressRow {
  team_id: number;
  round_id: number;
  position: number;
  unlocked_clock_ms: number;
  finished_at: number | null;
}

export function ensureProgress(ctx: Ctx, teamId: number, roundId: number): ProgressRow {
  ctx.db.run('INSERT OR IGNORE INTO team_stage_progress (team_id, round_id, position, unlocked_clock_ms) VALUES (?,?,0,0)', teamId, roundId);
  return ctx.db.get<ProgressRow>('SELECT * FROM team_stage_progress WHERE team_id = ? AND round_id = ?', teamId, roundId)!;
}

/** Appends to the ledger exactly once per idempotency key. Returns whether a row was written. */
export function award(
  ctx: Ctx,
  p: { ev: EventRow; teamId: number; roundId: number | null; challengeId: number | null; kind: string; points: number; key: string; actor: string; reason?: string },
): boolean {
  if (p.points === 0) return false;
  const r = ctx.db.run(
    'INSERT OR IGNORE INTO score_ledger (event_id, team_id, round_id, challenge_id, kind, points, reason, actor, idempotency_key, at_ms, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    p.ev.id,
    p.teamId,
    p.roundId,
    p.challengeId,
    p.kind,
    p.points,
    p.reason ?? null,
    p.actor,
    p.key,
    ctx.nextSeq(),
    ctx.nowIso(),
  );
  return r.changes === 1;
}

export function result(requestId: string, outcome: AnswerOutcome, points: number, advanced: boolean, message: string, duplicate = false): AnswerResult {
  return { requestId, outcome, points, message, advanced, ...(duplicate ? { duplicate: true } : {}) };
}

/**
 * Why a team may not play a round, or null when it may. Teams the host cut after an earlier level sit out
 * every later round, and the Final Showdown is for finalists only.
 */
export function eligibilityProblem(team: TeamRow, round: RoundRow): string | null {
  if (team.status !== 'approved') return 'Your team has not been approved.';
  if (team.out_level !== null && round.level > team.out_level) return `Your team was cut after Level ${team.out_level} and is not playing this round.`;
  if (round.kind === 'showdown' && team.qualified !== 1) return 'Only finalists can play this round.';
  return null;
}

export const eligibleForRound = (team: TeamRow, round: RoundRow): boolean => eligibilityProblem(team, round) === null;

export interface SubmitInput {
  teamId: number;
  sessionId: number | null;
  requestId: string;
  answer: string;
  challengeId?: number;
  doubleDown?: boolean;
}
