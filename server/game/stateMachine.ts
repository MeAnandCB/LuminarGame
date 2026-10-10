import type { EventState } from '../../shared/types.js';

export const TRANSITIONS: Record<EventState, EventState[]> = {
  SETUP: ['REGISTRATION_OPEN'],
  REGISTRATION_OPEN: ['SETUP', 'LOBBY'],
  LOBBY: ['REGISTRATION_OPEN', 'ROUND_READY', 'EVENT_COMPLETED'],
  ROUND_READY: ['ROUND_RUNNING', 'QUALIFICATION', 'EVENT_COMPLETED'],
  ROUND_RUNNING: ['ROUND_PAUSED', 'ROUND_ENDED'],
  ROUND_PAUSED: ['ROUND_RUNNING', 'ROUND_ENDED'],
  ROUND_ENDED: ['ROUND_READY', 'QUALIFICATION', 'EVENT_COMPLETED'],
  QUALIFICATION: ['ROUND_READY', 'EVENT_COMPLETED'],
  EVENT_COMPLETED: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: EventState,
    readonly to: EventState,
  ) {
    super(`Cannot move the event from ${from} to ${to}`);
  }
}

export function canTransition(from: EventState, to: EventState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: EventState, to: EventState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}
