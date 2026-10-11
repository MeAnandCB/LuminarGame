import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AnswerResult, PublicState, TeamState } from '../../../shared/types';
import { ApiFailure, api, errMsg, newRequestId } from '../lib/api';
import { fmtClock, remaining, useLive, useServerNow, type Live } from '../lib/realtime';
import { submitAnswer } from '../lib/submit';
import { ConnBadge, ErrorBanner, Leaderboard, Spinner } from '../components/ui';
import { LivePlay } from './team/LivePlay';
import { OptionButtons } from '../components/OptionButtons';

type Boot = 'loading' | 'anon' | 'in';

export function TeamApp() {
  const [boot, setBoot] = useState<Boot>('loading');
  const [initial, setInitial] = useState<TeamState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      setInitial(await api<TeamState>('GET', '/team/me'));
      setBoot('in');
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 0) {
        setNotice(e.message);
        setTimeout(check, 2000);
        return;
      }
      setBoot('anon');
    }
  }, []);
  useEffect(() => {
    void check();
  }, [check]);
  const lost = useCallback((msg: string) => {
    setNotice(msg);
    setInitial(null);
    setBoot('anon');
  }, []);

  if (boot === 'loading') return <Shell><Spinner label="Restoring your session" />{notice && <ErrorBanner>{notice}</ErrorBanner>}</Shell>;
  if (boot === 'anon') return <Shell><JoinForm notice={notice} onJoined={(s) => { setInitial(s); setNotice(null); setBoot('in'); }} /></Shell>;
  return <Session initial={initial!} onLost={lost} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-4 px-4 py-5">
      <header className="flex items-center gap-2">
        <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-lg bg-panel2 font-black text-neon">B</span>
        <h1 className="text-lg font-black tracking-wide">BRAINBYTE <span className="text-violet">ARENA</span></h1>
      </header>
      {children}
    </main>
  );
}

// ---------------------------------------------------------------- join -----

function JoinForm({ onJoined, notice }: { onJoined: (s: TeamState) => void; notice: string | null }) {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'new' | 'device'>('new');
  const [pin, setPin] = useState(params.get('pin') ?? '');
  const [name, setName] = useState('');
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(notice);
  const [busy, setBusy] = useState(false);
  const [eventInfo, setEventInfo] = useState<{ found: boolean; name?: string; registrationOpen?: boolean } | null>(null);

  useEffect(() => {
    if (!/^\d{6}$/.test(pin)) {
      setEventInfo(null);
      return;
    }
    let alive = true;
    api<typeof eventInfo>('GET', `/public/event?pin=${pin}`).then((r) => alive && setEventInfo(r)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [pin]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = mode === 'new' ? await api<TeamState>('POST', '/team/join', { pin, name, players: [p1, p2] }) : await api<TeamState>('POST', '/team/link', { pin, code });
      onJoined(s);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel flex flex-col gap-4 p-5" aria-labelledby="join-h">
      <h2 id="join-h" className="text-2xl font-black">{mode === 'new' ? 'Join the arena' : 'Add this phone to your team'}</h2>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div>
        <label className="lbl" htmlFor="pin">Room PIN (shown on the big screen)</label>
        <input id="pin" className="field mono text-center text-2xl tracking-[0.3em]" inputMode="numeric" autoComplete="off" maxLength={6} pattern="\d{6}" required value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="000000" />
        {eventInfo?.found && <p className="mt-1 text-sm text-ok" aria-live="polite">✔ {eventInfo.name}{eventInfo.registrationOpen ? '' : ' – registration is closed'}</p>}
        {eventInfo && !eventInfo.found && <p className="mt-1 text-sm text-warn" aria-live="polite">⚠ No event with that PIN</p>}
      </div>
      {mode === 'new' ? (
        <>
          <div>
            <label className="lbl" htmlFor="tname">Team name</label>
            <input id="tname" className="field" required minLength={2} maxLength={24} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Binary Bandits" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="lbl" htmlFor="p1">Player 1 name</label>
              <input id="p1" className="field" required maxLength={24} autoComplete="off" value={p1} onChange={(e) => setP1(e.target.value)} />
            </div>
            <div>
              <label className="lbl" htmlFor="p2">Player 2 name</label>
              <input id="p2" className="field" required maxLength={24} autoComplete="off" value={p2} onChange={(e) => setP2(e.target.value)} />
            </div>
          </div>
        </>
      ) : (
        <div>
          <label className="lbl" htmlFor="code">Team code (from your team's first phone)</label>
          <input id="code" className="field mono text-center text-2xl uppercase tracking-[0.25em]" required maxLength={10} autoCapitalize="characters" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC123" />
        </div>
      )}
      <button className="btn btn-primary text-lg" disabled={busy}>{busy ? 'Please wait…' : mode === 'new' ? 'Register team' : 'Connect this phone'}</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMode(mode === 'new' ? 'device' : 'new'); setError(null); }}>
        {mode === 'new' ? 'My teammate already registered – add this phone' : 'Register a new team instead'}
      </button>
    </form>
  );
}

// ------------------------------------------------------------ session -----

function Session({ initial, onLost }: { initial: TeamState; onLost: (m: string) => void }) {
  const live = useLive('team');
  const team = live.team ?? initial;
  const pub = live.pub;
  const now = useServerNow(live.offset);

  useEffect(() => {
    if (live.sessionEnded) {
      void api('POST', '/team/logout').catch(() => undefined);
      onLost('Your team was removed or the event was reset. Please join again.');
    }
  }, [live.sessionEnded, onLost]);
  useEffect(() => {
    if (live.status !== 'denied') return;
    api('GET', '/team/me').catch((e) => e instanceof ApiFailure && e.status === 401 && onLost('Your session has ended. Please join again.'));
  }, [live.status, onLost]);

  return (
    <Shell>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xl font-black leading-tight">{team.team.name}</p>
          <p className="text-sm text-muted">{team.team.players.join(' & ')}</p>
        </div>
        <ConnBadge status={live.status} />
      </div>
      <ScoreStrip team={team} />
      {live.announcement && <Toast key={live.announcement.n} text={live.announcement.text} />}
      <Screen team={team} pub={pub} live={live} now={now} />
    </Shell>
  );
}

function Toast({ text }: { text: string }) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setShown(false), 6000);
    return () => clearTimeout(id);
  }, []);
  if (!shown) return null;
  return <div role="status" className="pop rounded-xl border border-neon bg-panel2 px-4 py-3 font-semibold text-neon">📣 {text}</div>;
}

function ScoreStrip({ team }: { team: TeamState }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-center" aria-label="Your standing">
      <Stat label="Points" value={String(team.score.total)} />
      <Stat label="Rank" value={team.rankHidden ? 'Hidden' : team.rank ? `#${team.rank}` : '–'} />
      <Stat label="Status" value={team.qualified === null ? 'Playing' : team.qualified ? '✔ Finalist' : 'Not qualified'} small />
    </div>
  );
}
const Stat = ({ label, value, small }: { label: string; value: string; small?: boolean }) => (
  <div className="panel px-2 py-2">
    <div className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</div>
    <div className={`tnum font-black ${small ? 'text-base leading-7' : 'text-2xl'}`}>{value}</div>
  </div>
);

function Screen({ team, pub, live, now }: { team: TeamState; pub: PublicState | null; live: Live; now: number }) {
  const st = team.eventState;
  const round = pub?.round ?? null;

  if (team.team.status === 'pending') return <Card title="Waiting for approval" icon="⏳">The host is reviewing registrations. This page updates automatically.</Card>;
  if (team.team.status === 'rejected') return <Card title="Registration declined" icon="✘">The host did not approve this registration. Please speak to an organiser.</Card>;

  if (st === 'SETUP' || st === 'REGISTRATION_OPEN' || st === 'LOBBY') {
    return (
      <Card title={st === 'LOBBY' ? "You're in the lobby" : 'Registered!'} icon="🛰️">
        <p>{st === 'LOBBY' ? 'Registration is closed. Stay on this screen – the host will start Level 1 soon.' : 'Waiting for the host to close registration.'}</p>
        <p className="mt-3 text-muted">{pub ? `${pub.counts.teams} team(s) registered · ${pub.counts.connected} connected` : ''}</p>
        <div className="mt-4 rounded-xl border border-line bg-ink p-4 text-center">
          <p className="text-sm text-muted">Need a second phone? Open this site there, choose “add this phone” and enter your team code:</p>
          <p className="mono mt-2 text-3xl font-black tracking-[0.25em] text-neon" aria-label={`Team code ${team.team.code.split('').join(' ')}`}>{team.team.code}</p>
        </div>
      </Card>
    );
  }
  if (st === 'EVENT_COMPLETED') return <Final team={team} pub={pub} />;
  if (st === 'QUALIFICATION') {
    return (
      <Card title="Qualification" icon={team.qualified ? '🏆' : '🎯'}>
        {team.qualified ? <p className="text-xl font-bold text-ok">✔ You qualified for The Final Hack!</p> : <p className="text-xl font-bold">You did not qualify for the final – thank you for playing!</p>}
        <p className="mt-2 text-muted">Finalists: {pub?.finalists.map((f) => f.name).join(', ') || '…'}</p>
        <p className="mt-3">Wait for the host to start the final level.</p>
      </Card>
    );
  }
  if (!round) return <Spinner />;

  if (!team.eligible) {
    return (
      <Card title={round.name} icon="👀" level={round.level}>
        <p>This round is for finalists only. Watch the big screen – you can still follow the leaderboard below.</p>
        {pub && <div className="mt-4"><Leaderboard rows={pub.leaderboard} provisional={pub.provisional} hidden={pub.scoresHidden} highlightId={team.team.id} compact /></div>}
      </Card>
    );
  }

  if (st === 'ROUND_READY') {
    return (
      <Card title={round.name} icon="🚀" level={round.level}>
        <p className="text-lg">{round.instructions}</p>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-muted">
          <li>{round.total} questions · {round.kind === 'quiz' ? `${Math.round(round.durationMs / 60000)} minutes, at your own pace` : 'live - everyone answers the same question together'}</li>
          <li>Both teammates can read the screen – only one phone needs to answer.</li>
        </ul>
        <p className="mt-4 font-bold text-neon">Waiting for the host to press start…</p>
      </Card>
    );
  }
  if (st === 'ROUND_RUNNING' || st === 'ROUND_PAUSED') {
    return round.kind === 'quiz' ? (
      <Play team={team} round={round} live={live} now={now} paused={st === 'ROUND_PAUSED'} />
    ) : (
      <LivePlay team={team} pub={pub!} round={round} live={live} now={now} paused={st === 'ROUND_PAUSED'} />
    );
  }

  // ROUND_ENDED
  return <Between team={team} pub={pub} />;
}

function Card({ title, icon, children, level }: { title: string; icon: string; children: React.ReactNode; level?: number }) {
  return (
    <section data-level={level} className="panel pop p-5" aria-labelledby="card-h">
      <h2 id="card-h" className="mb-3 text-2xl font-black"><span aria-hidden="true">{icon} </span>{title}</h2>
      {children}
    </section>
  );
}

// -------------------------------------------------------------- play -----

const OUTCOME_UI: Record<AnswerResult['outcome'], { icon: string; label: string; cls: string }> = {
  correct: { icon: '✔', label: 'Correct', cls: 'border-ok bg-[#052e16] text-[#bbf7d0]' },
  incorrect: { icon: '✘', label: 'Incorrect', cls: 'border-bad bg-[#3b0a1c] text-[#ffd5dc]' },
  late: { icon: '⏱', label: 'Too late', cls: 'border-warn bg-[#3b2a05] text-[#fde68a]' },
  rejected: { icon: '⚠', label: 'Not accepted', cls: 'border-warn bg-[#3b2a05] text-[#fde68a]' },
  locked: { icon: '🔒', label: 'Locked in', cls: 'border-neon bg-[#06232c] text-[#a5f3fc]' },
  skipped: { icon: '⏭', label: 'Skipped', cls: 'border-line bg-panel2 text-text' },
};

function Play({ team, round, live, now, paused }: { team: TeamState; round: NonNullable<PublicState['round']>; live: Live; now: number; paused: boolean }) {
  const ch = team.challenge;
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<{ text: string; note: string } | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const lastChallenge = useRef<number | null>(null);
  const left = remaining(round, now);

  useEffect(() => {
    if (ch && lastChallenge.current !== ch.id) {
      lastChallenge.current = ch.id;
      setValue('');
      setError(null);
      setHint(null);
      setConfirmSkip(false);
    }
  }, [ch]);

  async function submit(answer: string) {
    if (!ch || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await submitAnswer(live.socketRef.current, { requestId: newRequestId(), answer, challengeId: ch.id }));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    if (!ch || busy) return;
    setBusy(true);
    setError(null);
    setConfirmSkip(false);
    try {
      setResult(await api<AnswerResult>('POST', '/team/skip', { requestId: newRequestId(), challengeId: ch.id }));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function useHint() {
    setBusy(true);
    try {
      const h = await api<{ text: string; penaltyApplied: number; alreadyUsed: boolean }>('POST', '/team/hint');
      setHint({ text: h.text, note: h.penaltyApplied ? `−${h.penaltyApplied} points` : 'already unlocked – no extra cost' });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (!team.progress) return <Spinner />;
  if (team.progress.finished || !ch) {
    return (
      <Card title="Round complete!" icon="🎉" level={round.level}>
        <p>You went through all {team.progress.total} questions. Time left on the clock: <strong className="tnum">{fmtClock(left)}</strong>.</p>
        <p className="mt-2 text-muted">Wait for the host to end the round and reveal the results.</p>
      </Card>
    );
  }
  const pct = Math.round((team.progress.position / team.progress.total) * 100);
  const timeUp = left <= 0 && !paused;

  return (
    <section data-level={round.level} className="flex flex-col gap-3" aria-label="Current question">
      <div className="panel flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--accent)]">Level {round.level} · Quick Brain</p>
          <p className="font-bold">Question {ch.position + 1} of {ch.total}</p>
        </div>
        <div className="text-right" role="timer" aria-label={`Time remaining ${fmtClock(left)}`}>
          <p className={`mono text-3xl font-black ${left < 30000 && !paused ? 'text-bad' : 'text-text'}`}>{fmtClock(left)}</p>
          <p className="text-xs text-muted">{paused ? 'PAUSED' : 'remaining'}</p>
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-panel2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Round progress">
        <div className="h-full bg-[var(--accent)] transition-[width]" style={{ width: `${pct}%` }} />
      </div>

      {paused ? (
        <div role="status" className="panel pop border-warn p-6 text-center">
          <p className="text-3xl">⏸</p>
          <p className="text-xl font-black">Round paused</p>
          <p className="text-muted">The host paused the game. Your progress and remaining time are safe.</p>
        </div>
      ) : (
        <>
          {result && (
            <div role="status" aria-live="polite" className={`pop rounded-xl border-2 px-4 py-3 font-semibold ${OUTCOME_UI[result.outcome].cls}`}>
              <span aria-hidden="true">{OUTCOME_UI[result.outcome].icon} </span>
              <span className="sr-only">{OUTCOME_UI[result.outcome].label}: </span>
              {result.message}
              {result.duplicate ? ' (already received)' : ''}
            </div>
          )}
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <article className="panel glow p-4">
            <h2 className="text-lg font-black text-[var(--accent)]">{ch.title}</h2>
            <p className="prompt mt-2 text-base">{ch.prompt}</p>
            <p className="mt-3 text-xs text-muted">Worth {ch.points} points · one answer only</p>
          </article>

          <form onSubmit={(e) => { e.preventDefault(); if (ch.kind !== 'choice') void submit(value); }} className="flex flex-col gap-3">
            {ch.kind === 'choice' && ch.options ? (
              <OptionButtons options={ch.options} value={value} onChange={setValue} />
            ) : (
              <div>
                <label className="lbl" htmlFor="ans">Your answer</label>
                <input
                  id="ans" className="field mono !min-h-14 text-xl" value={value} onChange={(e) => setValue(e.target.value)}
                  maxLength={120} autoComplete="off" autoCorrect="off" autoCapitalize={ch.kind === 'text' ? 'characters' : 'none'} spellCheck={false}
                  inputMode={ch.kind === 'number' ? 'decimal' : 'text'} enterKeyHint="send"
                />
              </div>
            )}
            <button type={ch.kind === 'choice' ? 'button' : 'submit'} onClick={ch.kind === 'choice' ? () => void submit(value) : undefined} className="btn btn-primary !min-h-14 text-lg" disabled={busy || !value.trim() || timeUp}>
              {busy ? 'Sending…' : timeUp ? "Time's up" : 'Lock in answer'}
            </button>
            {team.canSkip && (
              confirmSkip ? (
                <div className="flex items-center gap-2 rounded-xl border border-line p-3" role="group" aria-label="Confirm skip">
                  <span className="flex-1 text-sm">Skip this question? It scores nothing and you cannot come back.</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmSkip(false)}>Keep</button>
                  <button type="button" className="btn btn-violet btn-sm" disabled={busy} onClick={() => void skip()}>Skip it</button>
                </div>
              ) : (
                <button type="button" className="btn btn-ghost" disabled={busy || timeUp} onClick={() => setConfirmSkip(true)}>⏭ Skip question</button>
              )
            )}
          </form>

          {team.hint?.available && (
            <div className="panel px-4 py-3">
              {hint || team.hint.used ? (
                <p><strong>Hint:</strong> {hint?.text ?? team.hint.text} {hint && <span className="text-xs text-muted">({hint.note})</span>}</p>
              ) : (
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={useHint}>
                  💡 Reveal hint {team.hint.penalty ? `(−${team.hint.penalty} points)` : '(free)'}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ----------------------------------------------------------- between -----

function Between({ team, pub }: { team: TeamState; pub: PublicState | null }) {
  const round = pub?.round;
  const reveal = pub?.reveal;
  return (
    <>
      <Card title={`${round?.name ?? 'Round'} – finished`} icon="🏁" level={round?.level}>
        <p>Your round score: <strong className="tnum text-neon">{team.score.round}</strong> · total <strong className="tnum">{team.score.total}</strong></p>
        <p className="mt-2 text-muted">Waiting for the host to continue to the next stage…</p>
      </Card>
      {team.history.length > 0 && (
        <section className="panel p-4" aria-labelledby="rev-h">
          <h3 id="rev-h" className="mb-2 text-lg font-black">Your answers</h3>
          <ol className="space-y-2">
            {team.history.map((h) => {
              const correct = reveal?.find((r) => r.position === h.position)?.answer;
              const label = h.outcome === 'correct' ? '✔ Correct' : h.outcome === 'skipped' ? '⏭ Skipped' : '✘ Incorrect';
              return (
                <li key={h.position} className="rounded-lg bg-panel2 px-3 py-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold">{h.position + 1}. {h.title}</span>
                    <span className={h.outcome === 'correct' ? 'text-ok' : h.outcome === 'skipped' ? 'text-muted' : 'text-bad'}>{label} · {h.points}</span>
                  </div>
                  <div className="text-muted">{h.outcome === 'skipped' ? 'You skipped this question' : `You answered: ${h.yourAnswer || '–'}`}{correct && h.outcome !== 'correct' ? ` · Correct: ${correct}` : ''}</div>
                </li>
              );
            })}
          </ol>
          {!reveal && <p className="mt-2 text-xs text-muted">Correct answers appear when the host reveals them.</p>}
        </section>
      )}
      {pub && <section className="panel p-4"><h3 className="mb-2 text-lg font-black">Leaderboard</h3><Leaderboard rows={pub.leaderboard} hidden={pub.scoresHidden} highlightId={team.team.id} compact /></section>}
    </>
  );
}

function Final({ team, pub }: { team: TeamState; pub: PublicState | null }) {
  return (
    <>
      <Card title="Final results" icon="🏆">
        <p className="text-3xl font-black text-neon">{team.award}</p>
        <p className="mt-1 text-lg">You finished <strong>#{team.rank ?? '–'}</strong> with <strong className="tnum">{team.score.total}</strong> points.</p>
      </Card>
      {pub?.podium && (
        <section className="panel p-4" aria-labelledby="pod-h">
          <h3 id="pod-h" className="mb-2 text-lg font-black">Podium</h3>
          <ol className="space-y-2">
            {pub.podium.map((r) => (
              <li key={r.teamId} className="flex items-center justify-between rounded-lg bg-panel2 px-3 py-2">
                <span><span aria-hidden="true">{['🥇', '🥈', '🥉'][r.rank - 1]} </span><span className="sr-only">Place {r.rank}: </span><strong>{r.name}</strong></span>
                <span className="tnum font-black">{r.total}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {pub && <section className="panel p-4"><h3 className="mb-2 text-lg font-black">Final standings</h3><Leaderboard rows={pub.leaderboard} highlightId={team.team.id} compact /></section>}
    </>
  );
}
