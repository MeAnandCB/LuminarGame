// Real-time + HTTP contract. Both sides import these names.

/** Server -> client socket events */
export const S2C = {
  /** Public snapshot. Sent to every projector and team phone. Contains no private team data or answer keys. */
  publicState: 'state:public',
  /** Private snapshot for one team (room team:<id>). */
  teamState: 'team:state',
  /** Full admin snapshot (room admin). Contains answer keys. */
  adminState: 'admin:state',
  /** Lightweight clock sync so clients can interpolate countdowns. */
  timerSync: 'timer:sync',
  /** Toast-style announcement (round started, qualification, winners...). */
  announce: 'announce',
  /** The team's session was removed (team removed or event reset). */
  sessionEnded: 'session:ended',
} as const;

/** Client -> server socket events (all with acknowledgement callbacks) */
export const C2S = {
  submitAnswer: 'answer:submit',
  requestHint: 'hint:request',
  /** Fire-and-forget: the phone's game screen was hidden (other tab/app, screen off) or is showing again. Payload: { visible: boolean }. */
  screenVisibility: 'screen:visibility',
} as const;

/** A team must stay off the game screen this long before the host is warned (a notification glance is not a departure). */
export const AWAY_GRACE_MS = 2000;

export interface TimerSync {
  serverNow: number;
  roundId: number | null;
  status: string | null;
  deadlineAt: number | null;
  remainingMs: number;
}

export interface Announcement {
  kind: 'round_started' | 'round_paused' | 'round_resumed' | 'round_ended' | 'qualification' | 'winner' | 'info';
  text: string;
}

export const MAX_ANSWER_LENGTH = 120;
