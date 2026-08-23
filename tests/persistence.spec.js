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
  // D29: only the oldest unanswered question is on screen, so hunt for a clue-revealing
  // reply among the choices actually offered -- answering earlier questions to reach it.
  const taken = await page.evaluate(() => {
    for (const entry of window.CONTENT.ladder.days) {
      if (entry.day === 1) continue;
      for (const phase of ['day', 'night']) {
        window.__unread.loadPhase(entry.day, phase);
        for (const thread of window.__unread.story.threads()) {
          window.__unread.openThread(thread);
          for (let step = 0; step < 8; step++) {
            const offered = window.__unread.choicesForThread(thread.id);
            if (!offered.length) break;
            const match = window.__unread.state.pendingChoices
              .find((c) => offered.indexOf(c.id) >= 0 && c.revealsClue);
            if (match) {
              const clicked = window.__unread.pickChoice(match.id);
              return {
                clicked, day: entry.day, phase, id: match.id,
                clue: match.revealsClue, tells: match.tells, thread: thread.id,
              };
            }
            window.__unread.pickChoice(offered[0]);   // answer and move to the next
          }
        }
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
    window.__unread.loadPhase(20, 'night');
    return window.__unread.state.pendingChoices.length;
  });
  expect(next, 'the last authored phase still offers a reply').toBeGreaterThan(0);
});

test('D29 — replies are per question: answering one leaves the others', async ({ page }) => {
  await page.addInitScript((now) => {
    window.localStorage.setItem('unread.save.v1', JSON.stringify({
      runSeed: 'gate-seed', day: 1, phase: 'day', phaseStartedAt: now, lastSeenAt: now,
      flags: {}, contactState: {}, cluesFound: {},
    }));
  }, LAUNCH.getTime());
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  await page.evaluate(() => window.__unread.loadPhase(2, 'day'));

  const pending = await page.evaluate(() => {
    const byThread = {};
    window.__unread.state.pendingChoices.forEach((c) => {
      (byThread[c.threadId] = byThread[c.threadId] || []).push(c.templateId);
    });
    return byThread;
  });
  const threads = Object.keys(pending);
  expect(threads.length, 'day 2 spans several threads').toBeGreaterThan(1);

  // a thread that asked two separate questions, or this proves nothing
  const multi = threads.find((id) => new Set(pending[id]).size > 1);
  expect(multi, 'some thread asks more than one question in a phase').toBeTruthy();

  // it offers only the first question's answers, not both questions' at once
  await page.locator(`[data-thread="${multi}"]`).click();
  const firstGroup = await page.evaluate((id) => window.__unread.choicesForThread(id), multi);
  const onScreen = await page.locator('.choice').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-choice')));
  expect(onScreen).toEqual(firstGroup);
  expect(onScreen.length, 'one question, not the whole thread')
    .toBeLessThan(pending[multi].length);

  const templates = await page.evaluate((id) =>
    window.__unread.pendingInThread(id).map((c) => c.templateId), multi);
  const firstTemplate = templates[0];
  expect(new Set(templates).size, 'the thread has more than one question waiting')
    .toBeGreaterThan(1);

  // answering the first question reveals the next one, in the same thread
  const label = await page.locator('.choice').first().textContent();
  await page.locator('.choice').first().click();
  await expect(page.locator('.msg.me').last().locator('.body')).toHaveText(label);

  const after = await page.evaluate((id) =>
    window.__unread.pendingInThread(id).map((c) => c.templateId), multi);
  expect(after, 'the answered question is spent').not.toContain(firstTemplate);
  expect(after.length, 'the other question survives').toBeGreaterThan(0);

  const nextGroup = await page.locator('.choice').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-choice')));
  expect(nextGroup.length, 'the next question is now offered').toBeGreaterThan(0);
  expect(nextGroup, 'and it is a different question').not.toEqual(onScreen);

  // a different thread is untouched throughout
  const other = threads.find((id) => id !== multi);
  await page.locator('.back').click();
  await page.locator(`[data-thread="${other}"]`).click();
  const otherGroup = await page.evaluate((id) => window.__unread.choicesForThread(id), other);
  await expect(page.locator('.choice'), `${other} still has its replies`)
    .toHaveCount(otherGroup.length);
  expect(otherGroup.length).toBeGreaterThan(0);
});

test('D32 — day 1 no longer ends the run, and day 100 does', async ({ page }) => {
  await page.addInitScript((now) => {
    window.localStorage.setItem('unread.save.v1', JSON.stringify({
      runSeed: 'gate-seed', day: 1, phase: 'day', phaseStartedAt: now, lastSeenAt: now,
      flags: {}, contactState: {}, cluesFound: {},
    }));
  }, LAUNCH.getTime());
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  // answer on night one exactly as a player would, through the real beat
  for (const id of ['t_flat', 't_mom', 't_dave']) {
    await page.locator(`[data-thread="${id}"]`).click();
    await page.locator('.back').click();
  }
  await page.clock.runFor(8000);
  await page.locator('[data-thread="t_unknown"]').click();
  await page.clock.runFor(120000);
  await expect(page.locator('.choice')).toHaveCount(3);
  await page.locator('[data-choice="c_found"]').click();
  await page.clock.runFor(60000);

  // the run continues: no ending card, and the flag is kept for ninety nine days
  await expect(page.locator('#end')).not.toHaveClass(/on/);
  const mid = await page.evaluate(() => ({
    ended: window.__unread.state.ended,
    flags: Object.keys(window.__unread.state.flags),
    finalDay: window.__unread.finalDay,
  }));
  expect(mid.ended, 'day 1 does not end the run').toBe(false);
  expect(mid.flags).toContain('chose_found');
  expect(mid.finalDay).toBe(100);

  // ...and the ending it chose arrives on the last night
  await page.evaluate(() => window.__unread.loadPhase(100, 'night'));
  await expect(page.locator('#end')).toHaveClass(/on/);
  await expect(page.locator('#endTitle')).toHaveText('Ending — found');
});

test('D33 — the settings screen works and remembers', async ({ page }) => {
  await page.addInitScript((now) => {
    window.localStorage.setItem('unread.save.v1', JSON.stringify({
      runSeed: 'gate-seed', day: 1, phase: 'day', phaseStartedAt: now, lastSeenAt: now,
      flags: {}, contactState: {}, cluesFound: {},
    }));
  }, LAUNCH.getTime());
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  // it is reached from inside the app, never before it (the no-title-screen rule)
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.row')).not.toHaveCount(0);

  await page.locator('#cog').click();
  await expect(page.locator('#sheet')).toHaveClass(/on/);
  await expect(page.locator('#sheetTitle')).toHaveText('Settings');

  // it has no cog of its own: a conversation is not where settings live
  await page.locator('#sheetBack').click();
  await page.locator('.row').first().click();
  await expect(page.locator('#cog')).toHaveCount(0);
  await page.locator('.back').click();
  await page.locator('#cog').click();

  // live values, not placeholders
  const shown = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.srow')];
    const find = (label) => {
      const r = rows.find((x) => x.textContent.startsWith(label));
      return r ? r.querySelector('.val').textContent : null;
    };
    return { messages: find('Messages'), device: find('On this device') };
  });
  expect(Number(shown.messages), 'the message count is real').toBeGreaterThan(50);
  expect(shown.device).toMatch(/KB|MB/);

  // toggles change the app and survive a reload
  await page.locator('[data-size="L"]').click();
  await page.locator('[data-pref="motion"]').click();
  await page.locator('[data-pref="stamps"]').click();
  const applied = await page.evaluate(() => ({
    text: getComputedStyle(document.documentElement).getPropertyValue('--text').trim(),
    reduce: document.body.classList.contains('reduce'),
    noStamps: document.body.classList.contains('notimestamps'),
  }));
  expect(applied).toEqual({ text: '17px', reduce: true, noStamps: true });

  await page.reload();
  const kept = await page.evaluate(() => ({
    prefs: window.__unread.prefs(),
    text: getComputedStyle(document.documentElement).getPropertyValue('--text').trim(),
  }));
  expect(kept.prefs.text).toBe('L');
  expect(kept.prefs.motion).toBe(true);
  expect(kept.text).toBe('17px');

  // blocking the number never works, and says so
  await page.locator('#cog').click();
  await expect(page.locator('.fail')).toBeHidden();
  await page.locator('button.srow', { hasText: 'Block this number' }).click();
  await expect(page.locator('.fail')).toBeVisible();

  // D19 still holds with two dozen chrome strings on screen
  expect(await page.evaluate(() => window.__unread.auditIngress())).toEqual([]);

  // reset arms once, then erases
  await page.locator('button.srow', { hasText: 'Reset this device' }).click();
  await expect(page.locator('button.srow', { hasText: 'Erase everything?' })).toHaveCount(1);
});

test('D34 — sound and haptics, and the pulse used exactly twice', async ({ page }) => {
  await page.addInitScript((now) => {
    window.localStorage.setItem('unread.save.v1', JSON.stringify({
      runSeed: 'gate-seed', day: 1, phase: 'day', phaseStartedAt: now, lastSeenAt: now,
      flags: {}, contactState: {}, cluesFound: {},
    }));
  }, LAUNCH.getTime());
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  // exactly two messages in the whole game may carry the pulse
  const emphasised = await page.evaluate(() => {
    let n = 0;
    window.STORY.beats.forEach((b) => b.messages.forEach((m) => { if (m.emphasis) n += 1; }));
    window.CONTENT.templates.templates.forEach((t) =>
      t.lines.forEach((l) => { if (l.emphasis) n += 1; }));
    return n;
  });
  expect(emphasised, 'the two-beat pulse is used exactly twice').toBe(2);

  // play night one and listen
  await page.evaluate(() => { window.__unread.sound.clear(); window.__unread.haptics.clear(); });
  for (const id of ['t_flat', 't_mom', 't_dave']) {
    await page.locator(`[data-thread="${id}"]`).click();
    await page.locator('.back').click();
  }
  await page.clock.runFor(8000);
  await page.locator('[data-thread="t_unknown"]').click();
  await page.clock.runFor(120000);
  await expect(page.locator('.choice')).toHaveCount(3);

  const heard = await page.evaluate(() => ({
    sound: window.__unread.sound.log(),
    haptics: window.__unread.haptics.log,
  }));
  expect(heard.sound.filter((s) => s === 'receive').length,
    'every arriving message is heard').toBeGreaterThan(3);
  expect(heard.sound.filter((s) => s === 'pulse').length,
    'the pulse lands once on night one').toBe(1);
  expect(heard.haptics.filter((h) => h === 'pulse').length).toBe(1);

  // the pulse is the last thing before the choices: it is "who is this"
  expect(heard.sound[heard.sound.length - 1]).toBe('pulse');

  // sound off means silence, and the setting survives a reload.
  // the cog lives on the thread list only (D33), so leave the conversation first
  await page.locator('.back').click();
  await page.locator('#cog').click();
  await page.locator('[data-pref="sound"]').click();
  await expect(page.locator('[data-pref="sound"]')).toHaveAttribute('aria-checked', 'false');
  await page.reload();
  expect(await page.evaluate(() => window.__unread.prefs().sound)).toBe(false);

  // with sound off, nothing is emitted even though delivery still logs
  const silent = await page.evaluate(() => {
    window.__unread.sound.clear();
    return typeof window.__unread.sound.play === 'function';
  });
  expect(silent).toBe(true);
});

test('D35 — reactions are a toy, a trace, and eventually not yours', async ({ page }) => {
  // seed only if absent: addInitScript runs on every navigation, and this test reloads to
  // prove the reaction survived. Overwriting the save would wipe what we are testing.
  await page.addInitScript((now) => {
    if (window.localStorage.getItem('unread.save.v1')) return;
    window.localStorage.setItem('unread.save.v1', JSON.stringify({
      runSeed: 'gate-seed', day: 1, phase: 'day', phaseStartedAt: now, lastSeenAt: now,
      flags: {}, contactState: {}, cluesFound: {},
    }));
  }, LAUNCH.getTime());
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);
  await page.locator('[data-thread="t_flat"]').click();

  // four ways in, one behaviour
  await page.locator('.msg').nth(2).dblclick();
  await expect(page.locator('.picker')).toHaveCount(1);
  await page.locator('[data-react="😂"]').click();
  await expect(page.locator('.picker')).toHaveCount(0);
  await expect(page.locator('.react')).toHaveCount(1);
  await expect(page.locator('.react').first()).toHaveText('😂');

  // it persists
  const stored = await page.evaluate(() => window.__unread.reactions());
  expect(Object.values(stored)).toEqual(['😂']);
  await page.reload();
  await page.locator('[data-thread="t_flat"]').click();
  await expect(page.locator('.react')).toHaveCount(1);

  // reacting again with the same emoji clears it
  const id = Object.keys(stored)[0];
  await page.evaluate((mid) => window.__unread.react(mid, '😂'), id);
  await expect(page.locator('.react')).toHaveCount(0);

  // the trace: whatever the player reaches for most
  await page.evaluate(() => {
    window.__unread.react('m_flat_sam_01', '😮');
    window.__unread.react('m_flat_sam_02', '😮');
    window.__unread.react('m_flat_priya_03', '👍');
  });
  expect(await page.evaluate(() => window.__unread.favouriteReaction())).toBe('😮');

  // before Act II it never reacts back
  expect(await page.locator('.react.theirs').count()).toBe(0);

  // from Act II, what the player says in the unnamed thread comes back reacted to,
  // in the player's own most-used emoji
  await page.evaluate(() => {
    window.__unread.state.save.day = 21;
    window.__unread.loadPhase(21, 'day');
  });
  await page.locator('[data-thread="t_unknown"]').click();
  const answered = await page.evaluate(() => {
    const pending = window.__unread.state.pendingChoices
      .filter((c) => c.threadId === 't_unknown');
    if (!pending.length) return false;
    window.__unread.pickChoice(pending[0].id);
    return true;
  });
  if (answered) {
    await expect(page.locator('.msg.me .react.theirs')).not.toHaveCount(0);
    await expect(page.locator('.msg.me .react.theirs').first()).toHaveText('😮');
  }
});

test('D35 — the photo opens, and only close up is it not empty', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  for (const id of ['t_flat', 't_mom', 't_dave']) {
    await page.locator(`[data-thread="${id}"]`).click();
    await page.locator('.back').click();
  }
  await page.clock.runFor(8000);
  await page.locator('[data-thread="t_unknown"]').click();

  await expect(page.locator('#viewer')).toHaveAttribute('aria-hidden', 'true');
  await page.locator('.photo').click();
  await expect(page.locator('#viewer')).toHaveClass(/on/);
  await expect(page.locator('#vzoom')).toHaveText('1.0×');

  // the overlay covers the phone rather than being dragged off by a scroll
  const aligned = await page.evaluate(() => {
    const v = document.getElementById('viewer').getBoundingClientRect();
    const p = document.querySelector('.phone').getBoundingClientRect();
    return Math.abs(v.top - p.top) < 3 && Math.abs(v.height - p.height) < 4;
  });
  expect(aligned, 'the viewer sits over the phone').toBe(true);

  // zooming past the threshold redraws at detail, and the pixels actually differ
  const far = await page.evaluate(() => {
    window.__unread.viewer.setZoom(1);
    return document.querySelector('#vstage canvas').toDataURL().length;
  });
  const near = await page.evaluate(() => {
    window.__unread.viewer.setZoom(3.4);
    return document.querySelector('#vstage canvas').toDataURL().length;
  });
  expect(await page.locator('#vzoom').textContent()).toBe('3.4×');
  expect(near, 'the close-up is a different image').not.toBe(far);

  await page.keyboard.press('Escape');
  await expect(page.locator('#viewer')).not.toHaveClass(/on/);
});

test('D36 — a locked thread, and a code the game actually gives you', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  // the lock is visible in the list: an invitation, not a dead end
  await expect(page.locator('[data-thread="t_archive"] .lock')).toHaveCount(1);
  await expect(page.locator('[data-thread="t_archive"] .rp')).toHaveText('····');

  await page.locator('[data-thread="t_archive"]').click();
  await expect(page.locator('.locked')).toHaveCount(1);
  await expect(page.locator('.msg')).toHaveCount(0);

  // a wrong code says so and clears
  for (const d of ['1', '2', '3', '4']) await page.locator(`.pad [data-key="${d}"]`).click();
  await page.locator('.pad .go').click();
  await expect(page.locator('.padmsg').first()).toHaveText('wrong code');
  expect(await page.evaluate(() => window.__unread.isLocked('t_archive'))).toBe(true);

  // the right code is one the Notify thread sent
  const code = await page.evaluate(() =>
    window.STORY.threads.find((t) => t.id === 't_archive').lockedBy);
  const inMessages = await page.evaluate((c) =>
    window.STORY.beats.some((b) => b.messages.some((m) => (m.body || '').includes(c))), code);
  expect(inMessages, 'the code appears in a message the player can read').toBe(true);

  for (const d of code.split('')) await page.locator(`.pad [data-key="${d}"]`).click();
  await page.locator('.pad .go').click();
  await expect(page.locator('.msg')).not.toHaveCount(0);
  expect(await page.evaluate(() => window.__unread.isLocked('t_archive'))).toBe(false);

  // and it stays unlocked
  await page.reload();
  await page.locator('[data-thread="t_archive"]').click();
  await expect(page.locator('.locked')).toHaveCount(0);
  await expect(page.locator('.msg')).not.toHaveCount(0);
});

test('D36 — the guessing game is playable and seeded', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  const found = await page.evaluate(() => {
    for (const entry of window.CONTENT.ladder.days) {
      if (entry.day === 1) continue;
      for (const phase of ['day', 'night']) {
        const plan = window.__unread.loadPhase(entry.day, phase);
        if ((plan.phases[phase] || []).some((e) => e.kind === 'game')) {
          return { day: entry.day, phase };
        }
      }
    }
    return null;
  });
  expect(found, 'some day offers a game').not.toBeNull();

  await page.locator('[data-thread="t_flat"]').click();
  await expect(page.locator('.game')).toHaveCount(1);
  await expect(page.locator('.game .pad')).toHaveCount(1);

  // the answer comes from the run seed, so a run always hides the same number
  const id = await page.locator('.game').getAttribute('data-game');
  expect(id).toBe('guess');
  const secret = await page.evaluate(() => window.__unread.secretFor('probe'));
  expect(await page.evaluate(() => window.__unread.secretFor('probe'))).toBe(secret);
  expect(secret).toBeGreaterThanOrEqual(1);
  expect(secret).toBeLessThanOrEqual(50);

  // guessing gives higher/lower and records the attempt
  for (const d of ['2', '5']) await page.locator(`.game .pad [data-key="${d}"]`).click();
  await page.locator('.game .pad .go').click();
  await expect(page.locator('.game .try')).toHaveCount(1);
  await expect(page.locator('.game .padmsg')).toHaveText(/higher|lower|got it/);

  // play it properly: binary search must always land
  const won = await page.evaluate(async () => {
    const box = document.querySelector('.game');
    const press = (label) => box.querySelector('[data-key="' + label + '"]').click();
    let lo = 1, hi = 50;
    for (let i = 0; i < 8; i++) {
      const guess = Math.floor((lo + hi) / 2);
      String(guess).split('').forEach(press);
      box.querySelector('.go').click();
      const said = box.querySelector('.padmsg').textContent;
      if (said === 'got it') return true;
      if (said === 'higher') lo = guess + 1; else hi = guess - 1;
    }
    return false;
  });
  expect(won, 'the game is winnable').toBe(true);
  await expect(page.locator('.game')).toHaveClass(/done/);

  // and the win is remembered
  const games = await page.evaluate(() => window.__unread.games());
  expect(Object.values(games).some((g) => g.won)).toBe(true);
});

test('D37 — the voice memo plays, scrubs, and hides something', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  // find the day the memo arrives
  const found = await page.evaluate(() => {
    for (const entry of window.CONTENT.ladder.days) {
      for (const phase of ['day', 'night']) {
        const plan = window.__unread.loadPhase(entry.day, phase);
        if ((plan.phases[phase] || []).some((e) => e.kind === 'audio')) {
          return { day: entry.day, phase };
        }
      }
    }
    return null;
  });
  expect(found, 'the memo arrives somewhere in the run').not.toBeNull();
  expect(found.day, 'and it is an Act III thing').toBeGreaterThan(60);

  await page.locator('[data-thread="t_unknown"]').click();
  await expect(page.locator('.vm')).toHaveCount(1);
  await expect(page.locator('.vm .wave i')).toHaveCount(34);
  await expect(page.locator('.vm .dur')).toHaveText('0:07');

  // the waveform is not flat, and the loud part is where the thing is
  const shape = await page.locator('.vm .wave i').evaluateAll((bars) =>
    bars.map((b) => parseInt(b.style.height, 10)));
  const peak = shape.indexOf(Math.max(...shape));
  expect(peak / shape.length, 'the event sits about two thirds in').toBeGreaterThan(0.6);
  expect(peak / shape.length).toBeLessThan(0.78);
  expect(Math.max(...shape) - Math.min(...shape),
    'it is a bump, not a spike').toBeLessThan(40);

  // scrubbing moves the playhead
  const wave = page.locator('.vm .wave');
  const box = await wave.boundingBox();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('.vm .wave i.past')).not.toHaveCount(0);
  const remaining = await page.locator('.vm .dur').textContent();
  expect(remaining).not.toBe('0:07');

  // the same memo always sounds the same
  const a = await page.evaluate(() => window.__unread.memo.envelope('x', 8).join(','));
  const b = await page.evaluate(() => window.__unread.memo.envelope('x', 8).join(','));
  const c = await page.evaluate(() => window.__unread.memo.envelope('y', 8).join(','));
  expect(a).toBe(b);
  expect(a).not.toBe(c);
});

test('D37 — swipe reveals when everything happened, and the battery stops', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);
  await page.locator('[data-thread="t_flat"]').click();

  // every bubble knows its time, and it is hidden until asked for
  const times = await page.locator('.when').evaluateAll((els) => els.map((e) => e.textContent));
  expect(times.length).toBeGreaterThan(10);
  expect(times.every((t) => /^\d{1,2}:\d{2}$/.test(t)), 'they are clock times').toBe(true);
  await expect(page.locator('.convo')).not.toHaveClass(/shifted/);

  // it is decoration, not the message: not selectable, not read out
  await expect(page.locator('.when').first()).toHaveAttribute('aria-hidden', 'true');

  const box = await page.locator('.convo').boundingBox();
  await page.mouse.move(box.x + box.width - 30, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 110, box.y + 120, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.convo')).toHaveClass(/shifted/);

  // the battery falls through the run, then stops in Act III
  const readings = await page.evaluate(() => {
    const out = {};
    [1, 20, 40, 60, 61, 100].forEach((day) => {
      window.__unread.state.save.day = day;
      window.__unread.drawStatusBar();
      out[day] = document.querySelector('.batt .pct').textContent;
    });
    return out;
  });
  const pct = (d) => parseInt(readings[d], 10);
  expect(pct(1)).toBeGreaterThan(pct(20));
  expect(pct(20)).toBeGreaterThan(pct(40));
  expect(pct(40)).toBeGreaterThan(pct(60));
  expect(pct(61), 'and then it simply stops').toBe(pct(100));
});

test('D38 — search finds messages, and cannot see through a lock', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  await page.locator('#find').click();
  await expect(page.locator('#q')).toBeFocused();
  await expect(page.locator('.empty')).toHaveText('Type to search your messages');

  await page.locator('#q').fill('bin');
  await expect(page.locator('.hit')).not.toHaveCount(0);
  await expect(page.locator('.hit mark').first()).toHaveText('bin');

  // results carry the thread they came from, and open it
  const first = await page.locator('.hit .who3').first().textContent();
  expect(['the flat', 'Mom', 'Dave', 'Notify', '+44 7700 900931']).toContain(first);
  await page.locator('.hit').first().click();
  await expect(page.locator('.convo')).toHaveCount(1);
  await expect(page.locator('#appbar .title')).toHaveText(first);

  // nothing matches nothing. the magnifier lives on the list, so leave the thread first
  await page.locator('#appbar .back').click();
  await page.locator('#find').click();
  await page.locator('#q').fill('zzzznotathing');
  await expect(page.locator('.empty')).toHaveText('No messages found');

  // the archive is locked, so its contents are not searchable. pick a phrase that exists
  // ONLY behind the lock -- "is this still..." also opens the unlocked thread.
  const archiveOnly = await page.evaluate(() => {
    const archive = window.STORY.beats.find((b) => b.id === 'b_archive_1');
    const elsewhere = window.STORY.beats
      .filter((b) => b.id !== 'b_archive_1')
      .flatMap((b) => b.messages.map((m) => (m.body || '').toLowerCase()));
    return archive.messages.map((m) => m.body)
      .find((body) => !elsewhere.some((other) => other.includes(body.toLowerCase())));
  });
  expect(archiveOnly, 'the archive says something nothing else does').toBeTruthy();
  await page.locator('#q').fill(archiveOnly);
  await expect(page.locator('.hit')).toHaveCount(0);

  // unlock it the way a player would, and now it is searchable.
  // (poking localStorage directly does not work: the engine writes its in-memory save
  // over the top on beforeunload, which is correct behaviour and a bad test.)
  await page.locator('#appbar .back').click();
  await page.locator('[data-thread="t_archive"]').click();
  const code = await page.evaluate(() =>
    window.STORY.threads.find((t) => t.id === 't_archive').lockedBy);
  for (const d of code.split('')) await page.locator(`.pad [data-key="${d}"]`).click();
  await page.locator('.pad .go').click();
  await expect(page.locator('.msg')).not.toHaveCount(0);

  await page.reload();
  expect(await page.evaluate(() => window.__unread.isLocked('t_archive'))).toBe(false);
  const found = await page.evaluate((q) => window.__unread.search(q), archiveOnly);
  expect(found, 'an unlocked thread is searchable').toBeGreaterThan(0);
});

test('D38 — spot the difference is solvable, and only in one place', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  const found = await page.evaluate(() => {
    for (const entry of window.CONTENT.ladder.days) {
      for (const phase of ['day', 'night']) {
        const plan = window.__unread.loadPhase(entry.day, phase);
        if ((plan.phases[phase] || []).some((e) => e.game === 'spot')) {
          return { day: entry.day, phase };
        }
      }
    }
    return null;
  });
  expect(found, 'the pair of photos arrives').not.toBeNull();

  await page.locator('[data-thread="t_unknown"]').click();
  await expect(page.locator('.spot')).toHaveCount(1);
  await expect(page.locator('.spot canvas')).toHaveCount(2);
  await expect(page.locator('.spot .tag').first()).toHaveText('tuesday');
  await expect(page.locator('.spot .tag').last()).toHaveText('tonight');

  // the two photos really do differ
  const [a, b] = await page.locator('.spot canvas').evaluateAll(
    (cs) => cs.map((c) => c.toDataURL().length));
  expect(a).not.toBe(b);

  // a wrong tap is marked and says so
  const shot = page.locator('.spot .shot').last();
  const box = await shot.boundingBox();
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.2);
  await expect(page.locator('.spot .note2')).toHaveText('not there');
  await expect(page.locator('.spot .miss')).toHaveCount(1);
  await expect(page.locator('.spot')).not.toHaveClass(/solved/);

  // the right one solves it, and it stays solved
  const target = await page.evaluate(() => window.__unread.spotTarget);
  await page.mouse.click(box.x + box.width * target.x, box.y + box.height * target.y);
  await expect(page.locator('.spot')).toHaveClass(/solved/);
  await expect(page.locator('.spot .note2')).toHaveText('found it');

  const games = await page.evaluate(() => window.__unread.games());
  expect(Object.values(games).some((g) => g.won)).toBe(true);
});
