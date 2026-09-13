/**
 * THE DOCK — small, persistent, above the pages: who is here (faces when cameras are on, initials when
 * not), who is speaking, the mic, the camera, the screen, leave — and end for whoever may. The media
 * itself touches the page here and nowhere else: each remote participant's audio on an <audio>, each
 * camera and shared screen on a <video>. The card table underneath keeps dealing.
 */
import { useEffect, useRef, useState } from 'react';
import { useDraggable } from '../../lib/useDraggable';
import { RealtimeKitProvider, useRealtimeKitSelector } from '@cloudflare/realtimekit-react';
import { useClubHuddle } from './ClubHuddleProvider';
import type { HuddleScope } from '../../lib/huddle';

type Tracked = {
  id: string; name: string;
  audioEnabled: boolean; audioTrack?: MediaStreamTrack;
  videoEnabled: boolean; videoTrack?: MediaStreamTrack;
  screenShareEnabled: boolean; screenShareTracks?: { audio?: MediaStreamTrack; video?: MediaStreamTrack };
  on: (ev: string, fn: (p: unknown) => void) => void; off: (ev: string, fn: (p: unknown) => void) => void;
};

/** One participant's audio: an <audio> whose stream follows the SDK's `audioUpdate`. */
function ParticipantAudio({ p }: { p: Tracked }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const attach = (track?: MediaStreamTrack, enabled?: boolean) => {
      if (enabled && track) { el.srcObject = new MediaStream([track]); void el.play().catch(() => undefined); } else el.srcObject = null;
    };
    attach(p.audioTrack, p.audioEnabled);
    const onAudio = (payload: unknown) => { const x = payload as { audioEnabled: boolean; audioTrack: MediaStreamTrack }; attach(x.audioTrack, x.audioEnabled); };
    p.on('audioUpdate', onAudio);
    return () => { p.off('audioUpdate', onAudio); el.srcObject = null; };
  }, [p]);
  return <audio ref={ref} autoPlay playsInline />;
}

/** A face: a participant's camera on a <video> when it is on, their initial when it is not. */
function Face({ p, mine, speaking }: { p: Tracked; mine?: boolean; speaking: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(!!p.videoEnabled);
  useEffect(() => {
    const el = ref.current;
    // PLAY IS ASKED FOR MORE THAN ONCE. Firefox in particular will attach a stream to a <video> that is not
    // yet visible and then sit on the first frame — black — until something calls play() again; a remote
    // track also arrives MUTED (no frames yet) and unmutes when the first frame lands. So play() is asked at
    // attach, when the metadata loads, when the track unmutes, and when the element is shown.
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
  return (
    <figure className={`huddle-face${speaking ? ' speaking' : ''}${mine ? ' mine' : ''}${on ? ' video' : ''}`} title={mine ? `${p.name} (you)` : p.name}>
      <video ref={ref} autoPlay playsInline muted style={on ? undefined : { display: 'none' }} />
      {!on ? <span className="huddle-initial" aria-hidden="true">{(p.name || '?').slice(0, 1).toUpperCase()}</span> : null}
      <figcaption>{mine ? 'you' : p.name}</figcaption>
    </figure>
  );
}

/** A shared screen (a remote participant's, or your own as a preview), on a <video>. */
function ScreenVideo({ p, mine }: { p: Tracked; mine?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const attach = (tracks?: { audio?: MediaStreamTrack; video?: MediaStreamTrack }, enabled?: boolean) => {
      const list = enabled ? [tracks?.video, ...(mine ? [] : [tracks?.audio])].filter((t): t is MediaStreamTrack => !!t) : [];
      el.srcObject = list.length ? new MediaStream(list) : null;
      if (list.length) void el.play().catch(() => undefined);
    };
    attach(p.screenShareTracks, p.screenShareEnabled);
    const onShare = (payload: unknown) => { const x = payload as { screenShareEnabled: boolean; screenShareTracks: { audio?: MediaStreamTrack; video?: MediaStreamTrack } }; attach(x.screenShareTracks, x.screenShareEnabled); };
    p.on('screenShareUpdate', onShare);
    return () => { p.off('screenShareUpdate', onShare); el.srcObject = null; };
  }, [p, mine]);
  return (
    <figure className="huddle-screen">
      <video ref={ref} autoPlay playsInline muted={!!mine} />
      <figcaption>{mine ? 'Your screen' : `${p.name}'s screen`}</figcaption>
    </figure>
  );
}

function Media({ open }: { open: boolean }) {
  const joined = useRealtimeKitSelector((m) => m.participants.joined.toArray()) as unknown as Tracked[];
  const active = useRealtimeKitSelector((m) => m.participants.active.toArray()) as unknown as Tracked[];
  const self = useRealtimeKitSelector((m) => m.self) as unknown as Tracked;
  const speaking = new Set(active.map((p) => p.id));
  const sharing = joined.filter((p) => p.screenShareEnabled);
  const anyVideo = self.videoEnabled || joined.some((p) => p.videoEnabled);
  return (
    <>
      {joined.map((p) => <ParticipantAudio key={p.id} p={p} />)}
      <div className={`huddle-faces${open || anyVideo ? ' open' : ''}`} aria-label="Who is here">
        <Face p={self} mine speaking={!!self.audioEnabled && speaking.has(self.id)} />
        {joined.map((p) => <Face key={p.id} p={p} speaking={speaking.has(p.id)} />)}
      </div>
      {(self.screenShareEnabled || sharing.length > 0) ? (
        <div className="huddle-screens">
          {self.screenShareEnabled ? <ScreenVideo p={self} mine /> : null}
          {sharing.map((p) => <ScreenVideo key={p.id} p={p} />)}
        </div>
      ) : null}
    </>
  );
}

export function ClubHuddleDock() {
  const h = useClubHuddle();
  const [open, setOpen] = useState(false);
  // THE DOCK CAN BE PICKED UP: detached, it is a floating window dragged by its title bar, left where the
  // person put it (remembered per browser); docked, it sits in the corner as before. Either way the call
  // underneath is the same one — nothing reconnects when the window moves.
  const drag = useDraggable('pokernight.huddle.position');
  if (!h.current || !h.meeting) {
    return h.error ? <div className="huddle-dock huddle-dock-error" role="status">{h.error} <button type="button" className="link-button" onClick={h.dismissError}>dismiss</button></div> : null;
  }
  const c = h.current;
  const canEnd = c.role === 'host';
  return (
    <RealtimeKitProvider value={h.meeting}>
      <div
        ref={drag.ref}
        className={`huddle-dock${open ? ' open' : ''}${drag.floating ? ' floating' : ''}`}
        style={drag.position ? { left: drag.position.x, top: drag.position.y } : undefined}
        role="region"
        aria-label="Club huddle"
      >
        <div className="huddle-dock-row huddle-handle" onPointerDown={drag.onHandlePointerDown} title="Drag to move">
          <button type="button" className="huddle-title" onClick={() => { if (!drag.dragged()) setOpen((o) => !o); }} title={open ? 'Fold' : 'Expand'}>
            <span className="huddle-live" aria-hidden="true" />
            <span>Huddle · {c.scopeName}</span>
            <span className="hint"> · {c.run.roster.filter((r) => r.joined).length} here</span>
          </button>
          <div className="huddle-controls">
            <button type="button" className="huddle-btn quiet" onClick={() => (drag.floating ? drag.dock() : drag.detach())} title={drag.floating ? 'Put it back in the corner' : 'Float it — then drag it anywhere by its title'}>{drag.floating ? 'Dock' : 'Float'}</button>
            <button type="button" className={`huddle-btn${h.micOn ? ' on' : ''}`} onClick={() => void h.toggleMic()} aria-pressed={h.micOn} title={h.micOn ? 'Mute' : 'Unmute'}>{h.micOn ? 'Mic on' : 'Mic off'}</button>
            <button type="button" className={`huddle-btn${h.camOn ? ' on' : ''}`} onClick={() => void h.toggleCam()} aria-pressed={h.camOn} title={h.camOn ? 'Camera off' : 'Camera on'}>{h.camOn ? 'Camera on' : 'Camera off'}</button>
            <button type="button" className={`huddle-btn${h.screenOn ? ' on' : ''}`} onClick={() => void h.toggleScreen()} aria-pressed={h.screenOn} title={h.screenOn ? 'Stop sharing' : 'Share your screen'}>Screen</button>
            <button type="button" className="huddle-btn leave" onClick={() => void h.leave()} disabled={!!h.busy}>Leave</button>
            {canEnd ? <button type="button" className="huddle-btn end" onClick={() => { if (confirm('End this huddle for everyone?')) void h.end(); }} disabled={!!h.busy}>End</button> : null}
          </div>
        </div>
        <Media open={open} />
        {h.error ? <div className="huddle-dock-error">{h.error} <button type="button" className="link-button" onClick={h.dismissError}>dismiss</button></div> : null}
        {open ? <p className="huddle-note hint">Audio, cameras and screens go straight to the call. Who may be here is the club's roster — hosts and members, playing or watching.</p> : null}
      </div>
    </RealtimeKitProvider>
  );
}

/** The affordance on a club (and on its tables): start, or join the one already running. */
export function HuddleAffordance({ scope, scopeName, compact = false }: { scope: HuddleScope | null; scopeName: string; compact?: boolean }) {
  const h = useClubHuddle();
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    if (!scope || !h.offered) return;
    let on = true;
    const look = () => { void h.peek(scope).then((r) => { if (on) setActive(r && r.state === 'active' ? r.roster.filter((x) => x.joined).length : 0); }); };
    look();
    const t = setInterval(look, 15_000);
    return () => { on = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h.peek, h.offered, scope?.principal, scope?.id]);
  if (!scope || !h.offered) return null;
  const here = h.current && h.current.scope.principal === scope.principal && h.current.scope.id === scope.id;
  if (here) return <span className="huddle-here">● In the huddle</span>;
  if (h.current) return null;
  const running = (active ?? 0) > 0;
  return (
    <button type="button" className={`huddle-start${running ? ' running' : ''}${compact ? ' compact' : ''}`} disabled={!!h.busy} onClick={() => void (running ? h.join(scope, scopeName) : h.start(scope, scopeName))} title={running ? `${active} in the huddle — join` : 'Start a huddle for the club: voice, faces, and the table'}>
      {h.busy ?? (running ? `● Join the huddle (${active})` : compact ? 'Huddle' : 'Start a huddle')}
    </button>
  );
}
