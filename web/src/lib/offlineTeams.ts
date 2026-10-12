import { useEffect, useRef, useState } from 'react';

/** A team must stay offline this long before it counts, so the second a phone takes to reload its page does not set off the alarm. */
export const OFFLINE_GRACE_MS = 1000;

/**
 * The teams (pass approved ones only) that have been offline longer than the grace period.
 * `onDropped` fires once per team the moment it newly counts as offline (use it for the beep).
 * Teams that are already offline when the first state arrives are listed but do not fire it, so reloading
 * the admin page or the projector never beeps.
 */
export function useOfflineTeams<T extends { id: number; connected: boolean }>(teams: T[] | null, watching: boolean, onDropped: () => void): T[] {
  const [confirmed, setConfirmed] = useState<ReadonlySet<number>>(() => new Set());
  const confirmedRef = useRef(new Set<number>());
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const offlineNow = useRef(new Set<number>());
  const primed = useRef(false);
  const notify = useRef(onDropped);
  useEffect(() => {
    notify.current = onDropped;
  });

  const offline = watching && teams ? teams.filter((t) => !t.connected) : [];
  const key = offline.map((t) => t.id).join(',');
  const loaded = teams !== null;

  useEffect(() => {
    if (!loaded) return;
    const ids = new Set(key ? key.split(',').map(Number) : []);
    offlineNow.current = ids;
    const silent = !primed.current;
    primed.current = true;
    let changed = false;
    for (const id of confirmedRef.current) {
      if (!ids.has(id)) {
        confirmedRef.current.delete(id);
        changed = true;
      }
    }
    for (const [id, timer] of timers.current) {
      if (!ids.has(id)) {
        clearTimeout(timer);
        timers.current.delete(id);
      }
    }
    for (const id of ids) {
      if (confirmedRef.current.has(id) || timers.current.has(id)) continue;
      if (silent) {
        confirmedRef.current.add(id);
        changed = true;
        continue;
      }
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          if (!offlineNow.current.has(id)) return;
          confirmedRef.current.add(id);
          setConfirmed(new Set(confirmedRef.current));
          notify.current();
        }, OFFLINE_GRACE_MS),
      );
    }
    if (changed) setConfirmed(new Set(confirmedRef.current));
  }, [key, loaded]);

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  return offline.filter((t) => confirmed.has(t.id));
}
