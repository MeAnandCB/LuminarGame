import crypto from 'node:crypto';
import type { Db } from '../db/connection.js';
import type { Announcement } from '../../shared/contract.js';
import type { EventSettings, EventState, RoundConfig, RoundKind, RoundStatus, TeamStatus } from '../../shared/types.js';
import type { TimerState } from '../game/timer.js';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Clock {
  now(): number;
}
export const systemClock: Clock = { now: () => Date.now() };

export interface EventRow {
  id: number;
  name: string;
  pin: string;
  state: EventState;
  current_round_id: number | null;
  settings: string;
  qualification_frozen: number;
  archived: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface RoundRow {
  id: number;
  event_id: number;
  level: number;
  name: string;
  kind: RoundKind;
  status: RoundStatus;
  config: string;
  instructions: string;
  started_at: number | null;
  deadline_at: number | null;
  remaining_ms: number | null;
  heartbeat_at: number | null;
  ended_at: number | null;
  answers_revealed: number;
  live_index: number;
  live_phase: 'open' | 'reveal' | null;
  live_clock_start: number;
  /** Round clock when the current question first opened (the speed bonus is measured from here). */
  live_q_start: number;
}

export interface ChallengeRow {
  id: number;
  round_id: number;
  position: number;
  kind: 'choice' | 'number' | 'text';
  title: string;
  prompt: string;
  options: string | null;
  answers: string;
  points: number;
  hint: string | null;
  image: string | null;
}

export interface TeamRow {
  id: number;
  event_id: number;
  name: string;
  name_key: string;
  player1: string;
  player2: string;
  team_code: string;
  status: TeamStatus;
  qualified: number;
  created_at: string;
}

export interface ChangeSignal {
  /** Team ids whose private state should be re-sent. 'all' = every connected team. */
  teams?: number[] | 'all';
  announce?: Announcement;
  /** Teams whose sessions are no longer valid (removed / reset). */
  kick?: number[];
}

export interface AppConfig {
  nodeEnv: string;
  publicUrl: string | null;
  adminSessionHours: number;
  cookieSecure: boolean;
  port: number;
}

/** Shared services every engine module needs. */
export class Ctx {
  readonly presence = new Map<number, Set<string>>();
  /** Sockets (by team) whose game screen is hidden right now. See engine/attention.ts. */
  readonly hiddenSockets = new Map<number, Set<string>>();
  /** When each currently-away team lost the game screen (server clock). */
  readonly awaySince = new Map<number, number>();
  private listeners: Array<(c: ChangeSignal) => void> = [];
  private seqLast = 0;

  constructor(
    readonly db: Db,
    readonly clock: Clock,
    readonly config: AppConfig,
    /** Returns candidate URLs teams can type/scan, set by the HTTP layer. */
    public joinUrlFor: (pin: string) => string = (pin) => `/join?pin=${pin}`,
  ) {}

  onChange(cb: (c: ChangeSignal) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  emit(signal: ChangeSignal = {}): void {
    for (const l of this.listeners) {
      try {
        l(signal);
      } catch (e) {
        console.error('change listener failed', e);
      }
    }
  }

  nowIso(): string {
    return new Date(this.clock.now()).toISOString();
  }

  /** Strictly increasing sequence tied to the clock; used to order same-millisecond writes. */
  nextSeq(): number {
    this.seqLast = Math.max(this.seqLast + 1, this.clock.now());
    return this.seqLast;
  }

  audit(eventId: number | null, actor: string, action: string, details: Record<string, unknown> = {}): void {
    this.db.run('INSERT INTO audit_logs (event_id, actor, action, details, created_at) VALUES (?,?,?,?,?)', eventId, actor, action, JSON.stringify(details), this.nowIso());
  }

  currentEvent(): EventRow | undefined {
    return this.db.get<EventRow>('SELECT * FROM events WHERE archived = 0 ORDER BY id DESC LIMIT 1');
  }

  requireEvent(): EventRow {
    const e = this.currentEvent();
    if (!e) throw new AppError(404, 'NO_EVENT', 'No event exists yet. Create one first.');
    return e;
  }

  event(id: number): EventRow {
    const e = this.db.get<EventRow>('SELECT * FROM events WHERE id = ?', id);
    if (!e) throw new AppError(404, 'NO_EVENT', 'Event not found.');
    return e;
  }

  round(id: number): RoundRow {
    const r = this.db.get<RoundRow>('SELECT * FROM rounds WHERE id = ?', id);
    if (!r) throw new AppError(404, 'NO_ROUND', 'Round not found.');
    return r;
  }

  rounds(eventId: number): RoundRow[] {
    return this.db.all<RoundRow>('SELECT * FROM rounds WHERE event_id = ? ORDER BY level', eventId);
  }

  currentRound(ev: EventRow): RoundRow | undefined {
    return ev.current_round_id ? this.db.get<RoundRow>('SELECT * FROM rounds WHERE id = ?', ev.current_round_id) : undefined;
  }

  challenges(roundId: number): ChallengeRow[] {
    return this.db.all<ChallengeRow>('SELECT * FROM challenges WHERE round_id = ? ORDER BY position', roundId);
  }

  settings(ev: EventRow): EventSettings {
    return JSON.parse(ev.settings) as EventSettings;
  }

  roundConfig(r: RoundRow): RoundConfig {
    return JSON.parse(r.config) as RoundConfig;
  }

  timer(r: RoundRow): TimerState {
    return { status: r.status, durationMs: this.roundConfig(r).durationSec * 1000, deadlineAt: r.deadline_at, remainingMs: r.remaining_ms };
  }

  setState(ev: EventRow, to: EventState, actor: string, reason?: string, roundId?: number | null): void {
    this.db.run('UPDATE events SET state = ?, updated_at = ? WHERE id = ?', to, this.nowIso(), ev.id);
    this.db.run('INSERT INTO event_state_history (event_id, from_state, to_state, round_id, actor, reason, created_at) VALUES (?,?,?,?,?,?,?)', ev.id, ev.state, to, roundId ?? ev.current_round_id, actor, reason ?? null, this.nowIso());
  }

  isConnected(teamId: number): boolean {
    return (this.presence.get(teamId)?.size ?? 0) > 0;
  }

  /** Connected, and not one of its phones is showing the game. */
  isAway(teamId: number): boolean {
    const phones = this.presence.get(teamId);
    const hidden = this.hiddenSockets.get(teamId);
    return !!phones && phones.size > 0 && !!hidden && [...phones].every((id) => hidden.has(id));
  }
}

export const hashToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');
export const newToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('base64url');
