/**
 * WHAT IS BEHIND YOU ON CAMERA — and, if you like, the room your character is standing in.
 *
 * Cloudflare's RealtimeKit ships a video background transformer (`@cloudflare/realtimekit-virtual-background`):
 * a middleware on your own outgoing video that either blurs what is behind you or replaces it with a picture.
 * Two things make it worth having here rather than being a settings-page curiosity:
 *
 *  - PEOPLE ARE CALLING FROM THEIR KITCHENS. A card room and a snowed-in hotel are places; somebody's laundry
 *    behind them is the one thing that is not. Blur is one press and costs them nothing.
 *  - THE ROOM YOU ARE IN IS ALREADY DRAWN. The lounge and the Belvedere are rendered on a canvas a few pixels
 *    from your own face, so a still of it makes a background nobody else on the internet has: your camera sits
 *    in the very room your body is standing in. It is a SNAPSHOT, taken when you ask for it, not a live feed —
 *    a per-frame render of the scene into a video middleware would cost more than the night is worth.
 *
 * It is lazily imported, because it carries a segmentation model and nobody who never turns their camera on
 * should download it. Unsupported browsers say so and keep their real background, which is not a failure.
 */

export type HuddleBackdrop = 'none' | 'blur' | 'room';

/** The 3D canvas the page is showing, if it is showing one — the lounge or the venue. */
function sceneCanvas(): HTMLCanvasElement | null {
  const c = document.querySelector('.lounge canvas, .venue canvas');
  return c instanceof HTMLCanvasElement ? c : null;
}

/**
 * A still of the room, as a data URL. PlayCanvas clears its drawing buffer after presenting, so the pixels are
 * only there to be read inside a frame — the canvas is asked to draw one more and is read in the same tick.
 */
export function roomStill(): string | null {
  const c = sceneCanvas();
  if (!c) return null;
  try {
    const shot = document.createElement('canvas');
    shot.width = Math.min(1280, c.width); shot.height = Math.round((shot.width / c.width) * c.height);
    const g = shot.getContext('2d');
    if (!g) return null;
    g.drawImage(c, 0, 0, shot.width, shot.height);
    const url = shot.toDataURL('image/jpeg', 0.82);
    // an empty read comes back as a uniform frame; a few hundred bytes means we got nothing worth wearing
    return url.length > 4000 ? url : null;
  } catch { return null; }
}

interface Middleware { /* opaque to us; the SDK hands it back and takes it back */ }
interface SelfWithMiddleware {
  addVideoMiddleware: (m: Middleware) => void | Promise<void>;
  removeVideoMiddleware: (m: Middleware) => void | Promise<void>;
  setVideoMiddlewareGlobalConfig?: (c: { disablePerFrameCanvasRendering: boolean }) => Promise<void>;
}

let transformer: { createStaticBackgroundVideoMiddleware: (url: string) => Promise<Middleware>; createBackgroundBlurVideoMiddleware: (n: number) => Promise<Middleware> } | null = null;
let applied: Middleware | null = null;
let forMeeting: unknown = null;

/** Put a backdrop behind you (or take it away). Returns what it managed to do. */
export async function setBackdrop(meeting: unknown, want: HuddleBackdrop, still?: string | null): Promise<HuddleBackdrop | 'unsupported'> {
  const self = (meeting as { self?: SelfWithMiddleware } | null)?.self;
  if (!self) return 'none';
  // TAKE THE OLD ONE OFF FIRST, always: two middlewares stacked is two segmentations per frame.
  if (applied) { try { await self.removeVideoMiddleware(applied); } catch { /* it was already gone */ } applied = null; }
  if (want === 'none') return 'none';
  try {
    const mod = await import('@cloudflare/realtimekit-virtual-background');
    const RealtimeKitVideoBackgroundTransformer = (mod as { default?: unknown }).default ?? mod;
    const T = RealtimeKitVideoBackgroundTransformer as {
      isSupported?: () => boolean;
      init: (o: { meeting: unknown }) => Promise<typeof transformer>;
    };
    if (T.isSupported && !T.isSupported()) return 'unsupported';
    if (!transformer || forMeeting !== meeting) {
      // the package asks for this: it renders the frames itself, rather than once per middleware per frame
      try { await self.setVideoMiddlewareGlobalConfig?.({ disablePerFrameCanvasRendering: true }); } catch { /* older SDK */ }
      transformer = await T.init({ meeting });
      forMeeting = meeting;
    }
    if (!transformer) return 'unsupported';
    const m = want === 'blur'
      ? await transformer.createBackgroundBlurVideoMiddleware(55)
      : still ? await transformer.createStaticBackgroundVideoMiddleware(still) : null;
    if (!m) return 'none';
    await self.addVideoMiddleware(m);
    applied = m;
    return want;
  } catch {
    return 'unsupported';
  }
}
