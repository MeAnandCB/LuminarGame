// Types shared by server and web. Nothing in here may carry answer keys
// except AdminChallenge and RevealedItem (the latter only after host reveal).

export const EVENT_STATES = [
  'SETUP',
  'REGISTRATION_OPEN',
  'LOBBY',
  'ROUND_READY',
  'ROUND_RUNNING',
  'ROUND_PAUSED',
  'ROUND_ENDED',
  'QUALIFICATION',
  'EVENT_COMPLETED',
] as const;
export type EventState = (typeof EVENT_STATES)[number];

export type RoundStatus = 'pending' | 'running' | 'paused' | 'ended';
export type ChallengeKind = 'choice' | 'number' | 'text';
export type TeamStatus = 'pending' | 'approved' | 'rejected' | 'removed';
export type AnswerOutcome = 'correct' | 'incorrect' | 'late' | 'rejected' | 'locked' | 'skipped';

/**
 * quiz       - Level 1 "Quick Brain": self-paced, one answer per question.
 * lightning  - Level 2 "Reel Rush": host-paced live questions, speed + streak + Double Down.
 * showdown   - Level 3 "Final Showdown": finalists, lives, fastest-finger steals, last team standing.
 */
export type RoundKind = 'quiz' | 'lightning' | 'showdown';

export interface RoundConfig {
  /** Quiz: whole-round timer. Live games: derived from the question/reveal timings. */
  durationSec: number;
  /** Quiz: 0-20 bonus. Live: bonus for answering early in the question window. */
  speedBonusMax: number;
  /** Quiz only: seconds after a question unlocks within which the speed bonus decays to 0. */
  speedWindowSec: number;
  /** Points deducted for a wrong answer (0 = none). */
  wrongPenalty: number;
  /** Quiz only. */
  hintsEnabled: boolean;
  hintPenalty: number;
  /** Quiz only: teams may skip a question (no points, no penalty). */
  allowSkip: boolean;
  /** Live: seconds a question stays open. */
  questionSec: number;
  /** Live: seconds the answer reveal stays on screen. */
  revealSec: number;
  /** Live: extra points for the first team with a correct answer. */
  fastestBonus: number;
  /** Lightning: bonus per step of the current correct-answer streak. */
  streakBonus: number;
  streakCap: number;
  /** Lightning: each team may double one question (right = 2x, wrong = lose the base points). */
  doubleDown: boolean;
  /** Showdown: lives per team (0 = lives disabled). */
  lives: number;
  /** Showdown: points the fastest correct team steals from a team that just lost a life. */
  stealPoints: number;
  /** Showdown: bonus for each team still alive when the round ends. */
  survivorBonus: number;
}

export interface EventSettings {
  maxTeams: number;
  autoApprove: boolean;
  finalists: number;
  /** Show scores/ranks on projector and phones while a round is running. */
  liveScores: boolean;
}

export interface LeaderboardRow {
  rank: number;
  teamId: number;
  name: string;
  total: number;
  roundScore: number;
  solved: number;
  progress: number;
  progressTotal: number;
  connected: boolean;
  qualified: boolean | null;
  tied: boolean;
  /** Live games only. */
  lives: number | null;
  streak: number;
  eliminated: boolean;
}

export interface ScoreChange {
  id: number;
  teamId: number;
  teamName: string;
  points: number;
  kind: string;
  at: number;
}

export interface PublicRound {
  id: number;
  level: number;
  kind: RoundKind;
  name: string;
  status: RoundStatus;
  instructions: string;
  total: number;
  durationMs: number;
  deadlineAt: number | null;
  remainingMs: number;
  answersRevealed: boolean;
}

export interface RevealedItem {
  position: number;
  title: string;
  prompt: string;
  answer: string;
}

export interface LiveOption {
  id: string;
  text: string;
  /** Reveal phase only. */
  count?: number;
  correct?: boolean;
}

export interface LiveReveal {
  correctText: string;
  options: LiveOption[];
  answered: number;
  correctCount: number;
  fastest: { teamId: number; name: string; bonus: number } | null;
  steal: { thief: string; victim: string; points: number } | null;
  eliminated: string[];
  voided: boolean;
}

/** What the projector (and phones) may know about the live question right now. */
export interface LivePublic {
  phase: 'open' | 'reveal';
  index: number;
  total: number;
  kind: ChallengeKind;
  title: string;
  prompt: string;
  points: number;
  options: LiveOption[];
  answered: number;
  eligible: number;
  /** Server epoch ms when the phase ends; null while paused. */
  phaseEndsAt: number | null;
  phaseRemainingMs: number;
  phaseTotalMs: number;
  reveal: LiveReveal | null;
}

export interface PublicState {
  serverNow: number;
  event: { name: string; pin: string; state: EventState; joinUrl: string } | null;
  round: PublicRound | null;
  nextLevel: number | null;
  counts: { teams: number; connected: number; submissions: number; finished: number; capacity: number };
  leaderboard: LeaderboardRow[];
  provisional: boolean;
  scoresHidden: boolean;
  recent: ScoreChange[];
  finalists: { teamId: number; name: string }[];
  podium: LeaderboardRow[] | null;
  reveal: RevealedItem[] | null;
  live: LivePublic | null;
}

export interface TeamChallenge {
  id: number;
  position: number;
  total: number;
  kind: ChallengeKind;
  title: string;
  prompt: string;
  options: { id: string; text: string }[] | null;
  points: number;
}

export interface AnswerResult {
  requestId: string;
  outcome: AnswerOutcome;
  points: number;
  message: string;
  advanced: boolean;
  duplicate?: boolean;
}

export interface TeamHistoryItem {
  position: number;
  title: string;
  outcome: 'correct' | 'incorrect' | 'skipped';
  points: number;
  yourAnswer: string;
}

export interface TeamLive {
  /** The team already locked in an answer for the open question. */
  locked: boolean;
  /** Double Down armed for this answer / still available. */
  doubleAvailable: boolean;
  streak: number;
  lives: number | null;
  eliminated: boolean;
  /** Reveal phase: what happened to this team on the question. */
  result: { outcome: 'correct' | 'incorrect' | 'none' | 'voided'; points: number; breakdown: { label: string; points: number }[] } | null;
}

export interface TeamState {
  serverNow: number;
  team: { id: number; name: string; players: [string, string]; code: string; status: TeamStatus };
  eventState: EventState;
  score: { total: number; round: number };
  rank: number | null;
  rankHidden: boolean;
  qualified: boolean | null;
  eligible: boolean;
  progress: { position: number; total: number; finished: boolean } | null;
  challenge: TeamChallenge | null;
  hint: { available: boolean; used: boolean; text: string | null; penalty: number } | null;
  history: TeamHistoryItem[];
  award: string | null;
  live: TeamLive | null;
  /** Quiz only: the host allows skipping questions. */
  canSkip: boolean;
}

export interface AdminChallenge {
  id: number;
  position: number;
  kind: ChallengeKind;
  title: string;
  prompt: string;
  options: { id: string; text: string }[] | null;
  answers: string[];
  points: number;
  hint: string | null;
}

export interface AdminRound {
  id: number;
  level: number;
  name: string;
  kind: RoundKind;
  status: RoundStatus;
  config: RoundConfig;
  instructions: string;
  challenges: AdminChallenge[];
  startedAt: number | null;
  endedAt: number | null;
  deadlineAt: number | null;
  remainingMs: number;
  answersRevealed: boolean;
  liveIndex: number;
  livePhase: 'open' | 'reveal' | null;
}

export interface AdminTeam {
  id: number;
  name: string;
  players: [string, string];
  code: string;
  status: TeamStatus;
  connected: boolean;
  devices: number;
  total: number;
  qualified: boolean;
  duplicateName: boolean;
  createdAt: string;
}

export interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  details: string;
  createdAt: string;
}

export interface AdminState {
  serverNow: number;
  event: {
    id: number;
    name: string;
    pin: string;
    state: EventState;
    settings: EventSettings;
    currentRoundId: number | null;
    qualificationFrozen: boolean;
    joinUrls: string[];
  };
  allowedActions: string[];
  rounds: AdminRound[];
  teams: AdminTeam[];
  leaderboard: LeaderboardRow[];
  audit: AuditEntry[];
  counts: PublicState['counts'];
}

export interface ApiError {
  error: { code: string; message: string };
}
