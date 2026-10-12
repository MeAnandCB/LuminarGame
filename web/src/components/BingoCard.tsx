import type { BingoPublic, TeamBingo } from '../../../shared/types';

type Tile = { id: string; text: string; icon: string };

/** One printed square: icon over label. */
function Face({ t }: { t: Tile }) {
  return (
    <>
      <span aria-hidden="true" className="bingo-icon">{t.icon}</span>
      <span className="bingo-label">{t.text}</span>
    </>
  );
}

/**
 * The team's own 4x4 card. Tapping selects an unused tile (the parent then locks it in).
 * Marked tiles carry a dauber stamp; tiles that were called but missed are crossed out; tiles on a finished line glow.
 */
export function BingoCard({ bingo, selected, onSelect, disabled, calling }: { bingo: TeamBingo; selected?: string; onSelect?: (id: string) => void; disabled?: boolean; calling?: string | null }) {
  const byId = new Map(bingo.tiles.map((t) => [t.id, t]));
  const marked = new Set(bingo.marked);
  const missed = new Set(bingo.missed);
  const lineCells = new Set(bingo.lineCells);
  return (
    <div role="group" aria-label="Your bingo card" className="bingo-card">
      {bingo.layout.map((id, cell) => {
        const t = byId.get(id)!;
        const isMarked = marked.has(id);
        const isMissed = missed.has(id);
        const used = isMarked || isMissed;
        const state = isMarked ? 'marked' : isMissed ? 'missed' : selected === id ? 'selected' : 'open';
        return (
          <button
            key={id}
            type="button"
            className={`bingo-cell ${lineCells.has(cell) ? 'bingo-line' : ''} ${calling === id ? 'bingo-calling' : ''}`}
            data-state={state}
            disabled={disabled || used || !onSelect}
            aria-pressed={onSelect ? selected === id : undefined}
            aria-label={`${t.text}${isMarked ? ', marked' : isMissed ? ', called but missed' : ''}${lineCells.has(cell) ? ', part of a line' : ''}`}
            onClick={() => onSelect?.(id)}
          >
            <Face t={t} />
            {isMarked && <span className="bingo-dab" aria-hidden="true" />}
            {isMissed && <span className="bingo-miss" aria-hidden="true">✕</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The projector's master board: every tile in a fixed order; called tiles light up with their call number. */
export function BingoBoard({ bingo, current }: { bingo: BingoPublic; current?: string | null }) {
  return (
    <ol className="bingo-board" aria-label="Bingo board: tiles called so far">
      {bingo.tiles.map((t) => {
        const n = bingo.called.indexOf(t.id);
        const called = n >= 0;
        return (
          <li key={t.id} className={`bingo-cell bingo-big ${current === t.id ? 'bingo-calling' : ''}`} data-state={called ? 'marked' : 'open'} aria-label={`${t.text}${called ? `, called number ${n + 1}` : ', not called yet'}`}>
            <Face t={t} />
            {called && <span className="bingo-dab" aria-hidden="true" />}
            {called && <span className="bingo-no tnum" aria-hidden="true">{n + 1}</span>}
          </li>
        );
      })}
    </ol>
  );
}
