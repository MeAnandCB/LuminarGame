import type { ChallengeKind } from '../../shared/types.js';

/**
 * Text normalisation is deliberately conservative: Unicode compatibility folding,
 * trimming, collapsing runs of whitespace and case folding. Punctuation and inner
 * spaces are preserved so that "BALAN-42M" and "BALAN42M" stay distinct.
 * Anything else that should be accepted must be listed as an explicit alternative.
 */
export function normalizeText(input: string): string {
  return input.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
}

const NUMBER_RE = /^[+-]?\d+(\.\d+)?$/;

export function parseNumber(input: string): number | null {
  const t = input.normalize('NFKC').trim();
  if (!NUMBER_RE.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function normalizeChoice(input: string): string {
  return input.normalize('NFKC').trim().toLowerCase();
}

export interface CheckResult {
  correct: boolean;
  normalized: string;
}

export function checkAnswer(kind: ChallengeKind, raw: string, accepted: string[]): CheckResult {
  if (kind === 'number') {
    const n = parseNumber(raw);
    if (n === null) return { correct: false, normalized: raw.trim() };
    const ok = accepted.some((a) => parseNumber(a) === n);
    return { correct: ok, normalized: String(n) };
  }
  if (kind === 'choice') {
    const v = normalizeChoice(raw);
    return { correct: accepted.some((a) => normalizeChoice(a) === v), normalized: v };
  }
  const v = normalizeText(raw);
  return { correct: v.length > 0 && accepted.some((a) => normalizeText(a) === v), normalized: v };
}
