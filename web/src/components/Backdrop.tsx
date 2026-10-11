import { useEffect, useState, type CSSProperties } from 'react';

/** 0 = lobby/neutral, 1-3 = level themes, 4 = champion finale. */
export type Theme = 0 | 1 | 2 | 3 | 4;

export const LEVELS: Record<number, { name: string; tag: string; icon: string }> = {
  1: { name: 'Quick Brain', tag: 'Think fast. Answer smart.', icon: '🧠' },
  2: { name: 'Reel Rush', tag: 'Speed. Streaks. Double or nothing.', icon: '🎬' },
  3: { name: 'Final Showdown', tag: 'Lives on the line. Last team standing.', icon: '🔥' },
};

export function themeFor(state: string | undefined, level: number | undefined): Theme {
  if (state === 'EVENT_COMPLETED') return 4;
  if (state === 'QUALIFICATION') return 3;
  if (level === 1 || level === 2 || level === 3) return level;
  return 0;
}

const rnd = (i: number, salt: number) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const css = (v: Record<string, string | number>) => v as CSSProperties;

const BITS = Array.from({ length: 22 }, (_, i) => ({ x: rnd(i, 1) * 100, d: 9 + rnd(i, 2) * 10, s: -rnd(i, 3) * 14, c: rnd(i, 4) > 0.5 ? '"1"' : '"0"', z: 0.8 + rnd(i, 5) * 1.4 }));
const STREAKS = Array.from({ length: 14 }, (_, i) => ({ y: rnd(i, 6) * 100, w: 14 + rnd(i, 7) * 40, d: 0.9 + rnd(i, 8) * 1.8, s: -rnd(i, 9) * 3 }));
const EMBERS = Array.from({ length: 30 }, (_, i) => ({ x: rnd(i, 10) * 100, d: 4 + rnd(i, 11) * 6, s: -rnd(i, 12) * 8, z: 3 + rnd(i, 13) * 7, dx: (rnd(i, 14) - 0.5) * 140 }));
const CONFETTI = Array.from({ length: 70 }, (_, i) => ({
  x: rnd(i, 15) * 100, d: 4 + rnd(i, 16) * 5, s: -rnd(i, 17) * 9, w: 7 + rnd(i, 18) * 8, h: 10 + rnd(i, 19) * 12, r: rnd(i, 20) * 360,
  c: ['#fbbf24', '#22d3ee', '#c084fc', '#fb7185', '#4ade80', '#fb923c', '#ffffff'][i % 7]!,
}));

/** Fixed, decorative, pure-CSS ambient layer. Content text comes from CSS `content`, never from the DOM. */
export function Backdrop({ theme }: { theme: Theme }) {
  return (
    <div className="bd" data-theme={theme} aria-hidden="true">
      {theme === 0 && (
        <>
          <i className="bd-blob" style={css({ '--x': '12%', '--y': '20%', '--c': '#7c3aed', '--d': '19s' })} />
          <i className="bd-blob" style={css({ '--x': '78%', '--y': '70%', '--c': '#0891b2', '--d': '23s' })} />
          <i className="bd-blob" style={css({ '--x': '60%', '--y': '12%', '--c': '#db2777', '--d': '27s' })} />
        </>
      )}
      {theme === 1 && (
        <>
          <i className="bd-grid" />
          <i className="bd-scan" />
          {BITS.map((b, i) => <i key={i} className="bd-bit" style={css({ '--x': `${b.x}%`, '--d': `${b.d}s`, '--s': `${b.s}s`, '--ch': b.c, '--z': `${b.z}rem` })} />)}
        </>
      )}
      {theme === 2 && (
        <>
          <i className="bd-beam" style={css({ '--o': '-18deg', '--x': '20%' })} />
          <i className="bd-beam" style={css({ '--o': '18deg', '--x': '80%', '--r': 'reverse' })} />
          <i className="bd-film bd-film-l" />
          <i className="bd-film bd-film-r" />
          {STREAKS.map((s, i) => <i key={i} className="bd-streak" style={css({ '--y': `${s.y}%`, '--w': `${s.w}vw`, '--d': `${s.d}s`, '--s': `${s.s}s` })} />)}
        </>
      )}
      {theme === 3 && (
        <>
          <i className="bd-vig" />
          <i className="bd-flash" />
          <i className="bd-rays bd-rays-fire" />
          {EMBERS.map((e, i) => <i key={i} className="bd-ember" style={css({ '--x': `${e.x}%`, '--d': `${e.d}s`, '--s': `${e.s}s`, '--z': `${e.z}px`, '--dx': `${e.dx}px` })} />)}
        </>
      )}
      {theme === 4 && (
        <>
          <i className="bd-rays" />
          <i className="bd-spot" />
          <Confetti />
        </>
      )}
    </div>
  );
}

export function Confetti() {
  return (
    <div className="bd-confetti" aria-hidden="true">
      {CONFETTI.map((c, i) => (
        <i key={i} style={css({ '--x': `${c.x}%`, '--d': `${c.d}s`, '--s': `${c.s}s`, '--w': `${c.w}px`, '--h': `${c.h}px`, '--r': `${c.r}deg`, background: c.c })} />
      ))}
    </div>
  );
}

/** Full-screen cinematic title card, shown once per level per browser tab. Hides itself with a CSS animation. */
export function LevelIntro({ level }: { level: number | undefined }) {
  const [show, setShow] = useState<number | null>(null);
  useEffect(() => {
    if (!level || !LEVELS[level]) return;
    try {
      const seen = (sessionStorage.getItem('bb-intro') ?? '').split(',');
      if (seen.includes(String(level))) return;
      sessionStorage.setItem('bb-intro', [...seen, level].join(','));
    } catch {
      /* storage unavailable: just show it */
    }
    setShow(level);
  }, [level]);
  if (!show) return null;
  const m = LEVELS[show]!;
  return (
    <div key={show} className="intro" data-level={show} aria-hidden="true">
      <div className="intro-flash" />
      <div className="intro-body">
        <div className="intro-icon" data-t={m.icon} />
        <div className="intro-num" data-t={`LEVEL ${show}`} />
        <div className="intro-name" data-t={m.name} />
        <div className="intro-bar" />
        <div className="intro-tag" data-t={m.tag} />
      </div>
    </div>
  );
}

/** Small glowing emblem used in level headers. */
export function Emblem({ level }: { level: number }) {
  const m = LEVELS[level];
  if (!m) return null;
  return <span aria-hidden="true" className="emblem">{m.icon}</span>;
}
