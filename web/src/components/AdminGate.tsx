import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, errMsg, setCsrf } from '../lib/api';
import { ErrorBanner, Spinner } from './ui';

/** Admin sign-in shared by /admin and /coordinator (one cookie session). Renders `children` once signed in. */
export function AdminGate({ title, children }: { title: string; children: (signOut: () => void) => ReactNode }) {
  const [phase, setPhase] = useState<'loading' | 'login' | 'in'>('loading');
  useEffect(() => {
    api<{ csrfToken: string }>('GET', '/admin/me')
      .then((r) => {
        setCsrf(r.csrfToken);
        setPhase('in');
      })
      .catch(() => setPhase('login'));
  }, []);
  const signOut = useCallback(() => {
    setCsrf(null);
    setPhase('login');
  }, []);
  if (phase === 'loading') return <Spinner />;
  if (phase === 'login') return <Login title={title} onDone={() => setPhase('in')} />;
  return <>{children(signOut)}</>;
}

function Login({ title, onDone }: { title: string; onDone: () => void }) {
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
      <h1 className="text-3xl font-black">BRAINBYTE <span className="text-violet">{title}</span></h1>
      <form onSubmit={submit} className="panel flex flex-col gap-4 p-6" aria-label={`${title[0]}${title.slice(1).toLowerCase()} sign in`}>
        {err && <ErrorBanner>{err}</ErrorBanner>}
        <div><label className="lbl" htmlFor="u">Username</label><input id="u" className="field" autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} required /></div>
        <div><label className="lbl" htmlFor="p">Password</label><input id="p" type="password" className="field" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} required /></div>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="text-sm text-muted">No account yet? Run <code className="mono">npm run admin:create -- &lt;username&gt;</code> on the host laptop.</p>
      </form>
    </main>
  );
}
