/**
 * Single ranking rule used by the backend, admin dashboard, projector, CSV and podium.
 *
 *  0. Tier: finalists rank above non-finalists once the final level has been reached.
 *  1. Highest total score.
 *  2. Highest score in the focus level (the most recently played level).
 *  3. Greatest number of correctly solved challenges.
 *  4. Earliest timestamp of the last scored solve (reaching the score first wins).
 *  5. Lowest team id - purely to keep the order deterministic. Rows that tie on 1-4
 *     are flagged `tied` so the host can see a manual decision may be needed.
 */
export interface RankInput {
  teamId: number;
  name: string;
  tier: number;
  total: number;
  focus: number;
  solved: number;
  /** ms epoch of the last solve; null when the team never solved anything. */
  lastSolveAt: number | null;
}

export interface Ranked extends RankInput {
  rank: number;
  tied: boolean;
}

function compare(a: RankInput, b: RankInput): number {
  return (
    a.tier - b.tier ||
    b.total - a.total ||
    b.focus - a.focus ||
    b.solved - a.solved ||
    (a.lastSolveAt ?? Infinity) - (b.lastSolveAt ?? Infinity) ||
    a.teamId - b.teamId
  );
}

function sameKey(a: RankInput, b: RankInput): boolean {
  return a.tier === b.tier && a.total === b.total && a.focus === b.focus && a.solved === b.solved && (a.lastSolveAt ?? Infinity) === (b.lastSolveAt ?? Infinity);
}

export function rankTeams(inputs: RankInput[]): Ranked[] {
  const sorted = [...inputs].sort(compare);
  return sorted.map((r, i) => ({
    ...r,
    rank: i + 1,
    tied: sorted.some((o) => o !== r && sameKey(o, r)),
  }));
}

export function selectFinalists(ranked: Ranked[], count: number): number[] {
  return ranked.slice(0, Math.max(0, count)).map((r) => r.teamId);
}
