import { useEffect, useState, type CSSProperties } from 'react';

/** 0 = lobby/neutral, 1-3 = Quick Brain / Reel Rush / Showdown, 4 = champion finale, 5 = Tech Faces, 6 = Tech Bingo. */
export type Theme = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** `skin` is the value of the data-level attribute that the stylesheet keys its per-game look on. */
export const LEVELS: Record<number, { name: string; tag: string; icon: string; skin: string; theme: Theme }> = {
  1: { name: 'Tech Faces', tag: 'Who is behind the tech?', icon: '📸', skin: 'faces', theme: 5 },
  2: { name: 'Tech Bingo', tag: 'Read the clue. Mark the tile. Chase the line.', icon: '🎯', skin: 'bingo', theme: 6 },
  3: { name: 'Quick Brain', tag: 'Think fast. Answer smart.', icon: '🧠', skin: '1', theme: 1 },
  4: { name: 'Reel Rush', tag: 'Speed. Streaks. Double or nothing.', icon: '⚡', skin: '2', theme: 2 },
  5: { name: 'Final Showdown', tag: 'Lives on the line. Last team standing.', icon: '🔥', skin: '3', theme: 3 },
};

/** The last level; qualification and the podium reuse its look. */
export const FINALE_LEVEL = 5;

export const skinOf = (level: number | undefined): string | undefined => (level ? LEVELS[level]?.skin : undefined);

export function themeFor(state: string | undefined, level: number | undefined): Theme {
  if (state === 'EVENT_COMPLETED') return 4;
  if (state === 'QUALIFICATION') return 3;
  return (level && LEVELS[level]?.theme) || 0;
}

const rnd = (i: number, salt: number) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const css = (v: Record<string, string | number>) => v as CSSProperties;

const BITS = Array.from({ length: 22 }, (_, i) => ({ x: rnd(i, 1) * 100, d: 9 + rnd(i, 2) * 10, s: -rnd(i, 3) * 14, c: rnd(i, 4) > 0.5 ? '"1"' : '"0"', z: 0.8 + rnd(i, 5) * 1.4 }));
const STREAKS = Array.from({ length: 14 }, (_, i) => ({ y: rnd(i, 6) * 100, w: 14 + rnd(i, 7) * 40, d: 0.9 + rnd(i, 8) * 1.8, s: -rnd(i, 9) * 3 }));
const EMBERS = Array.from({ length: 30 }, (_, i) => ({ x: rnd(i, 10) * 100, d: 4 + rnd(i, 11) * 6, s: -rnd(i, 12) * 8, z: 3 + rnd(i, 13) * 7, dx: (rnd(i, 14) - 0.5) * 140 }));
const BOKEH = Array.from({ length: 16 }, (_, i) => ({ x: rnd(i, 21) * 100, z: 3 + rnd(i, 22) * 9, d: 11 + rnd(i, 23) * 12, s: -rnd(i, 24) * 20, c: ['#a3e635', '#34d399', '#fde047', '#67e8f9'][i % 4]! }));
const BALLS = Array.from({ length: 14 }, (_, i) => ({ x: rnd(i, 25) * 96, d: 12 + rnd(i, 26) * 12, s: -rnd(i, 27) * 22, ch: `"${'BINGO'[i % 5]}"`, c: ['#ff5fa2', '#ffd166', '#7dd3fc', '#c4b5fd', '#86efac'][i % 5]! }));
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
      {theme === 5 && (
        <>
          <i className="bd-focus" />
          <i className="bd-sweep" />
          {BOKEH.map((b, i) => <i key={i} className="bd-bokeh" style={css({ '--x': `${b.x}%`, '--z': `${b.z}vmin`, '--d': `${b.d}s`, '--s': `${b.s}s`, '--c': b.c })} />)}
        </>
      )}
      {theme === 6 && (
        <>
          <i className="bd-dots" />
          {BALLS.map((b, i) => <i key={i} className="bd-ball" style={css({ '--x': `${b.x}%`, '--d': `${b.d}s`, '--s': `${b.s}s`, '--ch': b.ch, '--c': b.c })} />)}
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
export function LevelIntro({ level, reset }: { level: number | undefined; reset?: boolean }) {
  const [show, setShow] = useState<number | null>(null);
  useEffect(() => {
    // Before the first round (a fresh or reset event) every title card plays again.
    if (!reset) return;
    try {
      sessionStorage.removeItem('bb-intro');
    } catch {
      /* storage unavailable */
    }
    setShow(null);
  }, [reset]);
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
    <div key={show} className="intro" data-level={m.skin} aria-hidden="true">
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
