/**
 * THE HOUSE PLAYS A PART — the engine's own policy for a part nobody is playing and no agent answered for.
 *
 * Dutiful rather than clever, and deterministic in `tick`. IT BOOTSTRAPS FROM THE PLAN: the first-listed member of
 * an intended team founds it where they stand on day one and asks the others; the asked join on their next turn;
 * nobody works a circle until they are on a team. Then a worker goes where its team's community is, shares
 * until there are seekers, studies until there are believers, founds a circle, gathers it, baptises, trains,
 * recognises when the circle qualifies, and sends when the church can; a coach coaches whoever is most tired; the
 * steward publishes whatever the records derive; a partner commits its support early. A house-played cast is the
 * CONTROL: the agents are measured against it.
 */
import type { FieldOpsAction, FieldOpsView, ViewBody, ViewCommunity } from './types.js';

export interface CastLines { greet: string; probe: string; report: string; press: string; rest: string }

const pick = <T,>(xs: readonly T[], tick: number): T | undefined => (xs.length ? xs[tick % xs.length] : undefined);

function saidLately(view: FieldOpsView, text: string): boolean {
  const me = view.you?.role;
  const t = text.trim().toLowerCase();
  return view.transcript.filter((e) => e.type === 'said' && e.by === me).slice(-6).some((e) => e.type === 'said' && e.text.trim().toLowerCase() === t);
}
const lineForOnce = (view: FieldOpsView, text: string): string | undefined => (saidLately(view, text) ? undefined : text);
const sayOnce = (view: FieldOpsView, text: string | undefined): { action: FieldOpsAction; line: string } | null =>
  !text || saidLately(view, text) ? null : { action: { type: 'say', text }, line: text };

/** The community in most need of this part's next act, among those its team works. */
function target(view: FieldOpsView, tick: number): ViewCommunity | undefined {
  const you = view.you;
  if (!you) return undefined;
  const team = view.teams.find((t) => t.id === you.team);
  const corridor = team?.corridor ?? you.intended?.corridor;
  // Only a community somebody has taken up is work; the house prefers its own team's.
  const worked = view.communities.filter((c) => c.workedBy);
  const own = worked.filter((c) => c.workedBy === you.team);
  const mine = (own.length ? own : worked).filter((c) => !corridor || c.corridor === corridor || !own.length);
  // The lowest derived phase first; ties broken by the tick so two workers do not pile onto one people.
  const sorted = [...mine].sort((a, b) => a.derived - b.derived);
  const low = sorted.filter((c) => c.derived === sorted[0]?.derived);
  return pick(low, tick) ?? sorted[0];
}

export function chooseAction(view: FieldOpsView, lines: CastLines, tick: number): { action: FieldOpsAction; line?: string } | null {
  const you = view.you;
  if (!you) return null;
  const may = new Set(you.may.map((m) => m.action));
  // A DECISION BEFORE YOU is taken before the day's work — by the house, the first option, which is written to be the
  // steadier one; an agent may choose otherwise, and the score shows what each chose.
  if (may.has('choose') && you.choices.length) { const c = you.choices[0]!; return { action: { type: 'choose', choice: c.id, option: c.options[0]!.id }, line: lines.press }; }
  // THE BELL: an invitation is answered before anything else — the house joins the team its plan names, and any
  // team at all when it planned none; a steward asks the planned members who have not yet been asked.
  if (may.has('join') && you.invitedTo.length) {
    const planned = view.teams.find((t) => you.invitedTo.includes(t.id) && t.plan && t.plan === you.intended?.id);
    const team = planned ?? view.teams.find((t) => you.invitedTo.includes(t.id));
    if (team) return { action: { type: 'join', team: team.id }, line: lineForOnce(view, `Count me in on ${team.name}.`) };
  }
  if (may.has('invite') && you.team && you.intended) {
    const team = view.teams.find((t) => t.id === you.team);
    const unasked = you.intended.members.find((m) => m !== you.role && team && !team.members.includes(m) && !team.invited.includes(m) && !team.declined.includes(m) && !view.cast.find((p) => p.role === m)?.team);
    if (unasked) return { action: { type: 'invite', who: unasked }, line: lineForOnce(view, `${view.cast.find((p) => p.role === unasked)?.name ?? unasked}, come onto ${team?.name}.`) };
  }
  // TAKE THE CORRIDOR'S COMMUNITIES UP, free, the moment there is a team to take them up for.
  if (may.has('adopt')) {
    const team = view.teams.find((t) => t.id === you.team) ?? (you.kind === 'coordinator' ? view.teams[0] : undefined);
    const unworked = view.communities.filter((c) => !c.workedBy && (!team || c.corridor === team.corridor || you.kind === 'coordinator'));
    if (unworked.length) return { action: { type: 'adopt', communities: unworked.map((c) => c.id) }, line: lineForOnce(view, `${team?.name ?? 'We'} will work with the ${unworked.map((c) => c.people.name).join(', ')}.`) };
  }
  if (view.phase !== 'day') return null;
  if (you.actedToday) return null;
  const here = you.town;
  // FOUND THE TEAM THE PLAN NAMES, if you are the one it names first and nobody has: where you stand, asking the rest.
  if (may.has('found-team') && you.intended && you.intended.members[0] === you.role && !view.teams.some((t) => t.plan === you.intended!.id)) {
    const invite = you.intended.members.filter((m) => m !== you.role);
    return { action: { type: 'found-team', name: you.intended.name, invite, plan: you.intended.id }, line: lineForOnce(view, `Starting ${you.intended.name}. ${invite.map((m) => view.cast.find((p) => p.role === m)?.name ?? m).join(', ')} — will you come?`) };
  }
  const hereBodies: ViewBody[] = view.bodies.filter((b) => b.town === here && b.lifecycle !== 'RecognizedAsChurch');
  const lineFor = (text: string) => (saidLately(view, text) ? undefined : text);

  switch (you.kind) {
    case 'partner': {
      if (may.has('support')) {
        const team = pick(view.teams.filter((t) => t.corridor === view.partners.find((p) => p.id === you.partner)?.corridor), tick) ?? view.teams[0];
        if (team) return { action: { type: 'support', team: team.id, resource: (['funds', 'volunteers', 'venue', 'prayer'] as const)[tick % 4]! }, line: lineFor(lines.report) };
      }
      return tick % 5 === 0 ? sayOnce(view, lines.greet) : { action: { type: 'rest' } };
    }
    case 'steward': {
      // Publish where the records and the reading disagree, oldest disagreement first.
      const stale = view.communities.find((c) => !c.reading || c.reading.phase !== c.derived);
      if (stale && may.has('assess')) return { action: { type: 'assess', community: stale.id, phase: stale.derived }, line: lineFor(`${stale.name}: the records read Phase ${stale.derived}. Publishing it.`) };
      return tick % 4 === 0 ? sayOnce(view, lines.probe) : { action: { type: 'rest' } };
    }
    case 'coach': {
      const team = view.teams.find((t) => t.id === you.team);
      const tired = view.cast.filter((p) => p.team === team?.id && p.kind === 'worker').sort((a, b) => a.energy - b.energy)[0];
      if (tired && tired.energy < 70 && may.has('coach')) return { action: { type: 'coach', who: tired.role }, line: lineFor(`${tired.name}, take a breath — walk me through this week.`) };
      if (may.has('report')) { const c = target(view, tick); if (c && tick % 3 === 0) return { action: { type: 'report', community: c.id, text: `Week ${view.week}: ${c.name} stand at Phase ${c.derived}; ${c.blockedBy ?? 'nothing in the way'}.` } }; }
      return { action: { type: 'rest' } };
    }
    default: {
      if (you.energy < 18) return { action: { type: 'rest' }, line: lineFor(lines.rest) };
      // Bodies first: a circle you are standing beside is the work that compounds.
      const church = hereBodies.find((b) => b.kind === 'church' && b.leaders >= 2 && b.believers >= 8);
      if (church && may.has('send')) {
        const def = view.communities.find((c) => c.id === church.community);
        const corridor = view.corridors.find((c) => c.id === def?.corridor);
        const to = pick((corridor?.towns ?? []).filter((t) => t !== here && !view.bodies.some((b) => b.community === church.community && b.town === t)), tick);
        if (to) return { action: { type: 'send', body: church.id, town: to }, line: lineFor(`${church.name} is ready to send. ${to} next.`) };
      }
      const ready = hereBodies.find((b) => b.kind === 'circle' && b.lifecycle === 'Active' && b.believers >= 6 && b.baptized >= 3 && b.leaders >= 1);
      if (ready && may.has('recognize')) return { action: { type: 'recognize', body: ready.id }, line: lineFor(`${ready.name} is a church in everything but the name. Let us say so.`) };
      const unbaptized = hereBodies.find((b) => b.believers > b.baptized);
      if (unbaptized && may.has('baptize') && tick % 2 === 0) return { action: { type: 'baptize', body: unbaptized.id }, line: lineFor(`Baptisms at ${unbaptized.name}.`) };
      const untrained = hereBodies.find((b) => b.believers >= 3 && b.leaders < 2);
      if (untrained && may.has('train') && tick % 3 === 0) return { action: { type: 'train', body: untrained.id }, line: lineFor(`Training leaders at ${untrained.name}.`) };
      const gatherable = pick(hereBodies.filter((b) => b.lifecycle !== 'RecognizedAsChurch'), tick);
      if (gatherable && may.has('gather') && (gatherable.lifecycle === 'Forming' || gatherable.lifecycle === 'Stalled' || tick % 2 === 1)) return { action: { type: 'gather', body: gatherable.id }, line: lineFor(`Gathering ${gatherable.name}.`) };
      // Then the community in front of you.
      const t = target(view, tick);
      if (!t) return { action: { type: 'rest' } };
      if (!t.towns.includes(here)) {
        const to = pick(t.towns, tick) ?? t.towns[0]!;
        return { action: { type: 'move', town: to }, line: lineFor(`Heading to ${view.towns.find((x) => x.id === to)?.name ?? to}.`) };
      }
      const c = t.counts;
      if (may.has('found') && c.studies >= 1 && c.believers - view.bodies.filter((b) => b.community === t.id && b.lifecycle !== 'RecognizedAsChurch').reduce((n, b) => n + b.believers, 0) >= 2) return { action: { type: 'found', community: t.id }, line: lineFor(`The ${t.people.name} study is ready to be a circle.`) };
      if (may.has('study') && (c.studies >= 1 || c.seekers >= 2)) return { action: { type: 'study', community: t.id }, line: lineFor(`Study with the ${t.people.name} tonight.`) };
      if (may.has('share') && (c.seekers < 2 || tick % 2 === 0)) return { action: { type: 'share', community: t.id }, line: lineFor(pick([lines.greet, lines.probe], tick) ?? lines.greet) };
      if (may.has('visit')) return { action: { type: 'visit', community: t.id }, line: lineFor(lines.probe) };
      return { action: { type: 'rest' } };
    }
  }
}
