import { z } from 'zod';
import { MAX_ANSWER_LENGTH } from '../../shared/contract.js';

const clean = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim();
const label = (min: number, max: number) =>
  z
    .string()
    .transform(clean)
    .pipe(
      z
        .string()
        .min(min, `must be at least ${min} characters`)
        .max(max, `must be at most ${max} characters`)
        // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
        .refine((s) => !/[<>\u0000-\u001f\u007f]/.test(s), 'contains characters that are not allowed'),
    );

export const pinSchema = z.string().regex(/^\d{6}$/, 'PIN must be 6 digits');

export const joinSchema = z.object({
  pin: pinSchema,
  name: label(2, 24),
  players: z.tuple([label(1, 24), label(1, 24)]),
});

export const linkSchema = z.object({ pin: pinSchema, code: z.string().trim().min(4).max(10) });

export const answerSchema = z.object({
  requestId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  answer: z.string().max(MAX_ANSWER_LENGTH),
  challengeId: z.number().int().positive().optional(),
  doubleDown: z.boolean().optional(),
});

export const visibilitySchema = z.object({ visible: z.boolean() });

export const skipSchema = z.object({
  requestId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  challengeId: z.number().int().positive().optional(),
});

export const loginSchema = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(200) });

export const createEventSchema = z.object({ name: label(2, 60), pin: pinSchema.optional() });

export const updateEventSchema = z.object({
  name: label(2, 60).optional(),
  pin: pinSchema.optional(),
  settings: z
    .object({
      maxTeams: z.number().int().min(1).max(20),
      autoApprove: z.boolean(),
      finalists: z.number().int().min(1).max(20),
      liveScores: z.boolean(),
    })
    .partial()
    .optional(),
});

export const teamStatusSchema = z.object({ status: z.enum(['approved', 'rejected', 'removed']) });

export const scoreSchema = z.object({
  points: z.number().int().min(-10000).max(10000).refine((n) => n !== 0, 'points must not be zero'),
  reason: z.string().trim().min(3, 'a reason is required').max(200),
});

export const configPatchSchema = z
  .object({
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
    lineBonus: z.number().int().min(0).max(1000),
    blackoutBonus: z.number().int().min(0).max(5000),
  })
  .partial()
  .strict();

export const challengePatchSchema = z.object({ points: z.number().int().min(0).max(5000).optional(), hint: z.string().max(300).nullable().optional() }).strict();

/** `expect` is the question and phase the coordinator was looking at; a click on a stale screen is ignored instead of skipping a phase. */
export const liveAdvanceSchema = z.object({ expect: z.object({ index: z.number().int().min(0), phase: z.enum(['open', 'reveal']) }).optional() }).strict();

export const resetSchema = z.object({ confirm: z.literal('RESET') });
export const revealSchema = z.object({ reveal: z.boolean() });
