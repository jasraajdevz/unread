// Drives dist/unread.html through every beat and photographs each boundary.
//
// D16: this is the gate the project never had. It verifies the beats fire, not merely
// that the code parses.
//
// Every expected string is read out of Resources/story.json. Nothing in this file
// duplicates story text -- the same reason rule 15 keeps it out of the engine.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STORY = JSON.parse(fs.readFileSync(path.join(ROOT, 'Resources', 'story.json'), 'utf8'));
const BUILT = 'file://' + path.join(ROOT, 'dist', 'unread.html').replace(/\\/g, '/');
const SHOTS = path.join(ROOT, 'shots');

// A launch time inside D11's 09:00-23:59 window, so the final cluster lands on one
// calendar day and the screenshots are reproducible.
const LAUNCH = new Date('2026-08-22T21:30:00');

const beat = (id) => STORY.beats.find((b) => b.id === id);
const bodies = (id) => beat(id).messages.filter((m) => m.kind !== 'photo').map((m) => m.body);
const threadName = (id) => STORY.threads.find((t) => t.id === id).displayName;

// The thread list orders by max(offsetMinutes) descending (D11). Compute the expectation
// from the data rather than asserting a hand-written order.
function expectedOrder() {
  return STORY.threads
    .map((t) => {
      const own = STORY.beats.filter((b) => b.threadId === t.id && b.id === t.startBeat);
      const offsets = own.flatMap((b) => b.messages.map((m) => m.offsetMinutes));
      return { id: t.id, last: Math.max(...offsets) };
    })
    .sort((a, b) => b.last - a.last)
    .map((t) => t.id);
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.locator('.phone').screenshot({ path: path.join(SHOTS, name + '.png') });
}

test('every beat fires, and each one is photographed', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  // ---- beat 1: the thread list -------------------------------------------------
  await expect(page.locator('.row')).toHaveCount(STORY.threads.length);
  const order = await page.locator('.row').evaluateAll((rows) =>
    rows.map((r) => r.getAttribute('data-thread')));
  expect(order).toEqual(expectedOrder());

  // the two threads marked startsUnread are the two showing a dot, and no others
  const unread = await page.locator('.row').evaluateAll((rows) =>
    rows.filter((r) => r.querySelector('.dot')).map((r) => r.getAttribute('data-thread')));
  expect(unread.sort()).toEqual(
    STORY.threads.filter((t) => t.startsUnread).map((t) => t.id).sort());

  await shot(page, '01-thread-list');

  // ---- beat 1: a conversation --------------------------------------------------
  await page.locator('[data-thread="t_flat"]').click();
  await expect(page.locator('#appbar .title')).toHaveText(threadName('t_flat'));
  const flatLines = bodies('b_flat_1');
  await expect(page.locator('.convo')).toContainText(flatLines[0]);
  await expect(page.locator('.convo')).toContainText(flatLines[flatLines.length - 1]);
  // group speakers are labelled, which is what fromContactId exists for
  await expect(page.locator('.who').first()).toHaveText(/\S/);
  await shot(page, '02-conversation');

  await page.locator('.back').click();
  await page.locator('[data-thread="t_mom"]').click();
  await expect(page.locator('.convo')).toContainText(bodies('b_mom_1')[0]);
  await page.locator('.back').click();
  await page.locator('[data-thread="t_dave"]').click();
  await expect(page.locator('.convo')).toContainText(bodies('b_dave_1')[0]);
  await page.locator('.back').click();

  // ---- beat 2: the photo arrives on its own ------------------------------------
  await page.clock.runFor(8000);
  await expect(page.locator('[data-thread="t_unknown"] .dot')).toHaveCount(1);
  await expect(page.locator('[data-thread="t_unknown"] .rp')).toHaveText('Photo');
  await shot(page, '03-photo-arrived');

  // ---- beat 3: it starts writing while you are reading -------------------------
  await page.locator('[data-thread="t_unknown"]').click();
  await expect(page.locator('.photo canvas')).toHaveCount(1);
  for (const line of bodies('b_unknown_3')) {
    await page.clock.runFor(10000);
    await expect(page.locator('.convo')).toContainText(line);
  }
  await expect(page.locator('.stamp')).toContainText('now');
  await shot(page, '04-beat3-live');

  // ---- beat 4: it stops calling you Ren ----------------------------------------
  const beat4 = beat('b_unknown_4').messages
    .filter((m) => !(m.requiresFlags || []).length)   // the gated line needs a flag we did not set
    .map((m) => m.body);
  for (const line of beat4) {
    await page.clock.runFor(15000);
    await expect(page.locator('.convo')).toContainText(line);
  }
  await shot(page, '05-beat4-who-is-this');

  // the flag-gated line must NOT be present: we never backgrounded the tab
  const gated = beat('b_unknown_4').messages.find((m) => (m.requiresFlags || []).length);
  await expect(page.locator('.convo')).not.toContainText(gated.body);

  // ---- beat 5: the choices -----------------------------------------------------
  await page.clock.runFor(5000);
  const choices = beat('b_unknown_4').choices;
  await expect(page.locator('.choice')).toHaveCount(choices.length);
  for (const c of choices) {
    await expect(page.locator(`[data-choice="${c.id}"]`)).toHaveText(c.label);
  }
  await shot(page, '06-choices');

  expect(errors, 'the page threw no errors').toEqual([]);
});

test('choosing an ending reaches its screen', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  for (const id of ['t_flat', 't_mom', 't_dave']) {
    await page.locator(`[data-thread="${id}"]`).click();
    await page.locator('.back').click();
  }
  await page.clock.runFor(8000);
  await page.locator('[data-thread="t_unknown"]').click();
  await page.clock.runFor(120000);
  await expect(page.locator('.choice')).toHaveCount(3);

  const ending = STORY.endings.find((e) => e.id === 'e_found');
  const choice = beat('b_unknown_4').choices.find((c) => c.next === ending.beatId);
  await page.locator(`[data-choice="${choice.id}"]`).click();
  await page.clock.runFor(60000);

  await expect(page.locator('#end')).toHaveClass(/on/);
  await expect(page.locator('#endTitle')).toHaveText(ending.title);
  await expect(page.locator('#endBody')).toHaveText(ending.body);
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.locator('.phone').screenshot({ path: path.join(SHOTS, '07-ending.png') });
});
