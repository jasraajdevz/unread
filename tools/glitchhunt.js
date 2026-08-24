/* Drive a lot of the app and collect anything that looks wrong.
 *
 *   node tools/glitchhunt.js
 *
 * Not a gate. A gate asserts what you thought of; this pokes at things and reports what
 * it finds, which is the only way to catch what you did not think of.
 */
const { chromium } = require('@playwright/test');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUILT = 'file://' + path.join(ROOT, 'dist', 'unread.html').split(path.sep).join('/');
const LAUNCH = new Date('2026-08-22T21:30:00');

const findings = [];
const note = (what) => { findings.push(what); console.log('\n  !! ' + what); };
const first = (e) => String(e.message).split('\n')[0].trim();

async function invariants(p, where) {
  const bad = await p.evaluate(() => {
    const out = [];
    const phone = document.querySelector('.phone').getBoundingClientRect();

    // nothing painted without going through the one ingress
    const orphans = window.__unread.auditIngress();
    if (orphans.length) out.push('unstamped: ' + orphans.slice(0, 2).join(' | '));

    // nothing sticking out of the phone
    document.querySelectorAll('.msg, .row, .choice, .spot, .game, .vm').forEach((el) => {
      const b = el.getBoundingClientRect();
      if (b.width === 0) return;
      if (b.left < phone.left - 1 || b.right > phone.right + 1) {
        out.push('overflows: ' + el.className + ' ' + el.textContent.slice(0, 24));
      }
    });

    // No unfilled slot ever reaches a bubble -- but a player who types "{MEMORY}" and is
    // quoted it back is being shown their own words, which is the feature working.
    document.querySelectorAll('.msg, .choice').forEach((el) => {
      const src = el.getAttribute('data-src');
      if (src === 'player.typed' || src === 'director.quote') return;
      if (/\{[A-Z0-9_]+\}/.test(el.textContent)) out.push('slot leak: ' + el.textContent.slice(0, 30));
    });

    // only one overlay may be up at a time
    const up = ['#sheet.on', '#viewer.on', '#end.on'].filter((s) => document.querySelector(s));
    if (up.length > 1) out.push('overlays stacked: ' + up.join(' + '));

    return out;
  });
  bad.forEach((b) => note(where + ' -> ' + b));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 480, height: 900 } });
  page.on('pageerror', (e) => note('page error: ' + e));
  page.on('console', (m) => { if (m.type() === 'error') note('console: ' + m.text()); });

  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  console.log('sweeping every day and phase...');
  // day 100 reveals the ending, which covers the phone; swept separately below
  const days = await page.evaluate(
    () => window.CONTENT.ladder.days.map((d) => d.day).filter((d) => d < 100));
  for (const day of days) {
    for (const phase of ['day', 'night']) {
      await page.evaluate(([d, p]) => window.__unread.loadPhase(d, p), [day, phase]);
      const threads = await page.locator('.row').evaluateAll(
        (rows) => rows.map((r) => r.getAttribute('data-thread')));
      for (const id of threads) {
        process.stdout.write(`
  day ${day} ${phase} ${id}          `);
        const where = `day ${day} ${phase} ${id}`;
        try {
          await page.locator(`[data-thread="${id}"]`).click({ timeout: 4000 });
        } catch (e) {
          note(`${where} -> the row will not open: ${first(e)}`);
          await page.evaluate(() => window.__unread.renderList());
          continue;
        }
        await invariants(page, where);
        const back = page.locator('#appbar .back');
        if (await back.count()) {
          try {
            await back.click({ timeout: 4000 });
          } catch (e) {
            note(`${where} -> you cannot get back out: ${first(e)}`);
            await page.screenshot({ path: `shots/stuck-${day}-${phase}-${id}.png` });
            await page.evaluate(() => window.__unread.renderList());
          }
        }
      }
    }
  }

  console.log('checking the last day does not ambush you mid-thread...');
  await page.evaluate(() => window.__unread.loadPhase(99, 'night'));
  await page.locator('[data-thread="t_mom"]').click();
  const ambush = await page.evaluate(() => {
    window.__unread.loadPhase(100, 'night');
    return {
      ended: document.querySelector('#end').classList.contains('on'),
      where: window.__unread.state.current && window.__unread.state.current.id,
    };
  });
  if (ambush.ended && ambush.where && ambush.where !== 't_unknown') {
    note('the ending card lands while the player is in ' + ambush.where);
  }
  await page.evaluate(() => { window.__unread.save.clear(); });
  await page.reload();

  console.log('poking the overlays...');
  await page.locator('#cog').click();
  await invariants(page, 'settings');
  await page.locator('#sheetBack').click();
  await page.locator('#find').click();
  await page.locator('#q').fill('a');
  await invariants(page, 'search a');
  await page.locator('#q').fill('');
  await page.locator('#appbar .back').click();

  console.log('reacting to the first and last message in a thread...');
  await page.locator('.row').first().click();
  for (const nth of [0, -1]) {
    const msg = nth === 0 ? page.locator('.msg').first() : page.locator('.msg').last();
    if (await msg.count()) {
      await msg.dblclick();
      const picker = page.locator('.picker');
      if (await picker.count()) {
        const pb = await picker.boundingBox();
        const phone = await page.locator('.phone').boundingBox();
        if (pb.y < phone.y || pb.y + pb.height > phone.y + phone.height) {
          note(`picker escapes the phone at message ${nth} (y=${Math.round(pb.y)})`);
        }
        if (pb.x < phone.x || pb.x + pb.width > phone.x + phone.width) {
          note(`picker escapes sideways at message ${nth}`);
        }
      } else {
        note(`no picker on message ${nth}`);
      }
      await page.locator('.phone').click({ position: { x: 5, y: 300 } });
    }
  }


  console.log('typing things nobody should type...');
  await page.evaluate(() => window.__unread.save.clear());
  await page.reload();
  await page.locator('[data-thread="t_mom"]').click();

  const NASTY = [
    ['a script tag',        '<img src=x onerror="window.__pwned=1">'],
    ['a slot name',         'i said {MEMORY} to {TYPEDWHO}'],
    ['unbalanced markup',   '</div><script>alert(1)</script>'],
    ['an entity',           '&lt;&amp;&gt;&#x27;'],
    ['quotes',              `he said "it's mine" & left`],
    ['newlines',            'one\ntwo\nthree'],
    ['very long',           'x'.repeat(4000)],
    ['past the cap',        'y'.repeat(12000)],
    ['only spaces',         '        '],
    ['emoji',               '👻👻👻 who is this 👻'],
    ['right to left',       'مرحبا بالعالم'],
    ['zero width',          'i​am​fine'],
    ['a lone brace',        '{'],
  ];

  for (const [what, text] of NASTY) {
    await page.locator('#say').fill(text);
    await page.locator('#send').click();
    await page.waitForTimeout(60);
    const state = await page.evaluate((sent) => {
      const mine = document.querySelector('.msg.me:last-of-type');
      const shown = mine ? (mine.childNodes[0] || {}).textContent || '' : null;
      return {
        pwned: !!window.__pwned,
        elements: document.querySelectorAll('.msg.me img, .msg.me script, .msg.me div').length,
        shown: shown,
        tooLong: shown !== null && shown.length > window.__unread.maxTyped + 20,
        stored: (window.__unread.typed().slice(-1)[0] || {}).text,
        overflows: (() => {
          const phone = document.querySelector('.phone').getBoundingClientRect();
          return Array.from(document.querySelectorAll('.msg')).some((m) => {
            const b = m.getBoundingClientRect();
            return b.width && (b.left < phone.left - 1 || b.right > phone.right + 1);
          });
        })(),
      };
    }, text);
    if (state.pwned) note(`typing ${what} executed script`);
    if (state.elements) note(`typing ${what} built ${state.elements} element(s) in the bubble`);
    if (state.tooLong) note(`typing ${what} produced a ${state.shown.length}-char bubble`);
    if (state.overflows) note(`typing ${what} pushed a bubble out of the phone`);
    if (text.trim() && state.stored === undefined) note(`typing ${what} was not recorded`);
    if (!text.trim() && state.stored !== undefined && state.stored.trim() === '') {
      note('sending whitespace recorded a message');
    }
  }
  await invariants(page, 'after typing nonsense');

  await page.locator('#say').fill('who is this');
  await page.locator('#say').press('Enter');
  await page.waitForTimeout(200);
  if (await page.locator('#say').inputValue()) note('the enter key does not send');

  console.log('sending faster than it can answer...');
  await page.locator('#say').fill('who is this');
  for (let i = 0; i < 5; i++) await page.locator('#send').click({ force: true });
  await page.waitForTimeout(1500);
  const spam = await page.evaluate(() => ({
    fields: document.querySelectorAll('.composer').length,
    empty: (document.querySelector('#say') || {}).value,
  }));
  if (spam.fields !== 1) note(`${spam.fields} composers after rapid sending`);
  if (spam.empty) note('the field did not clear after sending');

  console.log('typing where you should not be able to...');
  await page.locator('#appbar .back').click();
  await page.locator('[data-thread="t_archive"]').click();
  const locked = await page.locator('#say').count();
  if (locked) note('a locked thread offers a field to type into');
  await page.locator('#appbar .back').click();

  console.log('checking a draft does not follow you between threads...');
  await page.locator('[data-thread="t_mom"]').click();
  await page.locator('#say').fill('a draft nobody sent');
  await page.locator('#appbar .back').click();
  await page.locator('[data-thread="t_flat"]').click();
  const carried = await page.locator('#say').inputValue();
  if (carried) note(`a draft followed you into another thread: ${JSON.stringify(carried)}`);
  await page.locator('#appbar .back').click();

  console.log('quoting back something shaped like a slot...');
  const slotty = await page.evaluate(() => {
    const S = window.__unread.state;
    S.save.contactState = S.save.contactState || {};
    S.save.contactState.typed = [
      { day: 2, threadId: 't_mom',  text: '{MEMORY} and {TYPED}' },
      { day: 3, threadId: 't_flat', text: 'nothing happened' },
      { day: 4, threadId: 't_dave', text: '{TYPEDWHO}' },
      { day: 5, threadId: 't_mom',  text: 'it wasnt me' },
      { day: 6, threadId: 't_flat', text: 'i heard it' },
      { day: 7, threadId: 't_mom',  text: 'stop' },
    ];
    const bad = [];
    for (let day = 21; day <= 100; day++) {
      for (const phase of ['day', 'night']) {
        const plan = window.__unread.loadPhase(day, phase);
        (plan.phases[phase] || []).forEach((e) => {
          if (e.quotesPlayer && /\{[A-Z0-9_]+\}/.test(e.body)) bad.push(day + ': ' + e.body);
        });
      }
    }
    return bad;
  });
  /* A player typing "{MEMORY}" and being quoted it back is not a bug -- it is their own
     words coming back. It is only a bug if anything downstream treats it as a slot. */
  if (slotty.length) {
    console.log(`    (the number quoted ${slotty.length} brace-shaped line(s) back, as typed)`);
  }
  await page.evaluate(() => window.__unread.save.clear());
  await page.reload();

  console.log('checking the away bands do not run off the end...');
  const overshoot = await page.evaluate(() => {
    const now = 1000000000000;
    const away = window.__unread.applyAway({ lastSeenAt: now - 1000 * 3600 * 24 * 400 }, now);
    return away.daysAdvanced;
  });
  if (overshoot > 3) note('day advance is uncapped: ' + overshoot);

  const past100 = await page.evaluate(() => {
    window.__unread.state.save.day = 99;
    const now = Date.now();
    window.__unread.state.save.lastSeenAt = now - 1000 * 3600 * 40;
    return typeof window.__unread.loadPhase(101, 'day');
  });
  if (past100 !== 'object') note('day 101 does not load cleanly (' + past100 + ')');

  console.log('\n' + (findings.length
    ? findings.length + ' thing(s) to look at'
    : 'nothing found'));
  await browser.close();
  process.exit(0);
})();
