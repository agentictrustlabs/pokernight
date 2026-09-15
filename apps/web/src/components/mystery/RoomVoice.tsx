import { useEffect, useRef } from 'react';
import { RealtimeKitProvider, useRealtimeKitSelector } from '@cloudflare/realtimekit-react';
import type { MysteryView } from '@pokernight/mystery';
import { useClubHuddle } from '../huddle/ClubHuddleProvider';
import { spotIn } from './plan';

/**
 * VOICE THAT STAYS IN THE ROOM IT IS SPOKEN IN (docs/MYSTERY-NIGHT.md §9).
 *
 * A mystery is people talking in different rooms, and a single call where everybody hears everybody is not
 * a hotel — it is a conference. The club's huddle is still ONE meeting (the Home has no per-room scope yet),
 * so the separation is done where the audio is played: each participant's track goes through a GAIN and a
 * PANNER, the gain is zero unless their character is in YOUR room, and the panner sits where that character
 * is standing — the same spot the venue draws their body at (`spotIn`).
 *
 * WHAT THIS IS AND IS NOT. It is an ACOUSTIC boundary, not a privacy one: the track still arrives from the
 * SFU and a determined person could listen to it. Saying otherwise would be a lie about what the kitchen
 * door is worth, and the honest fix is a room-scoped meeting at the Home, which is §15's open question. What
 * it buys today is the thing that makes the game work: you have to be in the room to hear the room.
 *
 * Matching is by NAME, as the lounge does it: a huddle participant's display name is the person's own name,
 * and a character a person plays carries `playedBy`.
 */
export function RoomVoice({ view }: { view: MysteryView }) {
  const h = useClubHuddle();
  useEffect(() => { h.setSpatial(true); return () => h.setSpatial(false); }, [h]);
  if (!h.meeting) return null;
  return <RealtimeKitProvider value={h.meeting}><Placed view={view} /></RealtimeKitProvider>;
}

interface Tracked { id: string; name: string; audioEnabled: boolean; audioTrack?: MediaStreamTrack }
interface Voice { source: MediaStreamAudioSourceNode; gain: GainNode; panner: PannerNode; track: MediaStreamTrack }

function Placed({ view }: { view: MysteryView }) {
  const joined = useRealtimeKitSelector((m) => m.participants.joined.toArray()) as unknown as Tracked[];
  const ctx = useRef<AudioContext | null>(null);
  const voices = useRef(new Map<string, Voice>());
  const viewRef = useRef(view); viewRef.current = view;
  const joinedRef = useRef(joined); joinedRef.current = joined;

  // One context, resumed on the first gesture (the autoplay policy).
  useEffect(() => {
    const ac = new AudioContext();
    ctx.current = ac;
    const resume = () => { void ac.resume(); };
    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
    return () => {
      window.removeEventListener('pointerdown', resume); window.removeEventListener('keydown', resume);
      for (const v of voices.current.values()) { v.source.disconnect(); v.gain.disconnect(); v.panner.disconnect(); }
      voices.current.clear();
      void ac.close(); ctx.current = null;
    };
  }, []);

  // A chain per participant, rebuilt when their track changes.
  useEffect(() => {
    const ac = ctx.current; if (!ac) return;
    const seen = new Set<string>();
    for (const p of joined) {
      const track = p.audioEnabled ? p.audioTrack : undefined;
      if (!track) { const old = voices.current.get(p.id); if (old) { old.source.disconnect(); old.gain.disconnect(); old.panner.disconnect(); voices.current.delete(p.id); } continue; }
      seen.add(p.id);
      const cur = voices.current.get(p.id);
      if (cur && cur.track === track) continue;
      if (cur) { cur.source.disconnect(); cur.gain.disconnect(); cur.panner.disconnect(); }
      const source = ac.createMediaStreamSource(new MediaStream([track]));
      const gain = new GainNode(ac, { gain: 0 });
      const panner = new PannerNode(ac, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1.8, maxDistance: 20, rolloffFactor: 1.4 });
      source.connect(gain).connect(panner).connect(ac.destination);
      voices.current.set(p.id, { source, gain, panner, track });
    }
    for (const [id, v] of [...voices.current]) if (!seen.has(id)) { v.source.disconnect(); v.gain.disconnect(); v.panner.disconnect(); voices.current.delete(id); }
    (window as unknown as { __roomVoices?: number }).__roomVoices = voices.current.size;
  }, [joined]);

  // Ten times a second: who is in my room, and where are they standing.
  useEffect(() => {
    const t = setInterval(() => {
      const ac = ctx.current; const v = viewRef.current;
      if (!ac || !v.room) return;
      const now = ac.currentTime;
      // The listener is your own body, which the venue stands nearest the camera.
      const L = ac.listener;
      if (L.positionX) { L.positionX.setTargetAtTime(0, now, 0.05); L.positionY.setTargetAtTime(1.5, now, 0.05); L.positionZ.setTargetAtTime(-2.2, now, 0.05); }
      else L.setPosition(0, 1.5, -2.2);
      const here = v.room.people;
      for (const p of joinedRef.current) {
        const voice = voices.current.get(p.id); if (!voice) continue;
        const i = here.findIndex((c) => c.playedBy && c.playedBy === p.name);
        const inHere = i >= 0;
        // ZERO ACROSS A DOOR. A voice from another room is not quieter; it is not in this room at all.
        voice.gain.gain.setTargetAtTime(inHere ? 1 : 0, now, 0.12);
        if (inHere) {
          const [x, z] = spotIn(v.room.id, i);
          voice.panner.positionX.setTargetAtTime(x, now, 0.1);
          voice.panner.positionY.setTargetAtTime(1.5, now, 0.1);
          voice.panner.positionZ.setTargetAtTime(z, now, 0.1);
        }
      }
    }, 100);
    return () => clearInterval(t);
  }, []);
  return null;
}
