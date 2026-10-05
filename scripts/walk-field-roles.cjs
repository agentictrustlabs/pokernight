/**
 * THE FIELD APP SHOWS WHAT EVERYBODY ON A TEAM DOES — walked live as Naomi, the Weld team's lead (a game character).
 *
 *   node scripts/walk-field-roles.cjs [--shots <dir>] [--headed]
 *
 * `pnpm roles:fieldops` gave the season's people their roles (the estate's spec 427) and the season wrote them onto
 * its roster rows. This opens the team's Members screen as Naomi, then Settings as Nathan (who manages teams), in a
 * real browser and checks that each row says the FUNCTION (team lead, field worker, coach) beside the access word,
 * that whoever manages teams gets a picker for it, and that the invite forms offer the catalogue. It changes nothing: no role is set, nobody is
 * invited — the role change itself is proven against the gateway (the `field.member-role-set` check in the docs).
 */
const { chromium } = require('playwright');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const SITE = 'https://field.faithnet.io'; const WS = '0xF28BE6eF1b4EdB1313bcF89dd304a426F1537bB6'; const WELD = '0x7769E189F349301bdC2D6520A4026af34a7FB91f'; const BOULDER = '0xF98D107B9e9D6dBDFd53d1C5C1B39e3E762f9903';
const SHOT = arg('shots', require('os').tmpdir());
let pass = 0; const issues = [];
const check = (what, ok, got) => { if (ok) { pass++; console.log(`  ✓ ${what}`); } else { issues.push(what); console.log(`  ✗ ${what} — ${JSON.stringify(got ?? '').slice(0, 360)}`); } };
const flat = async (page, sel = 'main') => (await page.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ');
(async () => {
  const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { const d = document.querySelector('[data-testid="demo-people-fold"]'); if (d && !d.open) d.open = true; });
  const b = page.locator('[data-testid^="connect-as-"]').filter({ hasText: /naomi/i }).first(); await b.waitFor({ timeout: 90000 }); await b.click();
  await page.waitForTimeout(7000);
  const idle = async (ms = 150000) => { const t0 = Date.now(); let quiet = 0; while (Date.now() - t0 < ms && quiet < 4) { const on = await page.locator('[data-testid="loading-bar"].on').count(); quiet = on ? 0 : quiet + 1; await page.waitForTimeout(500); } };
  const until = async (re, ms = 120000, sel = 'main') => { const t0 = Date.now(); let t = ''; await page.waitForTimeout(800); await idle(ms); while (Date.now() - t0 < ms) { t = await flat(page, sel); if (re.test(t)) return t; await page.waitForTimeout(2000); await idle(20000); } return t; };

  console.log('the team\'s Members screen');
  await page.goto(`${SITE}/w/${WS}/t/${WELD}/members`, { waitUntil: 'domcontentloaded' });
  const members = await until(/Naomi[\s\S]*Carla|Carla[\s\S]*Naomi/, 150000);
  await page.screenshot({ path: `${SHOT}/field-roles-members.png` }).catch(() => {});
  check('Naomi is shown as the Team lead', /Naomi[^|]*?Team lead/i.test(members), members.slice(0, 500));
  check('Yusuf is shown as a Field worker', /Yusuf[^|]*?Field worker/i.test(members), members.slice(0, 500));
  check('Carla is shown as the Coach', /Carla[^|]*?Coach/i.test(members), members.slice(0, 500));
  check('the access word is still there, said as access', /access/i.test(members), members.slice(0, 300));

  // The Settings pane's roster is editable by whoever may manage teams in the WORKSPACE (the app's own rule): Naomi
  // leads her team and is a member of the workspace, so she reads it there. Nathan custodies the workspace and the
  // Boulder–Longmont team, so he gets the pickers.
  console.log('Settings → Teams → a roster, as somebody who manages teams (Nathan, on Boulder–Longmont)');
  const ctx2 = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const p2 = await ctx2.newPage(); p2.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await p2.goto(SITE, { waitUntil: 'domcontentloaded' });
  await p2.evaluate(() => { const d = document.querySelector('[data-testid="demo-people-fold"]'); if (d && !d.open) d.open = true; });
  const nb = p2.locator('[data-testid="connect-nathan"]').first(); await nb.waitFor({ timeout: 90000 }); await nb.click();
  await p2.waitForTimeout(7000);
  const idle2 = async (ms = 150000) => { const t0 = Date.now(); let quiet = 0; while (Date.now() - t0 < ms && quiet < 4) { const on = await p2.locator('[data-testid="loading-bar"].on').count(); quiet = on ? 0 : quiet + 1; await p2.waitForTimeout(500); } };
  await p2.goto(`${SITE}/w/${WS}/t/${BOULDER}/settings/teams`, { waitUntil: 'domcontentloaded' });
  await idle2();
  await p2.getByText(/Boulder.Longmont Team/).first().waitFor({ timeout: 120000 }).catch(() => {});
  await p2.evaluate(() => {
    for (const btn of [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Manage')) {
      let row = btn.parentElement;
      while (row && !/Team \(game\)/.test(row.textContent)) row = row.parentElement;
      if (row && /Boulder.Longmont/.test(row.textContent) && (row.textContent.match(/Team \(game\)/g) || []).length === 1) { btn.click(); return; }
    }
  });
  await idle2();
  const table = p2.locator('[data-testid="team-roster-table"]').first();
  await table.waitFor({ timeout: 90000 }).catch(() => {});
  await p2.screenshot({ path: `${SHOT}/field-roles-settings.png` }).catch(() => {});
  if (await table.count()) {
    const pickers = p2.locator('[data-testid^="team-member-org-role-0x"]');
    // The pane lists ACTIVE rows; a member whose join the Home has not recorded yet is not among them.
    const rows = await table.locator('tbody tr').count();
    check('each active roster row has a role picker for whoever manages teams', rows > 0 && await pickers.count() === rows, { rows, pickers: await pickers.count() });
    const values = await pickers.evaluateAll((els) => els.map((e) => e.value));
    check('the pickers show the roles the records hold (the founder leads)', values.includes('team-lead') && values.every((v) => ['team-lead', 'field-worker', 'coach'].includes(v)), values);
    const options = await pickers.first().locator('option').allInnerTexts();
    check('a team offers the roles of a team, and not the organization\'s', ['Field worker', 'Team lead', 'Coach'].every((o) => options.includes(o)) && !options.includes('Coordinator'), options);
    check('the add-a-member form offers a role too', await p2.locator('[data-testid="team-member-org-role"]').count() > 0, 0);
  } else {
    check('the Teams pane shows this team\'s roster', false, (await flat(p2)).slice(0, 400));
  }
  // The workspace's own invite form: what they will do, beside the access they get.
  await p2.goto(`${SITE}/w/${WS}/settings/members`, { waitUntil: 'domcontentloaded' });
  await idle2();
  const inviteRole = p2.locator('[data-testid="settings-invite-org-role"]');
  await inviteRole.first().waitFor({ timeout: 60000 }).catch(() => {});
  if (await inviteRole.count()) {
    const opts = await inviteRole.first().locator('option').allInnerTexts();
    check('the workspace invite offers the organization\'s roles', ['Coordinator', 'Partner liaison', 'Field worker', 'Coach'].every((o) => opts.includes(o)) && !opts.includes('Team lead'), opts);
    await inviteRole.first().selectOption('coordinator');
    const said = await flat(p2);
    check('choosing a role says what it is, and that it grants nothing by itself', /Keeps the picture across the teams/.test(said) && /skill pack/.test(said), said.match(/Keeps the picture[^.]*\.[^.]*\./)?.[0] ?? said.slice(0, 200));
    await p2.screenshot({ path: `${SHOT}/field-roles-invite.png` }).catch(() => {});
  } else {
    check('the workspace invite form offers a role', false, (await flat(p2)).slice(0, 300));
  }

  check('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log(issues.length ? `\n${pass} passed, ${issues.length} FAILED:\n- ${issues.join('\n- ')}` : `\nall ${pass} checks passed`);
  process.exit(issues.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
