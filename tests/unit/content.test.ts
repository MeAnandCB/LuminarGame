import { describe, expect, it } from 'vitest';
import {
  SEED_ROUNDS, L2_CAESAR_CIPHER, L2_CAESAR_PLAIN, L2_FINAL_PASSWORD, L3_CIPHER_TEXT, L3_FINAL_PASSWORD, L3_LOGIC_CODE, L3_PATTERN_LINES, L3_PATTERN_WORD,
} from '../../server/content/seed.js';
import { checkAnswer } from '../../server/game/normalize.js';

// Independent re-implementations, deliberately not shared with the content generators.
const shiftBack = (s: string, n: number) => [...s].map((c) => String.fromCharCode(((c.charCodeAt(0) - 65 - n + 26) % 26) + 65)).join('');
const mirror = (s: string) => [...s].map((c) => String.fromCharCode(155 - c.charCodeAt(0))).join(''); // A(65)<->Z(90)

describe('seeded content is correct and unambiguous', () => {
  const [l1, l2, l3] = SEED_ROUNDS.map((r) => r.challenges);

  it('has the expected shape', () => {
    expect(SEED_ROUNDS.map((r) => r.level)).toEqual([1, 2, 3]);
    expect(l1!.length).toBeGreaterThanOrEqual(10);
    expect(l1!.length).toBeLessThanOrEqual(15);
    expect(l2!.length).toBe(5);
    expect(l3!.length).toBe(4);
  });

  it('every challenge has a prompt, a valid answer key and non-negative points', () => {
    for (const r of SEED_ROUNDS) {
      for (const c of r.challenges) {
        expect(c.prompt.trim().length).toBeGreaterThan(5);
        expect(c.answers.length).toBeGreaterThan(0);
        expect(c.points).toBeGreaterThanOrEqual(0);
        if (c.kind === 'choice') {
          expect(c.options!.length).toBe(4);
          for (const a of c.answers) expect(c.options!.some((o) => o.id === a)).toBe(true);
          expect(new Set(c.options!.map((o) => o.text)).size).toBe(4);
        }
      }
    }
  });

  it('Level 1 answer keys match the intended Kerala film facts', () => {
    const q = (title: string) => l1!.find((c) => c.title === title)!;
    const text = (title: string) => {
      const c = q(title);
      return c.answers.map((a) => c.options!.find((o) => o.id === a)!.text);
    };
    expect(text('Drishyam (2013)')).toEqual(['Jeethu Joseph']);
    expect(text('First talkie')).toEqual(['Balan']);
    expect(q('Year of the first talkie').answers).toEqual(['1938']);
    expect(text('Father of Malayalam cinema')).toEqual(['J. C. Daniel']);
    expect(q('First Malayalam film').answers).toEqual(['1928']);
    expect(text('The famous remake')).toEqual(['Manichitrathazhu']);
    expect(text('Manjummel Boys')).toEqual(['Guna Caves']);
    expect(text('The 100 crore club')).toEqual(['Pulimurugan']);
    expect(text('Jallikattu')).toEqual(['Lijo Jose Pellissery']);
    expect(text('Premam (2015)')).toEqual(['Alphonse Puthren']);
    expect(text('Adoor Gopalakrishnan')).toEqual(['Swayamvaram']);
    expect(text('Lucifer (2019)')).toEqual(['Prithviraj Sukumaran']);
  });

  it('Level 2 stages 1-3 (independently re-derived)', () => {
    expect(l2![0]!.prompt).toContain('01001101');
    expect(String.fromCharCode(parseInt('01001101', 2))).toBe('M');
    expect(checkAnswer('text', 'm', l2![0]!.answers).correct).toBe(true);
    const fwd = (s: string) => [...s].map((c) => String.fromCharCode(c.charCodeAt(0) + 1)).join('');
    expect(fwd('PREMAM')).toBe('QSFNBN');
    expect(l2![1]!.prompt).toContain('QSFNBN');
    expect(fwd('PULI')).toBe('QVMJ');
    expect(l2![1]!.answers).toEqual(['QVMJ']);
    expect([2, 6, 12, 20, 30].every((v, i) => v === (i + 1) * (i + 2))).toBe(true);
    expect(6 * 7).toBe(42);
    expect(l2![2]!.answers).toEqual(['42']);
  });

  it('Level 2 Caesar stage decodes (independent check) and is the only valid reading', () => {
    expect(L2_CAESAR_CIPHER).toBe('FEPER');
    expect(shiftBack(L2_CAESAR_CIPHER, 4)).toBe(L2_CAESAR_PLAIN);
    expect(l2![3]!.prompt).toContain('FEPER');
    expect(checkAnswer('text', 'balan', l2![3]!.answers).correct).toBe(true);
    expect(checkAnswer('text', 'FEPER', l2![3]!.answers).correct).toBe(false);
  });

  it('Level 2 final vault is built deterministically from the earlier answers', () => {
    const [s1, , s3, s4] = [l2![0]!.answers[0], l2![1]!.answers[0], l2![2]!.answers[0], l2![3]!.answers[0]];
    expect(`${s4}-${s3}${s1}`).toBe('BALAN-42M');
    expect(L2_FINAL_PASSWORD).toBe('BALAN-42M');
    expect(l2![4]!.answers).toEqual(['BALAN-42M']);
    expect(checkAnswer('text', 'balan-42m', l2![4]!.answers).correct).toBe(true);
    expect(checkAnswer('text', 'BALAN42M', l2![4]!.answers).correct).toBe(false);
    expect(checkAnswer('text', 'BALAN-M42', l2![4]!.answers).correct).toBe(false);
  });

  it('Level 3 cipher decodes', () => {
    expect(L3_CIPHER_TEXT).toBe('KIVNZN');
    expect(mirror(L3_CIPHER_TEXT)).toBe('PREMAM');
    expect(l3![0]!.answers).toEqual(['PREMAM']);
  });

  it('Level 3 logic grid has exactly one solution (brute force)', () => {
    // [Drishyam, Lucifer, Premam] hall numbers
    const perms: number[][] = [[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]];
    const solutions = perms.filter(([drishyam, lucifer, premam]) => drishyam !== 1 && lucifer! > premam! && premam !== 2 && drishyam! < lucifer!);
    expect(solutions).toEqual([[2, 3, 1]]);
    expect(solutions[0]!.join('')).toBe(L3_LOGIC_CODE);
    expect(l3![1]!.answers).toEqual(['231']);
  });

  it('Level 3 hidden pattern is an acrostic', () => {
    expect(L3_PATTERN_LINES.map((l) => l[0]).join('')).toBe(L3_PATTERN_WORD);
    expect(l3![2]!.answers).toEqual(['MOHANLAL']);
    for (const line of L3_PATTERN_LINES) expect(l3![2]!.prompt).toContain(line);
  });

  it('Level 3 final password depends on the earlier clues', () => {
    expect(`${l3![2]!.answers[0]}-${l3![1]!.answers[0]}-${l3![0]!.answers[0]!.slice(0, 3)}`).toBe('MOHANLAL-231-PRE');
    expect(L3_FINAL_PASSWORD).toBe('MOHANLAL-231-PRE');
    expect(l3![3]!.answers).toEqual(['MOHANLAL-231-PRE']);
  });
});
