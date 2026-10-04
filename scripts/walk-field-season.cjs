/**
 * THE SEASON, SEEN FROM THE FIELD APP — field.faithnet.io as Naomi (a game character who stewards the Weld team):
 * every screen a season's records are meant to fill, with a People Community pinned. Read-only.
 *
 *   node scripts/walk-field-season.cjs [--people "S'gaw Karen"] [--shots <dir>]
 *
 * The field app draws each screen from ONE vault and joins by id, so an empty screen is how a record in the wrong
 * place shows itself. This checks the joins as a person sees them: the peoples the workspace works with; a circle
 * with its numbers; the community's own page with its people group and phase; the work board, the plan, Progress;
 * Research's alignment and phase profile; the towns on the map.
 */
const { chromium } = require('playwright');
const argv = process.argv.slice(2); const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const SITE = 'https://field.faithnet.io'; const WS = '0xF28BE6eF1b4EdB1313bcF89dd304a426F1537bB6'; const WELD = '0x7769E189F349301bdC2D6520A4026af34a7FB91f';
const PEOPLE = arg('people', "S'gaw Karen"); const SHOT = arg('shots', require('os').tmpdir());
let pass = 0; const issues = [];
const check = (what, ok, got) => { if (ok) { pass++; console.log(`  ✓ ${what}`); } else { issues.push(what); console.log(`  ✗ ${what} — ${JSON.stringify(got).slice(0, 320)}`); } };
const flat = async (page, sel = 'main') => (await page.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { const d = document.querySelector('[data-testid="demo-people-fold"]'); if (d && !d.open) d.open = true; });
  const b = page.locator('[data-testid^="connect-as-"]').filter({ hasText: /naomi/i }).first(); await b.waitFor({ timeout: 90000 }); await b.click();
  await page.waitForTimeout(7000);
  // Wait for a screen to SAY something, never for a number of seconds alone: a list that is still loading reads as empty.
  // IDLE means the app's own loading bar has been off for two seconds running — every read goes through it.
  const idle = async (ms = 150000) => { const t0 = Date.now(); let quiet = 0; while (Date.now() - t0 < ms && quiet < 4) { const on = await page.locator('[data-testid="loading-bar"].on').count(); quiet = on ? 0 : quiet + 1; await page.waitForTimeout(500); } };
  const until = async (re, ms = 120000) => { const t0 = Date.now(); let t = ''; await page.waitForTimeout(800); await idle(ms); while (Date.now() - t0 < ms) { t = await flat(page); if (re.test(t)) return t; await page.waitForTimeout(2000); await idle(20000); } return t; };
  const shot = (name) => page.screenshot({ path: `${SHOT}/field-season-${name}.png`, fullPage: true }).catch(() => {});

  await page.goto(`${SITE}/w/${WS}/t/${WELD}/circles`, { waitUntil: 'domcontentloaded' });
  let t = await until(/\d+ circles? · \d+ church/);
  check('the team’s circle is on the board, with its numbers', /1 circle/.test(t) && /Windsor/.test(t) && /participants/.test(t), t.slice(0, 300)); await shot('circles');

  await page.goto(`${SITE}/w/${WS}/t/${WELD}/communities`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="community-row"]', { timeout: 120000 });
  const rows = await page.locator('[data-testid="community-row"]').count();
  check('the peoples the workspace works with are listed', rows >= 10, rows);
  await page.locator('[data-testid="community-row"]').filter({ hasText: PEOPLE }).first().click();
  t = await until(/READING Phase \d/);
  check('the community’s page names its people group and its phase', /aligned at \w+ confidence/.test(t) && /Phase \d · /.test(t), t.slice(0, 300));
  check('and counts what happened among them', /[1-9]\d* activities/.test(t), t.slice(300, 700)); await shot('community');

  const go = async (id, re, ms) => { await page.getByTestId(`nav-${id}`).first().click(); return until(re, ms); };
  t = await go('work', /DONE · \d/);
  check('Work shows the team’s focus and the ladder’s items', /Team Focus/.test(t) && /DONE · [1-9]/.test(t) && /(TODAY|CURRENT) · [1-9]/.test(t), t.slice(0, 600)); await shot('work');
  t = await go('plan', /Season plan/);
  check('Plans shows the season’s local plan with its work packages', /Season plan — /.test(t) && /Be present among them/.test(t) && /Send a daughter church/.test(t), t.slice(0, 500)); await shot('plan');
  t = await go('assess', /Phase \d — /);
  check('Progress shows a phase for the peoples', (t.match(/Phase \d — /g) ?? []).length >= 4, t.slice(0, 400)); await shot('progress');
  t = await go('research', /People groups aligned to .* — [1-9]/);
  check('Research shows the alignment and the phase profile', /confidence \w+ · rop3 \d+/.test(t) && /1 community at Phase \d/.test(t), t.slice(300, 900)); await shot('research');
  await page.getByRole('button', { name: 'Geography' }).first().click();
  t = await until(/Held here — [1-9]/);
  check('Geography holds the towns and overlays the peoples', /Held here — [1-9]/.test(t) && /community\/circle overlays/.test(t) && /Defines \d+:/.test(t), t.slice(300, 900)); await shot('geography');
  check('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log(`\n${pass} checks passed${issues.length ? `, ${issues.length} issues:\n  - ${issues.join('\n  - ')}` : ''}`);
  process.exit(issues.length ? 1 : 0);
})().catch((e) => { console.error('threw', String(e).slice(0, 500)); process.exit(1); });
