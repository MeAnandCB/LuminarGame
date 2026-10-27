import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { LeaderboardRow, PublicState } from '../../../shared/types';
import { fmtClock, remaining, useLive, useServerNow } from '../lib/realtime';
import { useOfflineTeams } from '../lib/offlineTeams';
import { ConnBadge, OfflineTeamsContext, QrImage, Spinner, playingRows } from '../components/ui';
import { LiveView } from './display/Live';
import { Scoreboard } from './display/Scoreboard';
import { BilingualRules } from '../components/Rules';
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
    <main data-level={skinOf(level)} className="stage pj">
      <header className="pj-head">
        <span aria-hidden="true" className="logo-b pj-logo">B</span>
        <h1 className="pj-title">{pub?.event?.name ?? 'BRAINBYTE ARENA'}</h1>
        {inRound && level && LEVELS[level] && <span className="pj-level"><span aria-hidden="true">{LEVELS[level]!.icon}</span> Level {level} · {LEVELS[level]!.name}</span>}
        {offline.length > 0 ? (
          // One line in the header's free middle: it can never push the page taller, however many teams are offline.
          <section aria-label="Offline teams" aria-live="assertive" data-testid="offline-strip" className="pulse flex min-w-0 flex-1 items-center gap-[0.8vw] overflow-hidden rounded-2xl border-2 border-bad bg-[#3b0a1c] px-[1.2vw] py-[0.35vw] text-[#ffd5dc]">
            <strong className="shrink-0 text-[1.1em]"><span aria-hidden="true">⚠ </span>OFFLINE</strong>
            <span className="truncate text-[1.1em] font-bold">{offlineLabel(offline.map((t) => t.name))}</span>
          </section>
        ) : (
          <span className="flex-1" />
        )}
        <div className="flex flex-none items-center gap-4">
          {pub?.event && pub.event.state !== 'SETUP' && (
            <div className="pj-pin">
              <small>Room PIN</small>
              <b className="mono">{pub.event.pin}</b>
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
  const total = Math.max(pub.counts.capacity, rows.length);
  // Up to 24 slots keep the roomy 4-column grid; a bigger room switches to 6 compact columns so 60 slots still fit the screen.
  const big = total > 24;
  const slots = Array.from({ length: total }, (_, i) => rows[i] ?? null);
  return (
    <ul className={`grid grid-cols-2 gap-[0.5vw] ${big ? 'text-[0.8em] lg:grid-cols-6' : 'lg:grid-cols-4'}`} aria-label="Team slots">
      {slots.map((r, i) => (
        <li key={i} className={`${r ? 'joined' : ''} flex items-center gap-2 rounded-xl border px-3 ${big ? 'py-[0.3vw]' : 'py-[0.5vw]'} ${r ? 'border-neon/60 bg-panel2' : 'border-dashed border-line text-muted'}`}>
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
    <div className="grid min-h-0 flex-1 grid-cols-1 items-center gap-[2vw] overflow-hidden lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
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
    <div className="flex min-h-0 flex-1 flex-col gap-[1.5vw] overflow-hidden">
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
    <div className="panel pj-stat">
      <b>{value}</b>
      <small>{label}</small>
    </div>
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
  const playing = playingRows(pub.leaderboard, round);
  if (ready) {
    // A game is about to start: the room reads the rules, in English and Malayalam, across the full width. The leaderboard returns with the first question.
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-[1.2vw] overflow-hidden">
        <section className="panel glow flex flex-none flex-wrap items-center justify-between gap-x-[2vw] gap-y-[0.6vw] p-[1vw]">
          <div>
            <p className="text-[0.8em] font-bold uppercase tracking-[0.25em] text-[var(--accent)]"><Emblem level={round.level} />Level {round.level}</p>
            {LEVELS[round.level] && <p className="text-[0.8em] italic text-muted">{LEVELS[round.level]!.tag}</p>}
            <h2 className="text-[1.7em] font-black leading-tight">{round.name.replace(/^Level \d - /, '')}</h2>
          </div>
          <div className="text-right">
            <div role="timer" aria-label={`Time remaining ${fmtClock(left)}`} className="mono text-[calc(var(--u)*5)] font-black leading-none text-[var(--accent)]">{fmtClock(round.durationMs)}</div>
            <p className="text-[1.05em] font-semibold">Get ready – waiting for the host to start</p>
          </div>
        </section>
        <BilingualRules kind={round.kind} wide />
      </div>
    );
  }
  const clock = paused ? 'text-warn' : left < 30000 && state === 'ROUND_RUNNING' ? 'urgent text-bad' : 'text-[var(--accent)]';
  return (
    <div className="pj-body pj-cols pj-cols-wide">
      <section className="pj-col">
        <div className="panel glow pj-hero">
          <p className="pj-q-meta"><span><Emblem level={round.level} /><b>Level {round.level}</b></span>{LEVELS[round.level] && <span className="italic normal-case tracking-normal">{LEVELS[round.level]!.tag}</span>}</p>
          <h2 className="text-[1.7em] font-black leading-tight">{round.name.replace(/^Level \d - /, '')}</h2>
          <div role="timer" aria-label={`Time remaining ${fmtClock(left)}`} className={`pj-hero-clock ${clock}`}>
            {ended ? '0:00' : fmtClock(left)}
          </div>
          <p className="text-[1.15em] font-semibold">
            {state === 'ROUND_RUNNING' && 'Round in progress'}
            {paused && '⏸ PAUSED by the host'}
            {ended && "🏁 Time's up – round complete"}
          </p>
        </div>
        {!ended && (
          <div className="pj-stats">
            <Stat label="Teams online" value={`${playing.filter((r) => r.connected).length}/${playing.length}`} />
            <Stat label="Answers in" value={pub.counts.submissions} />
            <Stat label={`Finished all ${round.total} ${unit}`} value={pub.counts.finished} />
          </div>
        )}
        {ended && pub.cutoff && (
          <div className="panel pop pj-pad border-ok" role="status" data-testid="cutoff-banner">
            <p className="text-[1.5em] font-black text-ok">✔ {pub.cutoff.kept} team{pub.cutoff.kept === 1 ? '' : 's'} move on to Level {pub.cutoff.afterLevel + 1}</p>
            <p className="text-[1em] text-muted">{pub.cutoff.out} team{pub.cutoff.out === 1 ? ' is' : 's are'} out after this round.</p>
          </div>
        )}
        {ended && pub.reveal && (
          <div className="panel pj-pad pj-fill">
            <h3 className="mb-[0.4em] text-[1.2em] font-black text-[var(--accent)]">Answer key</h3>
            <ol className="pj-key">
              {pub.reveal.map((r) => (
                <li key={r.position}><span>{r.position + 1}.</span><span><small>{r.title}</small><strong>{r.answer}</strong></span></li>
              ))}
            </ol>
          </div>
        )}
        {!ended && (
          <div className="panel pj-pad pj-fill">
            {pub.recent.length > 0 && (
              <div aria-live="polite" className="mb-[0.6em]">
                <h3 className="mb-[0.2em] text-[0.75em] font-bold uppercase tracking-widest text-muted">Recent scores</h3>
                <ul className="space-y-[0.15em]">
                  {pub.recent.slice(0, 3).map((c) => (
                    <li key={c.id} className="slide-in flex justify-between gap-3 text-[1em]">
                      <span className="truncate">{c.teamName}</span>
                      <span className={`tnum font-black ${c.points >= 0 ? 'text-ok' : 'text-bad'}`}>{c.points >= 0 ? '▲ +' : '▼ '}{c.points}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[0.8em] leading-snug text-muted">{round.instructions}</p>
          </div>
        )}
      </section>
      <Scoreboard
        rows={ended && pub.cutoff ? pub.leaderboard : playing}
        title={pub.provisional ? 'Live leaderboard' : ended ? 'Round standings' : 'Leaderboard'}
        hidden={pub.scoresHidden}
        provisional={pub.provisional}
        note={{ kind: ended ? 'status' : 'progress' }}
      />
    </div>
  );
}

function Qualification({ pub }: { pub: PublicState }) {
  return (
    <div className="pj-body pj-cols pj-cols-wide">
      <section className="panel glow pj-pad min-h-0 overflow-hidden" data-level="3">
        <h2 className="text-[2em] font-black text-[var(--accent)]"><Emblem level={FINALE_LEVEL} />Finalists</h2>
        <p className="text-muted">These teams advance to the Final Showdown</p>
        <ol className="mt-[0.6em] space-y-[0.4em]">
          {pub.finalists.map((f, i) => (
            <li key={f.teamId} className="joined flex items-center gap-4 rounded-xl border border-ok/60 bg-[#052e16] px-[1.2vw] py-[0.5em] text-[1.4em] font-black" style={{ animationDelay: `${i * 350}ms` }}>
              <span className="tnum text-ok">{i + 1}</span>
              <span className="truncate">{f.name}</span>
              <span aria-hidden="true" className="ml-auto">✔</span>
            </li>
          ))}
        </ol>
      </section>
      <Scoreboard rows={pub.leaderboard} title={`Standings after Level ${Math.max(1, pub.round?.level ?? 4)}`} hidden={pub.scoresHidden} note={{ kind: 'status' }} />
    </div>
  );
}

function Champions({ pub }: { pub: PublicState }) {
  const podium = pub.podium ?? [];
  const order = [podium[1], podium[0], podium[2]].filter(Boolean) as LeaderboardRow[];
  // 3rd place rises first, then 2nd, then 1st; the champion name lands last.
  const delay: Record<number, string> = { 3: '0.4s', 2: '1.4s', 1: '2.4s' };
  const medal = ['🥇', '🥈', '🥉'];
  return (
    <div className="pj-body pj-cols pj-cols-wide" data-level="3">
      <section className="pj-col">
        <div className="flex-none text-center">
          <p className="text-[0.9em] font-bold uppercase tracking-[0.4em] text-muted"><span className="crown" aria-hidden="true">👑</span> Champion</p>
          <h2 className="champ-reveal shimmer-gold mx-auto mt-1 inline-block max-w-full px-[0.5em] py-[0.1em] text-[calc(var(--u)*4.4)] font-black leading-tight">{podium[0]?.name ?? '—'}</h2>
        </div>
        <ol className="pj-podium" aria-label="Podium">
          {order.map((r) => (
            <li key={r.teamId}>
              <div className="podium-name mb-2 flex-none text-center" style={{ animationDelay: delay[r.rank] ?? '0s' }}>
                <div className="text-[1.6em]" aria-hidden="true">{medal[r.rank - 1]}</div>
                <div className="text-[1.3em] font-black"><span className="sr-only">Place {r.rank}: </span>{r.name}</div>
                <div className="tnum text-[1.3em] font-bold text-neon">{r.total} pts</div>
              </div>
              <div className={`podium-rise pj-step ${r.rank === 1 ? 'bg-gradient-to-b from-amber-400/70 to-panel' : 'bg-gradient-to-b from-violet-strong/70 to-panel'}`} style={{ animationDelay: delay[r.rank] ?? '0s', '--h': `${{ 1: 34, 2: 25, 3: 18 }[r.rank] ?? 18}%` } as CSSProperties}>
                <div className="pt-1 text-center text-[2.4em] font-black leading-none text-white/90">{r.rank}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <Scoreboard rows={pub.leaderboard} title="Final standings" note={{ kind: 'none' }} />
    </div>
  );
}
