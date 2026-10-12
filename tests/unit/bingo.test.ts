import { describe, expect, it } from 'vitest';
import { BINGO_CELLS, BINGO_LINES, bingoLayout, cellsOfLines, completedLines } from '../../server/game/bingo.js';
import { BINGO_TILES, bingoCalls } from '../../server/content/bingo.js';

const ids = BINGO_TILES.map((t) => t.id);

describe('bingo card rules', () => {
  it('a 4x4 card has 10 lines of 4 cells (4 rows, 4 columns, 2 diagonals)', () => {
    expect(BINGO_CELLS).toBe(16);
    expect(BINGO_LINES).toHaveLength(10);
    expect(BINGO_LINES.every((l) => l.length === 4 && new Set(l).size === 4)).toBe(true);
    expect(BINGO_LINES[0]).toEqual([0, 1, 2, 3]);
    expect(BINGO_LINES[4]).toEqual([0, 4, 8, 12]);
    expect(BINGO_LINES[8]).toEqual([0, 5, 10, 15]);
    expect(BINGO_LINES[9]).toEqual([3, 6, 9, 12]);
  });

  it('every team gets all 16 tiles exactly once, in a stable order that differs between teams', () => {
    const a = bingoLayout(ids, 1, 7);
    expect([...a].sort()).toEqual([...ids].sort());
    expect(bingoLayout(ids, 1, 7)).toEqual(a);
    const layouts = new Set(Array.from({ length: 20 }, (_, t) => bingoLayout(ids, t + 1, 7).join('')));
    expect(layouts.size).toBeGreaterThan(15);
  });

  it('finds completed rows, columns and diagonals', () => {
    const layout = ids; // identity layout: cell i holds tile ids[i]
    expect(completedLines(layout, new Set())).toEqual([]);
    expect(completedLines(layout, new Set(['a', 'b', 'c', 'd']))).toEqual([0]);
    expect(completedLines(layout, new Set(['a', 'e', 'i', 'm']))).toEqual([4]);
    expect(completedLines(layout, new Set(['a', 'f', 'k', 'p']))).toEqual([8]);
    expect(completedLines(layout, new Set(ids))).toHaveLength(10);
    expect(cellsOfLines([0, 4])).toEqual([0, 1, 2, 3, 4, 8, 12]);
  });
});

describe('bingo content', () => {
  it('has 16 tiles and 16 calls, each tile called exactly once', () => {
    expect(BINGO_TILES).toHaveLength(16);
    expect(new Set(BINGO_TILES.map((t) => t.text)).size).toBe(16);
    expect(bingoCalls).toHaveLength(16);
    expect(new Set(bingoCalls.map((c) => c.answers[0])).size).toBe(16);
    for (const c of bingoCalls) {
      expect(c.options).toHaveLength(16);
      expect(ids).toContain(c.answers[0]);
      expect(c.prompt.length).toBeGreaterThan(20);
    }
  });

  it('no clue gives its answer away by naming the tile', () => {
    for (const c of bingoCalls) {
      const tile = BINGO_TILES.find((t) => t.id === c.answers[0])!;
      const bare = tile.text.toLowerCase().replace(/[^a-z]/g, '');
      // "Python" may be mentioned in its own clue only through the comedy troupe; allow no direct name at all
      expect(c.prompt.toLowerCase().replace(/[^a-z ]/g, '')).not.toContain(bare);
    }
  });
});
