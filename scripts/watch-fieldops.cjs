/**
 * WATCH A SEASON PLAYED BY ALL SIXTEEN AGENTS, live — and see the teams they found get chartered.
 *
 *   node scripts/watch-fieldops.cjs [--site https://gamenight.faithnet.io] [--api https://games.faithnet.io] [--minutes 30] [--headed] [--restart]
 *
 * Signs in as Alice through the real door, opens a season with NO part of her own (`role: 'watch'`, short pace), keeps
 * the page attended the way a person would (a pointer move a minute, which the page turns into `attend`), and every
 * half-minute prints what the season has: the day, the teams (founded by whom, whether their agent landed), the
 * charters' steps, the communities taken up, the bodies, and the agents' tally. Stops when the season reveals, or after
 * the minutes given. The season keeps running only while this page is attended, so closing it stops the agents.
 */
const { chromium } = require('playwright');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SITE = arg('--site', 'https://gamenight.faithnet.io'); const API = arg('--api', 'https://games.faithnet.io');
const MINUTES = Number(arg('--minutes', '30')); const HEADED = process.argv.includes('--headed');
// A RUN CONTINUES THE SEASON THAT IS THERE. `--restart` opens a fresh one — and leaves the old season's chartered agents
// behind for `reset:fieldops` to retire, so it is not the default: three runs with restarts chartered three Larimer Teams.
const RESTART = process.argv.includes('--restart');
(async () => {
  const b = await chromium.launch({ headless: !HEADED }); const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`${SITE}/#/signin`, { waitUntil: 'networkidle' });
  await page.locator('.signin-demo summary').click(); await page.waitForSelector('.persona', { timeout: 60_000 });
  const names = await page.locator('.persona-name').allInnerTexts();
  await page.locator('.persona').nth(Math.max(0, names.findIndex((n) => /alice/i.test(n)))).click();
  await page.waitForSelector('.room', { timeout: 90_000 });
  const token = await page.evaluate(() => { for (const k of Object.keys(localStorage)) { try { const v = JSON.parse(localStorage.getItem(k)); if (v && v.token) return v.token; } catch {} } return null; });
  const opened = await page.evaluate(async ({ api, token, restart }) => (await fetch(`${api}/fieldops/solo`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ role: 'watch', restart, pace: 'short' }) })).json(), { api: API, token, restart: RESTART });
  const id = opened.staging.stagingId;
  console.log(`season ${id} opened as a watcher (${opened.staging.role}), pace ${opened.staging.pace}`);
  await page.goto(`${SITE}/#/fo/${id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.fo-page', { timeout: 60_000 });
  const t0 = Date.now(); let lastLine = '';
  while (Date.now() - t0 < MINUTES * 60_000) {
    await page.mouse.move(200 + Math.random() * 400, 200 + Math.random() * 300);
    await page.waitForTimeout(30_000);
    await page.mouse.move(300 + Math.random() * 400, 300 + Math.random() * 300);
    const r = await page.evaluate(async ({ api, token, id }) => (await fetch(`${api}/fieldops/${id}?playerId=x`, { headers: { authorization: `Bearer ${token}` } })).json(), { api: API, token, id }).catch(() => null);
    if (!r?.view) { console.log('(no view yet)'); continue; }
    const v = r.view; const st = r.staging;
    const teams = v.teams.map((t) => `${t.name} [${v.cast.find((c) => c.role === t.steward)?.name} · ${t.members.length} on, ${t.invited.length} asked${t.agent ? ` · AGENT ${t.agent.slice(0, 8)}…@${t.custodian}` : ''}]`).join('; ');
    const charters = (st.charters ?? []).map((c) => `${c.name.replace(' (game)', '')}:${c.step}${c.error ? `(${c.error.slice(0, 50)})` : ''}`).join('; ');
    const worked = v.communities.filter((c) => c.workedBy).length; const defined = v.communities.filter((c) => c.fictional).length;
    const bodies = v.bodies.filter((b) => b.foundedDay > 0 || b.recognizedFrom).map((b) => `${b.name}${b.agent ? ' (agent)' : ''}`).join('; ');
    const agents = (r.agents ?? []).reduce((a, x) => ({ asked: a.asked + x.asked, answered: a.answered + x.answered, applied: a.applied + x.applied, refused: a.refused + x.refused + x.unparsed, missed: a.missed + x.missed, rules: a.rules + x.byRules }), { asked: 0, answered: 0, applied: 0, refused: 0, missed: 0, rules: 0 });
    // THE TALK: how much was said and whispered this season, and the last line of each — what `carryTalk` carries to
    // the team's `general` and to the other character's inbox.
    const said = (v.transcript ?? v.log ?? []).filter((e) => e.type === "said"); const whispered = (v.transcript ?? v.log ?? []).filter((e) => e.type === "whispered");
    const lastSaid = said.at(-1) ? ` "${said.at(-1).by}: ${String(said.at(-1).text).slice(0, 50)}"` : ''; const lastWhisper = whispered.at(-1) ? ` "${whispered.at(-1).by}→${whispered.at(-1).to}: ${String(whispered.at(-1).text).slice(0, 40)}"` : '';
    const line = `[${Math.round((Date.now() - t0) / 60000)}m] day ${v.day} wk ${v.week} ${v.phase} · said ${said.length}${lastSaid} · whispered ${whispered.length}${lastWhisper} · teams ${v.teams.length}: ${teams || '—'} · charters: ${charters || '—'} · worked ${worked}/${v.communities.length}${defined ? ` (+${defined} defined)` : ''} · bodies: ${bodies || '—'} · agents asked ${agents.asked} answered ${agents.answered} applied ${agents.applied} refused ${agents.refused} missed ${agents.missed} house ${agents.rules} · estate ${st.estate ? `${st.estate.ok ? 'ok' : 'partial'} ${st.estate.written} through day ${st.estate.throughDay}` : 'nothing yet'}`;
    if (line !== lastLine) console.log(line); lastLine = line;
    if (v.phase === 'revealed') { console.log('REVEALED', JSON.stringify(v.reveal.score.teams)); break; }
  }
  await page.screenshot({ path: `/tmp/claude-1000/-home-barb-pokernight/eb1d4b2f-c088-4158-ba08-0b148b95a41f/scratchpad/watch-fieldops.png`, fullPage: true }).catch(() => {});
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
