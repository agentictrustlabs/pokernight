/**
 * Walk every road through the card room, as a real signed-in person, on the real deployment.
 *
 * WHAT IT IS FOR. The navigation redesign moved every destination: the lobby became a rail plus four
 * pages, a club became a URL, and leaving a table changed where it lands. None of that is provable by
 * a render test — a route that resolves to a page nobody can reach is a passing test and a broken
 * site. So this presses the actual links in the actual rail and asserts where it ends up.
 *
 *   node scripts/walk-nav.cjs [--site https://poker.faithnet.io] [--headed]
 *
 * IT MAKES A CLUB AND CLOSES IT AGAIN. There is no other way to see a club page and no way to fake one —
 * a club you are not in is indistinguishable from one that does not exist. It used to have to reuse a
 * fixed one, because a club could not be closed and every run left another behind; `DELETE /clubs/:id`
 * is what that limitation was waiting for. So every run now walks the whole road — create, land on it,
 * find it in the rail, close it — and leaves the rail exactly as it found it.
 *
 * Playwright lives at ~/node_modules and is required by absolute path, which is why this is `.cjs`.
 */

const PLAYWRIGHT = '/home/barb/node_modules/playwright';
const { chromium } = require(PLAYWRIGHT);

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const SITE = (flag('site', 'https://poker.faithnet.io') || '').replace(/\/+$/, '');
const HEADED = args.includes('--headed');

const step = (s) => console.log(`· ${s}`);
const tidy = (s) => s.replace(/\s+/g, ' ').trim();

/** Every check prints its verdict, so a run that fails says which road is broken rather than "failed". */
const checks = [];
function check(what, got, want) {
  const ok = typeof want === 'function' ? want(got) : got === want;
  checks.push({ what, ok, got });
  console.log(`  ${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — got ${JSON.stringify(got)}`}`);
}

/** The hash, without the origin, which is the only part any of this is about. */
const hashOf = (page) => `#${(page.url().split('#')[1] ?? '')}`;

(async () => {
  const browser = await chromium.launch({ headless: !HEADED });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  try {
    step(`opening ${SITE}`);
    await page.goto(`${SITE}/#/`, { waitUntil: 'networkidle' });

    // THE FRONT DOOR, SIGNED OUT. Two doors, because two different people arrive here.
    const hero = tidy(await page.locator('.hero-actions').innerText());
    check('the landing page offers a club AND a hand', hero, (t) => /Start a club/.test(t) && /play a hand/i.test(t));

    step('signing in as one of the Home’s demo people');
    await page.goto(`${SITE}/#/signin`, { waitUntil: 'networkidle' });
    await page.locator('.signin-demo summary').click();
    await page.waitForSelector('.persona', { timeout: 30_000 });
    const who = await page.locator('.persona-name').first().innerText();
    await page.locator('.persona').first().click();
    await page.waitForSelector('.room', { timeout: 60_000 });
    step(`signed in as ${who}`);

    // WHERE SIGNING IN LANDS. Play, not a lobby: the commonest visitor came to be dealt a hand.
    check('signing in lands on the front door', hashOf(page), '#/');
    check('and the front door is Play', await page.locator('.play-card').count(), (n) => n >= 2);
    check('with a rail beside it', await page.locator('.sidenav').count(), 1);
    check('Play is the row marked as where you are', tidy(await page.locator('.sidenav-row.on').innerText()), (t) => /^Play/.test(t));

    // THE RAIL ITSELF. Four rows before any club exists, and one of them is an offer, not a mode.
    const rows = (await page.locator('.sidenav-row .sidenav-label').allInnerTexts()).map(tidy);
    check('the rail reads Play, Tables, Your money', rows.slice(0, 3), (r) => r.join('|') === 'Play|Tables|Your money');
    check('no control in the rail switches context', await page.locator('.sidenav select, .sidenav button').count(), 0);

    step('Tables');
    await page.locator('.sidenav-row', { hasText: 'Tables' }).click();
    await page.waitForTimeout(600);
    check('Tables is a route of its own', hashOf(page), '#/tables');
    check('and it lists tables', await page.locator('.panel h2').first().innerText(), (t) => /tables/i.test(t));
    check('with a form to open one, folded shut', await page.locator('.lobby-create').count(), 1);

    step('Your money');
    await page.locator('.sidenav-row', { hasText: 'Your money' }).click();
    await page.waitForTimeout(600);
    check('money is a route of its own', hashOf(page), '#/money');
    check('and it is the set-up card', await page.locator('.money-page .panel').count(), (n) => n >= 1);

    // A REFRESH MUST SURVIVE. This is the bug the whole redesign started from: the club you were
    // looking at lived in the lobby's own state, so a refresh threw it away and a link never worked.
    await page.reload({ waitUntil: 'networkidle' });
    check('a refresh keeps you on money', hashOf(page), '#/money');

    const clubName = `Nav walk ${new Date().toISOString().slice(11, 19)}`;
    step(`starting the club "${clubName}"`);
    await page.locator('.sidenav-row, .sidenav-add', { hasText: /Start a club|Start another/ }).first().click();
    await page.waitForTimeout(600);
    check('starting a club is a page, not a form in the rail', hashOf(page), '#/clubs/new');
    await page.locator('.club-start input').fill(clubName);
    await page.locator('.club-start button[type=submit]').click();
    // Wait for the LANDING, not for a guessed number of milliseconds. Creating a club waits on the
    // player's club index being written before it answers, so a fixed sleep was timing a round trip
    // that got longer — and reporting the redirect as missing when it had merely not happened yet.
    await page.waitForFunction(() => /^#\/clubs\/[0-9a-f-]{36}$/.test(location.hash), { timeout: 30_000 }).catch(() => {});
    // `.room-main .panel` is satisfied by the "Reading the club…" panel, so waiting on it waits for
    // nothing. `.club-detail` only exists once the club itself has answered.
    await page.waitForSelector('.club-detail', { timeout: 30_000 }).catch(() => {});
    // THE RACE THIS CAUGHT: the index write was fire-and-forget, so the club was not in the rail when
    // the new host was sent to it.
    check('a new club lands you ON the club', hashOf(page), (h) => /^#\/clubs\/[0-9a-f-]{36}$/.test(h));

    const clubHash = hashOf(page);
    check('a club is a URL of its own', clubHash, (h) => /^#\/clubs\/[0-9a-f-]{36}$/.test(h));
    check('the club page names it', tidy(await page.locator('.room-main').innerText()), (t) => t.includes(clubName));
    check('and leads with its TABLES, not its roster', await page.locator('.room-main .panel h2').first().innerText(), (t) =>
      /Tables at/.test(t),
    );
    check('the club is in the rail, by name', (await page.locator('.sidenav-row .sidenav-label').allInnerTexts()).map(tidy), (r) =>
      r.includes(clubName),
    );
    check('and it is the row marked as where you are', tidy(await page.locator('.sidenav-row.on .sidenav-label').innerText()), clubName);
    // Singular for one, plural for more. Which one is right depends on the demo person this run drew,
    // so the check is against the count in front of it rather than against a number this script guessed.
    const clubRows = (await page.locator('.sidenav-clubs .sidenav-row').count());
    check(
      'the heading agrees with how many clubs are under it',
      [clubRows, tidy(await page.locator('.sidenav-heading').innerText())],
      ([n, h]) => (n === 1 ? h === 'YOUR CLUB' : h === 'YOUR CLUBS'),
    );

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.club-detail', { timeout: 30_000 });
    check('a refresh keeps you on the club', hashOf(page), clubHash);
    check('and the club still renders after one', tidy(await page.locator('.room-main').innerText()), (t) => t.includes(clubName));

    // A CLUB YOU ARE NOT IN. 404 either way, on purpose, and this page must not tell the two apart.
    await page.goto(`${SITE}/#/clubs/00000000-0000-4000-8000-000000000000`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const stranger = tidy(await page.locator('.room-main').innerText());
    check('a club you are not in says one thing for both reasons', stranger, (t) => /not a club you are in/i.test(t));
    check('and does not confirm whether it exists', stranger, (t) => !/does not exist|no such|forbidden|403/i.test(t));

    // THERE IS NO DIRECTORY, and there never will be.
    await page.goto(`${SITE}/#/clubs`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    check('#/clubs is not a directory', await page.locator('.play-card').count(), (n) => n >= 2);

    step(`closing "${clubName}" again`);
    await page.goto(`${SITE}${clubHash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.club-retire summary', { timeout: 30_000 });
    await page.locator('.club-retire summary').click();
    const warned = tidy(await page.locator('.club-retire-what').innerText());
    check('it says what closing does before it offers the control', warned, (t) => /no undo/i.test(t) && /everybody/i.test(t));
    // The confirm button is dead until the club's own name is typed back. This is the whole safety of
    // an irreversible act, so it is checked rather than assumed.
    check('the button is dead until the name is typed back', await page.locator('.club-retire button[type=submit]').isDisabled(), true);
    await page.locator('.club-retire input').fill('not the name');
    check('and stays dead for the wrong name', await page.locator('.club-retire button[type=submit]').isDisabled(), true);
    await page.locator('.club-retire input').fill(clubName);
    check('and lives for the right one', await page.locator('.club-retire button[type=submit]').isDisabled(), false);
    await page.locator('.club-retire button[type=submit]').click();
    await page.waitForSelector('.club-retire.done', { timeout: 30_000 });
    check('it says what it did', tidy(await page.locator('.club-retire.done p').innerText()), (t) => t.includes(clubName) && /closed/i.test(t));

    await page.goto(`${SITE}/#/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    check(
      'and the club is out of the rail — nobody is left holding a row that 404s',
      (await page.locator('.sidenav-clubs .sidenav-row .sidenav-label').allInnerTexts()).map(tidy),
      (r) => !r.includes(clubName),
    );
    await page.goto(`${SITE}${clubHash}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    check('a closed club answers like one that never was', tidy(await page.locator('.room-main').innerText()), (t) =>
      /not a club you are in/i.test(t),
    );

    // THE FRONT PAGE, READABLE SIGNED IN. It had no route at all: rendered only for a visitor with no
    // session, so the product explanation disappeared the moment somebody had an account.
    step('the front page, signed in');
    await page.locator('.sidenav-about').click();
    await page.waitForTimeout(1200);
    check('the rail reaches the front page', hashOf(page), '#/about');
    const about = tidy(await page.locator('.landing').innerText());
    check('and it is the product explanation', about, (t) => /How a night works/i.test(t));
    check('which no longer pitches signing in to somebody signed in', about, (t) => !/There is no account to create/i.test(t));
    check('and offers a way back to a table', about, (t) => /Play a hand/i.test(t));
    check('its live rows are links, because watching needs no session', await page.locator('.landing .tables a[href^="#/t/"]').count(), (n) => n > 0);

    step('a practice table, and leaving it');
    await page.goto(`${SITE}/#/`, { waitUntil: 'networkidle' });
    await page.locator('.play-canasta button').click();
    await page.waitForSelector('.can-hand, .can-seated, .can-seat-picker', { timeout: 60_000 });
    check('Play deals you into a table in one press', hashOf(page), (h) => /^#\/t\/[0-9a-f-]{36}\?practice=1$/.test(h));
    check('and a table has no rail', await page.locator('.sidenav').count(), 0);

    await page.waitForTimeout(4000);

    // A PRACTICE TABLE REACHED WITHOUT `?practice=1` — a bookmark, a copied link, a typed one. The
    // controls used to hang off the query string, so the same table gave you pause, reset and pace on
    // one road and a screen with none of them on every other.
    const bare = hashOf(page).split('?')[0];
    await page.goto(`${SITE}${bare}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.can-seated, .can-hand', { timeout: 60_000 });
    await page.waitForTimeout(2500);
    check('your own practice table keeps its controls without the query string', await page.locator('.can-practice').count(), 1);
    check('including the pace', await page.locator('.can-practice input[type=range]').count(), 1);

    const leave = page.locator('button', { hasText: /^Leave/ });
    if (await leave.count()) {
      await leave.first().click();
      await page.waitForFunction(() => location.hash !== '' && !location.hash.startsWith('#/t/'), { timeout: 20_000 }).catch(() => {});
      // "When I leave a table it needs to return me to the open tables screen."
      check('leaving a table returns you to the open tables', hashOf(page), '#/tables');
    } else {
      check('leaving a table returns you to the open tables', 'no Leave button found', false);
    }

    check('no uncaught errors anywhere on the walk', errors, (e) => e.length === 0);
  } catch (e) {
    check('the walk finished', String(e && e.message ? e.message : e), false);
  } finally {
    const bad = checks.filter((c) => !c.ok);
    console.log(`\n${checks.length - bad.length}/${checks.length} checks passed`);
    if (errors.length) console.log(`page errors:\n  ${errors.join('\n  ')}`);
    await browser.close();
    process.exit(bad.length === 0 ? 0 : 1);
  }
})();
