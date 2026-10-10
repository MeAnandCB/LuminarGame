import type { Ctx, EventRow, RoundRow, TeamRow, ChallengeRow } from './context.js';
import { computeStandings, qualificationVisible, toRows, type Standing } from './standings.js';
import { eligibleForRound } from './play.js';
import { allowedActions } from './actions.js';
import { remainingAt } from '../game/timer.js';
import type {
  AdminChallenge, AdminRound, AdminState, AdminTeam, AuditEntry, LeaderboardRow, PublicRound, PublicState,
  RevealedItem, ScoreChange, TeamChallenge, TeamHistoryItem, TeamState,
} from '../../shared/types.js';

const parse = <T>(s: string | null): T | null => (s ? (JSON.parse(s) as T) : null);

function publicRound(ctx: Ctx, r: RoundRow): PublicRound {
  const cfg = ctx.roundConfig(r);
  const t = ctx.timer(r);
  return {
    id: r.id,
    level: r.level,
    name: r.name,
    status: r.status,
    instructions: r.instructions,
    total: ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM challenges WHERE round_id = ?', r.id)!.n,
    durationMs: cfg.durationSec * 1000,
    deadlineAt: r.status === 'running' ? r.deadline_at : null,
    remainingMs: remainingAt(t, ctx.clock.now()),
    answersRevealed: r.answers_revealed === 1,
  };
}

function reveal(ctx: Ctx, ev: EventRow): RevealedItem[] | null {
  const round = ctx.rounds(ev.id).filter((r) => r.answers_revealed === 1 && r.status === 'ended').pop();
  if (!round) return null;
  return ctx.challenges(round.id).map((c) => {
    const answers = JSON.parse(c.answers) as string[];
    const opts = parse<{ id: string; text: string }[]>(c.options);
    const answer = c.kind === 'choice' && opts ? answers.map((a) => opts.find((o) => o.id === a)?.text ?? a).join(' / ') : answers[0]!;
    return { position: c.position, title: c.title, prompt: c.prompt, answer };
  });
}

function recent(ctx: Ctx, ev: EventRow): ScoreChange[] {
  return ctx.db
    .all<{ id: number; team_id: number; name: string; points: number; kind: string; at_ms: number }>(
      `SELECT l.id, l.team_id, t.name, l.points, l.kind, l.at_ms FROM score_ledger l JOIN teams t ON t.id = l.team_id
       WHERE l.event_id = ? AND t.status = 'approved' AND l.kind <> 'hint_penalty' ORDER BY l.id DESC LIMIT 8`,
      ev.id,
    )
    .map((r) => ({ id: r.id, teamId: r.team_id, teamName: r.name, points: r.points, kind: r.kind, at: r.at_ms }));
}

function counts(ctx: Ctx, ev: EventRow, standings: Standing[]): PublicState['counts'] {
  const round = ctx.currentRound(ev);
  const submissions = round ? ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM answer_submissions WHERE round_id = ? AND outcome IN ('correct','incorrect')", round.id)!.n : 0;
  const finished = round ? ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM team_stage_progress WHERE round_id = ? AND finished_at IS NOT NULL', round.id)!.n : 0;
  return {
    teams: standings.length,
    connected: standings.filter((s) => ctx.isConnected(s.teamId)).length,
    submissions,
    finished,
    capacity: ctx.settings(ev).maxTeams,
  };
}

function scoresHidden(ctx: Ctx, ev: EventRow): boolean {
  return !ctx.settings(ev).liveScores && (ev.state === 'ROUND_RUNNING' || ev.state === 'ROUND_PAUSED');
}

export function publicState(ctx: Ctx): PublicState {
  const ev = ctx.currentEvent();
  const now = ctx.clock.now();
  if (!ev) {
    return { serverNow: now, event: null, round: null, nextLevel: null, counts: { teams: 0, connected: 0, submissions: 0, finished: 0, capacity: 20 }, leaderboard: [], provisional: false, scoresHidden: false, recent: [], finalists: [], podium: null, reveal: null };
  }
  const standings = computeStandings(ctx, ev);
  const hidden = scoresHidden(ctx, ev);
  const provisional = ev.state === 'ROUND_RUNNING' || ev.state === 'ROUND_PAUSED';
  let rows: LeaderboardRow[] = toRows(ctx, ev, standings);
  if (hidden) rows = rows.map((r) => ({ ...r, total: 0, roundScore: 0, solved: 0, rank: 0, tied: false })).sort((a, b) => a.name.localeCompare(b.name));
  const round = ctx.currentRound(ev);
  const rounds = ctx.rounds(ev.id);
  const lastEnded = rounds.filter((r) => r.status === 'ended').length;
  const showQual = qualificationVisible(ctx, ev) && (ev.state === 'QUALIFICATION' || ev.state === 'EVENT_COMPLETED' || ev.qualification_frozen === 1 || ev.state === 'ROUND_READY');
  return {
    serverNow: now,
    event: { name: ev.name, pin: ev.pin, state: ev.state, joinUrl: ctx.joinUrlFor(ev.pin) },
    round: round ? publicRound(ctx, round) : null,
    nextLevel: lastEnded < rounds.length ? lastEnded + 1 : null,
    counts: counts(ctx, ev, standings),
    leaderboard: rows,
    provisional,
    scoresHidden: hidden,
    recent: hidden ? [] : recent(ctx, ev),
    finalists: showQual ? rows.filter((r) => r.qualified).map((r) => ({ teamId: r.teamId, name: r.name })) : [],
    podium: ev.state === 'EVENT_COMPLETED' ? rows.slice(0, 3) : null,
    reveal: reveal(ctx, ev),
  };
}

function teamChallenge(c: ChallengeRow, total: number): TeamChallenge {
  return { id: c.id, position: c.position, total, kind: c.kind, title: c.title, prompt: c.prompt, options: parse(c.options), points: c.points };
}

export function teamState(ctx: Ctx, team: TeamRow, cached?: Standing[]): TeamState {
  const ev = ctx.event(team.event_id);
  const now = ctx.clock.now();
  const standings = cached ?? computeStandings(ctx, ev);
  const me = standings.find((s) => s.teamId === team.id);
  const round = ctx.currentRound(ev);
  const hidden = scoresHidden(ctx, ev);
  const total = ctx.db.get<{ t: number }>('SELECT COALESCE(SUM(points),0) t FROM score_ledger WHERE team_id = ?', team.id)!.t;
  const roundScore = round ? ctx.db.get<{ t: number }>('SELECT COALESCE(SUM(points),0) t FROM score_ledger WHERE team_id = ? AND round_id = ?', team.id, round.id)!.t : 0;

  const state: TeamState = {
    serverNow: now,
    team: { id: team.id, name: team.name, players: [team.player1, team.player2], code: team.team_code, status: team.status },
    eventState: ev.state,
    score: { total, round: roundScore },
    rank: me && !hidden ? me.rank : null,
    rankHidden: hidden,
    qualified: qualificationVisible(ctx, ev) ? team.qualified === 1 : null,
    eligible: false,
    progress: null,
    challenge: null,
    solved: [],
    hint: null,
    history: [],
    award: null,
  };

  if (ev.state === 'EVENT_COMPLETED' && me) {
    state.award = me.rank === 1 ? 'Champion' : me.rank === 2 ? 'Runner-up' : me.rank === 3 ? 'Third place' : team.qualified ? 'Finalist' : 'Participant';
  }
  if (!round) return state;

  state.eligible = eligibleForRound(team, round);
  if (!state.eligible) return state;
  const items = ctx.challenges(round.id);
  const prog = ctx.db.get<{ position: number; finished_at: number | null }>('SELECT position, finished_at FROM team_stage_progress WHERE team_id = ? AND round_id = ?', team.id, round.id);
  const position = prog?.position ?? 0;
  const finished = position >= items.length;
  state.progress = { position, total: items.length, finished };

  const live = ev.state === 'ROUND_RUNNING' || ev.state === 'ROUND_PAUSED';
  if (live && !finished) {
    state.challenge = teamChallenge(items[position]!, items.length);
    const cfg = ctx.roundConfig(round);
    const current = items[position]!;
    const used = !!ctx.db.get('SELECT 1 FROM hints_used WHERE team_id = ? AND challenge_id = ?', team.id, current.id);
    state.hint = { available: cfg.hintsEnabled && !!current.hint, used, text: used ? current.hint : null, penalty: cfg.hintPenalty };
  }
  if (round.kind === 'puzzle') {
    state.solved = items.slice(0, position).map((c) => ({ position: c.position, title: c.title, answer: JSON.parse(c.answers)[0] as string }));
  }
  // History of own answers (used for review after the host reveals answers).
  const subs = ctx.db.all<{ challenge_id: number; outcome: 'correct' | 'incorrect'; points: number; raw_answer: string }>(
    "SELECT challenge_id, outcome, points, raw_answer FROM answer_submissions WHERE team_id = ? AND round_id = ? AND outcome IN ('correct','incorrect') ORDER BY id",
    team.id,
    round.id,
  );
  if (round.kind === 'quiz') {
    const byChallenge = new Map(subs.map((s) => [s.challenge_id, s]));
    state.history = items.flatMap((c): TeamHistoryItem[] => {
      const s = byChallenge.get(c.id);
      if (!s) return [];
      const opts = parse<{ id: string; text: string }[]>(c.options);
      const yourAnswer = c.kind === 'choice' && opts ? (opts.find((o) => o.id === s.raw_answer.trim().toLowerCase())?.text ?? s.raw_answer) : s.raw_answer;
      return [{ position: c.position, title: c.title, outcome: s.outcome, points: s.points, yourAnswer }];
    });
  }
  return state;
}

function adminChallenge(c: ChallengeRow): AdminChallenge {
  return { id: c.id, position: c.position, kind: c.kind, title: c.title, prompt: c.prompt, options: parse(c.options), answers: JSON.parse(c.answers), points: c.points, hint: c.hint };
}

export function adminState(ctx: Ctx): AdminState | null {
  const ev = ctx.currentEvent();
  if (!ev) return null;
  const now = ctx.clock.now();
  const standings = computeStandings(ctx, ev);
  const rows = toRows(ctx, ev, standings);
  const totals = new Map(standings.map((s) => [s.teamId, s.total]));
  const teams = ctx.db.all<TeamRow>("SELECT * FROM teams WHERE event_id = ? AND status <> 'removed' ORDER BY id", ev.id);
  // Near-duplicates ("Team-1" vs "team 1") are flagged for the host even though exact duplicates are blocked at join time.
  const loose = (n: string) => n.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const nameCount = new Map<string, number>();
  for (const t of teams) if (t.status === 'pending' || t.status === 'approved') nameCount.set(loose(t.name), (nameCount.get(loose(t.name)) ?? 0) + 1);
  const devices = new Map(ctx.db.all<{ team_id: number; n: number }>('SELECT team_id, COUNT(*) n FROM team_sessions GROUP BY team_id').map((r) => [r.team_id, r.n]));
  const adminTeams: AdminTeam[] = teams.map((t) => ({
    id: t.id, name: t.name, players: [t.player1, t.player2], code: t.team_code, status: t.status, connected: ctx.isConnected(t.id),
    devices: devices.get(t.id) ?? 0, total: totals.get(t.id) ?? 0, qualified: t.qualified === 1,
    duplicateName: (t.status === 'pending' || t.status === 'approved') && (nameCount.get(loose(t.name)) ?? 0) > 1, createdAt: t.created_at,
  }));
  const rounds: AdminRound[] = ctx.rounds(ev.id).map((r) => ({
    id: r.id, level: r.level, name: r.name, kind: r.kind, status: r.status, config: ctx.roundConfig(r), instructions: r.instructions,
    challenges: ctx.challenges(r.id).map(adminChallenge), startedAt: r.started_at, endedAt: r.ended_at,
    deadlineAt: r.status === 'running' ? r.deadline_at : null, remainingMs: remainingAt(ctx.timer(r), now), answersRevealed: r.answers_revealed === 1,
  }));
  const audit: AuditEntry[] = ctx.db
    .all<{ id: number; actor: string; action: string; details: string; created_at: string }>('SELECT id, actor, action, details, created_at FROM audit_logs WHERE event_id = ? ORDER BY id DESC LIMIT 200', ev.id)
    .map((a) => ({ id: a.id, actor: a.actor, action: a.action, details: a.details, createdAt: a.created_at }));
  return {
    serverNow: now,
    event: { id: ev.id, name: ev.name, pin: ev.pin, state: ev.state, settings: ctx.settings(ev), currentRoundId: ev.current_round_id, qualificationFrozen: ev.qualification_frozen === 1, joinUrls: [ctx.joinUrlFor(ev.pin)] },
    allowedActions: allowedActions(ctx, ev),
    rounds,
    teams: adminTeams,
    leaderboard: rows,
    audit,
    counts: counts(ctx, ev, standings),
  };
}
