import { checkAnswer } from '../game/normalize.js';
import { speedBonus, timeBonus } from '../game/scoring.js';
import { acceptsSubmissions, elapsedClock, remainingAt } from '../game/timer.js';
import { AppError, type ChallengeRow, type Ctx, type EventRow, type RoundRow, type TeamRow } from './context.js';
import type { AnswerOutcome, AnswerResult } from '../../shared/types.js';

export interface SubmitInput {
  teamId: number;
  sessionId: number | null;
  requestId: string;
  answer: string;
  challengeId?: number;
}

interface ProgressRow {
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

function resultFor(requestId: string, outcome: AnswerOutcome, points: number, advanced: boolean, message: string, duplicate = false): AnswerResult {
  return { requestId, outcome, points, message, advanced, ...(duplicate ? { duplicate: true } : {}) };
}

export function eligibleForRound(team: TeamRow, round: RoundRow): boolean {
  return team.status === 'approved' && (round.level < 3 || team.qualified === 1);
}

export function submitAnswer(ctx: Ctx, input: SubmitInput): AnswerResult {
  const result = ctx.db.tx(() => {
    const now = ctx.clock.now();
    const prior = ctx.db.get<{ outcome: AnswerOutcome; points: number; round_id: number }>('SELECT outcome, points, round_id FROM answer_submissions WHERE team_id = ? AND request_id = ?', input.teamId, input.requestId);
    if (prior) {
      const kind = ctx.round(prior.round_id).kind;
      const advanced = prior.outcome === 'correct' || (kind === 'quiz' && prior.outcome === 'incorrect');
      return resultFor(input.requestId, prior.outcome, prior.points, advanced, 'This answer was already received.', true);
    }

    const team = ctx.db.get<TeamRow>('SELECT * FROM teams WHERE id = ?', input.teamId);
    const ev = ctx.currentEvent();
    if (!team || !ev || team.event_id !== ev.id) throw new AppError(403, 'NO_SESSION', 'Your team is not part of the current event.');
    if (team.status !== 'approved') throw new AppError(403, 'NOT_APPROVED', 'Your team has not been approved.');
    const round = ctx.currentRound(ev);
    if (!round || !['ROUND_RUNNING', 'ROUND_PAUSED', 'ROUND_ENDED'].includes(ev.state)) throw new AppError(409, 'NOT_RUNNING', 'No round is running right now.');
    if (!eligibleForRound(team, round)) throw new AppError(403, 'NOT_ELIGIBLE', 'Only finalists can play this round.');

    const cfg = ctx.roundConfig(round);
    const items = ctx.challenges(round.id);
    const progress = ensureProgress(ctx, team.id, round.id);
    if (progress.position >= items.length) throw new AppError(409, 'FINISHED', 'You have already completed this round.');
    const current = items[progress.position]!;
    const target: ChallengeRow | undefined = input.challengeId === undefined ? current : items.find((c) => c.id === input.challengeId);
    if (!target) throw new AppError(400, 'BAD_CHALLENGE', 'That question does not belong to this round.');

    const record = (outcome: AnswerOutcome, normalized: string, points = 0): number =>
      ctx.db.run(
        'INSERT INTO answer_submissions (event_id, round_id, challenge_id, team_id, session_id, request_id, raw_answer, normalized, outcome, points, received_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        ev.id,
        round.id,
        target.id,
        team.id,
        input.sessionId,
        input.requestId,
        input.answer,
        normalized,
        outcome,
        points,
        now,
        ctx.nowIso(),
      ).lastId;

    // Timing policy (documented in README): inclusive deadline, server clock only.
    if (ev.state === 'ROUND_PAUSED') {
      record('rejected', '');
      return resultFor(input.requestId, 'rejected', 0, false, 'The round is paused. Hold on until the host resumes.');
    }
    if (ev.state === 'ROUND_ENDED' || !acceptsSubmissions(ctx.timer(round), now)) {
      record('late', '');
      return resultFor(input.requestId, 'late', 0, false, "Time's up - this answer arrived after the deadline and was not scored.");
    }
    if (target.id !== current.id) {
      record('rejected', '');
      return resultFor(input.requestId, 'rejected', 0, false, target.position > current.position ? 'That stage is still locked.' : 'That question is already complete.');
    }

    const check = checkAnswer(target.kind, input.answer, JSON.parse(target.answers) as string[]);
    const timer = ctx.timer(round);
    const clock = elapsedClock(timer, now);
    const last = progress.position + 1 >= items.length;
    const advance = (finished: boolean) =>
      ctx.db.run('UPDATE team_stage_progress SET position = position + 1, unlocked_clock_ms = ?, finished_at = ? WHERE team_id = ? AND round_id = ?', clock, finished ? now : null, team.id, round.id);

    if (check.correct) {
      const id = record('correct', check.normalized);
      let total = 0;
      const give = (kind: string, points: number, key: string) => {
        if (award(ctx, { ev, teamId: team.id, roundId: round.id, challengeId: target.id, kind, points, key, actor: `team:${team.id}` })) total += points;
      };
      give('answer', target.points, `answer:${team.id}:${target.id}`);
      if (round.kind === 'quiz') give('speed_bonus', speedBonus(cfg.speedBonusMax, cfg.speedWindowSec * 1000, clock - progress.unlocked_clock_ms), `speed:${team.id}:${target.id}`);
      if (last && round.kind === 'puzzle') {
        give('completion_bonus', cfg.completionBonus, `completion:${team.id}:${round.id}`);
        give('time_bonus', timeBonus(cfg.timeBonusMax, timer.durationMs, remainingAt(timer, now)), `timebonus:${team.id}:${round.id}`);
      }
      ctx.db.run('UPDATE answer_submissions SET points = ? WHERE id = ?', total, id);
      advance(last);
      return resultFor(input.requestId, 'correct', total, true, last ? `Correct! +${total}. You finished the round!` : `Correct! +${total}`);
    }

    const id = record('incorrect', check.normalized);
    let lost = 0;
    if (cfg.wrongPenalty > 0 && award(ctx, { ev, teamId: team.id, roundId: round.id, challengeId: target.id, kind: 'wrong_penalty', points: -cfg.wrongPenalty, key: `wrong:${id}`, actor: `team:${team.id}` })) lost = -cfg.wrongPenalty;
    ctx.db.run('UPDATE answer_submissions SET points = ? WHERE id = ?', lost, id);
    if (round.kind === 'quiz') {
      advance(last);
      return resultFor(input.requestId, 'incorrect', lost, true, last ? 'Incorrect. That was the last question.' : 'Incorrect. Moving on to the next question.');
    }
    return resultFor(input.requestId, 'incorrect', lost, false, lost ? `Incorrect code (${lost}). Try again.` : 'Incorrect code. Try again.');
  });
  ctx.emit({ teams: [input.teamId] });
  return result;
}

export interface HintResult {
  text: string;
  penaltyApplied: number;
  alreadyUsed: boolean;
}

export function requestHint(ctx: Ctx, teamId: number): HintResult {
  const out = ctx.db.tx(() => {
    const team = ctx.db.get<TeamRow>('SELECT * FROM teams WHERE id = ?', teamId);
    const ev = ctx.currentEvent();
    if (!team || !ev || team.event_id !== ev.id || team.status !== 'approved') throw new AppError(403, 'NO_SESSION', 'Your team is not part of the current event.');
    const round = ctx.currentRound(ev);
    if (!round || ev.state !== 'ROUND_RUNNING') throw new AppError(409, 'NOT_RUNNING', 'Hints are only available while a round is running.');
    if (!eligibleForRound(team, round)) throw new AppError(403, 'NOT_ELIGIBLE', 'Only finalists can play this round.');
    const cfg = ctx.roundConfig(round);
    if (!cfg.hintsEnabled) throw new AppError(403, 'HINTS_DISABLED', 'Hints are disabled for this round.');
    if (!acceptsSubmissions(ctx.timer(round), ctx.clock.now())) throw new AppError(409, 'NOT_RUNNING', 'Time is up.');
    const items = ctx.challenges(round.id);
    const progress = ensureProgress(ctx, team.id, round.id);
    const current = items[progress.position];
    if (!current) throw new AppError(409, 'FINISHED', 'You have already completed this round.');
    if (!current.hint) throw new AppError(404, 'NO_HINT', 'There is no hint for this stage.');
    const inserted = ctx.db.run('INSERT OR IGNORE INTO hints_used (team_id, challenge_id, created_at) VALUES (?,?,?)', team.id, current.id, ctx.nowIso()).changes === 1;
    let penalty = 0;
    if (inserted && cfg.hintPenalty > 0) {
      if (award(ctx, { ev, teamId: team.id, roundId: round.id, challengeId: current.id, kind: 'hint_penalty', points: -cfg.hintPenalty, key: `hint:${team.id}:${current.id}`, actor: `team:${team.id}`, reason: 'hint used' })) penalty = cfg.hintPenalty;
    }
    return { text: current.hint, penaltyApplied: penalty, alreadyUsed: !inserted };
  });
  ctx.emit({ teams: [teamId] });
  return out;
}
