import crypto from 'node:crypto';
import { SEED_ROUNDS } from '../content/seed.js';
import { assertTransition } from '../game/stateMachine.js';
import { BINGO_CELLS } from '../game/bingo.js';
import { DEFAULT_EVENT_SETTINGS, DEFAULT_ROUND_CONFIG, eventSettingsSchema, isLive, liveDurationSec, parseRoundConfig } from '../game/scoring.js';
import { initLive, liveAdvance, onRoundEnd } from '../games/live.js';
import { pauseTimer, resumeTimer, startTimer } from '../game/timer.js';
import { AppError, type ChallengeRow, type Ctx, type EventRow, type RoundRow } from './context.js';
import { clearAttention } from './attention.js';
import { computeStandings, writeSnapshot } from './standings.js';
import type { EventSettings, EventState } from '../../shared/types.js';

export const QUALIFY_AFTER_LEVEL = 4;
export const FINAL_LEVEL = 5;

function generatePin(ctx: Ctx): string {
  for (let i = 0; i < 50; i++) {
    const pin = String(crypto.randomInt(100000, 1000000));
    if (!ctx.db.get('SELECT 1 FROM events WHERE pin = ?', pin)) return pin;
  }
  throw new AppError(500, 'PIN_EXHAUSTED', 'Could not generate a unique room PIN.');
}

function seedRounds(ctx: Ctx, eventId: number): void {
  for (const r of SEED_ROUNDS) {
    const cfg = { ...DEFAULT_ROUND_CONFIG[r.kind] };
    if (isLive(r.kind)) cfg.durationSec = liveDurationSec(r.challenges.length, cfg);
    const { lastId } = ctx.db.run('INSERT INTO rounds (event_id, level, name, kind, config, instructions) VALUES (?,?,?,?,?,?)', eventId, r.level, r.name, r.kind, JSON.stringify(cfg), r.instructions);
    r.challenges.forEach((c, i) => {
      ctx.db.run('INSERT INTO challenges (round_id, position, kind, title, prompt, options, answers, points, hint, image) VALUES (?,?,?,?,?,?,?,?,?,?)', lastId, i, c.kind, c.title, c.prompt, c.options ? JSON.stringify(c.options) : null, JSON.stringify(c.answers), c.points, c.hint ?? null, c.image ?? null);
    });
  }
}

export function createEvent(ctx: Ctx, actor: string, input: { name: string; pin?: string }): EventRow {
  return ctx.db.tx(() => {
    const prev = ctx.currentEvent();
    if (prev) ctx.db.run('UPDATE events SET archived = 1 WHERE id = ?', prev.id);
    let pin = input.pin ?? generatePin(ctx);
    if (ctx.db.get('SELECT 1 FROM events WHERE pin = ?', pin)) {
      if (input.pin) throw new AppError(409, 'PIN_TAKEN', 'That room PIN is already used by another event.');
      pin = generatePin(ctx);
    }
    const now = ctx.nowIso();
    const { lastId } = ctx.db.run('INSERT INTO events (name, pin, state, settings, created_at, updated_at) VALUES (?,?,?,?,?,?)', input.name, pin, 'SETUP', JSON.stringify(DEFAULT_EVENT_SETTINGS), now, now);
    seedRounds(ctx, lastId);
    ctx.db.run('INSERT INTO event_state_history (event_id, from_state, to_state, actor, reason, created_at) VALUES (?,?,?,?,?,?)', lastId, null, 'SETUP', actor, 'event created', now);
    ctx.audit(lastId, actor, 'event.create', { name: input.name, pin });
    const ev = ctx.event(lastId);
    if (prev) ctx.emit({ kick: ctx.db.all<{ id: number }>('SELECT id FROM teams WHERE event_id = ?', prev.id).map((t) => t.id) });
    return ev;
  });
}

export function updateEvent(ctx: Ctx, actor: string, patch: { name?: string; pin?: string; settings?: Partial<EventSettings> }): EventRow {
  const ev = ctx.requireEvent();
  const early = (['SETUP', 'REGISTRATION_OPEN', 'LOBBY'] as EventState[]).includes(ev.state);
  if (ev.state === 'EVENT_COMPLETED') throw new AppError(409, 'EVENT_COMPLETED', 'The event has finished.');
  ctx.db.tx(() => {
    if (patch.name !== undefined) ctx.db.run('UPDATE events SET name = ? WHERE id = ?', patch.name, ev.id);
    if (patch.pin !== undefined && patch.pin !== ev.pin) {
      if (!early) throw new AppError(409, 'LOCKED', 'The room PIN can only change before the first round.');
      if (ctx.db.get('SELECT 1 FROM events WHERE pin = ? AND id <> ?', patch.pin, ev.id)) throw new AppError(409, 'PIN_TAKEN', 'That room PIN is already in use.');
      ctx.db.run('UPDATE events SET pin = ? WHERE id = ?', patch.pin, ev.id);
    }
    if (patch.settings) {
      const cur = ctx.settings(ev);
      const next = eventSettingsSchema.parse({ ...cur, ...patch.settings });
      if ((next.maxTeams !== cur.maxTeams || next.autoApprove !== cur.autoApprove) && !early) throw new AppError(409, 'LOCKED', 'Capacity and approval mode can only change before the first round.');
      if (next.finalists !== cur.finalists && ev.qualification_frozen) throw new AppError(409, 'LOCKED', 'Qualification is frozen. Reopen it first.');
      const active = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM teams WHERE event_id = ? AND status IN ('pending','approved')", ev.id)!.n;
      if (next.maxTeams < active) throw new AppError(409, 'CAPACITY', `${active} teams are already registered; capacity cannot go below that.`);
      ctx.db.run('UPDATE events SET settings = ? WHERE id = ?', JSON.stringify(next), ev.id);
      if (next.finalists !== cur.finalists && ev.state === 'QUALIFICATION') recomputeQualification(ctx, ctx.event(ev.id));
    }
    ctx.db.run('UPDATE events SET updated_at = ? WHERE id = ?', ctx.nowIso(), ev.id);
    ctx.audit(ev.id, actor, 'event.update', patch as Record<string, unknown>);
  });
  ctx.emit({ teams: 'all' });
  return ctx.event(ev.id);
}

export function resetEvent(ctx: Ctx, actor: string): EventRow {
  const ev = ctx.requireEvent();
  const kick = ctx.db.all<{ id: number }>('SELECT id FROM teams WHERE event_id = ?', ev.id).map((t) => t.id);
  ctx.db.tx(() => {
    ctx.db.run('DELETE FROM teams WHERE event_id = ?', ev.id); // cascades sessions, progress, hints, submissions, ledger, snapshots
    ctx.db.run('DELETE FROM score_ledger WHERE event_id = ?', ev.id);
    ctx.db.run('DELETE FROM leaderboard_snapshots WHERE event_id = ?', ev.id);
    ctx.db.run('DELETE FROM answer_submissions WHERE event_id = ?', ev.id);
    // Rounds are kept, so their live bookkeeping must go too: a leftover "resolved" row makes the replay skip that question's scoring.
    ctx.db.run('DELETE FROM live_question_log WHERE round_id IN (SELECT id FROM rounds WHERE event_id = ?)', ev.id);
    ctx.db.run('DELETE FROM live_team_state WHERE round_id IN (SELECT id FROM rounds WHERE event_id = ?)', ev.id);
    ctx.db.run('DELETE FROM event_state_history WHERE event_id = ?', ev.id);
    ctx.db.run('DELETE FROM audit_logs WHERE event_id = ?', ev.id); // a reset starts the event from a clean slate
    ctx.db.run("UPDATE rounds SET status='pending', started_at=NULL, deadline_at=NULL, remaining_ms=NULL, heartbeat_at=NULL, ended_at=NULL, answers_revealed=0, live_index=0, live_phase=NULL, live_clock_start=0, live_q_start=0 WHERE event_id = ?", ev.id);
    ctx.db.run('UPDATE events SET state = ?, current_round_id = NULL, qualification_frozen = 0, completed_at = NULL, updated_at = ? WHERE id = ?', 'SETUP', ctx.nowIso(), ev.id);
    ctx.db.run('INSERT INTO event_state_history (event_id, from_state, to_state, actor, reason, created_at) VALUES (?,?,?,?,?,?)', ev.id, ev.state, 'SETUP', actor, 'event reset', ctx.nowIso());
    ctx.audit(ev.id, actor, 'event.reset', { teamsRemoved: kick.length, previousState: ev.state });
  });
  ctx.presence.clear();
  clearAttention(ctx);
  ctx.emit({ kick, teams: 'all' });
  return ctx.event(ev.id);
}

// ---- transitions ------------------------------------------------------------

function transition(ctx: Ctx, ev: EventRow, to: EventState, actor: string, reason?: string): void {
  assertTransition(ev.state, to);
  ctx.setState(ev, to, actor, reason);
}

export function openRegistration(ctx: Ctx, actor: string): void {
  const ev = ctx.requireEvent();
  ctx.db.tx(() => {
    if (ev.state === 'LOBBY' && ctx.rounds(ev.id).some((r) => r.status !== 'pending')) throw new AppError(409, 'INVALID_STATE', 'Registration cannot reopen after play began.');
    transition(ctx, ev, 'REGISTRATION_OPEN', actor);
    ctx.audit(ev.id, actor, 'registration.open');
  });
  ctx.emit({ teams: 'all' });
}

export function pauseRegistration(ctx: Ctx, actor: string): void {
  const ev = ctx.requireEvent();
  ctx.db.tx(() => {
    transition(ctx, ev, 'SETUP', actor, 'registration paused');
    ctx.audit(ev.id, actor, 'registration.pause');
  });
  ctx.emit({ teams: 'all' });
}

export function confirmTeams(ctx: Ctx, actor: string): void {
  const ev = ctx.requireEvent();
  ctx.db.tx(() => {
    assertTransition(ev.state, 'LOBBY');
    const pending = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM teams WHERE event_id = ? AND status = 'pending'", ev.id)!.n;
    if (pending > 0) throw new AppError(409, 'PENDING_TEAMS', `${pending} team(s) still await approval. Approve or reject them first.`);
    const approved = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM teams WHERE event_id = ? AND status = 'approved'", ev.id)!.n;
    if (approved < 1) throw new AppError(409, 'NO_TEAMS', 'At least one approved team is required.');
    ctx.setState(ev, 'LOBBY', actor, 'registration closed, teams confirmed');
    ctx.audit(ev.id, actor, 'registration.confirm', { teams: approved });
  });
  ctx.emit({ teams: 'all', announce: { kind: 'info', text: 'Registration closed. Welcome to the lobby!' } });
}

export function validateRound(ctx: Ctx, round: RoundRow): void {
  const items = ctx.challenges(round.id);
  if (items.length === 0) throw new AppError(409, 'INVALID_ROUND', `${round.name} has no questions.`);
  if (!['quiz', 'lightning', 'showdown', 'faces', 'bingo'].includes(round.kind)) throw new AppError(409, 'INVALID_ROUND', `${round.name} was created by an older version of the game. Create a new event to use the current games.`);
  try {
    parseRoundConfig(round.kind, JSON.parse(round.config));
  } catch {
    throw new AppError(409, 'INVALID_ROUND', `${round.name} has an invalid scoring configuration.`);
  }
  for (const c of items) {
    const answers = JSON.parse(c.answers) as string[];
    if (!c.prompt.trim() || answers.length === 0 || answers.some((a) => !String(a).trim())) throw new AppError(409, 'INVALID_ROUND', `${round.name}: "${c.title}" is missing its prompt or answer key.`);
    if (c.kind === 'choice') {
      const options = c.options ? (JSON.parse(c.options) as { id: string }[]) : [];
      if (options.length < 2 || !answers.every((a) => options.some((o) => o.id === a))) throw new AppError(409, 'INVALID_ROUND', `${round.name}: "${c.title}" has an invalid answer key.`);
      if (round.kind === 'bingo' && options.length !== BINGO_CELLS) throw new AppError(409, 'INVALID_ROUND', `${round.name}: "${c.title}" must offer exactly ${BINGO_CELLS} bingo tiles.`);
    } else if (round.kind === 'faces' || round.kind === 'bingo') {
      throw new AppError(409, 'INVALID_ROUND', `${round.name}: "${c.title}" must be multiple choice.`);
    }
    if (round.kind === 'faces' && !c.image) throw new AppError(409, 'INVALID_ROUND', `${round.name}: "${c.title}" has no picture.`);
  }
  if (round.kind === 'bingo' && new Set(items.map((c) => (JSON.parse(c.answers) as string[])[0])).size !== items.length) throw new AppError(409, 'INVALID_ROUND', `${round.name}: every call must name a different tile.`);
}

function nextRound(ctx: Ctx, ev: EventRow): RoundRow | undefined {
  const all = ctx.rounds(ev.id);
  const ended = all.filter((r) => r.status === 'ended');
  const level = ended.length ? Math.max(...ended.map((r) => r.level)) + 1 : 1;
  return all.find((r) => r.level === level);
}

export function prepareRound(ctx: Ctx, actor: string): RoundRow {
  const ev = ctx.requireEvent();
  const round = ctx.db.tx(() => {
    assertTransition(ev.state, 'ROUND_READY');
    const next = nextRound(ctx, ev);
    if (!next) throw new AppError(409, 'NO_MORE_ROUNDS', 'All rounds have been played.');
    if (next.level === FINAL_LEVEL && ev.state !== 'QUALIFICATION') throw new AppError(409, 'QUALIFICATION_REQUIRED', 'Run qualification before the final level.');
    if (next.level > 1 && next.level < FINAL_LEVEL && ev.state === 'LOBBY') throw new AppError(409, 'INVALID_STATE', 'Rounds must be played in order.');
    validateRound(ctx, next);
    ctx.db.run('UPDATE events SET current_round_id = ? WHERE id = ?', next.id, ev.id);
    ctx.setState(ev, 'ROUND_READY', actor, `prepare level ${next.level}`, next.id);
    ctx.audit(ev.id, actor, 'round.prepare', { level: next.level });
    return next;
  });
  ctx.emit({ teams: 'all', announce: { kind: 'info', text: `Get ready: ${round.name}` } });
  return round;
}

export function startRound(ctx: Ctx, actor: string): void {
  const ev = ctx.requireEvent();
  const round = ctx.db.tx(() => {
    assertTransition(ev.state, 'ROUND_RUNNING');
    const r = ctx.currentRound(ev);
    if (!r || r.status !== 'pending') throw new AppError(409, 'INVALID_ROUND', 'No round is ready to start.');
    validateRound(ctx, r);
    const now = ctx.clock.now();
    const t = startTimer(ctx.roundConfig(r).durationSec * 1000, now);
    ctx.db.run("UPDATE rounds SET status='running', started_at=?, deadline_at=?, remaining_ms=NULL, heartbeat_at=? WHERE id=?", now, t.deadlineAt, now, r.id);
    if (isLive(r.kind)) initLive(ctx, ev, r);
    if (r.level === FINAL_LEVEL) ctx.db.run('UPDATE events SET qualification_frozen = 1 WHERE id = ?', ev.id);
    ctx.setState(ev, 'ROUND_RUNNING', actor, `start level ${r.level}`);
    ctx.audit(ev.id, actor, 'round.start', { level: r.level, deadlineAt: t.deadlineAt });
    return r;
  });
  ctx.emit({ teams: 'all', announce: { kind: 'round_started', text: `${round.name} has started!` } });
}

export function pauseRound(ctx: Ctx, actor: string): void {
  const ev = ctx.requireEvent();
  ctx.db.tx(() => {
    assertTransition(ev.state, 'ROUND_PAUSED');
    const r = ctx.currentRound(ev)!;
    const t = pauseTimer(ctx.timer(r), ctx.clock.now());
    ctx.db.run("UPDATE rounds SET status='paused', deadline_at=NULL, remaining_ms=? WHERE id=?", t.remainingMs, r.id);
    ctx.setState(ev, 'ROUND_PAUSED', actor);
    ctx.audit(ev.id, actor, 'round.pause', { remainingMs: t.remainingMs });
  });
  ctx.emit({ teams: 'all', announce: { kind: 'round_paused', text: 'Round paused by the host.' } });
}

export function resumeRound(ctx: Ctx, actor: string): void {
  const ev = ctx.requireEvent();
  ctx.db.tx(() => {
    assertTransition(ev.state, 'ROUND_RUNNING');
    if (ev.state !== 'ROUND_PAUSED') throw new AppError(409, 'INVALID_STATE', 'The round is not paused.');
    const r = ctx.currentRound(ev)!;
    const now = ctx.clock.now();
    const t = resumeTimer(ctx.timer(r), now);
    ctx.db.run("UPDATE rounds SET status='running', deadline_at=?, remaining_ms=NULL, heartbeat_at=? WHERE id=?", t.deadlineAt, now, r.id);
    ctx.setState(ev, 'ROUND_RUNNING', actor, 'resumed');
    ctx.audit(ev.id, actor, 'round.resume', { deadlineAt: t.deadlineAt });
  });
  ctx.emit({ teams: 'all', announce: { kind: 'round_resumed', text: 'Round resumed. Go!' } });
}

export function endRound(ctx: Ctx, actor: string, reason = 'ended by host'): void {
  const ev = ctx.requireEvent();
  let ended: RoundRow | undefined;
  ctx.db.tx(() => {
    assertTransition(ev.state, 'ROUND_ENDED');
    const r = ctx.currentRound(ev)!;
    onRoundEnd(ctx, ev, r);
    ctx.db.run("UPDATE rounds SET status='ended', ended_at=?, deadline_at=NULL, remaining_ms=0, live_phase=NULL WHERE id=?", ctx.clock.now(), r.id);
    ctx.setState(ev, 'ROUND_ENDED', actor, reason);
    ctx.audit(ev.id, actor, 'round.end', { level: r.level, reason });
    ended = r;
  });
  writeSnapshot(ctx, ctx.event(ev.id), `round:${ended!.level}`, ended);
  ctx.emit({ teams: 'all', announce: { kind: 'round_ended', text: `${ended!.name} is over.` } });
}

export function revealAnswers(ctx: Ctx, actor: string, level: number, reveal: boolean): void {
  const ev = ctx.requireEvent();
  const r = ctx.rounds(ev.id).find((x) => x.level === level);
  if (!r) throw new AppError(404, 'NO_ROUND', 'Unknown level.');
  if (r.status !== 'ended') throw new AppError(409, 'INVALID_STATE', 'Answers can be revealed once the round has ended.');
  ctx.db.run('UPDATE rounds SET answers_revealed = ? WHERE id = ?', reveal ? 1 : 0, r.id);
  ctx.audit(ev.id, actor, reveal ? 'answers.reveal' : 'answers.hide', { level });
  ctx.emit({ teams: 'all' });
}

// ---- qualification ------------------------------------------------------------

export function recomputeQualification(ctx: Ctx, ev: EventRow): number[] {
  const finalists = ctx.settings(ev).finalists;
  const standings = computeStandings(ctx, ev);
  // Ranking before the final level has no tiers, so the top N by the documented tie-break win.
  const chosen = standings.slice(0, finalists).map((s) => s.teamId);
  ctx.db.tx(() => {
    ctx.db.run('UPDATE teams SET qualified = 0 WHERE event_id = ?', ev.id);
    for (const id of chosen) ctx.db.run('UPDATE teams SET qualified = 1 WHERE id = ?', id);
  });
  return chosen;
}

export function openQualification(ctx: Ctx, actor: string): number[] {
  const ev = ctx.requireEvent();
  const chosen = ctx.db.tx(() => {
    assertTransition(ev.state, 'QUALIFICATION');
    if (ev.state === 'ROUND_ENDED') {
      const r = ctx.currentRound(ev)!;
      if (r.level !== QUALIFY_AFTER_LEVEL) throw new AppError(409, 'INVALID_STATE', `Qualification runs after Level ${QUALIFY_AFTER_LEVEL}.`);
    } else if (ev.state === 'ROUND_READY') {
      const r = ctx.currentRound(ev)!;
      if (r.level !== FINAL_LEVEL || r.status !== 'pending') throw new AppError(409, 'INVALID_STATE', 'Qualification can only be reopened before the final level starts.');
    }
    ctx.db.run('UPDATE events SET qualification_frozen = 0 WHERE id = ?', ev.id);
    ctx.setState(ev, 'QUALIFICATION', actor, ev.state === 'ROUND_READY' ? 'reopened' : undefined);
    const ids = recomputeQualification(ctx, ctx.event(ev.id));
    ctx.audit(ev.id, actor, 'qualification.open', { finalists: ids });
    return ids;
  });
  const names = ctx.db.all<{ name: string }>(`SELECT name FROM teams WHERE id IN (${chosen.map(() => '?').join(',') || 'NULL'})`, ...chosen).map((t) => t.name);
  ctx.emit({ teams: 'all', announce: { kind: 'qualification', text: `Finalists: ${names.join(', ')}` } });
  return chosen;
}

export function completeEvent(ctx: Ctx, actor: string): void {
  const ev = ctx.requireEvent();
  ctx.db.tx(() => {
    assertTransition(ev.state, 'EVENT_COMPLETED');
    ctx.setState(ev, 'EVENT_COMPLETED', actor);
    ctx.db.run('UPDATE events SET completed_at = ? WHERE id = ?', ctx.nowIso(), ev.id);
    ctx.audit(ev.id, actor, 'event.complete');
  });
  const fresh = ctx.event(ev.id);
  writeSnapshot(ctx, fresh, 'final');
  const winner = computeStandings(ctx, fresh)[0];
  ctx.emit({ teams: 'all', announce: winner ? { kind: 'winner', text: `${winner.name} wins BrainByte Arena!` } : undefined });
}

// ---- system tick / restart recovery -------------------------------------------

/** Ends the running round once its server-side deadline has passed and refreshes the heartbeat. */
export function tick(ctx: Ctx): void {
  const ev = ctx.currentEvent();
  if (!ev || ev.state !== 'ROUND_RUNNING') return;
  const r = ctx.currentRound(ev);
  if (!r || r.deadline_at === null) return;
  const now = ctx.clock.now();
  if (now > r.deadline_at) {
    endRound(ctx, 'system', 'timer expired');
    return;
  }
  if (isLive(r.kind)) liveAdvance(ctx);
  if (now - (r.heartbeat_at ?? 0) >= 1000) {
    ctx.db.run('UPDATE rounds SET heartbeat_at = ? WHERE id = ?', now, r.id);
  }
}

/**
 * After a crash/restart a running round is restored to PAUSED with the time that
 * was left at the last heartbeat. Downtime never eats a team's clock; the host resumes.
 */
export function recoverAfterRestart(ctx: Ctx): boolean {
  const ev = ctx.currentEvent();
  if (!ev || ev.state !== 'ROUND_RUNNING') return false;
  const r = ctx.currentRound(ev);
  if (!r || r.status !== 'running' || r.deadline_at === null) return false;
  const remaining = Math.max(0, r.deadline_at - (r.heartbeat_at ?? r.deadline_at));
  ctx.db.tx(() => {
    ctx.db.run("UPDATE rounds SET status='paused', deadline_at=NULL, remaining_ms=? WHERE id=?", remaining, r.id);
    ctx.setState(ev, 'ROUND_PAUSED', 'system', 'server restarted: round paused with remaining time preserved');
    ctx.audit(ev.id, 'system', 'recovery.pause', { remainingMs: remaining });
  });
  return true;
}

export type { ChallengeRow };
