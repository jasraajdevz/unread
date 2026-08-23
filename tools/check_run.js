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
const TO = 10;

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

console.log('\n' + (failures ? failures + ' check(s) failed' : 'all checks passed'));
process.exit(failures ? 1 : 0);
