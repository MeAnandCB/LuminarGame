import type { LeaderboardRow, LiveOption, LivePublic, PublicState } from '../../../../shared/types';
import { Leaderboard } from '../../components/ui';

const TILE = ['border-[#38bdf8] bg-[#0c2a3d]', 'border-[#f472b6] bg-[#3b0f2a]', 'border-[#fbbf24] bg-[#3b2a05]', 'border-[#4ade80] bg-[#0b2e1a]'];
const SHAPE = ['▲', '◆', '●', '■'];

function Ring({ q, now, paused }: { q: LivePublic; now: number; paused: boolean }) {
  const left = paused || q.phaseEndsAt === null ? q.phaseRemainingMs : Math.max(0, q.phaseEndsAt - now);
  const frac = Math.max(0, Math.min(1, left / q.phaseTotalMs));
  const R = 54;
  const C = 2 * Math.PI * R;
  const urgent = q.phase === 'open' && left < 5000 && !paused;
  return (
    <div role="timer" aria-label={`${Math.ceil(left / 1000)} seconds left`} className="relative grid h-[clamp(6rem,10vw,12rem)] w-[clamp(6rem,10vw,12rem)] shrink-0 place-items-center">
      <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={R} fill="none" stroke="rgb(44 56 112)" strokeWidth="9" />
        <circle cx="60" cy="60" r={R} fill="none" stroke={urgent ? '#fb7185' : paused ? '#fbbf24' : 'var(--accent)'} strokeWidth="9" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} style={{ transition: 'stroke-dashoffset .3s linear' }} />
      </svg>
      <span className={`mono text-[clamp(1.6rem,3.6vw,4.4rem)] font-black ${urgent ? 'text-bad' : ''}`}>{Math.ceil(left / 1000)}</span>
    </div>
  );
}

function Tile({ o, i, reveal }: { o: LiveOption; i: number; reveal: boolean }) {
  const dim = reveal && !o.correct;
  return (
    <li className={`relative flex items-center gap-[1vw] overflow-hidden rounded-2xl border-2 px-[1vw] py-[0.6vw] ${TILE[i % 4]} ${dim ? 'opacity-40' : ''} ${reveal && o.correct ? 'glow !border-ok' : ''}`}>
      <span aria-hidden="true" className="text-[1.5em]">{SHAPE[i % 4]}</span>
      <span className="mono grid h-[2.4em] w-[2.4em] shrink-0 place-items-center rounded-lg border border-current text-[0.9em] font-black">{o.id.toUpperCase()}</span>
      <span className="flex-1 text-[1.2em] font-bold leading-tight">{o.text}</span>
      {reveal && (
        <span className="flex items-center gap-2 text-[1.2em] font-black">
          {o.correct && <span className="text-ok" aria-label="correct answer">✔</span>}
          <span className="tnum" aria-label={`${o.count ?? 0} teams chose this`}>{o.count ?? 0}</span>
        </span>
      )}
    </li>
  );
}

export function LiveView({ pub, now }: { pub: PublicState; now: number }) {
  const q = pub.live!;
  const round = pub.round!;
  const paused = pub.event!.state === 'ROUND_PAUSED';
  const r = q.reveal;
  const rows: LeaderboardRow[] = round.kind === 'showdown' ? pub.leaderboard.filter((x) => x.qualified !== false) : pub.leaderboard;
  const half = Math.ceil(rows.length / 2);
  const split = rows.length > 9;
  return (
    <div className="grid flex-1 grid-cols-1 gap-[1.4vw] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <section className="flex flex-col gap-[0.9vw]" aria-label="Live question">
        <div className="flex items-center gap-[1.2vw]">
          <Ring q={q} now={now} paused={paused} />
          <div className="min-w-0 flex-1">
            <p className="text-[0.8em] font-bold uppercase tracking-[0.25em] text-[var(--accent)]">
              Level {round.level} · {round.kind === 'lightning' ? 'Reel Rush' : 'Final Showdown'} · Question {q.index + 1}/{q.total}
            </p>
            <p className="text-[0.95em] text-muted">
              {paused ? '⏸ PAUSED by the host' : q.phase === 'open' ? `${q.answered} of ${q.eligible} teams locked in` : r?.voided ? 'Question skipped' : 'Reveal'}
            </p>
          </div>
        </div>
        <article className="panel glow p-[1.2vw]">
          <h2 className="text-[0.9em] font-bold uppercase tracking-widest text-muted">{q.title} · {q.points} pts</h2>
          <p className="mt-[0.4vw] text-[clamp(1.2rem,2.3vw,2.9rem)] font-black leading-tight">{q.prompt}</p>
        </article>
        {q.options.length > 0 && (
          <ol className="grid grid-cols-1 gap-[0.8vw] sm:grid-cols-2" aria-label="Answer options">
            {q.options.map((o, i) => <Tile key={o.id} o={o} i={i} reveal={q.phase === 'reveal'} />)}
          </ol>
        )}
        {r && (
          <div className="pop panel border-ok px-[1.2vw] py-[0.8vw]" role="status" aria-live="polite">
            <p className="text-[0.75em] font-bold uppercase tracking-widest text-muted">Correct answer</p>
            <p className="text-[1.7em] font-black leading-tight text-ok">{r.correctText}</p>
            <div className="mt-[0.3vw] flex flex-wrap gap-x-[2vw] gap-y-1 text-[0.95em] font-bold">
              <span className="text-muted">{r.correctCount} of {r.answered} answering teams got it right</span>
              {r.fastest && <span>⚡ Fastest finger: <span className="text-neon">{r.fastest.name}</span>{r.fastest.bonus > 0 && ` (+${r.fastest.bonus})`}</span>}
              {r.steal && <span>🦹 {r.steal.thief} stole {r.steal.points} from {r.steal.victim}!</span>}
              {r.eliminated.length > 0 && <span className="text-bad">💔 Eliminated: {r.eliminated.join(', ')}</span>}
            </div>
          </div>
        )}
      </section>
      <section className="flex flex-col gap-[0.6vw]">
        <h2 className="text-[1.3em] font-black">{round.kind === 'showdown' ? 'Who is still standing?' : 'Leaderboard'}</h2>
        {pub.scoresHidden && <p className="rounded-lg border border-warn px-3 py-2 text-warn">Scores are hidden until the round ends.</p>}
        {split ? (
          <div className="grid grid-cols-1 gap-[0.8vw] min-[1100px]:grid-cols-2">
            <Leaderboard dense hideOffline rows={rows.slice(0, half)} hidden={pub.scoresHidden} />
            <Leaderboard dense hideOffline rows={rows.slice(half)} hidden={pub.scoresHidden} />
          </div>
        ) : (
          <Leaderboard big hideOffline rows={rows} hidden={pub.scoresHidden} provisional={pub.provisional} />
        )}
        {pub.recent.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-[0.85em]" aria-label="Recent score changes">
            {pub.recent.slice(0, 3).map((c) => (
              <li key={c.id} className="flex justify-between gap-3"><span className="truncate">{c.teamName}</span><span className={`tnum font-black ${c.points >= 0 ? 'text-ok' : 'text-bad'}`}>{c.points >= 0 ? '▲ +' : '▼ '}{c.points}</span></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

