/**
 * THE CLUB HUDDLE, IN THE ROOM — the Home's governed call (spec 378), ported from the Home's own
 * `HuddleProvider` and given a camera. One provider above the routed pages owns the browser call
 * instance, so walking from the club page to one of its tables and back does not hang up — the club
 * keeps talking while the cards are dealt. Participation is frozen for the life of the join: the scope
 * is fixed when you join and changes only when you leave and join again.
 *
 * WHAT IS LOCAL STAYS LOCAL. Microphone, camera and screen are the browser's own controls; Leave stops
 * local capture at once, before the Home is told. The one credential (the join's `authToken`) goes to
 * the SDK and out of scope.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { roomStill, setBackdrop, type HuddleBackdrop } from './background';
import { useRealtimeKitClient } from '@cloudflare/realtimekit-react';
import type { AppSession } from '../../lib/types';
import type { AuthConfig } from '../../lib/home';
import { huddles, huddlesOffered, type HuddleRunView, type HuddleScope } from '../../lib/huddle';

export interface HuddleParticipation {
  scope: HuddleScope;
  scopeName: string;
  run: HuddleRunView;
  role: 'host' | 'participant';
}

interface HuddleCtx {
  offered: boolean;
  current: HuddleParticipation | null;
  meeting: ReturnType<typeof useRealtimeKitClient>[0];
  busy: string | null;
  error: string | null;
  micOn: boolean;
  camOn: boolean;
  screenOn: boolean;
  start: (scope: HuddleScope, scopeName: string) => Promise<void>;
  join: (scope: HuddleScope, scopeName: string) => Promise<void>;
  leave: () => Promise<void>;
  end: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCam: () => Promise<void>;
  toggleScreen: () => Promise<void>;
  peek: (scope: HuddleScope) => Promise<HuddleRunView | null>;
  dismissError: () => void;
  /** THE ROOM IS PLACING THE VOICES: the dock keeps its <audio> elements attached but silent. */
  spatial: boolean;
  setSpatial: (on: boolean) => void;
  /** What is behind you on camera: nothing, a blur, or a still of the room you are standing in. */
  backdrop: HuddleBackdrop;
  setBackdrop: (b: HuddleBackdrop) => void;
  /** True where the browser cannot do it at all, so the control can say so instead of failing quietly. */
  backdropUnsupported: boolean;
}

const Ctx = createContext<HuddleCtx | null>(null);

export function ClubHuddleProvider({ session, config, children }: { session: AppSession | null; config: AuthConfig | null; children: ReactNode }) {
  const [meeting, initMeeting] = useRealtimeKitClient({ resetOnLeave: true });
  const [current, setCurrent] = useState<HuddleParticipation | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [spatial, setSpatial] = useState(false);
  /**
   * WHAT IS BEHIND YOU. Kept here rather than in the dock because it survives walking from the lounge to a
   * table, and because turning the camera OFF and on again has to put it back — a middleware lives on the
   * track, and a new track has none.
   */
  const [backdrop, setBackdropState] = useState<HuddleBackdrop>('none');
  const [backdropUnsupported, setBackdropUnsupported] = useState(false);
  const meetingRef = useRef(meeting);
  meetingRef.current = meeting;
  const offered = huddlesOffered(config, session);

  // The SDK's own view of the mic, the camera and the screen, mirrored into state so the dock re-renders.
  useEffect(() => {
    if (!meeting) return;
    const self = meeting.self;
    const sync = () => { setMicOn(!!self.audioEnabled); setCamOn(!!self.videoEnabled); setScreenOn(!!self.screenShareEnabled); };
    sync();
    self.on('audioUpdate', sync);
    self.on('videoUpdate', sync);
    self.on('screenShareUpdate', sync);
    return () => { self.off('audioUpdate', sync); self.off('videoUpdate', sync); self.off('screenShareUpdate', sync); };
  }, [meeting]);

  const enter = useCallback(async (how: 'start' | 'join', scope: HuddleScope, scopeName: string) => {
    if (!session) { setError('Sign in first.'); return; }
    if (current) { setError(`You are already in the ${current.scopeName} huddle — leave it first.`); return; }
    setBusy(how === 'start' ? 'Starting…' : 'Joining…'); setError(null);
    try {
      const display = session.name || 'Someone';
      const r = how === 'start' ? await huddles.start(session.token, scope, display) : await huddles.join(session.token, scope, display);
      if (!r.ok) { setError(r.error); return; }
      if (!r.run || !r.authToken) { setError(r.parks ?? 'No huddle to join.'); return; }
      // THE TOKEN: to the SDK, and out of scope. `r` is not kept.
      const m = await initMeeting({ authToken: r.authToken, defaults: { audio: false, video: false } });
      if (!m) { setError('The call could not be set up in this browser.'); return; }
      await m.join();
      setCurrent({ scope, scopeName, run: r.run, role: r.participant?.role ?? 'participant' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }, [session, current, initMeeting]);

  const leave = useCallback(async () => {
    const m = meetingRef.current;
    // Local capture stops FIRST — the server-side leave may retry; the microphone and camera must not.
    try { if (m?.self.screenShareEnabled) await m.self.disableScreenShare(); } catch { /* already off */ }
    try { if (m?.self.videoEnabled) await m.self.disableVideo(); } catch { /* already off */ }
    try { if (m?.self.audioEnabled) await m.self.disableAudio(); } catch { /* already off */ }
    try { await m?.leave(); } catch { /* the SDK may already be gone */ }
    const c = current; setCurrent(null); setMicOn(false); setCamOn(false); setScreenOn(false);
    if (session && c) await huddles.leave(session.token, c.scope).catch(() => undefined);
  }, [current, session]);

  const end = useCallback(async () => {
    if (!session || !current) return;
    setBusy('Ending…'); setError(null);
    try {
      const c = current;
      await leave();
      const r = await huddles.end(session.token, c.scope);
      if (!r.ok) setError(r.error);
    } finally { setBusy(null); }
  }, [session, current, leave]);

  // After a toggle the SDK's own flag is the truth (a permission prompt may be refused): read it back.
  const toggleMic = useCallback(async () => { const m = meetingRef.current; if (!m) return; try { if (m.self.audioEnabled) await m.self.disableAudio(); else await m.self.enableAudio(); } catch (e) { setError(e instanceof Error ? `Microphone: ${e.message}` : String(e)); } finally { setMicOn(!!meetingRef.current?.self.audioEnabled); } }, []);
  const applyBackdrop = useCallback(async (want: HuddleBackdrop) => {
    const m = meetingRef.current;
    if (!m) { setBackdropState(want); return; }
    const got = await setBackdrop(m, want, want === 'room' ? roomStill() : null);
    if (got === 'unsupported') { setBackdropUnsupported(true); setBackdropState('none'); return; }
    setBackdropUnsupported(false);
    setBackdropState(got);
  }, []);
  // A NEW TRACK CARRIES NO MIDDLEWARE: turning the camera off and on again would lose the backdrop silently.
  useEffect(() => { if (camOn && backdrop !== 'none') void applyBackdrop(backdrop); }, [camOn]);

  const toggleCam = useCallback(async () => { const m = meetingRef.current; if (!m) return; try { if (m.self.videoEnabled) await m.self.disableVideo(); else await m.self.enableVideo(); } catch (e) { setError(e instanceof Error ? `Camera: ${e.message}` : String(e)); } finally { setCamOn(!!meetingRef.current?.self.videoEnabled); } }, []);
  const toggleScreen = useCallback(async () => { const m = meetingRef.current; if (!m) return; try { if (m.self.screenShareEnabled) await m.self.disableScreenShare(); else await m.self.enableScreenShare(); } catch (e) { setError(e instanceof Error ? `Screen: ${e.message}` : String(e)); } finally { setScreenOn(!!meetingRef.current?.self.screenShareEnabled); } }, []);

  // The Home's view of the run, every ten seconds: an ended huddle (the host ended it, or the room emptied)
  // is left here too, so the dock does not sit on a call that no longer exists.
  useEffect(() => {
    if (!current || !session) return;
    const t = setInterval(() => {
      void huddles.get(session.token, current.scope).then((r) => {
        if (!r.ok) return;
        if (!r.run || r.run.state === 'ended' || r.run.state === 'ending') { void leave(); return; }
        setCurrent((c) => (c ? { ...c, run: r.run! } : c));
      }).catch(() => undefined);
    }, 10_000);
    return () => clearInterval(t);
  }, [current, session, leave]);

  const peek = useCallback(async (scope: HuddleScope) => { if (!session || !offered) return null; const r = await huddles.get(session.token, scope).catch(() => null); return r && r.ok ? r.run : null; }, [session, offered]);

  const value = useMemo<HuddleCtx>(() => ({
    offered, current, meeting, busy, error, micOn, camOn, screenOn, spatial, setSpatial,
    backdrop, backdropUnsupported, setBackdrop: (b: HuddleBackdrop) => void applyBackdrop(b),
    start: (s, n) => enter('start', s, n), join: (s, n) => enter('join', s, n), leave, end, toggleMic, toggleCam, toggleScreen, peek, dismissError: () => setError(null),
  }), [spatial, backdrop, backdropUnsupported, applyBackdrop, offered, current, meeting, busy, error, micOn, camOn, screenOn, enter, leave, end, toggleMic, toggleCam, toggleScreen, peek]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The huddle if a provider is above — null where there is none (a board rendered on its own, a test). */
export function useClubHuddleMaybe(): HuddleCtx | null {
  return useContext(Ctx);
}

export function useClubHuddle(): HuddleCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useClubHuddle must be used within <ClubHuddleProvider>');
  return ctx;
}
