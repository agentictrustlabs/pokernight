import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * A WINDOW YOU CAN PICK UP. The huddle dock sits in the top-right corner; a person watching a table wants
 * the faces somewhere else — over the felt's empty side, by the chat, wherever the cards are not. So the
 * dock DETACHES into a floating window and is dragged by its title bar, and the place it was left is
 * remembered per browser. Pointer events, never HTML5 drag-and-drop (a touchscreen has no drag-and-drop,
 * and a mouse cannot always start one either — the card table's own rule). `null` is docked.
 */
export interface FloatingPosition {
  x: number;
  y: number;
}

const clamp = (pos: FloatingPosition, el: HTMLElement | null): FloatingPosition => {
  const w = el?.offsetWidth ?? 320;
  const h = el?.offsetHeight ?? 120;
  const maxX = Math.max(0, window.innerWidth - w);
  const maxY = Math.max(0, window.innerHeight - Math.min(h, 80));
  return { x: Math.min(Math.max(0, pos.x), maxX), y: Math.min(Math.max(0, pos.y), maxY) };
};

export function useDraggable(storageKey: string): {
  position: FloatingPosition | null;
  floating: boolean;
  ref: (el: HTMLElement | null) => void;
  onHandlePointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  /** Did the last press on the handle MOVE it? A title that toggles on click must not toggle after a drag. */
  dragged: () => boolean;
  detach: () => void;
  dock: () => void;
} {
  const [position, setPosition] = useState<FloatingPosition | null>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const v = JSON.parse(raw) as Partial<FloatingPosition>;
      return typeof v.x === 'number' && typeof v.y === 'number' ? { x: v.x, y: v.y } : null;
    } catch {
      return null;
    }
  });
  const el = useRef<HTMLElement | null>(null);
  const drag = useRef<{ dx: number; dy: number; pointerId: number; x0: number; y0: number; moved: boolean } | null>(null);
  const lastMoved = useRef(false);

  const remember = useCallback((pos: FloatingPosition | null) => {
    try {
      if (pos) localStorage.setItem(storageKey, JSON.stringify(pos));
      else localStorage.removeItem(storageKey);
    } catch {
      /* a browser that keeps nothing simply forgets the place */
    }
  }, [storageKey]);

  const ref = useCallback((node: HTMLElement | null) => { el.current = node; }, []);

  const onHandlePointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    // A press on one of the CONTROLS is that control's, not a drag; the title itself is the handle — its
    // click (fold / expand) is ignored when the press turned out to be a drag (`dragged`).
    if ((e.target as HTMLElement).closest('.huddle-controls, a, input')) return;
    const node = el.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    // Detaching by dragging: the first drag from the docked corner lifts the window from where it is.
    const start = position ?? { x: rect.left, y: rect.top };
    if (!position) { setPosition(start); remember(start); }
    drag.current = { dx: e.clientX - start.x, dy: e.clientY - start.y, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false };
    lastMoved.current = false;
    e.preventDefault();
  }, [position, remember]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;
      d.moved = true;
      lastMoved.current = true;
      setPosition(clamp({ x: e.clientX - d.dx, y: e.clientY - d.dy }, el.current));
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      drag.current = null;
      setPosition((p) => { remember(p); return p; });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [remember]);

  // A window left off-screen by a resize comes back into view.
  useEffect(() => {
    const onResize = () => setPosition((p) => (p ? clamp(p, el.current) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const detach = useCallback(() => {
    const rect = el.current?.getBoundingClientRect();
    const start = clamp({ x: (rect?.left ?? 40) - 40, y: (rect?.top ?? 40) + 40 }, el.current);
    setPosition(start);
    remember(start);
  }, [remember]);
  const dock = useCallback(() => { setPosition(null); remember(null); }, [remember]);

  const dragged = useCallback(() => lastMoved.current, []);
  return { position, floating: position !== null, ref, onHandlePointerDown, dragged, detach, dock };
}
