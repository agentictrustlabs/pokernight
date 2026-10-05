/**
 * AN INVITATION THAT SAYS WHAT YOU WILL DO — the field app's invite, the Home's two ceremonies, and the role on the
 * membership at the end (the estate's spec 427), walked live in a browser.
 *
 *   node scripts/walk-field-invite-role.cjs [--team] [--invitee carol] [--role coach] [--shots <dir>] [--headed]
 *
 * Nathan (the workspace's custodian) invites a demo person (Carol by default) into the workspace as a COACH from
 * Settings → Members. (Somebody who has ALREADY accepted an invitation here is shown no second join card — an existing
 * member's role is changed from the roster instead — so the invitee must be one who has not.) The field
 * app writes the roster row and opens the Home's invite ceremony in a popup with the role offer; the Home records
 * the invitation on the governing organization WITH the role. Bob then joins from the join link: the Home's join
 * ceremony records his membership, and the organization's own object stamps the role from ITS invitation.
 * Checked where the facts are: the invitation record (as the invitee claims it) and their membership as the
 * organization holds it. It leaves the invitee a coach in the game's organization — a real role on a demo person.
 */
const { chromium } = require('playwright');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const SITE = 'https://field.faithnet.io'; const HOME = 'https://www.faithnet.me'; const A2A = 'https://a2a.faithnet.io';
const WS = '0xF28BE6eF1b4EdB1313bcF89dd304a426F1537bB6'; const ORG = '0x8e32c713f44c7747d97a589522806a8e1dd810fb'; const BOULDER = '0xF98D107B9e9D6dBDFd53d1C5C1B39e3E762f9903';
const ROLE = arg('role', 'coach'); const WHO = arg('invitee', 'carol'); const Who = WHO[0].toUpperCase() + WHO.slice(1); const SHOT = arg('shots', require('os').tmpdir());
const NAMES = { coach: 'Coach', coordinator: 'Coordinator', 'partner-liaison': 'Partner liaison', 'field-worker': 'Field worker' };
let pass = 0; const issues = [];
const check = (what, ok, got) => { if (ok) { pass++; console.log(`  ✓ ${what}`); } else { issues.push(what); console.log(`  ✗ ${what} — ${JSON.stringify(got ?? '').slice(0, 400)}`); } };
const flat = async (page, sel = 'body') => (await page.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ');
const json = async (r) => r.json().catch(() => ({}));
const signin = async (handle) => json(await fetch(`${HOME}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: 'field-app', handle }) }));
const object = async (org, op, body) => json(await fetch(`${A2A}/interactions/${org}/${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

/** Drive a Home ceremony popup to its end: press what it asks to be allowed, report what it says, wait for it to close. */
async function ceremony(popup, who) {
  const said = [];
  for (let i = 0; i < 80 && !popup.isClosed(); i++) {
    await popup.waitForTimeout(1500).catch(() => {});
    if (popup.isClosed()) break;
    const body = (await popup.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const m = body.match(/(Inviting|Signing|Telling|Claiming|Joining|Adding|Finishing)[^.…]{0,90}/);
    if (m && said[said.length - 1] !== m[0]) { said.push(m[0]); console.log(`    [${who}] ${m[0]}`); }
    const fail = body.match(/(could not|was not sent|nothing was sent|No invitation was found|refused)[^.]{0,160}/i);
    if (fail && !m) { console.log(`    [${who}] THE HOME SAYS: ${fail[0]}`); said.push(`FAILED: ${fail[0]}`); break; }
    const allow = popup.locator('button', { hasText: /^(Allow|Continue|Invite|Join|Approve|Sign)\b/ });
    if (await allow.count().catch(() => 0)) { await allow.first().click().catch(() => {}); }
  }
  return said;
}
async function enter(browser, testId) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`[data-testid="${testId}"]`, { timeout: 90000, state: 'attached' });
  await page.evaluate(() => { const d = document.querySelector('[data-testid="demo-people-fold"]'); if (d && !d.open) d.open = true; });
  const b = page.locator(`[data-testid="${testId}"]`).first(); await b.waitFor({ timeout: 30000 }); await b.click();
  await page.waitForTimeout(7000);
  return { ctx, page };
}
const idle = async (page, ms = 150000) => { const t0 = Date.now(); let quiet = 0; while (Date.now() - t0 < ms && quiet < 4) { const on = await page.locator('[data-testid="loading-bar"].on').count(); quiet = on ? 0 : quiet + 1; await page.waitForTimeout(500); } };

/**
 * THE TEAM VARIANT (`--team`): Nathan adds the invitee to the Boulder–Longmont team as a coach. A team is an
 * organization and holds its own members, so the Home's invite ceremony ALSO invites into the team itself with the
 * role, and the join records the membership ON THE TEAM — beside the governing organization's, which is unchanged.
 * Checked on the team's own records, and by the new member reading the team's roster afterwards (the link the join
 * leaves must still carry the wire they read the team with).
 */
async function teamWalk() {
  const who = await signin(WHO); const sa = String(who.agent).toLowerCase();
  const before = await object(BOULDER, 'org.membership.mine', { session: who.homeSession });
  console.log(`${WHO} ${sa} — on the team before: ${before.membership ? `${before.membership.roleAssignment?.assignedRole}${before.ended ? ' (ended)' : ''}` : 'no membership record'}`);
  const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
  const errors = [];
  console.log(`Nathan adds ${Who} to the Boulder–Longmont team, naming what they will do`);
  const n = await enter(browser, 'connect-nathan'); n.page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await n.page.goto(`${SITE}/w/${WS}/t/${BOULDER}/settings/teams`, { waitUntil: 'domcontentloaded' });
  await idle(n.page);
  await n.page.getByText(/Boulder.Longmont Team/).first().waitFor({ timeout: 120000 }).catch(() => {});
  // The pane lists every team with its own "Manage": press the one in the row that names THIS team and no other.
  const pressed = await n.page.evaluate(() => {
    for (const btn of [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Manage')) {
      let row = btn.parentElement;
      while (row && !/Team \(game\)/.test(row.textContent)) row = row.parentElement;
      if (row && /Boulder.Longmont/.test(row.textContent) && (row.textContent.match(/Team \(game\)/g) || []).length === 1) { btn.click(); return true; }
    }
    return false;
  });
  check('the Boulder–Longmont team opens from the Teams pane', pressed, pressed);
  await idle(n.page);
  const pick = n.page.locator('[data-testid="team-member-pick"]');
  await pick.waitFor({ timeout: 90000 });
  const value = await pick.locator('option').evaluateAll((os, want) => (os.find((o) => o.value.toLowerCase() === want) || {}).value || '', sa);
  check(`${Who} can be picked (an active member of the workspace, not yet on the team)`, !!value, await pick.locator('option').allInnerTexts());
  if (!value) { await browser.close(); return finish(); }
  await pick.selectOption(value);
  await n.page.locator('[data-testid="team-member-org-role"]').selectOption(ROLE);
  const access = await n.page.locator('[data-testid="team-member-role"]').inputValue();
  check('choosing the role suggests the access it usually needs', access === 'member', access);
  let sentRole = null; let offered = null;
  n.page.on('request', (rq) => { if (/\/a2a$/.test(rq.url()) && rq.method() === 'POST') { try { const m = JSON.parse(rq.postData() || '{}').params?.message?.metadata; if (m?.skill === 'field.team-member-add') sentRole = m.orgRole ?? '(none)'; } catch {} } });
  n.page.on('response', async (rs) => { if (/\/a2a$/.test(rs.url()) && rs.request().method() === 'POST') { try { const m = JSON.parse(rs.request().postData() || '{}').params?.message?.metadata; if (m?.skill === 'field.team-member-add') { const body = await rs.json(); offered = body.result?.roleOffer ?? `(none: ${JSON.stringify(body.error ?? body.result ?? body).slice(0, 260)})`; } } catch {} } });
  const popupP = n.ctx.waitForEvent('page', { timeout: 90000 }).catch(() => null);
  await n.page.locator('[data-testid="team-member-add"]').click();
  const popup = await popupP;
  check('the Home\'s invite ceremony opens', !!popup, 'no popup');
  check('the app sends the role to its gateway', sentRole === ROLE, sentRole);
  check('the gateway answers with a TEAM-scoped offer of the governing organization\'s definition', offered && offered.scope === 'team' && offered.roleDefinitionId === `roledef:${ORG}:${ROLE}@1`, offered);
  const said = popup ? await ceremony(popup, 'nathan @ home') : [];
  check('the ceremony invites onto the team itself, as the role', said.some((x) => new RegExp(`Inviting them onto .* as ${NAMES[ROLE]}`).test(x)), said);
  check('the invite ceremony did not fail', !said.some((x) => x.startsWith('FAILED')), said);
  await n.page.waitForTimeout(4000); await idle(n.page);
  await n.page.screenshot({ path: `${SHOT}/field-invite-role-team-1.png` }).catch(() => {});

  const claim = await object(BOULDER, 'invite.claim', { session: who.homeSession });
  check('the TEAM\'s own invitation carries the role', claim.invite?.orgRole?.name === NAMES[ROLE] && claim.invite?.orgRole?.scope === 'team', claim.invite ? { status: claim.invite.status, orgRole: claim.invite.orgRole ?? null } : claim);

  console.log(`${Who} accepts from the bell`);
  const b = await enter(browser, `connect-${WHO}`); b.page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  // Invitations wait in Activity (the app's rail), each with its own Accept.
  await b.page.goto(`${SITE}/w/${WS}/activity`, { waitUntil: 'domcontentloaded' });
  await idle(b.page);
  const card = b.page.locator(`[data-testid="invite-${BOULDER.toLowerCase()}"]`).first();
  await card.waitFor({ timeout: 90000 }).catch(() => {});
  const cardText = await flat(b.page, `[data-testid="invite-${BOULDER.toLowerCase()}"]`);
  check(`${Who} is told what they are invited to do on the team`, new RegExp(`as ${NAMES[ROLE]}`).test(cardText), cardText.slice(0, 300) || (await flat(b.page, 'main')).slice(0, 300));
  const joinPopupP = b.ctx.waitForEvent('page', { timeout: 90000 }).catch(() => null);
  await card.getByRole('button', { name: /Accept/ }).first().click().catch(() => {});
  const joinPopup = await joinPopupP;
  check('the Home\'s join ceremony opens', !!joinPopup, 'no popup');
  const joinSaid = joinPopup ? await ceremony(joinPopup, `${WHO} @ home`) : [];
  check('the join records the membership on the team, as the role', joinSaid.some((x) => new RegExp(`Joining the team as ${NAMES[ROLE]}`).test(x)), joinSaid);
  check('the join ceremony did not fail', !joinSaid.some((x) => x.startsWith('FAILED')), joinSaid);
  await b.page.waitForTimeout(8000); await idle(b.page);
  await b.page.screenshot({ path: `${SHOT}/field-invite-role-team-2.png` }).catch(() => {});

  const mine = await object(BOULDER, 'org.membership.mine', { session: who.homeSession });
  check(`the TEAM records ${Who}'s membership with the role`, mine.membership?.roleAssignment?.assignedRole === ROLE && mine.ended === false, mine.membership?.roleAssignment ?? mine);
  check('the role is team-scoped and offers its pack', mine.offer?.scope === 'team' && (mine.offer?.skillPackRefs ?? []).some((p) => p.archetype === `role-${ROLE}`), mine.offer);
  // And the new member can READ the team — the link the join left still carries the wire they read it with.
  const read = await json(await fetch('https://field-a2a-faithnet.richardpedersen3.workers.dev/a2a', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${(await signin(WHO)).id_token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 'r', method: 'message/send', params: { message: { role: 'user', parts: [{ kind: 'text', text: 'read this team' }], metadata: { skill: 'field.team-read', team: BOULDER } } } }) }));
  const row = (read.result?.members ?? []).find((m) => String(m.personRef).toLowerCase().endsWith(sa));
  check(`${Who} reads the team's roster, and is on it as the role`, !!row && row.orgRole === ROLE, read.result ? (read.result.members ?? []).map((m) => `${m.display}:${m.orgRole ?? '-'}:${m.status}`) : read.error);
  check('no page errors', errors.length === 0, errors);
  await browser.close();
  finish();
}
function finish() {
  console.log(issues.length ? `\n${pass} passed, ${issues.length} FAILED:\n- ${issues.join('\n- ')}` : `\nall ${pass} checks passed`);
  process.exit(issues.length ? 1 : 0);
}

(async () => {
  if (process.argv.includes('--team')) return teamWalk();
  const bobId = await signin(WHO); const bob = String(bobId.agent).toLowerCase();
  const before = await object(ORG, 'org.membership.mine', { session: bobId.homeSession });
  console.log(`${WHO} ${bob} — at the organization before: ${before.membership ? `${before.membership.roleAssignment?.assignedRole}${before.ended ? ' (ended)' : ''}` : 'no membership record'}`);
  const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
  const errors = [];

  console.log(`Nathan invites ${Who}, naming what they will do`);
  const n = await enter(browser, 'connect-nathan'); n.page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await n.page.goto(`${SITE}/w/${WS}/settings/members`, { waitUntil: 'domcontentloaded' });
  await idle(n.page);
  await n.page.locator('[data-testid="settings-invite-org-role"]').first().waitFor({ timeout: 90000 });
  await n.page.locator('summary', { hasText: /Advanced: enter a Smart Agent address/ }).first().click();
  await n.page.locator('[data-testid="settings-invite-person"]').fill(bob);
  await n.page.locator('[data-testid="settings-invite-org-role"]').selectOption(ROLE);
  const line = await flat(n.page, '[data-testid="settings-invite-selected"]');
  check('the form says who is invited and as what', new RegExp(`as ${NAMES[ROLE]} \\(member access\\)`).test(line), line);
  // What the app actually asks its gateway, and what comes back — the role must be in both.
  let sentRole = null; let offered = null;
  n.page.on('request', (rq) => { if (/\/a2a$/.test(rq.url()) && rq.method() === 'POST') { try { const m = JSON.parse(rq.postData() || '{}').params?.message?.metadata; if (m?.skill === 'field.workspace-member-add') sentRole = m.orgRole ?? '(none)'; } catch {} } });
  n.page.on('response', async (rs) => { if (/\/a2a$/.test(rs.url()) && rs.request().method() === 'POST') { try { const m = JSON.parse(rs.request().postData() || '{}').params?.message?.metadata; if (m?.skill === 'field.workspace-member-add') offered = (await rs.json()).result?.roleOffer ?? '(none)'; } catch {} } });
  const popupP = n.ctx.waitForEvent('page', { timeout: 60000 }).catch(() => null);
  await n.page.locator('[data-testid="settings-invite-submit"]').click();
  const popup = await popupP;
  check('the Home\'s invite ceremony opens', !!popup, 'no popup');
  check('the app sends the role to its gateway', sentRole === ROLE, sentRole);
  check('the gateway answers with the governing organization\'s offer', offered && offered.name === NAMES[ROLE], offered);
  let inviteSaid = [];
  if (popup) {
    const url = popup.url();
    const keys = (() => { try { return [...new URL(url).searchParams.keys()]; } catch { return [url.slice(0, 80)]; } })();
    check('the ceremony carries the role offer', keys.includes('role_offer'), keys);
    inviteSaid = await ceremony(popup, 'nathan @ home');
  }
  check('the invite ceremony did not fail', !inviteSaid.some((s) => s.startsWith('FAILED')), inviteSaid);
  await n.page.waitForTimeout(4000); await idle(n.page);
  const note = await flat(n.page, 'main');
  check('the field app says the row was written and the access signed', /Roster row written and access signed/.test(note), note.match(/(roster row written[^.]*\.|access was not signed[^.]*\.)/i)?.[0] ?? note.slice(0, 200));
  await n.page.screenshot({ path: `${SHOT}/field-invite-role-1-invited.png` }).catch(() => {});

  // THE FACT: the organization's own invitation record, as the invitee claims it.
  const claim = await object(ORG, 'invite.claim', { session: bobId.homeSession });
  check(`the organization's invitation to ${Who} carries the role`, claim.invite?.orgRole?.name === NAMES[ROLE], claim.invite ? { status: claim.invite.status, orgRole: claim.invite.orgRole ?? null } : claim);
  check('the offer is the governing organization\'s definition, with its pack', claim.invite?.orgRole?.roleDefinitionId === `roledef:${ORG}:${ROLE}@1` && (claim.invite?.orgRole?.skillPackRefs ?? []).some((p) => p.archetype === `role-${ROLE}`), claim.invite?.orgRole);

  console.log(`${Who} joins from the link`);
  const b = await enter(browser, `connect-${WHO}`); b.page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await b.page.goto(`${SITE}/?join=${WS}`, { waitUntil: 'domcontentloaded' });
  await idle(b.page);
  const joinBtn = b.page.getByRole('button', { name: /Join|Accept/ }).first();
  await joinBtn.waitFor({ timeout: 90000 }).catch(() => {});
  const card = await flat(b.page, 'main');
  check(`${Who} is told what they are invited as`, new RegExp(`as ${NAMES[ROLE]}`, 'i').test(card), card.slice(0, 300));
  const joinPopupP = b.ctx.waitForEvent('page', { timeout: 60000 }).catch(() => null);
  await joinBtn.click().catch(() => {});
  const joinPopup = await joinPopupP;
  check('the Home\'s join ceremony opens', !!joinPopup, 'no popup');
  const joinSaid = joinPopup ? await ceremony(joinPopup, `${WHO} @ home`) : [];
  check('the join ceremony did not fail', !joinSaid.some((s) => s.startsWith('FAILED')), joinSaid);
  await b.page.waitForTimeout(6000); await idle(b.page);
  const after = await flat(b.page, 'body');
  check(`the field app tells ${Who} what they joined as, and where the pack is`, new RegExp(`joined as ${NAMES[ROLE]}`, 'i').test(after) && /Playbook page/.test(after), after.match(/(You joined[^.]*\.[^.]*\.|could not[^.]*\.)/)?.[0] ?? after.slice(0, 240));
  await b.page.screenshot({ path: `${SHOT}/field-invite-role-2-joined.png` }).catch(() => {});

  // THE FACT: Bob's membership as the organization records it.
  const mine = await object(ORG, 'org.membership.mine', { session: bobId.homeSession });
  check(`the organization records ${Who}'s membership with the role`, mine.membership?.roleAssignment?.assignedRole === ROLE && mine.ended === false, mine.membership?.roleAssignment ?? mine);
  check('the role says who offered it', /^0x[0-9a-f]{40}$/.test(String(mine.membership?.roleAssignment?.assignedBy ?? '')), mine.membership?.roleAssignment?.assignedBy);
  check('the offer comes back with its skill pack', (mine.offer?.skillPackRefs ?? []).some((p) => p.archetype === `role-${ROLE}`), mine.offer);

  check('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log(issues.length ? `\n${pass} passed, ${issues.length} FAILED:\n- ${issues.join('\n- ')}` : `\nall ${pass} checks passed`);
  process.exit(issues.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
