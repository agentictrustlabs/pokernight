/**
 * AN INVITATION THAT SAYS WHAT YOU WILL DO — the field app's invite, the Home's two ceremonies, and the role on the
 * membership at the end (the estate's spec 427), walked live in a browser.
 *
 *   node scripts/walk-field-invite-role.cjs [--invitee carol] [--role coach] [--shots <dir>] [--headed]
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
const WS = '0xF28BE6eF1b4EdB1313bcF89dd304a426F1537bB6'; const ORG = '0x8e32c713f44c7747d97a589522806a8e1dd810fb';
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

(async () => {
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
