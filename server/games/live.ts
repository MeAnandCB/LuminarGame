/**
 * Live, host-paced games: Tech Faces (faces), Tech Bingo (bingo), Reel Rush (lightning) and Final Showdown (showdown).
 *
 * Every team sees the same question at the same time. A question goes through two phases:
 *   open   (config.questionSec)  answers are locked in but NOT scored yet
 *   reveal (config.revealSec)    the question is resolved: correct answer, bonuses, streaks, lives, steals
 * Phases are measured on the round's pause-safe "active play" clock, so pausing the round freezes the
 * question timer too. The ticker (and every submission) calls liveAdvance(), which moves the phases along
 * and resolves questions inside one transaction. Scoring rules live in game/liveRules.ts (pure, unit tested).
 */
import { checkAnswer } from '../game/normalize.js';
import { bingoLayout, cellsOfLines, completedLines, BINGO_CELLS } from '../game/bingo.js';
import { resolveLiveQuestion, type Award, type LiveTeamInput } from '../game/liveRules.js';
import { isLive } from '../game/scoring.js';
import { elapsedClock } from '../game/timer.js';
import { AppError, type ChallengeRow, type Ctx, type EventRow, type RoundRow, type TeamRow } from '../engine/context.js';
import { endRound } from '../engine/events.js';
import type { AnswerResult, BingoPublic, LiveOption, LivePublic, LiveReveal, RoundConfig, TeamBingo, TeamLive } from '../../shared/types.js';
import { award, eligibilityProblem, result, type SubmitInput } from './shared.js';

interface LiveTeamRow {
  team_id: number;
  round_id: number;
  streak: number;
  lives: number | null;
  eliminated: number;
  double_used: number;
}

const phaseMs = (cfg: RoundConfig, phase: 'open' | 'reveal') => (phase === 'open' ? cfg.questionSec : cfg.revealSec) * 1000;
const parse = <T>(s: string | null): T | null => (s ? (JSON.parse(s) as T) : null);

// ---- bingo helpers ---------------------------------------------------------------

type Tile = { id: string; text: string; icon: string };

function bingoTiles(items: ChallengeRow[]): Tile[] {
  const raw = parse<Tile[]>(items[0]?.options ?? null) ?? [];
  return raw.map((t) => ({ id: t.id, text: t.text, icon: t.icon ?? '' }));
}

/** Tile ids of the calls that have been resolved (not voided), in call order. */
function calledTiles(ctx: Ctx, round: RoundRow): string[] {
  return ctx.db
    .all<{ answers: string }>("SELECT c.answers FROM challenges c JOIN live_question_log l ON l.challenge_id = c.id AND l.round_id = c.round_id AND l.status = 'resolved' WHERE c.round_id = ? ORDER BY c.position", round.id)
    .map((r) => (JSON.parse(r.answers) as string[])[0]!);
}

/** Tiles each team has correctly marked on resolved calls. Open (unresolved) answers are never included. */
function markedByTeam(ctx: Ctx, round: RoundRow): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  const rows = ctx.db.all<{ team_id: number; answers: string }>(
    "SELECT s.team_id, c.answers FROM answer_submissions s JOIN challenges c ON c.id = s.challenge_id JOIN live_question_log l ON l.challenge_id = c.id AND l.round_id = s.round_id AND l.status = 'resolved' WHERE s.round_id = ? AND s.outcome = 'correct'",
    round.id,
  );
  for (const r of rows) {
    const set = out.get(r.team_id) ?? new Set<string>();
    set.add((JSON.parse(r.answers) as string[])[0]!);
    out.set(r.team_id, set);
  }
  return out;
}

const layoutFor = (tiles: Tile[], teamId: number, round: RoundRow) => bingoLayout(tiles.map((t) => t.id), teamId, round.id);

function alive(ctx: Ctx, round: RoundRow): LiveTeamRow[] {
  return ctx.db.all<LiveTeamRow>(
    "SELECT l.* FROM live_team_state l JOIN teams t ON t.id = l.team_id WHERE l.round_id = ? AND l.eliminated = 0 AND t.status = 'approved' ORDER BY l.team_id",
    round.id,
  );
}

export function initLive(ctx: Ctx, ev: EventRow, round: RoundRow): void {
  const cfg = ctx.roundConfig(round);
  const teams = ctx.db.all<{ id: number }>(`SELECT id FROM teams WHERE event_id = ? AND status = 'approved' AND (out_level IS NULL OR out_level >= ?) ${round.kind === 'showdown' ? 'AND qualified = 1' : ''}`, ev.id, round.level);
  ctx.db.run('DELETE FROM live_team_state WHERE round_id = ?', round.id);
  // A starting round has no history. Without this, a stale "resolved" row from an earlier run silently skips scoring for that question.
  ctx.db.run('DELETE FROM live_question_log WHERE round_id = ?', round.id);
  for (const t of teams) ctx.db.run('INSERT INTO live_team_state (team_id, round_id, streak, lives, eliminated, double_used) VALUES (?,?,0,?,0,0)', t.id, round.id, cfg.lives > 0 ? cfg.lives : null);
  ctx.db.run("UPDATE rounds SET live_index = 0, live_phase = 'open', live_clock_start = 0, live_q_start = 0 WHERE id = ?", round.id);
}

function currentLive(ctx: Ctx): { ev: EventRow; round: RoundRow } | null {
  const ev = ctx.currentEvent();
  if (!ev) return null;
  const round = ctx.currentRound(ev);
  if (!round || !isLive(round.kind)) return null;
  return { ev, round };
}

// ---- phase machine --------------------------------------------------------------

/** Moves the live phases forward as far as the round clock allows. Safe to call at any time. */
export function liveAdvance(ctx: Ctx): boolean {
  const cur = currentLive(ctx);
  if (!cur || cur.ev.state !== 'ROUND_RUNNING' || cur.round.status !== 'running') return false;
  let changed = false;
  for (let guard = 0; guard < 200; guard++) {
    const round = ctx.round(cur.round.id);
    if (round.status !== 'running' || !round.live_phase) break;
    const cfg = ctx.roundConfig(round);
    const clock = elapsedClock(ctx.timer(round), ctx.clock.now());
    const end = round.live_clock_start + phaseMs(cfg, round.live_phase);
    // The deadline is inclusive: an answer arriving exactly at the end of the window still counts.
    if (round.live_phase === 'open' ? clock <= end : clock < end) break;
    changed = true;
    const items = ctx.challenges(round.id);
    if (round.live_phase === 'open') {
      ctx.db.tx(() => {
        resolveQuestion(ctx, cur.ev, round, items[round.live_index]!);
        ctx.db.run("UPDATE rounds SET live_phase = 'reveal', live_clock_start = ? WHERE id = ?", end, round.id);
      });
      continue;
    }
    const last = round.live_index + 1 >= items.length;
    const standing = alive(ctx, round).length;
    const total = ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM live_team_state WHERE round_id = ?', round.id)!.n;
    if (last || (round.kind === 'showdown' && total > 1 && standing <= 1)) {
      endRound(ctx, 'system', last ? 'all questions played' : 'last team standing');
      break;
    }
    ctx.db.run("UPDATE rounds SET live_index = live_index + 1, live_phase = 'open', live_clock_start = ?, live_q_start = ? WHERE id = ?", end, end, round.id);
  }
  if (changed) ctx.emit({ teams: 'all' });
  return changed;
}

/** Make the current phase end right now (all answered / host pressed the button). */
function endPhaseNow(ctx: Ctx, round: RoundRow): void {
  if (!round.live_phase) return;
  const cfg = ctx.roundConfig(round);
  const clock = elapsedClock(ctx.timer(round), ctx.clock.now());
  ctx.db.run('UPDATE rounds SET live_clock_start = ? WHERE id = ?', clock - phaseMs(cfg, round.live_phase) - 1, round.id);
}

function resolveQuestion(ctx: Ctx, ev: EventRow, round: RoundRow, ch: ChallengeRow): void {
  if (ctx.db.get('SELECT 1 FROM live_question_log WHERE round_id = ? AND challenge_id = ?', round.id, ch.id)) return;
  const cfg = ctx.roundConfig(round);
  const states = alive(ctx, round);
  const subs = new Map(
    ctx.db
      .all<{ id: number; team_id: number; outcome: string; clock_ms: number | null; double_down: number }>("SELECT id, team_id, outcome, clock_ms, double_down FROM answer_submissions WHERE challenge_id = ? AND outcome IN ('correct','incorrect')", ch.id)
      .map((s) => [s.team_id, s]),
  );
  const totals = new Map(ctx.db.all<{ team_id: number; t: number }>('SELECT team_id, SUM(points) t FROM score_ledger WHERE event_id = ? GROUP BY team_id', ev.id).map((r) => [r.team_id, r.t]));
  const names = new Map(ctx.db.all<{ id: number; name: string }>('SELECT id, name FROM teams WHERE event_id = ?', ev.id).map((t) => [t.id, t.name]));

  const inputs: LiveTeamInput[] = states.map((st) => {
    const s = subs.get(st.team_id);
    return {
      teamId: st.team_id,
      name: names.get(st.team_id) ?? '?',
      answered: !!s,
      correct: s?.outcome === 'correct',
      doubleDown: s?.double_down === 1,
      clockMs: s?.clock_ms ?? null,
      order: s?.id ?? Number.MAX_SAFE_INTEGER,
      streakBefore: st.streak,
      livesBefore: st.lives,
      totalBefore: totals.get(st.team_id) ?? 0,
    };
  });
  const res = resolveLiveQuestion({ cfg, basePoints: ch.points, questionStartClock: round.live_q_start, teams: inputs });

  // Tech Bingo: mark the called tile on every team that got it right and pay out newly completed lines.
  const bingos: { name: string; lines: number; blackout: boolean }[] = [];
  const awards: Award[] = [...res.awards];
  if (round.kind === 'bingo') {
    const tiles = bingoTiles(ctx.challenges(round.id));
    const called = (JSON.parse(ch.answers) as string[])[0]!;
    const before = markedByTeam(ctx, round);
    for (const t of inputs) {
      const layout = layoutFor(tiles, t.teamId, round);
      const had = before.get(t.teamId) ?? new Set<string>();
      const now = new Set(had);
      if (t.answered && t.correct) now.add(called);
      const prevLines = new Set(completedLines(layout, had));
      const fresh = completedLines(layout, now).filter((i) => !prevLines.has(i));
      for (const i of fresh) awards.push({ teamId: t.teamId, kind: 'bingo_line', points: cfg.lineBonus, label: 'BINGO line!', key: `bingo:line:${t.teamId}:${round.id}:${i}` });
      const blackout = now.size >= BINGO_CELLS && had.size < BINGO_CELLS;
      if (blackout) awards.push({ teamId: t.teamId, kind: 'bingo_blackout', points: cfg.blackoutBonus, label: 'BLACKOUT!', key: `bingo:blackout:${t.teamId}:${round.id}` });
      if (fresh.length > 0 || blackout) bingos.push({ name: t.name, lines: fresh.length, blackout });
    }
  }

  // Write in arrival order so the "earliest last solve" tie-break stays meaningful.
  const order = [...inputs].sort((a, b) => a.order - b.order || a.teamId - b.teamId).map((t) => t.teamId);
  for (const teamId of order) {
    let sum = 0;
    for (const a of awards.filter((x) => x.teamId === teamId)) {
      if (award(ctx, { ev, teamId, roundId: round.id, challengeId: ch.id, kind: a.kind, points: a.points, key: a.key ?? `live:${a.kind}:${teamId}:${ch.id}`, actor: 'system', reason: a.label })) sum += a.points;
    }
    const s = subs.get(teamId);
    if (s) ctx.db.run('UPDATE answer_submissions SET points = ? WHERE id = ?', sum, s.id);
  }
  for (const st of states) {
    ctx.db.run('UPDATE live_team_state SET streak = ?, lives = ?, eliminated = ? WHERE team_id = ? AND round_id = ?', res.streakAfter.get(st.team_id) ?? 0, res.livesAfter.get(st.team_id) ?? null, res.eliminated.includes(st.team_id) ? 1 : 0, st.team_id, round.id);
  }
  const fastestAward = res.awards.find((a) => a.kind === 'fastest_bonus');
  const summary = {
    fastest: res.fastestTeamId ? { teamId: res.fastestTeamId, name: names.get(res.fastestTeamId) ?? '?', bonus: fastestAward?.points ?? 0 } : null,
    steal: res.steal ? { thief: names.get(res.steal.thiefId) ?? '?', victim: names.get(res.steal.victimId) ?? '?', points: res.steal.points } : null,
    eliminated: res.eliminated.map((id) => names.get(id) ?? '?'),
    bingos,
  };
  ctx.db.run("INSERT INTO live_question_log (round_id, challenge_id, status, resolved_at, summary) VALUES (?,?,'resolved',?,?)", round.id, ch.id, ctx.clock.now(), JSON.stringify(summary));
}

/** Level-3 survivors collect their bonus when the round ends (called inside endRound's transaction). */
export function onRoundEnd(ctx: Ctx, ev: EventRow, round: RoundRow): void {
  // Ending the round while a question is still open must not throw the locked-in answers away: score it first.
  if (isLive(round.kind) && round.live_phase === 'open') {
    const open = ctx.challenges(round.id)[round.live_index];
    if (open) resolveQuestion(ctx, ev, ctx.round(round.id), open);
  }
  if (round.kind !== 'showdown') return;
  const cfg = ctx.roundConfig(round);
  if (cfg.survivorBonus <= 0) return;
  for (const st of alive(ctx, round)) award(ctx, { ev, teamId: st.team_id, roundId: round.id, challengeId: null, kind: 'survivor_bonus', points: cfg.survivorBonus, key: `survivor:${st.team_id}:${round.id}`, actor: 'system', reason: 'Still standing' });
}

// ---- team submissions -------------------------------------------------------------

export function submitLive(ctx: Ctx, input: SubmitInput): AnswerResult {
  const out = ctx.db.tx(() => {
    const prior = ctx.db.get<{ outcome: string }>('SELECT outcome FROM answer_submissions WHERE team_id = ? AND request_id = ?', input.teamId, input.requestId);
    if (prior) {
      const locked = prior.outcome === 'correct' || prior.outcome === 'incorrect';
      return result(input.requestId, locked ? 'locked' : (prior.outcome as AnswerResult['outcome']), 0, false, 'This answer was already received.', true);
    }
    liveAdvance(ctx);
    const now = ctx.clock.now();
    const team = ctx.db.get<TeamRow>('SELECT * FROM teams WHERE id = ?', input.teamId);
    const ev = ctx.currentEvent();
    if (!team || !ev || team.event_id !== ev.id) throw new AppError(403, 'NO_SESSION', 'Your team is not part of the current event.');
    if (team.status !== 'approved') throw new AppError(403, 'NOT_APPROVED', 'Your team has not been approved.');
    const round = ctx.currentRound(ev);
    if (!round || !isLive(round.kind) || !['ROUND_RUNNING', 'ROUND_PAUSED', 'ROUND_ENDED'].includes(ev.state)) throw new AppError(409, 'NOT_RUNNING', 'No round is running right now.');
    const notEligible = eligibilityProblem(team, round);
    if (notEligible) throw new AppError(403, 'NOT_ELIGIBLE', notEligible);
    const st = ctx.db.get<LiveTeamRow>('SELECT * FROM live_team_state WHERE team_id = ? AND round_id = ?', team.id, round.id);
    if (!st) throw new AppError(403, 'NOT_ELIGIBLE', 'Your team is not part of this round.');
    if (st.eliminated) throw new AppError(403, 'ELIMINATED', 'Your team has been eliminated. Cheer on the others!');

    const cfg = ctx.roundConfig(round);
    const items = ctx.challenges(round.id);
    const current = items[round.live_index];
    if (!current) throw new AppError(409, 'NOT_RUNNING', 'No question is open.');
    const target = input.challengeId === undefined ? current : items.find((c) => c.id === input.challengeId);
    if (!target) throw new AppError(400, 'BAD_CHALLENGE', 'That question does not belong to this round.');

    const record = (outcome: 'correct' | 'incorrect' | 'late' | 'rejected', normalized: string, extra: { clock?: number; dd?: boolean } = {}) =>
      ctx.db.run(
        'INSERT INTO answer_submissions (event_id, round_id, challenge_id, team_id, session_id, request_id, raw_answer, normalized, outcome, points, received_at, created_at, clock_ms, double_down) VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,?)',
        ev.id, round.id, target.id, team.id, input.sessionId, input.requestId, input.answer, normalized, outcome, now, ctx.nowIso(), extra.clock ?? null, extra.dd ? 1 : 0,
      ).lastId;

    if (ev.state === 'ROUND_PAUSED') {
      record('rejected', '');
      return result(input.requestId, 'rejected', 0, false, 'The round is paused. Hold on until the host resumes.');
    }
    const clock = elapsedClock(ctx.timer(round), now);
    const open = ev.state === 'ROUND_RUNNING' && round.live_phase === 'open' && clock <= round.live_clock_start + phaseMs(cfg, 'open');
    if (!open || target.id !== current.id) {
      record('late', '');
      return result(input.requestId, 'late', 0, false, 'Too late - that question is closed.');
    }
    if (ctx.db.get("SELECT 1 FROM answer_submissions WHERE team_id = ? AND challenge_id = ? AND outcome IN ('correct','incorrect')", team.id, current.id)) {
      record('rejected', '');
      return result(input.requestId, 'rejected', 0, false, 'You already locked in an answer for this question.');
    }
    let dd = false;
    if (input.doubleDown) {
      if (!cfg.doubleDown) throw new AppError(403, 'NO_DOUBLE', 'Double Down is not available in this round.');
      if (st.double_used) throw new AppError(409, 'DOUBLE_USED', 'You already used your Double Down.');
      ctx.db.run('UPDATE live_team_state SET double_used = 1 WHERE team_id = ? AND round_id = ?', team.id, round.id);
      dd = true;
    }
    const check = checkAnswer(current.kind, input.answer, JSON.parse(current.answers) as string[]);
    record(check.correct ? 'correct' : 'incorrect', check.normalized, { clock, dd });

    // Everyone still standing has answered: close the question early.
    const standing = alive(ctx, round).length;
    const answered = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM answer_submissions s JOIN live_team_state l ON l.team_id = s.team_id AND l.round_id = ? WHERE s.challenge_id = ? AND s.outcome IN ('correct','incorrect') AND l.eliminated = 0", round.id, current.id)!.n;
    if (answered >= standing) {
      endPhaseNow(ctx, ctx.round(round.id));
      liveAdvance(ctx);
    }
    return result(input.requestId, 'locked', 0, false, dd ? 'Locked in with DOUBLE DOWN! Results at the reveal.' : 'Answer locked in! Results at the reveal.');
  });
  ctx.emit({ teams: 'all' });
  return out;
}

// ---- host controls ------------------------------------------------------------------

function requireLive(ctx: Ctx): { ev: EventRow; round: RoundRow } {
  const cur = currentLive(ctx);
  if (!cur || cur.ev.state !== 'ROUND_RUNNING') throw new AppError(409, 'INVALID_STATE', 'A live round must be running (not paused) for that.');
  return cur;
}

/**
 * Close the open question now (jump to the reveal), or leave the reveal early (jump to the next question).
 * `expect` is what the caller's screen showed: if the game has already moved on, the click is stale and does nothing.
 */
export function hostAdvance(ctx: Ctx, actor: string, expect?: { index: number; phase: 'open' | 'reveal' }): void {
  const { ev, round } = requireLive(ctx);
  ctx.db.tx(() => {
    if (liveAdvance(ctx)) return; // the clock already moved things on; do not skip a second phase
    const fresh = ctx.round(round.id);
    if (fresh.status !== 'running') return;
    if (expect && (fresh.live_index !== expect.index || fresh.live_phase !== expect.phase)) return;
    endPhaseNow(ctx, fresh);
    liveAdvance(ctx);
    ctx.audit(ev.id, actor, 'live.advance', { phase: fresh.live_phase, index: fresh.live_index });
  });
  ctx.emit({ teams: 'all' });
}

/** Void the current question (no points, no lives lost) and move straight to the next one. */
export function hostSkip(ctx: Ctx, actor: string): void {
  const { ev, round } = requireLive(ctx);
  ctx.db.tx(() => {
    liveAdvance(ctx);
    const fresh = ctx.round(round.id);
    if (fresh.status !== 'running') return;
    const items = ctx.challenges(fresh.id);
    const ch = items[fresh.live_index]!;
    if (fresh.live_phase === 'open' && !ctx.db.get('SELECT 1 FROM live_question_log WHERE round_id = ? AND challenge_id = ?', fresh.id, ch.id)) {
      ctx.db.run("INSERT INTO live_question_log (round_id, challenge_id, status, resolved_at, summary) VALUES (?,?,'voided',?,'{}')", fresh.id, ch.id, ctx.clock.now());
    }
    ctx.audit(ev.id, actor, 'live.skip', { index: fresh.live_index, title: ch.title });
    if (fresh.live_index + 1 >= items.length) {
      endRound(ctx, actor, 'last question skipped');
      return;
    }
    const clock = elapsedClock(ctx.timer(fresh), ctx.clock.now());
    ctx.db.run("UPDATE rounds SET live_index = live_index + 1, live_phase = 'open', live_clock_start = ?, live_q_start = ? WHERE id = ?", clock, clock, fresh.id);
  });
  ctx.emit({ teams: 'all' });
}

// ---- views ----------------------------------------------------------------------------

export function livePublic(ctx: Ctx, ev: EventRow, round: RoundRow): LivePublic | null {
  if (!isLive(round.kind) || !round.live_phase || (ev.state !== 'ROUND_RUNNING' && ev.state !== 'ROUND_PAUSED')) return null;
  const items = ctx.challenges(round.id);
  const ch = items[round.live_index];
  if (!ch) return null;
  const cfg = ctx.roundConfig(round);
  const now = ctx.clock.now();
  const phase = round.live_phase;
  const clock = elapsedClock(ctx.timer(round), now);
  const remainingMs = Math.max(0, round.live_clock_start + phaseMs(cfg, phase) - clock);
  const running = round.status === 'running';
  const standing = alive(ctx, round).length;
  const subs = ctx.db.all<{ normalized: string; outcome: string }>("SELECT normalized, outcome FROM answer_submissions WHERE challenge_id = ? AND outcome IN ('correct','incorrect')", ch.id);
  const opts = parse<{ id: string; text: string; icon?: string }[]>(ch.options) ?? [];
  const isBingo = round.kind === 'bingo';

  let reveal: LiveReveal | null = null;
  let options: LiveOption[] = opts.map((o) => ({ id: o.id, text: o.text, ...(o.icon ? { icon: o.icon } : {}) }));
  if (phase === 'reveal') {
    const answers = JSON.parse(ch.answers) as string[];
    const log = ctx.db.get<{ status: string; summary: string }>('SELECT status, summary FROM live_question_log WHERE round_id = ? AND challenge_id = ?', round.id, ch.id);
    const sum = JSON.parse(log?.summary ?? '{}') as { fastest?: LiveReveal['fastest']; steal?: LiveReveal['steal']; eliminated?: string[]; bingos?: LiveReveal['bingos'] };
    options = opts.map((o) => ({ id: o.id, text: o.text, ...(o.icon ? { icon: o.icon } : {}), count: subs.filter((s) => s.normalized === o.id).length, correct: answers.includes(o.id) }));
    reveal = {
      correctText: opts.filter((o) => answers.includes(o.id)).map((o) => o.text).join(' / ') || answers.join(' / '),
      options,
      answered: subs.length,
      correctCount: subs.filter((s) => s.outcome === 'correct').length,
      fastest: sum.fastest ?? null,
      steal: sum.steal ?? null,
      eliminated: sum.eliminated ?? [],
      voided: log?.status === 'voided',
      fact: round.kind === 'faces' ? ch.hint : null,
      bingos: sum.bingos ?? [],
    };
  }
  let bingo: BingoPublic | null = null;
  if (isBingo) {
    const tiles = bingoTiles(items);
    const marked = markedByTeam(ctx, round);
    let teamsWithLine = 0;
    for (const [teamId, set] of marked) if (completedLines(layoutFor(tiles, teamId, round), set).length > 0) teamsWithLine++;
    bingo = { tiles, called: calledTiles(ctx, round), teamsWithLine };
  }
  return {
    phase,
    index: round.live_index,
    total: items.length,
    kind: ch.kind,
    title: ch.title,
    prompt: ch.prompt,
    image: ch.image,
    points: ch.points,
    options: isBingo ? [] : options,
    bingo,
    answered: subs.length,
    eligible: standing,
    phaseEndsAt: running ? now + remainingMs : null,
    phaseRemainingMs: remainingMs,
    phaseTotalMs: phaseMs(cfg, phase),
    reveal,
  };
}

const KIND_LABEL: Record<string, string> = {
  answer: 'Correct answer',
  speed_bonus: 'Speed bonus',
  fastest_bonus: 'Fastest finger',
  streak_bonus: 'Streak bonus',
  wrong_penalty: 'Wrong answer',
  steal: 'Stolen points',
  stolen: 'Points stolen from you',
  bingo_line: 'BINGO! Line completed',
  bingo_blackout: 'BLACKOUT! Full card',
};

export function teamLive(ctx: Ctx, team: TeamRow, ev: EventRow, round: RoundRow): TeamLive | null {
  if (!isLive(round.kind)) return null;
  const st = ctx.db.get<LiveTeamRow>('SELECT * FROM live_team_state WHERE team_id = ? AND round_id = ?', team.id, round.id);
  if (!st) return null;
  const cfg = ctx.roundConfig(round);
  const ch = ctx.challenges(round.id)[round.live_index];
  let locked = false;
  let res: TeamLive['result'] = null;
  if (ch && (ev.state === 'ROUND_RUNNING' || ev.state === 'ROUND_PAUSED')) {
    const sub = ctx.db.get<{ outcome: string; points: number }>("SELECT outcome, points FROM answer_submissions WHERE team_id = ? AND challenge_id = ? AND outcome IN ('correct','incorrect')", team.id, ch.id);
    locked = !!sub;
    if (round.live_phase === 'reveal') {
      const rows = ctx.db.all<{ kind: string; points: number }>('SELECT kind, points FROM score_ledger WHERE team_id = ? AND challenge_id = ? ORDER BY id', team.id, ch.id);
      res = {
        outcome: sub ? (sub.outcome as 'correct' | 'incorrect') : 'none',
        points: rows.reduce((n, r) => n + r.points, 0),
        breakdown: rows.map((r) => ({ label: r.kind === 'double_down' ? (r.points > 0 ? 'Double Down!' : 'Double Down failed') : (KIND_LABEL[r.kind] ?? r.kind), points: r.points })),
      };
    }
  }
  return { locked, doubleAvailable: cfg.doubleDown && !st.double_used && !st.eliminated, streak: st.streak, lives: st.lives, eliminated: st.eliminated === 1, bingo: round.kind === 'bingo' ? teamBingo(ctx, team, round) : null, result: res };
}

function teamBingo(ctx: Ctx, team: TeamRow, round: RoundRow): TeamBingo {
  const tiles = bingoTiles(ctx.challenges(round.id));
  const layout = layoutFor(tiles, team.id, round);
  const marked = markedByTeam(ctx, round).get(team.id) ?? new Set<string>();
  const lines = completedLines(layout, marked);
  return {
    layout,
    tiles,
    marked: [...marked],
    missed: calledTiles(ctx, round).filter((id) => !marked.has(id)),
    lineCells: cellsOfLines(lines),
    lines: lines.length,
  };
}

export function liveCounts(ctx: Ctx, round: RoundRow): { total: number; standing: number } {
  const total = ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM live_team_state WHERE round_id = ?', round.id)!.n;
  return { total, standing: alive(ctx, round).length };
}
