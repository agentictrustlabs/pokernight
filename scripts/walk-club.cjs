/**
 * A CLUB, END TO END, on the live deployment as the Home's demo people: Alice charters one at her Home (two
 * ceremonies — the workspace, then the wire that lets the card room act as it), founds it, invites Bob by his
 * agent name (a ceremony at her Home; her agent messages him), Bob joins from the door the message links
 * (a ceremony at his Home), both see the roster the club's own agent keeps, and both are admitted to the
 * club's huddle on standing the Home derives. `pnpm walk:club`. Playwright is required by absolute path
 * as a root devDependency, which is why this is a `.cjs`.
 */
const { chromium } = require('playwright');
const SITE = 'https://poker.faithnet.io';
const OUT = require('node:os').tmpdir();
async function signIn(browser, who) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, permissions: ['microphone', 'camera'] });
  const page = await ctx.newPage();
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log(`  [${who}] NAV`, f.url().replace(/(session=|collect_token=)[^&#]+/g, '$1<redacted>').slice(0, 140)); });
  page.on('console', (m) => { if (m.type() === 'error') console.log(`  [${who}] console.error`, m.text().slice(0, 160)); });
  await page.goto(`${SITE}/#/signin`, { waitUntil: 'networkidle' });
  const d = page.locator('.signin-demo summary'); if (await d.count()) await d.click();
  await page.waitForSelector('.persona', { timeout: 30000 });
  await page.locator('.persona', { hasText: new RegExp(who, 'i') }).first().click();
  await page.waitForSelector('.room', { timeout: 60000 });
  await page.waitForTimeout(2500);
  const nn = page.locator('.sheet.coach-question button', { hasText: 'Not now' }); if (await nn.count()) await nn.click();
  return page;
}
/** Drive the Home's screens until we are back at the card room and settled. */
async function homeTrip(page, who, name = 'Someone') {
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(2500);
    if (page.url().startsWith(SITE)) {
      // A return leg may bounce straight back out (charter → wire). Wait for calm.
      await page.waitForTimeout(4000);
      if (page.url().startsWith(SITE)) break;
      continue;
    }
    const nameBox = page.locator('input[placeholder*="Rich Pedersen"]');
    if (await nameBox.count().catch(() => 0)) { console.log(`  [${who}] name step`); await nameBox.fill(name); await page.locator('button', { hasText: 'Continue' }).first().click(); continue; }
    const allow = page.locator('button', { hasText: /^Allow / });
    if (await allow.count().catch(() => 0)) {
      const t = await page.locator('body').innerText();
      console.log(`  [${who}] sheet:`, t.split('\n').filter((l) => /^(Create|Hold|Authorize|Let|Add|Accept|Take|See)/.test(l)).join(' / ').slice(0, 220));
      await allow.first().click(); continue;
    }
    const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const m = body.match(/(Signing|Telling|Claiming|Finishing|Creating|Reading the service|Authorizing|Handing)[^.]{0,80}/);
    if (m) console.log(`  [${who}] progress:`, m[0]);
    const fail = body.match(/(could not|failed|refused|error)[^.]{0,120}/i);
    if (fail && !m) console.log(`  [${who}] HOME SAYS:`, fail[0]);
  }
  await page.waitForTimeout(3000);
  const notice = await page.locator('.app-banner, .form-error').allInnerTexts().catch(() => []);
  if (notice.length) console.log(`  [${who}] card room says:`, notice.join(' | ').slice(0, 300));
}
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const alice = await signIn(browser, 'alice');
  const before = await alice.locator('.sidenav-row').allInnerTexts().catch(() => []);
  console.log('alice rail before:', before.map((s) => s.replace(/\n/g, ' ')).join(' | '));
  await alice.goto(`${SITE}/#/clubs/new`, { waitUntil: 'networkidle' });
  await alice.waitForTimeout(1500);
  const clubName = `Sunday Canasta ${Date.now().toString(36).slice(-4)}`;
  await alice.locator('input[placeholder="Thursday Night"]').fill(clubName);
  await alice.locator('button', { hasText: /Start it/ }).click();
  await homeTrip(alice, 'alice');
  await alice.waitForFunction(() => /^#\/clubs\/0x[0-9a-f]{40}$/i.test(location.hash), { timeout: 40000 }).catch(() => {});
  await alice.waitForTimeout(3000);
  console.log('alice at:', alice.url().slice(0, 120));
  await alice.screenshot({ path: `${OUT}/club-1-founded.png`, fullPage: true });
  const clubId = (alice.url().match(/#\/clubs\/(0x[0-9a-f]{40})/i) || [])[1];
  console.log('club id:', clubId);
  if (!clubId) { console.log(await alice.locator('body').innerText().then((t) => t.slice(0, 600))); await browser.close(); return; }
  console.log('club page:', (await alice.locator('.club-detail').innerText().catch(() => '(none)')).replace(/\n/g, ' · ').slice(0, 400));
  // Invite bob by name.
  await alice.locator('.club-invite input').fill('bob.me');
  await alice.locator('.club-invite button').click();
  await alice.waitForTimeout(3000);
  console.log('after invite press:', alice.url().slice(0, 60), (await alice.locator('.form-error, .app-banner').allInnerTexts().catch(() => [])).join(' | ').slice(0, 200));
  await homeTrip(alice, 'alice');
  console.log('alice back at:', alice.url().slice(0, 100));
  // Bob joins from the door.
  const bob = await signIn(browser, 'bob');
  await bob.goto(`${SITE}/#/join/${clubId}`, { waitUntil: 'networkidle' });
  await bob.locator('.join-panel button', { hasText: /Join at your Home/ }).waitFor({ timeout: 40000 }).catch(() => {});
  console.log('bob door:', (await bob.locator('.join-panel').innerText().catch(() => '(none)')).replace(/\n/g, ' · ').slice(0, 300));
  const joinBtn = bob.locator('.join-panel button', { hasText: /Join at your Home/ });
  if (await joinBtn.count()) { await joinBtn.click(); await homeTrip(bob, 'bob', 'Bob Ashby'); }
  await bob.waitForTimeout(3000);
  console.log('bob at:', bob.url().slice(0, 100));
  console.log('bob club page:', (await bob.locator('.club-detail').innerText().catch(() => '(none)')).replace(/\n/g, ' · ').slice(0, 300));
  await bob.screenshot({ path: `${OUT}/club-2-bob.png`, fullPage: true });
  // Alice: roster now, schedule, huddle.
  await alice.goto(`${SITE}/#/clubs/${clubId}`, { waitUntil: 'networkidle' }); await alice.waitForTimeout(4000);
  console.log('alice roster:', await alice.locator('.club-roster li').allInnerTexts().then((r) => r.map((x) => x.replace(/\n/g, ' '))));
  console.log('alice rail:', (await alice.locator('.sidenav-row').allInnerTexts()).map((s) => s.replace(/\n/g, ' ')).join(' | '));
  await alice.locator('.huddle-start').first().click().catch((e) => console.log('no huddle start:', e.message.slice(0, 80)));
  await alice.waitForTimeout(8000);
  console.log('alice dock:', (await alice.locator('.huddle-dock').innerText().catch(() => '(none)')).replace(/\n/g, ' | ').slice(0, 160));
  await bob.goto(`${SITE}/#/clubs/${clubId}`, { waitUntil: 'networkidle' }); await bob.waitForTimeout(4000);
  await bob.locator('.huddle-start').first().click().catch((e) => console.log('bob no huddle start:', e.message.slice(0, 80)));
  await bob.waitForTimeout(8000);
  console.log('bob dock:', (await bob.locator('.huddle-dock').innerText().catch(() => '(none)')).replace(/\n/g, ' | ').slice(0, 160));
  await alice.waitForTimeout(2000);
  console.log('alice faces:', await alice.locator('.huddle-face').count());
  await alice.screenshot({ path: `${OUT}/club-3-huddle.png`, fullPage: false });
  alice.on('dialog', (d) => d.accept());
  await alice.locator('.huddle-btn.end').click().catch(() => {});
  await alice.waitForTimeout(2000);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
