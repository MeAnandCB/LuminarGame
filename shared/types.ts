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
export type AnswerOutcome = 'correct' | 'incorrect' | 'late' | 'rejected';

export interface RoundConfig {
  durationSec: number;
  /** Level 1: max bonus for answering quickly (0 disables). */
  speedBonusMax: number;
  /** Level 1: seconds after a question unlocks within which the bonus decays to 0. */
  speedWindowSec: number;
  /** Levels 2/3: max bonus for finishing with time remaining. */
  timeBonusMax: number;
  /** Levels 2/3: bonus for completing the last stage. */
  completionBonus: number;
  /** Points deducted for each wrong answer (0 = none). */
  wrongPenalty: number;
  hintsEnabled: boolean;
  /** Points deducted the first time a team opens a hint for a challenge. */
  hintPenalty: number;
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
  outcome: 'correct' | 'incorrect';
  points: number;
  yourAnswer: string;
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
  solved: { position: number; title: string; answer: string }[];
  hint: { available: boolean; used: boolean; text: string | null; penalty: number } | null;
  history: TeamHistoryItem[];
  award: string | null;
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
  kind: 'quiz' | 'puzzle';
  status: RoundStatus;
  config: RoundConfig;
  instructions: string;
  challenges: AdminChallenge[];
  startedAt: number | null;
  endedAt: number | null;
  deadlineAt: number | null;
  remainingMs: number;
  answersRevealed: boolean;
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
