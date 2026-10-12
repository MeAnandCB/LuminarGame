import { rankTeams, type Ranked } from '../game/ranking.js';
import { isLive } from '../game/scoring.js';
import { CUTOFF_LEVELS, type LeaderboardRow } from '../../shared/types.js';
import type { Ctx, EventRow, RoundRow } from './context.js';

export interface Standing extends Ranked {
  /** Level after which the host cut the team; null while it is still in. */
  outLevel: number | null;
  roundScore: number;
  progress: number;
  progressTotal: number;
  lives: number | null;
  streak: number;
  eliminated: boolean;
}

/**
 * Ranking tier (see game/ranking.ts). Teams cut by the host rank below everyone who got further, the earlier the cut the lower.
 * Non-finalists rank last once the Final Showdown has frozen qualification; a finalist knocked out of lives ranks below every team still standing, whatever the points.
 */
function tierOf(team: { qualified: number; out_level: number | null }, frozen: boolean, showdownOut: boolean): number {
  if (team.out_level !== null) return 3 + (Math.max(...CUTOFF_LEVELS) - team.out_level);
  if (frozen && !team.qualified) return 2;
  return showdownOut ? 1 : 0;
}

/**
 * The single source of ranking truth. Always derived from the score ledger,
 * never from anything a browser holds.
 */
export function computeStandings(ctx: Ctx, ev: EventRow): Standing[] {
  const rounds = ctx.rounds(ev.id);
  const played = rounds.filter((r) => r.status !== 'pending');
  const focusLevel = played.length ? Math.max(...played.map((r) => r.level)) : 0;
  const current = ctx.currentRound(ev);

  const rows = ctx.db.all<{
    id: number;
    name: string;
    qualified: number;
    out_level: number | null;
    total: number;
    focus: number;
    solved: number;
    last_solve: number | null;
    round_score: number;
  }>(
    `SELECT t.id, t.name, t.qualified, t.out_level,
       COALESCE((SELECT SUM(l.points) FROM score_ledger l WHERE l.team_id = t.id), 0) AS total,
       COALESCE((SELECT SUM(l.points) FROM score_ledger l JOIN rounds r ON r.id = l.round_id WHERE l.team_id = t.id AND r.level = ?), 0) AS focus,
       (SELECT COUNT(*) FROM score_ledger l WHERE l.team_id = t.id AND l.kind = 'answer') AS solved,
       (SELECT MAX(l.at_ms) FROM score_ledger l WHERE l.team_id = t.id AND l.kind = 'answer') AS last_solve,
       COALESCE((SELECT SUM(l.points) FROM score_ledger l WHERE l.team_id = t.id AND l.round_id = ?), 0) AS round_score
     FROM teams t WHERE t.event_id = ? AND t.status = 'approved'`,
    focusLevel,
    current?.id ?? -1,
    ev.id,
  );

  const totals = new Map<number, number>();
  const progressTotal = current ? (ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM challenges WHERE round_id = ?', current.id)?.n ?? 0) : 0;
  if (current) {
    for (const p of ctx.db.all<{ team_id: number; position: number }>('SELECT team_id, position FROM team_stage_progress WHERE round_id = ?', current.id)) totals.set(p.team_id, p.position);
  }

  const liveState = new Map<number, { lives: number | null; streak: number; eliminated: number }>();
  if (current && isLive(current.kind)) {
    for (const l of ctx.db.all<{ team_id: number; lives: number | null; streak: number; eliminated: number }>('SELECT team_id, lives, streak, eliminated FROM live_team_state WHERE round_id = ?', current.id)) liveState.set(l.team_id, l);
    // Live rounds show the question number as progress.
    for (const [teamId] of liveState) totals.set(teamId, 0);
  }
  const frozen = ev.qualification_frozen === 1;
  const ranked = rankTeams(
    rows.map((r) => ({
      teamId: r.id,
      name: r.name,
      tier: tierOf(r, frozen, liveState.get(r.id)?.eliminated === 1),
      total: r.total,
      focus: r.focus,
      solved: r.solved,
      lastSolveAt: r.last_solve,
    })),
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ranked.map((r) => ({
    ...r,
    outLevel: byId.get(r.teamId)!.out_level,
    roundScore: byId.get(r.teamId)!.round_score,
    progress: totals.get(r.teamId) ?? 0,
    progressTotal: current && isLive(current.kind) ? 0 : progressTotal,
    lives: liveState.get(r.teamId)?.lives ?? null,
    streak: liveState.get(r.teamId)?.streak ?? 0,
    eliminated: liveState.get(r.teamId)?.eliminated === 1,
  }));
}

export function qualificationVisible(ctx: Ctx, ev: EventRow): boolean {
  return ev.qualification_frozen === 1 || !!ctx.db.get('SELECT 1 FROM teams WHERE event_id = ? AND qualified = 1', ev.id);
}

export function toRows(ctx: Ctx, ev: EventRow, standings: Standing[]): LeaderboardRow[] {
  const showQual = qualificationVisible(ctx, ev);
  const qualified = new Map(ctx.db.all<{ id: number; qualified: number }>('SELECT id, qualified FROM teams WHERE event_id = ?', ev.id).map((t) => [t.id, t.qualified === 1]));
  return standings.map((s) => ({
    rank: s.rank,
    teamId: s.teamId,
    name: s.name,
    total: s.total,
    roundScore: s.roundScore,
    solved: s.solved,
    progress: s.progress,
    progressTotal: s.progressTotal,
    connected: ctx.isConnected(s.teamId),
    qualified: showQual ? (qualified.get(s.teamId) ?? false) : null,
    outAfter: s.outLevel,
    tied: s.tied,
    lives: s.lives,
    streak: s.streak,
    eliminated: s.eliminated,
  }));
}

/** Persist the official standings for a scope ('round:2', 'final'). Idempotent. */
export function writeSnapshot(ctx: Ctx, ev: EventRow, scope: string, round?: RoundRow): void {
  const standings = computeStandings(ctx, ev);
  const show = qualificationVisible(ctx, ev);
  ctx.db.tx(() => {
    ctx.db.run('DELETE FROM leaderboard_snapshots WHERE event_id = ? AND scope = ?', ev.id, scope);
    const q = new Map(ctx.db.all<{ id: number; qualified: number }>('SELECT id, qualified FROM teams WHERE event_id = ?', ev.id).map((t) => [t.id, t.qualified]));
    for (const s of standings) {
      const roundPoints = round ? (ctx.db.get<{ p: number }>('SELECT COALESCE(SUM(points),0) p FROM score_ledger WHERE team_id = ? AND round_id = ?', s.teamId, round.id)?.p ?? 0) : s.focus;
      ctx.db.run(
        'INSERT INTO leaderboard_snapshots (event_id, scope, team_id, rank, total_points, round_points, solved, qualified, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        ev.id,
        scope,
        s.teamId,
        s.rank,
        s.total,
        roundPoints,
        s.solved,
        show ? (q.get(s.teamId) ?? 0) : null,
        ctx.nowIso(),
      );
    }
  });
}
