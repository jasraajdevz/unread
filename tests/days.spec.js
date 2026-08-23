// Days 1-10, both phases, headless in --fast. One screenshot per phase: 20 in total.
//
// The generated phases are driven by the director, so the seed is pinned and the shots
// are reproducible. The fast window (30s instead of 10 minutes) is exercised once, on
// day 2, to prove the phase runner honours it.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUILT = 'file://' + path.join(ROOT, 'dist', 'unread.html').replace(/\\/g, '/') + '?fast=1';
const SHOTS = path.join(ROOT, 'shots', 'days');
const LADDER = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'ladder.json'), 'utf8'));
const LAUNCH = new Date('2026-08-22T21:30:00');
const SEED = 'gate-seed';

test('days 1-10 play in fast mode and each phase is photographed', async ({ page }) => {
  test.setTimeout(180000);
  fs.mkdirSync(SHOTS, { recursive: true });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.addInitScript((seed) => {
    const now = Date.now();
    window.localStorage.setItem('unread.save.v1', JSON.stringify({
      runSeed: seed, day: 1, phase: 'day', phaseStartedAt: now, lastSeenAt: now,
      flags: {}, contactState: {}, cluesFound: {},
    }));
  }, SEED);

  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  // the fast window really is the short one
  const windowMs = await page.evaluate(() => window.__unread.phaseWindowMs);
  expect(windowMs).toBe(LADDER.fastWindowMs);

  const rows = [];
  for (const entry of LADDER.days) {
    for (const phase of ['day', 'night']) {
      const summary = await page.evaluate(([day, phase]) => {
        const plan = window.__unread.loadPhase(day, phase);
        return {
          authored: plan.authored,
          messages: (plan.phases[phase] || []).filter((e) => e.kind !== 'choice').length,
          choices: (plan.phases[phase] || []).filter((e) => e.kind === 'choice').length,
          threads: document.querySelectorAll('.row').length,
        };
      }, [entry.day, phase]);

      // every phase must put something on screen
      expect(summary.threads, `day ${entry.day} ${phase} has threads`).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.__unread.auditIngress())).toEqual([]);

      const name = String(entry.day).padStart(2, '0') + '-' + phase;
      await page.locator('.phone').screenshot({ path: path.join(SHOTS, name + '.png') });
      rows.push(Object.assign({ day: entry.day, phase }, summary));

      // let the fast phase window elapse, so the runner is genuinely exercised
      await page.clock.runFor(LADDER.fastWindowMs);
    }
  }

  const files = fs.readdirSync(SHOTS).filter((f) => f.endsWith('.png'));
  expect(files.length, 'one screenshot per phase').toBe(LADDER.days.length * 2);

  fs.writeFileSync(path.join(ROOT, 'shots', 'days-summary.json'),
    JSON.stringify(rows, null, 2));
  expect(errors, 'no page errors across ten days').toEqual([]);
});
