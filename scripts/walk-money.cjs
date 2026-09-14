/**
 * A DEMO PERSON'S MONEY, on both sides of the boundary.
 *
 * The card room and the person's Home are different systems with different jobs: the Home CUSTODIES
 * the treasury and signs what may be taken from it, the card room only ever reads and asks. So "is
 * the money right" is two questions, and this asks both of the same person in one run:
 *
 *   at the HOME — does the treasury exist, and is it listed as theirs;
 *   at the CARD ROOM — is that same account the one play is funded from, with the right balance;
 *   and then the AUTHORISATION, which is the permission half: a ceremony that happens at the Home,
 *   is signed there, and comes back.
 *
 *   node scripts/walk-money.cjs [alice] [--headed]
 *
 * NOTE ON THE TWO BALANCES. The Home's treasuries page reads USDC; the card room reads Sheqel, its
 * own coin. The same account holds both, so the two numbers differ and neither is wrong — this
 * prints them side by side rather than asserting they match, because asserting that would be
 * asserting something false.
 */

const { chromium } = require('playwright');
const HOME = 'https://www.faithnet.me';
const POKER = 'https://poker.faithnet.io';
const WHO = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'alice';
const HEADED = process.argv.includes('--headed');

const tidy = (s) => s.replace(/\s+/g, ' ').trim();
const step = (s) => console.log(`· ${s}`);
const checks = [];
function check(what, got, want) {
  const ok = typeof want === 'function' ? want(got) : got === want;
  checks.push({ what, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — got ${JSON.stringify(got).slice(0, 300)}`}`);
}

(async () => {
  const browser = await chromium.launch({ headless: !HEADED });
  const page = await browser.newPage({ viewport: { width: 1300, height: 1100 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  let treasuryView = null;
  page.on('response', async (r) => {
    if (r.url().endsWith('/treasury') && r.request().method() === 'GET' && r.ok()) {
      try { treasuryView = await r.json(); } catch { /* a body we cannot read tells us nothing */ }
    }
  });

  try {
    step(`the Home, as ${WHO}`);
    await page.goto(`${HOME}/`, { waitUntil: 'networkidle' });
    const demo = page.locator('summary, button', { hasText: /Demo people/i }).first();
    if (await demo.count()) await demo.click();
    await page.waitForTimeout(1200);
    await page.locator('button, a', { hasText: new RegExp(WHO, 'i') }).first().click();
    await page.waitForTimeout(6000);

    await page.goto(`${HOME}/treasuries`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3500);
    const atHome = tidy(await page.locator('body').innerText());
    check('the Home lists at least one personal treasury', atHome, (t) => /PERSONAL TREASURY/.test(t));
    const homeBalances = [...atHome.matchAll(/Balance:\s*([\d,.]+)\s*(\w+)/g)].map((m) => `${m[1]} ${m[2]}`);
    step(`  the Home shows: ${homeBalances.join(' · ') || '(none)'}`);

    step(`the card room, as ${WHO}`);
    await page.goto(`${POKER}/#/signin`, { waitUntil: 'networkidle' });
    const sd = page.locator('.signin-demo summary');
    if (await sd.count()) await sd.click();
    await page.waitForSelector('.persona', { timeout: 30_000 });
    const p = page.locator('.persona', { hasText: new RegExp(WHO, 'i') }).first();
    await ((await p.count()) ? p : page.locator('.persona').first()).click();
    await page.waitForSelector('.room', { timeout: 60_000 });
    // WAIT FOR THE ANSWER, not for a length of time. Reading this person's money means asking their
    // Home which treasuries they have and then reading a balance for each, so somebody with a lot of
    // them legitimately takes seconds — and a fixed sleep reported "the card room could not read
    // their money at all" for a read that arrived a moment later.
    const answered = page.waitForResponse((r) => r.url().endsWith('/treasury') && r.request().method() === 'GET' && r.ok(), { timeout: 60_000 });
    await page.goto(`${POKER}/#/money`, { waitUntil: 'commit' });
    await answered;
    await page.waitForSelector('.start', { timeout: 30_000 });
    await page.waitForTimeout(1500);

    check('the card room read their money at all', treasuryView, (v) => v !== null);
    // THE BUG THIS WALK EXISTS FOR. Their Home lists treasuries; the card room used to leave none
    // CHOSEN, tell them they had no stake, and offer to create one — so a person with money got a
    // second empty account, and then a third.
    check('it CHOSE one of the treasuries their Home lists', treasuryView?.chosen, (v) => typeof v === 'string' && /^0x[0-9a-f]{40}$/.test(v));
    check('and the choice is one of the candidates, not something invented', treasuryView, (v) =>
      (v?.candidates ?? []).some((c) => c.address === v.chosen),
    );
    check('it chose a FUNDED one when there is one', treasuryView, (v) => {
      const funded = (v?.candidates ?? []).filter((c) => BigInt(c.balance ?? '0') > 0n);
      return funded.length === 0 || funded.some((c) => c.address === v.chosen);
    });
    const shown = tidy(await page.locator('.room-main').innerText());
    check('and the screen says the balance and the account by name', shown, (t) => /SHQ in \S+/.test(t));
    step(`  the card room shows: ${(/([\d,.]+ SHQ in \S+)/.exec(shown) ?? [])[1] ?? '(nothing)'}`);
    check('so it does NOT tell somebody with money to set up a stake', shown, (t) => !/Set up your stake/.test(t));

    step('the authorisation — the permission half, signed at the Home');
    const authorise = page.locator('.start button, .start a', { hasText: /Authorise buy-ins/i }).first();
    if ((await authorise.count()) === 0) {
      check('already authorised, or nothing to authorise', shown, (t) => /you can take a seat|Take a seat/i.test(t));
    } else {
      await authorise.click();
      // The ceremony is a navigation to the Home and back. Give it room, and say where it ended up.
      await page.waitForTimeout(12_000);
      step(`  landed on ${page.url().split('?')[0]}`);
      const onHome = page.url().startsWith(HOME);
      if (onHome) {
        // The Home's own words. Deliberately exact rather than a regex over every verb a consent
        // screen might use: a loose match picks "Not now" or a sign-in door and reports a ceremony
        // that never happened as one that failed.
        const consent = page.locator('button', { hasText: /^Allow / }).first();
        check('the Home asks the person to approve it, rather than deciding for them', await consent.count(), (n) => n > 0);
        if (await consent.count()) {
          // The card room comes back to `/?code=…` and EXCHANGES that code for the signed authority.
          // Waiting only for the URL to be the card room's navigates away mid-exchange and throws the
          // code away — which looks exactly like a ceremony that failed, and is a walk that broke it.
          const recorded = page
            .waitForResponse((r) => /\/auth\/home\/mandate$/.test(r.url()) && r.request().method() === 'POST', { timeout: 60_000 })
            .catch(() => null);
          await consent.click();
          const res = await recorded;
          check('the card room records the authority its Home signed', res?.status() ?? 0, 200);
        }
      }
      check('it comes back to the card room', page.url(), (u) => u.startsWith(POKER));
      await page.goto(`${POKER}/#/money`, { waitUntil: 'commit' });
      // Wait for the ANSWER to be on screen, not for a response that might be an earlier one and not
      // for a guessed number of seconds. Somebody with eighteen treasuries takes several to read.
      // Wait for the SETTLED answer. The page renders the treasury it read before the person left for
      // their Home, so "authorise buy-ins" is briefly correct on arrival; what matters is that the
      // re-read lands and the screen catches up without anybody reloading it.
      await page
        .waitForFunction(() => /take a seat|you can sit/i.test(document.querySelector('.room-main')?.textContent ?? ''), { timeout: 45_000 })
        .catch(() => null);
      const after = tidy(await page.locator('.room-main').innerText());
      check('and the card room now says they can sit down', after, (t) => /take a seat|you can sit/i.test(t));
      check('the authority names the treasury it may be redeemed against', treasuryView, (v) =>
        !v?.mandate?.present || v.mandate.treasury === v.chosen,
      );
    }

    check('no uncaught errors on either side', errors, (e) => e.length === 0);
  } catch (e) {
    check('the walk finished', String(e?.message ?? e), false);
  } finally {
    const bad = checks.filter((c) => !c.ok);
    console.log(`\n${checks.length - bad.length}/${checks.length} checks passed`);
    if (errors.length) console.log(errors.join('\n'));
    await browser.close();
    process.exit(bad.length === 0 ? 0 : 1);
  }
})();
