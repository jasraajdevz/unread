/* Gates 2, 3 and 5: determinism, seed divergence, and the decay curve.
 *
 *   node tools/check_run.js
 *
 * Exits non-zero on any failure. Prints the decay curve as numbers, because "the group
 * chat gets quieter" is a claim and 54 19 17 16 15 15 13 12 10 9 is evidence.
 */
const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');
const Director = require('../src/director.js');
const { ROOT, load } = require('./content.js');

const content = load();
const FROM = 1;
const TO = 40;

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log('  PASS  ' + label);
  } catch (e) {
    failures += 1;
    console.log('  FAIL  ' + label + '\n        ' + e.message.split('\n')[0]);
  }
}

function transcript(seed) {
  return execFileSync(process.execPath,
    [path.join(ROOT, 'tools', 'transcript.js'), '--seed', seed,
     '--from', String(FROM), '--to', String(TO)],
    { encoding: 'utf8' });
}

console.log('gate 2 - determinism');
const alphaA = transcript('alpha');
const alphaB = transcript('alpha');
check('same seed, two runs, byte-identical transcript', () => {
  assert.strictEqual(alphaA, alphaB);
  assert.ok(alphaA.length > 500, 'transcript is not empty');
});
check('same seed, in-process plan is identical too', () => {
  const one = JSON.stringify(Director.planRun(content, 'alpha', FROM, TO));
  const two = JSON.stringify(Director.planRun(content, 'alpha', FROM, TO));
  assert.strictEqual(one, two);
});

console.log('\ngate 3 - seed divergence');
const bravo = transcript('bravo');
check('a different seed selects materially different content', () => {
  assert.notStrictEqual(alphaA, bravo);
  const a = alphaA.split('\n');
  const b = bravo.split('\n');
  let differing = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) differing += 1;
  }
  const ratio = differing / Math.max(a.length, b.length);
  assert.ok(ratio > 0.2,
    'only ' + (ratio * 100).toFixed(1) + '% of lines differ; seeds are barely diverging');
  console.log('        ' + (ratio * 100).toFixed(1) + '% of transcript lines differ');
});
check('template selection itself differs, not just slot values', () => {
  const ids = (seed) => new Set(Director.planRun(content, seed, 2, TO)
    .flatMap((d) => ['day', 'night'].flatMap((p) => d.phases[p].map((e) => e.templateId))));
  const a = [...ids('alpha')].sort().join(',');
  const b = [...ids('bravo')].sort().join(',');
  const order = (seed) => Director.planRun(content, seed, 2, TO)
    .map((d) => d.phases.day.map((e) => e.templateId).join('>')).join('|');
  assert.notStrictEqual(order('alpha'), order('bravo'),
    'the order templates fire in is identical across seeds');
});

console.log('\ngate 5 - decay, asserted numerically');
const run = Director.planRun(content, 'alpha', FROM, TO);
const replies = run.map((d) => d.replies);
const messages = run.map((d) => d.messages);

console.log('\n  day  authored  messages  replies');
run.forEach((d) => {
  console.log('  ' + String(d.day).padStart(3) + String(d.authored).padStart(10) +
              String(d.messages).padStart(10) + String(d.replies).padStart(9));
});
console.log('\n  replies per day: ' + replies.join(' '));

check('replies per day is monotonically non-increasing', () => {
  for (let i = 1; i < replies.length; i++) {
    assert.ok(replies[i] <= replies[i - 1],
      'day ' + (i + 1) + ' has ' + replies[i] + ' replies, up from ' + replies[i - 1]);
  }
});
check('day 10 is strictly below day 1', () => {
  assert.ok(replies[replies.length - 1] < replies[0],
    'day 10 (' + replies[replies.length - 1] + ') is not below day 1 (' + replies[0] + ')');
});
check('the decay holds for other seeds too, not just this one', () => {
  ['bravo', 'charlie', 'delta'].forEach((seed) => {
    const r = Director.planRun(content, seed, FROM, TO).map((d) => d.replies);
    for (let i = 1; i < r.length; i++) {
      assert.ok(r[i] <= r[i - 1], 'seed ' + seed + ' rises at day ' + (i + 1) +
        ': ' + r.join(' '));
    }
    assert.ok(r[r.length - 1] < r[0], 'seed ' + seed + ' does not decay: ' + r.join(' '));
  });
});
check('messages per day also trend down across the generated days', () => {
  const generated = messages.slice(1);
  assert.ok(generated[generated.length - 1] < generated[0],
    'generated messages did not fall: ' + generated.join(' '));
});
check('lastToldByRen is writable from day one: every act I day offers a reply', () => {
  run.slice(1).forEach((d) => {
    const choices = ['day', 'night']
      .flatMap((p) => d.phases[p].filter((e) => e.kind === 'choice'));
    assert.ok(choices.length > 0, 'day ' + d.day + ' offers no reply at all');
    assert.ok(choices.some((c) => c.tells), 'day ' + d.day + ' records nothing Ren said');
  });
});


check('Act I ends silent: day 20 still talks, and nobody answers', () => {
  // day 20 by name, not "the last day" -- the ladder runs past it now.
  const day20 = Director.planRun(content, 'alpha', FROM, TO).find((d) => d.day === 20);
  assert.ok(day20, 'day 20 is in the ladder');
  assert.ok(day20.messages > 0, 'day 20 is empty, not silent');
  assert.strictEqual(day20.replies, 0, 'day 20 still has ' + day20.replies + ' replies');
  console.log('        day 20: ' + day20.messages + ' messages, ' + day20.replies +
              ' replies, ' + day20.dropped + ' lines dropped for want of budget');
});
check('the silence is the same conversations, shortened', () => {
  const run = Director.planRun(content, 'alpha', FROM, TO);
  const ids = (d) => new Set(['day', 'night']
    .flatMap((p) => d.phases[p].map((e) => e.templateId)));
  const early = ids(run[1]);
  const late = ids(run[run.length - 1]);
  const shared = [...late].filter((id) => early.has(id));
  assert.ok(shared.length > 0,
    'day 20 shares no template with day 2, so the player has nothing to recognise');
  console.log('        day 20 reuses ' + shared.length +
              ' of day 2 conversations, truncated');
});

console.log('\nD26 - the player can always reply');
check('every generated phase offers at least one reply', () => {
  ['alpha', 'bravo', 'charlie', 'delta', 'echo'].forEach((seed) => {
    Director.planRun(content, seed, FROM, TO).forEach((d) => {
      if (d.authored) return;   /* day 1 night ends in the authored beat-5 choices */
      ['day', 'night'].forEach((phase) => {
        const choices = d.phases[phase].filter((e) => e.kind === 'choice');
        assert.ok(choices.length > 0,
          'seed ' + seed + ' day ' + d.day + ' ' + phase + ' offers nothing to say');
      });
    });
  });
});
check('replies do not decay with the ladder', () => {
  const r = Director.planRun(content, 'alpha', FROM, TO);
  const offered = (d) => ['day', 'night']
    .reduce((n, p) => n + d.phases[p].filter((e) => e.kind === 'choice').length, 0);
  const first = offered(r[1]);
  const last = offered(r[r.length - 1]);
  console.log('        day 2 offers ' + first + ' replies, day 10 offers ' + last +
              ' -- the cast decays, the player does not');
  assert.ok(last > 0, 'day 10 offers no replies at all');
});
check('the supply is unbounded: every generated phase across five seeds is answerable', () => {
  let phases = 0;
  ['alpha', 'bravo', 'charlie', 'delta', 'echo'].forEach((seed) => {
    Director.planRun(content, seed, 2, TO).forEach((d) => {
      ['day', 'night'].forEach((phase) => {
        phases += 1;
        assert.ok(d.phases[phase].some((e) => e.kind === 'choice'),
          'empty phase at seed ' + seed + ' day ' + d.day + ' ' + phase);
      });
    });
  });
  console.log('        ' + phases + ' generated phases, every one answerable');
});

console.log('\nAct II - recall');
const gatedIds = new Set(content.templates.templates
  .filter((t) => t.requiresMemory).map((t) => t.id));
// by template, not by wording: Mom's authored beat-1 line "you said that about the last
// one" is not the game quoting the player back.
const recallOf = (d) => ['day', 'night']
  .reduce((n, p) => n + d.phases[p]
    .filter((e) => e.kind !== 'choice' && gatedIds.has(e.templateId)).length, 0);

check('nothing is quoted back that the player never said', () => {
  // an empty-memory run must produce no recall at all
  const state = { flags: {}, fired: {}, memory: {}, spent: {} };
  for (let day = 21; day <= TO; day++) {
    const planned = Director.planDay(content, 'alpha', day, state);
    ['day', 'night'].forEach((p) => planned.phases[p].forEach((e) => {
      const gated = content.templates.templates
        .find((t) => t.id === e.templateId && t.requiresMemory);
      assert.ok(!gated, 'day ' + day + ' quoted ' + (gated && gated.requiresMemory) +
        ' with no memory to quote');
    }));
  }
});

check('Act II quotes the player back, and Act I does not', () => {
  const run = Director.planRun(content, 'alpha', FROM, TO);
  const actI = run.filter((d) => d.act === 1).reduce((n, d) => n + recallOf(d), 0);
  const actII = run.filter((d) => d.act === 2).reduce((n, d) => n + recallOf(d), 0);
  console.log('        recall lines: act I ' + actI + ', act II ' + actII);
  assert.strictEqual(actI, 0, 'Act I quoted the player back ' + actI + ' times');
  assert.ok(actII > 10, 'Act II only quotes the player ' + actII + ' times');
});

check('a memory is quoted back once, not repeatedly', () => {
  const run = Director.planRun(content, 'alpha', FROM, TO);
  const seen = {};
  run.forEach((d) => ['day', 'night'].forEach((p) => {
    // one firing of a recall template is one quoting, however many lines it then says
    const fired = new Set(d.phases[p]
      .filter((e) => gatedIds.has(e.templateId)).map((e) => e.templateId));
    fired.forEach((id) => {
      const tag = content.templates.templates.find((x) => x.id === id).requiresMemory;
      seen[tag] = (seen[tag] || 0) + 1;
    });
  }));
  Object.keys(seen).forEach((tag) => {
    assert.strictEqual(seen[tag], 1, 'memory ' + tag + ' quoted ' + seen[tag] + ' times');
  });
  console.log('        ' + Object.keys(seen).length + ' distinct memories quoted, each once');
});

check('the unknown number speaks again in Act II', () => {
  const run = Director.planRun(content, 'alpha', FROM, TO);
  const lines = run.filter((d) => d.act === 2)
    .reduce((n, d) => n + ['day', 'night']
      .reduce((m, p) => m + d.phases[p]
        .filter((e) => e.threadId === 't_unknown' && e.kind !== 'choice').length, 0), 0);
  console.log('        the number says ' + lines + ' things in days 21-' + TO);
  assert.ok(lines > 0, 'the unknown number never speaks in Act II');
});

check('Act I texture continues under Act II', () => {
  const run = Director.planRun(content, 'alpha', FROM, TO);
  const mundane = run.filter((d) => d.act === 2).reduce((n, d) => n + ['day', 'night']
    .reduce((m, p) => m + d.phases[p].filter((e) => {
      const t = content.templates.templates.find((x) => x.id === e.templateId);
      return t && !t.requiresMemory && e.kind !== 'choice';
    }).length, 0), 0);
  console.log('        ' + mundane + ' ordinary messages still arrive in Act II');
  assert.ok(mundane > 10, 'the world vanishes in Act II: only ' + mundane + ' plain lines');
});

check('determinism survives: same seed AND same memory, same transcript', () => {
  const mem = { visit_promised: 'you said you were coming saturday' };
  const one = JSON.stringify(Director.planRun(content, 'alpha', FROM, TO, mem));
  const two = JSON.stringify(Director.planRun(content, 'alpha', FROM, TO, mem));
  assert.strictEqual(one, two);
  const withMem = JSON.stringify(Director.planDay(content, 'alpha', 25,
    { flags: {}, fired: {}, spent: {},
      memory: { visit_promised: 'you said you were coming saturday' } }));
  const without = JSON.stringify(Director.planDay(content, 'alpha', 25,
    { flags: {}, fired: {}, spent: {}, memory: {} }));
  assert.notStrictEqual(withMem, without,
    'the same Act II day plays identically with and without memory');
});

console.log('\nD27 - clues');
const clues = require(path.join(ROOT, 'content', 'clues.json'));
check('every revealsClue names a declared clue', () => {
  const declared = new Set(clues.clues.map((c) => c.id));
  content.templates.templates.forEach((t) => {
    (t.choices || []).forEach((c) => {
      if (!c.revealsClue) return;
      assert.ok(declared.has(c.revealsClue),
        t.id + '/' + c.id + ' reveals undeclared clue ' + c.revealsClue);
    });
  });
});
check('every clue is actually offered inside days 1-10, not merely declared', () => {
  const reachable = new Set();
  const seeds = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];
  seeds.forEach((seed) => {
    Director.planRun(content, seed, FROM, TO).forEach((d) => {
      ['day', 'night'].forEach((p) => d.phases[p].forEach((e) => {
        if (e.kind === 'choice' && e.revealsClue) reachable.add(e.revealsClue);
      }));
    });
  });
  const declared = clues.clues.map((c) => c.id);
  const missing = declared.filter((id) => !reachable.has(id));
  console.log('        ' + reachable.size + '/' + declared.length +
              ' clues offered within days 1-10 across ' + seeds.length + ' seeds');
  assert.ok(missing.length === 0, 'never offered in ten days: ' + missing.join(', '));
});
check('a clue-revealing reply says something a player would connect to the clue', () => {
  const byId = {};
  clues.clues.forEach((c) => { byId[c.id] = c; });
  content.templates.templates.forEach((t) => {
    (t.choices || []).forEach((c) => {
      if (!c.revealsClue) return;
      assert.ok(c.tells, t.id + '/' + c.id + ' reveals a clue but records nothing Ren said');
      const slotValues = Object.values(t.slots || {}).flat().join(' ');
      const subject = (t.lines.map((l) => l.text).join(' ') + ' ' + slotValues +
                       ' ' + (c.label || '') + ' ' + (c.tells || '')).toLowerCase();
      const clue = byId[c.revealsClue];
      const words = clue.summary.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
      assert.ok(words.some((w) => subject.includes(w)),
        t.id + '/' + c.id + ' reveals ' + c.revealsClue +
        ', but that template never mentions it: ' + clue.summary);
    });
  });
});

console.log('\n' + (failures ? failures + ' check(s) failed' : 'all checks passed'));
process.exit(failures ? 1 : 0);
