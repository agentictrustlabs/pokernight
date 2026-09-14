/**
 * Play a whole game of canasta against three bots, through the real site, as a real demo person.
 *
 * NOT A UNIT TEST AND NOT A MOCK. It signs in the way a visitor does — the Home's quick-connect,
 * which mints a genuine id_token the tables Worker verifies like any other — opens a canasta table
 * from the lobby, takes a seat, fills the other three with the house agents, and plays turns until
 * the round is scored. What it proves is the only thing a unit test cannot: that the whole thing
 * hangs together end to end, on the deployment people actually use.
 *
 *   node scripts/play-canasta.cjs [--site …] [--headed] [--keep]   open a table, play it by hand
 *   node scripts/play-canasta.cjs --practice                        your own table, played at full speed
 *
 * TWO MODES, because they prove different things.
 *
 * The DEFAULT opens a table from the lobby and clicks every control itself — draw, meld, discard — so
 * it exercises the create form, the seat picker, the agent fill and the board's own buttons. What it
 * does NOT reliably do is finish a round: the bots move at `AGENT_PACE_MS` (3500 ms, chosen so a person
 * can follow them), which is about half a minute a lap, and a round is twenty to forty laps.
 *
 * `--practice` goes to the PRACTICE table instead, where two things are true that are true nowhere
 * else: it carries its own pace, and the coach starts in "play for me". Set the pace to nothing and
 * the whole table — three bots and the coach holding this seat — plays itself as fast as the engine
 * will go. That is the mode that actually scores a round, and it leaves no table behind, because a
 * practice table is derived rather than created and is in no lobby.
 *
 * It retires the table it made, so repeated runs do not fill a real lobby with dead games. That
 * needs `OPERATOR_TOKEN` in the environment; without one the table is left and the run says so.
 *
 * Playwright is a root devDependency (`pnpm exec playwright install chromium` once), required with
 * `require` rather than imported — which is why this file is `.cjs`.
 *
 * The player it drives is deliberately naive — draw, lay anything legal, discard the last card. It
 * is exercising the SCREEN, not playing well; the bots are the ones with a strategy.
 */

const PLAYWRIGHT = 'playwright';
const { chromium } = require(PLAYWRIGHT);

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const SITE = (flag('site', 'https://gamenight.faithnet.io') || '').replace(/\/+$/, '');
/** Where the card room is. The site talks to this too; the tidy-up needs to reach it directly. */
const API = (flag('api', 'https://games.faithnet.io') || '').replace(/\/+$/, '');
const HEADED = args.includes('--headed');
/** Play the person's own practice table, at full speed, with the coach holding the seat. */
const PRACTICE = args.includes('--practice');
/** Leave the table open afterwards instead of standing up. */
const KEEP = args.includes('--keep');

/** The card-room session this browser is holding, for the few things done straight against the API. */
async function sessionToken(page) {
  return page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('pokernight.session') || '{}').token || '';
    } catch {
      return '';
    }
  });
}

/** Every step prints, so a run that stalls says where. */
const step = (s) => console.log(`· ${s}`);
const tidy = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * Put the table away afterwards, so a smoke test does not leave litter in a real lobby.
 *
 * Standing the person up is not enough: the three agents stay, and a table with nobody in it but
 * bots sits in the public list forever.
 *
 * IT USES THE ORDINARY PATH, not the operator override. `DELETE /tables/:id/seat-agent/:seat` is how
 * a host removes a bot they seated, needs only their own session, and works at once. The operator
 * seat-clear is the wrong tool here and would not work anyway: it requires five minutes of silence
 * from a seat before it will touch it, which is exactly right for rescuing a stuck table and
 * useless for tidying up after yourself.
 *
 * Retiring the empty table afterwards DOES need the operator token. Without one the table is left
 * behind empty, which is a great deal better than left behind with three bots in it.
 */
async function tidyUp(page, api, tableId, seats) {
  if (!tableId) return;
  const token = await sessionToken(page);

  for (const seat of seats) {
    await fetch(`${api}/tables/${tableId}/seat-agent/${seat}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
  step(`unseated ${seats.length} agents`);

  const op = (process.env.OPERATOR_TOKEN ?? '').trim();
  if (!op) {
    step(`left the empty table "${tableId}" — set OPERATOR_TOKEN to have this script retire it too`);
    return;
  }
  const res = await fetch(`${api}/tables/${tableId}`, { method: 'DELETE', headers: { 'x-operator-token': op } }).catch(() => null);
  step(res && res.ok ? 'table retired' : 'table left in the lobby (retire refused)');
}

(async () => {
  const browser = await chromium.launch({ headless: !HEADED });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1150 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  /** The pace this table was set to before the run borrowed it, so the run can give it back. */
  let pacedBack = null;

  try {
    step(`opening ${SITE}`);
    await page.goto(`${SITE}/#/signin`, { waitUntil: 'networkidle' });

    step('signing in as one of the Home’s demo people');
    await page.locator('.signin-demo summary').click();
    await page.waitForSelector('.persona', { timeout: 30_000 });
    const who = await page.locator('.persona-name').first().innerText();
    await page.locator('.persona').first().click();
    await page.waitForSelector('.room, .identity', { timeout: 60_000 });
    await page.waitForTimeout(2000);
    step(`signed in as ${who}`);

    let tableId = '';
    let mySeat = 0;

    if (PRACTICE) {
      // ONE PRESS FROM PLAY. The practice table sits you down, fills the other three chairs and turns
      // the coach on by itself — that is the whole errand it exists to remove.
      step('taking the practice table from Play');
      await page.goto(`${SITE}/#/`, { waitUntil: 'networkidle' });
      await page.locator('.play-canasta button').click();
      await page.waitForSelector('.can-hand .can-card, .can-seated', { timeout: 90_000 });
      tableId = (page.url().split('#/t/')[1] || '').split(/[?/]/)[0];
      step(`table ${tableId}`);

      // FULL SPEED. Only a practice table may carry its own pace — one person's preference must not
      // slow a table other people are sitting at — and this is the reason that door exists.
      //
      // THE PACE IS SOMEBODY'S SETTING, so it is borrowed and given back (see the end of the run). A
      // script that leaves the table it used running at no pace has changed how the game feels for
      // whoever sits there next, which is exactly the thing the setting exists to let them choose.
      const token = await sessionToken(page);
      const before = await fetch(`${API}/tables/${tableId}`, { headers: { authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      pacedBack = { token, ms: typeof before?.paceMs === 'number' ? before.paceMs : null };
      const paced = await fetch(`${API}/tables/${tableId}/pace`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ ms: 0 }),
      }).catch(() => null);
      step(paced && paced.ok ? 'pace set to nothing — the bots answer as fast as they can' : 'could not set the pace; this will be slow');

      // Deal from the start, so the round we watch is a whole one rather than whatever was left over
      // from the last run. A reset keeps the seats and throws the scores away.
      await fetch(`${API}/tables/${tableId}/reset`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => {});
      await page.waitForTimeout(2500);
      await page.waitForSelector('.can-hand .can-card', { timeout: 60_000 });
    } else {
      // Signing in lands on PLAY, which is the front door for a person and has no create form on it.
      // Opening a table is a host's act and lives one row down, at #/tables.
      step('opening a canasta table');
      await page.goto(`${SITE}/#/tables`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.lobby-create summary', { timeout: 30_000 });
      await page.locator('.lobby-create summary').click();
      await page.locator('.lobby-create input[type=text]').first().fill(`Canasta ${new Date().toISOString().slice(11, 19)}`);
      await page.locator('.lobby-create select').first().selectOption('canasta');
      await page.waitForTimeout(300);
      await page.locator('.lobby-create button[type=submit]').click();
      await page.waitForSelector('.can-seat-picker, .can-seated', { timeout: 40_000 });
      tableId = (page.url().split('#/t/')[1] || '').split(/[?/]/)[0];
      step(`table ${tableId}`);

      if (await page.locator('.can-seat-picker').count()) {
        await page.locator('.can-seat-picker button:not([disabled])').first().click();
        await page.waitForTimeout(2500);
      }
      step('filling the other three seats with the house agents');
      await page.waitForSelector('.can-fill button', { timeout: 30_000 });
      await page.locator('.can-fill button').click();
      // The round deals itself the moment the fourth chair is taken.
      await page.waitForSelector('.can-hand .can-card', { timeout: 40_000 });
    }

    const seated = tidy(await page.locator('.can-seated').innerText());
    step(seated);
    mySeat = Number((/Seat (\d)/.exec(seated) ?? [])[1] ?? 1) - 1;
    step(`at the table: ${(await page.locator('.can-plate .cs-name').allInnerTexts()).join(', ')}`);

    const button = (name) => page.locator('.can-buttons button', { hasText: name });
    let turns = 0;
    let melded = 0;
    /**
     * WHICH ROUND THE TABLE IS ON, from the header. This is how a finished round is detected.
     *
     * Looking for the end-of-round SUMMARY on screen does not work and cost an afternoon: it is shown
     * for a moment and then the next round deals over it, so a poll every second and a half walks
     * straight past it and reports that nothing ever finished — while the table sits there on round
     * four with three scores behind it. A round number that went up is a round that ended.
     */
    const roundNow = async () => {
      const t = await page.locator('.topbar .num', { hasText: /round/ }).innerText().catch(() => '');
      return Number((/#(\d+)/.exec(t) ?? [])[1] ?? 0);
    };
    const startRound = await roundNow();

    /**
     * WHO IS PLAYING THIS SEAT. At a practice table the coach starts in "play for me", so the table is
     * complete without this script touching a control — and pressing buttons underneath it would be two
     * players fighting over one hand. So practice mode WATCHES, and only the default mode clicks.
     */
    const watching = PRACTICE;
    /**
     * HOW LONG A ROUND TAKES IS SET BY THE BOTS' PACE, not by how fast this script can click.
     *
     * `AGENT_PACE_MS` defaults to 3500 — deliberately, so a person can follow what the other three are
     * doing — and three bots plus this player is about twelve seconds a lap. A round is thirty-odd laps.
     * The budget was 240s, from when the pace was 2800 and rounds were shorter; at 3.5s a move that is
     * nine turns and a run that reports a round it never gave time to end.
     */
    const stopAt = Date.now() + (PRACTICE ? 240_000 : 600_000);

    let rounds = 0;
    while (Date.now() < stopAt && rounds === 0) {
      if (watching) {
        // The coach is playing this hand and the bots are playing theirs. Nothing to do but let it.
        await page.waitForTimeout(1500);
        rounds = Math.max(0, (await roundNow()) - startRound);
        continue;
      }
      if (await page.locator('.can-result').count()) break;
      try {
        await page.waitForSelector('.can-buttons button:not([disabled])', { timeout: 30_000 });
      } catch {
        break; // the round ended, or nobody is asking us to move
      }
      turns++;

      // Half one: take a card. The pile if it is legal and we have picked nothing, else the stock.
      if (await button('Take the pile').isEnabled().catch(() => false)) await button('Take the pile').click();
      else if (await button('Draw').isEnabled().catch(() => false)) await button('Draw').click();
      await page.waitForTimeout(700);

      // Half two: try each rank group in turn, and lay the first one the board accepts.
      const clear = async () => {
        const c = page.locator('.can-picked .link-button');
        if (await c.count()) await c.click();
      };
      const groups = await page.locator('.can-group-head:not([disabled])').count();
      for (let i = 0; i < groups; i++) {
        await clear();
        await page.locator('.can-group-head:not([disabled])').nth(i).click().catch(() => {});
        await page.waitForTimeout(80);
        if (await button('Lay down').isEnabled().catch(() => false)) {
          await button('Lay down').click();
          melded++;
          await page.waitForTimeout(700);
          break;
        }
      }
      await clear();

      // …and end the turn.
      if ((await page.locator('.can-step').innerText().catch(() => '')).includes('MELD')) {
        await page.locator('.can-card:not([disabled])').last().click();
        await page.waitForTimeout(150);
        if (await button('Discard').isEnabled().catch(() => false)) await button('Discard').click();
      }
      await page.waitForTimeout(900);
      rounds = Math.max(0, (await roundNow()) - startRound);
    }

    const finished = rounds > 0 || (await page.locator('.can-result').count()) > 0;
    step(watching ? 'watched the coach play the hand' : `played ${turns} turns and laid ${melded} melds`);
    if (rounds > 0) {
      const scores = tidy(await page.locator('.can-scoreboard, .can-totals').first().innerText().catch(() => ''));
      console.log(`\na round was played out and scored — the table is on round ${await roundNow()}\n${scores ? scores + '\n' : ''}`);
    } else if (finished) console.log('\n' + tidy(await page.locator('.can-result').innerText()) + '\n');
    else if (watching) console.log('\nthe round did not finish inside four minutes, even at full speed — that is worth looking at\n');
    else
      console.log(
        '\nthe round did not finish inside the time budget. The bots move at AGENT_PACE_MS (3.5 s), which is about half\n' +
          'a minute a lap — not a fault. Use --practice to watch a whole round at full speed.\n',
      );

    const shot = `canasta-${tableId || 'table'}.png`;
    await page.screenshot({ path: shot, fullPage: true });
    step(`screenshot ${shot}`);

    if (PRACTICE) {
      // NOTHING TO TIDY, but one thing to give back. A practice table is derived from who you are
      // rather than created, it is in no lobby, and it is meant to still be there next time — clearing
      // its seats would be undoing the one thing it is for. Its PACE is a different matter: it is a
      // setting somebody chose, and this run changed it.
      if (pacedBack && pacedBack.ms !== null) {
        await fetch(`${API}/tables/${tableId}/pace`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${pacedBack.token}` },
          body: JSON.stringify({ ms: pacedBack.ms }),
        }).catch(() => {});
        step(`pace put back to ${pacedBack.ms} ms`);
      }
      step('practice table left as it is — it is yours, and it is in no lobby');
    } else if (!KEEP) {
      // Stand up, so the table does not sit in the lobby holding a seat nobody is in.
      await page.locator('.can-seated button', { hasText: 'Leave the table' }).click().catch(() => {});
      await page.waitForTimeout(1500);
      // The seats the bots are in: everything but the one the person took.
      await tidyUp(page, API, tableId, [0, 1, 2, 3].filter((n) => n !== mySeat));
    }

    console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors');
    process.exitCode = errors.length || !finished ? 1 : 0;
  } finally {
    await browser.close();
  }
})();
