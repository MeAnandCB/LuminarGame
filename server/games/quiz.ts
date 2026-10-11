/**
 * Level 1 - Quick Brain. Self-paced: each team walks through the questions at its own speed,
 * one answer per question (wrong answers and skips still use the question up).
 */
import { checkAnswer } from '../game/normalize.js';
import { speedBonus } from '../game/scoring.js';
import { acceptsSubmissions, elapsedClock } from '../game/timer.js';
import { AppError, type ChallengeRow, type Ctx, type TeamRow } from '../engine/context.js';
import type { AnswerOutcome, AnswerResult } from '../../shared/types.js';
import { award, eligibleForRound, ensureProgress, result, type SubmitInput } from './shared.js';

export function submitQuiz(ctx: Ctx, input: SubmitInput): AnswerResult {
  const out = ctx.db.tx(() => {
    const now = ctx.clock.now();
    const prior = ctx.db.get<{ outcome: AnswerOutcome; points: number }>('SELECT outcome, points FROM answer_submissions WHERE team_id = ? AND request_id = ?', input.teamId, input.requestId);
    if (prior) return result(input.requestId, prior.outcome, prior.points, prior.outcome === 'correct' || prior.outcome === 'incorrect' || prior.outcome === 'skipped', 'This answer was already received.', true);

    const team = ctx.db.get<TeamRow>('SELECT * FROM teams WHERE id = ?', input.teamId);
    const ev = ctx.currentEvent();
    if (!team || !ev || team.event_id !== ev.id) throw new AppError(403, 'NO_SESSION', 'Your team is not part of the current event.');
    if (team.status !== 'approved') throw new AppError(403, 'NOT_APPROVED', 'Your team has not been approved.');
    const round = ctx.currentRound(ev);
    if (!round || round.kind !== 'quiz' || !['ROUND_RUNNING', 'ROUND_PAUSED', 'ROUND_ENDED'].includes(ev.state)) throw new AppError(409, 'NOT_RUNNING', 'No round is running right now.');
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
        ev.id, round.id, target.id, team.id, input.sessionId, input.requestId, input.answer, normalized, outcome, points, now, ctx.nowIso(),
      ).lastId;

    // Timing policy: inclusive deadline, server clock only.
    if (ev.state === 'ROUND_PAUSED') {
      record('rejected', '');
      return result(input.requestId, 'rejected', 0, false, 'The round is paused. Hold on until the host resumes.');
    }
    if (ev.state === 'ROUND_ENDED' || !acceptsSubmissions(ctx.timer(round), now)) {
      record('late', '');
      return result(input.requestId, 'late', 0, false, "Time's up - this answer arrived after the deadline and was not scored.");
    }
    if (target.id !== current.id) {
      record('rejected', '');
      return result(input.requestId, 'rejected', 0, false, target.position > current.position ? 'That question is still locked.' : 'That question is already complete.');
    }

    const check = checkAnswer(target.kind, input.answer, JSON.parse(target.answers) as string[]);
    const timer = ctx.timer(round);
    const clock = elapsedClock(timer, now);
    const last = progress.position + 1 >= items.length;
    const advance = () => ctx.db.run('UPDATE team_stage_progress SET position = position + 1, unlocked_clock_ms = ?, finished_at = ? WHERE team_id = ? AND round_id = ?', clock, last ? now : null, team.id, round.id);

    if (check.correct) {
      const id = record('correct', check.normalized);
      let total = 0;
      const give = (kind: string, points: number, key: string) => {
        if (award(ctx, { ev, teamId: team.id, roundId: round.id, challengeId: target.id, kind, points, key, actor: `team:${team.id}` })) total += points;
      };
      give('answer', target.points, `answer:${team.id}:${target.id}`);
      give('speed_bonus', speedBonus(cfg.speedBonusMax, cfg.speedWindowSec * 1000, clock - progress.unlocked_clock_ms), `speed:${team.id}:${target.id}`);
      ctx.db.run('UPDATE answer_submissions SET points = ? WHERE id = ?', total, id);
      advance();
      return result(input.requestId, 'correct', total, true, last ? `Correct! +${total}. You finished the round!` : `Correct! +${total}`);
    }

    const id = record('incorrect', check.normalized);
    let lost = 0;
    if (cfg.wrongPenalty > 0 && award(ctx, { ev, teamId: team.id, roundId: round.id, challengeId: target.id, kind: 'wrong_penalty', points: -cfg.wrongPenalty, key: `wrong:${id}`, actor: `team:${team.id}` })) lost = -cfg.wrongPenalty;
    ctx.db.run('UPDATE answer_submissions SET points = ? WHERE id = ?', lost, id);
    advance();
    return result(input.requestId, 'incorrect', lost, true, last ? 'Incorrect. That was the last question.' : 'Incorrect. Moving on to the next question.');
  });
  ctx.emit({ teams: [input.teamId] });
  return out;
}

/** A team gives up on the current question: no points, no penalty, on to the next one. */
export function skipQuiz(ctx: Ctx, input: { teamId: number; sessionId: number | null; requestId: string; challengeId?: number }): AnswerResult {
  const out = ctx.db.tx(() => {
    const now = ctx.clock.now();
    const prior = ctx.db.get<{ outcome: AnswerOutcome }>('SELECT outcome FROM answer_submissions WHERE team_id = ? AND request_id = ?', input.teamId, input.requestId);
    if (prior) return result(input.requestId, prior.outcome, 0, prior.outcome === 'skipped', 'This skip was already received.', true);
    const team = ctx.db.get<TeamRow>('SELECT * FROM teams WHERE id = ?', input.teamId);
    const ev = ctx.currentEvent();
    if (!team || !ev || team.event_id !== ev.id || team.status !== 'approved') throw new AppError(403, 'NO_SESSION', 'Your team is not part of the current event.');
    const round = ctx.currentRound(ev);
    if (!round || round.kind !== 'quiz' || ev.state !== 'ROUND_RUNNING') throw new AppError(409, 'NOT_RUNNING', 'Skipping is only possible while the quiz is running.');
    const cfg = ctx.roundConfig(round);
    if (!cfg.allowSkip) throw new AppError(403, 'SKIP_DISABLED', 'The host has disabled skipping for this round.');
    if (!acceptsSubmissions(ctx.timer(round), now)) throw new AppError(409, 'NOT_RUNNING', 'Time is up.');
    const items = ctx.challenges(round.id);
    const progress = ensureProgress(ctx, team.id, round.id);
    const current = items[progress.position];
    if (!current) throw new AppError(409, 'FINISHED', 'You have already completed this round.');
    if (input.challengeId !== undefined && input.challengeId !== current.id) throw new AppError(409, 'STALE', 'That question is no longer active.');
    ctx.db.run(
      "INSERT INTO answer_submissions (event_id, round_id, challenge_id, team_id, session_id, request_id, raw_answer, normalized, outcome, points, received_at, created_at) VALUES (?,?,?,?,?,?,'','', 'skipped', 0, ?, ?)",
      ev.id, round.id, current.id, team.id, input.sessionId, input.requestId, now, ctx.nowIso(),
    );
    const last = progress.position + 1 >= items.length;
    ctx.db.run('UPDATE team_stage_progress SET position = position + 1, unlocked_clock_ms = ?, finished_at = ? WHERE team_id = ? AND round_id = ?', elapsedClock(ctx.timer(round), now), last ? now : null, team.id, round.id);
    ctx.audit(ev.id, `team:${team.id}`, 'quiz.skip', { challengeId: current.id });
    return result(input.requestId, 'skipped', 0, true, last ? 'Skipped. That was the last question.' : 'Skipped. On to the next question.');
  });
  ctx.emit({ teams: [input.teamId] });
  return out;
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
    if (!round || round.kind !== 'quiz' || ev.state !== 'ROUND_RUNNING') throw new AppError(409, 'NOT_RUNNING', 'Hints are only available while the quiz is running.');
    const cfg = ctx.roundConfig(round);
    if (!cfg.hintsEnabled) throw new AppError(403, 'HINTS_DISABLED', 'Hints are disabled for this round.');
    if (!acceptsSubmissions(ctx.timer(round), ctx.clock.now())) throw new AppError(409, 'NOT_RUNNING', 'Time is up.');
    const items = ctx.challenges(round.id);
    const progress = ensureProgress(ctx, team.id, round.id);
    const current = items[progress.position];
    if (!current) throw new AppError(409, 'FINISHED', 'You have already completed this round.');
    if (!current.hint) throw new AppError(404, 'NO_HINT', 'There is no hint for this question.');
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
