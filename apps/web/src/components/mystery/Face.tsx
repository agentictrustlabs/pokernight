import type { Look } from '@pokernight/mystery';

/**
 * A CHARACTER'S FACE, drawn from the few dials the title authored (`Look`).
 *
 * EIGHT PEOPLE IN A ROOM HAVE TO BE TOLD APART AT A GLANCE, and a transcript of eight names is not a room —
 * it is a log. This is an SVG built from parameters rather than eight shipped portraits: nothing to license,
 * nothing to download, the same face every night, and the next title's cast draws itself.
 *
 * SPEAKING IS SHOWN, because in a story the question is always who is talking: the mouth opens and the disc
 * behind the head lights while a line is theirs. `prefers-reduced-motion` gets the ring and no movement.
 */
export function Face({ look, name, size = 40, speaking = false, dead = false }: {
  look: Look; name: string; size?: number; speaking?: boolean; dead?: boolean;
}) {
  const hair = look.hair;
  return (
    <svg
      className={`m-face${speaking ? ' speaking' : ''}${dead ? ' dead' : ''}`}
      width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={name}
    >
      <circle cx="50" cy="50" r="49" fill={look.accent} />
      {/* shoulders */}
      <path d="M12 100 C18 78 34 70 50 70 C66 70 82 78 88 100 Z" fill={look.wear} />
      {/* long hair falls behind the head */}
      {look.hairStyle === 'long' ? <path d="M22 44 C22 20 78 20 78 44 L80 76 L68 70 L68 40 L32 40 L32 70 L20 76 Z" fill={hair} /> : null}
      {look.hairStyle === 'curls' ? <g fill={hair}><circle cx="28" cy="34" r="11" /><circle cx="50" cy="26" r="12" /><circle cx="72" cy="34" r="11" /><circle cx="26" cy="50" r="9" /><circle cx="74" cy="50" r="9" /></g> : null}
      {/* head */}
      <ellipse cx="50" cy="46" rx="24" ry="27" fill={look.skin} />
      {/* ears */}
      <circle cx="25" cy="48" r="5" fill={look.skin} />
      <circle cx="75" cy="48" r="5" fill={look.skin} />
      {/* hair on top */}
      {look.hairStyle === 'short' ? <path d="M26 42 C26 22 74 22 74 42 C70 32 58 28 50 28 C40 28 30 32 26 42 Z" fill={hair} /> : null}
      {look.hairStyle === 'bun' ? <g fill={hair}><path d="M26 44 C26 22 74 22 74 44 C70 30 58 26 50 26 C40 26 30 30 26 44 Z" /><circle cx="50" cy="16" r="9" /></g> : null}
      {look.hairStyle === 'bald' ? <path d="M27 46 C27 40 30 36 34 34 C30 38 28 42 28 46 Z" fill={hair} /> : null}
      {look.hairStyle === 'cap' ? <g><path d="M24 40 C24 20 76 20 76 40 Z" fill={look.wear} /><rect x="22" y="38" width="56" height="6" rx="3" fill={look.wear} /></g> : null}
      {/* brows and eyes */}
      <rect x="34" y="40" width="12" height="3" rx="1.5" fill={hair} />
      <rect x="54" y="40" width="12" height="3" rx="1.5" fill={hair} />
      <circle className="m-eye" cx="40" cy="48" r="3.4" fill="#22262a" />
      <circle className="m-eye" cx="60" cy="48" r="3.4" fill="#22262a" />
      {/* mouth — it opens while they are talking */}
      <ellipse className="m-mouth" cx="50" cy="60" rx="7" ry={speaking ? 4.5 : 1.4} fill="#7c3a3a" />
      {look.facial === 'moustache' ? <path d="M38 56 C44 52 56 52 62 56 C56 55 44 55 38 56 Z" fill={hair} /> : null}
      {look.facial === 'stubble' ? <path d="M32 56 C36 70 64 70 68 56 C64 66 36 66 32 56 Z" fill={hair} opacity="0.35" /> : null}
      {look.facial === 'beard' ? <path d="M30 52 C30 74 70 74 70 52 C66 68 34 68 30 52 Z" fill={hair} opacity="0.9" /> : null}
      {/* what they wear on the face */}
      {look.accessory === 'glasses' ? (
        <g fill="none" stroke="#2b2f33" strokeWidth="2.5">
          <circle cx="40" cy="48" r="8" /><circle cx="60" cy="48" r="8" /><path d="M48 48 H52" /><path d="M32 47 L25 45" /><path d="M68 47 L75 45" />
        </g>
      ) : null}
      {look.accessory === 'goggles' ? (
        <g><rect x="28" y="40" width="44" height="14" rx="7" fill="#1d2a30" opacity="0.85" /><rect x="31" y="43" width="38" height="8" rx="4" fill="#8fc7d8" opacity="0.7" /></g>
      ) : null}
      {look.accessory === 'veil' ? <path d="M24 30 C24 66 76 66 76 30 C76 58 24 58 24 30 Z" fill="#15161b" opacity="0.45" /> : null}
      {look.accessory === 'scarf' ? <path d="M24 72 C36 66 64 66 76 72 L74 82 C62 76 38 76 26 82 Z" fill="#a4483c" /> : null}
      {look.accessory === 'pearls' ? <g fill="#f3ece0"><circle cx="38" cy="76" r="2.6" /><circle cx="46" cy="79" r="2.6" /><circle cx="54" cy="79" r="2.6" /><circle cx="62" cy="76" r="2.6" /></g> : null}
      {dead ? <g stroke="#c9c2b4" strokeWidth="3" opacity="0.9"><path d="M34 44 L46 52" /><path d="M46 44 L34 52" /><path d="M54 44 L66 52" /><path d="M66 44 L54 52" /></g> : null}
    </svg>
  );
}
