import { useCallback, useEffect, useState } from 'react';
import type { AdminChallenge, AdminRound, AdminState, LivePublic } from '../../../shared/types';
import { ApiFailure, api, errMsg } from '../lib/api';
import { fmtClock, remaining, useLive, useServerNow } from '../lib/realtime';
import { AdminGate } from '../components/AdminGate';
import { ConnBadge, Empty, ErrorBanner, Spinner } from '../components/ui';
import { FaceImage } from '../components/FaceImage';

/**
 * The coordinator's desk: the live question with its answer key, and one big button that walks the loop
 * question -> reveal answer -> next question. Same sign-in as /admin; answer keys arrive over the admin socket only.
 */
export function CoordinatorApp() {
  return <AdminGate title="COORDINATOR">{(signOut) => <Console onLoggedOut={signOut} />}</AdminGate>;
}

type Send = (path: string, body?: unknown) => Promise<void>;

const MASK = '••••••';
const answerText = (c: AdminChallenge) => (c.kind === 'choice' ? c.answers.map((a) => c.options?.find((o) => o.id === a)?.text ?? a).join(' / ') : c.answers.join(' | '));

function Console({ onLoggedOut }: { onLoggedOut: () => void }) {
  const live = useLive('admin');
  const now = useServerNow(live.offset);
  const [fetched, setFetched] = useState<AdminState | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hide, setHide] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setFetched(await api<AdminState | null>('GET', '/admin/state'));
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 401) onLoggedOut();
    }
  }, [onLoggedOut]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (live.status === 'denied') void refresh();
  }, [live.status, refresh]);

  const state = [live.admin, fetched].filter((x): x is AdminState => !!x).sort((a, b) => b.serverNow - a.serverNow)[0] ?? null;

  const send: Send = useCallback(
    async (path, body = {}) => {
      setBusy(true);
      setError(null);
      try {
        await api('POST', path, body);
      } catch (e) {
        setError(errMsg(e));
        if (e instanceof ApiFailure && e.status === 401) onLoggedOut();
      } finally {
        await refresh();
        setBusy(false);
      }
    },
    [refresh, onLoggedOut],
  );

  if (fetched === undefined && !live.admin) return <Spinner />;

  let body;
  if (!state) {
    body = <Empty>No event yet. Create one from the admin dashboard.</Empty>;
  } else {
    const round = state.rounds.find((r) => r.id === state.event.currentRoundId) ?? null;
    const playing = state.event.state === 'ROUND_RUNNING' || state.event.state === 'ROUND_PAUSED';
    const q = round && state.live ? round.challenges[state.live.index] : undefined;
    body = round && playing && state.live && q
      ? <LiveStage s={state} round={round} lv={state.live} q={q} now={now} busy={busy} hide={hide} send={send} />
      : <Standby s={state} round={round} now={now} busy={busy} hide={hide} send={send} />;
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-4 px-3 py-4 sm:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-black">BRAINBYTE <span className="text-violet">COORDINATOR</span></h1>
        {state && <span className="badge" data-testid="event-state">{state.event.state.replace('_', ' ')}</span>}
        <span className="flex-1" />
        <button className="btn btn-ghost btn-sm" aria-pressed={hide} onClick={() => setHide(!hide)} data-testid="coord-hide" title="Hide the answers while this screen is shared or mirrored">
          {hide ? '🙈 Answers hidden' : '👁 Answers shown'}
        </button>
        <ConnBadge status={live.status} />
        <button className="btn btn-ghost btn-sm" onClick={async () => { await api('POST', '/admin/logout').catch(() => undefined); onLoggedOut(); }}>Sign out</button>
      </header>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {body}
    </div>
  );
}

function LiveStage({ s, round, lv, q, now, busy, hide, send }: { s: AdminState; round: AdminRound; lv: LivePublic; q: AdminChallenge; now: number; busy: boolean; hide: boolean; send: Send }) {
  const paused = s.event.state === 'ROUND_PAUSED';
  const revealing = lv.phase === 'reveal';
  const last = lv.index + 1 >= lv.total;
  const left = lv.phaseEndsAt !== null ? Math.max(0, lv.phaseEndsAt - now) : lv.phaseRemainingMs;
  const pct = lv.phaseTotalMs > 0 ? Math.min(100, (left / lv.phaseTotalMs) * 100) : 0;
  // The server ignores this click if the timer has already moved the game on, so a late tap can never skip a phase.
  const advance = () => send('/admin/round/live/advance', { expect: { index: lv.index, phase: lv.phase } });
  const caption = paused
    ? 'Timers are frozen. Resume to carry on.'
    : revealing
      ? last ? 'Ends the round and shows the standings.' : `Opens question ${lv.index + 2} for every team.`
      : 'Closes the question, scores it and shows the answer on the projector and phones.';

  return (
    <div className="flex flex-col gap-4">
      <section className="panel flex flex-col gap-3 p-4" aria-label="Live status">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <p className="text-sm text-muted">{round.name}</p>
            <p className="text-lg font-black" data-testid="coord-progress">Question {lv.index + 1} of {lv.total}</p>
          </div>
          <span className={`badge ${paused ? 'badge-warn' : revealing ? 'badge-ok' : ''}`} aria-live="polite" data-testid="coord-phase">
            {paused ? '⏸ Paused' : revealing ? 'Answer revealed' : 'Question open'}
          </span>
          <div role="timer" aria-label={`${revealing ? 'Next question in' : 'Time left to answer'} ${fmtClock(left)}`}>
            <p className="text-sm text-muted">{revealing ? 'Next question in' : 'Teams have'}</p>
            <p className={`mono text-4xl font-black ${paused ? 'text-warn' : 'text-neon'}`}>{fmtClock(left)}</p>
          </div>
          <p className="text-sm sm:ml-auto"><strong className="text-lg" data-testid="coord-answered">{lv.answered}</strong>/{lv.eligible} teams locked in</p>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-panel2" aria-hidden="true"><div className={`h-full ${paused ? 'bg-warn' : 'bg-neon'}`} style={{ width: `${pct}%` }} /></div>
      </section>

      <section className="flex flex-col gap-2" aria-label="Controls">
        <div className="flex flex-wrap items-stretch gap-3">
          {paused ? (
            <button className="btn btn-primary min-h-16 flex-1 text-xl" disabled={busy} onClick={() => send('/admin/round/resume')} data-testid="coord-resume">▶ Resume round</button>
          ) : (
            <button className="btn btn-primary min-h-16 flex-1 text-xl" disabled={busy} onClick={advance} data-testid="coord-advance">
              {revealing ? (last ? '🏁 Finish round' : '⏭ Next question') : '👁 Reveal answer'}
            </button>
          )}
          {s.allowedActions.includes('round.pause') && <button className="btn btn-ghost" disabled={busy} onClick={() => send('/admin/round/pause')} data-testid="coord-pause">⏸ Pause</button>}
        </div>
        <p className="text-sm text-muted">{caption}</p>
      </section>

      <section className="panel flex flex-col gap-4 p-5" aria-labelledby="coord-q">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="coord-q" className="text-lg font-black">{q.title}</h2>
          <span className="badge">{q.points} pts</span>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row">
          {q.image && <FaceImage src={q.image} className="aspect-[4/5] w-40 shrink-0 rounded-xl" />}
          <p className="prompt text-xl sm:text-2xl" data-testid="coord-prompt">{q.prompt}</p>
        </div>
        {q.options && round.kind !== 'bingo' && (
          <ul className="grid gap-2 sm:grid-cols-2" aria-label="Answer options">
            {q.options.map((o) => {
              const right = !hide && q.answers.includes(o.id);
              const picked = lv.options.find((x) => x.id === o.id)?.count;
              return (
                <li key={o.id} className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-lg font-semibold ${right ? 'border-ok bg-[#052e16] text-[#bbf7d0]' : 'border-line bg-panel2/60'}`}>
                  <span className="mono text-muted">{o.id.toUpperCase()}</span>
                  <span className="flex-1">{o.text}</span>
                  {right && <span role="img" aria-label="correct answer">✔</span>}
                  {picked !== undefined && <span className="badge">{picked} team{picked === 1 ? '' : 's'}</span>}
                </li>
              );
            })}
          </ul>
        )}
        <div className="rounded-xl border-2 border-ok bg-[#052e16] px-4 py-3" data-testid="coord-answer">
          <p className="text-xs font-bold uppercase tracking-widest text-ok">Answer</p>
          <p className="mono text-2xl font-black text-[#bbf7d0]">{hide ? MASK : answerText(q)}</p>
          {q.hint && !hide && <p className="mt-1 text-sm text-muted"><span className="font-semibold">{round.kind === 'faces' ? 'Did you know: ' : 'Note: '}</span>{q.hint}</p>}
        </div>
      </section>

      {lv.reveal && <Result r={lv.reveal} />}
      <QuestionList title="All questions & answers" round={round} current={lv.index} hide={hide} />
    </div>
  );
}

function Result({ r }: { r: NonNullable<LivePublic['reveal']> }) {
  return (
    <section className="panel p-4" aria-labelledby="coord-result">
      <h2 id="coord-result" className="mb-2 text-lg font-black">Result</h2>
      {r.voided ? (
        <p className="text-warn">This question was voided: nobody scored.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          <li><strong>{r.correctCount}</strong> of <strong>{r.answered}</strong> teams that answered got it right.</li>
          {r.fastest && <li>⚡ Fastest finger: <strong>{r.fastest.name}</strong> (+{r.fastest.bonus})</li>}
          {r.steal && <li>🗡 <strong>{r.steal.thief}</strong> stole {r.steal.points} from <strong>{r.steal.victim}</strong></li>}
          {r.eliminated.length > 0 && <li>💀 Eliminated: <strong>{r.eliminated.join(', ')}</strong></li>}
          {r.bingos.map((b) => <li key={b.name}>🎯 <strong>{b.name}</strong>: {b.blackout ? 'BLACKOUT!' : `${b.lines} new line${b.lines === 1 ? '' : 's'}`}</li>)}
        </ul>
      )}
    </section>
  );
}

function QuestionList({ title, round, current, hide }: { title: string; round: AdminRound; current: number | null; hide: boolean }) {
  return (
    <section className="panel p-4" aria-labelledby="coord-list">
      <h2 id="coord-list" className="mb-2 text-lg font-black">{title}</h2>
      <ol className="space-y-2">
        {round.challenges.map((c, i) => (
          <li key={c.id} aria-current={i === current ? 'step' : undefined} className={`flex gap-3 rounded-xl border px-3 py-2 ${i === current ? 'border-neon bg-panel2' : 'border-line'} ${current !== null && i < current ? 'opacity-60' : ''}`}>
            <span className="mono text-muted">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="prompt line-clamp-2 text-sm">{c.prompt}</p>
              <p className="text-sm"><span className="text-muted">{c.title} · </span><strong className="mono text-ok">{hide ? MASK : answerText(c)}</strong></p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Everything that is not a live question on the screen: waiting, ready to start, self-paced quiz, between rounds. */
function Standby({ s, round, now, busy, hide, send }: { s: AdminState; round: AdminRound | null; now: number; busy: boolean; hide: boolean; send: Send }) {
  const st = s.event.state;
  const can = (a: string) => s.allowedActions.includes(a);
  const upcoming = s.rounds.filter((r) => r.status === 'pending').sort((a, b) => a.level - b.level)[0] ?? null;
  const sheet = st === 'EVENT_COMPLETED' ? null : round && round.status !== 'ended' ? round : upcoming;
  const inPlay = st === 'ROUND_RUNNING' || st === 'ROUND_PAUSED';

  let headline = 'Waiting for the host';
  let detail = 'The event is being set up.';
  if (st === 'REGISTRATION_OPEN') [headline, detail] = ['Teams are joining', `${s.counts.teams} of ${s.counts.capacity} team slots filled.`];
  else if (st === 'LOBBY') [headline, detail] = ['Lobby', 'All teams are in. The host prepares the next round.'];
  else if (st === 'ROUND_READY' && round) [headline, detail] = [`${round.name} is ready`, 'Start the round when everyone is set. The first question opens straight away.'];
  else if (inPlay && round?.kind === 'quiz') [headline, detail] = [`${round.name} is self-paced`, 'Every team answers at its own speed, so there is nothing to reveal. The answer sheet is below.'];
  else if (inPlay) [headline, detail] = ['Round in progress', 'Waiting for the next question.'];
  else if (st === 'ROUND_ENDED' && round) [headline, detail] = [`${round.name} is over`, 'The host moves on to the next step.'];
  else if (st === 'QUALIFICATION') [headline, detail] = ['Qualification', 'The finalists are being chosen.'];
  else if (st === 'EVENT_COMPLETED') [headline, detail] = ['Event complete', 'Thank you for running the game!'];

  return (
    <div className="flex flex-col gap-4">
      <section className="panel flex flex-col gap-3 p-5" aria-labelledby="coord-standby">
        <h2 id="coord-standby" className="text-2xl font-black" data-testid="coord-headline">{headline}</h2>
        <p className="text-muted">{detail}</p>
        {inPlay && round && (
          <div role="timer" aria-label="Round time remaining">
            <p className="text-sm text-muted">{st === 'ROUND_PAUSED' ? 'Paused at' : 'Time left'}</p>
            <p className={`mono text-4xl font-black ${st === 'ROUND_PAUSED' ? 'text-warn' : 'text-neon'}`}>{fmtClock(remaining(round, now))}</p>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          {can('round.start') && <button className="btn btn-primary min-h-14" disabled={busy} onClick={() => send('/admin/round/start')} data-testid="coord-start">▶ Start round</button>}
          {can('round.resume') && <button className="btn btn-primary min-h-14" disabled={busy} onClick={() => send('/admin/round/resume')} data-testid="coord-resume">▶ Resume round</button>}
          {can('round.pause') && <button className="btn btn-ghost" disabled={busy} onClick={() => send('/admin/round/pause')} data-testid="coord-pause">⏸ Pause</button>}
        </div>
      </section>
      {sheet && <QuestionList title={sheet === round ? `${sheet.name}: questions & answers` : `Up next: ${sheet.name}`} round={sheet} current={null} hide={hide} />}
    </div>
  );
}
