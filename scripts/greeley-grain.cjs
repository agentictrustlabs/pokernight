// THE MECHANIC THE FIRST WALK DID NOT TEST: the grain ceiling, the leak, and the room you must be in to speak finely.
const { chromium } = require('/home/barb/node_modules/playwright');
const SITE = 'https://gamenight.faithnet.io', API = 'https://games.faithnet.io';
let pass = 0; const issues = [];
const check = (w, ok, got) => { if (ok) { pass++; console.log(`  ✓ ${w}`); } else { issues.push(w); console.log(`  ✗ ${w} — got ${JSON.stringify(got).slice(0, 240)}`); } };
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(`${SITE}/#/signin`, { waitUntil: 'networkidle' });
    await page.locator('.signin-demo summary').click();
    await page.waitForSelector('.persona', { timeout: 60_000 });
    const names = await page.locator('.persona-name').allInnerTexts();
    await page.locator('.persona').nth(Math.max(0, names.findIndex((n) => /alice/i.test(n)))).click();
    await page.waitForSelector('.room', { timeout: 90_000 });

    // The HOUSEHOLD NETWORK holds the finest grain in the county — the right part to test the ceiling with.
    const out = await page.evaluate(async (api) => {
      const tok = (() => { for (const k of Object.keys(localStorage)) { try { const v = JSON.parse(localStorage.getItem(k)); if (v && v.token) return v.token; } catch {} } return null; })();
      const H = { 'content-type': 'application/json', authorization: `Bearer ${tok}` };
      const r = await (await fetch(`${api}/commissions/solo`, { method: 'POST', headers: H, body: JSON.stringify({ role: 'household', restart: true, pace: 'short' }) })).json();
      return { id: r.staging.stagingId, tok };
    }, API);
    console.log(`\nstaging ${out.id} — you are the household network`);
    await page.goto(`${SITE}/#/gc/${out.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.gc-board', { timeout: 60_000 });
    await page.waitForTimeout(2500);

    console.log('\n1 · your vault holds household grain');
    const you = (await page.locator('.mystery-you, .gc-you').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
    check('you are Abdi Mberwa', /Abdi Mberwa/.test(you), you.slice(0, 120));
    check('your vault names household grain', /household/i.test(you), you.slice(0, 400));
    check('the vault says Fort Lupton — yours to know', /Fort Lupton/.test(you), you.slice(0, 500));

    console.log('\n2 · the lunch is county grain, so the fine projection is not offered there');
    const room = (await page.locator('.mystery-room').innerText().catch(() => '')).replace(/\s+/g, ' ');
    check('you are in the Thursday Lunch at county grain', /thursday lunch/i.test(room) && /county/i.test(room), room.slice(0, 200));
    // ACTS TRAVEL OVER THE SOCKET, and only over it — there is no HTTP act route, and a probe that invents one
    // gets `404 not found` and, if it is careless about what counts as success, reports green having tested
    // nothing. This opens the page's own socket, joins as the client does, and keeps every frame.
    await page.evaluate(async ({ id, tok }) => {
      const base = location.origin.replace('gamenight', 'games').replace('https://', 'wss://');
      const ws = new WebSocket(`${base}/commissions/${id}/ws?token=${encodeURIComponent(tok)}`);
      window.__frames = [];
      ws.addEventListener('message', (e) => { try { window.__frames.push(JSON.parse(e.data)); } catch { /* ignore */ } });
      await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); setTimeout(rej, 15000); });
      ws.send(JSON.stringify({ type: 'join' }));
      window.__ws = ws;
      await new Promise((r) => setTimeout(r, 1200));
    }, { id: out.id, tok: out.tok });

    /** Send one verb and return the frames it produced — an `error:<code>` or the new view. */
    const act = async (action) => page.evaluate(async (action) => {
      const before = window.__frames.length;
      window.__ws.send(JSON.stringify({ type: 'act', action }));
      await new Promise((r) => setTimeout(r, 2000));
      const got = window.__frames.slice(before);
      // THE REFUSAL IS THE CODE, not the frame type: every refusal is `{type:'error', code:'finer-than-held'}`,
      // and a probe that reads the type learns only that something went wrong.
      const err = got.find((f) => f.type === 'error');
      return { types: got.map((f) => f.type), error: err ? (err.code ?? 'error') : null, message: err?.message ?? null, frames: got.map((f) => JSON.stringify(f).slice(0, 160)) };
    }, action);

    // ORDER MATTERS FOR A PROBE: the SAFE slip first, on a transcript that has never held the fine sentence,
    // so "no town was named" means something; then the leak, so "the town is now in the room" means something too.
    console.log('\n2b · you may coarsen, never refine');
    const refine = await act({ type: 'testify', people: 'somali-bantus', evidence: 'h1', grain: 'person' });
    check('a grain finer than you hold is refused by name', refine.error === 'finer-than-held', refine);
    check('and the refusal is in the game’s own words', /cannot say it finer than you hold it/.test(refine.message ?? ''), refine.message);

    console.log('\n3 · the county-grain slip: what the room may safely hear');
    const ok = await act({ type: 'testify', people: 'somali-bantus', evidence: 'h1', grain: 'county' });
    await page.waitForTimeout(1500);
    const t = (await page.locator('.mystery-transcript').innerText()).replace(/\s+/g, ' ');
    check('the county-grain slip lands', ok.error === null, ok);
    check('the room hears the county sentence', /Somali Bantu church in Weld County/i.test(t), t.slice(-240));
    check('and it names no town', !/Fort Lupton/.test(t), t.match(/[^.]*Fort Lupton[^.]*/)?.[0]);

    console.log('\n4 · the same item at household grain, in a county room, is a LEAK');
    // Not a refusal: the engine records it and lets it through on purpose — "recorded, never adjudicated in
    // the room" — so there is no error frame. What is observable is the damage.
    const fine = await act({ type: 'testify', people: 'somali-bantus', evidence: 'h1', grain: 'household' });
    await page.waitForTimeout(1500);
    const leaked = (await page.locator('.mystery-transcript').innerText()).replace(/\s+/g, ' ');
    check('a household-grain slip is not refused — it leaks', fine.error === null, fine);
    check('and the town is now in a county-grain room', /Fort Lupton/.test(leaked), leaked.slice(-240));

    console.log('\n5 · the living room is where household grain may be said');
    const doors = await page.locator('.mystery-room button').allInnerTexts().catch(() => []);
    check('a door leads to the living room', doors.some((d) => /Living Room/i.test(d)), doors.join(' | '));
    const moved = await act({ type: 'move', room: 'living-room' });
    await page.waitForTimeout(2500);
    await page.waitForTimeout(1500);
    const room2 = (await page.locator('.mystery-room').innerText().catch(() => '')).replace(/\s+/g, ' ');
    check('you can walk into the living room', moved.error === null && /living room/i.test(room2), { moved, room2: room2.slice(0, 160) });
    check('its rule is household grain', /household grain/i.test(room2), room2.slice(0, 200));
    const fine2 = await act({ type: 'testify', people: 'somali-bantus', evidence: 'h1', grain: 'household' });
    check('the household-grain slip is allowed HERE', fine2.error === null, fine2);

    check('no page errors', errors.length === 0, errors.slice(0, 2));
  } catch (e) { check('the walk completed', false, e.message); }
  finally { await browser.close(); }
  console.log(`\n${pass} passed, ${issues.length} to fix`);
  if (issues.length) console.log('ISSUES:\n  - ' + issues.join('\n  - '));
})();
