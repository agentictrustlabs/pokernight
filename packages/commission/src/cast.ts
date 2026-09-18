/**
 * THE HOUSE PLAYS A PART — the engine's own policy for a character nobody is playing and no agent is asked for.
 *
 * It costs nobody anything and never keeps the night waiting. It is deliberately DUTIFUL rather than clever:
 * it testifies at the room's grain and never finer, it corroborates readings its vault supports, the researcher
 * walks the questions and publishes the highest phase two witnesses reach, the funder commits against a need,
 * the adversary infers from whatever fine grain has leaked — and nobody invents a number. A house-played cast
 * is the CONTROL: if the rails fail with these characters, the failure is in the substrate, not in a model's
 * judgement.
 *
 * Deterministic in `tick`, so a replay of a night reproduces the house's moves exactly.
 */
import type { CommissionAction, CommissionView, PhaseNumber, Phase, Strength } from './types.js';
import { WALK, coarserOrEqual } from './types.js';

export interface CastLines { greet: string; probe: string; deflect: string; press: string; report: string }

const pick = <T,>(xs: readonly T[], tick: number): T | undefined => (xs.length ? xs[tick % xs.length] : undefined);

/** The highest phase at least `n` distinct witnesses' received testimony reaches, for one people. */
function corroboratedPhase(view: CommissionView, people: string, n: number): PhaseNumber | null {
  const bySupport = new Map<PhaseNumber, Set<string>>();
  for (const r of view.you?.received ?? []) {
    if (r.people !== people || r.revoked) continue;
    for (const w of WALK) if (r.supports >= w.phase) (bySupport.get(w.phase) ?? bySupport.set(w.phase, new Set()).get(w.phase)!).add(r.from);
  }
  let best: PhaseNumber | null = null;
  for (const w of WALK) if ((bySupport.get(w.phase)?.size ?? 0) >= n) best = w.phase;
  return best;
}

/**
 * THE DRAWN SOURCE'S MOVE, when the house is playing that part. It is not a KIND any more (all seven briefs are
 * legitimate); it is a fact only that part's own view carries, so the policy reads `you.source` and nothing else.
 */
function sourceMove(view: CommissionView, lines: CastLines, tick: number): { action: CommissionAction; line: string } | null {
  const you = view.you;
  if (!you?.source) return null;
  const fine = (you.received ?? []).filter((r) => !r.revoked && (r.grain === 'city' || r.grain === 'household' || r.grain === 'person'));
  const target = pick(fine, tick);
  if (target && view.phase === 'closing') {
    const place = target.text.match(/\b(?:in|at|near) ([A-Z][a-z]+)/)?.[1];
    return { action: { type: 'infer', people: target.people, ...(place ? { place } : {}) }, line: lines.report };
  }
  if (view.phase === 'closing') return { action: { type: 'say', text: lines.press }, line: lines.press };
  return null;
}

export function chooseAction(view: CommissionView, lines: CastLines, tick: number): { action: CommissionAction; line?: string } | null {
  const you = view.you;
  if (!you || !view.room) return null;
  if (you.silent) return null;
  const here = view.room;
  // Being the drawn source comes FIRST and is read from the view, never from a kind: any of the seven may be it.
  const carrying = sourceMove(view, lines, tick);
  if (carrying) return carrying;

  switch (you.kind) {
    case 'researcher': {
      // Publish where two witnesses agree and the picture has not caught up; otherwise ask the next question.
      for (const p of view.peoples) {
        const phase = corroboratedPhase(view, p.id, 2);
        if (phase !== null && (p.reading === null || Number(p.reading.phase === '0-R' ? 0 : p.reading.phase) < phase)) {
          const strength: Strength = phase >= 5 ? 'active' : phase >= 3 ? 'growing' : 'initial';
          return { action: { type: 'assess', people: p.id, phase, strength }, line: `${p.name}: two of you say ${WALK.find((w) => w.phase === phase)?.question.replace(/\?$/, '').toLowerCase()} — I am publishing it as ${phase}.` };
        }
      }
      const q = pick(WALK, tick);
      return { action: { type: 'say', text: `${lines.probe} ${q?.question ?? ''}`.trim() }, line: `${lines.probe} ${q?.question ?? ''}`.trim() };
    }
    case 'welcomer': {
      // The warmest person in the room, and the least disciplined: tells the story to whoever is listening.
      const mine = (you.vault ?? []).filter((v) => !v.revoked);
      const item = pick(mine, tick);
      if (item && here) {
        const g = (item.projections ?? []).filter((x) => x.allowedHere).slice(-1)[0];
        if (g) return { action: { type: 'testify', people: item.people, evidence: item.id, grain: g.grain }, line: g.text };
      }
      return { action: { type: 'say', text: lines.greet }, line: lines.greet };
    }

    case 'funder': {
      const need = view.peoples.find((p) => p.need && !view.commitments.some((c) => c.people === p.id && c.by === you.role));
      if (need?.need) return { action: { type: 'commit', people: need.id, need: need.need, resource: 'a two-year grant' }, line: `${need.name}: I will fund ${need.need}. I need to be able to show my board what it bought.` };
      return { action: { type: 'say', text: lines.press }, line: lines.press };
    }
    default: {
      // A CARRIER: testify to something not yet said here, at the room's grain — never finer.
      const said = new Set(view.transcript.filter((e) => e.type === 'testified' && e.by === you.role).map((e) => (e as { disclosure: string }).disclosure));
      const items = you.vault.filter((v) => !v.revoked);
      const fresh = items.find((v) => !view.transcript.some((e) => e.type === 'testified' && e.by === you.role && (e as { people: string }).people === v.people && (e as { room: string }).room === here.id));
      if (fresh) {
        const grain = fresh.projections.filter((p) => p.allowedHere && coarserOrEqual(p.grain, fresh.grain)).sort((a, b) => (a.grain < b.grain ? -1 : 1))[0];
        const at = grain ?? fresh.projections.find((p) => p.grain === here.grain) ?? fresh.projections[fresh.projections.length - 1];
        if (at) return { action: { type: 'testify', people: fresh.people, evidence: fresh.id, grain: at.grain }, line: at.text };
      }
      // Nothing new to add: confirm a reading the vault supports.
      for (const p of view.peoples) {
        const r = p.reading;
        if (!r) continue;
        const mine = items.filter((v) => v.people === p.id).map((v) => v.supports);
        const target: Phase = r.phase;
        if (mine.some((s) => s >= (target === '0-R' ? 0 : target)) && !view.transcript.some((e) => e.type === 'corroborated' && (e as { people: string }).people === p.id && (e as { saw?: string[] }).saw?.includes(you.role) && tick % 3 === 0)) {
          return { action: { type: 'corroborate', people: p.id, phase: target }, line: `${p.name}: what I hold agrees with that reading.` };
        }
      }
      void said;
      return { action: { type: 'say', text: pick([lines.greet, lines.deflect], tick) ?? lines.greet }, line: pick([lines.greet, lines.deflect], tick) };
    }
  }
}
