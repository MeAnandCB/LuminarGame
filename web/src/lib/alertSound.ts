/** A short three-tone alert for the host, synthesised with the Web Audio API (no sound file to ship or load). */
let ac: AudioContext | null = null;
let lastBeep = 0;

function context(): AudioContext | null {
  try {
    ac ??= new AudioContext();
    return ac;
  } catch {
    return null;
  }
}

/** Browsers keep audio silent until the page has had a click or key press; call this from one. Resolves to whether sound can play now. */
export async function unlockAudio(): Promise<boolean> {
  const c = context();
  if (!c) return false;
  if (c.state === 'suspended') await c.resume().catch(() => undefined);
  return c.state === 'running';
}

/** Plays the alert. Returns false when the browser still blocks audio. Calls within 1.5 s of each other play once. */
export function beep(): boolean {
  const c = context();
  if (!c) return false;
  if (c.state !== 'running') {
    void c.resume().catch(() => undefined);
    return false;
  }
  const now = performance.now();
  if (now - lastBeep < 1500) return true;
  lastBeep = now;
  const start = c.currentTime + 0.02;
  for (const [i, hz] of [880, 880, 660].entries()) {
    const t = start + i * 0.28;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'triangle';
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.22);
  }
  return true;
}

const PREF_KEY = 'bb.admin.offlineSound';

/** The host's on/off choice. Browser storage can be unavailable (private windows), so it defaults to on. */
export function loadSoundPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveSoundPref(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* not persisted; the choice still applies until the page closes */
  }
}
