import { describe, expect, it } from 'vitest';
import { resolveLiveQuestion, type LiveTeamInput } from '../../server/game/liveRules.js';
import { DEFAULT_ROUND_CONFIG, liveDurationSec } from '../../server/game/scoring.js';

const lightning = DEFAULT_ROUND_CONFIG.lightning; // q=20s, speed<=100, fastest 50, streak 25 (cap 4), doubleDown on
const showdown = DEFAULT_ROUND_CONFIG.showdown; // q=25s, speed<=150, fastest 100, 3 lives, steal 75

const team = (id: number, o: Partial<LiveTeamInput> = {}): LiveTeamInput => ({
  teamId: id, name: `T${id}`, answered: true, correct: true, doubleDown: false, clockMs: 0, order: id,
  streakBefore: 0, livesBefore: null, totalBefore: 0, ...o,
});
const sum = (r: ReturnType<typeof resolveLiveQuestion>, id: number) => r.awards.filter((a) => a.teamId === id).reduce((n, a) => n + a.points, 0);
const kinds = (r: ReturnType<typeof resolveLiveQuestion>, id: number) => r.awards.filter((a) => a.teamId === id).map((a) => a.kind);

describe('Reel Rush scoring', () => {
  it('base + speed + fastest finger for the first correct answer only', () => {
    const r = resolveLiveQuestion({ cfg: lightning, basePoints: 100, questionStartClock: 0, teams: [team(1, { order: 5 }), team(2, { order: 3 })] });
    expect(r.fastestTeamId).toBe(2);
    expect(sum(r, 2)).toBe(100 + 100 + 50);
    expect(sum(r, 1)).toBe(100 + 100);
    expect(kinds(r, 1)).not.toContain('fastest_bonus');
  });

  it('speed bonus decays across the question window', () => {
    const half = resolveLiveQuestion({ cfg: lightning, basePoints: 100, questionStartClock: 1000, teams: [team(1, { clockMs: 1000 + 10_000 })] });
    expect(sum(half, 1)).toBe(100 + 50 + 50);
    const late = resolveLiveQuestion({ cfg: lightning, basePoints: 100, questionStartClock: 1000, teams: [team(1, { clockMs: 1000 + 20_000 })] });
    expect(sum(late, 1)).toBe(100 + 0 + 50);
  });

  it('streak bonus grows per consecutive correct answer up to the cap and resets on a miss', () => {
    const r = resolveLiveQuestion({ cfg: lightning, basePoints: 100, questionStartClock: 0, teams: [team(1, { streakBefore: 2 }), team(2, { streakBefore: 9 }), team(3, { streakBefore: 5, correct: false })] });
    expect(r.awards.find((a) => a.teamId === 1 && a.kind === 'streak_bonus')!.points).toBe(50);
    expect(r.awards.find((a) => a.teamId === 2 && a.kind === 'streak_bonus')!.points).toBe(100); // capped at x4
    expect(r.streakAfter.get(1)).toBe(3);
    expect(r.streakAfter.get(3)).toBe(0);
  });

  it('Double Down doubles base+speed when right and costs the base points when wrong', () => {
    const win = resolveLiveQuestion({ cfg: lightning, basePoints: 100, questionStartClock: 0, teams: [team(1, { doubleDown: true })] });
    expect(win.awards.find((a) => a.kind === 'double_down')!.points).toBe(200);
    const lose = resolveLiveQuestion({ cfg: lightning, basePoints: 100, questionStartClock: 0, teams: [team(1, { doubleDown: true, correct: false })] });
    expect(sum(lose, 1)).toBe(-100);
  });

  it('a team that did not answer scores nothing and loses its streak, without a Double Down penalty', () => {
    const r = resolveLiveQuestion({ cfg: lightning, basePoints: 100, questionStartClock: 0, teams: [team(1, { answered: false, correct: false, streakBefore: 3 })] });
    expect(r.awards).toEqual([]);
    expect(r.streakAfter.get(1)).toBe(0);
  });

  it('applies the optional wrong-answer penalty', () => {
    const r = resolveLiveQuestion({ cfg: { ...lightning, wrongPenalty: 20 }, basePoints: 100, questionStartClock: 0, teams: [team(1, { correct: false })] });
    expect(sum(r, 1)).toBe(-20);
  });

  it('nobody correct: no fastest bonus and no steal', () => {
    const r = resolveLiveQuestion({ cfg: showdown, basePoints: 200, questionStartClock: 0, teams: [team(1, { correct: false, livesBefore: 3, totalBefore: 500 })] });
    expect(r.fastestTeamId).toBeNull();
    expect(r.steal).toBeNull();
  });
});

describe('Final Showdown rules', () => {
  const at = (id: number, o: Partial<LiveTeamInput> = {}) => team(id, { livesBefore: 3, totalBefore: 100 * id, ...o });

  it('wrong or missing answers cost a life; correct answers keep theirs', () => {
    const r = resolveLiveQuestion({ cfg: showdown, basePoints: 200, questionStartClock: 0, teams: [at(1), at(2, { correct: false }), at(3, { answered: false, correct: false })] });
    expect(r.livesAfter.get(1)).toBe(3);
    expect(r.livesAfter.get(2)).toBe(2);
    expect(r.livesAfter.get(3)).toBe(2);
  });

  it('the fastest correct team steals from the highest-scoring team that just slipped', () => {
    const r = resolveLiveQuestion({ cfg: showdown, basePoints: 200, questionStartClock: 0, teams: [at(1), at(2, { correct: false }), at(3, { correct: false })] });
    expect(r.steal).toEqual({ thiefId: 1, victimId: 3, points: 75 });
    expect(r.awards.find((a) => a.kind === 'steal')!.points).toBe(75);
    expect(r.awards.find((a) => a.kind === 'stolen')!.points).toBe(-75);
  });

  it('never steals more than the victim has', () => {
    const r = resolveLiveQuestion({ cfg: showdown, basePoints: 200, questionStartClock: 0, teams: [at(1), at(2, { correct: false, totalBefore: 20 })] });
    expect(r.steal!.points).toBe(20);
  });

  it('eliminates teams that reach zero lives', () => {
    const r = resolveLiveQuestion({ cfg: showdown, basePoints: 200, questionStartClock: 0, teams: [at(1), at(2, { correct: false, livesBefore: 1 })] });
    expect(r.eliminated).toEqual([2]);
  });

  it('sudden-death protection: if every team would be eliminated at once, all keep one life', () => {
    const r = resolveLiveQuestion({ cfg: showdown, basePoints: 200, questionStartClock: 0, teams: [at(1, { correct: false, livesBefore: 1 }), at(2, { answered: false, correct: false, livesBefore: 1 })] });
    expect(r.eliminated).toEqual([]);
    expect(r.livesAfter.get(1)).toBe(1);
    expect(r.livesAfter.get(2)).toBe(1);
  });
});

describe('round timing helpers', () => {
  it('live round length is questions x (question + reveal) plus slack', () => {
    expect(liveDurationSec(12, lightning)).toBe(12 * 27 + 10);
    expect(liveDurationSec(10, showdown)).toBe(10 * 33 + 10);
  });
});
