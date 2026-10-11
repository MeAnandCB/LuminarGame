import { useEffect, useRef, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import type { ConnStatus } from '../lib/realtime';
import type { LeaderboardRow } from '../../../shared/types';

export function ConnBadge({ status }: { status: ConnStatus }) {
  const map: Record<ConnStatus, { text: string; cls: string; dot: string }> = {
    connected: { text: 'Connected', cls: 'badge badge-ok', dot: '●' },
    connecting: { text: 'Connecting…', cls: 'badge badge-warn', dot: '◌' },
    reconnecting: { text: 'Reconnecting…', cls: 'badge badge-warn', dot: '◌' },
    denied: { text: 'Signed out', cls: 'badge badge-bad', dot: '✕' },
  };
  const m = map[status];
  return (
    <span className={m.cls} role="status" aria-live="polite">
      <span aria-hidden="true">{m.dot}</span> {m.text}
    </span>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 p-10 text-muted">
      <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-neon border-t-transparent" aria-hidden="true" />
      {label}…
    </div>
  );
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-xl border-2 border-bad bg-[#3b0a1c] px-4 py-3 text-[#ffd5dc]">
      <strong className="mr-1">Problem:</strong>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line p-6 text-center text-muted">{children}</p>;
}

export function QrImage({ text, size = 256, label }: { text: string; size?: number; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(text, { margin: 1, width: size, color: { dark: '#050816', light: '#ffffff' }, errorCorrectionLevel: 'M' }).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [text, size]);
  if (!url) return <div style={{ width: size, height: size }} className="rounded-lg bg-white/10" />;
  return <img src={url} width={size} height={size} alt={label} className="rounded-lg bg-white p-1" />;
}

export function ConfirmDialog({ open, title, body, confirmLabel, danger, onConfirm, onCancel }: { open: boolean; title: string; body: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onCancel(); }} aria-labelledby="dlg-title" className="m-auto w-[min(92vw,28rem)] rounded-2xl border border-line bg-panel p-0 text-text backdrop:bg-black/70">
      <div className="p-6">
        <h2 id="dlg-title" className="text-xl font-bold">{title}</h2>
        <div className="mt-3 text-muted">{body}</div>
        <div className="mt-6 flex justify-end gap-3">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </dialog>
  );
}

/** Imperative-looking confirmation: <Confirm ...>{(ask) => <button onClick={ask}>..}</Confirm> */
export function useConfirm() {
  const [state, setState] = useState<{ title: string; body: ReactNode; label: string; danger?: boolean; run: () => void } | null>(null);
  const node = (
    <ConfirmDialog
      open={!!state}
      title={state?.title ?? ''}
      body={state?.body}
      confirmLabel={state?.label ?? 'Confirm'}
      danger={state?.danger}
      onCancel={() => setState(null)}
      onConfirm={() => {
        const run = state?.run;
        setState(null);
        run?.();
      }}
    />
  );
  return { node, ask: (title: string, body: ReactNode, label: string, run: () => void, danger = false) => setState({ title, body, label, run, danger }) };
}

export function RankMark({ rank }: { rank: number }) {
  return <span className="tnum inline-block min-w-[2.2ch] text-right font-black">{rank > 0 ? rank : '–'}</span>;
}

export function Vitals({ row }: { row: LeaderboardRow }) {
  return (
    <>
      {row.lives !== null && (
        <span className="ml-2 whitespace-nowrap text-[0.85em]" aria-label={row.eliminated ? 'eliminated' : `${row.lives} lives left`}>
          {row.eliminated ? <span className="badge badge-bad">OUT</span> : <span className="text-bad" aria-hidden="true">{'♥'.repeat(Math.max(0, row.lives))}</span>}
        </span>
      )}
      {row.streak >= 2 && !row.eliminated && (
        <span className="ml-2 whitespace-nowrap text-[0.85em] font-bold text-warn" aria-label={`streak of ${row.streak}`}>
          <span aria-hidden="true">🔥{row.streak}</span>
        </span>
      )}
    </>
  );
}

export function Leaderboard({ rows, provisional, hidden, highlightId, compact, showProgress, big, hideOffline, dense }: { rows: LeaderboardRow[]; provisional?: boolean; hidden?: boolean; highlightId?: number; compact?: boolean; showProgress?: boolean; big?: boolean; hideOffline?: boolean; dense?: boolean }) {
  if (rows.length === 0) return <Empty>No teams yet.</Empty>;
  const text = dense ? 'text-[clamp(0.85rem,1.3vw,1.4rem)] [&_td]:!py-1' : big ? 'text-[clamp(1rem,1.9vw,1.9rem)]' : compact ? 'text-sm' : 'text-base';
  return (
    <div>
      <table className={`w-full border-separate border-spacing-y-1.5 ${text}`}>
        <caption className="sr-only">{provisional ? 'Provisional leaderboard' : 'Official leaderboard'}</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Team</th>
            {showProgress && <th scope="col">Progress</th>}
            <th scope="col">Points</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.teamId} className={`${r.teamId === highlightId ? 'outline outline-2 outline-neon' : ''} bg-panel2/80 ${r.eliminated ? 'opacity-60' : ''}`}>
              <td className="rounded-l-xl px-3 py-2 text-neon">{hidden ? '' : <RankMark rank={r.rank} />}</td>
              <td className="w-full max-w-0 truncate px-2 py-2 font-semibold">
                <span className={r.eliminated ? 'line-through' : ''}>{r.name}</span>
                <Vitals row={r} />
                {r.tied && !hidden && !big && !dense && <span className="badge badge-warn ml-2" title="Tied on every criterion; ordered by team id">tie</span>}
              </td>
              {showProgress && (
                <td className="hidden whitespace-nowrap px-2 py-2 sm:table-cell">
                  <span className="tnum text-[0.8em] text-muted">{r.progressTotal ? `${r.progress}/${r.progressTotal}` : ''}</span>
                </td>
              )}
              <td className="tnum px-2 py-2 text-right font-black">{hidden ? '•••' : r.total}</td>
              <td className="rounded-r-xl px-3 py-2 text-right">
                {r.qualified === true && <span className="badge badge-ok">✔ Finalist</span>}
                {r.qualified === false && <span className="badge">Out</span>}
                {r.qualified === null && !r.connected && !hideOffline && <span className="badge badge-warn" title="Not connected">offline</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {provisional && <p className="mt-1 text-xs text-warn">PROVISIONAL – scores may change until the round ends.</p>}
    </div>
  );
}
