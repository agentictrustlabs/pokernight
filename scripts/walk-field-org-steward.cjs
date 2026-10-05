/**
 * AN ORGANIZATION'S STEWARD READS WHAT ITS TEAMS HOLD (Home spec 428) — field.faithnet.io as Nathan, who stewards
 * the game realm's organization and is on NONE of the three teams this looks at. Read-only.
 *
 *   node scripts/walk-field-org-steward.cjs [--team 0x…] [--shots <dir>]
 *
 * A team keeps its circles' detail in its own vault. Nathan holds nothing from a team he is not on; what he holds is
 * the content-read grant each team signed to its ORGANIZATION, which the Home hands to that organization's stewards
 * (`via:'governed'` on his roster). The field gateway presents it to the team's vault. So:
 *   - the team's circle shows its lifecycle, its people and its count — not "detail held in the team's vault";
 *   - opening it says it is read from the team's records, and offers no edit;
 *   - the gateway lists the team's records for him read-only and keeps its rosters back;
 *   - and somebody who is neither on the team nor a steward of its organization is still refused, with the reason;
 *   - the team's DISCUSSIONS open for him too (428 §6.2: the team's board admits the same reader) — its open
 *     conversations, with no composer, no "new" and no reactions, and a post he sends anyway is refused;
 *   - Attention says it is the team's stewards', instead of a refusal — and the page asks for nothing it will be refused.
 * NATHAN IS `connect-nathan`: a filter on the word "nathan" picks tomas-nathan.me, a character he custodies.
 */
const { chromium } = require('playwright');
const argv = process.argv.slice(2); const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const SITE = 'https://field.faithnet.io'; const HOME = 'https://www.faithnet.me'; const GW = 'https://field-a2a.faithnet.io';
const WS = '0xF28BE6eF1b4EdB1313bcF89dd304a426F1537bB6'; const TEAM = arg('team', '0x7769E189F349301bdC2D6520A4026af34a7FB91f');
const SHOT = arg('shots', require('os').tmpdir());
let pass = 0; const issues = [];
const check = (what, ok, got) => { if (ok) { pass++; console.log(`  ✓ ${what}`); } else { issues.push(what); console.log(`  ✗ ${what} — ${JSON.stringify(got ?? null).slice(0, 320)}`); } };
const ask = async (handle, skill, meta = {}) => {
  const si = await (await fetch(`${HOME}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: 'field-app', handle }) })).json();
  const r = await fetch(`${GW}/a2a`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${si.id_token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 'walk', method: 'message/send', params: { message: { role: 'user', parts: [{ kind: 'text', text: skill }], metadata: { skill, org: TEAM, team: TEAM, workspace: WS, ...meta } } } }) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, result: j.result ?? null, refusal: j.error?.data ?? null };
};
const list = async (handle, kind) => {
  const si = await (await fetch(`${HOME}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: 'field-app', handle }) })).json();
  const r = await fetch(`${GW}/a2a`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${si.id_token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 'walk', method: 'message/send', params: { message: { role: 'user', parts: [{ kind: 'text', text: `read ${kind} records` }], metadata: { skill: 'field.records-list', org: TEAM, recordKind: kind } } } }) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, result: j.result ?? null, refusal: j.error?.data ?? null };
};
(async () => {
  console.log('\n1 · the gateway, asked directly');
  const circles = await list('nathan', 'formation-community');
  check('Nathan lists the team’s circles, read-only, through the team→organization grant', circles.status === 200 && circles.result?.readOnly === true && circles.result?.readVia === 'governed' && circles.result.records.length > 0, circles.refusal ?? circles.result);
  const roster = await list('nathan', 'team-membership');
  check('the team’s roster is kept back from him (content, never membership)', roster.status === 200 && roster.result?.records.length === 0 && (roster.result?.keptBack ?? 0) > 0, roster.refusal ?? roster.result);
  const outsider = await list('bob', 'formation-community');
  check('somebody neither on the team nor a steward of its organization is refused, and told why', outsider.status === 403 && outsider.refusal?.notSteward === true && typeof outsider.refusal?.reader === 'string', outsider.refusal ?? outsider.result);

  const convs = await ask('nathan', 'field.team-conversations');
  const open = convs.result?.conversations ?? [];
  check('Nathan lists the team’s conversations, read-only, and every one of them is an open one', convs.status === 200 && convs.result?.readOnly === true && convs.result?.steward === false && open.length > 0 && open.every((x) => x.participationPolicy === 'open'), convs.refusal ?? convs.result);
  const one = open[0] ? await ask('nathan', 'field.team-conversation-read', { channelId: open[0].channelId }) : { status: 0 };
  check('and reads one, with what the team said in it', one.status === 200 && one.result?.readOnly === true && one.result.messages.length > 0 && one.result.messages.some((m) => (m.body ?? '').length > 0), one.refusal ?? { status: one.status, n: one.result?.messages?.length });
  const post = open[0] ? await ask('nathan', 'field.team-conversation-post', { channelId: open[0].channelId, body: 'walk: a reader must not be able to post this' }) : { status: 0 };
  check('a post he sends anyway is refused', post.status === 403 && post.refusal?.readOnly === true, post.refusal ?? post.result);
  const made = await ask('nathan', 'field.team-conversation-create', { title: 'walk: a reader must not open this' });
  check('and so is opening a conversation — by the team’s own board, not only by the gateway', made.status === 403 && /join this community first/.test(made.refusal?.error ?? ''), made.refusal ?? made.result);
  const stranger = await ask('bob', 'field.team-conversations');
  check('somebody neither on the team nor a steward of its organization reads no conversation', stranger.status === 403, stranger.refusal ?? stranger.result);

  console.log('\n2 · the board, as Nathan');
  const browser = await chromium.launch({ headless: !argv.includes('--headed') });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  const refused = []; page.on('response', async (r) => { if (r.status() !== 403 || !/\/a2a$/.test(r.url())) return; let md = {}; try { md = JSON.parse(r.request().postData() ?? '{}').params?.message?.metadata ?? {}; } catch {} refused.push(`${md.skill} ${md.recordKind ?? ''} ${String(md.org ?? '').slice(0, 10)}`.trim()); });
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="connect-nathan"]', { timeout: 90000, state: 'attached' });
  await page.evaluate(() => { const d = document.querySelector('[data-testid="demo-people-fold"]'); if (d && !d.open) d.open = true; });
  await page.locator('[data-testid="connect-nathan"]').first().click();
  await page.waitForTimeout(8000);
  const idle = async (ms = 150000) => { const t0 = Date.now(); let quiet = 0; while (Date.now() - t0 < ms && quiet < 4) { const on = await page.locator('[data-testid="loading-bar"].on').count(); quiet = on ? 0 : quiet + 1; await page.waitForTimeout(500); } };
  const flat = async (sel = 'main') => (await page.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ');
  const until = async (re, ms = 120000) => { const t0 = Date.now(); let t = ''; await page.waitForTimeout(800); await idle(ms); while (Date.now() - t0 < ms) { t = await flat(); if (re.test(t)) return t; await page.waitForTimeout(2000); await idle(20000); } return t; };

  await page.goto(`${SITE}/w/${WS}/t/${TEAM}/circles`, { waitUntil: 'domcontentloaded' });
  let t = await until(/\d+ participants|detail held in the team|not readable with your grant/);
  check('the team’s circle is shown with its lifecycle, its people and its count', /\d+ circles?/.test(t) && /(Active|Forming|Proposed)/.test(t) && /\d+ participants/.test(t), t.slice(0, 400));
  check('and not as a pointer to a vault he cannot read', !/detail held in the team/.test(t) && !/not readable with your grant/.test(t), t.slice(0, 400));
  await page.screenshot({ path: `${SHOT}/field-org-steward-circles.png`, fullPage: true }).catch(() => {});
  const row = page.locator('button', { hasText: /participants/ }).first();
  await row.click().catch(() => {}); await page.waitForTimeout(1500);
  const fly = (await page.getByTestId('bodies-flyout').innerText().catch(() => '')).replace(/\s+/g, ' ');
  check('opening it says it is read from the team’s records', (await page.getByTestId('bodies-flyout-readonly').count()) === 1, fly.slice(0, 300));
  check('and offers no edit', (await page.getByTestId('bodies-flyout-manage').count()) === 0, fly.slice(0, 300));
  await page.screenshot({ path: `${SHOT}/field-org-steward-flyout.png`, fullPage: true }).catch(() => {});
  check('the board was refused none of the team’s records', !refused.some((x) => /records-list (formation|ekklesia|activity|geo)/.test(x)), refused);

  console.log('\n3 · Discussions and Attention, as Nathan');
  refused.length = 0;
  await page.goto(`${SITE}/w/${WS}/t/${TEAM}/discussion`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="team-discussion"], [data-testid="team-discussion-trouble"], [data-testid="team-discussion-not-on-team"]', { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(1500); await idle();
  t = await flat();
  check('Discussions opens on the team’s conversations', (await page.getByTestId('team-discussion').count()) === 1 && (await page.locator('[data-testid^="conv-row-"]').count()) > 0, t.slice(0, 300));
  check('and says he is reading them through the organization', (await page.getByTestId('conv-readonly').count()) === 1, t.slice(0, 300));
  await page.waitForSelector('[data-testid="conv-thread"]', { timeout: 60000 }).catch(() => {});
  const thread = (await page.getByTestId('conv-thread').innerText().catch(() => '')).replace(/\s+/g, ' ');
  check('the conversation is there to read', thread.length > 80, thread.slice(0, 200));
  check('with nothing to write with: no composer, no "new", no reaction button', (await page.getByTestId('conv-composer').count()) === 0 && (await page.getByTestId('conv-new').count()) === 0 && (await page.locator('[data-testid^="conv-react-"]').count()) === 0 && (await page.getByTestId('conv-composer-readonly').count()) === 1, { composer: await page.getByTestId('conv-composer').count(), neu: await page.getByTestId('conv-new').count() });
  await page.screenshot({ path: `${SHOT}/field-org-steward-discussion.png`, fullPage: true }).catch(() => {});
  await page.goto(`${SITE}/w/${WS}/t/${TEAM}/today`, { waitUntil: 'domcontentloaded' });
  t = await until(/Nothing is waiting on you here|could not be computed/);
  check('Attention says it is the stewards’, not that it failed', /Nothing is waiting on you here/.test(t) && !/could not be computed/.test(t), t.slice(0, 300));
  check('and none of these pages asked for something it was refused', refused.length === 0, refused);
  check('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log(`\n${pass} checks passed${issues.length ? `, ${issues.length} issues:\n  - ${issues.join('\n  - ')}` : ''}`);
  process.exit(issues.length ? 1 : 0);
})().catch((e) => { console.error('threw', String(e).slice(0, 500)); process.exit(1); });
