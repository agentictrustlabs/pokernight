import { useEffect, useState } from 'react';
import { nameAvailable, type AuthConfig } from '../lib/home';

/**
 * ONE LINE UNDER A NAME FIELD: the typed name the Home will claim, and whether it is free — asked on a
 * debounce, before the trip. A taken name is said here, where it can be changed, not at the Home's door.
 */
export function useNameCheck(config: AuthConfig | null, name: string, tld: 'workspace' | 'org'): { state: 'idle' | 'checking' | 'free' | 'taken' | 'unknown'; typed: string } {
  const [state, setState] = useState<'idle' | 'checking' | 'free' | 'taken' | 'unknown'>('idle');
  const [typed, setTyped] = useState('');
  useEffect(() => {
    const label = name.trim();
    if (!config || label.length < 3) { setState('idle'); setTyped(''); return; }
    setState('checking');
    let alive = true;
    const t = window.setTimeout(() => {
      nameAvailable(config, label, tld).then((r) => {
        if (!alive) return;
        if (!r) { setState('unknown'); return; }
        setTyped(r.name);
        setState(r.available ? 'free' : 'taken');
      });
    }, 400);
    return () => { alive = false; window.clearTimeout(t); };
  }, [config, name, tld]);
  return { state, typed };
}

export function NameCheck({ check, what }: { check: ReturnType<typeof useNameCheck>; what: string }) {
  if (check.state === 'idle' || check.state === 'unknown') return null;
  if (check.state === 'checking') return <span className="hint">Checking the name at your Home…</span>;
  if (check.state === 'taken') return <span className="form-warn">“{check.typed}” is already taken at the Home — pick another name for the {what}.</span>;
  return <span className="hint">Its agent will be <code>{check.typed}</code>.</span>;
}
