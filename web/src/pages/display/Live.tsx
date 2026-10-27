import { useMemo, type CSSProperties } from 'react';
import type { LeaderboardRow, LiveOption, LivePublic, PublicState } from '../../../../shared/types';
import { playingRows } from '../../components/ui';
import { FaceImage } from '../../components/FaceImage';
import { BingoBoard } from '../../components/BingoCard';
import { Scoreboard, type RowNote } from './Scoreboard';

// The same colours and shapes the teams see on their phones, so "the blue triangle" means the same thing in the room.
const TILE = [
  { c: '#38bdf8', bg: '#0c2a3d' },
  { c: '#f472b6', bg: '#3b0f2a' },
  { c: '#fbbf24', bg: '#3b2a05' },
  { c: '#4ade80', bg: '#0b2e1a' },
];
const SHAPE = ['▲', '◆', '●', '■'];

const css = (v: Record<string, string | number>) => v as CSSProperties;

/** Longer questions get a smaller (still large) type size so they always fit above the answers. */
const promptSize = (s: string) => (s.length <= 45 ? 'xl' : s.length <= 85 ? 'l' : s.length <= 140 ? 'm' : 's');

function Ring({ q, now, paused }: { q: LivePublic; now: number; paused: boolean }) {
  const left = paused || q.phaseEndsAt === null ? q.phaseRemainingMs : Math.max(0, q.phaseEndsAt - now);
  const frac = Math.max(0, Math.min(1, left / q.phaseTotalMs));
  const R = 54;
  const C = 2 * Math.PI * R;
  const urgent = q.phase === 'open' && left < 5000 && !paused;
  return (
    <div role="timer" aria-label={`${Math.ceil(left / 1000)} seconds left`} className="pj-ring">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r={R} fill="none" stroke="rgb(44 56 112)" strokeWidth="10" />
        <circle cx="60" cy="60" r={R} fill="none" stroke={urgent ? '#fb7185' : paused ? '#fbbf24' : 'var(--accent)'} strokeWidth="10" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} style={{ transition: 'stroke-dashoffset .3s linear' }} />
      </svg>
      <span className={urgent ? 'urgent text-bad' : ''}>{Math.ceil(left / 1000)}</span>
    </div>
  );
}

function Tile({ o, i, reveal, answered }: { o: LiveOption; i: number; reveal: boolean; answered: number }) {
  const dim = reveal && !o.correct;
  const n = o.count ?? 0;
  const pct = answered > 0 ? Math.round((100 * n) / answered) : 0;
  return (
    <li
      style={css({ '--tc': TILE[i % 4]!.c, '--tb': TILE[i % 4]!.bg, '--pct': `${pct}%`, animationDelay: `${i * 90}ms` })}
      data-dim={dim || undefined}
      data-correct={(reveal && o.correct) || undefined}
      className={`pj-opt tile-in ${dim ? 'tile-wrong' : ''} ${reveal && o.correct ? 'tile-correct' : ''}`}
    >
      {reveal && <span className="pj-opt-bar" aria-hidden="true" />}
      <span className="pj-opt-key"><i aria-hidden="true">{SHAPE[i % 4]}</i>{o.id.toUpperCase()}</span>
      <span className="pj-opt-text">{o.text}</span>
      {reveal && (
        <span className="pj-opt-count">
          {o.correct && <span className="text-ok" aria-label="correct answer">✔</span>}
          <span className="tnum" aria-label={`${n} teams chose this`}>{n}</span>
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
  const playing: LeaderboardRow[] = playingRows(pub.leaderboard, round);
  const isBingo = round.kind === 'bingo' && !!q.bingo;
  const calling = isBingo && r && !r.voided ? (q.bingo!.called.at(-1) ?? null) : null;

  const locked = useMemo(() => new Set(q.lockedTeamIds), [q.lockedTeamIds]);
  const gains = useMemo(() => new Map((r?.gains ?? []).map((g) => [g.teamId, g.points])), [r?.gains]);
  // Each row of the scoreboard says who is still thinking while the question is open, and what each team scored once it is revealed.
  const note: RowNote = !r ? { kind: 'locks', locked } : r.voided ? { kind: 'none' } : pub.scoresHidden ? { kind: 'locks', locked, closed: true } : { kind: 'gains', locked, gains };

  const tight = isBingo || !!q.image; // these layouts also hold a picture or the bingo board, so the question gets a little less room
  const meta = (
    <div className="pj-q-meta">
      <span><b>{isBingo ? 'Call' : 'Question'} {q.index + 1}</b> of {q.total}</span>
      <span>{q.points} pts</span>
      <h2 className={round.kind === 'faces' || round.kind === 'bingo' ? 'sr-only' : 'pj-q-topic'}>{q.title}</h2>
      {paused ? <span className="pj-chip pj-chip-paused">⏸ PAUSED by the host</span> : q.phase === 'open' ? <span className="pj-chip pj-chip-open">● Answer now</span> : <span className="pj-chip pj-chip-reveal">{r?.voided ? 'Question skipped' : 'Reveal'}</span>}
    </div>
  );
  const question = (
    <article key={q.index} className="panel glow pop pj-q">
      <div className="pj-q-main">
        {meta}
        <p className="pj-q-text" data-size={promptSize(q.prompt)} data-tight={tight}>{isBingo && <span aria-hidden="true">📣 </span>}{q.prompt}</p>
      </div>
      <Ring q={q} now={now} paused={paused} />
    </article>
  );
  const options = q.options.length > 0 && (
    <ol className="pj-opts" data-cols={q.image ? 1 : 2} aria-label="Answer options">
      {q.options.map((o, i) => <Tile key={o.id} o={o} i={i} reveal={q.phase === 'reveal'} answered={r?.answered ?? 0} />)}
    </ol>
  );

  const line = isBingo && q.bingo!.teamsWithLine > 0 && (
    <span className="font-bold text-[var(--accent2)]">🎯 {q.bingo!.teamsWithLine} team{q.bingo!.teamsWithLine === 1 ? '' : 's'} with a line</span>
  );
  const status = r ? (
    <div className="res-correct panel border-ok pj-reveal" role="status" aria-live="polite">
      {q.image ? (
        <p className="sr-only">Correct answer: {r.correctText}</p> // the highlighted option and the photo's name tag already show it
      ) : (
        <>
          <p className="pj-reveal-label">{isBingo ? 'The tile was' : 'Correct answer'}</p>
          <p className="pj-reveal-answer">{r.correctText}</p>
        </>
      )}
      {r.fact && <p className="pj-reveal-fact"><span aria-hidden="true">💡 </span>{r.fact}</p>}
      <div className="pj-reveal-stats">
        <span className="text-muted">{r.correctCount} of {r.answered} answering teams got it right</span>
        {r.fastest && <span>⚡ Fastest finger: <span className="text-neon">{r.fastest.name}</span>{r.fastest.bonus > 0 && ` (+${r.fastest.bonus})`}</span>}
        {r.steal && <span>🦹 {r.steal.thief} stole {r.steal.points} from {r.steal.victim}!</span>}
        {r.eliminated.length > 0 && <span className="text-bad">💔 Eliminated: {r.eliminated.join(', ')}</span>}
        {line}
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
  ) : (
    <div className="panel pj-lock">
      <span className="pj-lock-count"><span className="tnum">{q.answered}</span> <span>/ {q.eligible}</span></span>
      <span className="pj-lock-label">teams locked in</span>
      <span className="pj-meter" aria-hidden="true"><i style={css({ '--pct': `${q.eligible > 0 ? Math.min(100, (100 * q.answered) / q.eligible) : 0}%` })} /></span>
      {line}
    </div>
  );

  return (
    <div className="pj-body pj-cols">
      <section className="pj-col" aria-label="Live question">
        {question}
        {q.image ? (
          <div className="pj-split">
            <div className="pj-photo-col">
              <figure key={q.index} className="photo-frame pop pj-photo">
                <FaceImage src={q.image} />
                {r && !r.voided && <figcaption className="name-tag">{r.correctText}</figcaption>}
              </figure>
              <p className="pj-credit">Photos: Wikimedia Commons (CC BY / CC BY-SA / public domain), see faces/CREDITS.txt</p>
            </div>
            {options}
          </div>
        ) : (
          <>
            {isBingo && <BingoBoard bingo={q.bingo!} current={calling} />}
            {options}
          </>
        )}
        {status}
      </section>
      <Scoreboard
        rows={playing}
        title={round.kind === 'showdown' ? 'Who is still standing?' : 'Leaderboard'}
        hidden={pub.scoresHidden}
        provisional={pub.provisional}
        note={note}
      />
    </div>
  );
}
