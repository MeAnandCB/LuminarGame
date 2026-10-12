import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { AdminChallenge, AdminRound, AdminState, AdminTeam, EventSettings, RoundConfig } from '../../../shared/types';
import { ApiFailure, api, errMsg, setCsrf } from '../lib/api';
import { fmtClock, remaining, useLive, useServerNow } from '../lib/realtime';
import { ConnBadge, Empty, ErrorBanner, Leaderboard, QrImage, Spinner, useConfirm } from '../components/ui';
import { FaceImage } from '../components/FaceImage';

export function AdminApp() {
  const [phase, setPhase] = useState<'loading' | 'login' | 'in'>('loading');
  useEffect(() => {
    api<{ csrfToken: string }>('GET', '/admin/me')
      .then((r) => {
        setCsrf(r.csrfToken);
        setPhase('in');
      })
      .catch(() => setPhase('login'));
  }, []);
  if (phase === 'loading') return <Spinner />;
  if (phase === 'login') return <Login onDone={() => setPhase('in')} />;
  return <Dashboard onLoggedOut={() => { setCsrf(null); setPhase('login'); }} />;
}

function Login({ onDone }: { onDone: () => void }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ csrfToken: string }>('POST', '/admin/login', { username: u, password: p });
      setCsrf(r.csrfToken);
      onDone();
    } catch (x) {
      setErr(errMsg(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="text-3xl font-black">BRAINBYTE <span className="text-violet">ADMIN</span></h1>
      <form onSubmit={submit} className="panel flex flex-col gap-4 p-6" aria-label="Admin sign in">
        {err && <ErrorBanner>{err}</ErrorBanner>}
        <div><label className="lbl" htmlFor="u">Username</label><input id="u" className="field" autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} required /></div>
        <div><label className="lbl" htmlFor="p">Password</label><input id="p" type="password" className="field" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} required /></div>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="text-sm text-muted">No account yet? Run <code className="mono">npm run admin:create -- &lt;username&gt;</code> on the host laptop.</p>
      </form>
    </main>
  );
}

type Tab = 'control' | 'teams' | 'rounds' | 'scores' | 'audit' | 'event';
const TABS: [Tab, string][] = [['control', 'Control'], ['teams', 'Teams'], ['rounds', 'Rounds & scoring'], ['scores', 'Leaderboard'], ['audit', 'Audit log'], ['event', 'Event']];

function Dashboard({ onLoggedOut }: { onLoggedOut: () => void }) {
  const live = useLive('admin');
  const now = useServerNow(live.offset);
  const [fetched, setFetched] = useState<AdminState | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('control');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

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

  const act = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setError(null);
      try {
        const r = await fn();
        await refresh();
        return r;
      } catch (e) {
        setError(errMsg(e));
        if (e instanceof ApiFailure && e.status === 401) onLoggedOut();
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh, onLoggedOut],
  );
  const post = (path: string, body: unknown = {}) => act(() => api('POST', path, body));

  if (fetched === undefined && !live.admin) return <Spinner />;

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-3 py-4 sm:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-black">BRAINBYTE <span className="text-violet">ADMIN</span></h1>
        {state && <span className="badge" data-testid="event-state">{state.event.state.replace('_', ' ')}</span>}
        {state && <span className="mono text-sm text-muted">PIN <strong className="text-neon" data-testid="pin">{state.event.pin}</strong></span>}
        <span className="flex-1" />
        <ConnBadge status={live.status} />
        <a className="btn btn-ghost btn-sm" href="/display" target="_blank" rel="noreferrer">Open projector ↗</a>
        <button className="btn btn-ghost btn-sm" onClick={async () => { await api('POST', '/admin/logout').catch(() => undefined); onLoggedOut(); }}>Sign out</button>
      </header>
      <nav aria-label="Admin sections" className="flex gap-1 overflow-x-auto" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`btn btn-sm shrink-0 ${tab === id ? 'btn-primary' : 'btn-ghost'}`}>{label}</button>
        ))}
      </nav>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {state === null ? (
        <CreateEvent busy={busy} onCreate={(name) => post('/admin/event', { name })} />
      ) : (
        <>
          {tab === 'control' && <Control s={state} now={now} busy={busy} post={post} confirm={confirm.ask} />}
          {tab === 'teams' && <Teams s={state} busy={busy} post={post} confirm={confirm.ask} />}
          {tab === 'rounds' && <Rounds s={state} act={act} />}
          {tab === 'scores' && <Scores s={state} act={act} />}
          {tab === 'audit' && <Audit s={state} />}
          {tab === 'event' && <EventTab s={state} act={act} confirm={confirm.ask} />}
        </>
      )}
      {confirm.node}
    </div>
  );
}

function CreateEvent({ onCreate, busy }: { onCreate: (n: string) => void; busy: boolean }) {
  const [name, setName] = useState('BrainByte Arena');
  return (
    <form className="panel mx-auto flex w-full max-w-lg flex-col gap-4 p-6" onSubmit={(e) => { e.preventDefault(); onCreate(name); }}>
      <h2 className="text-2xl font-black">Create the event</h2>
      <div><label className="lbl" htmlFor="en">Event name</label><input id="en" className="field" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={60} required /></div>
      <p className="text-sm text-muted">A random room PIN is generated and the three levels are loaded with their sample questions.</p>
      <button className="btn btn-primary" disabled={busy}>Create event</button>
    </form>
  );
}

type Post = (path: string, body?: unknown) => Promise<unknown>;
type Ask = (title: string, body: ReactNode, label: string, run: () => void, danger?: boolean) => void;

const ACTION_LABEL: Record<string, string> = {
  'registration.open': 'Open registration',
  'registration.pause': 'Pause registration',
  'registration.confirm': 'Close registration & confirm teams',
  'round.prepare': 'Prepare next round',
  'round.start': '▶ Start round',
  'round.pause': '⏸ Pause',
  'round.resume': '▶ Resume',
  'round.end': '■ End round',
  'live.advance': '⏩ Next step',
  'live.skip': '⏭ Skip question',
  'qualification.open': 'Run qualification',
  'event.complete': '🏆 Finish event & show winners',
};
const ACTION_PATH: Record<string, string> = {
  'registration.open': '/admin/registration/open',
  'registration.pause': '/admin/registration/pause',
  'registration.confirm': '/admin/registration/confirm',
  'round.prepare': '/admin/round/prepare',
  'round.start': '/admin/round/start',
  'round.pause': '/admin/round/pause',
  'round.resume': '/admin/round/resume',
  'round.end': '/admin/round/end',
  'live.advance': '/admin/round/live/advance',
  'live.skip': '/admin/round/live/skip',
  'qualification.open': '/admin/qualification/open',
  'event.complete': '/admin/event/complete',
};

function Control({ s, now, busy, post, confirm }: { s: AdminState; now: number; busy: boolean; post: Post; confirm: Ask }) {
  const round = s.rounds.find((r) => r.id === s.event.currentRoundId) ?? null;
  const left = round ? remaining(round, now) : 0;
  const joinUrl = s.event.joinUrls[0]!;
  const nextLevel = s.rounds.filter((r) => r.status === 'ended').length + 1;
  const pendingTeams = s.teams.filter((t) => t.status === 'pending').length;

  const run = (a: string) => {
    if (a === 'round.end') return confirm('End the round now?', 'Scores are finalised and teams can no longer answer.', 'End round', () => post(ACTION_PATH[a]!), true);
    if (a === 'event.complete') return confirm('Finish the event?', 'This shows the podium and winners. Scores can still be corrected afterwards.', 'Finish event', () => post(ACTION_PATH[a]!));
    if (a === 'live.skip') return confirm('Skip this question?', 'The question is voided: nobody scores, no lives are lost, and the next question opens immediately.', 'Skip question', () => post(ACTION_PATH[a]!), true);
    return post(ACTION_PATH[a]!);
  };
  const liveLabel = (a: string) => (a === 'live.advance' ? (round?.livePhase === 'open' ? '⏩ Close question now' : '⏭ Next question') : ACTION_LABEL[a]);
  const actions = s.allowedActions.filter((a) => ACTION_PATH[a]);
  const endedRound = s.event.state === 'ROUND_ENDED' ? round : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <section className="panel flex flex-col gap-4 p-5" aria-labelledby="ctl-h">
        <h2 id="ctl-h" className="text-xl font-black">Game control</h2>
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <p className="text-sm text-muted">Current round</p>
            <p className="text-lg font-bold">{round ? round.name : 'None yet'}</p>
          </div>
          {round && (round.status === 'running' || round.status === 'paused') && (
            <div role="timer" aria-label="Round time remaining">
              <p className="text-sm text-muted">{round.status === 'paused' ? 'Paused at' : 'Time left'}</p>
              <p className={`mono text-5xl font-black ${round.status === 'paused' ? 'text-warn' : 'text-neon'}`}>{fmtClock(left)}</p>
            </div>
          )}
          {round && round.kind !== 'quiz' && (round.status === 'running' || round.status === 'paused') && (
            <div>
              <p className="text-sm text-muted">Live question</p>
              <p className="text-lg font-bold" data-testid="live-status">{round.liveIndex + 1} / {round.challenges.length} · {round.livePhase === 'reveal' ? 'revealing' : 'open'}</p>
            </div>
          )}
          <div className="text-sm text-muted">
            <p>Teams <strong className="text-text">{s.counts.teams}/{s.counts.capacity}</strong> · online <strong className="text-text">{s.counts.connected}</strong></p>
            <p>Answers in <strong className="text-text">{s.counts.submissions}</strong> · finished <strong className="text-text">{s.counts.finished}</strong></p>
          </div>
        </div>
        {pendingTeams > 0 && <p className="rounded-lg border border-warn px-3 py-2 text-warn">⚠ {pendingTeams} team(s) await approval (Teams tab).</p>}
        <div className="flex flex-wrap gap-3">
          {actions.map((a) => (
            <button
              key={a} disabled={busy} onClick={() => run(a)} data-testid={`act-${a}`}
              className={`btn ${a === 'round.start' || a === 'round.resume' || a === 'live.advance' ? 'btn-primary' : a === 'round.end' ? 'btn-danger' : a === 'event.complete' ? 'btn-violet' : 'btn-ghost'}`}
            >
              {a === 'round.prepare' ? `Prepare Level ${nextLevel}` : liveLabel(a)}
            </button>
          ))}
          {actions.length === 0 && <Empty>No actions available in this state.</Empty>}
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-bad/50 p-3">
          <button
            className="btn btn-danger btn-sm" disabled={busy} data-testid="act-event.reset"
            onClick={() => confirm('Reset the game?', 'Every team, answer, score and log entry is deleted, all phones are signed out and the game goes back to Level 1. The questions and admin accounts are kept. Export the CSV first if you need the results.', 'Yes, reset everything', () => post('/admin/event/reset', { confirm: 'RESET' }), true)}
          >
            ⟲ Reset game
          </button>
          <span className="text-sm text-muted">Clears all saved teams and scores and starts again from Level 1.</span>
        </div>
        {endedRound && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3">
            <span>Answer reveal for {endedRound.name}:</span>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => post(`/admin/round/${endedRound.level}/reveal`, { reveal: !endedRound.answersRevealed })}>
              {endedRound.answersRevealed ? 'Hide answers' : 'Reveal answers on projector & phones'}
            </button>
          </div>
        )}
        {s.event.state === 'QUALIFICATION' && (
          <FinalistsControl s={s} />
        )}
        <p className="text-xs text-muted">Allowed now (enforced by the server): {s.allowedActions.join(', ') || 'none'}</p>
      </section>
      <aside className="flex flex-col gap-4">
        <section className="panel flex items-center gap-4 p-4" aria-labelledby="join-h">
          <QrImage text={joinUrl} size={140} label="QR code for team join link" />
          <div className="min-w-0">
            <h2 id="join-h" className="font-black">Team join link</h2>
            <p className="mono break-all text-sm text-neon">{joinUrl}</p>
            <p className="text-xs text-muted">If the IP is wrong, set PUBLIC_URL in .env</p>
          </div>
        </section>
        <section className="panel p-4" aria-labelledby="lb-h">
          <h2 id="lb-h" className="mb-2 font-black">Leaderboard</h2>
          <Leaderboard rows={s.leaderboard.slice(0, 8)} compact provisional={s.event.state === 'ROUND_RUNNING' || s.event.state === 'ROUND_PAUSED'} showProgress />
        </section>
      </aside>
    </div>
  );
}

function FinalistsControl({ s }: { s: AdminState }) {
  const finalists = s.leaderboard.filter((r) => r.qualified);
  return (
    <div className="rounded-xl border border-ok p-3">
      <h3 className="font-bold text-ok">Finalists ({finalists.length} of {s.event.settings.finalists} slots)</h3>
      <p className="text-sm">{finalists.map((f) => f.name).join(', ') || 'none'}</p>
      <p className="mt-1 text-xs text-muted">Change the number in the Event tab; the list updates immediately. Ranking uses: total → latest-level score → challenges solved → earliest last solve.</p>
    </div>
  );
}

function Teams({ s, busy, post, confirm }: { s: AdminState; busy: boolean; post: Post; confirm: Ask }) {
  const early = ['SETUP', 'REGISTRATION_OPEN', 'LOBBY'].includes(s.event.state);
  const slots = Array.from({ length: Math.max(s.event.settings.maxTeams, s.teams.filter((t) => t.status !== 'rejected').length) }, (_, i) => i);
  const active = s.teams.filter((t) => t.status !== 'rejected');
  const rejected = s.teams.filter((t) => t.status === 'rejected');
  const row = (t: AdminTeam | undefined, i: number) => (
    <tr key={t ? t.id : `e${i}`} className="border-t border-line align-top">
      <td className="px-2 py-2 mono text-muted">{String(i + 1).padStart(2, '0')}</td>
      {t ? (
        <>
          <td className="px-2 py-2 font-semibold">{t.name}{t.duplicateName && <span className="badge badge-warn ml-2">similar name</span>}</td>
          <td className="px-2 py-2 text-sm">{t.players.join(', ')}</td>
          <td className="px-2 py-2 mono text-sm">{t.code}</td>
          <td className="px-2 py-2"><span className={`badge ${t.status === 'approved' ? 'badge-ok' : t.status === 'pending' ? 'badge-warn' : 'badge-bad'}`}>{t.status}</span></td>
          <td className="px-2 py-2 text-sm">{t.connected ? '● online' : '◌ offline'} · {t.devices} device{t.devices === 1 ? '' : 's'}</td>
          <td className="px-2 py-2">
            <div className="flex flex-wrap gap-1">
              {early && t.status !== 'approved' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => post(`/admin/teams/${t.id}/status`, { status: 'approved' })}>Approve</button>}
              {early && t.status === 'pending' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => post(`/admin/teams/${t.id}/status`, { status: 'rejected' })}>Reject</button>}
              {early && <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => confirm(`Remove ${t.name}?`, 'The team loses its slot and is signed out.', 'Remove team', () => post(`/admin/teams/${t.id}/status`, { status: 'removed' }), true)}>Remove</button>}
            </div>
          </td>
        </>
      ) : (
        <td colSpan={6} className="px-2 py-2 text-muted">open slot</td>
      )}
    </tr>
  );
  return (
    <section className="panel overflow-x-auto p-4" aria-labelledby="teams-h">
      <h2 id="teams-h" className="mb-2 text-xl font-black">Team slots ({active.length}/{s.event.settings.maxTeams})</h2>
      {!early && <p className="mb-2 text-sm text-warn">Teams can only be approved, rejected or removed before the first round starts.</p>}
      <table className="w-full min-w-[40rem] text-left">
        <thead className="text-xs uppercase tracking-wider text-muted"><tr><th className="px-2">#</th><th className="px-2">Team</th><th className="px-2">Players</th><th className="px-2">Code</th><th className="px-2">Status</th><th className="px-2">Connection</th><th className="px-2">Actions</th></tr></thead>
        <tbody>{slots.map((i) => row(active[i], i))}</tbody>
      </table>
      {rejected.length > 0 && <p className="mt-3 text-sm text-muted">Rejected: {rejected.map((t) => t.name).join(', ')}</p>}
    </section>
  );
}

function Check({ id, label, checked, onChange, disabled }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-end gap-2">
      <input id={id} type="checkbox" className="h-6 w-6" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id} className="lbl !mb-0 pb-3">{label}</label>
    </div>
  );
}

function NumField({ id, label, value, onChange, min, max, disabled }: { id: string; label: string; value: number; onChange: (n: number) => void; min: number; max: number; disabled?: boolean }) {
  return (
    <div>
      <label className="lbl" htmlFor={id}>{label}</label>
      <input id={id} type="number" className="field" value={Number.isFinite(value) ? value : ''} min={min} max={max} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />
    </div>
  );
}

function Rounds({ s, act }: { s: AdminState; act: <T>(fn: () => Promise<T>) => Promise<T | undefined> }) {
  const [open, setOpen] = useState<number>(1);
  const [keys, setKeys] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={keys} onChange={(e) => setKeys(e.target.checked)} /> Show answer keys (hide when the projector is mirrored!)</label>
      {s.rounds.map((r) => (
        <section key={r.id} className="panel p-4" aria-labelledby={`r${r.level}`}>
          <button className="flex w-full items-center justify-between text-left" aria-expanded={open === r.level} onClick={() => setOpen(open === r.level ? 0 : r.level)}>
            <h2 id={`r${r.level}`} className="text-lg font-black">{r.name}</h2>
            <span className="badge">{r.status}</span>
          </button>
          {open === r.level && <RoundEditor r={r} keys={keys} act={act} />}
        </section>
      ))}
    </div>
  );
}

function RoundEditor({ r, keys, act }: { r: AdminRound; keys: boolean; act: <T>(fn: () => Promise<T>) => Promise<T | undefined> }) {
  const [cfg, setCfg] = useState<RoundConfig>(r.config);
  const savedCfg = JSON.stringify(r.config);
  useEffect(() => setCfg(JSON.parse(savedCfg)), [savedCfg]);
  const locked = r.status !== 'pending';
  const set = <K extends keyof RoundConfig>(k: K, v: RoundConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const dirty = JSON.stringify(cfg) !== JSON.stringify(r.config);
  return (
    <div className="mt-3 flex flex-col gap-4">
      {locked && <p className="text-sm text-warn">Scoring and timers are locked once a round has started.</p>}
      <form className="grid grid-cols-2 gap-3 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); void act(() => api('PATCH', `/admin/round/${r.level}/config`, cfg)); }}>
        {r.kind === 'quiz' && (
          <>
            <NumField id={`d${r.level}`} label="Duration (seconds)" value={cfg.durationSec} min={30} max={7200} disabled={locked} onChange={(n) => set('durationSec', n)} />
            <NumField id={`sb${r.level}`} label="Speed bonus max (0–20)" value={cfg.speedBonusMax} min={0} max={20} disabled={locked} onChange={(n) => set('speedBonusMax', n)} />
            <NumField id={`sw${r.level}`} label="Speed window (s)" value={cfg.speedWindowSec} min={1} max={600} disabled={locked} onChange={(n) => set('speedWindowSec', n)} />
            <NumField id={`wp${r.level}`} label="Wrong-answer penalty" value={cfg.wrongPenalty} min={0} max={500} disabled={locked} onChange={(n) => set('wrongPenalty', n)} />
            <Check id={`sk${r.level}`} label="Teams may skip questions" checked={cfg.allowSkip} disabled={locked} onChange={(v) => set('allowSkip', v)} />
            <Check id={`he${r.level}`} label="Hints enabled" checked={cfg.hintsEnabled} disabled={locked} onChange={(v) => set('hintsEnabled', v)} />
            <NumField id={`hp${r.level}`} label="Hint penalty" value={cfg.hintPenalty} min={0} max={1000} disabled={locked || !cfg.hintsEnabled} onChange={(n) => set('hintPenalty', n)} />
          </>
        )}
        {r.kind !== 'quiz' && (
          <>
            <NumField id={`qs${r.level}`} label="Seconds per question" value={cfg.questionSec} min={5} max={120} disabled={locked} onChange={(n) => set('questionSec', n)} />
            <NumField id={`rs${r.level}`} label="Reveal seconds" value={cfg.revealSec} min={2} max={60} disabled={locked} onChange={(n) => set('revealSec', n)} />
            <NumField id={`sb${r.level}`} label="Speed bonus max" value={cfg.speedBonusMax} min={0} max={500} disabled={locked} onChange={(n) => set('speedBonusMax', n)} />
            <NumField id={`fb${r.level}`} label="Fastest-finger bonus" value={cfg.fastestBonus} min={0} max={500} disabled={locked} onChange={(n) => set('fastestBonus', n)} />
            <NumField id={`wp${r.level}`} label="Wrong-answer penalty" value={cfg.wrongPenalty} min={0} max={500} disabled={locked} onChange={(n) => set('wrongPenalty', n)} />
          </>
        )}
        {(r.kind === 'lightning' || r.kind === 'faces') && (
          <>
            <NumField id={`st${r.level}`} label="Streak bonus per step" value={cfg.streakBonus} min={0} max={200} disabled={locked} onChange={(n) => set('streakBonus', n)} />
            <NumField id={`sc${r.level}`} label="Streak cap (steps)" value={cfg.streakCap} min={0} max={20} disabled={locked} onChange={(n) => set('streakCap', n)} />
            {r.kind === 'lightning' && <Check id={`dd${r.level}`} label="Double Down power-up" checked={cfg.doubleDown} disabled={locked} onChange={(v) => set('doubleDown', v)} />}
          </>
        )}
        {r.kind === 'bingo' && (
          <>
            <NumField id={`lb${r.level}`} label="Bonus per completed line" value={cfg.lineBonus} min={0} max={1000} disabled={locked} onChange={(n) => set('lineBonus', n)} />
            <NumField id={`bb${r.level}`} label="Blackout bonus (full card)" value={cfg.blackoutBonus} min={0} max={5000} disabled={locked} onChange={(n) => set('blackoutBonus', n)} />
          </>
        )}
        {r.kind === 'showdown' && (
          <>
            <NumField id={`lv${r.level}`} label="Lives per team" value={cfg.lives} min={0} max={10} disabled={locked} onChange={(n) => set('lives', n)} />
            <NumField id={`sp${r.level}`} label="Steal points" value={cfg.stealPoints} min={0} max={1000} disabled={locked} onChange={(n) => set('stealPoints', n)} />
            <NumField id={`sv${r.level}`} label="Survivor bonus" value={cfg.survivorBonus} min={0} max={5000} disabled={locked} onChange={(n) => set('survivorBonus', n)} />
          </>
        )}
        <div className="flex items-end"><button className="btn btn-primary btn-sm w-full" disabled={locked || !dirty}>Save scoring</button></div>
      </form>
      {r.kind !== 'quiz' && <p className="text-sm text-muted">Round length is calculated automatically: {r.challenges.length} questions × ({cfg.questionSec}s + {cfg.revealSec}s) ≈ {Math.ceil((r.challenges.length * (cfg.questionSec + cfg.revealSec)) / 60)} minutes.</p>}
      <div>
        <h3 className="mb-2 font-bold">Questions ({r.challenges.length}) – preview</h3>
        <ol className="space-y-2">
          {r.challenges.map((c) => <ChallengeRowEditor key={c.id} c={c} keys={keys} locked={locked} act={act} quiz={r.kind === 'quiz'} bingo={r.kind === 'bingo'} />)}
        </ol>
      </div>
    </div>
  );
}

function ChallengeRowEditor({ c, keys, locked, act, quiz, bingo }: { c: AdminChallenge; keys: boolean; locked: boolean; act: <T>(fn: () => Promise<T>) => Promise<T | undefined>; quiz: boolean; bingo: boolean }) {
  const [points, setPoints] = useState(c.points);
  const [hint, setHint] = useState(c.hint ?? '');
  useEffect(() => { setPoints(c.points); setHint(c.hint ?? ''); }, [c.points, c.hint]);
  const answer = c.kind === 'choice' ? c.answers.map((a) => c.options?.find((o) => o.id === a)?.text ?? a).join(', ') : c.answers.join(' | ');
  const dirty = points !== c.points || hint !== (c.hint ?? '');
  return (
    <li className="rounded-xl border border-line bg-panel2/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        {c.image && (
          <div className="w-20 shrink-0">
            <FaceImage src={c.image} className="aspect-[4/5] w-20 rounded-lg" />
            <p className="mono mt-1 break-all text-[0.65rem] text-muted">web/public{c.image}.jpg</p>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{c.position + 1}. {c.title} <span className="badge ml-1">{c.kind}</span></p>
          <p className="prompt mt-1 text-sm text-muted">{c.prompt}</p>
          {c.options && !bingo && <p className="mt-1 text-sm">{c.options.map((o) => `${o.id.toUpperCase()}) ${o.text}`).join('   ')}</p>}
          <p className="mt-1 text-sm">{keys ? <>Answer: <strong className="mono text-ok">{answer}</strong>{c.hint && !quiz ? <span className="text-muted"> · {c.hint}</span> : null}</> : <span className="text-muted">Answer hidden</span>}</p>
        </div>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void act(() => api('PATCH', `/admin/challenges/${c.id}`, { points, hint: hint || null })); }}>
          <div className="w-24"><label className="lbl" htmlFor={`p${c.id}`}>Points</label><input id={`p${c.id}`} type="number" min={0} max={5000} className="field !min-h-10" disabled={locked} value={Number.isFinite(points) ? points : ''} onChange={(e) => setPoints(Number(e.target.value))} /></div>
          {quiz ? <div className="w-56"><label className="lbl" htmlFor={`h${c.id}`}>Hint</label><input id={`h${c.id}`} className="field !min-h-10" maxLength={300} disabled={locked} value={hint} onChange={(e) => setHint(e.target.value)} /></div> : null}
          <button className="btn btn-ghost btn-sm" disabled={locked || !dirty}>Save</button>
        </form>
      </div>
    </li>
  );
}

function Scores({ s, act }: { s: AdminState; act: <T>(fn: () => Promise<T>) => Promise<T | undefined> }) {
  const [target, setTarget] = useState<number | ''>('');
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const canAdjust = !['SETUP', 'REGISTRATION_OPEN', 'LOBBY'].includes(s.event.state);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (target === '') return;
    const ok = await act(() => api('POST', `/admin/teams/${target}/score`, { points: Number(points), reason }));
    if (ok) { setPoints(''); setReason(''); }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <section className="panel p-4" aria-labelledby="sc-h">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 id="sc-h" className="text-xl font-black">{s.event.state === 'ROUND_RUNNING' || s.event.state === 'ROUND_PAUSED' ? 'Provisional leaderboard' : 'Official leaderboard'}</h2>
          <a className="btn btn-primary btn-sm" href="/api/admin/export.csv" download>Export CSV</a>
        </div>
        <Leaderboard rows={s.leaderboard} provisional={s.event.state === 'ROUND_RUNNING' || s.event.state === 'ROUND_PAUSED'} showProgress />
      </section>
      <form onSubmit={submit} className="panel flex flex-col gap-3 self-start p-4" aria-labelledby="adj-h">
        <h2 id="adj-h" className="text-xl font-black">Adjust score</h2>
        {!canAdjust && <p className="text-sm text-warn">Available once the first round is prepared.</p>}
        <div><label className="lbl" htmlFor="adj-team">Team</label>
          <select id="adj-team" className="field" value={target} onChange={(e) => setTarget(e.target.value === '' ? '' : Number(e.target.value))} required>
            <option value="">Select a team…</option>
            {s.teams.filter((t) => t.status === 'approved').map((t) => <option key={t.id} value={t.id}>{t.name} ({t.total})</option>)}
          </select></div>
        <div><label className="lbl" htmlFor="adj-pts">Points (use a negative number to deduct)</label><input id="adj-pts" type="number" className="field" value={points} onChange={(e) => setPoints(e.target.value)} required /></div>
        <div><label className="lbl" htmlFor="adj-why">Reason (required, saved in the audit log)</label><input id="adj-why" className="field" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={200} required /></div>
        <button className="btn btn-violet" disabled={!canAdjust || target === '' || !points || reason.trim().length < 3}>Apply adjustment</button>
      </form>
    </div>
  );
}

function Audit({ s }: { s: AdminState }) {
  return (
    <section className="panel overflow-x-auto p-4" aria-labelledby="au-h">
      <h2 id="au-h" className="mb-2 text-xl font-black">Audit log (latest 200)</h2>
      {s.audit.length === 0 ? <Empty>Nothing recorded yet.</Empty> : (
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted"><tr><th className="px-2">Time (UTC)</th><th className="px-2">Actor</th><th className="px-2">Action</th><th className="px-2">Details</th></tr></thead>
          <tbody>
            {s.audit.map((a) => (
              <tr key={a.id} className="border-t border-line align-top">
                <td className="mono whitespace-nowrap px-2 py-1.5 text-muted">{a.createdAt.replace('T', ' ').slice(0, 19)}</td>
                <td className="px-2 py-1.5">{a.actor}</td>
                <td className="mono px-2 py-1.5">{a.action}</td>
                <td className="mono break-all px-2 py-1.5 text-muted">{a.details === '{}' ? '' : a.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function EventTab({ s, act, confirm }: { s: AdminState; act: <T>(fn: () => Promise<T>) => Promise<T | undefined>; confirm: Ask }) {
  const [name, setName] = useState(s.event.name);
  const [pin, setPin] = useState(s.event.pin);
  const [set, setSet] = useState<EventSettings>(s.event.settings);
  const [newName, setNewName] = useState('');
  // Reset drafts only when the saved values really change, not on every live state push.
  const savedSettings = JSON.stringify(s.event.settings);
  useEffect(() => { setName(s.event.name); setPin(s.event.pin); setSet(JSON.parse(savedSettings)); }, [s.event.name, s.event.pin, savedSettings]);
  const early = ['SETUP', 'REGISTRATION_OPEN', 'LOBBY'].includes(s.event.state);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form className="panel flex flex-col gap-3 p-4" onSubmit={(e) => { e.preventDefault(); void act(() => api('PATCH', '/admin/event', { name, pin: early ? pin : undefined, settings: set })); }} aria-labelledby="ev-h">
        <h2 id="ev-h" className="text-xl font-black">Event settings</h2>
        <div><label className="lbl" htmlFor="ev-name">Event name</label><input id="ev-name" className="field" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={60} /></div>
        <div><label className="lbl" htmlFor="ev-pin">Room PIN (6 digits{early ? '' : ', locked after play begins'})</label><input id="ev-pin" className="field mono" pattern="\d{6}" maxLength={6} disabled={!early} value={pin} onChange={(e) => setPin(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <NumField id="ev-max" label="Team capacity (max 20)" value={set.maxTeams} min={1} max={20} disabled={!early} onChange={(n) => setSet({ ...set, maxTeams: n })} />
          <NumField id="ev-fin" label="Finalists advancing" value={set.finalists} min={1} max={20} disabled={s.event.qualificationFrozen} onChange={(n) => setSet({ ...set, finalists: n })} />
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={set.autoApprove} disabled={!early} onChange={(e) => setSet({ ...set, autoApprove: e.target.checked })} /> Auto-approve new teams</label>
        <label className="flex items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={set.liveScores} onChange={(e) => setSet({ ...set, liveScores: e.target.checked })} /> Show live scores during rounds (otherwise revealed when each round ends)</label>
        <button className="btn btn-primary">Save settings</button>
      </form>
      <section className="panel flex flex-col gap-4 border-bad/60 p-4" aria-labelledby="dz-h">
        <h2 id="dz-h" className="text-xl font-black text-bad">Danger zone</h2>
        <div>
          <p className="mb-2 text-sm text-muted">Reset removes every team, answer and score, returns to SETUP and signs all phones out. The questions and admin accounts are kept.</p>
          <button className="btn btn-danger" onClick={() => confirm('Reset the whole event?', <>All teams, scores and progress will be deleted. Type nothing – this cannot be undone. Export the CSV first if you need the results.</>, 'Yes, reset everything', () => void act(() => api('POST', '/admin/event/reset', { confirm: 'RESET' })), true)}>Reset event…</button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); confirm('Start a brand-new event?', 'The current event is archived (data kept in the database) and a new PIN is issued. Connected phones are signed out.', 'Create new event', () => void act(() => api('POST', '/admin/event', { name: newName }))); }}>
          <label className="lbl" htmlFor="ne">New event name</label>
          <div className="flex gap-2"><input id="ne" className="field" value={newName} onChange={(e) => setNewName(e.target.value)} minLength={2} required /><button className="btn btn-ghost">Create…</button></div>
        </form>
      </section>
    </div>
  );
}
