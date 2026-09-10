/**
 * The whole invitation, end to end, on the live site.
 *
 * A host makes a club, says what it is, sets when it meets, and invites somebody by email. Then the
 * link that invitation carries is opened COLD — a fresh browser context with no session, which is
 * what the person who was invited actually has — and what they see is checked.
 *
 * The email itself is composed at the person's Home and takes only an address, a link and a name, so
 * the invitation's content is the PAGE. That is what this walks.
 *
 *   node scripts/walk-invite.cjs [--site …] [--headed]
 */

const PLAYWRIGHT = '/home/barb/node_modules/playwright';
const { chromium } = require(PLAYWRIGHT);

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const SITE = (flag('site', 'https://poker.faithnet.io') || '').replace(/\/+$/, '');
const HEADED = args.includes('--headed');

const step = (s) => console.log(`· ${s}`);
const tidy = (s) => s.replace(/\s+/g, ' ').trim();
const checks = [];
function check(what, got, want) {
  const ok = typeof want === 'function' ? want(got) : got === want;
  checks.push({ what, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — got ${JSON.stringify(got)}`}`);
}

const WELCOME =
  'We play most Thursdays, cards at eight, and there is always food. Newcomers welcome — half the table learned canasta here.';

(async () => {
  const browser = await chromium.launch({ headless: !HEADED });
  const host = await browser.newPage({ viewport: { width: 1300, height: 1100 } });
  const errors = [];
  host.on('pageerror', (e) => errors.push(`host: ${e}`));
  let clubHash = '';

  try {
    step('signing in as a host');
    await host.goto(`${SITE}/#/signin`, { waitUntil: 'networkidle' });
    await host.locator('.signin-demo summary').click();
    await host.waitForSelector('.persona', { timeout: 30_000 });
    await host.locator('.persona').first().click();
    await host.waitForSelector('.room', { timeout: 60_000 });

    const clubName = `Invite walk ${new Date().toISOString().slice(11, 19)}`;
    step(`making "${clubName}"`);
    await host.goto(`${SITE}/#/clubs/new`, { waitUntil: 'networkidle' });
    await host.locator('.club-start input').fill(clubName);
    await host.locator('.club-start button[type=submit]').click();
    await host.waitForSelector('.club-detail', { timeout: 30_000 });
    clubHash = `#${host.url().split('#')[1]}`;

    step('saying what the club is');
    await host.locator('.club-welcome button', { hasText: /Say what this club is/ }).click();
    await host.locator('.club-welcome textarea').fill(WELCOME);
    await host.locator('.club-welcome button[type=submit]').click();
    await host.waitForTimeout(2500);
    check('the host’s words are on the club page', tidy(await host.locator('.club-welcome').innerText()), (t) => t.includes('there is always food'));

    step('setting when it meets');
    await host.locator('.nights button', { hasText: /Set when it meets/ }).click();
    await host.waitForSelector('.schedule-form', { timeout: 10_000 });
    await host.locator('.schedule-form input[type=time]').fill('20:00');
    await host.locator('.schedule-form button[type=submit]').click();
    await host.waitForSelector('.next-night', { timeout: 30_000 });
    check('a next night appears', await host.locator('.next-night').count(), 1);

    step('a calendar to subscribe to');
    await host.locator('.club-calendar summary').click();
    const calUrl = await host.locator('.club-calendar input').inputValue();
    check('the club offers a calendar URL', calUrl, (u) => /\/calendar\/.+\.ics$/.test(u));
    const ics = await (await fetch(calUrl)).text();
    check('it is a real calendar, fetched with NO session at all', ics, (t) => t.startsWith('BEGIN:VCALENDAR'));
    check('with the club’s nights in it', ics, (t) => (t.match(/BEGIN:VEVENT/g) ?? []).length >= 5);
    check('each night links into the game', ics, (t) => t.includes(`URL:${SITE}/#/clubs/`));
    check('and the host’s words ride along in the description', ics, (t) => t.includes('always food'));
    check('it publishes rather than demanding a reply', ics, (t) => t.includes('METHOD:PUBLISH'));
    // A phone shows the SUMMARY and often nothing else, so the game has to be in it.
    check('the summary says what is dealt', ics, (t) => /SUMMARY:.*(Hold|Canasta)/.test(t));

    step('inviting somebody by email');
    const email = `walk-${Date.now()}@example.com`;
    await host.locator('.club-invite input').first().fill(email);
    await host.locator('.club-invite button[type=submit]').click();
    await host.waitForSelector('.club-sent input', { timeout: 30_000 });
    const joinUrl = await host.locator('.club-sent input').inputValue();
    check('an invitation link comes back either way', joinUrl, (u) => /#\/join\//.test(u));

    // COLD. A separate context: no session, no storage, nothing — which is what the person who was
    // actually invited has when they press the link in their mail.
    step('opening the invitation cold, as the person invited');
    const guest = await browser.newContext();
    const page = await guest.newPage();
    page.on('pageerror', (e) => errors.push(`guest: ${e}`));
    await page.goto(joinUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('.join', { timeout: 30_000 });
    const said = tidy(await page.locator('.join').innerText());

    check('it says who invited them, and to what', said, (t) => t.includes('invited you to') && t.includes(clubName));
    check('it carries the host’s own words', said, (t) => t.includes('there is always food'));
    check('it says when they meet, as a rule', said, (t) => /Every Thursday at 20:00/.test(t));
    check('it names the next actual dates', said, (t) => /Thursday \d+ \w+/.test(t));
    check('it says what is dealt, for somebody who has not played', said, (t) => /Texas Hold|Canasta/.test(t));
    check('it promises the money set-up and the calendar', said, (t) => /money to play with/.test(t) && /calendar/i.test(t));
    check('and only then asks them to sign in', said, (t) => t.indexOf('there is always food') < t.lastIndexOf('Sign in'));
    // An unclaimed link must not leak who else is in the club.
    check('it does NOT leak the roster to whoever the link was forwarded to', said, (t) => !/Host|Member|Remove/.test(t));

    await guest.close();
    check('no uncaught errors anywhere', errors, (e) => e.length === 0);
  } catch (e) {
    check('the walk finished', String(e?.message ?? e), false);
  } finally {
    // Tidy up: close the club so repeated runs leave nothing behind.
    try {
      if (clubHash) {
        await host.goto(`${SITE}/${clubHash}`, { waitUntil: 'networkidle' });
        const name = tidy(await host.locator('.club-detail h2').innerText()).replace(/\s*HOST$/i, '');
        await host.locator('.club-retire summary').click();
        await host.locator('.club-retire input').fill(name);
        await host.locator('.club-retire button[type=submit]').click();
        await host.waitForTimeout(3000);
        step(`closed "${name}"`);
      }
    } catch {
      step('could not close the club — it is left behind');
    }
    const bad = checks.filter((c) => !c.ok);
    console.log(`\n${checks.length - bad.length}/${checks.length} checks passed`);
    if (errors.length) console.log(errors.join('\n'));
    await browser.close();
    process.exit(bad.length === 0 ? 0 : 1);
  }
})();
