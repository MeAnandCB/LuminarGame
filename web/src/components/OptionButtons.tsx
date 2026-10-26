/** Short answers sit two per row (phones 350px and wider, see .opt-grid-2) so four options take half the height. Long words need the full width. */
const TWO_COLUMN_MAX_CHARS = 20;
const TWO_COLUMN_MAX_WORD = 12;
const fitsTwoColumns = (text: string) => text.length <= TWO_COLUMN_MAX_CHARS && Math.max(...text.split(/\s+/).map((w) => w.length)) <= TWO_COLUMN_MAX_WORD;

export function OptionButtons({ options, value, onChange, disabled }: { options: { id: string; text: string }[]; value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const twoColumns = options.length === 4 && options.every((o) => fitsTwoColumns(o.text));
  return (
    <div role="radiogroup" aria-label="Answer options" className={`opt-grid ${twoColumns ? 'opt-grid-2' : ''}`}>
      {options.map((o, i) => (
        <button
          type="button" key={o.id} role="radio" aria-checked={value === o.id} disabled={disabled}
          onClick={() => onChange(o.id)} style={{ animationDelay: `${i * 30}ms` }}
          className={`opt btn font-semibold ${value === o.id ? 'btn-primary' : 'btn-ghost'}`}
        >
          <span aria-hidden="true" className="mono grid h-[1.65rem] w-[1.65rem] shrink-0 place-items-center rounded-md border border-current text-sm">{o.id.toUpperCase()}</span>
          <span className="min-w-0">{o.text}</span>
          {value === o.id && <span className="absolute right-1.5 top-0.5 text-[11px]" aria-hidden="true">✔</span>}
        </button>
      ))}
    </div>
  );
}
