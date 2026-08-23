/* Play day 1 at real speed, with real timers, and record what happens and when.
 *
 *   node tools/playthrough.js            the found ending
 *   node tools/playthrough.js --all      all three ending mechanics
 *
 * Deliberately does NOT mock the clock. The gate runs on a mocked clock, which is fast
 * and deterministic but hides a whole class of bug: transitions that never complete,
 * typing indicators that never paint, scroll that lands in the wrong place. This is the
 * run that would catch those.
 *
 * What it cannot do is read. A human takes minutes over beat 1; this reads instantly, so
 * the reading estimate below is arithmetic, not experience.
 */
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUILT = 'file://' + path.join(ROOT, 'dist', 'unread.html').replace(/\\/g, '/');
const SHOTS = path.join(ROOT, 'shots', 'realtime');

const WPM = { fast: 300, steady: 250, careful: 200 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Record every bubble and typing indicator as it appears, with a wall-clock offset. */
const OBSERVER = () => {
  window.__log = [];
  window.__t0 = performance.now();
  const stamp = (kind, text) => window.__log.push({
    at: Math.round(performance.now() - window.__t0), kind, text: (text || '').slice(0, 60),
  });
  new MutationObserver((records) => {
    records.forEach((r) => {
      r.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        if (n.classList.contains('msg')) stamp('msg', n.textContent);
        else if (n.classList.contains('typing')) stamp('typing-start', '');
        else if (n.classList.contains('photo')) stamp('photo', '');
        else if (n.classList.contains('choice')) stamp('choice', n.textContent);
        else if (n.classList.contains('stamp')) stamp('stamp', n.textContent);
      });
      r.removedNodes.forEach((n) => {
        if (n.nodeType === 1 && n.classList && n.classList.contains('typing')) {
          stamp('typing-end', '');
        }
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
};

async function waitFor(page, fn, label, timeoutMs = 90000) {
  const started = Date.now();
  await page.waitForFunction(fn, null, { timeout: timeoutMs });
  return Date.now() - started;
}

async function playDayOne(endingChoice, label) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 480, height: 900 },
                                       deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });

  const t0 = Date.now();
  const mark = (what) => ({ what, at: ((Date.now() - t0) / 1000).toFixed(1) });
  const timeline = [];

  await page.goto(BUILT);
  /* installed after navigation: addInitScript runs before documentElement exists, and
     every live bubble arrives long after load anyway */
  await page.evaluate(OBSERVER);
  timeline.push(mark('list on screen'));

  fs.mkdirSync(SHOTS, { recursive: true });

  /* count what a player has to read before anything is wrong */
  const reading = await page.evaluate(() => {
    const story = window.STORY;
    let words = 0, messages = 0;
    story.beats.forEach((b) => {
      if (b.messages.some((m) => m.live)) return;
      b.messages.forEach((m) => {
        if (!m.body) return;
        words += m.body.trim().split(/\s+/).length;
        messages += 1;
      });
    });
    return { words, messages };
  });

  /* a player opens threads and reads them; three is what beat 2 waits for */
  for (const id of ['t_flat', 't_mom', 't_dave']) {
    await page.locator(`[data-thread="${id}"]`).click();
    await sleep(1200);                       /* a beat of dwell, not a real read */
    await page.locator('.back').click();
    timeline.push(mark('read ' + id));
  }

  const photoWait = await waitFor(page,
    () => document.querySelector('[data-thread="t_unknown"] .dot') !== null,
    'photo arrives');
  timeline.push(mark('unknown thread lights up (+' + (photoWait / 1000).toFixed(1) + 's)'));
  await page.locator('.phone').screenshot({ path: path.join(SHOTS, label + '-1-photo.png') });

  await page.locator('[data-thread="t_unknown"]').click();
  timeline.push(mark('opened the number'));

  await waitFor(page, () => document.querySelectorAll('.msg').length >= 3, 'beat 3');
  timeline.push(mark('beat 3 complete'));

  await waitFor(page, () => document.querySelectorAll('.choice').length === 3, 'choices');
  timeline.push(mark('choices offered'));
  await page.locator('.phone').screenshot({ path: path.join(SHOTS, label + '-2-choices.png') });

  await page.locator(`[data-choice="${endingChoice}"]`).click();
  timeline.push(mark('chose ' + endingChoice));

  const endWait = await waitFor(page,
    () => {
      const el = document.getElementById('end');
      return el.classList.contains('on') && parseFloat(getComputedStyle(el).opacity) > 0.99;
    }, 'ending', 120000);
  timeline.push(mark('ending fully visible (+' + (endWait / 1000).toFixed(1) + 's)'));
  await page.locator('.phone').screenshot({ path: path.join(SHOTS, label + '-3-ending.png') });

  const log = await page.evaluate(() => window.__log);
  const endTitle = await page.locator('#endTitle').textContent();
  await browser.close();

  return { label, timeline, log, errors, reading, endTitle,
           totalMs: Date.now() - t0 };
}

(async () => {
  const all = process.argv.includes('--all');
  const runs = all
    ? [['c_found', 'found'], ['c_silence', 'silence'], ['c_delete', 'delete']]
    : [['c_found', 'found']];

  for (const [choice, label] of runs) {
    const r = await playDayOne(choice, label);

    console.log('\n================ day 1, real speed, ending: ' + label + ' ================');
    console.log('beat 1 is ' + r.reading.messages + ' messages, ' + r.reading.words + ' words');
    Object.keys(WPM).forEach((k) => {
      const mins = r.reading.words / WPM[k];
      console.log('   at ' + String(WPM[k]).padStart(3) + ' wpm (' + k + '): ' +
                  Math.floor(mins) + 'm ' + String(Math.round((mins % 1) * 60)).padStart(2, '0') + 's');
    });

    console.log('\nwhat happened, and when (seconds from load):');
    r.timeline.forEach((e) => console.log('  ' + String(e.at).padStart(6) + '  ' + e.what));

    console.log('\nlive delivery, from the moment the number was opened:');
    const opened = r.log.findIndex((e) => e.kind === 'photo');
    const base = opened >= 0 ? r.log[opened].at : 0;
    r.log.filter((e) => e.at >= base).forEach((e) => {
      console.log('  +' + ((e.at - base) / 1000).toFixed(1).padStart(6) + 's  ' +
                  e.kind.padEnd(12) + e.text);
    });

    console.log('\nending card: ' + JSON.stringify(r.endTitle));
    console.log('total wall clock: ' + (r.totalMs / 1000).toFixed(1) + 's');
    console.log('page errors: ' + (r.errors.length ? r.errors.join(' | ') : 'none'));
  }
})();
