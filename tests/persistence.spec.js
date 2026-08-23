// D24 — real elapsed time between sessions, and D19 — single ingress.
//
// The away bands are tested twice: once against the pure function, which is exact, and
// once end to end through a seeded localStorage and a reload, which is what actually
// matters. The 1h-12h band must prove the reply options are really gone.

const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUILT = 'file://' + path.join(ROOT, 'dist', 'unread.html').replace(/\\/g, '/');
const LAUNCH = new Date('2026-08-22T21:30:00');

const MINUTE = 60000;
const HOUR = 60 * MINUTE;

async function seedSave(page, patch) {
  await page.addInitScript((p) => {
    const now = Date.now();
    const save = Object.assign({
      runSeed: 'gate-seed',
      day: 1,
      phase: 'day',
      phaseStartedAt: now,
      lastSeenAt: now,
      flags: {},
      contactState: {},
      cluesFound: {},
    }, p.patch);
    if (p.awayMs != null) save.lastSeenAt = now - p.awayMs;
    window.localStorage.setItem('unread.save.v1', JSON.stringify(save));
  }, patch);
}

test('applyAway maps each elapsed band exactly', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  const cases = [
    { awayMs: 30 * 1000, band: 'resume' },
    { awayMs: 90 * 1000, band: 'resume' },
    { awayMs: 5 * MINUTE, band: 'advanced' },
    { awayMs: 55 * MINUTE, band: 'advanced' },
    { awayMs: 2 * HOUR, band: 'missed' },
    { awayMs: 11 * HOUR, band: 'missed' },
    { awayMs: 13 * HOUR, band: 'dayAdvanced' },
    { awayMs: 50 * HOUR, band: 'dayAdvanced' },
  ];

  for (const c of cases) {
    const got = await page.evaluate((awayMs) => {
      const now = 1000000000000;
      return window.__unread.applyAway({ lastSeenAt: now - awayMs }, now);
    }, c.awayMs);
    expect(got.band, `${c.awayMs}ms away`).toBe(c.band);
  }

  // the boundaries themselves
  const atTwoMinutes = await page.evaluate(() => {
    const now = 1000000000000;
    return window.__unread.applyAway({ lastSeenAt: now - 120000 }, now).band;
  });
  expect(atTwoMinutes).toBe('advanced');

  // the day cap is +3 however long you are gone
  const capped = await page.evaluate(() => {
    const now = 1000000000000;
    return window.__unread.applyAway({ lastSeenAt: now - 1000 * 3600 * 24 * 30 }, now);
  });
  expect(capped.daysAdvanced).toBe(3);
});

test('under two minutes away, nothing changed', async ({ page }) => {
  await seedSave(page, { awayMs: 30 * 1000, patch: { day: 3 } });
  await page.goto(BUILT);
  const state = await page.evaluate(() => ({
    band: window.__unread.state.away.band,
    day: window.__unread.state.save.day,
    locked: window.__unread.state.repliesLocked,
  }));
  expect(state.band).toBe('resume');
  expect(state.day).toBe(3);
  expect(state.locked).toBe(false);
});

test('gone for five minutes: the phase moved on, but you can still reply', async ({ page }) => {
  await seedSave(page, { awayMs: 5 * MINUTE, patch: { day: 3, phase: 'day' } });
  await page.goto(BUILT);

  const away = await page.evaluate(() => window.__unread.state.away);
  expect(away.band).toBe('advanced');
  expect(away.waiting).toBeGreaterThanOrEqual(1);
  expect(away.waiting).toBeLessThanOrEqual(3);

  await page.evaluate(() => window.__unread.loadPhase(3, 'day'));
  const pending = await page.evaluate(() => window.__unread.state.pendingChoices.length);
  expect(pending, 'day 3 offers replies').toBeGreaterThan(0);

  const thread = await page.evaluate(() => {
    const c = window.__unread.state.pendingChoices[0];
    const rows = [...document.querySelectorAll('.row')];
    return rows.length ? rows[0].getAttribute('data-thread') : null;
  });
  await page.locator(`[data-thread="${thread}"]`).click();
  await expect(page.locator('.choice')).not.toHaveCount(0);
});

test('gone for two hours: you may read it, but the replies are gone', async ({ page }) => {
  await seedSave(page, { awayMs: 2 * HOUR, patch: { day: 3, phase: 'day' } });
  await page.goto(BUILT);

  const state = await page.evaluate(() => ({
    band: window.__unread.state.away.band,
    locked: window.__unread.state.repliesLocked,
  }));
  expect(state.band).toBe('missed');
  expect(state.locked, 'replies are locked').toBe(true);

  // the phase still loads and is readable
  await page.evaluate(() => window.__unread.loadPhase(3, 'day'));
  await expect(page.locator('.row')).not.toHaveCount(0);

  // ...but no choice is offered, in any thread
  const threads = await page.locator('.row').evaluateAll((rows) =>
    rows.map((r) => r.getAttribute('data-thread')));
  for (const id of threads) {
    await page.locator(`[data-thread="${id}"]`).click();
    await expect(page.locator('.choice'), `no replies in ${id}`).toHaveCount(0);
    const back = page.locator('.back');
    if (await back.count()) await back.click();
  }

  // and the messages are still on screen: read, not erased
  await page.locator(`[data-thread="${threads[0]}"]`).click();
  await expect(page.locator('.msg')).not.toHaveCount(0);
});

test('gone for a day and a bit: the day advanced, capped at three', async ({ page }) => {
  await seedSave(page, { awayMs: 26 * HOUR, patch: { day: 2 } });
  await page.goto(BUILT);
  const state = await page.evaluate(() => ({
    band: window.__unread.state.away.band,
    advanced: window.__unread.state.away.daysAdvanced,
    day: window.__unread.state.save.day,
    locked: window.__unread.state.repliesLocked,
  }));
  expect(state.band).toBe('dayAdvanced');
  expect(state.advanced).toBe(2);
  expect(state.day).toBe(4);
  expect(state.locked).toBe(true);
});

test('D19 — one ingress: everything on screen is stamped, a second path is not', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  // the real screen is clean
  expect(await page.evaluate(() => window.__unread.auditIngress())).toEqual([]);

  // painting a raw string is refused outright
  expect(await page.evaluate(() => window.__unread.mintedPaintRejects())).toBe(true);

  // open a thread, still clean
  await page.locator('.row').first().click();
  expect(await page.evaluate(() => window.__unread.auditIngress())).toEqual([]);

  // the seeded negative: text reaching a bubble by a second path is caught
  const offenders = await page.evaluate(() => {
    window.__unread.paintUnminted();
    return window.__unread.auditIngress();
  });
  expect(offenders.length, 'the audit catches the rogue bubble').toBe(1);
  expect(offenders[0]).toContain('msg');
});

test('D26 — a reply is available in every phase of every day', async ({ page }) => {
  test.setTimeout(120000);
  await page.addInitScript((now) => {
    window.localStorage.setItem('unread.save.v1', JSON.stringify({
      runSeed: 'gate-seed', day: 1, phase: 'day', phaseStartedAt: now, lastSeenAt: now,
      flags: {}, contactState: {}, cluesFound: {},
    }));
  }, LAUNCH.getTime());
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  const ladder = await page.evaluate(() => window.CONTENT.ladder.days.map((d) => d.day));
  for (const day of ladder.filter((d) => d > 1)) {
    for (const phase of ['day', 'night']) {
      const pending = await page.evaluate(([d, p]) => {
        window.__unread.loadPhase(d, p);
        return window.__unread.state.pendingChoices.length;
      }, [day, phase]);
      expect(pending, `day ${day} ${phase} offers a reply`).toBeGreaterThan(0);
    }
  }
});

test('D27 — answering records what Ren said and any clue it reveals', async ({ page }) => {
  await page.addInitScript((now) => {
    window.localStorage.setItem('unread.save.v1', JSON.stringify({
      runSeed: 'gate-seed', day: 1, phase: 'day', phaseStartedAt: now, lastSeenAt: now,
      flags: {}, contactState: {}, cluesFound: {},
    }));
  }, LAUNCH.getTime());
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  // one pass: find a clue-revealing reply, open a thread, and take it. pickChoice
  // dispatches a real click on the real button, so the handler under test is the one
  // the player uses.
  const taken = await page.evaluate(() => {
    for (const entry of window.CONTENT.ladder.days) {
      if (entry.day === 1) continue;
      for (const phase of ['day', 'night']) {
        window.__unread.loadPhase(entry.day, phase);
        const withClue = window.__unread.state.pendingChoices.find((c) => c.revealsClue);
        if (!withClue) continue;
        const thread = window.__unread.story.threads()
          .find((t) => t.id === 't_flat') || window.__unread.story.threads()[0];
        window.__unread.openThread(thread);
        const clicked = window.__unread.pickChoice(withClue.id);
        return {
          clicked, day: entry.day, phase, id: withClue.id,
          clue: withClue.revealsClue, tells: withClue.tells,
        };
      }
    }
    return null;
  });

  expect(taken, 'some reply in days 2-10 reveals a clue').not.toBeNull();
  expect(taken.clicked, `${taken.id} was on screen and clickable`).toBe(true);

  const save = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem('unread.save.v1')));
  expect(Object.keys(save.cluesFound), 'the clue was recorded').toContain(taken.clue);
  expect(save.contactState.lastToldByRen.map((t) => t.said),
    'what Ren said was recorded for Act II').toContain(taken.tells);

  // answering does not exhaust the supply: the last authored phase still offers a reply
  const next = await page.evaluate(() => {
    window.__unread.loadPhase(10, 'night');
    return window.__unread.state.pendingChoices.length;
  });
  expect(next, 'the last authored phase still offers a reply').toBeGreaterThan(0);
});
