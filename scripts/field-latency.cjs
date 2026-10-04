// LATENCY WALK — field.faithnet.io as a demo person, every page, every /a2a call timed.
// Prints per-page: the skills fired, each call's ms, the page's wall time; then the aggregate
// slowest skills and most-called. Read-only. node scripts/field-latency.cjs [--as Nathan] [--headed]
const { chromium } = require('/home/barb/node_modules/playwright');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const SITE = 'https://field.faithnet.io'; const WHO = arg('as', 'Nathan'); const HEADED = argv.includes('--headed');
const skillOf = (pd) => { try { return JSON.parse(pd).params.message.metadata.skill || '?'; } catch { return '(non-skill)'; } };
(async () => {
  const b = await chromium.launch({ headless: !HEADED });
  const page = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  const starts = new Map(); const calls = []; let phase = 'signin';
  page.on('request', (r) => { if (r.url().includes('/a2a')) starts.set(r, { t0: Date.now(), phase }); });
  const done = (r, status) => { if (!r.url().includes('/a2a')) return; const rec = starts.get(r); if (!rec) return; starts.delete(r); calls.push({ phase: rec.phase, skill: skillOf(r.postData()), ms: Date.now() - rec.t0, status }); };
  page.on('requestfinished', (r) => done(r, (r.response && r.response()) ? 'ok' : 'done'));
  page.on('response', (resp) => { const r = resp.request(); if (r.url().includes('/a2a') && starts.has(r)) done(r, resp.status()); });
  page.on('requestfailed', (r) => done(r, 'FAILED'));
  const settle = async (ms = 9000) => { const t = Date.now(); let last = calls.length; while (Date.now() - t < ms) { await page.waitForTimeout(1500); if (calls.length === last && Date.now() - t > 3000) break; last = calls.length; } };
  const mark = (p) => { phase = p; const i = calls.length; return () => calls.length - i; };
  try {
    await page.goto(SITE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { const d = document.querySelector('[data-testid="demo-people-fold"]'); if (d && !d.open) d.open = true; });
    await page.getByRole('button', { name: new RegExp(`^(Connect|Sign in) as ${WHO}$`, 'i') }).click();
    const t0 = Date.now();
    const pick = page.locator('[data-testid^="pick-workspace-"]', { hasText: /Game Night/i }).first();
    if (await pick.waitFor({ timeout: 60000 }).then(() => true).catch(() => false)) { phase = 'workspace-pick+home'; await pick.click(); }
    await settle(15000);
    console.log(`signed in + landed in ${Math.round((Date.now() - t0) / 1000)}s`);
    const nav = page.locator('nav.side, nav');
    let ids = [];
    try { ids = await nav.first().locator('[data-testid^="nav-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid'))); } catch {}
    console.log('nav items:', ids.join(' ') || '(none found)');
    for (const id of ids) {
      const t = Date.now(); const m = mark(id);
      try { await page.locator(`[data-testid="${id}"]`).first().click({ timeout: 8000 }); } catch { continue; }
      await settle(12000);
      const mine = calls.filter((c) => c.phase === id);
      console.log(`\n### ${id} — ${Math.round((Date.now() - t) / 1000)}s wall, ${m()} /a2a calls`);
      const byskill = {}; for (const c of mine) { byskill[c.skill] = byskill[c.skill] || { n: 0, ms: 0, max: 0, fail: 0 }; const s = byskill[c.skill]; s.n++; s.ms += c.ms; s.max = Math.max(s.max, c.ms); if (String(c.status).match(/4|5|FAIL/)) s.fail++; }
      for (const [sk, s] of Object.entries(byskill).sort((a, b) => b[1].ms - a[1].ms)) console.log(`    ${sk}: ${s.n}× total ${s.ms}ms (max ${s.max}ms)${s.fail ? ` ⚠ ${s.fail} failed` : ''}`);
    }
    // aggregate
    console.log('\n===== AGGREGATE (all pages) =====');
    const agg = {}; for (const c of calls) { agg[c.skill] = agg[c.skill] || { n: 0, ms: 0, max: 0, fail: 0 }; const s = agg[c.skill]; s.n++; s.ms += c.ms; s.max = Math.max(s.max, c.ms); if (String(c.status).match(/4|5|FAIL/)) s.fail++; }
    for (const [sk, s] of Object.entries(agg).sort((a, b) => b[1].ms - a[1].ms)) console.log(`  ${sk}: ${s.n}× total ${s.ms}ms (avg ${Math.round(s.ms / s.n)}ms, max ${s.max}ms)${s.fail ? ` ⚠ ${s.fail} failed` : ''}`);
    console.log(`\n  total /a2a calls: ${calls.length}, total wall in calls: ${calls.reduce((a, c) => a + c.ms, 0)}ms`);
  } catch (e) { console.error('walk error:', e.message); }
  await b.close();
})();
