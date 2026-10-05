/**
 * THE SEASON AS A TOWN, WALKED — `#/fo/<season>/town` on the live site, as one of the Home's demo people.
 *
 *   node scripts/walk-field-town.cjs [--season <id>] [--as alice] [--site https://gamenight.faithnet.io] [--shots <dir>] [--headed]
 *
 * READ-ONLY, AND IT MUST STAY THAT WAY: the town is a read of what a season built, over HTTP. The season's own page
 * (`#/fo/<id>`) opens a socket, a socket is somebody attending, and attention is what lets a season ask sixteen
 * agents for their day — so this walk never goes there, and its LAST check is that no socket to a season was opened
 * while it looked. With no `--season` it takes the one the Play page offers ("See what it built, as a town").
 *
 * What it presses: the whole field; a corridor (the camera goes in and the detail changes); a people (everything
 * else dims and the camera frames what is left); a building (the flyout says what it is and what it has counted);
 * the wheel, down to street level; and Replay, from the registry's floor to the last day, reading the caption.
 */
const { chromium } = require('playwright');
const argv = process.argv.slice(2); const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const SITE = arg('site', 'https://gamenight.faithnet.io'); const AS = arg('as', 'alice'); const SHOT = arg('shots', require('os').tmpdir());
let pass = 0; const issues = [];
const check = (what, ok, got) => { if (ok) { pass++; console.log(`  ✓ ${what}`); } else { issues.push(what); console.log(`  ✗ ${what} — got ${JSON.stringify(got ?? null).slice(0, 260)}`); } };
(async () => {
  const browser = await chromium.launch({ headless: !argv.includes('--headed') });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  const sockets = []; page.on('websocket', (ws) => sockets.push(ws.url()));
  const shot = (name) => page.screenshot({ path: `${SHOT}/field-town-${name}.png` }).catch(() => {});
  const stage = page.getByTestId('field-town');
  const lod = async () => Number(await stage.getAttribute('data-lod'));
  const drawn = (sel) => page.locator(`[data-testid="field-town"] ${sel}`).count();

  await page.goto(`${SITE}/#/signin`, { waitUntil: 'networkidle' });
  await page.locator('.signin-demo summary').click();
  await page.waitForSelector('.persona', { timeout: 60_000 });
  const names = await page.locator('.persona-name').allInnerTexts();
  await page.locator('.persona').nth(Math.max(0, names.findIndex((n) => new RegExp(AS, 'i').test(n)))).click();
  await page.waitForSelector('.room', { timeout: 90_000 });

  console.log('\n1 · the way in');
  let season = arg('season', null);
  if (!season) {
    const link = page.getByTestId('play-field-town');
    await link.waitFor({ timeout: 30_000 }).catch(() => {});
    const href = (await link.getAttribute('href').catch(() => null)) ?? '';
    check('Play offers the season as a town, without going to the season’s page', /#\/fo\/[^/]+\/town$/.test(href), href);
    season = decodeURIComponent((href.match(/#\/fo\/([^/]+)\/town/) ?? [])[1] ?? '');
  }
  if (!season) { console.log('no season to look at — pass --season <id>'); await browser.close(); process.exit(1); }
  await page.goto(`${SITE}/#/fo/${encodeURIComponent(season)}/town`, { waitUntil: 'domcontentloaded' });
  await stage.waitFor({ timeout: 60_000 }); await page.waitForTimeout(2500);

  console.log('\n2 · the whole field');
  const dayBefore = (await page.locator('.ft-page-day').innerText().catch(() => '')).trim();
  const head = (await page.getByTestId('field-town-panel').locator('h3, h2').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
  check('the page says what it is looking at', /field/i.test(head) && /peoples/i.test(head), head);
  const n = { buildings: await drawn('[data-id]'), circles: Number(await page.getByTestId('ft-tally-circles').innerText().catch(() => 'NaN')), churches: Number(await page.getByTestId('ft-tally-churches').innerText().catch(() => 'NaN')) };
  check('the field is drawn: every town, office, quarter and body as a building', n.buildings > 40, n);
  check('the tally counts the season’s circles and churches', Number.isFinite(n.circles) && Number.isFinite(n.churches) && n.circles + n.churches > 0, n);
  check('every circle and church counted is standing on the ground', (await drawn('.ft-circle')) >= n.circles && (await drawn('.ft-church')) >= n.churches, { circle: await drawn('.ft-circle'), church: await drawn('.ft-church') });
  check('from this far out it is the region', (await lod()) === 0, await lod()); await shot('1-field');

  console.log('\n3 · going in');
  const place = page.locator('[data-testid^="ft-place-"]').nth(1);
  const placeName = (await place.innerText()).trim();
  await place.click(); await page.waitForTimeout(1600);
  check(`"${placeName}" brings the camera in`, (await lod()) >= 1, await lod()); await shot('2-corridor');
  // People are figures, and a figure is nothing from region height: they are drawn once the camera is in.
  check('and in close, the people working it are standing where they are', (await drawn('[data-person]')) > 0, await drawn('[data-person]'));
  const peoples = page.locator('[data-testid^="ft-people-"]');
  const who = (await peoples.allInnerTexts()).map((t) => t.trim());
  const pick = Math.max(0, who.findIndex((t) => /karen/i.test(t)));
  await peoples.nth(pick).click(); await page.waitForTimeout(1600);
  check(`"${who[pick]}" is a filter the page shows as on`, /is-on|true/.test(`${await peoples.nth(pick).getAttribute('class')} ${await peoples.nth(pick).getAttribute('aria-pressed')}`), await peoples.nth(pick).getAttribute('class'));
  await shot('3-people');
  // Press something that stands: try the bodies of this people first, then anything.
  let opened = false;
  for (const sel of ['.ft-church', '.ft-circle', '.ft-beacon', '.ft-team', '[data-id]']) {
    const els = page.locator(`[data-testid="field-town"] ${sel}`);
    for (let i = 0; i < Math.min(4, await els.count()) && !opened; i++) {
      const bb = await els.nth(i).boundingBox(); if (!bb || bb.width < 4) continue;
      const box = await stage.boundingBox(); const x = bb.x + bb.width / 2, y = bb.y + bb.height * 0.6;
      if (x < box.x + 20 || x > box.x + box.width - 20 || y < box.y + 40 || y > box.y + box.height - 20) continue;
      await page.mouse.click(x, y); await page.waitForTimeout(400);
      opened = (await page.getByTestId('ft-inspect').count()) > 0;
    }
    if (opened) break;
  }
  const said = opened ? (await page.getByTestId('ft-inspect').innerText()).replace(/\s+/g, ' ') : '';
  check('pressing a building opens what it is', opened && said.length > 20, said.slice(0, 200)); await shot('4-inspect');
  if (opened) await page.getByTestId('ft-inspect').locator('.ft-x').click();
  await peoples.nth(pick).click(); await page.waitForTimeout(600);
  const box = await stage.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, -320); await page.waitForTimeout(160); }
  await page.waitForTimeout(900);
  check('the wheel goes down to street level', (await lod()) === 2, await lod()); await shot('5-street');

  console.log('\n4 · the season, replayed');
  await page.getByTestId('ft-play').click(); await page.waitForTimeout(600);
  const first = (await page.getByTestId('ft-day').innerText()).replace(/\s+/g, ' ');
  check('Replay starts before anybody acted', /before the season/i.test(first), first);
  const days = new Map(); const t0 = Date.now(); let last = '';
  while (Date.now() - t0 < 90_000) {
    const d = (await page.getByTestId('ft-day').innerText()).replace(/\s+/g, ' ');
    if (d !== last) { last = d; days.set(d, (await page.getByTestId('ft-happened').innerText()).replace(/\s+/g, ' ')); }
    if ((await page.getByTestId('ft-play').innerText()).trim() === 'Replay the season' && days.size > 1) break;
    await page.waitForTimeout(350);
  }
  const told = [...days.values()].join(' ');
  check('it plays through the days to the last one', days.size >= 3 && (await page.getByTestId('ft-play').innerText()).trim() === 'Replay the season', [...days.keys()]);
  check('and says what each day raised', /founded/.test(told) && /(circle formed|church was recognised|baptised|moved from P\d to P\d)/.test(told), told.slice(0, 260)); await shot('6-end');
  for (const [d, t] of days) console.log(`    ${d} — ${t.slice(0, 150)}`);

  console.log('\n5 · and nobody was woken');
  // A STILL READ MOVES NOTHING: read the season again after all that looking, and it is on the day it was on.
  await page.getByRole('button', { name: /refresh/i }).click(); await page.waitForTimeout(2500);
  const dayAfter = (await page.locator('.ft-page-day').innerText().catch(() => '')).trim();
  check('the season is on the day it was on before anybody looked', dayBefore.length > 0 && dayAfter === dayBefore, { dayBefore, dayAfter });
  const seasonSockets = sockets.filter((u) => /fieldops/.test(u));
  check('no socket to a season was opened', seasonSockets.length === 0, seasonSockets);
  check('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log(`\n${pass} checks passed${issues.length ? `, ${issues.length} issues:\n  - ${issues.join('\n  - ')}` : ''}`);
  process.exit(issues.length ? 1 : 0);
})().catch((e) => { console.error('threw', String(e).slice(0, 500)); process.exit(1); });
