/**
 * Level 2 "Tech Bingo" rules: every team holds the same 16 tiles on a 4x4 card, shuffled differently per team.
 * The host calls one clue at a time; a correct answer marks that tile. Pure functions, unit tested.
 */

export const BINGO_SIZE = 4;
export const BINGO_CELLS = BINGO_SIZE * BINGO_SIZE;

/** Cell indexes of every row, column and both diagonals (4 + 4 + 2 = 10 lines). */
export const BINGO_LINES: readonly (readonly number[])[] = (() => {
  const n = BINGO_SIZE;
  const idx = (r: number, c: number) => r * n + c;
  const lines: number[][] = [];
  for (let r = 0; r < n; r++) lines.push(Array.from({ length: n }, (_, c) => idx(r, c)));
  for (let c = 0; c < n; c++) lines.push(Array.from({ length: n }, (_, r) => idx(r, c)));
  lines.push(Array.from({ length: n }, (_, i) => idx(i, i)));
  lines.push(Array.from({ length: n }, (_, i) => idx(i, n - 1 - i)));
  return lines;
})();

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic per-team card order (Fisher-Yates with a seeded generator). */
export function bingoLayout(tileIds: readonly string[], teamId: number, roundId: number): string[] {
  const out = [...tileIds];
  const rand = mulberry32(Math.imul(teamId + 1, 2654435761) ^ Math.imul(roundId + 7, 40503));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Indexes (into BINGO_LINES) of the lines fully covered by the marked tiles. */
export function completedLines(layout: readonly string[], marked: ReadonlySet<string>): number[] {
  const done: number[] = [];
  BINGO_LINES.forEach((line, i) => {
    if (line.every((cell) => marked.has(layout[cell]!))) done.push(i);
  });
  return done;
}

export const cellsOfLines = (lines: readonly number[]): number[] => [...new Set(lines.flatMap((i) => BINGO_LINES[i]!))].sort((a, b) => a - b);
