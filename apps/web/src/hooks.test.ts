/**
 * NO HOOK AFTER AN EARLY RETURN.
 *
 * React counts hooks and matches the count between renders, so a `useState` placed after a
 * `if (!x) return …` makes the second render have more than the first. That is React error #310 —
 * a hard crash that takes the whole page to a white screen, not a warning.
 *
 * It happened twice in one afternoon on the canasta board, and neither time did a render test catch
 * it: `renderToStaticMarkup` renders ONCE, so the count is never compared. Only a real re-render or
 * this would have. So this reads the files.
 *
 * The check is deliberately blunt — first top-level `return` in a component, any hook call after it
 * — because the failure it prevents is total and the false-positive cost is moving a line up.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = ['src/components', 'src/pages'];
const HOOK = /\b(useState|useEffect|useLayoutEffect|useMemo|useCallback|useRef|useReducer|useContext|useId|useTransition|useDeferredValue|useSyncExternalStore)\s*[(<]/;
/** A `return` at the top level of a function body — two spaces of indent inside a component. */
const EARLY_RETURN = /^ {2}(if \(.*\)\s*)?return[\s(<;]/;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (/\.tsx$/.test(path)) out.push(path);
  }
  return out;
}

describe('every hook runs on every render', () => {
  const all = ROOTS.flatMap((r) => files(r));

  it('finds the components to check', () => {
    expect(all.length).toBeGreaterThan(10);
  });

  for (const path of ROOTS.flatMap((r) => files(r))) {
    it(`in ${path}`, () => {
      const lines = readFileSync(path, 'utf8').split('\n');
      let returnedAt: number | null = null;
      let fn: string | null = null;
      const offences: string[] = [];

      lines.forEach((line, i) => {
        // A `}` in column zero ENDS a top-level function, so the search starts again. Without this,
        // a `return` inside a small helper was blamed for every hook in the component below it.
        if (/^\}/.test(line)) {
          fn = null;
          returnedAt = null;
          return;
        }
        // …and any new top-level function starts a fresh body of its own.
        if (/^(export )?(async )?(function \w|const \w+\s*[:=].*=>)/.test(line)) {
          fn = line.trim();
          returnedAt = null;
        }
        if (returnedAt === null && EARLY_RETURN.test(line)) returnedAt = i + 1;
        // Comments and types mention hooks; only a call counts.
        else if (returnedAt !== null && HOOK.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)) {
          offences.push(`line ${i + 1} in ${fn ?? '(top level)'} — after the return on line ${returnedAt}: ${line.trim()}`);
        }
      });

      expect(offences, `hook after an early return — React #310 waiting to happen:\n${offences.join('\n')}`).toEqual([]);
    });
  }
});
