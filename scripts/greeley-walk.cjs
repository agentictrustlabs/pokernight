// THURSDAY IN GREELEY, WALKED — the front door, the board, the rooms, the grains, the wall, the reading.
const { chromium } = require('/home/barb/node_modules/playwright');
const SITE = 'https://gamenight.faithnet.io', API = 'https://games.faithnet.io';
const SHOT = '/tmp/claude-1000/-home-barb-pokernight/d3913a57-8fed-4258-9971-22cff46caa2f/scratchpad';
let pass = 0; const issues = [];
const check = (what, ok, got) => { if (ok) { pass++; console.log(`  ✓ ${what}`); } else { issues.push(what); console.log(`  ✗ ${what} — got ${JSON.stringify(got).slice(0, 220)}`); } };
const flat = async (page, sel) => (await page.locator(sel).innerText().catch(() => '')).replace(/\s+/g, ' ');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const console404 = []; page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) console404.push(`${r.status()} ${r.url().slice(0, 90)}`); });
  try {
    await page.goto(`${SITE}/#/signin`, { waitUntil: 'networkidle' });
    await page.locator('.signin-demo summary').click();
    await page.waitForSelector('.persona', { timeout: 60_000 });
    const names = await page.locator('.persona-name').allInnerTexts();
    await page.locator('.persona').nth(Math.max(0, names.findIndex((n) => /alice/i.test(n)))).click();
    await page.waitForSelector('.room', { timeout: 90_000 });

    console.log('\n1 · the front door');
    const card = page.locator('.play-commission');
    // The card asks the API which nights exist; wait for the answer rather than reading the placeholder.
    await page.waitForFunction(() => /parts · \d+ rounds/.test(document.querySelector('.play-commission .play-kicker')?.textContent ?? ''), { timeout: 30_000 }).catch(() => {});
    check('a Great Commission card is on Play', await card.count() === 1, await card.count());
    const kicker = await card.locator('.play-kicker').innerText().catch(() => '');
    // The kicker is uppercased by CSS and innerText returns the TRANSFORMED text — match case-insensitively.
    check('the card leads with Weld County', /weld county/i.test(kicker), kicker);
    const cardText = await flat(page, '.play-commission');
    check('the card names the night', /Thursday in Greeley/.test(cardText), cardText.slice(0, 220));
    // The marches SHOULD still appear — as the other night in the picker. What must not is the card's own copy.
    const band = await flat(page, '.play-commission .play-band');
    check('the card’s own heading is the Greeley night', /thursday in greeley/i.test(band) && !/marches/i.test(band), band);
    const picker = await page.locator('.play-commission select').first().innerText().catch(() => '');
    check('the Greeley night is offered first', picker.split('\n')[0]?.includes('Thursday in Greeley'), picker.split('\n')[0]);

    console.log('\n2 · open a night as the researcher');
    const opened = await page.evaluate(async (api) => {
      const tok = (() => { for (const k of Object.keys(localStorage)) { try { const v = JSON.parse(localStorage.getItem(k)); if (v && v.token) return v.token; } catch {} } return null; })();
      const r = await fetch(`${api}/commissions/solo`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify({ role: 'researcher', restart: true, pace: 'short' }) });
      return await r.json();
    }, API);
    check('the night opened', !!opened?.staging?.stagingId, opened);
    check('it is Thursday in Greeley', opened?.staging?.scenario === 'thursday-in-greeley', opened?.staging?.scenario);
    const id = opened.staging.stagingId;

    console.log('\n3 · the board: five real peoples, the map once');
    await page.goto(`${SITE}/#/gc/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.gc-board', { timeout: 60_000 });
    await page.waitForTimeout(3000);
    const body = await flat(page, 'body');
    for (const p of ['Burmese', 'Somalis', 'Somali Bantus', 'Guatemalans', 'Mexicans']) check(`the board lists the ${p}`, body.includes(p), '');
    check('the county is named once, not on every card', (body.match(/Weld County, Colorado/g) || []).length <= 3, (body.match(/Weld County, Colorado/g) || []).length);
    const towns = await flat(page, '.gc-towns');
    check('the county map is its own line', /Greeley/.test(towns) && /Kersey/.test(towns), towns);
    check('no hidden state is on the page', !/"truth"|Fort Lupton.{0,12}9 household/i.test(body), '');

    console.log('\n4 · your part, and the room');
    check('you are Ruth Calloway', /Ruth Calloway/.test(body), '');
    check('you are at the Thursday lunch, county grain', /Thursday Lunch/.test(body) && /rule: county grain/i.test(body), body.slice(0, 300));
    const cast = await page.locator('.mystery-cast li').count();
    check('seven parts in the cast', cast === 7, cast);
    const castText = await flat(page, '.mystery-cast');
    check('the cast panel names the county, not the marches', !/marches/i.test(castText), castText.slice(0, 160));
    for (const n of ['Naw Paw Htoo', 'Abdi Mberwa', 'Dale Kirkpatrick', 'Marguerite Vance', 'Pastor Tom Reyes', 'Bonnie Ahlgren']) check(`${n} is in the cast`, castText.includes(n), '');

    console.log('\n5 · the doors, and the grains behind them');
    const doors = await page.locator('.mystery-room button, .gc-doors button').allInnerTexts().catch(() => []);
    const doorText = doors.join(' | ');
    check('the rooms are Greeley rooms', /Agency Office/.test(doorText) && /Living Room|Research Desk|Board Room/.test(doorText), doorText.slice(0, 220));
    check('no room is called the commons or the road', !/Commons|The Road/.test(doorText), doorText);

    console.log('\n6 · say a line, and the wall');
    const sayInput = page.locator('.mystery-say input').first();
    if (await sayInput.count()) {
      await sayInput.fill('Let me ask these in order, and stop me at the first no.');
      await page.locator('.mystery-say button').first().click();
      await page.waitForTimeout(2500);
      const t = await flat(page, '.mystery-transcript');
      check('the line reached the transcript', /stop me at the first no/.test(t), t.slice(-160));
    } else check('there is somewhere to speak', false, 'no .mystery-say input');
    const wall = page.locator('.gc-wall');
    if (await wall.count()) {
      const wi = wall.locator('input').first();
      if (await wi.count()) {
        await wi.fill('Who actually knows anything about the Bantu families?');
        await wall.locator('button').first().click();
        await page.waitForTimeout(2000);
        const w = await flat(page, '.gc-wall');
        check('a post-it goes up anonymously', /Who actually knows anything/.test(w) && !/Ruth Calloway/.test(w), w.slice(0, 200));
      } else check('the wall takes a topic', false, 'no input on .gc-wall');
    } else check('the lunch has a wall', false, 'no .gc-wall');

    console.log('\n7 · publish a reading');
    const sel = page.locator('.gc-form select');
    if (await sel.count() >= 2) {
      await sel.nth(0).selectOption({ index: 1 }).catch(() => {});
      const pub = page.locator('.gc-form button', { hasText: /Publish/ }).first();
      const before = await flat(page, '.gc-board');
      if (await pub.isEnabled().catch(() => false)) {
        await pub.click(); await page.waitForTimeout(2500);
        const after = await flat(page, '.gc-board');
        check('publishing changed the board', before !== after, 'board unchanged');
      } else check('the publish button is live once a people is chosen', false, 'disabled');
    } else check('the researcher has a publish form', false, await sel.count());

    console.log('\n8 · the room is drawn');
    const venue = await page.evaluate(() => {
      const v = window.__venue; if (!v) return null;
      return { bodies: v.bodies?.current ? [...v.bodies.current.keys()].length : 0, camera: !!v.camera };
    });
    check('the 3D room drew bodies', !!venue && venue.bodies >= 5, venue);
    await page.screenshot({ path: `${SHOT}/greeley-walk.png` });

    console.log('\n9 · nothing broke');
    check('no page errors', errors.length === 0, errors.slice(0, 2));
    check('no failed requests', console404.length === 0, console404.slice(0, 3));
  } catch (e) { check('the walk completed', false, e.message); }
  finally { await browser.close(); }
  console.log(`\n${pass} passed, ${issues.length} to fix`);
  if (issues.length) console.log('ISSUES:\n  - ' + issues.join('\n  - '));
})();
