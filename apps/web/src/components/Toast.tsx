import { useEffect } from 'react';

export function Toast({ error, onDismiss }: { error: { code: string; message: string } | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!error) return;
    const h = setTimeout(onDismiss, 8000);
    return () => clearTimeout(h);
  }, [error, onDismiss]);
  if (!error) return null;
  return (
    <div className="toast" role="alert">
      <div>
        <div>{error.message}</div>
        <code>{error.code}</code>
      </div>
      <button className="small" onClick={onDismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
