import { useEffect, useRef, useState } from 'react';
import type { AnswerResult, LivePublic, PublicState, TeamState } from '../../../../shared/types';
import { errMsg, newRequestId } from '../../lib/api';
import { fmtClock, type Live } from '../../lib/realtime';
import { submitAnswer } from '../../lib/submit';
import { ErrorBanner, Spinner } from '../../components/ui';
import { OptionButtons } from '../../components/OptionButtons';
import { Emblem, LEVELS, skinOf } from '../../components/Backdrop';
import { FaceImage } from '../../components/FaceImage';
import { BingoCard } from '../../components/BingoCard';

export function LivePlay({ team, pub, round, live, now, paused }: { team: TeamState; pub: PublicState; round: NonNullable<PublicState['round']>; live: Live; now: number; paused: boolean }) {
  const q = pub.live;
  const me = team.live;
  if (!me) return <Spinner label="Joining the round" />;

  const hearts = me.lives !== null && (
    <span aria-label={`${me.lives} lives left`} className="text-lg text-bad">
      <span aria-hidden="true"><span className="beat">{'♥'.repeat(Math.max(0, me.lives))}</span><span className="text-line">{'♥'.repeat(Math.max(0, 3 - me.lives))}</span></span>
    </span>
  );

  if (me.eliminated) {
    return (
      <section data-level={skinOf(round.level)} className="panel pop border-bad p-6 text-center" aria-label="Eliminated">
        <p className="break text-6xl" aria-hidden="true">💔</p>
        <h2 className="text-2xl font-black">You are out of the Showdown</h2>
        <p className="mt-2 text-muted">Your points stay on the board. Watch the big screen for the finish!</p>
        {q && <p className="mt-3 text-sm">Question {q.index + 1} of {q.total}</p>}
      </section>
    );
  }
  if (!q) return <Spinner label="Waiting for the next question" />;

  return (
    <section data-level={skinOf(round.level)} className="flex flex-col gap-3" aria-label="Live question">
      <div className="panel px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-[var(--accent)]"><Emblem level={round.level} />Level {round.level} · {LEVELS[round.level]?.name ?? 'Live'}</p>
            {round.kind === 'bingo' && me.bingo && <p className="text-xs text-muted">Card: {me.bingo.marked.length}/16 marked · {me.bingo.lines} line{me.bingo.lines === 1 ? '' : 's'}</p>}
            <p className="font-bold">{round.kind === 'bingo' ? 'Call' : 'Question'} {q.index + 1} of {q.total}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {hearts}
            {me.streak >= 2 && <span className="badge badge-warn beat" aria-label={`Streak of ${me.streak}`}><span aria-hidden="true">🔥</span> streak {me.streak}</span>}
          </div>
        </div>
        <PhaseBar q={q} now={now} paused={paused} />
      </div>

      {paused && (
        <div role="status" className="panel pop border-warn p-4 text-center">
          <p className="text-3xl" aria-hidden="true">⏸</p>
          <p className="text-xl font-black">Game paused</p>
          <p className="text-muted">The host paused the round and the clock is frozen. The question stays here; answering opens again when the host resumes.</p>
        </div>
      )}
      {/* Stays mounted through a pause, so a tile or option picked before it is still picked afterwards. */}
      {q.phase === 'open' ? <Open key={q.index} q={q} team={team} live={live} now={now} paused={paused} /> : <Reveal q={q} team={team} />}
    </section>
  );
}

function PhaseBar({ q, now, paused }: { q: LivePublic; now: number; paused: boolean }) {
  const left = paused || q.phaseEndsAt === null ? q.phaseRemainingMs : Math.max(0, q.phaseEndsAt - now);
  const pct = Math.max(0, Math.min(100, (left / q.phaseTotalMs) * 100));
  const urgent = q.phase === 'open' && left < 5000 && !paused;
  return (
    <div className="mt-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted">{paused ? 'Clock paused' : q.phase === 'open' ? 'Time to answer' : 'Next question in'}</span>
        <span role="timer" aria-label={`${Math.ceil(left / 1000)} seconds`} className={`mono text-2xl font-black ${urgent ? 'urgent text-bad' : ''}`}>{fmtClock(left)}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-panel2" aria-hidden="true">
        <div className={`h-full shadow-[0_0_12px_var(--accent)] ${urgent ? 'bg-bad' : 'bg-[var(--accent)]'}`} style={{ width: `${pct}%`, transition: 'width 0.3s linear' }} />
      </div>
    </div>
  );
}

function Open({ q, team, live, now, paused }: { q: LivePublic; team: TeamState; live: Live; now: number; paused: boolean }) {
  const me = team.live!;
  const [value, setValue] = useState('');
  const [double, setDouble] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chosen = useRef('');
  const bingo = me.bingo;
  const label = (id: string) => (bingo ? bingo.tiles.find((t) => t.id === id)?.text : q.options.find((o) => o.id === id)?.text) ?? id;
  const locked = me.locked || result?.outcome === 'locked';
  const closed = (q.phaseEndsAt !== null && q.phaseEndsAt <= now) || result?.outcome === 'late';

  useEffect(() => {
    if (!me.doubleAvailable) setDouble(false);
  }, [me.doubleAvailable]);

  async function send() {
    if (busy || paused || !value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await submitAnswer(live.socketRef.current, { requestId: newRequestId(), answer: value, doubleDown: double && me.doubleAvailable ? true : undefined });
      chosen.current = value;
      setResult(r);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <article key={q.index} className="panel glow pop p-4">
        {q.image && <div className="photo-frame mb-3"><FaceImage src={q.image} className="aspect-square max-h-[40vh] w-full" /></div>}
        <h2 className="text-lg font-black text-[var(--accent)]">{q.title}</h2>
        <p className={`mt-2 text-base ${bingo || q.image ? 'font-semibold leading-snug' : 'prompt'}`}>{bingo && <span aria-hidden="true">📣 </span>}{q.prompt}</p>
        <p className="mt-3 text-xs text-muted">Worth {q.points} points + speed bonus · {bingo ? 'tap the tile that matches, then lock in' : 'one answer, final'}</p>
      </article>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {result && result.outcome !== 'locked' && (
        <div role="status" className="pop rounded-xl border-2 border-warn bg-[#3b2a05] px-4 py-3 font-semibold text-[#fde68a]">⚠ {result.message}</div>
      )}
      {locked ? (
        <div role="status" aria-live="polite" className="panel pop border-neon p-5 text-center">
          <p className="lock-in text-5xl" aria-hidden="true">🔒</p>
          <p className="text-xl font-black">Answer locked in{chosen.current ? `: ${label(chosen.current)}` : ''}</p>
          <p className="text-muted">{result?.message.includes('DOUBLE') ? '🔥 Double Down is on! ' : ''}Results appear when the question closes.</p>
          <p className="mt-2 text-sm text-muted">{q.answered} of {q.eligible} teams locked in</p>
        </div>
      ) : closed ? (
        <div role="status" className="panel p-5 text-center"><p className="text-xl font-black">⏱ Time is up</p><p className="text-muted">Waiting for the reveal…</p></div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); if (q.options.length === 0 && !bingo) void send(); }} className="flex flex-col gap-3">
          {bingo ? (
            <BingoCard bingo={bingo} selected={value} onSelect={setValue} disabled={paused} />
          ) : q.options.length > 0 ? (
            <OptionButtons options={q.options} value={value} onChange={setValue} disabled={paused} />
          ) : (
            <div>
              <label className="lbl" htmlFor="live-ans">Your answer</label>
              <input id="live-ans" className="field mono !min-h-14 text-xl" disabled={paused} value={value} onChange={(e) => setValue(e.target.value)} maxLength={120} autoComplete="off" spellCheck={false} inputMode={q.kind === 'number' ? 'decimal' : 'text'} enterKeyHint="send" />
            </div>
          )}
          {me.doubleAvailable && (
            <label className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-3 transition ${double ? 'pulse border-warn bg-[#3b2a05]' : 'border-line'}`}>
              <input type="checkbox" className="h-6 w-6" checked={double} disabled={paused} onChange={(e) => setDouble(e.target.checked)} />
              <span>
                <strong>🔥 Double Down</strong> <span className="text-sm text-muted">(one per game)</span>
                <span className="block text-sm text-muted">Right = double points. Wrong = you lose {q.points}.</span>
              </span>
            </label>
          )}
          <button type={q.options.length > 0 || bingo ? 'button' : 'submit'} onClick={q.options.length > 0 || bingo ? () => void send() : undefined} className="btn btn-primary !min-h-14 text-lg" disabled={busy || paused || !value.trim()}>
            {paused ? '⏸ Paused' : busy ? 'Locking in…' : double ? '🔥 Lock in with Double Down' : bingo && value ? `Lock in ${label(value)}` : 'Lock in answer'}
          </button>
        </form>
      )}
    </>
  );
}

function Reveal({ q, team }: { q: LivePublic; team: TeamState }) {
  const me = team.live!;
  const r = q.reveal;
  const res = me.result;
  const bingo = me.bingo;
  const calling = bingo && r && !r.voided ? (q.bingo?.called.at(-1) ?? null) : null;
  const tone = !res ? '' : res.outcome === 'correct' ? 'border-ok bg-[#052e16]' : res.outcome === 'incorrect' ? 'border-bad bg-[#3b0a1c]' : 'border-line bg-panel2';
  return (
    <>
      <div role="status" aria-live="polite" className={`${res?.outcome === 'correct' ? 'res-correct' : res?.outcome === 'incorrect' ? 'res-wrong' : 'pop'} rounded-xl border-2 p-4 ${tone}`}>
        {res ? (
          <>
            <p className="text-2xl font-black">
              {res.outcome === 'correct' && <><span aria-hidden="true">✔ </span>Correct!</>}
              {res.outcome === 'incorrect' && <><span aria-hidden="true">✘ </span>Wrong answer</>}
              {res.outcome === 'none' && <><span aria-hidden="true">⏱ </span>No answer</>}
              <span className={`tnum float-right ${res.points >= 0 ? 'text-ok' : 'text-bad'}`}>{res.points >= 0 ? '+' : ''}{res.points}</span>
            </p>
            <ul className="mt-2 space-y-0.5 text-sm">
              {res.breakdown.map((b, i) => (
                <li key={i} className="flex justify-between"><span>{b.label}</span><span className="tnum font-bold">{b.points >= 0 ? '+' : ''}{b.points}</span></li>
              ))}
            </ul>
            {me.lives !== null && res.outcome !== 'correct' && <p className="mt-2 font-bold text-bad">💔 You lost a life{me.eliminated ? ' – you are out!' : ` (${me.lives} left)`}</p>}
          </>
        ) : (
          <p className="text-lg font-bold">Results…</p>
        )}
      </div>
      {q.image && r && !r.voided && (
        <div className="photo-frame pop mx-auto w-full max-w-[16rem]">
          <FaceImage src={q.image} className="aspect-square w-full" />
          <p className="name-tag">{r.correctText}</p>
        </div>
      )}
      {bingo && (
        <div className="panel p-3">
          <BingoCard bingo={bingo} calling={calling} />
          {res?.breakdown.some((b) => b.label.startsWith('BINGO')) && <p className="res-correct mt-2 rounded-lg border-2 border-[var(--accent2)] bg-panel2 py-2 text-center text-xl font-black text-[var(--accent2)]">🎉 BINGO! Line completed</p>}
          {res?.breakdown.some((b) => b.label.startsWith('BLACKOUT')) && <p className="res-correct mt-2 rounded-lg border-2 border-[var(--accent2)] bg-panel2 py-2 text-center text-xl font-black text-[var(--accent2)]">🏆 BLACKOUT! Full card</p>}
        </div>
      )}
      {r && (
        <div className="panel p-4">
          <p className="text-sm text-muted">Correct answer</p>
          <p className="text-xl font-black text-ok">{r.correctText}</p>
          {r.fact && <p className="mt-2 text-sm"><span aria-hidden="true">💡 </span>{r.fact}</p>}
          <p className="mt-2 text-sm text-muted">{r.correctCount} of {r.answered} answering teams got it right</p>
          {r.fastest && <p className="mt-2">⚡ Fastest: <strong>{r.fastest.name}</strong></p>}
          {r.steal && <p className="mt-1">🦹 <strong>{r.steal.thief}</strong> stole {r.steal.points} from <strong>{r.steal.victim}</strong>!</p>}
          {r.eliminated.length > 0 && <p className="mt-1 text-bad">💔 Eliminated: {r.eliminated.join(', ')}</p>}
          {r.bingos.length > 0 && <p className="mt-1">🎉 BINGO: <strong>{r.bingos.map((b) => b.name).join(', ')}</strong></p>}
        </div>
      )}
      {me.streak >= 2 && <p className="text-center font-bold text-warn"><span className="beat" aria-hidden="true">🔥</span> {me.streak} in a row!</p>}
    </>
  );
}
