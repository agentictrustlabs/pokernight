/**
 * WHAT THE FIELD APP SEES OF THE GAME'S ESTATE — the same read field.faithnet.io makes, through the field gateway.
 *
 *   set -a; . ~/engage/scripts/seed/faithnet.env; set +a
 *   node scripts/probe-fieldops-estate.mjs [--as nathan] [--note fieldops-estate.note.json]
 *
 * Signs in as a demo person who stewards the workspace (the Home lends the session), asks `field.workspace-roster` for
 * the workspaces they hold, `field.workspace-read` for the game's — its teams, bodies and communities — and
 * `field.workspace-progress` for what the season has written, and prints what came back. Read-only.
 */
import { readFileSync } from 'node:fs';
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const HOME = process.env.HOME_ORIGIN || 'https://www.faithnet.me';
const FIELD = process.env.FIELD_A2A || 'https://field-a2a-faithnet.richardpedersen3.workers.dev';
const CLIENT_ID = process.env.FIELD_CLIENT_ID || 'field-app';
const note = JSON.parse(readFileSync(new URL(`../${arg('note', 'fieldops-estate.note.json')}`, import.meta.url), 'utf8'));
const handle = arg('as', note.workspace.custodian);

const si = await (await fetch(`${HOME}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: CLIENT_ID, handle }) })).json();
if (!si.id_token) throw new Error(`demo-signin ${handle}: ${JSON.stringify(si).slice(0, 200)}`);
async function intent(skill, metadata) {
  const r = await fetch(`${FIELD}/a2a`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${si.id_token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method: 'message/send', params: { message: { role: 'user', parts: [{ kind: 'text', text: 'probe' }], metadata: { skill, ...metadata } } } }) });
  const j = await r.json().catch(() => ({}));
  if (j.error) return { error: j.error };
  const parts = j.result?.parts ?? j.result?.status?.message?.parts ?? [];
  return parts.find((p) => p.kind === 'data')?.data ?? j.result ?? {};
}
console.log(`as ${handle} · workspace ${note.workspace.sa}`);
const roster = await intent('field.workspace-roster', {});
console.log('\nworkspaces this person holds:', JSON.stringify(roster).slice(0, 600));
const ws = await intent('field.workspace-read', { workspace: note.workspace.sa });
console.log('\nworkspace-read:', JSON.stringify({ profile: ws.profile ?? ws.workspace, teams: ws.teams?.length, bodies: ws.bodies?.length, communities: ws.communities?.length, members: ws.members?.length ?? ws.roster?.length, error: ws.error }, null, 1));
for (const t of ws.teams ?? []) console.log('  team', t.title ?? t.team, t.team ?? '', t.status ?? '');
for (const b of ws.bodies ?? []) console.log('  body', b.title ?? b.body, b.bodyType ?? '', b.status ?? '');
const prog = await intent('field.workspace-progress', { workspace: note.workspace.sa });
console.log('\nworkspace-progress:', JSON.stringify(prog).slice(0, 900));
for (const [team, t] of Object.entries(note.teams)) {
  const read = await intent('field.team-read', { workspace: note.workspace.sa, team: t.sa, org: t.sa });
  console.log(`\nteam ${team} (${t.sa}):`, JSON.stringify(read).slice(0, 400));
}
