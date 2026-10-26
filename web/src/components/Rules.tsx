import { useId } from 'react';
import { RULES } from '../../../shared/rules';
import type { RoundKind } from '../../../shared/types';

function RuleList({ lang, title, items, wide }: { lang: 'en' | 'ml'; title: string; items: string[]; wide?: boolean }) {
  const id = useId();
  return (
    <section lang={lang} aria-labelledby={id} className={wide ? 'panel p-[1.2vw]' : undefined}>
      <h3 id={id} className={`font-black text-[var(--accent)] ${wide ? 'mb-[0.4vw] text-[1.2em]' : 'mb-1.5 text-lg'}`}>{title}</h3>
      <ol className={`list-decimal marker:font-bold marker:text-[var(--accent)] ${wide ? 'space-y-[0.4vw] pl-[2vw]' : 'space-y-1.5 pl-6'} ${lang === 'ml' ? 'leading-relaxed' : 'leading-snug'}`}>
        {items.map((rule) => <li key={rule}>{rule}</li>)}
      </ol>
    </section>
  );
}

/**
 * The rules of one game in English and Malayalam, both always shown: stacked on a phone, side by side in big type on the projector (`wide`).
 * Shown when a game is about to start. The text lives in shared/rules.ts.
 */
export function BilingualRules({ kind, wide }: { kind: RoundKind; wide?: boolean }) {
  const rules = RULES[kind];
  return (
    <div className={wide ? 'grid grid-cols-1 gap-[1.2vw] text-[0.9em] md:grid-cols-2' : 'space-y-4'} data-testid="game-rules">
      <RuleList lang="en" title="Rules" items={rules.en} wide={wide} />
      <RuleList lang="ml" title="നിയമങ്ങൾ" items={rules.ml} wide={wide} />
    </div>
  );
}
