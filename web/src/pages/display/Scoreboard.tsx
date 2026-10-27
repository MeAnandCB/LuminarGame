import { useContext, type CSSProperties } from 'react';
import type { LeaderboardRow } from '../../../../shared/types';
import { AnimatedNumber, Empty, MoreTeams, OfflineTeamsContext, PROJECTOR_ROWS, Vitals } from '../../components/ui';

/** What the right-hand cell of every row says: who has locked in, who scored, how far through the quiz a team is, or its status. */
export type RowNote =
  | { kind: 'locks'; locked: ReadonlySet<number>; closed?: boolean }
  | { kind: 'gains'; locked: ReadonlySet<number>; gains: ReadonlyMap<number, number> }
  | { kind: 'progress' }
  | { kind: 'status' }
  | { kind: 'none' };

const css = (v: Record<string, string | number>) => v as CSSProperties;

function Note({ r, note }: { r: LeaderboardRow; note: RowNote }) {
  switch (note.kind) {
    case 'locks':
      if (r.eliminated) return null;
      if (note.locked.has(r.teamId)) return <span className="pj-pill pj-pill-ok lock-in">✓ Locked in</span>;
      return <span className="pj-pill pj-pill-mute">{note.closed ? 'no answer' : 'answering…'}</span>;
    case 'gains': {
      const g = note.gains.get(r.teamId);
      if (g !== undefined && g > 0) return <span className="pj-pill pj-pill-ok pj-pill-gain lock-in">▲ +{g}</span>;
      if (g !== undefined && g < 0) return <span className="pj-pill pj-pill-bad pj-pill-gain lock-in">▼ {g}</span>;
      if (r.eliminated) return null;
      return note.locked.has(r.teamId) ? <span className="pj-pill pj-pill-bad">✗ wrong</span> : <span className="pj-pill pj-pill-mute">no answer</span>;
    }
    case 'progress':
      return r.progressTotal ? (
        <span className="pj-prog">
          <span className="tnum">{r.progress}/{r.progressTotal}</span>
          <span className="pj-meter" aria-hidden="true"><i style={css({ '--pct': `${Math.min(100, (100 * r.progress) / r.progressTotal)}%` })} /></span>
        </span>
      ) : null;
    case 'status':
      return (
        <>
          {r.outAfter !== null && <span className="pj-pill" title={`Cut after Level ${r.outAfter}`}>Out · L{r.outAfter}</span>}
          {r.outAfter === null && r.qualified === true && <span className="pj-pill pj-pill-ok">✔ Finalist</span>}
          {r.outAfter === null && r.qualified === false && <span className="pj-pill">Out</span>}
        </>
      );
    case 'none':
      return null;
  }
}

/**
 * The projector's scoreboard. Rows share the height they are given (up to PROJECTOR_ROWS of them), so 3 teams or 20 both fill the
 * column without scrolling; the type size follows the row height. The big number is the score, the thin bar under each name
 * shows how close that team is to the leader.
 */
export function Scoreboard({ rows, title, hidden, provisional, note }: { rows: LeaderboardRow[]; title: string; hidden?: boolean; provisional?: boolean; note: RowNote }) {
  const offline = useContext(OfflineTeamsContext);
  const shown = rows.slice(0, PROJECTOR_ROWS); // a bigger field would not fit the screen: show the top of the table
  const lead = Math.max(1, ...shown.map((r) => r.total));
  return (
    <section className="panel pj-board" aria-label={title}>
      <div className="pj-board-head">
        <h2 className="pj-board-title">{title}</h2>
        {provisional && !hidden && <span className="pj-board-tag">Live</span>}
      </div>
      {hidden && <p className="pj-board-note">Scores are hidden until the round ends.</p>}
      <div className="pj-rows">
        {shown.length === 0 ? (
          <Empty>No teams yet.</Empty>
        ) : (
          <table className="pj-table" style={css({ '--n': shown.length })}>
            <caption className="sr-only">{provisional ? 'Provisional leaderboard' : 'Official leaderboard'}</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Team</th>
                <th scope="col">Status</th>
                <th scope="col">Points</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const out = r.eliminated || r.outAfter !== null;
                const top = !hidden && r.rank >= 1 && r.rank <= 3 ? r.rank : 0;
                const off = offline.has(r.teamId);
                return (
                  <tr key={r.teamId} data-top={top || undefined} data-offline={off || undefined} data-out={out || undefined}>
                    <td className="pj-rank">{hidden || r.rank < 1 ? '' : top ? <span className="pj-medal">{r.rank}</span> : r.rank}</td>
                    <td className="pj-team">
                      <div className="pj-team-line">
                        <span className="pj-team-name" data-out={r.eliminated || undefined}>{r.name}</span>
                        <Vitals row={r} />
                        {off && <span className="badge badge-bad beat ml-2">◌ offline</span>}
                      </div>
                      {!hidden && <span className="pj-team-bar" aria-hidden="true"><i style={css({ '--w': `${Math.max(0, (100 * r.total) / lead)}%` })} /></span>}
                    </td>
                    <td className="pj-note"><Note r={r} note={note} /></td>
                    <td className="pj-score">{hidden ? '•••' : <AnimatedNumber value={r.total} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <MoreTeams total={rows.length} />
      {provisional && !hidden && <p className="pj-foot text-warn">PROVISIONAL – scores may change until the round ends.</p>}
    </section>
  );
}
