import { describe, expect, it } from 'vitest';
import { SEED_ROUNDS, type SeedChallenge } from '../../server/content/seed.js';
import { checkAnswer } from '../../server/game/normalize.js';

const [quiz, lightning, showdown] = SEED_ROUNDS.map((r) => r.challenges) as [SeedChallenge[], SeedChallenge[], SeedChallenge[]];
const keyText = (list: SeedChallenge[], title: string) => {
  const c = list.find((x) => x.title === title);
  if (!c) throw new Error(`no challenge titled ${title}`);
  return c.answers.map((a) => c.options!.find((o) => o.id === a)!.text);
};

describe('seeded content is structurally sound', () => {
  it('has the three games in order with the expected sizes', () => {
    expect(SEED_ROUNDS.map((r) => [r.level, r.kind])).toEqual([[1, 'quiz'], [2, 'lightning'], [3, 'showdown']]);
    expect(quiz.length).toBe(12);
    expect(lightning.length).toBe(12);
    expect(showdown.length).toBe(10);
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
          expect(c.options!.length).toBe(4);
          expect(new Set(c.options!.map((o) => o.text)).size).toBe(4);
          expect(c.options!.map((o) => o.id)).toEqual(['a', 'b', 'c', 'd']);
          expect(c.options!.some((o) => o.id === c.answers[0])).toBe(true);
        }
      }
    }
  });

  it('live games are all multiple choice (they are shown on the projector with option tiles)', () => {
    for (const c of [...lightning, ...showdown.filter((x) => x.kind === 'choice')]) expect(c.kind).toBe('choice');
  });

  it('correct options are spread across positions so there is no guessable pattern', () => {
    for (const list of [quiz, lightning, showdown]) {
      const positions = new Set(list.filter((c) => c.kind === 'choice').map((c) => c.answers[0]));
      expect(positions.size).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('Kerala film answer keys match the intended facts', () => {
  it('Level 1 - Quick Brain', () => {
    expect(keyText(quiz, 'Drishyam (2013)')).toEqual(['Jeethu Joseph']);
    expect(keyText(quiz, 'First talkie')).toEqual(['Balan']);
    expect(quiz.find((c) => c.title === 'Year of the first talkie')!.answers).toEqual(['1938']);
    expect(keyText(quiz, 'Father of Malayalam cinema')).toEqual(['J. C. Daniel']);
    expect(quiz.find((c) => c.title === 'First Malayalam film')!.answers).toEqual(['1928']);
    expect(keyText(quiz, 'The famous remake')).toEqual(['Manichitrathazhu']);
    expect(keyText(quiz, 'Manjummel Boys')).toEqual(['Guna Caves']);
    expect(keyText(quiz, 'The 100 crore club')).toEqual(['Pulimurugan']);
    expect(keyText(quiz, 'Jallikattu')).toEqual(['Lijo Jose Pellissery']);
    expect(keyText(quiz, 'Premam (2015)')).toEqual(['Alphonse Puthren']);
    expect(keyText(quiz, 'Adoor Gopalakrishnan')).toEqual(['Swayamvaram']);
    expect(keyText(quiz, 'Lucifer (2019)')).toEqual(['Prithviraj Sukumaran']);
  });

  it('Level 2 - Reel Rush', () => {
    expect(keyText(lightning, 'Cable operator')).toEqual(['Drishyam']);
    expect(keyText(lightning, 'Stephen Nedumpally')).toEqual(['Lucifer']);
    expect(keyText(lightning, 'Who is Malar?')).toEqual(['Sai Pallavi']);
    expect(keyText(lightning, 'The viral song')).toEqual(['Velipadinte Pustakam']);
    expect(keyText(lightning, 'Fishing village')).toEqual(['Kochi']);
    expect(keyText(lightning, 'Ganga and Nagavalli')).toEqual(['Shobana']);
    expect(keyText(lightning, 'Aadu Thoma')).toEqual(['Spadikam']);
    expect(keyText(lightning, 'Comedy director')).toEqual(['Priyadarshan']);
    expect(keyText(lightning, 'The 100 crore director')).toEqual(['Vysakh']);
    expect(keyText(lightning, 'Ranga')).toEqual(['Aavesham']);
    expect(keyText(lightning, 'Fan nickname')).toEqual(['Mammukka']);
    expect(keyText(lightning, 'Maheshinte Prathikaram')).toEqual(['Idukki']);
  });

  it('Level 3 - Final Showdown', () => {
    expect(keyText(showdown, 'First Golden Lotus')).toEqual(['Chemmeen']);
    expect(keyText(showdown, 'Source novel')).toEqual(['Thakazhi Sivasankara Pillai']);
    expect(keyText(showdown, 'Streaming debut')).toEqual(['Amazon Prime Video']);
    expect(keyText(showdown, 'Flood film')).toEqual(['2018: Everyone Is a Hero']);
    expect(keyText(showdown, 'The Kitchen')).toEqual(['Jeo Baby']);
    expect(keyText(showdown, 'Black and white')).toEqual(['Bramayugam']);
    expect(keyText(showdown, 'The Goat Life')).toEqual(['Benyamin']);
    expect(keyText(showdown, 'Evergreen hero')).toEqual(['Prem Nazir']);
    expect(keyText(showdown, 'The festival city')).toEqual(['Thiruvananthapuram']);
    expect(showdown.find((c) => c.title === 'National Awards')!.answers).toEqual(['3']);
  });

  it('numeric answers accept only the right number', () => {
    const q = showdown.find((c) => c.kind === 'number')!;
    expect(checkAnswer('number', '3', q.answers).correct).toBe(true);
    expect(checkAnswer('number', '3.0', q.answers).correct).toBe(true);
    expect(checkAnswer('number', 'three', q.answers).correct).toBe(false);
    expect(checkAnswer('number', '2', q.answers).correct).toBe(false);
  });
});
