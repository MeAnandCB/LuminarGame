import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { C2S, S2C, type Announcement, type TimerSync } from '../../../shared/contract';
import type { AdminState, PublicState, TeamState } from '../../../shared/types';

export type ConnStatus = 'connecting' | 'connected' | 'reconnecting' | 'denied';

export interface Live {
  status: ConnStatus;
  pub: PublicState | null;
  team: TeamState | null;
  admin: AdminState | null;
  announcement: (Announcement & { n: number }) | null;
  sessionEnded: boolean;
  /** serverNow - Date.now() at the last sync; add to Date.now() to get server time. */
  offset: number;
  socketRef: { current: Socket | null };
}

/** One socket per mounted view. Listeners are removed on unmount so they never stack up after reconnects. */
export function useLive(role: 'team' | 'admin' | 'display', enabled = true): Live {
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [pub, setPub] = useState<PublicState | null>(null);
  const [team, setTeam] = useState<TeamState | null>(null);
  const [admin, setAdmin] = useState<AdminState | null>(null);
  const [announcement, setAnnouncement] = useState<Live['announcement']>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [offset, setOffset] = useState(0);
  const sockRef = useRef<Socket | null>(null);
  const counter = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const socket = io({ auth: { role }, reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 4000 });
    sockRef.current = socket;
    const sync = (serverNow: number) => setOffset(serverNow - Date.now());
    socket.on('connect', () => setStatus('connected'));
    socket.on('disconnect', (reason) => setStatus(reason === 'io server disconnect' ? 'denied' : 'reconnecting'));
    socket.io.on('reconnect_attempt', () => setStatus('reconnecting'));
    socket.on('connect_error', (e) => setStatus(e.message === 'unauthorized' ? 'denied' : 'reconnecting'));
    socket.on(S2C.publicState, (s: PublicState) => {
      sync(s.serverNow);
      setPub(s);
    });
    socket.on(S2C.teamState, (s: TeamState) => setTeam(s));
    socket.on(S2C.adminState, (s: AdminState) => setAdmin(s));
    socket.on(S2C.timerSync, (t: TimerSync) => sync(t.serverNow));
    socket.on(S2C.announce, (a: Announcement) => setAnnouncement({ ...a, n: ++counter.current }));
    socket.on(S2C.sessionEnded, () => setSessionEnded(true));

    // Tell the host when this phone stops showing the game (other tab or app, screen off) and when it is back.
    const report = () => socket.emit(C2S.screenVisibility, { visible: document.visibilityState !== 'hidden' });
    if (role === 'team') {
      document.addEventListener('visibilitychange', report);
      socket.on('connect', () => document.visibilityState === 'hidden' && report()); // a reconnect starts out as "visible" on the server
    }
    return () => {
      document.removeEventListener('visibilitychange', report);
      socket.removeAllListeners();
      socket.io.removeAllListeners();
      socket.disconnect();
      sockRef.current = null;
    };
  }, [role, enabled]);

  return { status, pub, team, admin, announcement, sessionEnded, offset, socketRef: sockRef };
}

/** Re-renders a few times a second; returns server-adjusted "now". */
export function useServerNow(offset: number, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset), intervalMs);
    setNow(Date.now() + offset);
    return () => clearInterval(id);
  }, [offset, intervalMs]);
  return now;
}

export function remaining(round: { status: string; deadlineAt: number | null; remainingMs: number } | null | undefined, now: number): number {
  if (!round) return 0;
  if (round.status === 'running' && round.deadlineAt) return Math.max(0, round.deadlineAt - now);
  return Math.max(0, round.remainingMs);
}

export function fmtClock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
