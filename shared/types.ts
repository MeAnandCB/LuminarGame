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
 * faces      - Level 1 "Tech Faces": live, host-paced "who is this?" photo questions.
 * bingo      - Level 2 "Tech Bingo": live, host-called clues; each team marks its own shuffled 4x4 card.
 * quiz       - Level 3 "Quick Brain": self-paced, one answer per question.
 * lightning  - Level 4 "Reel Rush": host-paced live questions, speed + streak + Double Down.
 * showdown   - Level 5 "Final Showdown": finalists, lives, fastest-finger steals, last team standing.
 */
export type RoundKind = 'faces' | 'bingo' | 'quiz' | 'lightning' | 'showdown';

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
  /** Bingo: bonus for every newly completed row, column or diagonal. */
  lineBonus: number;
  /** Bingo: bonus for marking the whole card. */
  blackoutBonus: number;
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
  /** Bingo tiles carry an emoji. */
  icon?: string;
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
  /** Faces: a short "did you know" about the answer. */
  fact: string | null;
  /** Bingo: teams that completed a new line (or the whole card) on this call. */
  bingos: { name: string; lines: number; blackout: boolean }[];
}

/** Bingo master board shown on the projector: which tiles have been called so far. */
export interface BingoPublic {
  tiles: { id: string; text: string; icon: string }[];
  /** Tile ids already called and resolved, oldest first. */
  called: string[];
  /** Number of teams holding at least one completed line. */
  teamsWithLine: number;
}

/** What the projector (and phones) may know about the live question right now. */
export interface LivePublic {
  phase: 'open' | 'reveal';
  index: number;
  total: number;
  kind: ChallengeKind;
  title: string;
  prompt: string;
  /** Faces: URL (without extension) of the picture to identify. */
  image: string | null;
  points: number;
  options: LiveOption[];
  bingo: BingoPublic | null;
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

export interface TeamBingo {
  /** Tile ids in this team's card order (row by row, 4 per row). */
  layout: string[];
  tiles: { id: string; text: string; icon: string }[];
  /** Correctly marked tile ids. */
  marked: string[];
  /** Called but not marked by this team. */
  missed: string[];
  /** Card cell indexes that belong to a completed line. */
  lineCells: number[];
  lines: number;
}

export interface TeamLive {
  /** The team already locked in an answer for the open question. */
  locked: boolean;
  /** Double Down armed for this answer / still available. */
  doubleAvailable: boolean;
  streak: number;
  lives: number | null;
  eliminated: boolean;
  bingo: TeamBingo | null;
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
  image: string | null;
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
  /** Server time when every connected phone of this team lost the game screen; null while any phone shows it (or outside the game). */
  awaySince: number | null;
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
  /** The live question right now (timer, answers in, reveal stats); pair it with the answer key in `rounds`. Null outside a running live round. */
  live: LivePublic | null;
  teams: AdminTeam[];
  leaderboard: LeaderboardRow[];
  audit: AuditEntry[];
  counts: PublicState['counts'];
}

export interface ApiError {
  error: { code: string; message: string };
}
