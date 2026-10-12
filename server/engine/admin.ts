import crypto from 'node:crypto';
import { isLive, liveDurationSec, parseRoundConfig } from '../game/scoring.js';
import { AppError, type Ctx, type TeamRow } from './context.js';
import { award } from '../games/shared.js';
import { applyCutoff } from './cutoff.js';
import { computeStandings, qualificationVisible, writeSnapshot } from './standings.js';
import type { RoundConfig } from '../../shared/types.js';

export function adjustScore(ctx: Ctx, actor: string, teamId: number, points: number, reason: string): number {
  const ev = ctx.requireEvent();
  const team = ctx.db.get<TeamRow>("SELECT * FROM teams WHERE id = ? AND event_id = ? AND status = 'approved'", teamId, ev.id);
  if (!team) throw new AppError(404, 'NO_TEAM', 'Approved team not found.');
  if (ev.state === 'SETUP' || ev.state === 'REGISTRATION_OPEN' || ev.state === 'LOBBY') throw new AppError(409, 'INVALID_STATE', 'Scores can be adjusted once the first round is prepared.');
  const total = ctx.db.tx(() => {
    award(ctx, { ev, teamId, roundId: ev.current_round_id, challengeId: null, kind: 'admin_adjust', points, key: `adjust:${crypto.randomUUID()}`, actor, reason });
    ctx.audit(ev.id, actor, 'score.adjust', { teamId, team: team.name, points, reason });
    // Until the next round is prepared the cut-off follows the standings, so a correction can move a team across the line.
    const justEnded = ev.state === 'ROUND_ENDED' ? ctx.currentRound(ev) : undefined;
    if (justEnded) applyCutoff(ctx, ev, justEnded.level, actor);
    return ctx.db.get<{ t: number }>('SELECT COALESCE(SUM(points),0) t FROM score_ledger WHERE team_id = ?', teamId)!.t;
  });
  // Keep official snapshots in step with manual corrections.
  const fresh = ctx.event(ev.id);
  if (fresh.state === 'EVENT_COMPLETED') writeSnapshot(ctx, fresh, 'final');
  const current = ctx.currentRound(fresh);
  if (current && current.status === 'ended') writeSnapshot(ctx, fresh, `round:${current.level}`, current);
  ctx.emit({ teams: 'all' });
  return total;
}

export function updateRoundConfig(ctx: Ctx, actor: string, level: number, patch: Partial<RoundConfig>): RoundConfig {
  const ev = ctx.requireEvent();
  const round = ctx.rounds(ev.id).find((r) => r.level === level);
  if (!round) throw new AppError(404, 'NO_ROUND', 'Unknown level.');
  if (round.status !== 'pending') throw new AppError(409, 'LOCKED', 'Scoring and timers cannot change once a round has started.');
  const merged = { ...ctx.roundConfig(round), ...patch };
  if (isLive(round.kind)) merged.durationSec = liveDurationSec(ctx.challenges(round.id).length, merged);
  const next = parseRoundConfig(round.kind, merged);
  ctx.db.tx(() => {
    ctx.db.run('UPDATE rounds SET config = ? WHERE id = ?', JSON.stringify(next), round.id);
    ctx.audit(ev.id, actor, 'round.configure', { level, patch });
  });
  ctx.emit({ teams: 'all' });
  return next;
}

export function updateChallenge(ctx: Ctx, actor: string, challengeId: number, patch: { points?: number; hint?: string | null }): void {
  const ev = ctx.requireEvent();
  const row = ctx.db.get<{ id: number; round_id: number; status: string; event_id: number }>('SELECT c.id, c.round_id, r.status, r.event_id FROM challenges c JOIN rounds r ON r.id = c.round_id WHERE c.id = ?', challengeId);
  if (!row || row.event_id !== ev.id) throw new AppError(404, 'NO_CHALLENGE', 'Challenge not found.');
  if (row.status !== 'pending') throw new AppError(409, 'LOCKED', 'Points cannot change once a round has started.');
  ctx.db.tx(() => {
    if (patch.points !== undefined) ctx.db.run('UPDATE challenges SET points = ? WHERE id = ?', patch.points, challengeId);
    if (patch.hint !== undefined) ctx.db.run('UPDATE challenges SET hint = ? WHERE id = ?', patch.hint && patch.hint.trim() ? patch.hint.trim() : null, challengeId);
    ctx.audit(ev.id, actor, 'challenge.update', { challengeId, ...patch });
  });
  ctx.emit({ teams: 'all' });
}

const csvCell = (v: unknown): string => {
  let s = String(v ?? '');
  // Neutralise spreadsheet formula injection from user-supplied team/player names.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function exportCsv(ctx: Ctx): string {
  const ev = ctx.requireEvent();
  const standings = computeStandings(ctx, ev);
  const rounds = ctx.rounds(ev.id);
  const showQual = qualificationVisible(ctx, ev);
  const teams = new Map(ctx.db.all<TeamRow>('SELECT * FROM teams WHERE event_id = ?', ev.id).map((t) => [t.id, t]));
  const perRound = (teamId: number, roundId: number) => ctx.db.get<{ p: number }>('SELECT COALESCE(SUM(points),0) p FROM score_ledger WHERE team_id = ? AND round_id = ?', teamId, roundId)!.p;
  const unassigned = (teamId: number) => ctx.db.get<{ p: number }>('SELECT COALESCE(SUM(points),0) p FROM score_ledger WHERE team_id = ? AND round_id IS NULL', teamId)!.p;
  const head = ['Rank', 'Team', 'Player 1', 'Player 2', ...rounds.map((r) => `Level ${r.level} points`), 'Unassigned adjustments', 'Total', 'Challenges solved', 'Finalist', 'Out after level', 'Tied on all criteria'];
  const lines = [head.map(csvCell).join(',')];
  for (const s of standings) {
    const t = teams.get(s.teamId)!;
    lines.push(
      [s.rank, s.name, t.player1, t.player2, ...rounds.map((r) => perRound(s.teamId, r.id)), unassigned(s.teamId), s.total, s.solved, showQual ? (t.qualified ? 'yes' : 'no') : '', t.out_level ?? '', s.tied ? 'yes' : 'no'].map(csvCell).join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}
