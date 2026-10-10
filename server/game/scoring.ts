import { z } from 'zod';
import type { EventSettings, RoundConfig } from '../../shared/types.js';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Level 1 speed bonus: linear decay from max to 0 across the window. */
export function speedBonus(max: number, windowMs: number, elapsedMs: number): number {
  if (max <= 0 || windowMs <= 0) return 0;
  return Math.round(max * clamp(1 - elapsedMs / windowMs, 0, 1));
}

/** Levels 2/3 time bonus: proportional to the share of the round still left. */
export function timeBonus(max: number, durationMs: number, remainingMs: number): number {
  if (max <= 0 || durationMs <= 0) return 0;
  return Math.round(max * clamp(remainingMs / durationMs, 0, 1));
}

export const roundConfigSchema = z.object({
  durationSec: z.number().int().min(30).max(7200),
  speedBonusMax: z.number().int().min(0).max(20),
  speedWindowSec: z.number().int().min(1).max(600),
  timeBonusMax: z.number().int().min(0).max(1000),
  completionBonus: z.number().int().min(0).max(5000),
  wrongPenalty: z.number().int().min(0).max(500),
  hintsEnabled: z.boolean(),
  hintPenalty: z.number().int().min(0).max(1000),
});

export const eventSettingsSchema = z.object({
  maxTeams: z.number().int().min(1).max(20),
  autoApprove: z.boolean(),
  finalists: z.number().int().min(1).max(20),
  liveScores: z.boolean(),
});

export const DEFAULT_EVENT_SETTINGS: EventSettings = {
  maxTeams: 20,
  autoApprove: true,
  finalists: 5,
  liveScores: true,
};

export const DEFAULT_ROUND_CONFIG: Record<number, RoundConfig> = {
  1: { durationSec: 600, speedBonusMax: 10, speedWindowSec: 30, timeBonusMax: 0, completionBonus: 0, wrongPenalty: 0, hintsEnabled: false, hintPenalty: 0 },
  2: { durationSec: 900, speedBonusMax: 0, speedWindowSec: 30, timeBonusMax: 200, completionBonus: 0, wrongPenalty: 0, hintsEnabled: true, hintPenalty: 50 },
  3: { durationSec: 1200, speedBonusMax: 0, speedWindowSec: 30, timeBonusMax: 200, completionBonus: 500, wrongPenalty: 0, hintsEnabled: true, hintPenalty: 100 },
};

export function parseRoundConfig(value: unknown): RoundConfig {
  return roundConfigSchema.parse(value);
}
