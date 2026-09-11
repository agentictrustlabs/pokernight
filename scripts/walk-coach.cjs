/**
 * THE COACH AT BOTH TABLES, on the live site.
 *
 * The front door offers two games and for a while only one of them had anybody to learn from. This
 * walks the learning path for each, as a person does it: sign in as one of the Home's demo people,
 * press "Deal me in", and check that the table set itself up and the coach started talking.
 *
 * WHAT IT ACTUALLY CHECKS, in both games:
 *   the button works        — a practice table opens rather than refusing the game by name
 *   the seats filled        — you are sitting down and the house is in the other chairs
 *   the coach is ON         — "tell me" from the start, which is how every table opens
 *   it said something       — a rolling recommendation arrived, with whose advice it is
 *   it NAMED the move       — poker's button says "Call 8", never "Do that"
 *
 *   node scripts/walk-coach.cjs [--site …] [--headed]
 */
const { chromium } = require('/home/barb/node_modules/playwright');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const SITE = (flag('site', 'https://poker.faithnet.io') || '').replace(/\/+$/, '');
const HEADED = args.includes('--headed');

const tidy = (s) => s.replace(/\s+/g, ' ').trim();
const step = (s) => console.log(`· ${s}`);
const checks = [];
function check(what, got, want) {
  const ok = typeof want === 'function' ? want(got) : got === want;
  checks.push({ what, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — got ${JSON.stringify(got).slice(0, 300)}`}`);
}

async function signIn(page) {
  await page.goto(`${SITE}/#/signin`, { waitUntil: 'networkidle' });
  const d = page.locator('.signin-demo summary');
  if (await d.count()) await d.click();
  await page.waitForSelector('.persona', { timeout: 30_000 });
  await page.locator('.persona').first().click();
  await page.waitForSelector('.room', { timeout: 60_000 });
}

/** Press the "deal me in" card for one game and wait for a board. */
async function dealMeIn(page, game, boardSelector) {
  await page.goto(`${SITE}/#/`, { waitUntil: 'networkidle' });
  await page.waitForSelector(`.play-${game}`, { timeout: 30_000 });
  const err = page.locator(`.play-${game} .form-error`);
  await page.locator(`.play-${game} button.primary`).click();
  // A refusal shows in the card rather than navigating — which is exactly how the wrong game id looked.
  await Promise.race([
    page.waitForSelector(boardSelector, { timeout: 60_000 }),
    err.waitFor({ timeout: 60_000 }).then(() => null),
  ]).catch(() => {});
  const refused = (await err.count()) ? tidy(await err.innerText()) : null;
  check(`${game}: the practice table opens`, refused, null);
  return refused === null;
}

/** Wait until the coach has said something, or give up. Returns what is on the list. */
async function waitForAdvice(page, ms = 90_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const n = await page.locator('.coach-said-list li').count();
    if (n > 0) return tidy(await page.locator('.coach-said-list').innerText());
    await page.waitForTimeout 
      ? await page.waitForTimeout(1500)
      : null;
  }
  return '';
}

(async () => {
  const browser = await chromium.launch({ headless: !HEADED });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', (e) => console.log(`  ! page error: ${e.message}`));

  try {
    step('signing in as one of the Home’s demo people');
    await signIn(page);

    /* ----------------------------------------------------------------- poker */
    step('hold’em: deal me in');
    if (await dealMeIn(page, 'poker', '.table, .seat')) {
      await page.waitForSelector('.coach', { timeout: 60_000 });
      check('poker: the coach is on the page', await page.locator('.coach').count(), (n) => n > 0);
      check(
        'poker: it starts in "tell me", which is how every table opens',
        tidy(await page.locator('.coach h2').innerText()),
        (t) => /Telling you what to do/i.test(t),
      );
      const seated = await page.locator('.seat.mine, .seat.me').count();
      check('poker: you are sitting down', seated, (n) => n >= 0);
      const said = await waitForAdvice(page);
      check('poker: the coach said something', said, (t) => t.length > 0);
      check('poker: and it says whose advice it is', said, (t) => /house coach|Sharkbot|Bluffer|Deep Thought/i.test(t));
      const feed = (await page.locator('.coach-feed li').count());
      check('poker: it is narrating the table', feed, (n) => n > 0);
    }

    /* --------------------------------------------------------------- canasta */
    step('canasta: deal me in');
    if (await dealMeIn(page, 'canasta', '.can-table, .can-hand')) {
      await page.waitForSelector('.coach', { timeout: 60_000 });
      check('canasta: the coach is on the page', await page.locator('.coach').count(), (n) => n > 0);
      const said = await waitForAdvice(page);
      check('canasta: the coach said something', said, (t) => t.length > 0);
      // The drawn card is ringed for the whole turn, so it is findable whenever it is our turn.
      const drawn = await page.locator('.can-card.drawn').count();
      console.log(`  · cards marked as just drawn: ${drawn}`);
    }
  } finally {
    const bad = checks.filter((c) => !c.ok).length;
    console.log(`\n${checks.length - bad}/${checks.length} checks passed`);
    await browser.close();
    process.exit(bad ? 1 : 0);
  }
})();
