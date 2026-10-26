import crypto from 'node:crypto';
import { isLive, liveDurationSec, parseRoundConfig } from '../game/scoring.js';
import { ChallengeEditError, applyEdit, applyTileEdit, type EditPatch, type EditableOption } from '../game/challengeEdit.js';
import { AppError, type ChallengeRow, type Ctx, type TeamRow } from './context.js';
import { award } from '../games/shared.js';
import { applyCutoff } from './cutoff.js';
import { computeStandings, qualificationVisible, writeSnapshot } from './standings.js';
import type { RoundConfig, RoundKind } from '../../shared/types.js';

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

export interface ChallengePatch extends EditPatch {
  points?: number;
  hint?: string | null;
}

/** Runs a pure edit and reports its complaints to the host as HTTP 400. */
function editOr400<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ChallengeEditError) throw new AppError(400, 'BAD_QUESTION', e.message);
    throw e;
  }
}

const parseOptions = (c: ChallengeRow): EditableOption[] | null => (c.options ? (JSON.parse(c.options) as EditableOption[]) : null);

/** Edits one question: its wording, option texts, correct answer(s), points and hint. Only before its round starts. */
export function updateChallenge(ctx: Ctx, actor: string, challengeId: number, patch: ChallengePatch): void {
  const ev = ctx.requireEvent();
  const row = ctx.db.get<ChallengeRow & { status: string; event_id: number; round_kind: RoundKind; level: number }>(
    'SELECT c.*, r.status, r.event_id, r.kind AS round_kind, r.level FROM challenges c JOIN rounds r ON r.id = c.round_id WHERE c.id = ?',
    challengeId,
  );
  if (!row || row.event_id !== ev.id) throw new AppError(404, 'NO_CHALLENGE', 'Challenge not found.');
  if (row.status !== 'pending') throw new AppError(409, 'LOCKED', 'Questions, answers and points cannot change once a round has started.');
  const before = { title: row.title, prompt: row.prompt, options: parseOptions(row), answers: JSON.parse(row.answers) as string[] };
  const after = editOr400(() => applyEdit({ kind: row.kind, ...before }, row.round_kind, patch));
  const changed = (['title', 'prompt', 'options', 'answers'] as const).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  ctx.db.tx(() => {
    if (changed.length > 0) {
      ctx.db.run('UPDATE challenges SET title = ?, prompt = ?, options = ?, answers = ? WHERE id = ?', after.title, after.prompt, after.options ? JSON.stringify(after.options) : null, JSON.stringify(after.answers), challengeId);
    }
    if (patch.points !== undefined) ctx.db.run('UPDATE challenges SET points = ? WHERE id = ?', patch.points, challengeId);
    if (patch.hint !== undefined) ctx.db.run('UPDATE challenges SET hint = ? WHERE id = ?', patch.hint && patch.hint.trim() ? patch.hint.trim() : null, challengeId);
    ctx.audit(ev.id, actor, 'challenge.update', {
      challengeId,
      level: row.level,
      ...(patch.points !== undefined ? { points: patch.points } : {}),
      ...(patch.hint !== undefined ? { hint: patch.hint } : {}),
      ...(changed.length > 0 ? { changed, before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, after[k]])) } : {}),
    });
  });
  ctx.emit({ teams: 'all' });
}

/** Renames the 16 shared Tech Bingo tiles (the card every team holds). The letters stay, so calls and cards still line up. */
export function updateBingoTiles(ctx: Ctx, actor: string, level: number, tiles: { id: string; text: string; icon: string }[]): void {
  const ev = ctx.requireEvent();
  const round = ctx.rounds(ev.id).find((r) => r.level === level);
  if (!round) throw new AppError(404, 'NO_ROUND', 'Unknown level.');
  if (round.kind !== 'bingo') throw new AppError(409, 'NOT_BINGO', 'Only the Tech Bingo round has tiles.');
  if (round.status !== 'pending') throw new AppError(409, 'LOCKED', 'Tiles cannot change once a round has started.');
  const calls = ctx.challenges(round.id);
  const current = parseOptions(calls[0]!) ?? [];
  const next = editOr400(() => applyTileEdit(current, tiles));
  ctx.db.tx(() => {
    for (const c of calls) ctx.db.run('UPDATE challenges SET options = ? WHERE id = ?', JSON.stringify(next), c.id);
    ctx.audit(ev.id, actor, 'bingo.tiles', { level, tiles: next.map((t) => `${t.icon} ${t.text}`) });
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
