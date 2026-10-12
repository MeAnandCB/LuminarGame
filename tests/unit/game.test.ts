import { describe, expect, it } from 'vitest';
import { checkAnswer, normalizeText, parseNumber } from '../../server/game/normalize.js';
import { speedBonus, parseRoundConfig, DEFAULT_ROUND_CONFIG } from '../../server/game/scoring.js';
import { acceptsSubmissions, elapsedClock, pauseTimer, remainingAt, resumeTimer, startTimer } from '../../server/game/timer.js';
import { rankTeams, selectFinalists, type RankInput } from '../../server/game/ranking.js';
import { InvalidTransitionError, TRANSITIONS, assertTransition, canTransition } from '../../server/game/stateMachine.js';
import { EVENT_STATES } from '../../shared/types.js';

describe('answer normalisation', () => {
  it('folds case, trims and collapses whitespace but keeps punctuation', () => {
    expect(normalizeText('  connect-42a ')).toBe('CONNECT-42A');
    expect(normalizeText('a   b')).toBe('A B');
    expect(normalizeText('CONNECT-42A')).not.toBe(normalizeText('CONNECT42A'));
  });
  it('text answers match case-insensitively and reject empties', () => {
    expect(checkAnswer('text', ' eph ', ['EPH']).correct).toBe(true);
    expect(checkAnswer('text', '', ['EPH']).correct).toBe(false);
    expect(checkAnswer('text', 'EPHX', ['EPH']).correct).toBe(false);
  });
  it('supports explicit alternative answers', () => {
    expect(checkAnswer('text', 'colour', ['COLOR', 'COLOUR']).correct).toBe(true);
  });
  it('numbers are parsed strictly', () => {
    expect(parseNumber('42')).toBe(42);
    expect(parseNumber('42.0')).toBe(42);
    expect(parseNumber('4 2')).toBeNull();
    expect(parseNumber('1e3')).toBeNull();
    expect(checkAnswer('number', '42.0', ['42']).correct).toBe(true);
    expect(checkAnswer('number', 'forty-two', ['42']).correct).toBe(false);
    expect(checkAnswer('number', '042', ['42']).correct).toBe(true);
  });
  it('choices compare option ids only', () => {
    expect(checkAnswer('choice', ' B ', ['b']).correct).toBe(true);
    expect(checkAnswer('choice', 'c', ['b']).correct).toBe(false);
    expect(checkAnswer('choice', '38', ['b']).correct).toBe(false);
  });
});

describe('scoring', () => {
  it('speed bonus decays linearly across the window', () => {
    expect(speedBonus(20, 30_000, 0)).toBe(20);
    expect(speedBonus(20, 30_000, 15_000)).toBe(10);
    expect(speedBonus(20, 30_000, 30_000)).toBe(0);
    expect(speedBonus(20, 30_000, 99_000)).toBe(0);
    expect(speedBonus(0, 30_000, 0)).toBe(0);
  });
  it('rejects invalid configuration', () => {
    expect(() => parseRoundConfig('quiz', { ...DEFAULT_ROUND_CONFIG.quiz, speedBonusMax: 99 })).toThrow(); // quiz bonus is capped at 20
    expect(() => parseRoundConfig('quiz', { ...DEFAULT_ROUND_CONFIG.quiz, durationSec: 1 })).toThrow();
    expect(() => parseRoundConfig('quiz', { ...DEFAULT_ROUND_CONFIG.quiz, hintPenalty: -5 })).toThrow();
    expect(() => parseRoundConfig('lightning', { ...DEFAULT_ROUND_CONFIG.lightning, questionSec: 1 })).toThrow();
    expect(() => parseRoundConfig('showdown', { ...DEFAULT_ROUND_CONFIG.showdown, lives: 99 })).toThrow();
    expect(parseRoundConfig('lightning', DEFAULT_ROUND_CONFIG.lightning).speedBonusMax).toBe(100);
    expect(parseRoundConfig('showdown', DEFAULT_ROUND_CONFIG.showdown).lives).toBe(3);
  });
});

describe('timer', () => {
  const start = 1_000_000;
  it('counts down and expires', () => {
    const t = startTimer(60_000, start);
    expect(remainingAt(t, start + 10_000)).toBe(50_000);
    expect(remainingAt(t, start + 70_000)).toBe(0);
  });
  it('pause records remaining time and resume sets a fresh deadline, repeatedly', () => {
    let t = startTimer(60_000, start);
    t = pauseTimer(t, start + 10_000);
    expect(t.remainingMs).toBe(50_000);
    expect(remainingAt(t, start + 999_999)).toBe(50_000); // frozen while paused
    t = resumeTimer(t, start + 100_000);
    expect(t.deadlineAt).toBe(start + 150_000);
    t = pauseTimer(t, start + 120_000);
    expect(t.remainingMs).toBe(30_000);
    t = resumeTimer(t, start + 500_000);
    expect(remainingAt(t, start + 500_000)).toBe(30_000);
    expect(elapsedClock(t, start + 500_000)).toBe(30_000);
  });
  it('deadline is inclusive and paused timers accept nothing', () => {
    const t = startTimer(1000, start);
    expect(acceptsSubmissions(t, start + 1000)).toBe(true);
    expect(acceptsSubmissions(t, start + 1001)).toBe(false);
    expect(acceptsSubmissions(pauseTimer(t, start + 5), start + 6)).toBe(false);
  });
  it('cannot pause/resume in the wrong status', () => {
    const t = startTimer(1000, start);
    expect(() => resumeTimer(t, start)).toThrow();
    expect(() => pauseTimer(pauseTimer(t, start), start)).toThrow();
  });
});

describe('ranking and tie-breaking', () => {
  const base = (o: Partial<RankInput> & { teamId: number }): RankInput => ({ name: `T${o.teamId}`, tier: 0, total: 0, focus: 0, solved: 0, lastSolveAt: null, ...o });
  it('orders by total, then focus level, then solved count, then earliest solve', () => {
    const r = rankTeams([
      base({ teamId: 1, total: 500, focus: 100, solved: 5, lastSolveAt: 10 }),
      base({ teamId: 2, total: 500, focus: 200, solved: 1, lastSolveAt: 99 }), // wins on focus
      base({ teamId: 3, total: 500, focus: 100, solved: 6, lastSolveAt: 50 }), // wins over 1 on solved
      base({ teamId: 4, total: 500, focus: 100, solved: 5, lastSolveAt: 5 }), // wins over 1 on earlier time
      base({ teamId: 5, total: 900 }),
    ]);
    expect(r.map((x) => x.teamId)).toEqual([5, 2, 3, 4, 1]);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(r.every((x) => !x.tied)).toBe(true);
  });
  it('is deterministic and flags full ties', () => {
    const inputs = [base({ teamId: 9, total: 100, lastSolveAt: 5 }), base({ teamId: 3, total: 100, lastSolveAt: 5 }), base({ teamId: 7, total: 50 })];
    const a = rankTeams(inputs);
    const b = rankTeams([...inputs].reverse());
    expect(a.map((x) => x.teamId)).toEqual(b.map((x) => x.teamId));
    expect(a.map((x) => x.teamId)).toEqual([3, 9, 7]);
    expect(a[0]!.tied && a[1]!.tied && !a[2]!.tied).toBe(true);
  });
  it('teams that never solved anything rank after teams that did on equal points', () => {
    const r = rankTeams([base({ teamId: 1, lastSolveAt: null }), base({ teamId: 2, lastSolveAt: 100 })]);
    expect(r[0]!.teamId).toBe(2);
  });
  it('finalists rank above others whatever their totals (tier)', () => {
    const r = rankTeams([base({ teamId: 1, total: 5000, tier: 1 }), base({ teamId: 2, total: 100, tier: 0 })]);
    expect(r[0]!.teamId).toBe(2);
  });
  it('a finalist eliminated in the Showdown ranks below the survivors but above non-finalists', () => {
    const r = rankTeams([
      base({ teamId: 1, total: 5000, tier: 1 }), // eliminated: lost all lives
      base({ teamId: 2, total: 3000, tier: 0 }), // still standing
      base({ teamId: 3, total: 9000, tier: 2 }), // never a finalist
    ]);
    expect(r.map((x) => x.teamId)).toEqual([2, 1, 3]);
  });
  it('selects the top N finalists, including fewer teams than N', () => {
    const r = rankTeams([base({ teamId: 1, total: 3 }), base({ teamId: 2, total: 2 }), base({ teamId: 3, total: 1 })]);
    expect(selectFinalists(r, 2)).toEqual([1, 2]);
    expect(selectFinalists(r, 10)).toEqual([1, 2, 3]);
  });
  it('breaks a tie at the qualification cutoff by the documented rule', () => {
    const r = rankTeams([base({ teamId: 1, total: 100, solved: 3, lastSolveAt: 9 }), base({ teamId: 2, total: 100, solved: 3, lastSolveAt: 4 })]);
    expect(selectFinalists(r, 1)).toEqual([2]);
  });
});

describe('state machine', () => {
  it('defines transitions for every state', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...EVENT_STATES].sort());
  });
  it('allows the happy path', () => {
    const path = ['SETUP', 'REGISTRATION_OPEN', 'LOBBY', 'ROUND_READY', 'ROUND_RUNNING', 'ROUND_PAUSED', 'ROUND_RUNNING', 'ROUND_ENDED', 'QUALIFICATION', 'ROUND_READY', 'ROUND_RUNNING', 'ROUND_ENDED', 'EVENT_COMPLETED'] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
  });
  it('rejects invalid transitions', () => {
    expect(canTransition('SETUP', 'ROUND_RUNNING')).toBe(false);
    expect(canTransition('ROUND_RUNNING', 'ROUND_RUNNING')).toBe(false);
    expect(canTransition('EVENT_COMPLETED', 'SETUP')).toBe(false);
    expect(() => assertTransition('LOBBY', 'ROUND_PAUSED')).toThrow(InvalidTransitionError);
  });
});
