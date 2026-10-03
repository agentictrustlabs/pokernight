// A SEASON NORTH OF DENVER, WALKED — the front door, the map, the board, your day, an act, the teams, the agents.
//   node scripts/walk-fieldops.cjs [--site https://gamenight.faithnet.io] [--api https://games.faithnet.io] [--headed]
const { chromium } = require('/home/barb/node_modules/playwright');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const SITE = arg('site', 'https://gamenight.faithnet.io'), API = arg('api', 'https://games.faithnet.io');
const SHOT = arg('shots', '/tmp/claude-1000/-home-barb-pokernight/eb1d4b2f-c088-4158-ba08-0b148b95a41f/scratchpad');
let pass = 0; const issues = [];
const check = (what, ok, got) => { if (ok) { pass++; console.log(`  ✓ ${what}`); } else { issues.push(what); console.log(`  ✗ ${what} — got ${JSON.stringify(got).slice(0, 220)}`); } };
const flat = async (page, sel) => (await page.locator(sel).innerText().catch(() => '')).replace(/\s+/g, ' ');

(async () => {
  const browser = await chromium.launch({ headless: !argv.includes('--headed') });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const bad = []; page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) bad.push(`${r.status()} ${r.url().slice(0, 90)}`); });
  try {
    await page.goto(`${SITE}/#/signin`, { waitUntil: 'networkidle' });
    await page.locator('.signin-demo summary').click();
    await page.waitForSelector('.persona', { timeout: 60_000 });
    const names = await page.locator('.persona-name').allInnerTexts();
    await page.locator('.persona').nth(Math.max(0, names.findIndex((n) => /alice/i.test(n)))).click();
    await page.waitForSelector('.room', { timeout: 90_000 });

    console.log('\n1 · the front door');
    const card = page.locator('.play-fieldops');
    await page.waitForFunction(() => /teams · \d+ communities/.test(document.querySelector('.play-fieldops .play-kicker')?.textContent ?? ''), { timeout: 30_000 }).catch(() => {});
    check('a Field Operations card is on Play', await card.count() === 1, await card.count());
    const kicker = await card.locator('.play-kicker').innerText().catch(() => '');
    check('the card leads with Northern Colorado and the four teams', /northern colorado/i.test(kicker) && /4 teams/i.test(kicker), kicker);
    const cardText = await flat(page, '.play-fieldops');
    check('the card says where the registry put each community', /registry.s floor/i.test(cardText) && /at P1/.test(cardText), cardText.slice(0, 260));
    await page.screenshot({ path: `${SHOT}/fo-1-play.png` });

    console.log('\n2 · open a season as Naomi');
    const opened = await page.evaluate(async (api) => {
      const tok = (() => { for (const k of Object.keys(localStorage)) { try { const v = JSON.parse(localStorage.getItem(k)); if (v && v.token) return v.token; } catch {} } return null; })();
      const r = await fetch(`${api}/fieldops/solo`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify({ role: 'naomi', restart: true, pace: 'short' }) });
      return await r.json();
    }, API);
    check('the season opened', !!opened?.staging?.stagingId, opened);
    check('it is A Season North of Denver', opened?.staging?.scenario === 'north-of-denver', opened?.staging?.scenario);
    const id = opened.staging.stagingId;

    console.log('\n3 · the map and the board');
    await page.goto(`${SITE}/#/fo/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.fo-board', { timeout: 60_000 });
    await page.waitForTimeout(2500);
    check('the field is drawn', await page.locator('svg.fo-map').count() === 1, '');
    const towns = await page.locator('.fo-map-town').count();
    check('eighteen towns are on the map', towns === 18, towns);
    const people = await page.locator('.fo-map-person').count();
    check('sixteen people stand on it', people === 16, people);
    const body = await flat(page, 'body');
    for (const p of ['Burmese', 'Somali Bantus', 'Afghans', 'Persians', 'Ukrainians', 'Guatemalans']) check(`the board lists the ${p}`, body.includes(p), '');
    check('the board says when the registry was read', /the registry.s floor, read 20\d\d-/.test(body), '');
    check('no readiness is on the page', !/readiness/i.test(body), '');
    const gauges = await page.locator('.fo-gauge').count();
    check('twelve phase gauges', gauges === 12, gauges);
    await page.screenshot({ path: `${SHOT}/fo-2-season.png` });

    console.log('\n4 · your day: nothing is a team until you found one');
    check('you are Naomi Kyaw', /Naomi Kyaw/.test(body), '');
    check('the plan is on the page: the team you set out to form', /set out to be on/i.test(body) && /Weld Corridor Team/.test(body), '');
    const verbs = await page.locator('.fo-verb').allInnerTexts();
    check('founding a team is offered and working a people is not, yet', verbs.some((v) => /Found a team/.test(v)) && !verbs.some((v) => /Visit households/.test(v)) && !verbs.some((v) => /Recognise/.test(v)), verbs);
    check('the board says nobody has taken anybody up', /nobody has taken them up/i.test(body), '');
    await page.locator('.fo-verb', { hasText: 'Found a team' }).click();
    await page.locator('.fo-you .gc-form input').first().fill('Weld Corridor Team');
    const boxes = page.locator('.fo-you .fo-invite-list input[type=checkbox]');
    const n = await boxes.count();
    check('the people who may be asked are listed, with the plan marked', n >= 10 && /in your plan/.test(await flat(page, '.fo-you .fo-invite-list')), n);
    for (let i = 0; i < n; i++) { const row = await boxes.nth(i).locator('xpath=..').innerText(); if (/in your plan/.test(row)) await boxes.nth(i).check(); }
    await page.locator('.fo-you .gc-form button.primary', { hasText: 'Create team' }).click();
    await page.waitForFunction(() => /Weld Corridor Team/.test(document.querySelector('.fo-teams')?.textContent ?? ''), { timeout: 15_000 }).catch(() => {});
    const teams0 = await flat(page, '.fo-teams');
    check('the team is founded, you are its steward, the others are asked', /Weld Corridor Team/.test(teams0) && /steward Naomi Kyaw/.test(teams0) && /asked, not yet answered/.test(teams0), teams0.slice(0, 300));
    check('its agent is being chartered at the Home', /chartering its agent/.test(teams0), '');
    const energy = await flat(page, '.fo-energy');
    check('founding spent the day', /spent today/.test(energy), energy);
    const verbs2 = await page.locator('.fo-verb').allInnerTexts();
    check('taking a people up is free and still offered', verbs2.some((v) => /Take up a people/.test(v)) && !verbs2.some((v) => /Visit households/.test(v)), verbs2);
    await page.locator('.fo-verb', { hasText: 'Take up a people' }).click();
    const cboxes = page.locator('.fo-you .fo-invite-list input[type=checkbox]');
    const cn = await cboxes.count();
    for (let i = 0; i < cn; i++) { const row = await cboxes.nth(i).locator('xpath=..').innerText(); if (/Greeley|Evans|Fort Lupton|Windsor/.test(row)) await cboxes.nth(i).check(); }
    await page.locator('.fo-you .gc-form button.primary').click();
    await page.waitForFunction(() => /Weld Corridor Team/.test(document.querySelector('.fo-board')?.textContent ?? ''), { timeout: 15_000 }).catch(() => {});
    const board2 = await flat(page, '.fo-board');
    check('the board now says who took the Weld communities up', /Weld Corridor Team/.test(board2), board2.slice(0, 200));
    const feed = await flat(page, '.fo-activity .gc-lines');
    check('the activity shows the founding and the taking up', /founded Weld Corridor Team/.test(feed) && /takes up the/.test(feed), feed.slice(-300));
    await page.screenshot({ path: `${SHOT}/fo-3-founded.png` });

    console.log('\n5 · the teams, the agents, the field app');
    const teams = await flat(page, '.fo-teams');
    check('the founded team is listed with its corridor', /Weld Corridor Team/.test(teams) && /Weld/.test(teams), teams.slice(0, 200));
    check('the rest are on no team yet, played by the house or an agent', /On no team yet/.test(teams) && /the house|agent /.test(teams), teams.slice(0, 200));
    const agents = await flat(page, '.fo-agents');
    check('the agent report is on the page', /the agents/i.test(agents), agents.slice(0, 160));
    const estate = await flat(page, '.fo-estate');
    check('the field app panel says what has been written, and links', /field\.faithnet\.io/.test(estate), estate);
    const partners = await flat(page, '.fo-partners');
    check('the partner churches are named, as game agents', /Timberline Church/.test(partners) && /game agent/.test(partners), partners.slice(0, 200));

    console.log('\n6 · a few days pass');
    await page.waitForTimeout(45_000);
    const day = await flat(page, '.topbar');
    check('the clock has moved the season on', /day [2-9]|week/i.test(day), day);
    const feed2 = await flat(page, '.fo-activity .gc-lines');
    check('the field has been at work: teams founded, people joining or taken up', /founded|joined|takes up|Visited|conversation/i.test(feed2) && feed2.length > feed.length, feed2.length);
    const teams2 = await flat(page, '.fo-teams');
    check('the agents have founded their own teams from their plans', /Larimer Team|Boulder–Longmont Team|Plains Team/.test(teams2), teams2.slice(0, 300));
    await page.screenshot({ path: `${SHOT}/fo-4-days.png` });

    check('no page errors', errors.length === 0, errors);
    check('no failed requests', bad.length === 0, bad);
  } catch (e) { issues.push(`threw: ${String(e).slice(0, 300)}`); console.log(`  ✗ threw ${String(e).slice(0, 300)}`); await page.screenshot({ path: `${SHOT}/fo-threw.png` }).catch(() => {}); }
  await browser.close();
  console.log(`\n${pass} checks passed${issues.length ? `, ${issues.length} issues:\n  - ${issues.join('\n  - ')}` : ''}`);
  process.exit(issues.length ? 1 : 0);
})();
