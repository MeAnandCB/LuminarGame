import { describe, expect, it } from 'vitest';
import { SEED_ROUNDS } from '../../server/content/seed.js';
import { RULES } from '../../shared/rules.js';

const MALAYALAM = /[ഀ-ൿ]/;

describe('bilingual game rules', () => {
  it('cover every game', () => {
    expect(Object.keys(RULES).sort()).toEqual(SEED_ROUNDS.map((r) => r.kind).sort());
  });

  it('give every game the same rules in English and Malayalam', () => {
    for (const [kind, rules] of Object.entries(RULES)) {
      expect(rules.en.length, `${kind} has rules`).toBeGreaterThan(0);
      expect(rules.ml.length, `${kind}: Malayalam has one line per English rule`).toBe(rules.en.length);
    }
  });

  it('writes the English lines in English and the Malayalam lines in Malayalam script', () => {
    for (const [kind, rules] of Object.entries(RULES)) {
      for (const line of rules.en) expect(MALAYALAM.test(line), `${kind} English: ${line}`).toBe(false);
      for (const line of rules.ml) expect(MALAYALAM.test(line), `${kind} Malayalam: ${line}`).toBe(true);
    }
  });

  it('keeps each line short enough to read on a phone and a projector, and free of stray whitespace', () => {
    for (const [kind, rules] of Object.entries(RULES)) {
      for (const line of [...rules.en, ...rules.ml]) {
        expect(line, `${kind}: ${line}`).toBe(line.trim());
        expect(line.length, `${kind}: ${line}`).toBeLessThan(260);
      }
    }
  });
});
