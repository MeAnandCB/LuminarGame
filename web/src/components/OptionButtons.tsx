export function OptionButtons({ options, value, onChange, disabled }: { options: { id: string; text: string }[]; value: string; onChange: (id: string) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Answer options" className="grid gap-2">
      {options.map((o, i) => (
        <button
          type="button" key={o.id} role="radio" aria-checked={value === o.id} disabled={disabled}
          onClick={() => onChange(o.id)} style={{ animationDelay: `${i * 70}ms` }}
          className={`opt btn !justify-start !min-h-14 text-left text-lg ${value === o.id ? 'btn-primary' : 'btn-ghost'}`}
        >
          <span aria-hidden="true" className="mono grid h-8 w-8 shrink-0 place-items-center rounded-md border border-current">{o.id.toUpperCase()}</span>
          <span>{o.text}</span>
          {value === o.id && <span className="ml-auto" aria-hidden="true">✔</span>}
        </button>
      ))}
    </div>
  );
}

