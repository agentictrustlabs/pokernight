/**
 * ASK AT EVERY LEVEL, AND A CHANGE WALKED THROUGH TO A SAVE — on the live field app, as Naomi (a game character who
 * stewards the Weld team), signed in from the sign-in page's "come in as a character".
 *
 *   node scripts/walk-field-ask.cjs [--shots <dir>]
 *
 * Opens the Ask panel and checks its About picker offers every level (the workspace, a team, a People Community, a
 * circle or church, a people group, a person, Me); asks one question at each and checks it is answered from that
 * level's records; and makes three changes by text — a circle's numbers (set to what they already are), a work item
 * added then dropped, an observation recorded with NOTHING said so the form has to ask for each piece in turn.
 * IT WRITES: every run leaves one dropped work item and one observation ("Ask walk check: …") in the Weld team's
 * vault of the GAME workspace. Each question is one turn of the team's agent (a model call at the Home).
 */
const { chromium } = require('playwright');
const SITE = 'https://field.faithnet.io'; const WS = '0xF28BE6eF1b4EdB1313bcF89dd304a426F1537bB6'; const WELD = '0x7769E189F349301bdC2D6520A4026af34a7FB91f';
const SHOT = (() => { const i = process.argv.indexOf('--shots'); return i > 0 ? process.argv[i + 1] : require('os').tmpdir(); })(); let pass = 0; const issues = [];
const check = (what, ok, got) => { if (ok) { pass++; console.log(`  ✓ ${what}`); } else { issues.push(what); console.log(`  ✗ ${what} — ${JSON.stringify(got).slice(0, 300)}`); } };
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { const d = document.querySelector('[data-testid="demo-people-fold"]'); if (d && !d.open) d.open = true; });
  const b = page.locator(`[data-testid^="connect-as-"]`).filter({ hasText: /naomi/i }).first(); await b.waitFor({ timeout: 60000 }); await b.click();
  await page.waitForTimeout(7000);
  await page.goto(`${SITE}/w/${WS}/t/${WELD}/work`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="ask-toggle"]', { timeout: 120000 });
  await page.waitForTimeout(8000);
  await page.getByTestId('ask-toggle').click();
  const panel = page.getByTestId('ask-panel');
  await panel.waitFor({ timeout: 30000 });
  const about = panel.getByTestId('ask-about');
  await page.waitForFunction(() => !document.querySelector('[data-testid="ask-about-loading"]') && document.querySelectorAll('[data-testid="ask-about"] option').length > 12, null, { timeout: 120000 });
  const options = await about.locator('option').evaluateAll((els) => els.map((e) => [e.value.split(':')[0], e.textContent]));
  const kinds = [...new Set(options.map((o) => o[0]))];
  console.log('  about levels:', kinds.join(' '), `(${options.length} choices)`);
  for (const k of ['workspace', 'team', 'community', 'body', 'identity', 'person', 'me']) check(`the panel offers the ${k} level`, kinds.includes(k), kinds);
  check('it opens on the team you are working in', (await about.inputValue()).startsWith('team:'), await about.inputValue());

  const ask = async (text, waitUpdate) => {
    const before = await panel.getByTestId('ask-answer').count();
    await panel.getByTestId('ask-input').fill(text);
    await panel.getByTestId('ask-send').click();
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="ask-panel"] [data-testid="ask-answer"]').length > n || !!document.querySelector('[data-testid="ask-panel"] [data-testid="ask-error"]'), before, { timeout: 180000 });
    const err = await panel.getByTestId('ask-error').innerText().catch(() => '');
    if (err) return { err };
    const answer = panel.getByTestId('ask-answer').last();
    if (waitUpdate) await answer.locator('[data-testid="ask-update"], [data-testid="ask-update-saved"]').first().waitFor({ timeout: 60000 }).catch(() => {});
    return { answer, text: (await answer.innerText()).replace(/\s+/g, ' ') };
  };
  const pick = async (prefix, re) => {
    const value = await about.locator('option').evaluateAll((els, [p, src]) => { const r = new RegExp(src, 'i'); const o = els.find((e) => e.value.startsWith(p) && r.test(e.textContent || '')); return o ? o.value : ''; }, [prefix, re.source]);
    if (!value) return false;
    await about.selectOption(value); await page.waitForTimeout(600); return true;
  };

  // 1 · a circle: a question, then a change walked through and saved.
  check('the Windsor circle can be chosen', await pick('body:', /Windsor/), options.filter((o) => o[0] === 'body'));
  let r = await ask('How many believers and baptised does this circle have?');
  check('the circle answers with its recorded numbers', !r.err && /3 believers/i.test(r.text) && /3 baptis/i.test(r.text), r.err || r.text);
  r = await ask('Update the numbers: this circle has 3 believers and 3 baptised.', true);
  const card = r.answer ? r.answer.getByTestId('ask-update').first() : null;
  check('a change comes back as a draft, not as done', !!card && (await card.count()) === 1 && /not saved yet/i.test(await card.innerText()), r.err || r.text);
  if (card && (await card.count())) {
    console.log('    card:', (await card.innerText()).replace(/\s+/g, ' ').slice(0, 260));
    check('the draft is the circle-numbers form, on the right record', (await card.getAttribute('data-update-kind')) === 'body-numbers' && /Changing: S'gaw Karen circle/.test(await card.innerText()), await card.innerText());
    const save = card.getByTestId('ask-update-save');
    check('nothing is missing, so Save is offered', await save.isEnabled(), await save.innerText());
    await save.click();
    const saved = r.answer.getByTestId('ask-update-saved');
    const ok = await saved.waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
    check('the person saves it and it is saved', ok, ok ? '' : (await r.answer.innerText()).slice(-300));
    if (ok) console.log('    ', (await saved.innerText()).replace(/\s+/g, ' '));
  }
  await page.screenshot({ path: `${SHOT}/ask-1-circle.png` });

  // 2 · the team: add a work item — the form asks for what the words did not say.
  check('the team can be chosen', await pick('team:', /Weld/), '');
  r = await ask('Add a work item: visit the Karen elders in Windsor.', true);
  const wi = r.answer ? r.answer.getByTestId('ask-update').first() : null;
  check('adding a work item comes back as its form', !!wi && (await wi.count()) === 1 && (await wi.getAttribute('data-update-kind')) === 'work-item-new', r.err || r.text);
  if (wi && (await wi.count())) {
    // Answer whatever the words did not carry — the form decides, so this walks until nothing is missing.
    for (let i = 0; i < 4 && (await wi.getByTestId('ask-update-step').count()); i++) {
      const step = wi.getByTestId('ask-update-step'); const asked = (await step.innerText()).replace(/\s+/g, ' '); console.log('    step:', asked);
      const a = step.getByTestId('ask-update-answer');
      if ((await a.evaluate((e) => e.tagName)) === 'SELECT') await a.selectOption('next'); else { await a.fill('Visit the Karen elders in Windsor'); await wi.getByTestId('ask-update-next').click(); }
      await page.waitForTimeout(400);
    }
    check('once answered, nothing is missing', await wi.getByTestId('ask-update-save').isEnabled(), await wi.innerText());
    await wi.getByTestId('ask-update-save').click();
    const ok = await r.answer.getByTestId('ask-update-saved').waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
    check('the work item is saved', ok, ok ? '' : (await r.answer.innerText()).slice(-300));
  }
  await page.screenshot({ path: `${SHOT}/ask-2-team.png` });
  r = await ask('The work item to visit the Karen elders in Windsor is no longer needed — drop it.', true);
  const mv = r.answer ? r.answer.getByTestId('ask-update').first() : null;
  if (mv && (await mv.count())) {
    console.log('    move:', (await mv.innerText()).replace(/\s+/g, ' ').slice(0, 300));
    check('moving it names the item just added', (await mv.getAttribute('data-update-kind')) === 'work-item-status' && /visit the Karen elders/i.test(await mv.innerText()), await mv.innerText());
    if (await mv.getByTestId('ask-update-step').count()) { const sel = mv.getByTestId('ask-update-answer'); if (await sel.count()) await sel.selectOption('abandoned').catch(() => {}); }
    if (await mv.getByTestId('ask-update-save').isEnabled()) { await mv.getByTestId('ask-update-save').click(); const ok = await r.answer.getByTestId('ask-update-saved').waitFor({ timeout: 60000 }).then(() => true).catch(() => false); check('and it is moved', ok, ''); }
  } else check('moving a work item comes back as its form', false, r.err || r.text);

  // 3 · a people community, a people group, a person, the workspace.
  check('a People Community can be chosen', await pick('community:', /Karen/), '');
  r = await ask('I want to record an observation about these people.', true);
  const ob = r.answer ? r.answer.getByTestId('ask-update').first() : null;
  check('asking to record an observation opens its form with nothing filled', !!ob && (await ob.count()) === 1 && (await ob.getAttribute('data-update-kind')) === 'observation' && !(await ob.getByTestId('ask-update-save').isEnabled()), r.err || r.text);
  if (ob && (await ob.count())) {
    const asked = [];
    for (let i = 0; i < 6 && (await ob.getByTestId('ask-update-step').count()); i++) {
      const step = ob.getByTestId('ask-update-step'); asked.push((await step.innerText()).replace(/\s+/g, ' ').replace(/ Next$/, ''));
      const a = step.getByTestId('ask-update-answer'); const tag = await a.evaluate((e) => e.tagName);
      if (tag === 'SELECT') { const vals = await a.locator('option').evaluateAll((els) => els.map((e) => e.value).filter(Boolean)); await a.selectOption(vals.includes('medium') ? 'medium' : vals.includes('GospelWitness') ? 'GospelWitness' : vals[0]); }
      else { await a.fill('Ask walk check: families ask about the Thursday study.'); await ob.getByTestId('ask-update-next').click(); }
      await page.waitForTimeout(400);
    }
    console.log('    walked:', asked.join(' → '));
    check('it asks for each missing thing in turn (what, about what, how confident)', asked.length >= 3 && /What did you observe/.test(asked[0]) && asked.some((x) => /confident/i.test(x)), asked);
    check('then Save is offered', await ob.getByTestId('ask-update-save').isEnabled(), await ob.innerText());
    await ob.getByTestId('ask-update-save').click();
    const ok = await r.answer.getByTestId('ask-update-saved').waitFor({ timeout: 90000 }).then(() => true).catch(() => false);
    check('and the observation is saved', ok, ok ? '' : (await r.answer.innerText()).slice(-300));
  }
  await page.screenshot({ path: `${SHOT}/ask-2b-observation.png` });
  r = await ask('What phase are they at, and what blocks the next one?');
  check('the people answer with its phase and what blocks the next', !r.err && /Phase 4/i.test(r.text) && /(second generation|daughter|D8|send)/i.test(r.text), r.err || r.text);
  check('a people group can be chosen', await pick('identity:', /^Burmese$/), '');
  r = await ask('Which of our communities are aligned to this people group, and where are they?');
  check('the people group answers as a distribution over communities', !r.err && /Burmese — Weld/i.test(r.text), r.err || r.text);
  check('a person can be chosen', await pick('person:', /yusuf|carla|naomi/i), options.filter((o) => o[0] === 'person').slice(0, 5));
  r = await ask('What teams is this person on, and what have they recorded?');
  check('the person level answers from the rosters and records', !r.err && /Weld Corridor Team/i.test(r.text), r.err || r.text);
  check('the workspace can be chosen', await pick('workspace', /whole workspace/i), '');
  r = await ask('How many teams and circles are there?');
  check('the workspace answers about its structure', !r.err && /4 teams|four teams/i.test(r.text), r.err || r.text);
  await page.screenshot({ path: `${SHOT}/ask-3-levels.png` });

  // 4 · me.
  await about.selectOption('me');
  const mine = await page.getByTestId('ask-person-title').waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  check('“Me” is the person’s own agent', mine, '');
  if (mine) { await page.getByTestId('ask-person-back').click(); check('and there is a way back to the realm', await page.getByTestId('ask-about').waitFor({ timeout: 10000 }).then(() => true).catch(() => false), ''); }
  check('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log(`\n${pass} checks passed${issues.length ? `, ${issues.length} issues:\n  - ${issues.join('\n  - ')}` : ''}`);
  process.exit(issues.length ? 1 : 0);
})().catch((e) => { console.error('threw', String(e).slice(0, 500)); process.exit(1); });
