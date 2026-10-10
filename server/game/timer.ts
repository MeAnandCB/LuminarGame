import type { RoundStatus } from '../../shared/types.js';

/** Authoritative round clock. All values are epoch/duration milliseconds. */
export interface TimerState {
  status: RoundStatus;
  durationMs: number;
  deadlineAt: number | null;
  /** Remaining time captured at pause (or at recovery after a restart). */
  remainingMs: number | null;
}

export function remainingAt(t: TimerState, now: number): number {
  switch (t.status) {
    case 'pending':
      return t.durationMs;
    case 'running':
      return Math.max(0, (t.deadlineAt ?? now) - now);
    case 'paused':
      return Math.max(0, t.remainingMs ?? 0);
    case 'ended':
      return 0;
  }
}

export function startTimer(durationMs: number, now: number): TimerState {
  return { status: 'running', durationMs, deadlineAt: now + durationMs, remainingMs: null };
}

export function pauseTimer(t: TimerState, now: number): TimerState {
  if (t.status !== 'running') throw new Error('timer is not running');
  return { ...t, status: 'paused', deadlineAt: null, remainingMs: remainingAt(t, now) };
}

export function resumeTimer(t: TimerState, now: number): TimerState {
  if (t.status !== 'paused') throw new Error('timer is not paused');
  return { ...t, status: 'running', deadlineAt: now + (t.remainingMs ?? 0), remainingMs: null };
}

/** Milliseconds of active (un-paused) play elapsed so far. Pause-safe clock for bonuses. */
export function elapsedClock(t: TimerState, now: number): number {
  return t.durationMs - remainingAt(t, now);
}

/**
 * Timing policy: a submission is accepted iff the round is running and the server's
 * receipt time is <= the deadline (inclusive). The server processes submissions strictly
 * one at a time in arrival order, so two submissions at the same millisecond are ordered
 * by the monotonically increasing submission id.
 */
export function acceptsSubmissions(t: TimerState, now: number): boolean {
  return t.status === 'running' && t.deadlineAt !== null && now <= t.deadlineAt;
}
