/** Who is speaking right now, by name — set by the placed voices, read by the bodies every frame. */
const now = new Set<string>();
export function setSpeaking(names: Iterable<string>): void { now.clear(); for (const n of names) now.add(n.trim().toLowerCase()); }
export function isSpeaking(name: string): boolean { return now.has(name.trim().toLowerCase()); }
