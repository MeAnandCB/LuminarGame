import type { ChallengeKind, RoundKind } from '../../shared/types.js';

export interface SeedChallenge {
  kind: ChallengeKind;
  title: string;
  prompt: string;
  options?: { id: string; text: string; icon?: string }[];
  answers: string[];
  points: number;
  hint?: string;
  /** Tech Faces: picture URL without extension, served from web/public. */
  image?: string;
}

export interface SeedRound {
  level: number;
  name: string;
  kind: RoundKind;
  instructions: string;
  challenges: SeedChallenge[];
}

export const opts = (...texts: string[]) => texts.map((text, i) => ({ id: 'abcd'[i]!, text }));
