import { useEffect, useMemo, useState } from 'react';
import type { LeaderboardRow, PublicState } from '../../../shared/types';
import { fmtClock, remaining, useLive, useServerNow } from '../lib/realtime';
import { useOfflineTeams } from '../lib/offlineTeams';
import { ConnBadge, Leaderboard, OfflineTeamsContext, QrImage, Spinner } from '../components/ui';
import { LiveView } from './display/Live';
import { Backdrop, Emblem, FINALE_LEVEL, LEVELS, LevelIntro, skinOf, themeFor } from '../components/Backdrop';

/** "A · B · C · D · +16 more": the first few names, then a count, so the line stays short. */
function offlineLabel(names: string[], shown = 4): string {
  return names.length <= shown ? names.join(' · ') : `${names.slice(0, shown).join(' · ')} · +${names.length - shown} more`;
}

export function DisplayApp() {
  const live = useLive('display');
  const now = useServerNow(live.offset);
  const pub = live.pub;
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  useEffect(() => {
    if (!live.announcement) return;
    setToast({ text: live.announcement.text, n: live.announcement.n });
    const id = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(id);
  }, [live.announcement]);

  const st = pub?.event?.state;
  // From the lobby until the event is over every team is expected to stay connected; the room sees who dropped off.
  const roster = useMemo(() => pub?.leaderboard.map((r) => ({ id: r.teamId, name: r.name, connected: r.connected })) ?? null, [pub?.leaderboard]);
  const offline = useOfflineTeams(roster, st === 'LOBBY' || st === 'ROUND_READY' || st === 'ROUND_RUNNING' || st === 'ROUND_PAUSED' || st === 'ROUND_ENDED' || st === 'QUALIFICATION', () => undefined);
  const offlineIds = useMemo(() => new Set(offline.map((t) => t.id)), [offline]);
  const inRound = st === 'ROUND_READY' || st === 'ROUND_RUNNING' || st === 'ROUND_PAUSED' || st === 'ROUND_ENDED';
  const level = st === 'QUALIFICATION' || st === 'EVENT_COMPLETED' ? FINALE_LEVEL : pub?.round?.level;
  const theme = themeFor(st, inRound ? level : undefined);
  return (
    <OfflineTeamsContext.Provider value={offlineIds}>
    <Backdrop theme={theme} />
    <LevelIntro level={inRound ? level : undefined} reset={st === 'SETUP' || st === 'REGISTRATION_OPEN' || st === 'LOBBY' || !st} />
    <main data-level={skinOf(level)} className="stage flex min-h-screen flex-col gap-[1.2vw] p-[1.6vw] text-[clamp(14px,1.45vw,30px)]">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="logo-b grid h-[3.2vw] w-[3.2vw] min-h-10 min-w-10 place-items-center rounded-xl bg-panel2 text-[1.8vw] font-black text-neon">B</span>
          <h1 className="text-[clamp(1.1rem,2.3vw,2.8rem)] font-black tracking-wide">{pub?.event?.name ?? 'BRAINBYTE ARENA'}</h1>
        </div>
        {offline.length > 0 && (
          // One line in the header's free middle: it can never push the page taller, however many teams are offline.
          <section aria-label="Offline teams" aria-live="assertive" data-testid="offline-strip" className="pulse flex min-w-0 flex-1 items-center gap-[0.8vw] overflow-hidden rounded-2xl border-2 border-bad bg-[#3b0a1c] px-[1.2vw] py-[0.35vw] text-[#ffd5dc]">
            <strong className="shrink-0 text-[1.1em]"><span aria-hidden="true">⚠ </span>OFFLINE</strong>
            <span className="truncate text-[1.1em] font-bold">{offlineLabel(offline.map((t) => t.name))}</span>
          </section>
        )}
        <div className="flex items-center gap-4">
          {pub?.event && pub.event.state !== 'SETUP' && (
            <div className="text-right">
              <div className="text-[0.55em] font-bold uppercase tracking-widest text-muted">Room PIN</div>
              <div className="mono text-[1.6em] font-black leading-none tracking-[0.2em] text-neon">{pub.event.pin}</div>
            </div>
          )}
          <ConnBadge status={live.status} />
        </div>
      </header>

      {toast && (
        <div key={toast.n} role="status" aria-live="assertive" className="pop pulse fixed bottom-[3vw] left-1/2 z-20 w-[min(90vw,70rem)] -translate-x-1/2 rounded-2xl border-2 border-neon bg-panel px-8 py-5 text-center text-[2em] font-black text-neon">
          📣 {toast.text}
        </div>
      )}

      {!pub ? <Spinner label="Connecting to the arena" /> : !pub.event ? <Message title="Waiting for the host" body="The event has not been created yet." /> : <Body pub={pub} now={now} />}
    </main>
    </OfflineTeamsContext.Provider>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <section className="panel m-auto max-w-4xl p-[3vw] text-center">
      <h2 className="text-[2.4em] font-black">{title}</h2>
      <p className="mt-3 text-[1.2em] text-muted">{body}</p>
    </section>
  );
}

function Body({ pub, now }: { pub: PublicState; now: number }) {
  const ev = pub.event!;
  const round = pub.round;
  switch (ev.state) {
    case 'SETUP':
      return <Message title="Get ready…" body="The host is setting up the arena. Registration opens soon." />;
    case 'REGISTRATION_OPEN':
      return <Registration pub={pub} />;
    case 'LOBBY':
      return <Lobby pub={pub} />;
    case 'QUALIFICATION':
      return <Qualification pub={pub} />;
    case 'EVENT_COMPLETED':
      return <Champions pub={pub} />;
    default:
      if (!round) return <Message title="Stand by" body="" />;
      if (pub.live && (ev.state === 'ROUND_RUNNING' || ev.state === 'ROUND_PAUSED')) return <LiveView pub={pub} now={now} />;
      return <RoundView pub={pub} now={now} />;
  }
}

function Slots({ pub }: { pub: PublicState }) {
  const rows = [...pub.leaderboard].sort((a, b) => a.name.localeCompare(b.name));
  const slots = Array.from({ length: pub.counts.capacity }, (_, i) => rows[i] ?? null);
  return (
    <ul className="grid grid-cols-2 gap-[0.5vw] lg:grid-cols-4" aria-label="Team slots">
      {slots.map((r, i) => (
        <li key={i} className={`${r ? 'joined' : ''} flex items-center gap-2 rounded-xl border px-3 py-[0.5vw] ${r ? 'border-neon/60 bg-panel2' : 'border-dashed border-line text-muted'}`}>
          <span className="mono text-[0.7em] text-muted">{String(i + 1).padStart(2, '0')}</span>
          <span className="truncate font-semibold">{r ? r.name : 'open slot'}</span>
          {r && <span aria-label={r.connected ? 'connected' : 'offline'} className={`ml-auto text-[0.8em] ${r.connected ? 'beat text-ok' : 'text-warn'}`}>{r.connected ? '●' : '◌'}</span>}
        </li>
      ))}
    </ul>
  );
}

function Registration({ pub }: { pub: PublicState }) {
  const ev = pub.event!;
  return (
    <div className="grid flex-1 grid-cols-1 items-center gap-[2vw] lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section className="panel flex flex-col items-center gap-[1vw] p-[2vw] text-center">
        <h2 className="text-[1.8em] font-black">Scan to join</h2>
        <div className="qr-frame"><QrImage text={ev.joinUrl} size={320} label={`QR code to join at ${ev.joinUrl}`} /></div>
        <p className="text-muted">or open</p>
        <p className="mono break-all text-[1em] font-bold text-neon">{ev.joinUrl.replace(/\/join\?pin=\d+$/, '')}</p>
        <p className="text-[0.8em] text-muted">and enter room PIN</p>
        <p className="mono text-[4em] font-black leading-none tracking-[0.15em] text-neon">{ev.pin}</p>
      </section>
      <section className="flex flex-col gap-[1vw]">
        <h2 className="text-[2em] font-black">Teams <span className="tnum text-neon">{pub.counts.teams}</span> <span className="text-muted">/ {pub.counts.capacity}</span></h2>
        <Slots pub={pub} />
      </section>
    </div>
  );
}

function Lobby({ pub }: { pub: PublicState }) {
  return (
    <div className="flex flex-1 flex-col gap-[1.5vw]">
      <section className="panel p-[2vw] text-center">
        <h2 className="pulse text-[3em] font-black text-neon">Registration closed</h2>
        <p className="mt-2 text-[1.3em]">{pub.counts.teams} teams · {pub.counts.connected} connected · Level 1 starts soon<span className="float-dots" aria-hidden="true" /></p>
      </section>
      <Slots pub={pub} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="panel px-[1vw] py-[0.5vw] text-center">
      <div className="tnum text-[1.9em] font-black leading-none">{value}</div>
      <div className="mt-1 text-[0.7em] font-bold uppercase tracking-widest text-muted">{label}</div>
    </div>
  );
}

function BoardColumns({ rows, pub, showProgress, dense }: { rows: LeaderboardRow[]; pub: PublicState; showProgress?: boolean; dense?: boolean }) {
  const split = rows.length > 10;
  const half = Math.ceil(rows.length / 2);
  return split ? (
    <div className="grid grid-cols-1 gap-[1vw] min-[1100px]:grid-cols-2">
      <Leaderboard big={!dense} dense={dense} hideOffline rows={rows.slice(0, half)} hidden={pub.scoresHidden} showProgress={showProgress} />
      <Leaderboard big={!dense} dense={dense} hideOffline rows={rows.slice(half)} hidden={pub.scoresHidden} showProgress={showProgress} provisional={pub.provisional} />
    </div>
  ) : (
    <Leaderboard big={!dense} dense={dense} hideOffline rows={rows} hidden={pub.scoresHidden} showProgress={showProgress} provisional={pub.provisional} />
  );
}

function RoundView({ pub, now }: { pub: PublicState; now: number }) {
  const round = pub.round!;
  const state = pub.event!.state;
  const left = remaining(round, now);
  const ready = state === 'ROUND_READY';
  const paused = state === 'ROUND_PAUSED';
  const ended = state === 'ROUND_ENDED';
  const unit = 'questions';
  const eligible = round.kind === 'showdown' ? pub.leaderboard.filter((r) => r.qualified) : pub.leaderboard;
  return (
    <div className="grid flex-1 grid-cols-1 gap-[1.6vw] lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
      <section className="flex flex-col gap-[0.8vw]">
        <div className="panel glow p-[1.6vw]">
          <p className="text-[0.8em] font-bold uppercase tracking-[0.25em] text-[var(--accent)]"><Emblem level={round.level} />Level {round.level}</p>
          {LEVELS[round.level] && <p className="text-[0.8em] italic text-muted">{LEVELS[round.level]!.tag}</p>}
          <h2 className="text-[1.9em] font-black leading-tight">{round.name.replace(/^Level \d - /, '')}</h2>
          <div role="timer" aria-label={`Time remaining ${fmtClock(left)}`} className={`mono my-[0.5vw] text-[clamp(3.5rem,7vw,9rem)] font-black leading-none ${paused ? 'text-warn' : left < 30000 && state === 'ROUND_RUNNING' ? 'urgent text-bad' : 'text-[var(--accent)]'}`}>
            {ready ? fmtClock(round.durationMs) : ended ? '0:00' : fmtClock(left)}
          </div>
          <p className="text-[1.05em] font-semibold">
            {ready && 'Get ready – waiting for the host to start'}
            {state === 'ROUND_RUNNING' && 'Round in progress'}
            {paused && '⏸ PAUSED by the host'}
            {ended && "🏁 Time's up – round complete"}
          </p>
        </div>
        <p className="panel p-[1vw] text-[0.8em] leading-snug text-muted">{round.instructions}</p>
        <div className="grid grid-cols-1 gap-[0.8vw] sm:grid-cols-3">
          <Stat label="Teams online" value={`${pub.counts.connected}/${eligible.length}`} />
          <Stat label="Answers in" value={pub.counts.submissions} />
          <Stat label={`Finished all ${round.total} ${unit}`} value={pub.counts.finished} />
        </div>
        {pub.recent.length > 0 && (
          <div className="panel p-[1vw]" aria-live="polite">
            <h3 className="mb-1 text-[0.75em] font-bold uppercase tracking-widest text-muted">Recent scores</h3>
            <ul className="space-y-1">
              {pub.recent.slice(0, 3).map((c) => (
                <li key={c.id} className="slide-in flex justify-between gap-3 text-[0.9em]">
                  <span className="truncate">{c.teamName}</span>
                  <span className={`tnum font-black ${c.points >= 0 ? 'text-ok' : 'text-bad'}`}>{c.points >= 0 ? '▲ +' : '▼ '}{c.points}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      <section className="flex flex-col gap-[1vw]">
        <h2 className="text-[1.5em] font-black">{pub.provisional ? 'Live leaderboard' : ended ? 'Round standings' : 'Leaderboard'}</h2>
        {pub.scoresHidden && <p className="rounded-lg border border-warn px-3 py-2 text-warn">Scores are hidden until the round ends.</p>}
        <BoardColumns rows={round.kind === 'showdown' ? pub.leaderboard.filter((r) => r.qualified !== false) : pub.leaderboard} pub={pub} showProgress={!ended} />
        {ended && pub.reveal && (
          <div className="panel p-[1.2vw]">
            <h3 className="mb-2 text-[1.1em] font-black text-[var(--accent)]">Answer key</h3>
            <ol className="grid grid-cols-1 gap-x-6 gap-y-1 text-[0.8em] sm:grid-cols-2">
              {pub.reveal.map((r) => (
                <li key={r.position} className="flex gap-2"><span className="text-muted">{r.position + 1}.</span><span className="truncate">{r.title}:</span><strong className="mono">{r.answer}</strong></li>
              ))}
            </ol>
          </div>
        )}
      </section>
    </div>
  );
}

function Qualification({ pub }: { pub: PublicState }) {
  return (
    <div className="grid flex-1 grid-cols-1 gap-[2vw] lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section className="panel glow p-[2vw]" data-level="3">
        <h2 className="text-[2.4em] font-black text-[var(--accent)]"><Emblem level={FINALE_LEVEL} />Finalists</h2>
        <p className="text-muted">These teams advance to the Final Showdown</p>
        <ol className="mt-[1vw] space-y-[0.7vw]">
          {pub.finalists.map((f, i) => (
            <li key={f.teamId} className="joined flex items-center gap-4 rounded-xl border border-ok/60 bg-[#052e16] px-[1.2vw] py-[0.8vw] text-[1.5em] font-black" style={{ animationDelay: `${i * 350}ms` }}>
              <span className="tnum text-ok">{i + 1}</span>
              <span className="truncate">{f.name}</span>
              <span aria-hidden="true" className="ml-auto">✔</span>
            </li>
          ))}
        </ol>
      </section>
      <section>
        <h2 className="mb-2 text-[1.5em] font-black">Standings after Level {Math.max(1, (pub.round?.level ?? 4))}</h2>
        <BoardColumns rows={pub.leaderboard} pub={pub} />
      </section>
    </div>
  );
}

function Champions({ pub }: { pub: PublicState }) {
  const podium = pub.podium ?? [];
  const order = [podium[1], podium[0], podium[2]].filter(Boolean) as LeaderboardRow[];
  const height: Record<number, string> = { 1: 'h-[11vw]', 2: 'h-[8vw]', 3: 'h-[6vw]' };
  // 3rd place rises first, then 2nd, then 1st; the champion name lands last.
  const delay: Record<number, string> = { 3: '0.4s', 2: '1.4s', 1: '2.4s' };
  const medal = ['🥇', '🥈', '🥉'];
  return (
    <div className="flex flex-1 flex-col gap-[1.5vw]" data-level="3">
      <section className="text-center">
        <p className="text-[0.9em] font-bold uppercase tracking-[0.4em] text-muted"><span className="crown" aria-hidden="true">👑</span> Champion</p>
        <h2 className="champ-reveal shimmer-gold mx-auto mt-1 inline-block px-8 py-2 text-[clamp(2rem,4.5vw,5.5rem)] font-black leading-tight">{podium[0]?.name ?? '—'}</h2>
      </section>
      <ol className="mx-auto flex w-full max-w-6xl items-end justify-center gap-[1.5vw]" aria-label="Podium">
        {order.map((r) => (
          <li key={r.teamId} className="flex w-1/3 flex-col items-center">
            <div className="podium-name mb-2 text-center" style={{ animationDelay: delay[r.rank] ?? '0s' }}>
              <div className="text-[2em]" aria-hidden="true">{medal[r.rank - 1]}</div>
              <div className="text-[1.4em] font-black"><span className="sr-only">Place {r.rank}: </span>{r.name}</div>
              <div className="tnum text-[1.3em] font-bold text-neon">{r.total} pts</div>
            </div>
            <div className={`podium-rise w-full rounded-t-2xl border border-[var(--accent)] ${r.rank === 1 ? 'bg-gradient-to-b from-amber-400/70 to-panel' : 'bg-gradient-to-b from-violet-strong/70 to-panel'} ${height[r.rank]}`} style={{ animationDelay: delay[r.rank] ?? '0s' }}>
              <div className="pt-1 text-center text-[2.4em] font-black leading-none text-white/90">{r.rank}</div>
            </div>
          </li>
        ))}
      </ol>
      <section className="panel p-[1.2vw]">
        <h3 className="mb-1 text-[1.1em] font-black">Final standings</h3>
        <BoardColumns rows={pub.leaderboard} pub={pub} dense />
      </section>
    </div>
  );
}
