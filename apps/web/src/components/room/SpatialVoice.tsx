import { useEffect, useRef } from 'react';
import { RealtimeKitProvider, useRealtimeKitSelector } from '@cloudflare/realtimekit-react';
import type { RoomState } from '../../lib/roomSocket';
import { useClubHuddle } from '../huddle/ClubHuddleProvider';

/**
 * VOICE, PLACED (docs/SPATIAL-ROOM.md §3.1, phase 1 step 3). The club's huddle is the room's meeting; each
 * participant's audio track is routed through a PannerNode at the body that owns it, and the listener sits
 * at your own body — so a voice at the bar is off to the left and quiet, and the person across your table
 * is in front of you and clear. Bodies and participants are matched by the name the huddle was joined
 * under, which is the session's own name on both sides.
 *
 * The dock's <audio> elements stay attached but muted while this is on: a remote WebRTC track only flows
 * into Web Audio while some media element holds it (a browser quirk worth naming), and playing it twice
 * would be an echo.
 */
export function SpatialVoice({ state }: { state: RoomState }) {
  const h = useClubHuddle();
  useEffect(() => { h.setSpatial(true); return () => h.setSpatial(false); }, [h]);
  if (!h.meeting) return null;
  return <RealtimeKitProvider value={h.meeting}><Panners state={state} /></RealtimeKitProvider>;
}

interface Tracked { id: string; name: string; audioEnabled: boolean; audioTrack?: MediaStreamTrack; on: (ev: string, fn: (p: unknown) => void) => void; off: (ev: string, fn: (p: unknown) => void) => void }
interface Voice { source: MediaStreamAudioSourceNode; panner: PannerNode; track: MediaStreamTrack }

function Panners({ state }: { state: RoomState }) {
  const joined = useRealtimeKitSelector((m) => m.participants.joined.toArray()) as unknown as Tracked[];
  const ctx = useRef<AudioContext | null>(null);
  const voices = useRef(new Map<string, Voice>());
  const stateRef = useRef(state); stateRef.current = state;
  const joinedRef = useRef(joined); joinedRef.current = joined;

  // One context, resumed on the first gesture (autoplay policy).
  useEffect(() => {
    const ac = new AudioContext();
    ctx.current = ac;
    const resume = () => { void ac.resume(); };
    window.addEventListener('pointerdown', resume, { once: true }); window.addEventListener('keydown', resume, { once: true });
    return () => { window.removeEventListener('pointerdown', resume); window.removeEventListener('keydown', resume); for (const v of voices.current.values()) { v.source.disconnect(); v.panner.disconnect(); } voices.current.clear(); void ac.close(); ctx.current = null; };
  }, []);

  // A panner per participant with a live track; rebuilt when the track changes.
  useEffect(() => {
    const ac = ctx.current; if (!ac) return;
    const seen = new Set<string>();
    for (const p of joined) {
      const track = p.audioEnabled ? p.audioTrack : undefined;
      if (!track) { const old = voices.current.get(p.id); if (old) { old.source.disconnect(); old.panner.disconnect(); voices.current.delete(p.id); } continue; }
      seen.add(p.id);
      const cur = voices.current.get(p.id);
      if (cur && cur.track === track) continue;
      if (cur) { cur.source.disconnect(); cur.panner.disconnect(); }
      const source = ac.createMediaStreamSource(new MediaStream([track]));
      const panner = new PannerNode(ac, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1.6, maxDistance: 24, rolloffFactor: 1.3, coneInnerAngle: 360 });
      source.connect(panner).connect(ac.destination);
      voices.current.set(p.id, { source, panner, track });
    }
    for (const [id, v] of [...voices.current]) if (!seen.has(id)) { v.source.disconnect(); v.panner.disconnect(); voices.current.delete(id); }
    // For a walk to read: how many voices are placed right now.
    (window as unknown as { __spatialVoices?: number }).__spatialVoices = voices.current.size;
  }, [joined]);

  // Positions, ten times a second: the listener at your body, each voice at its body.
  useEffect(() => {
    const t = setInterval(() => {
      const ac = ctx.current; const s = stateRef.current; if (!ac || !s.you) return;
      const me = s.people.get(s.you); if (!me) return;
      const L = ac.listener; const now = ac.currentTime;
      const setL = (p: AudioParam | undefined, v: number) => { if (p) p.setTargetAtTime(v, now, 0.05); };
      if (L.positionX) { setL(L.positionX, me.x); setL(L.positionY, 1.5); setL(L.positionZ, me.y); setL(L.forwardX, Math.sin(me.yaw)); setL(L.forwardY, 0); setL(L.forwardZ, Math.cos(me.yaw)); setL(L.upX, 0); setL(L.upY, 1); setL(L.upZ, 0); }
      else L.setPosition(me.x, 1.5, me.y);
      const byName = new Map([...s.people.values()].map((p) => [p.name, p] as const));
      for (const p of joinedRef.current) {
        const v = voices.current.get(p.id); if (!v) continue;
        const body = byName.get(p.name);
        // A voice with no body in the room speaks from the door, softly.
        const x = body?.x ?? 0, z = body?.y ?? -9;
        v.panner.positionX.setTargetAtTime(x, now, 0.08); v.panner.positionY.setTargetAtTime(1.5, now, 0.08); v.panner.positionZ.setTargetAtTime(z, now, 0.08);
      }
    }, 100);
    return () => clearInterval(t);
  }, []);
  return null;
}
