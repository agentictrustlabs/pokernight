/** Visually hidden aria-live region: turn changes and hand results reach screen readers. */
export function Announcer({ message }: { message: string }) {
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}
