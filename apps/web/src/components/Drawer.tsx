import { useEffect, type ReactNode } from 'react';

/**
 * A FLYOUT for a detail — a panel from the right edge over the page, with the page still there behind it,
 * so going into one thing (a night, an invitation) never scrolls the page away from where the person was.
 * Escape and the backdrop close it; on a phone it takes the whole width.
 */
export function Drawer({ open, title, onClose, children, modal = true }: { open: boolean; title: string; onClose: () => void; children: ReactNode;
  /** `false` — no backdrop: the page behind stays live (a guest's details beside a hand still being dealt). */
  modal?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className={modal ? 'drawer-backdrop' : 'drawer-backdrop drawer-aside'} onClick={modal ? onClose : undefined} role="presentation">
      <aside className="drawer" role={modal ? 'dialog' : 'complementary'} aria-modal={modal ? 'true' : undefined} aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2>{title}</h2>
          <button type="button" className="quiet small" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}
