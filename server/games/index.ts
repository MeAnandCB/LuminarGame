/**
 * Entry points used by HTTP and sockets. The current round's kind decides which game handles the request:
 *   quiz      -> games/quiz.ts   (Level 1, self-paced)
 *   lightning -> games/live.ts   (Level 2, Reel Rush)
 *   showdown  -> games/live.ts   (Level 3, Final Showdown)
 */
import { isLive } from '../game/scoring.js';
import { AppError, type Ctx } from '../engine/context.js';
import type { AnswerResult } from '../../shared/types.js';
import { requestHint as quizHint, skipQuiz, submitQuiz, type HintResult } from './quiz.js';
import { submitLive } from './live.js';
import type { SubmitInput } from './shared.js';

export type { HintResult, SubmitInput };
export { eligibleForRound } from './shared.js';

function currentKind(ctx: Ctx) {
  const ev = ctx.currentEvent();
  const round = ev ? ctx.currentRound(ev) : undefined;
  if (!ev || !round) throw new AppError(409, 'NOT_RUNNING', 'No round is running right now.');
  return round.kind;
}

export function submitAnswer(ctx: Ctx, input: SubmitInput): AnswerResult {
  return isLive(currentKind(ctx)) ? submitLive(ctx, input) : submitQuiz(ctx, input);
}

export function skipQuestion(ctx: Ctx, input: { teamId: number; sessionId: number | null; requestId: string; challengeId?: number }): AnswerResult {
  if (currentKind(ctx) !== 'quiz') throw new AppError(409, 'NOT_QUIZ', 'Skipping is only available in the self-paced quiz. In live rounds the host controls the pace.');
  return skipQuiz(ctx, input);
}

export function requestHint(ctx: Ctx, teamId: number): HintResult {
  return quizHint(ctx, teamId);
}
