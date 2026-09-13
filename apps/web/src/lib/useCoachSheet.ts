import { useEffect, useState, type RefObject } from 'react';

/** The breakpoint under which the coach card becomes a sheet pinned to the bottom of the screen. */
export const PHONE_QUERY = '(max-width: 899px)';

/**
 * ON A PHONE THE COACH IS A SHEET AT THE BOTTOM, NOT A CARD AT THE END OF THE PAGE. The column layout put
 * the advice a full screen below the action buttons: the person pressed "Tell me", scrolled down to read
 * the move, scrolled up to press it. Under `PHONE_QUERY` the CSS pins `.panel.coach` to the bottom; this
 * hook measures the card and publishes its height as `--coach-sheet` on the root, so the page pads its
 * bottom by exactly that much and nothing hides behind the sheet — whether the coach is off (one line) or
 * mid-advice (a paragraph and a button).
 */
export function useCoachSheet(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const root = document.documentElement;
    let ro: ResizeObserver | null = null;
    const apply = () => {
      ro?.disconnect(); ro = null;
      if (!mq.matches || !ref.current) { root.style.setProperty('--coach-sheet', '0px'); return; }
      const el = ref.current;
      const set = () => root.style.setProperty('--coach-sheet', `${Math.ceil(el.getBoundingClientRect().height)}px`);
      set();
      ro = new ResizeObserver(set);
      ro.observe(el);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => { mq.removeEventListener('change', apply); ro?.disconnect(); root.style.setProperty('--coach-sheet', '0px'); };
  }, [ref]);
}

/** Whether the viewport is a phone's (`PHONE_QUERY`), kept current as it changes. */
export function usePhone(): boolean {
  const [phone, setPhone] = useState(() => (typeof window !== 'undefined' && 'matchMedia' in window ? window.matchMedia(PHONE_QUERY).matches : false));
  useEffect(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return;
    const mq = window.matchMedia(PHONE_QUERY);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

/**
 * ON A PHONE THE ACTION BAR IS THE BOTTOM SHEET. Fold, check, call, raise are what a thumb needs in reach on
 * every turn; a page that put them under the felt and the seats meant scrolling to play. Under `PHONE_QUERY`
 * the CSS pins `.actions.panel` to the bottom and the coach's strip above it; this publishes the bar's
 * height as `--action-sheet` so the coach sits on top of it and the page pads for both.
 */
export function useActionSheet(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const root = document.documentElement;
    let ro: ResizeObserver | null = null;
    const apply = () => {
      ro?.disconnect(); ro = null;
      if (!mq.matches || !ref.current) { root.style.setProperty('--action-sheet', '0px'); return; }
      const el = ref.current;
      const set = () => root.style.setProperty('--action-sheet', `${Math.ceil(el.getBoundingClientRect().height)}px`);
      set();
      ro = new ResizeObserver(set);
      ro.observe(el);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => { mq.removeEventListener('change', apply); ro?.disconnect(); root.style.setProperty('--action-sheet', '0px'); };
  }, [ref]);
}
