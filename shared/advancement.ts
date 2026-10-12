import { CUTOFF_LEVELS, type EventSettings } from './types.js';

/**
 * The cuts must narrow the field: each cut keeps the same number of teams as the cut before it, or fewer.
 * Returns a message for the host, or null when the plan is consistent (or there is no cut-off at all).
 * Used by the server to reject a bad plan and by the admin form to explain it before saving.
 * The finalist count is not part of the check: asking for more finalists than teams are left simply qualifies everyone.
 */
export function advancementProblem(s: Pick<EventSettings, 'advance'>): string | null {
  const cuts: { level: number; n: number }[] = [];
  CUTOFF_LEVELS.forEach((level, i) => {
    const n = s.advance[i];
    if (n !== null && n !== undefined) cuts.push({ level, n });
  });
  for (let i = 1; i < cuts.length; i++) {
    const prev = cuts[i - 1]!;
    const cur = cuts[i]!;
    if (cur.n > prev.n) return `Each cut can keep at most as many teams as the one before it: the cut after Level ${prev.level} keeps ${prev.n}, so the cut after Level ${cur.level} cannot keep ${cur.n}.`;
  }
  return null;
}
