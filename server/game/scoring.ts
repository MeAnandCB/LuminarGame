import { z } from 'zod';
import { CUTOFF_LEVELS, type EventSettings, type RoundConfig, type RoundKind } from '../../shared/types.js';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Linear decay from max to 0 across the window (quiz: window after unlock; live: the question window). */
export function speedBonus(max: number, windowMs: number, elapsedMs: number): number {
  if (max <= 0 || windowMs <= 0) return 0;
  return Math.round(max * clamp(1 - elapsedMs / windowMs, 0, 1));
}

export const roundConfigSchema = z.object({
  durationSec: z.number().int().min(30).max(14400),
  speedBonusMax: z.number().int().min(0).max(500),
  speedWindowSec: z.number().int().min(1).max(600),
  wrongPenalty: z.number().int().min(0).max(500),
  hintsEnabled: z.boolean(),
  hintPenalty: z.number().int().min(0).max(1000),
  allowSkip: z.boolean(),
  questionSec: z.number().int().min(5).max(120),
  revealSec: z.number().int().min(2).max(60),
  fastestBonus: z.number().int().min(0).max(500),
  streakBonus: z.number().int().min(0).max(200),
  streakCap: z.number().int().min(0).max(20),
  doubleDown: z.boolean(),
  lives: z.number().int().min(0).max(10),
  stealPoints: z.number().int().min(0).max(1000),
  survivorBonus: z.number().int().min(0).max(5000),
  lineBonus: z.number().int().min(0).max(1000).default(0),
  blackoutBonus: z.number().int().min(0).max(5000).default(0),
});

export const eventSettingsSchema = z.object({
  maxTeams: z.number().int().min(1).max(20),
  autoApprove: z.boolean(),
  finalists: z.number().int().min(1).max(20),
  advance: z
    .array(z.number().int().min(1).max(20).nullable())
    .length(CUTOFF_LEVELS.length)
    .default(() => CUTOFF_LEVELS.map(() => null)),
  liveScores: z.boolean(),
});

export const DEFAULT_EVENT_SETTINGS: EventSettings = {
  maxTeams: 20,
  autoApprove: true,
  finalists: 5,
  advance: CUTOFF_LEVELS.map(() => null),
  liveScores: true,
};


const BASE: RoundConfig = {
  durationSec: 600,
  speedBonusMax: 0,
  speedWindowSec: 30,
  wrongPenalty: 0,
  hintsEnabled: false,
  hintPenalty: 0,
  allowSkip: false,
  questionSec: 20,
  revealSec: 7,
  fastestBonus: 0,
  streakBonus: 0,
  streakCap: 0,
  doubleDown: false,
  lives: 0,
  stealPoints: 0,
  survivorBonus: 0,
  lineBonus: 0,
  blackoutBonus: 0,
};

export const DEFAULT_ROUND_CONFIG: Record<RoundKind, RoundConfig> = {
  faces: { ...BASE, questionSec: 20, revealSec: 8, speedBonusMax: 50, fastestBonus: 30, streakBonus: 20, streakCap: 3 },
  bingo: { ...BASE, questionSec: 15, revealSec: 6, speedBonusMax: 25, lineBonus: 75, blackoutBonus: 250 },
  quiz: { ...BASE, durationSec: 600, speedBonusMax: 10, speedWindowSec: 30, allowSkip: true },
  lightning: { ...BASE, questionSec: 20, revealSec: 7, speedBonusMax: 100, fastestBonus: 50, streakBonus: 25, streakCap: 4, doubleDown: true },
  showdown: { ...BASE, questionSec: 25, revealSec: 8, speedBonusMax: 150, fastestBonus: 100, lives: 3, stealPoints: 75, survivorBonus: 300 },
};

export const isLive = (kind: RoundKind): boolean => kind !== 'quiz';

/** Live rounds run on question/reveal timers; the round clock is their sum plus a little slack. */
export function liveDurationSec(questions: number, cfg: Pick<RoundConfig, 'questionSec' | 'revealSec'>): number {
  return questions * (cfg.questionSec + cfg.revealSec) + 10;
}

export function parseRoundConfig(kind: RoundKind, value: unknown): RoundConfig {
  const cfg = roundConfigSchema.parse(value);
  if (kind === 'quiz' && cfg.speedBonusMax > 20) throw new z.ZodError([{ code: 'custom', path: ['speedBonusMax'], message: 'Quiz speed bonus is limited to 20', input: cfg.speedBonusMax }]);
  return cfg;
}
