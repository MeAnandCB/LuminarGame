import type { LeaderboardRow, LiveOption, LivePublic, PublicState } from '../../../../shared/types';
import { Leaderboard } from '../../components/ui';
import { Emblem, LEVELS } from '../../components/Backdrop';
import { FaceImage } from '../../components/FaceImage';
import { BingoBoard } from '../../components/BingoCard';

const TILE = ['border-[#38bdf8] bg-[#0c2a3d]', 'border-[#f472b6] bg-[#3b0f2a]', 'border-[#fbbf24] bg-[#3b2a05]', 'border-[#4ade80] bg-[#0b2e1a]'];
const SHAPE = ['▲', '◆', '●', '■'];

function Ring({ q, now, paused }: { q: LivePublic; now: number; paused: boolean }) {
  const left = paused || q.phaseEndsAt === null ? q.phaseRemainingMs : Math.max(0, q.phaseEndsAt - now);
  const frac = Math.max(0, Math.min(1, left / q.phaseTotalMs));
  const R = 54;
  const C = 2 * Math.PI * R;
  const urgent = q.phase === 'open' && left < 5000 && !paused;
  return (
    <div role="timer" aria-label={`${Math.ceil(left / 1000)} seconds left`} className="relative grid h-[clamp(5.5rem,8vw,10rem)] w-[clamp(5.5rem,8vw,10rem)] shrink-0 place-items-center">
      <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={R} fill="none" stroke="rgb(44 56 112)" strokeWidth="9" />
        <circle cx="60" cy="60" r={R} fill="none" stroke={urgent ? '#fb7185' : paused ? '#fbbf24' : 'var(--accent)'} strokeWidth="9" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} style={{ transition: 'stroke-dashoffset .3s linear' }} />
      </svg>
      <span className={`mono text-[clamp(1.5rem,3vw,3.8rem)] font-black ${urgent ? 'urgent text-bad' : ''}`}>{Math.ceil(left / 1000)}</span>
    </div>
  );
}

function Tile({ o, i, reveal, compact }: { o: LiveOption; i: number; reveal: boolean; compact?: boolean }) {
  const dim = reveal && !o.correct;
  return (
    <li style={{ animationDelay: `${i * 90}ms` }} className={`tile-in relative flex items-center gap-[1vw] overflow-hidden rounded-2xl border-2 px-[1vw] ${compact ? 'py-[0.3vw]' : 'py-[0.6vw]'} ${TILE[i % 4]} ${dim ? 'tile-wrong opacity-40' : ''} ${reveal && o.correct ? 'tile-correct !border-ok' : ''}`}>
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
  const isBingo = round.kind === 'bingo' && !!q.bingo;
  const calling = isBingo && r && !r.voided ? (q.bingo!.called.at(-1) ?? null) : null;

  const tight = isBingo || !!q.image; // these layouts also hold a picture or the bingo board, so everything is a little tighter
  const question = (
    <article key={q.index} className={`panel glow pop ${tight ? 'p-[0.9vw]' : 'p-[1.2vw]'}`}>
      <h2 className="text-[0.9em] font-bold uppercase tracking-widest text-muted">{q.title} · {q.points} pts</h2>
      <p className={`mt-[0.3vw] font-black leading-tight ${isBingo ? 'text-[clamp(1.2rem,2.3vw,2.9rem)]' : q.image ? 'text-[clamp(1.2rem,2vw,2.4rem)]' : 'text-[clamp(1.2rem,2.3vw,2.9rem)]'}`}>{isBingo && <span aria-hidden="true">📣 </span>}{q.prompt}</p>
    </article>
  );
  const options = q.options.length > 0 && (
    <ol className={`grid grid-cols-1 gap-[0.6vw] ${q.image ? '' : 'sm:grid-cols-2'}`} aria-label="Answer options">
      {q.options.map((o, i) => <Tile key={o.id} o={o} i={i} reveal={q.phase === 'reveal'} compact={tight} />)}
    </ol>
  );
  const revealBox = r && (
    <div className={`res-correct panel border-ok px-[1.2vw] ${tight ? 'py-[0.5vw]' : 'py-[0.8vw]'}`} role="status" aria-live="polite">
      {q.image ? (
        <p className="sr-only">Correct answer: {r.correctText}</p> // the highlighted option and the photo's name tag already show it
      ) : (
        <>
          <p className="text-[0.75em] font-bold uppercase tracking-widest text-muted">{isBingo ? 'The tile was' : 'Correct answer'}</p>
          <p className={`font-black leading-tight text-ok ${tight ? 'text-[1.4em]' : 'text-[1.7em]'}`}>{r.correctText}</p>
        </>
      )}
      {r.fact && <p className="mt-[0.2vw] text-[0.95em] leading-snug"><span aria-hidden="true">💡 </span>{r.fact}</p>}
      <div className="mt-[0.3vw] flex flex-wrap gap-x-[2vw] gap-y-1 text-[0.95em] font-bold">
        <span className="text-muted">{r.correctCount} of {r.answered} answering teams got it right</span>
        {r.fastest && <span>⚡ Fastest finger: <span className="text-neon">{r.fastest.name}</span>{r.fastest.bonus > 0 && ` (+${r.fastest.bonus})`}</span>}
        {r.steal && <span>🦹 {r.steal.thief} stole {r.steal.points} from {r.steal.victim}!</span>}
        {r.eliminated.length > 0 && <span className="text-bad">💔 Eliminated: {r.eliminated.join(', ')}</span>}
      </div>
      {r.bingos.length > 0 && (
        <ul className="mt-[0.5vw] flex flex-wrap gap-[0.6vw]" aria-label="Teams that scored a bingo">
          {r.bingos.map((b) => (
            <li key={b.name} className="bingo-shout joined rounded-xl border-2 border-[var(--accent2)] px-[0.9vw] py-[0.3vw] text-[1.15em] font-black text-[var(--accent2)]">
              {b.blackout ? '🏆 BLACKOUT!' : '🎉 BINGO!'} {b.name}{!b.blackout && b.lines > 1 ? ` (${b.lines} lines)` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="grid flex-1 grid-cols-1 gap-[1.4vw] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <section className="flex flex-col gap-[0.9vw]" aria-label="Live question">
        <div className="flex items-center gap-[1.2vw]">
          <Ring q={q} now={now} paused={paused} />
          <div className="min-w-0 flex-1">
            <p className="text-[0.8em] font-bold uppercase tracking-[0.25em] text-[var(--accent)]">
              <Emblem level={round.level} />Level {round.level} · {LEVELS[round.level]?.name ?? 'Live'} · {isBingo ? 'Call' : 'Question'} {q.index + 1}/{q.total}
            </p>
            <p className="text-[0.95em] text-muted">
              {paused ? '⏸ PAUSED by the host' : q.phase === 'open' ? `${q.answered} of ${q.eligible} teams locked in` : r?.voided ? 'Question skipped' : 'Reveal'}
              {isBingo && q.bingo!.teamsWithLine > 0 && <span className="ml-[1vw] font-bold text-[var(--accent2)]">🎯 {q.bingo!.teamsWithLine} team{q.bingo!.teamsWithLine === 1 ? '' : 's'} with a line</span>}
            </p>
          </div>
        </div>
        {q.image ? (
          <div className="grid gap-[1.2vw] sm:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <figure key={q.index} className="photo-frame pop relative self-start">
              <FaceImage src={q.image} className="aspect-[4/5] max-h-[62vh] w-full" />
              {r && !r.voided && <figcaption className="name-tag">{r.correctText}</figcaption>}
              <p className="mt-[0.3vw] text-center text-[0.55em] text-muted">Photos: Wikimedia Commons (CC BY / CC BY-SA / public domain), see faces/CREDITS.txt</p>
            </figure>
            <div className="flex flex-col gap-[0.8vw]">
              {question}
              {options}
              {revealBox}
            </div>
          </div>
        ) : (
          <>
            {question}
            {isBingo && <BingoBoard bingo={q.bingo!} current={calling} />}
            {options}
            {revealBox}
          </>
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
              <li key={c.id} className="slide-in flex justify-between gap-3"><span className="truncate">{c.teamName}</span><span className={`tnum font-black ${c.points >= 0 ? 'text-ok' : 'text-bad'}`}>{c.points >= 0 ? '▲ +' : '▼ '}{c.points}</span></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

