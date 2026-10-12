import { describe, expect, it } from 'vitest';
import { SEED_ROUNDS, type SeedChallenge } from '../../server/content/seed.js';
import { checkAnswer } from '../../server/game/normalize.js';

const [faces, bingo, quiz, lightning, showdown] = SEED_ROUNDS.map((r) => r.challenges) as [SeedChallenge[], SeedChallenge[], SeedChallenge[], SeedChallenge[], SeedChallenge[]];
const keyText = (list: SeedChallenge[], title: string) => {
  const c = list.find((x) => x.title === title);
  if (!c) throw new Error(`no challenge titled ${title}`);
  return c.answers.map((a) => c.options!.find((o) => o.id === a)!.text);
};

describe('seeded content is structurally sound', () => {
  it('has the five games in order with the expected sizes', () => {
    expect(SEED_ROUNDS.map((r) => [r.level, r.kind])).toEqual([[1, 'faces'], [2, 'bingo'], [3, 'quiz'], [4, 'lightning'], [5, 'showdown']]);
    expect([faces, bingo, quiz, lightning, showdown].map((l) => l.length)).toEqual([10, 16, 12, 12, 10]);
  });

  it('every challenge has a prompt, a valid answer key and positive points', () => {
    for (const r of SEED_ROUNDS) {
      const titles = new Set<string>();
      for (const c of r.challenges) {
        expect(c.prompt.trim().length).toBeGreaterThan(10);
        expect(c.points).toBeGreaterThan(0);
        expect(c.answers.length).toBe(1);
        expect(titles.has(c.title), `duplicate title ${c.title}`).toBe(false);
        titles.add(c.title);
        if (c.kind === 'choice') {
          const n = r.kind === 'bingo' ? 16 : 4;
          expect(c.options!.length).toBe(n);
          expect(new Set(c.options!.map((o) => o.text)).size).toBe(n);
          expect(c.options!.map((o) => o.id)).toEqual('abcdefghijklmnop'.slice(0, n).split(''));
          expect(c.options!.some((o) => o.id === c.answers[0])).toBe(true);
        }
      }
    }
  });

  it('live games that are shown as option tiles are multiple choice (Showdown may include a number question)', () => {
    for (const c of [...faces, ...bingo, ...lightning, ...showdown.filter((x) => x.kind === 'choice')]) expect(c.kind).toBe('choice');
  });

  it('correct options are spread across positions so there is no guessable pattern', () => {
    for (const list of [faces, quiz, lightning, showdown]) {
      const positions = new Set(list.filter((c) => c.kind === 'choice').map((c) => c.answers[0]));
      expect(positions.size).toBeGreaterThanOrEqual(3);
    }
  });

  it('Tech Faces: every question has a numbered picture URL that does not reveal the answer, and a fact', () => {
    const urls = new Set<string>();
    for (const c of faces) {
      expect(c.image).toMatch(/^\/faces\/\d{2}$/);
      urls.add(c.image!);
      const name = c.options!.find((o) => o.id === c.answers[0])!.text.toLowerCase();
      expect(c.hint, `fact for ${c.title}`).toBeTruthy();
      expect(c.title.toLowerCase()).not.toContain(name);
      expect(c.prompt.toLowerCase()).not.toContain(name);
    }
    expect(urls.size).toBe(faces.length);
  });
});

describe('tech answer keys match the intended facts', () => {
  it('Level 1 - Tech Faces', () => {
    const who = faces.map((c) => keyText(faces, c.title)[0]);
    expect(who).toEqual(['Steve Jobs', 'Bill Gates', 'Elon Musk', 'Mark Zuckerberg', 'Sundar Pichai', 'Satya Nadella', 'Jeff Bezos', 'Larry Page', 'Linus Torvalds', 'Jensen Huang']);
  });

  it('Level 2 - Tech Bingo', () => {
    const tile = (n: number) => bingo[n - 1]!.options!.find((o) => o.id === bingo[n - 1]!.answers[0])!.text;
    expect(tile(1)).toBe('Bug');
    expect(tile(2)).toBe('Python');
    expect(tile(3)).toBe('Hashtag');
    expect(tile(5)).toBe('Emoji');
    expect(tile(12)).toBe('Robot');
    expect(tile(16)).toBe('Keyboard');
  });

  it('Level 3 - Quick Brain', () => {
    expect(keyText(quiz, 'Brain of the computer')).toEqual(['Central Processing Unit']);
    expect(keyText(quiz, 'Web styling')).toEqual(['CSS']);
    expect(quiz.find((c) => c.title === 'First iPhone')!.answers).toEqual(['2007']);
    expect(keyText(quiz, 'Inventor of the Web')).toEqual(['Tim Berners-Lee']);
    expect(quiz.find((c) => c.title === 'Bits in a byte')!.answers).toEqual(['8']);
    expect(keyText(quiz, 'The web protocol')).toEqual(['HyperText Transfer Protocol']);
    expect(keyText(quiz, 'Comedy-named language')).toEqual(['Python']);
    expect(keyText(quiz, 'Odd one out')).toEqual(['Ubuntu']);
    expect(keyText(quiz, 'Chatbot of 2022')).toEqual(['OpenAI']);
    expect(quiz.find((c) => c.title === 'Binary maths')!.answers).toEqual(['10']);
    expect(keyText(quiz, 'Voice assistant')).toEqual(['Siri']);
    expect(keyText(quiz, 'Social media owner')).toEqual(['Meta']);
  });

  it('Level 4 - Reel Rush', () => {
    expect(keyText(lightning, "Java's parent")).toEqual(['Sun Microsystems']);
    expect(keyText(lightning, 'Phone chips')).toEqual(['Qualcomm']);
    expect(keyText(lightning, 'Code home')).toEqual(['Microsoft']);
    expect(keyText(lightning, "Google's AI")).toEqual(['Gemini']);
    expect(keyText(lightning, 'Talking to databases')).toEqual(['SQL']);
    expect(keyText(lightning, 'Console maker')).toEqual(['Sony']);
    expect(keyText(lightning, 'Chip blueprints')).toEqual(['Arm']);
    expect(keyText(lightning, 'Electric truck')).toEqual(['Cybertruck']);
    expect(keyText(lightning, "Amazon's cloud")).toEqual(['AWS']);
    expect(keyText(lightning, 'Graphics chips')).toEqual(['Graphics Processing Unit']);
    expect(keyText(lightning, 'The padlock')).toEqual(['Secure']);
    expect(keyText(lightning, 'Linux mascot')).toEqual(['A penguin']);
  });

  it('Level 5 - Final Showdown', () => {
    expect(keyText(showdown, 'Memory-safe systems')).toEqual(['Mozilla']);
    expect(keyText(showdown, 'Version control')).toEqual(['Linus Torvalds']);
    expect(showdown.find((c) => c.title === "Google's birth")!.answers).toEqual(['1998']);
    expect(keyText(showdown, 'Browser pioneer')).toEqual(['Mosaic']);
    expect(keyText(showdown, 'Internet plumbing')).toEqual(['Transmission Control Protocol']);
    expect(keyText(showdown, 'First programmer')).toEqual(['Ada Lovelace']);
    expect(keyText(showdown, 'Apple silicon')).toEqual(['M1']);
    expect(keyText(showdown, 'Search ranking')).toEqual(['PageRank']);
    expect(keyText(showdown, 'AI hardware')).toEqual(['Nvidia']);
    expect(keyText(showdown, 'Email origins')).toEqual(['1970s']);
  });

  it('numeric answers accept only the right number', () => {
    const q = showdown.find((c) => c.kind === 'number')!;
    expect(checkAnswer('number', '1998', q.answers).correct).toBe(true);
    expect(checkAnswer('number', '1998.0', q.answers).correct).toBe(true);
    expect(checkAnswer('number', 'nineteen ninety-eight', q.answers).correct).toBe(false);
    expect(checkAnswer('number', '1999', q.answers).correct).toBe(false);
  });
});
