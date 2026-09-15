/**
 * A PORTRAIT AT THE SEAT (docs/SPATIAL-ROOM.md §3.2, phase 1 step 4). When the club's huddle is running, a
 * seated player's face sits where their monogram was: the camera when it is on, a lit initial when it is not,
 * and a ring when they are speaking. On the flat board it is the seat's avatar; in the room it hangs on the
 * name plate over the body. Nothing here opens media — the dock owns the call; this only finds the
 * participant the seat belongs to and puts their track on a <video>.
 *
 * MATCHED BY NAME. A seat knows its player's name and the huddle knows each participant's; both are the
 * session's display name, so a person who joined the huddle under the name they play under is found. A
 * name nobody in the huddle carries (a house bot, a member who has not joined) shows what it showed before.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RealtimeKitProvider, useRealtimeKitSelector } from '@cloudflare/realtimekit-react';
import { useClubHuddleMaybe } from './ClubHuddleProvider';

export type FaceTrack = {
  id: string; name: string;
  audioEnabled: boolean;
  videoEnabled: boolean; videoTrack?: MediaStreamTrack;
  on: (ev: string, fn: (p: unknown) => void) => void; off: (ev: string, fn: (p: unknown) => void) => void;
};

/**
 * A participant's camera on a <video>, following the SDK's `videoUpdate`. Returns the ref to hang on the
 * element and whether there is a picture to show.
 *
 * PLAY IS ASKED FOR MORE THAN ONCE. Firefox in particular will attach a stream to a <video> that is not yet
 * visible and then sit on the first frame — black — until something calls play() again; a remote track also
 * arrives MUTED (no frames yet) and unmutes when the first frame lands. So play() is asked at attach, when
 * the metadata loads, when the track unmutes, and when the element is shown.
 */
export function useFaceVideo(p: FaceTrack): { ref: React.RefObject<HTMLVideoElement>; on: boolean } {
  const ref = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(!!p.videoEnabled);
  useEffect(() => {
    const el = ref.current;
    const kick = () => { if (el && el.srcObject) void el.play().catch(() => undefined); };
    const attach = (track?: MediaStreamTrack, enabled?: boolean) => {
      setOn(!!enabled && !!track);
      if (!el) return;
      if (enabled && track) {
        el.srcObject = new MediaStream([track]);
        track.addEventListener('unmute', kick);
        kick();
      } else el.srcObject = null;
    };
    attach(p.videoTrack, p.videoEnabled);
    el?.addEventListener('loadedmetadata', kick);
    const onVideo = (payload: unknown) => { const x = payload as { videoEnabled: boolean; videoTrack: MediaStreamTrack }; attach(x.videoTrack, x.videoEnabled); };
    p.on('videoUpdate', onVideo);
    return () => { p.off('videoUpdate', onVideo); el?.removeEventListener('loadedmetadata', kick); if (el) el.srcObject = null; };
  }, [p]);
  useEffect(() => { if (on && ref.current?.srcObject) void ref.current.play().catch(() => undefined); }, [on]);
  return { ref, on };
}

function Found({ p, mine, speaking, size }: { p: FaceTrack; mine: boolean; speaking: boolean; size: 'seat' | 'plate' }) {
  const { ref, on } = useFaceVideo(p);
  return (
    <figure className={`portrait portrait-${size}${on ? ' video' : ''}${speaking ? ' speaking' : ''}${mine ? ' mine' : ''}`} title={mine ? `${p.name} (you) · in the huddle` : `${p.name} · in the huddle`}>
      <video ref={ref} autoPlay playsInline muted style={on ? undefined : { display: 'none' }} />
      {!on ? <span className="portrait-initial" aria-hidden="true">{(p.name || '?').slice(0, 1).toUpperCase()}</span> : null}
      <span className={`portrait-mic${p.audioEnabled ? ' on' : ''}`} aria-hidden="true" />
    </figure>
  );
}

/** Under the provider: find the participant this name belongs to, or show what was there before. */
function Match({ name, size, fallback }: { name: string; size: 'seat' | 'plate'; fallback: ReactNode }) {
  const joined = useRealtimeKitSelector((m) => m.participants.joined.toArray()) as unknown as FaceTrack[];
  const active = useRealtimeKitSelector((m) => m.participants.active.toArray()) as unknown as FaceTrack[];
  const self = useRealtimeKitSelector((m) => m.self) as unknown as FaceTrack;
  const want = name.trim().toLowerCase();
  const mine = !!self?.name && self.name.trim().toLowerCase() === want;
  const p = mine ? self : joined.find((x) => x.name?.trim().toLowerCase() === want) ?? null;
  if (!p) return <>{fallback}</>;
  const speaking = !!p.audioEnabled && active.some((a) => a.id === p.id);
  return <Found p={p} mine={mine} speaking={speaking} size={size} />;
}

/**
 * The face of whoever plays under this name, if they are in the club's huddle; `fallback` otherwise. Safe to
 * mount anywhere under `ClubHuddleProvider` — when no huddle runs it is the fallback and nothing else.
 */
export function Portrait({ name, size = 'seat', fallback = null }: { name: string; size?: 'seat' | 'plate'; fallback?: ReactNode }) {
  const h = useClubHuddleMaybe();
  if (!h?.current || !h.meeting) return <>{fallback}</>;
  return <RealtimeKitProvider value={h.meeting}><Match name={name} size={size} fallback={fallback} /></RealtimeKitProvider>;
}
