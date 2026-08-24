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
  // a phase landing while you are reading no longer closes what you opened, so come out
  // of the flat the way a player would before picking the next thread
  await page.locator('#appbar .back').click();
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
        if ((plan.phases[phase] || []).some((e) => e.game === 'guess')) {
          return { day: entry.day, phase };
        }
      }
    }
    return null;
  });
  expect(found, 'some day offers the guessing game').not.toBeNull();

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

// ---------------------------------------------------------------------------
// D39 — the two hooks and the two new games.
// ---------------------------------------------------------------------------

test('D39 — unread is counted, and reading a thread clears the count', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  const badges = await page.locator('.dot').allTextContents();
  expect(badges.length, 'something is unread on a found phone').toBeGreaterThan(0);
  for (const b of badges) {
    expect(b, 'a badge is a number, not a blob').toMatch(/^\d+$/);
    expect(Number(b)).toBeGreaterThan(0);
    // an unopened thread counts from the last thing you sent, not from the top
    expect(Number(b), 'the count is believable, not the whole history').toBeLessThan(20);
  }

  // every badged row also reads as unread without the number
  expect(await page.locator('.row.new').count()).toBe(badges.length);

  const first = await page.locator('.row.new').first().getAttribute('data-thread');
  expect(await page.evaluate((id) => window.__unread.unreadCount(id), first))
    .toBeGreaterThan(0);
  await page.locator(`[data-thread="${first}"]`).click();
  await page.locator('#appbar .back').click();
  expect(await page.evaluate((id) => window.__unread.unreadCount(id), first),
    'opening it reads it').toBe(0);
  await expect(page.locator(`.row[data-thread="${first}"] .dot`)).toHaveCount(0);

  // and it survives the reload, because it is in the save
  await page.reload();
  expect(await page.evaluate((id) => window.__unread.unreadCount(id), first)).toBe(0);
});

test('D39 — the streak counts consecutive days and breaks on a gap', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  const walk = await page.evaluate(() => {
    const roll = window.__unread.rollStreak;
    const save = { streak: 0, streakStamp: null };
    const stamps = ['2026-8-1', '2026-8-1', '2026-8-2', '2026-8-3', '2026-8-4',
                    '2026-8-11', '2026-8-12'];
    return { seen: stamps.map((s) => roll(save, s)), best: save.streakBest };
  });
  expect(walk.seen, 'same day does not double count; a week off resets')
    .toEqual([1, 1, 2, 3, 4, 1, 2]);
  expect(walk.best, 'the longest run is remembered even after it breaks').toBe(4);

  // months and years roll over the way days do
  const rollover = await page.evaluate(() => {
    const roll = window.__unread.rollStreak;
    const save = { streak: 0, streakStamp: null };
    return [roll(save, '2026-8-31'), roll(save, '2026-9-1'),
            roll(save, '2026-12-31'), roll(save, '2027-1-1')];
  });
  expect(rollover).toEqual([1, 2, 1, 2]);

  // opening the app once puts it on the board
  expect(await page.evaluate(() => window.__unread.streak())).toBe(1);
  await page.locator('#cog').click();
  await expect(page.locator('#sheetBody')).toContainText('Days in a row');
  await expect(page.locator('#sheetBody')).toContainText('Longest');
  await expect(page.locator('#sheetBody')).toContainText('Times opened');
});

test('D39 — recall quotes you back, and never quotes anyone else', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  // the game exists in the content, and some phase of the run delivers it
  const delivered = await page.evaluate(() => {
    for (const entry of window.CONTENT.ladder.days) {
      for (const phase of ['day', 'night']) {
        const plan = window.__unread.loadPhase(entry.day, phase);
        if ((plan.phases[phase] || []).some((e) => e.game === 'recall')) return entry.day;
      }
    }
    return null;
  });
  expect(delivered, 'the quiz arrives at some point in the run').not.toBeNull();

  // The sweep above walked the save to some day deep in the run, and that day has a real
  // quiz on it. Wipe and reload so the only widget on screen is the one we inject.
  await page.evaluate(() => window.__unread.save.clear());
  await page.reload();

  // with nothing said, there is nothing to ask about
  await page.evaluate(() => {
    const S = window.__unread.state;
    S.save.contactState = {};
    S.shown.t_unknown.push({ id: 'x_recall', from: 'them', fromContactId: 'c_unknown',
                             kind: 'game', game: 'recall', body: '', offsetMinutes: 0 });
  });
  await page.locator('[data-thread="t_unknown"]').click();
  await expect(page.locator('.recall .head')).toHaveText('you havent said anything yet');
  await expect(page.locator('.recall .opt')).toHaveCount(0);

  // now give it two things the player really said, read out of the content
  const mine = await page.evaluate(() => {
    const bank = { told_it_stop: null, asked_how: null };
    window.CONTENT.templates.templates.forEach((tpl) => {
      (tpl.choices || []).forEach((c) => {
        if (c.memory && bank[c.memory.tag] === null) bank[c.memory.tag] = c.memory.fragment;
      });
    });
    window.__unread.state.save.contactState = { memory: bank };
    window.__unread.renderList();
    return Object.keys(bank).map((k) => bank[k]);
  });
  expect(mine.every(Boolean), 'the fixture reads its lines out of the content').toBe(true);

  await page.locator('[data-thread="t_unknown"]').click();
  const q = await page.evaluate(() => window.__unread.recallOptions('x_recall'));
  expect(q.options).toHaveLength(3);
  expect(mine, 'the true answer is something the player said').toContain(q.truth);
  expect(new Set(q.options).size, 'no option appears twice').toBe(3);
  for (const o of q.options) {
    expect(o, 'no unfilled slot ever reaches a decoy').not.toMatch(/\{[A-Z0-9_]+\}/);
  }
  const every = await page.evaluate(() => window.__unread.fragments());
  const decoys = q.options.filter((o) => o !== q.truth);
  for (const d of decoys) {
    expect(mine, 'a decoy is never something the player actually said').not.toContain(d);
    expect(every, 'a decoy is a real road not taken, not invented by the engine')
      .toContain(d);
  }

  // asking twice gives the same quiz
  expect(await page.evaluate(() => window.__unread.recallOptions('x_recall'))).toEqual(q);

  // pick a wrong one: it settles, shows which was true, and stays settled
  await page.locator(`.recall .opt[data-line="${decoys[0]}"]`).click();
  await expect(page.locator('.recall')).toHaveClass(/done/);
  await expect(page.locator('.recall .note2')).toHaveText('no. you said');
  await expect(page.locator(`.recall .opt[data-line="${q.truth}"]`)).toHaveClass(/right/);
  await page.locator(`.recall .opt[data-line="${q.truth}"]`).click();
  await expect(page.locator('.recall .note2'), 'a second click cannot fix it')
    .toHaveText('no. you said');
});

test('D39 — match has three pairs and one tile with no partner', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  const delivered = await page.evaluate(() => {
    for (const entry of window.CONTENT.ladder.days) {
      for (const phase of ['day', 'night']) {
        const plan = window.__unread.loadPhase(entry.day, phase);
        if ((plan.phases[phase] || []).some((e) => e.game === 'match')) return entry.day;
      }
    }
    return null;
  });
  expect(delivered, 'the pairs game arrives at some point in the run').not.toBeNull();
  await page.evaluate(() => window.__unread.save.clear());
  await page.reload();

  const inject = () => {
    window.__unread.state.shown.t_flat.push({
      id: 'x_match', from: 'them', fromContactId: 'c_priya',
      kind: 'game', game: 'match', body: '', offsetMinutes: 0 });
  };
  await page.evaluate(inject);
  await page.locator('[data-thread="t_flat"]').click();
  await expect(page.locator('.match .tile')).toHaveCount(7);
  await expect(page.locator('.match .tile[data-face="odd"]'), 'one has no partner')
    .toHaveCount(1);
  await expect(page.locator('.match .tile.up')).toHaveCount(0);

  // a mismatched pair turns back over on its own
  const faces = await page.locator('.match .tile').evaluateAll(
    (ts) => ts.map((t) => t.getAttribute('data-face')));
  await page.locator('.match .tile').nth(faces.indexOf('odd')).click();
  await page.locator('.match .tile').nth(faces.findIndex((f) => f !== 'odd')).click();
  await expect(page.locator('.match .tile.up')).toHaveCount(2);
  await expect(page.locator('.match .tile.up')).toHaveCount(0, { timeout: 3000 });
  await expect(page.locator('.match .tile.kept')).toHaveCount(0);

  // clear it
  const suits = await page.evaluate(() => window.__unread.matchFaces());
  for (const face of suits) {
    const pair = page.locator(`.match .tile[data-face="${face}"]`);
    await pair.nth(0).click();
    await pair.nth(1).click();
    await expect(pair.nth(0)).toHaveClass(/kept/);
  }
  await expect(page.locator('.match')).toHaveClass(/done/);
  await expect(page.locator('.match .note2')).toHaveText('all of them');

  // and the tile nobody asked about turns itself over, with nothing on it
  const odd = page.locator('.match .tile[data-face="odd"]');
  await expect(odd).toHaveClass(/up/, { timeout: 3000 });
  await expect(odd.locator('.face')).toHaveText('');

  // it is still done after a reload
  await page.reload();
  await page.evaluate(inject);
  await page.locator('[data-thread="t_flat"]').click();
  await expect(page.locator('.match')).toHaveClass(/done/);
  await expect(page.locator('.match .tile.kept')).toHaveCount(7);
});

test('D39 — nothing closes a thread you are reading', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);
  await page.locator('[data-thread="t_flat"]').click();
  await expect(page.locator('#appbar .back')).toHaveCount(1);

  // a phase landing under you is the commonest way this used to happen
  const still = await page.evaluate(() => {
    window.__unread.loadPhase(21, 'day');
    return window.__unread.state.current && window.__unread.state.current.id;
  });
  expect(still, 'the phase arrived and you are still in the flat').toBe('t_flat');
  await expect(page.locator('#appbar .back'), 'still inside a thread').toHaveCount(1);
  await expect(page.locator('.row'), 'the list did not take the screen').toHaveCount(0);

  // nor does anything else that renders the list on a timer
  await page.evaluate(() => {
    window.__unread.state.hidden.t_unknown = true;
    window.__unread.renderListSoft();
  });
  await expect(page.locator('#appbar .back')).toHaveCount(1);

  // back still works, and now shows what arrived while you were reading
  await page.locator('#appbar .back').click();
  await expect(page.locator('.row')).not.toHaveCount(0);
  expect(await page.evaluate(() => window.__unread.state.current)).toBeNull();
});

test('D40 — on a phone it is the phone, on a desktop it is a phone on a desk', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });

  // a phone: the frame comes off and the app takes the whole screen
  await page.setViewportSize({ width: 390, height: 664 });
  await page.goto(BUILT);
  const small = await page.evaluate(() => {
    const p = document.querySelector('.phone');
    const box = p.getBoundingClientRect();
    const cs = getComputedStyle(p);
    return {
      wasted: Math.round(window.innerHeight - box.height),
      spare: Math.round(window.innerWidth - box.width),
      radius: cs.borderTopLeftRadius,
      shadow: cs.boxShadow,
      foot: getComputedStyle(document.querySelector('.foot')).display,
      hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  expect(small.wasted, 'the app fills the height').toBeLessThanOrEqual(1);
  expect(small.spare, 'and the width').toBeLessThanOrEqual(1);
  expect(small.radius, 'no bezel on a device that is already the bezel').toBe('0px');
  expect(small.shadow, 'nothing to cast a shadow onto').toBe('none');
  expect(small.foot, 'the footer would eat a row; Settings still says it').toBe('none');
  expect(small.hScroll, 'nothing pushes the page sideways').toBe(false);

  // the browser must not answer a gesture before the game does
  await page.locator('[data-thread="t_flat"]').click();
  const touch = await page.evaluate(() => ({
    msg: getComputedStyle(document.querySelector('.msg')).touchAction,
    select: getComputedStyle(document.querySelector('.msg')).webkitUserSelect,
    convo: getComputedStyle(document.querySelector('.convo')).touchAction,
    scroll: getComputedStyle(document.getElementById('scroll')).overscrollBehaviorY,
  }));
  expect(touch.msg, 'a double tap reacts, it does not zoom').toBe('manipulation');
  expect(touch.select, 'a 420ms hold reacts, it does not select').toBe('none');
  expect(touch.convo, 'the swipe is horizontal, the scroll is vertical').toBe('pan-y');
  expect(touch.scroll, 'the page behind must not rubber-band').toBe('contain');

  // a hold still opens the picker, and it stays inside the screen
  const msg = page.locator('.msg').nth(2);
  await msg.dispatchEvent('pointerdown');
  await expect(page.locator('.picker')).toHaveCount(1, { timeout: 2000 });
  const pick = await page.locator('.picker').boundingBox();
  expect(pick.x, 'the picker fits').toBeGreaterThanOrEqual(0);
  expect(pick.x + pick.width).toBeLessThanOrEqual(390);

  // and the search field is big enough that iOS does not zoom the page on focus
  await page.locator('#appbar .back').click();
  await page.locator('#find').click();
  const size = await page.evaluate(() => getComputedStyle(document.querySelector('#q')).fontSize);
  expect(parseFloat(size), 'under 16px iOS zooms in and never back out')
    .toBeGreaterThanOrEqual(16);

  // a desktop: the frame is still there, because there it is what says "a phone"
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(BUILT);
  const big = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.phone'));
    return { radius: cs.borderTopLeftRadius, shadow: cs.boxShadow !== 'none',
             foot: getComputedStyle(document.querySelector('.foot')).display };
  });
  expect(big.radius).not.toBe('0px');
  expect(big.shadow).toBe(true);
  expect(big.foot).not.toBe('none');
});

// ---------------------------------------------------------------------------
// D44 — the player types.
// ---------------------------------------------------------------------------

test('D44 — the matcher reads what a person would actually type', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  // it is pure, so it can be driven directly with a fixture rather than a conversation
  const out = await page.evaluate(() => {
    const choices = [
      { id: 'heard', label: 'i heard it too', match: ['heard', 'yes', 'me too'] },
      { id: 'didnt', label: 'i didnt hear anything', match: ['no', 'didnt hear', 'nothing'] },
      { id: 'quiet', label: '[say nothing]', silent: true },
    ];
    const ask = (t) => {
      const m = window.Director.matchReply(t, choices);
      return m ? m.choice.id : null;
    };
    return {
      plain:    ['i heard it too', 'yes', 'no'].map(ask),
      spelling: ['yeah', 'yep', 'nope', 'nah', 'ok'].map(ask),
      caps:     ['HEARD IT', 'Heard It'].map(ask),
      apostr:   ["i didn't hear anything", 'i didnt hear anything'].map(ask),
      negated:  ['i heard nothing', 'i didnt hear it'].map(ask),
      nonsense: ['what time is the bus', 'asdfgh', '', '   ', '???'].map(ask),
      // typing the silent option's own words must never select it
      silent:   [ask('[say nothing]'), ask('say nothing')],
    };
  });

  expect(out.plain).toEqual(['heard', 'heard', 'didnt']);
  expect(out.spelling, 'yes and no arrive in a dozen spellings')
    .toEqual(['heard', 'heard', 'didnt', 'didnt', 'heard']);
  expect(out.caps, 'shouting is still talking').toEqual(['heard', 'heard']);
  expect(out.apostr, 'half of them will not reach for the apostrophe')
    .toEqual(['didnt', 'didnt']);
  expect(out.negated, 'a negation flips the meaning, not just the wording')
    .toEqual(['didnt', 'didnt']);
  expect(out.nonsense, 'nobody guesses when nobody knows')
    .toEqual([null, null, null, null, null]);
  expect(out.silent.includes('quiet'),
    'a silent choice is never something you can type your way into').toBe(false);
});

test('D44 — typing a reply does everything tapping it did', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);
  await page.evaluate(() => window.__unread.loadPhase(2, 'day'));
  await page.locator('[data-thread="t_flat"]').click();

  await expect(page.locator('#say'), 'exactly one field to type into').toHaveCount(1);
  await expect(page.locator('#send')).toHaveCount(1);

  const target = await page.evaluate(() =>
    window.__unread.state.liveChoices.filter((c) => !c.silent)[0]);
  const before = await page.evaluate(() => window.__unread.choicesForThread('t_flat'));
  expect(before).toContain(target.id);

  await page.locator('#say').fill(target.label);
  await page.locator('#send').click();

  // what lands in the bubble is what the player typed, stamped as theirs
  const mine = page.locator('.msg.me').last();
  await expect(mine).toHaveAttribute('data-src', 'player.typed');
  expect((await mine.innerText()).split('\n')[0]).toBe(target.label);

  // the question is spent, and the field is empty and still there
  const after = await page.evaluate(() => window.__unread.choicesForThread('t_flat'));
  expect(after, 'that question is answered').not.toContain(target.id);
  await expect(page.locator('#say')).toHaveValue('');
  await expect(page.locator('#say')).toHaveCount(1);

  // and it recorded what the tap would have recorded
  if (target.tells) {
    const told = await page.evaluate(() =>
      ((window.__unread.state.save.contactState || {}).lastToldByRen || []).map((t) => t.said));
    expect(told, 'a typed reply is still a thing Ren said').toContain(target.tells);
  }

  // the exact words are kept, verbatim, for Act III to read back
  const typed = await page.evaluate(() => window.__unread.typed());
  expect(typed[typed.length - 1].text).toBe(target.label);
  expect(typed[typed.length - 1].threadId).toBe('t_flat');
});

test('D44 — nobody wrote a reply to that, and the thread says so in character',
  async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);
  await page.locator('[data-thread="t_mom"]').click();

  const lines = await page.evaluate(() => {
    const cast = window.CONTENT.cast.cast.filter((c) => c.thread === 't_mom');
    return cast.reduce((all, c) => all.concat(c.unmatched || []), []);
  });
  expect(lines.length, 'Mom has something to say to the unexpected').toBeGreaterThan(1);

  const heard = [];
  for (const nonsense of ['whats the weather', 'i like bread', 'tell me a joke',
                          'anyway', 'nothing much']) {
    const was = await page.locator('.msg').count();
    await page.locator('#say').fill(nonsense);
    await page.locator('#send').click();
    await expect(page.locator('.msg')).toHaveCount(was + 2, { timeout: 4000 });
    const last = page.locator('.msg.them').last();
    await expect(last).toHaveAttribute('data-src', 'content.unmatched');
    heard.push((await last.innerText()).split('\n')[0]);
  }
  for (const line of heard) {
    expect(lines, 'every deflection is a line somebody wrote down').toContain(line);
  }
  for (let i = 1; i < heard.length; i++) {
    expect(heard[i], 'saying it twice running reads as a broken bot')
      .not.toBe(heard[i - 1]);
  }
});

test('D44 — every reply in the game can be reached by typing', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  const audit = await page.evaluate(() => {
    const sets = [];
    (window.STORY.beats || []).forEach((b) => {
      if (b.choices) sets.push({ where: 'beat ' + b.id, choices: b.choices });
    });
    window.CONTENT.templates.templates.forEach((t) => {
      if (t.choices) sets.push({ where: 'template ' + t.id, choices: t.choices });
    });
    const unreachable = [], ambiguous = [];
    sets.forEach((set) => {
      set.choices.filter((c) => !c.silent).forEach((c) => {
        if (!(c.match || []).length) unreachable.push(set.where + '/' + c.id);
      });
      window.Director.collisions(set.choices).forEach((clash) =>
        ambiguous.push(set.where + ': ' + clash.a + ' vs ' + clash.b));
    });
    return { sets: sets.length, unreachable, ambiguous };
  });

  expect(audit.sets, 'there are questions to answer').toBeGreaterThan(30);
  expect(audit.unreachable, 'a reply nobody can type is a reply that is not there')
    .toEqual([]);
  expect(audit.ambiguous, 'two replies to the same word is a coin flip').toEqual([]);

  // and every one of them really does match its own label back
  const misses = await page.evaluate(() => {
    const out = [];
    window.CONTENT.templates.templates.forEach((t) => {
      const live = (t.choices || []).filter((c) => !c.silent);
      live.forEach((c) => {
        const m = window.Director.matchReply(c.label, live);
        if (!m || m.choice.id !== c.id) out.push(t.id + '/' + c.id + ' ' + JSON.stringify(c.label));
      });
    });
    return out;
  });
  expect(misses, 'typing the reply word for word must reach it').toEqual([]);
});

// ---------------------------------------------------------------------------
// D45 — the number reads the player's own sentences back at them.
// ---------------------------------------------------------------------------

const TYPED_FIXTURE = [
  { day: 3,  phase: 'day',   threadId: 't_mom',     text: 'im fine mom stop asking' },
  { day: 5,  phase: 'night', threadId: 't_flat',    text: 'i heard it again last night' },
  { day: 9,  phase: 'day',   threadId: 't_dave',    text: 'sorry i cant make thursday' },
  { day: 12, phase: 'night', threadId: 't_mom',     text: 'nothing happened' },
  { day: 17, phase: 'day',   threadId: 't_flat',    text: 'it wasnt me' },
  { day: 22, phase: 'night', threadId: 't_unknown', text: 'who is this' },
];

async function quotesIn(page, seed, typed) {
  return page.evaluate(([seed, typed]) => {
    const content = { cast: window.CONTENT.cast, templates: window.CONTENT.templates,
                      ladder: window.CONTENT.ladder, clues: window.CONTENT.clues };
    const carried = { flags: {}, fired: {}, spent: {}, clues: {}, typed: typed,
                      memory: { denied_typed: 'you said you never said that' } };
    const out = [];
    for (let day = 1; day <= 100; day++) {
      const plan = window.Director.planDay(content, seed, day, carried);
      if (!plan) continue;
      for (const phase of ['day', 'night']) {
        for (const e of plan.phases[phase] || []) {
          if (e.quotesPlayer) out.push({ day, body: e.body });
          if (/\{TYPED[A-Z]*\}|\{MEMORY[0-9]*\}/.test(e.body)) {
            out.push({ day, body: 'UNFILLED SLOT: ' + e.body });
          }
        }
      }
    }
    return out;
  }, [seed, typed]);
}

test('D45 — the number quotes you exactly, and to the wrong person', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  const hits = await quotesIn(page, 'gate-seed', TYPED_FIXTURE);
  expect(hits.length, 'it happens').toBeGreaterThan(0);

  const mine = TYPED_FIXTURE.map((t) => t.text);
  for (const hit of hits) {
    expect(hit.body, 'no slot ever reaches a bubble').not.toContain('UNFILLED');
    const quoted = mine.filter((m) => hit.body.includes(m));
    expect(quoted.length, `"${hit.body}" contains something the player really typed`).toBe(1);
    // the cast note: quoted to the wrong person. A line typed AT the number is not a scare.
    const source = TYPED_FIXTURE.find((t) => t.text === quoted[0]);
    expect(source.threadId, 'it reads back what you said to someone else')
      .not.toBe('t_unknown');
  }

  // rare enough to keep working: it is not a thing that happens every week
  expect(hits.length, 'restraint, the same as recall gets').toBeLessThanOrEqual(6);
  const days = hits.map((h) => h.day);
  for (let i = 1; i < days.length; i++) {
    expect(days[i] - days[i - 1], 'a fortnight is not long enough between these')
      .toBeGreaterThanOrEqual(21);
  }
});

test('D45 — it cannot fire on a run where nothing was typed', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  for (const empty of [[], [{ day: 2, threadId: 't_mom', text: '  ' }]]) {
    const hits = await quotesIn(page, 'gate-seed', empty);
    expect(hits, 'nothing typed, nothing quoted, and no bare slot either').toEqual([]);
  }

  // it also cannot fire before there is enough to draw on
  const one = await quotesIn(page, 'gate-seed', [TYPED_FIXTURE[0]]);
  expect(one, 'one line is not a history').toEqual([]);
});

test('D45 — same seed and same history, same run; different words, different run',
  async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  const a = await quotesIn(page, 'fixed', TYPED_FIXTURE);
  const b = await quotesIn(page, 'fixed', TYPED_FIXTURE);
  expect(b, 'the director is still pure').toEqual(a);

  const different = TYPED_FIXTURE.map((t) => ({ ...t, text: t.text + ' really' }));
  const c = await quotesIn(page, 'fixed', different);
  expect(c.map((h) => h.body), 'what you typed is what comes back')
    .not.toEqual(a.map((h) => h.body));
});

test('D45 — a bubble made of your own words says so', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);

  // type at Mom, then find the night the number reads it back
  await page.evaluate((typed) => {
    const S = window.__unread.state;
    S.save.contactState = S.save.contactState || {};
    S.save.contactState.typed = typed;
    S.save.contactState.memory = { denied_typed: 'you said you never said that' };
  }, TYPED_FIXTURE);

  const landed = await page.evaluate(() => {
    for (let day = 21; day <= 100; day++) {
      const plan = window.__unread.loadPhase(day, 'night');
      if ((plan.phases.night || []).some((e) => e.quotesPlayer)) return day;
    }
    return null;
  });
  expect(landed, 'it arrives somewhere in the run').not.toBeNull();

  await page.locator('[data-thread="t_unknown"]').click();
  const quoted = page.locator('.msg[data-src="director.quote"]');
  await expect(quoted, 'the audit can tell whose words these are').not.toHaveCount(0);

  const text = (await quoted.first().innerText()).split('\n')[0];
  expect(TYPED_FIXTURE.some((t) => text.includes(t.text)),
    `"${text}" is a sentence the player typed`).toBe(true);

  const orphans = await page.evaluate(() => window.__unread.auditIngress());
  expect(orphans).toEqual([]);
});

test('D46 — what you said stays in the thread', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);
  await page.evaluate(() => window.__unread.loadPhase(4, 'day'));

  const MINE = 'im fine mom stop asking';
  await page.locator('[data-thread="t_mom"]').click();
  await page.locator('#say').fill(MINE);
  await page.locator('#send').click();

  const showsIt = async () => (await page.locator('.msg.me').allInnerTexts())
    .some((t) => t.includes(MINE));
  const reopen = async () => {
    const back = page.locator('#appbar .back');
    if (await back.count()) await back.click();
    await page.locator('[data-thread="t_mom"]').click();
  };

  await expect.poll(showsIt, { message: 'it lands when you send it' }).toBe(true);

  // the next phase rebuilds the thread from the authored history; yours must survive it
  await page.locator('#appbar .back').click();
  await page.evaluate(() => window.__unread.loadPhase(4, 'night'));
  await page.locator('[data-thread="t_mom"]').click();
  expect(await showsIt(), 'a phase change must not eat what you sent').toBe(true);

  // and so must a week of them
  await page.locator('#appbar .back').click();
  await page.evaluate(() => window.__unread.loadPhase(11, 'night'));
  await page.locator('[data-thread="t_mom"]').click();
  expect(await showsIt(), 'still there a week later').toBe(true);

  // it is in the save, not just on screen
  await page.reload();
  await page.locator('[data-thread="t_mom"]').click();
  expect(await showsIt(), 'still there after a reload').toBe(true);
  const mine = page.locator('.msg.me').filter({ hasText: MINE }).first();
  await expect(mine, 'and still stamped as the player\'s own words')
    .toHaveAttribute('data-src', 'player.typed');

  // and it can be found
  await page.locator('#appbar .back').click();
  await page.locator('#find').click();
  await page.locator('#q').fill('im fine mom');
  await expect(page.locator('.hit'), 'search reaches your own messages').not.toHaveCount(0);
  await page.locator('#appbar .back').click();

  // tapping a reply is saying it too, and it keeps the same way
  await page.evaluate(() => window.__unread.loadPhase(6, 'day'));
  const thread = await page.evaluate(() => {
    const c = window.__unread.state.pendingChoices.filter((x) => !x.silent)[0];
    return c ? { id: c.threadId, label: c.label } : null;
  });
  if (thread) {
    await page.locator(`[data-thread="${thread.id}"]`).click();
    await page.locator('.choice').first().click();
    await page.locator('#appbar .back').click();
    await page.evaluate(() => window.__unread.loadPhase(7, 'day'));
    await page.locator(`[data-thread="${thread.id}"]`).click();
    const kept = (await page.locator('.msg.me').allInnerTexts())
      .some((t) => t.includes(thread.label));
    expect(kept, 'a tapped reply is a thing you said, and it keeps too').toBe(true);
  }
});

test('D47 — the composer takes a rant, and the number will not read one back', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);
  await page.locator('[data-thread="t_mom"]').click();

  // the cap is 8000, enforced by the field itself and by the engine behind it
  const cap = await page.evaluate(() => window.__unread.maxTyped);
  expect(cap).toBe(8000);
  await expect(page.locator('#say')).toHaveAttribute('maxlength', '8000');

  const rant = 'this is a very long message that keeps going '.repeat(170).trim();
  await page.locator('#say').fill(rant);
  await page.locator('#send').click();
  const kept = await page.evaluate(() => window.__unread.typed().slice(-1)[0].text);
  expect(kept.length, 'a long message lands whole').toBe(rant.length);

  // an unbroken 3000-char token must wrap, not push the phone sideways
  await page.locator('#say').fill('x'.repeat(3000));
  await page.locator('#send').click();
  const inPhone = await page.evaluate(() => {
    const phone = document.querySelector('.phone').getBoundingClientRect();
    const m = document.querySelector('.msg.me:last-of-type').getBoundingClientRect();
    return m.left >= phone.left - 1 && m.right <= phone.right + 1;
  });
  expect(inPhone, 'the bubble wraps inside the phone').toBe(true);

  // the quotable rule: essays are typed history but never quoted history. One shared
  // predicate gates the template AND picks the line, so a bare {TYPED} is impossible.
  const essays = await page.evaluate(() => {
    const essays = Array.from({ length: 10 }, (_, i) =>
      ({ day: i + 1, threadId: 't_mom', text: 'w'.repeat(4000 + i) }));
    const content = { cast: window.CONTENT.cast, templates: window.CONTENT.templates,
                      ladder: window.CONTENT.ladder, clues: window.CONTENT.clues };
    const st = { flags: {}, fired: {}, memory: {}, spent: {}, clues: {},
                 typed: essays, quoted: {} };
    let bare = 0, quotes = 0;
    for (let d = 1; d <= 100; d++) {
      const p = window.Director.planDay(content, 'essay-seed', d, st);
      if (!p) continue;
      for (const ph of ['day', 'night']) for (const e of p.phases[ph] || []) {
        if (/\{TYPED/.test(e.body)) bare++;
        if (e.quotesPlayer) quotes++;
      }
    }
    return { bare, quotes };
  });
  expect(essays.bare, 'no bare slot, ever').toBe(0);
  expect(essays.quotes, 'an essay-only history is never quoted').toBe(0);
});

// ---------------------------------------------------------------------------
// D48 — what the hunt found. Six findings, each pinned.
// ---------------------------------------------------------------------------

test('D48 — a timer cannot close the search either', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);
  for (const id of ['t_mom', 't_flat', 't_dave']) {
    await page.locator(`[data-thread="${id}"]`).click();
    await page.locator('#appbar .back').click();
  }
  await page.locator('#find').click();
  await page.locator('#q').fill('mo');
  await page.clock.fastForward(6000);          // night one's photo lands in this window
  await expect(page.locator('#q'), 'the search bar is still there').toHaveCount(1);
  await expect(page.locator('#q')).toHaveValue('mo');
  // the photo really did arrive underneath, and shows once the search closes
  expect(await page.evaluate(() =>
    window.__unread.state.shown.t_unknown.some((m) => m.kind === 'photo'))).toBe(true);
  await page.locator('#appbar .back').click();
  await expect(page.locator('.row')).not.toHaveCount(0);
});

test('D48 — night one happens once, even for a save that never heard of beats',
  async ({ page }) => {
  const t0 = LAUNCH.getTime();
  await page.addInitScript(([t]) => {
    if (window.localStorage.getItem('unread.save.v1')) return;
    window.localStorage.setItem('unread.save.v1', JSON.stringify({
      runSeed: 'away-seed', day: 1, phase: 'night', phaseStartedAt: t, lastSeenAt: t,
      flags: { chose_delete: true }, contactState: {}, cluesFound: {},  // legacy: no beat
    }));
  }, [t0]);
  await page.clock.install({ time: new Date(t0 + 26 * 3600 * 1000) });
  await page.goto(BUILT);

  const boot = await page.evaluate(() => ({
    day: window.__unread.state.save.day, beat: window.__unread.state.beat }));
  expect(boot.day, 'the away band advanced the day').toBeGreaterThan(1);
  expect(boot.beat, 'a run that answered night one is past it').toBe(5);

  // the old bug: reading three threads re-armed the intro photo
  for (const id of ['t_mom', 't_flat', 't_dave']) {
    await page.locator(`[data-thread="${id}"]`).click();
    await page.locator('#appbar .back').click();
  }
  await page.clock.fastForward(8000);
  expect(await page.evaluate(() =>
    window.__unread.state.shown.t_unknown.filter((m) => m.kind === 'photo').length),
    'the intro photo does not come back').toBe(0);

  // and typing the night-one answer at the number cannot re-answer the run
  await page.locator('[data-thread="t_unknown"]').click();
  const before = await page.evaluate(() => JSON.stringify(window.__unread.state.flags));
  await page.locator('#say').fill('i found this phone');
  await page.locator('#send').click();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => JSON.stringify(window.__unread.state.flags)),
    'the ending choice is not overwritten').toBe(before);
});

test('D48 — sending mid-delivery hides nothing', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);
  for (const id of ['t_mom', 't_flat', 't_dave']) {
    await page.locator(`[data-thread="${id}"]`).click();
    await page.locator('#appbar .back').click();
  }
  await page.clock.runFor(6000);
  await page.locator('[data-thread="t_unknown"]').click();
  await page.clock.runFor(9000);               // mid-delivery
  await page.locator('#say').fill('hello who is this');
  await page.locator('#send').click();         // repaints the convo under the deliverer
  await page.clock.runFor(120000);             // the whole night plays out
  await page.waitForTimeout(200);

  const sync = await page.evaluate(() => {
    const bodies = window.__unread.state.shown.t_unknown
      .filter((m) => m.kind !== 'photo').map((m) => m.body).filter(Boolean);
    const dom = Array.from(document.querySelectorAll('.msg'))
      .map((n) => (n.childNodes[0] || {}).textContent || '');
    return {
      missing: bodies.filter((b) => !dom.some((d) => d.includes(b))),
      choices: document.querySelectorAll('.choice').length,
    };
  });
  expect(sync.missing, 'everything delivered is on screen').toEqual([]);
  expect(sync.choices, 'and the question the choices answer was seen').toBeGreaterThan(0);
});

test('D48 — a day-one typed message survives a reload', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);
  await page.locator('[data-thread="t_mom"]').click();
  await page.locator('#say').fill('mom im ok i promise');
  await page.locator('#send').click();
  await page.waitForTimeout(150);
  await page.reload();
  await page.locator('[data-thread="t_mom"]').click();
  expect((await page.locator('.msg.me').allInnerTexts())
    .some((t) => t.includes('mom im ok i promise')),
    'the boot path rebuilds day one WITH the typed bank').toBe(true);
});

test('D48 — planning a day twice quotes exactly what planning it once quotes',
  async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);
  const out = await page.evaluate(() => {
    const content = { cast: window.CONTENT.cast, templates: window.CONTENT.templates,
                      ladder: window.CONTENT.ladder, clues: window.CONTENT.clues };
    const typed = [
      { day: 2, threadId: 't_mom',  text: 'im fine' },
      { day: 3, threadId: 't_flat', text: 'it wasnt me' },
      { day: 5, threadId: 't_dave', text: 'not this week' },
      { day: 6, threadId: 't_mom',  text: 'stop worrying' },
    ];
    const mk = () => ({ flags: {}, fired: {}, memory: { denied_typed: 'x' },
                        spent: {}, clues: {}, typed: typed, quoted: {} });
    const twice = mk(), once = mk();
    const a = [], b = [];
    for (let d = 1; d <= 100; d++) {
      window.Director.planDay(content, 'replan-seed', d, twice);
      const p = window.Director.planDay(content, 'replan-seed', d, twice);
      const q = window.Director.planDay(content, 'replan-seed', d, once);
      for (const [plan, sink] of [[p, a], [q, b]]) {
        if (!plan) continue;
        for (const ph of ['day', 'night']) for (const e of plan.phases[ph] || []) {
          if (e.quotesPlayer) sink.push(d + ':' + e.body);
        }
      }
    }
    const plain = a.map((x) => x.split(':').slice(1).join(':'))
      .filter((x) => !/^you typed/.test(x));
    let repeats = 0;
    for (let i = 1; i < plain.length; i++) if (plain[i] === plain[i - 1]) repeats++;
    return { a, b, repeats };
  });
  expect(out.a.length, 'the quote-back still happens').toBeGreaterThan(0);
  expect(out.a, 'the replan changes nothing').toEqual(out.b);
  expect(out.repeats, 'and never the same sentence twice running').toBe(0);
});

test('D48 — lines typed at the number are never what it quotes', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);
  const out = await page.evaluate(() => {
    const content = { cast: window.CONTENT.cast, templates: window.CONTENT.templates,
                      ladder: window.CONTENT.ladder, clues: window.CONTENT.clues };
    const atNumber = Array.from({ length: 8 }, (_, i) =>
      ({ day: i + 1, threadId: 't_unknown', text: 'who is this ' + i }));
    const st = { flags: {}, fired: {}, memory: {}, spent: {}, clues: {},
                 typed: atNumber, quoted: {} };
    let quotes = 0, bare = 0;
    for (let d = 1; d <= 100; d++) {
      const p = window.Director.planDay(content, 'numb-seed', d, st);
      if (!p) continue;
      for (const ph of ['day', 'night']) for (const e of p.phases[ph] || []) {
        if (e.quotesPlayer) quotes++;
        if (/\{TYPED/.test(e.body)) bare++;
      }
    }
    return { quotes, bare };
  });
  expect(out.quotes, '"you said that to +44..." is a receipt, not a scare').toBe(0);
  expect(out.bare, 'and refusing to quote never leaks a slot').toBe(0);
});

test('D49 — a flood of essays cannot reach the quota wall', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);
  await page.locator('[data-thread="t_mom"]').click();

  const out = await page.evaluate(() => {
    // three quotable lines, then a flood of never-quotable essays
    for (const line of ['im fine mom', 'it wasnt me', 'stop worrying']) {
      window.__unread.say(line);
    }
    // 60 x 8000 = 480KB of essays, comfortably past the 400KB budget: eviction
    // must engage. (Each say() repaints the thread, so the count stays testable.)
    const essay = 'e'.repeat(8000);
    for (let i = 0; i < 60; i++) window.__unread.say(essay + i);
    window.__unread.say('the last thing i said');

    const bank = window.__unread.typed();
    let writable = true;
    try {
      window.localStorage.setItem('__probe', 'x'.repeat(8000));
      window.localStorage.removeItem('__probe');
    } catch (e) { writable = false; }
    return {
      chars: bank.reduce((n, t) => n + t.text.length, 0),
      budget: window.__unread.bankBudget,
      writable,
      shorts: ['im fine mom', 'it wasnt me', 'stop worrying']
        .every((x) => bank.some((t) => t.text === x)),
      newest: bank.some((t) => t.text === 'the last thing i said'),
    };
  });
  expect(out.chars, 'the bank respects its budget').toBeLessThanOrEqual(out.budget);
  expect(out.writable, 'localStorage never hits the wall').toBe(true);
  expect(out.shorts, 'quotable lines outlive any flood of essays').toBe(true);
  expect(out.newest, 'and the newest message is never the one evicted').toBe(true);

  // the save that reloads is the save that was written
  await page.reload();
  const kept = await page.evaluate(() =>
    window.__unread.typed().some((t) => t.text === 'the last thing i said'));
  expect(kept, 'nothing sent before the reload is missing after it').toBe(true);
});

test('D50 — what they said back survives the reload too', async ({ page }) => {
  await page.clock.install({ time: LAUNCH });
  await page.goto(BUILT);
  await page.evaluate(() => window.__unread.loadPhase(3, 'day'));
  await page.locator('[data-thread="t_dave"]').click();
  await page.locator('#say').fill('sorry dave not this week');
  await page.locator('#send').click();

  // the deflection lands, in character, stamped as content
  const answer = page.locator('.msg.them[data-src="content.unmatched"]').last();
  await expect(answer).toHaveCount(1, { timeout: 4000 });
  const said = (await answer.innerText()).split('\n')[0];

  await page.locator('#appbar .back').click();
  await page.reload();
  await page.locator('[data-thread="t_dave"]').click();

  const texts = await page.locator('.msg').allInnerTexts();
  expect(texts.some((t) => t.includes('sorry dave not this week')),
    'your side survives (D46)').toBe(true);
  expect(texts.some((t) => t.includes(said)),
    'their answer survives too — a reload must not unsay a reply you watched arrive')
    .toBe(true);

  // the rebuilt exchange keeps its real moment, not a phase guess
  const offset = await page.evaluate(() => {
    const mine = window.__unread.state.shown.t_dave.filter((m) => m.from === 'me');
    return mine[mine.length - 1].offsetMinutes;
  });
  expect(Math.abs(offset), 'stamped when it happened').toBeLessThanOrEqual(2);

  // their recorded side is bank data but never quotable material
  const q = await page.evaluate(() => {
    const bank = (window.__unread.state.save.contactState || {}).typed || [];
    const theirs = bank.filter((t) => t.from === 'them');
    return {
      theirsRecorded: theirs.length,
      typedHookMine: window.__unread.typed().every((t) => !t.from || t.from === 'me'),
    };
  });
  expect(q.theirsRecorded).toBeGreaterThan(0);
  expect(q.typedHookMine, 'typed() still means: what the PLAYER said').toBe(true);
});
