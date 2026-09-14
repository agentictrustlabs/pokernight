/**
 * FILLING A CANASTA TABLE, and deciding who is on your side.
 *
 * Canasta is four, in two fixed partnerships — seats 0 and 2 against 1 and 3 — so a person alone, or
 * two friends, cannot play without the house sitting in the other chairs. This walks that on the live
 * site: open a table, take a seat, and check both roads.
 *
 *   FILL EVERYTHING  three house players, the round deals.
 *   KEEP A CHAIR     two house players and one chair held — and the chair held is the one that was
 *                    asked for, which is the whole point: "they play with me" must keep the seat
 *                    ACROSS from you, or two friends end up on opposite sides of a game they sat down
 *                    to play together.
 *
 *   node scripts/walk-fill.cjs [--site …] [--headed]
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
  console.log(`  ${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — got ${JSON.stringify(got).slice(0, 240)}`}`);
}

/** Sign in, open a canasta table, take a seat. Returns the table id and the seat taken. */
async function tableWithMe(page) {
  await page.goto(`${SITE}/#/signin`, { waitUntil: 'networkidle' });
  const d = page.locator('.signin-demo summary');
  if (await d.count()) await d.click();
  await page.waitForSelector('.persona', { timeout: 30_000 });
  await page.locator('.persona').first().click();
  await page.waitForSelector('.room', { timeout: 60_000 });

  await page.goto(`${SITE}/#/tables`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.lobby-create summary', { timeout: 30_000 });
  await page.locator('.lobby-create summary').click();
  await page.locator('.lobby-create input[type=text]').first().fill(`Fill ${new Date().toISOString().slice(11, 19)}`);
  await page.locator('.lobby-create select').first().selectOption('canasta');
  await page.waitForTimeout(300);
  await page.locator('.lobby-create button[type=submit]').click();
  await page.waitForSelector('.can-seat-picker, .can-seated', { timeout: 40_000 });
  const tableId = (page.url().split('#/t/')[1] || '').split(/[?/]/)[0];
  if (await page.locator('.can-seat-picker').count()) {
    await page.locator('.can-seat-picker button:not([disabled])').first().click();
  }
  await page.waitForSelector('.can-seated', { timeout: 30_000 });
  const seat = Number((/Seat (\d)/.exec(tidy(await page.locator('.can-seated').innerText())) ?? [])[1] ?? 1) - 1;
  return { tableId, seat };
}

/** Who is sitting where, straight from the card room. */
async function seatsOf(tableId) {
  const r = await fetch(`${API}/tables/${tableId}`);
  if (!r.ok) return [];
  const d = await r.json();
  return (d.view?.seats ?? []).map((s) => s.seat).sort((a, b) => a - b);
}

(async () => {
  const browser = await chromium.launch({ headless: !HEADED });
  const errors = [];
  const made = [];
  try {
    /* ---------------------------------------------------- keeping a chair, on my side */
    const a = await browser.newPage({ viewport: { width: 1300, height: 1100 } });
    a.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    step('a table with one person in it');
    const one = await tableWithMe(a);
    made.push(one.tableId);
    step(`  seat ${one.seat}, table ${one.tableId}`);

    await a.waitForSelector('.can-fill', { timeout: 30_000 });
    check('the table offers the house when chairs are empty', await a.locator('.can-fill').count(), 1);
    check('and says canasta is played in partnerships', tidy(await a.locator('.can-fill').innerText()), (t) => /two partnerships/.test(t));

    step('keeping a chair for somebody on MY side');
    await a.locator('.can-keep summary').click();
    const said = tidy(await a.locator('.can-keep').innerText());
    check('it says which chair will be kept, before anything is pressed', said, (t) => /across from you, on your side/.test(t));
    await a.locator('.can-keep button', { hasText: 'They play with me' }).click();
    await a.waitForTimeout(6000);

    const after = await seatsOf(one.tableId);
    const partner = (one.seat + 2) % 4;
    check('two house players sat down', after.length, 3);
    check('and the chair ACROSS from me was kept — the whole point', after, (s) => !s.includes(partner));
    check('so the empty chair is my partner’s', after, (s) => s.length === 3 && !s.includes(partner));

    /* ------------------------------------------------------------- filling everything */
    const b = await browser.newPage({ viewport: { width: 1300, height: 1100 } });
    b.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    step('a second table, filled outright');
    const all = await tableWithMe(b);
    made.push(all.tableId);
    await b.waitForSelector('.can-fill', { timeout: 30_000 });
    await b.locator('.can-fill button.primary').click();
    // The round deals the moment the fourth chair is taken.
    await b.waitForSelector('.can-hand .can-card', { timeout: 60_000 });
    check('every chair filled', (await seatsOf(all.tableId)).length, 4);
    check('and the round dealt — a person alone can play', await b.locator('.can-hand .can-card').count(), (n) => n > 0);
    check('the panel is gone once there is nothing to fill', await b.locator('.can-fill').count(), 0);
    const plates = (await b.locator('.can-plate .cs-name').allInnerTexts()).map(tidy);
    check('three house players are at the table by name', plates.length, (n) => n >= 3);
    step(`  at the table: ${plates.join(', ')}`);

    check('no uncaught errors', errors, (e) => e.length === 0);
  } catch (e) {
    check('the walk finished', String(e?.message ?? e), false);
  } finally {
    // Tidy: unseat the agents so these tables do not sit in the public list with bots in them.
    for (const id of made) {
      for (const seat of [0, 1, 2, 3]) {
        await fetch(`${API}/tables/${id}/seat-agent/${seat}`, { method: 'DELETE' }).catch(() => {});
      }
    }
    const bad = checks.filter((c) => !c.ok);
    console.log(`\n${checks.length - bad.length}/${checks.length} checks passed`);
    if (errors.length) console.log(errors.join('\n'));
    await browser.close();
    process.exit(bad.length === 0 ? 0 : 1);
  }
})();
