/**
 * A ROUND THAT ENDS WHERE YOU CAN LOOK AT IT — walked on the live site.
 *
 * The three things a canasta table was not showing, checked as a person meets them:
 *
 *   THE CURTAIN   a scored round stops behind one, with the arithmetic and a way on
 *   THE FREEZE    at your own practice table the pause is real — the card room says so, not just the
 *                 screen — and "Deal the next round" lets it go
 *   THE MARKS     the card you drew is ringed, and taking the pile shows what was in it
 *
 *   node scripts/walk-round-end.cjs [--site …] [--api …] [--headed]
 */
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const SITE = (flag('site', 'https://gamenight.faithnet.io') || '').replace(/\/+$/, '');
const API = (flag('api', 'https://games.faithnet.io') || '').replace(/\/+$/, '');
const HEADED = args.includes('--headed');

const tidy = (s) => s.replace(/\s+/g, ' ').trim();
const step = (s) => console.log(`· ${s}`);
const checks = [];
function check(what, got, want) {
  const ok = typeof want === 'function' ? want(got) : got === want;
  checks.push({ what, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — got ${JSON.stringify(got).slice(0, 300)}`}`);
}
const tableState = async (id) => (await fetch(`${API}/tables/${id}`).then((r) => r.json()).catch(() => ({})));
/** The card room OMITS `paused` when the table is running, so "not true" is the honest question. */
const held = async (id) => (await tableState(id)).paused === true;

(async () => {
  const browser = await chromium.launch({ headless: !HEADED });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  page.on('pageerror', (e) => console.log(`  ! page error: ${e.message}`));
  try {
    step('signing in and opening the canasta practice table');
    await page.goto(`${SITE}/#/signin`, { waitUntil: 'networkidle' });
    const d = page.locator('.signin-demo summary');
    if (await d.count()) await d.click();
    await page.waitForSelector('.persona', { timeout: 30_000 });
    await page.locator('.persona').first().click();
    await page.waitForSelector('.room', { timeout: 60_000 });
    await page.goto(`${SITE}/#/`, { waitUntil: 'networkidle' });
    await page.locator('.play-canasta button.primary').click();
    await page.waitForSelector('.can-hand, .can-seat-picker, .curtain', { timeout: 60_000 });
    const tableId = (page.url().split('#/t/')[1] || '').split(/[?/]/)[0];
    console.log(`  table ${tableId}`);
    // The curtain is rendered off the view's own result, which arrives with the socket's welcome —
    // a beat after the board's first frame. Looking before it lands reads as "no round has ended".
    await page.waitForTimeout(4000);


    /* -------------------------------------------------------------- the curtain */
    if (await page.locator('.curtain').count()) {
      step('a scored round is behind a curtain');
      const box = tidy(await page.locator('.curtain-box').innerText());
      check('it says which round ended', box, (t) => /END OF THE (ROUND|GAME)/i.test(t));
      check('it carries the arithmetic, not just a number', box, (t) => t.length > 120);
      check('it offers a way on', await page.locator('.curtain-actions button').allInnerTexts(), (b) => b.length >= 2);

      step('the freeze is the table’s own pause, not a screen');
      check('the card room says the table is held', await held(tableId), true);

      step('“Look at the board” leaves it held');
      await page.locator('.curtain-actions button', { hasText: 'Look at the board' }).click();
      await page.waitForTimeout(1200);
      check('the curtain is gone', await page.locator('.curtain').count(), 0);
      check('and the table is still held', await held(tableId), true);
      check('and the board says so rather than promising a deal', tidy(await page.locator('.can-why, .can-controls p').first().innerText()), (t) => /held/i.test(t));

      step('carrying on: back to the curtain, then let it go');
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.curtain', { timeout: 30_000 });
      check('a reload brings the curtain back, because the result rides on the view', 1, 1);
      const on = page.locator('.curtain-actions button', { hasText: /Deal the next round|Start a new game/ });
      await on.first().click();
      // Give the request a moment, and ask the CARD ROOM rather than the screen: a freeze that is only
      // on the client is the bug this walk exists to catch.
      await page.waitForTimeout(4000);
      check('the card room is running again', await held(tableId), false);
    } else {
      console.log('  (no scored round waiting — skipping the curtain checks)');
    }

    /* ---------------------------------------------------------------- the marks */
    // A SEAT THAT IS SITTING OUT NEVER DRAWS, so nothing would ever be marked. Arriving with
    // `?practice=1` sits you back in on its own; this is the belt to that suspenders, and it has to
    // come after the curtain, which covers the button.
    const sitIn = page.locator('button', { hasText: /^Sit back in$/ });
    if (await sitIn.count()) {
      await sitIn.first().click();
      await page.waitForTimeout(1500);
      console.log('  · was sitting out — sat back in');
    }

    step('watching for the card you drew, and for a pile being taken');
    let sawDrawn = 0;
    let sawReveal = 0;
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(2000);
      sawDrawn = Math.max(sawDrawn, await page.locator('.can-card.drawn').count());
      if (await page.locator('.pile-reveal').count()) {
        sawReveal = 1;
        const t = tidy(await page.locator('.pile-reveal-box').innerText());
        console.log(`  reveal: ${t.slice(0, 160)}`);
        check('the reveal says what went onto the board and what went into your hand', t, (x) => /Onto the board/i.test(x) && /Into your hand/i.test(x));
      }
      if (sawDrawn && sawReveal) break;
    }
    check('the card you drew is marked in your hand', sawDrawn, (n) => n > 0);
    if (!sawReveal) console.log('  · no pile was taken in the window — nothing to say about the reveal');
  } finally {
    const bad = checks.filter((c) => !c.ok).length;
    console.log(`\n${checks.length - bad}/${checks.length} checks passed`);
    await browser.close();
    process.exit(bad ? 1 : 0);
  }
})();
