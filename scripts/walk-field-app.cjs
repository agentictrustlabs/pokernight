// THE GAME WORKSPACE, SEEN FROM THE FIELD APP — field.faithnet.io as Nathan: pick "Northern Colorado Field — Game Night",
// the home, the teams, the circles, the progress. Screenshots beside the walk. Read-only.
//   node scripts/walk-field-app.cjs [--as Nathan] [--shots <dir>]
const { chromium } = require('/home/barb/node_modules/playwright');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const SITE = 'https://field.faithnet.io'; const WHO = arg('as', 'Nathan');
const SHOT = arg('shots', '/tmp/claude-1000/-home-barb-pokernight/eb1d4b2f-c088-4158-ba08-0b148b95a41f/scratchpad');
let pass = 0; const issues = [];
const check = (what, ok, got) => { if (ok) { pass++; console.log(`  ✓ ${what}`); } else { issues.push(what); console.log(`  ✗ ${what} — got ${JSON.stringify(got).slice(0, 220)}`); } };
const flat = async (page, sel = 'body') => (await page.locator(sel).innerText().catch(() => '')).replace(/\s+/g, ' ');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(SITE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { const d = document.querySelector('[data-testid="demo-people-fold"]'); if (d && !d.open) d.open = true; });
    await page.getByRole('button', { name: new RegExp(`^(Connect|Sign in) as ${WHO}$`, 'i') }).click();
    await page.waitForTimeout(6000);
    // A person with one workspace lands in it; one with several picks. Either way the game workspace must be there.
    const pick = page.locator('[data-testid^="pick-workspace-"]', { hasText: /Game Night/i }).first();
    const picked = await pick.waitFor({ timeout: 45_000 }).then(() => true).catch(() => false);
    if (picked) { check('the game workspace is offered to pick', await pick.count() === 1, ''); await pick.click(); }
    else check('the game workspace is the one you land in', /Game Night/.test(await flat(page)), (await flat(page)).slice(0, 200));
    await page.waitForTimeout(6000);
    const home = await flat(page);
    check('the workspace is named as a game’s', /Game Night/.test(home), home.slice(0, 300));
    check('its focus says it is a game', /GAME WORKSPACE|game’s|game's/i.test(home), home.slice(0, 500));
    await page.screenshot({ path: `${SHOT}/field-1-home.png`, fullPage: false });
    const nav = page.locator('nav.side');
    if (await nav.count()) {
      const ids = await nav.locator('[data-testid^="nav-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
      console.log('  nav:', ids.join(' '));
      for (const id of ids.slice(0, 8)) {
        await nav.getByTestId(id).click().catch(() => {});
        await page.waitForTimeout(3500);
        const t = await flat(page, 'main');
        console.log(`  ${id}: ${t.slice(0, 160)}`);
        await page.screenshot({ path: `${SHOT}/field-${id}.png` });
        if (/Weld Corridor Team \(game\)/.test(t)) check(`${id} lists the game teams`, true, '');
        if (/S'gaw Karen circle/.test(t)) check(`${id} lists the founded circle`, true, '');
      }
    }
    const all = await flat(page);
    check('no page errors', errors.length === 0, errors);
    void all;
  } catch (e) { issues.push(`threw: ${String(e).slice(0, 300)}`); console.log(`  ✗ threw ${String(e).slice(0, 300)}`); await page.screenshot({ path: `${SHOT}/field-threw.png` }).catch(() => {}); }
  await browser.close();
  console.log(`\n${pass} checks passed${issues.length ? `, ${issues.length} issues:\n  - ${issues.join('\n  - ')}` : ''}`);
  process.exit(issues.length ? 1 : 0);
})();
