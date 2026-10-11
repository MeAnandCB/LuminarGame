import type { RoundConfig } from '../../shared/types.js';
import { speedBonus } from './scoring.js';

/** Pure scoring rules shared by Level 2 (Reel Rush) and Level 3 (Final Showdown). */

export interface LiveTeamInput {
  teamId: number;
  name: string;
  /** Locked an answer in before the question closed. */
  answered: boolean;
  correct: boolean;
  doubleDown: boolean;
  /** Round clock (ms) when the answer arrived. */
  clockMs: number | null;
  /** Arrival order (submission id). Lower = earlier. */
  order: number;
  streakBefore: number;
  livesBefore: number | null;
  totalBefore: number;
}

export type AwardKind = 'answer' | 'speed_bonus' | 'fastest_bonus' | 'streak_bonus' | 'double_down' | 'wrong_penalty' | 'steal' | 'stolen';

export interface Award {
  teamId: number;
  kind: AwardKind;
  points: number;
  label: string;
}

export interface LiveResolution {
  awards: Award[];
  streakAfter: Map<number, number>;
  livesAfter: Map<number, number | null>;
  eliminated: number[];
  fastestTeamId: number | null;
  steal: { thiefId: number; victimId: number; points: number } | null;
}

export function resolveLiveQuestion(p: {
  cfg: RoundConfig;
  basePoints: number;
  /** Round clock when this question opened. */
  questionStartClock: number;
  teams: LiveTeamInput[];
}): LiveResolution {
  const { cfg, basePoints, questionStartClock } = p;
  const questionMs = cfg.questionSec * 1000;
  const awards: Award[] = [];
  const streakAfter = new Map<number, number>();
  const livesAfter = new Map<number, number | null>();
  const eliminated: number[] = [];

  const correct = p.teams.filter((t) => t.answered && t.correct).sort((a, b) => a.order - b.order);
  const fastest = correct[0] ?? null;

  for (const t of p.teams) {
    if (t.answered && t.correct) {
      const speed = speedBonus(cfg.speedBonusMax, questionMs, (t.clockMs ?? questionStartClock + questionMs) - questionStartClock);
      awards.push({ teamId: t.teamId, kind: 'answer', points: basePoints, label: 'Correct answer' });
      if (speed > 0) awards.push({ teamId: t.teamId, kind: 'speed_bonus', points: speed, label: 'Speed bonus' });
      if (fastest && t.teamId === fastest.teamId && cfg.fastestBonus > 0) awards.push({ teamId: t.teamId, kind: 'fastest_bonus', points: cfg.fastestBonus, label: 'Fastest finger' });
      const streakPoints = Math.min(t.streakBefore, cfg.streakCap) * cfg.streakBonus;
      if (streakPoints > 0) awards.push({ teamId: t.teamId, kind: 'streak_bonus', points: streakPoints, label: `Streak x${t.streakBefore + 1}` });
      if (t.doubleDown) awards.push({ teamId: t.teamId, kind: 'double_down', points: basePoints + speed, label: 'Double Down!' });
      streakAfter.set(t.teamId, t.streakBefore + 1);
      livesAfter.set(t.teamId, t.livesBefore);
    } else {
      if (t.answered && cfg.wrongPenalty > 0) awards.push({ teamId: t.teamId, kind: 'wrong_penalty', points: -cfg.wrongPenalty, label: 'Wrong answer' });
      if (t.answered && t.doubleDown) awards.push({ teamId: t.teamId, kind: 'double_down', points: -basePoints, label: 'Double Down failed' });
      streakAfter.set(t.teamId, 0);
      livesAfter.set(t.teamId, t.livesBefore === null ? null : t.livesBefore - 1);
    }
  }

  // Lives: anyone at 0 is out - unless that would knock out every team still standing (sudden-death protection).
  if (cfg.lives > 0) {
    const out = p.teams.filter((t) => (livesAfter.get(t.teamId) ?? 1) <= 0);
    const alive = p.teams.filter((t) => (livesAfter.get(t.teamId) ?? 1) > 0);
    if (out.length > 0 && alive.length === 0) {
      for (const t of out) livesAfter.set(t.teamId, 1);
    } else {
      for (const t of out) eliminated.push(t.teamId);
    }
  }

  // Steal: the fastest correct team takes points from the leader among the teams that just slipped.
  let steal: LiveResolution['steal'] = null;
  if (cfg.stealPoints > 0 && fastest) {
    const victims = p.teams.filter((t) => !(t.answered && t.correct) && t.totalBefore > 0).sort((a, b) => b.totalBefore - a.totalBefore || a.teamId - b.teamId);
    const victim = victims[0];
    if (victim) {
      const points = Math.min(cfg.stealPoints, victim.totalBefore);
      awards.push({ teamId: fastest.teamId, kind: 'steal', points, label: `Stole from ${victim.name}` });
      awards.push({ teamId: victim.teamId, kind: 'stolen', points: -points, label: `Stolen by ${fastest.name}` });
      steal = { thiefId: fastest.teamId, victimId: victim.teamId, points };
    }
  }

  return { awards, streakAfter, livesAfter, eliminated, fastestTeamId: fastest?.teamId ?? null, steal };
}
