import { canTransition } from '../game/stateMachine.js';
import { isLive } from '../game/scoring.js';
import type { Ctx, EventRow } from './context.js';
import { FINAL_LEVEL, QUALIFY_AFTER_LEVEL } from './events.js';

/** Which admin buttons make sense right now. The server still enforces every transition itself. */
export function allowedActions(ctx: Ctx, ev: EventRow): string[] {
  const out: string[] = [];
  const s = ev.state;
  const round = ctx.currentRound(ev);
  const rounds = ctx.rounds(ev.id);
  const ended = rounds.filter((r) => r.status === 'ended');
  const nextLevel = (ended.length ? Math.max(...ended.map((r) => r.level)) : 0) + 1;
  const hasNext = nextLevel <= rounds.length;
  if (canTransition(s, 'REGISTRATION_OPEN') && !(s === 'LOBBY' && rounds.some((r) => r.status !== 'pending'))) out.push('registration.open');
  if (s === 'REGISTRATION_OPEN') out.push('registration.pause', 'registration.confirm');
  if (s === 'LOBBY' || s === 'ROUND_ENDED' || s === 'QUALIFICATION') {
    if (hasNext && !(nextLevel === FINAL_LEVEL && s !== 'QUALIFICATION')) out.push('round.prepare');
  }
  if (s === 'ROUND_READY') out.push('round.start');
  if (s === 'ROUND_RUNNING') out.push('round.pause', 'round.end');
  if (s === 'ROUND_RUNNING' && round && isLive(round.kind)) out.push('live.advance', 'live.skip');
  if (s === 'ROUND_PAUSED') out.push('round.resume', 'round.end');
  if (s === 'ROUND_ENDED' && round?.level === QUALIFY_AFTER_LEVEL) out.push('qualification.open');
  if (s === 'ROUND_READY' && round?.level === FINAL_LEVEL && round.status === 'pending') out.push('qualification.open');
  if (s === 'ROUND_ENDED' || s === 'QUALIFICATION' || s === 'LOBBY' || s === 'ROUND_READY') out.push('event.complete');
  if (s === 'ROUND_ENDED') out.push('answers.reveal');
  return out;
}
