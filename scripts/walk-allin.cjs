/**
 * TWO PEOPLE, ONE TABLE, ALL IN — and does the money move.
 *
 * Alice and Bob sign in through the real door as two of the Home's demo people, each reads their own
 * balance on Your money, both go to Tables and into the named table, both sit for the max buy-in, and
 * they shove at each other until somebody is felted or the hand budget runs out. Then both leave, and
 * the walk reads the balances again — on the screen AND on chain — and says what moved.
 *
 *   node scripts/walk-allin.cjs [--table "Guest night"] [--hands 3] [--headed]
 *
 * WHAT IT PROVES, AND WHAT IT CANNOT. Money moves only at a table that SETTLES (`mandate-transfer`).
 * At a play-money table the chips are the whole story and the balance is right not to move — so if
 * the named table is play money the walk SAYS SO, opens a Sheqel table of its own beside it, and
 * plays that, because "did the money move" at a play-money table has no answer worth reporting.
 */

const { chromium } = require('playwright');
const { createPublicClient, http, parseAbiItem, formatUnits } = require('viem');

const SITE = process.env.SITE || 'https://gamenight.faithnet.io';
const API = process.env.API || 'https://games.faithnet.io';
const RPC = process.env.RPC || 'https://a2a.faithnet.io/rpc';
const SHQ = '0xa14E4a9447607c1233DcE34dB6Ead47C094f6141';
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const TABLE = arg('--table', 'Guest night');
const HANDS = Number(arg('--hands', '3'));
const HEADED = argv.includes('--headed');

const tidy = (s) => s.replace(/\s+/g, ' ').trim();
const step = (s) => console.log(`· ${s}`);
const checks = [];
function check(what, got, want) {
  const ok = typeof want === 'function' ? want(got) : got === want;
  checks.push({ what, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — got ${JSON.stringify(got)?.slice(0, 300)}`}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chain = createPublicClient({ transport: http(RPC) });
const erc20 = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }];
const onChain = async (addr) => formatUnits(await chain.readContract({ address: SHQ, abi: erc20, functionName: 'balanceOf', args: [addr] }), 6);

/** One person: their own browser context, their own session. */
async function person(browser, who) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${who}: ${String(e).slice(0, 200)}`));
  let treasury = null;
  page.on('response', async (r) => {
    if (r.url().endsWith('/treasury') && r.request().method() === 'GET' && r.ok()) {
      try { treasury = await r.json(); } catch { /* nothing to read */ }
    }
  });
  const p = {
    who, page, errors,
    get treasury() { return treasury; },
    async signIn() {
      await page.goto(`${SITE}/#/signin`, { waitUntil: 'networkidle' });
      const sd = page.locator('.signin-demo summary');
      if (await sd.count()) await sd.click();
      await page.waitForSelector('.persona', { timeout: 30_000 });
      await page.locator('.persona', { hasText: new RegExp(`^\\s*${who}`, 'i') }).first().click();
      await page.waitForSelector('.room', { timeout: 60_000 });
      const token = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('pokernight.session') || 'null')?.token ?? null; } catch { return null; } });
      p.token = token;
    },
    /** The balance as Your money shows it, waiting for the read to land. */
    async money() {
      const answered = page.waitForResponse((r) => r.url().endsWith('/treasury') && r.request().method() === 'GET' && r.ok(), { timeout: 60_000 });
      await page.goto(`${SITE}/#/money`, { waitUntil: 'commit' });
      await answered;
      await page.waitForSelector('.start', { timeout: 30_000 });
      await page.waitForTimeout(800);
      const text = tidy(await page.locator('.room-main').innerText());
      // "10,200.00 SHQ in bob.treasury" — or without the "in …" for an account that has no name.
      const m = /([\d,]+\.\d+) SHQ(?: in (\S+))?/.exec(text);
      return { text: m ? `${m[1]} SHQ${m[2] ? ` in ${m[2]}` : ''}` : '(no balance shown)', shown: m ? Number(m[1].replace(/,/g, '')) : null, address: treasury?.chosen ?? null };
    },
    async api(path, init = {}) {
      const r = await fetch(`${API}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${p.token}`, ...(init.headers || {}) } });
      const body = await r.json().catch(() => null);
      return { status: r.status, body };
    },
  };
  return p;
}

(async () => {
  const browser = await chromium.launch({ headless: !HEADED });
  let alice, bob;
  try {
    step('two people through the real door');
    [alice, bob] = await Promise.all([person(browser, 'alice'), person(browser, 'bob')]);
    await Promise.all([alice.signIn(), bob.signIn()]);
    check('both signed in with a session', [alice.token, bob.token], (t) => t.every((x) => typeof x === 'string' && x.length > 10));

    step('Your money, before');
    // Quick-start ran on arrival; give the seed a moment so the balance read is the settled one.
    await sleep(4000);
    const before = { alice: await alice.money(), bob: await bob.money() };
    for (const w of ['alice', 'bob']) step(`  ${w}: ${before[w].text}`);
    check('both have a chosen treasury with money in it', before, (b) => b.alice.shown > 0 && b.bob.shown > 0);
    const chainBefore = { alice: await onChain(before.alice.address), bob: await onChain(before.bob.address) };
    step(`  on chain: alice ${chainBefore.alice} · bob ${chainBefore.bob}`);

    step(`Tables → "${TABLE}"`);
    const { body: list } = await alice.api('/tables');
    const tables = Array.isArray(list) ? list : list?.tables ?? [];
    let target = tables.find((t) => t.name === TABLE) ?? null;
    check(`"${TABLE}" is listed`, target?.name ?? null, TABLE);
    if (target) step(`  it settles: ${target.settlement} (game ${target.game}, ${target.seated}/${target.config?.seats} seated)`);

    if (target && target.settlement === 'play-money') {
      check(`"${TABLE}" is a PLAY-MONEY table, so its chips cannot move anybody's Sheqels — that is by design, not a fault`, true, true);
      step('opening a Sheqel table beside it, so the question has an answer');
      target = null;
    }
    if (!target) {
      // Alice opens it the way a person does: the form, settlement set to Sheqels.
      await alice.page.goto(`${SITE}/#/tables/new`, { waitUntil: 'commit' });
      await alice.page.waitForSelector('form.table-new', { timeout: 30_000 });
      await alice.page.locator('form.table-new input[type=text]').first().fill(`${TABLE} · SHQ`);
      await alice.page.locator('form.table-new select').last().selectOption('mandate-transfer');
      const created = alice.page.waitForResponse((r) => /\/tables$/.test(r.url()) && r.request().method() === 'POST', { timeout: 30_000 });
      await alice.page.locator('form.table-new button[type=submit]').click();
      const res = await created;
      const made = await res.json().catch(() => null);
      check('Alice opened a table that settles in Sheqels', made?.settlement ?? `${res.status()}`, 'mandate-transfer');
      target = made;
    }
    if (!target?.tableId) throw new Error('no table to play at');
    const url = `${SITE}/#/t/${encodeURIComponent(target.tableId)}`;
    step(`  playing at ${target.name} (${target.tableId}) — ${target.settlement}`);

    step('both sit down for the max buy-in');
    async function sit(p) {
      await p.page.goto(url, { waitUntil: 'commit' });
      await p.page.waitForSelector('button[aria-label^="Sit at seat"]', { timeout: 60_000 });
      await p.page.locator('button[aria-label^="Sit at seat"]').first().click();
      await p.page.waitForSelector('form.picker', { timeout: 15_000 });
      const cost = tidy(await p.page.locator('form.picker').innerText());
      const block = await p.page.locator('form.picker .form-error, form.picker .hint').count();
      const err = block ? tidy(await p.page.locator('form.picker .form-error, form.picker .hint').first().innerText()) : '';
      await p.page.locator('form.picker button[type=submit]').click();
      // Seated when the picker goes away and the seat bar names a stack.
      const seated = await p.page.waitForSelector('.seat-bar-leave, button.leave-tag', { timeout: 30_000 }).then(() => true).catch(() => false);
      const refusal = seated ? '' : tidy(await p.page.locator('.toast, .form-error').first().innerText().catch(() => ''));
      return { seated, cost, err, refusal };
    }
    const sa = await sit(alice);
    step(`  alice: ${sa.cost}${sa.err ? ` [${sa.err}]` : ''}${sa.refusal ? ` refused: ${sa.refusal}` : ''}`);
    const sb = await sit(bob);
    step(`  bob: ${sb.cost}${sb.err ? ` [${sb.err}]` : ''}${sb.refusal ? ` refused: ${sb.refusal}` : ''}`);
    check('Alice is seated', sa.seated, true);
    check('Bob is seated', sb.seated, true);
    if (!sa.seated || !sb.seated) throw new Error('somebody could not sit');
    check('the picker says the buy-in in Sheqels, not only chips', sa.cost, (t) => /SHQ/.test(t));

    step(`shoving at each other, up to ${HANDS} hands`);
    // Whoever is on the clock presses All-in (which is also how you call one). Count a hand each
    // time the winner banner shows; stop early when one stack is gone.
    let hands = 0;
    let felted = false;
    const deadline = Date.now() + 4 * 60_000;
    const seen = new Set();
    while (hands < HANDS && !felted && Date.now() < deadline) {
      for (const p of [alice, bob]) {
        const btn = p.page.locator('button:has-text("All-in")').first();
        if ((await btn.count()) && (await btn.isEnabled().catch(() => false))) {
          await btn.click().catch(() => {});
          await sleep(400);
        }
        const sitIn = p.page.locator('button:has-text("Sit in")').first();
        if ((await sitIn.count()) && (await sitIn.isEnabled().catch(() => false))) await sitIn.click().catch(() => {});
      }
      const banner = alice.page.locator('.winner-banner, .winner').first();
      if (await banner.count()) {
        const key = tidy(await banner.innerText().catch(() => ''));
        if (key && !seen.has(key)) { seen.add(key); hands += 1; step(`  hand ${hands}: ${key.slice(0, 120)}`); }
      }
      const bar = tidy(await alice.page.locator('.seat-bar').innerText().catch(() => ''));
      if (/\b0 chips\b|stack 0\b|busted/i.test(bar)) felted = true;
      await sleep(1200);
    }
    check('at least one hand was played to a result', hands, (n) => n >= 1);
    const stacks = async (p) => tidy(await p.page.locator('.seat-bar').innerText().catch(() => ''));
    step(`  alice's bar: ${await stacks(alice)}`);
    step(`  bob's bar: ${await stacks(bob)}`);

    step('both leave');
    for (const p of [alice, bob]) {
      const leave = p.page.locator('.seat-bar-leave, button.leave-tag').first();
      if (await leave.count()) await leave.click();
      await sleep(1500);
    }
    // The ledger, from the room's own mouth: what each person's rows say and whether they settled.
    for (const p of [alice, bob]) {
      const { status, body } = await p.api(`/tables/${target.tableId}/settlement`);
      step(`  ${p.who}'s settlement rows (${status}): ${JSON.stringify(body).slice(0, 600)}`);
      p.rows = body;
    }

    step('waiting for the outbox to settle on chain');
    let after = null;
    for (let i = 0; i < 24; i++) {
      await sleep(5000);
      after = { alice: await onChain(before.alice.address), bob: await onChain(before.bob.address) };
      const moved = after.alice !== chainBefore.alice || after.bob !== chainBefore.bob;
      const rows = await Promise.all([alice, bob].map((p) => p.api(`/tables/${target.tableId}/settlement`).then((r) => r.body)));
      const pending = JSON.stringify(rows).includes('"pending"');
      if (moved && !pending) break;
    }
    step(`  on chain after: alice ${after.alice} · bob ${after.bob}`);
    const dA = Number(after.alice) - Number(chainBefore.alice);
    const dB = Number(after.bob) - Number(chainBefore.bob);
    step(`  Δ alice ${dA >= 0 ? '+' : ''}${dA} SHQ · Δ bob ${dB >= 0 ? '+' : ''}${dB} SHQ`);
    check('money moved on chain for at least one of them', [dA, dB], (d) => d.some((x) => x !== 0));
    check('what one lost the other won (the house keeps nothing at a two-handed table)', dA + dB, (s) => Math.abs(s) < 0.000001);

    step('Your money, after');
    const shown = { alice: await alice.money(), bob: await bob.money() };
    for (const w of ['alice', 'bob']) step(`  ${w}: ${shown[w].text}`);
    check("Alice's screen matches the chain", shown.alice.shown, (v) => v !== null && Math.abs(v - Number(after.alice)) < 0.01);
    check("Bob's screen matches the chain", shown.bob.shown, (v) => v !== null && Math.abs(v - Number(after.bob)) < 0.01);

    check('no uncaught errors in either browser', [...alice.errors, ...bob.errors], (e) => e.length === 0);
  } catch (e) {
    check('the walk finished', String(e?.message ?? e), false);
  } finally {
    const bad = checks.filter((c) => !c.ok);
    console.log(`\n${checks.length - bad.length}/${checks.length} checks passed`);
    for (const p of [alice, bob]) if (p?.errors?.length) console.log(p.errors.join('\n'));
    await browser.close();
    process.exit(bad.length === 0 ? 0 : 1);
  }
})();
