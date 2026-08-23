/* Dump a run's transcript, or its decay curve.
 *
 *   node tools/transcript.js --seed alpha            full transcript, days 1-10
 *   node tools/transcript.js --seed alpha --decay    the decay curve only
 *
 * The transcript is the determinism artefact: same seed in, byte-identical text out.
 */
const Director = require('../src/director.js');
const { load } = require('./content.js');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const content = load();
const seed = arg('seed', 'default');
const from = parseInt(arg('from', '1'), 10);
const to = parseInt(arg('to', '10'), 10);
// Always play from day 1 and print only the window asked for: Act II quotes what the
// player said in Act I, so a run that starts on day 24 has nothing to remember.
const whole = Director.planRun(content, seed, 1, to);
const run = whole.filter((d) => d.day >= from);

if (process.argv.includes('--decay')) {
  console.log('day  authored  messages  replies  dropped');
  run.forEach((d) => {
    console.log(
      String(d.day).padStart(3),
      String(d.authored).padStart(9),
      String(d.messages).padStart(9),
      String(d.replies).padStart(8),
      String(d.dropped).padStart(8)
    );
  });
  console.log('\nreplies: ' + run.map((d) => d.replies).join(' '));
} else {
  run.forEach((d) => {
    console.log('=== day ' + d.day + (d.authored ? ' (authored)' : '') + ' act ' + d.act);
    ['day', 'night'].forEach((phase) => {
      console.log('--- ' + phase);
      d.phases[phase].forEach((e) => {
        if (e.kind === 'choice') {
          console.log('    [choice] ' + e.choiceId + ' :: ' + e.label +
                      (e.tells ? ' :: tells=' + e.tells : ''));
        } else {
          console.log('    ' + (e.speaker || e.threadId) + (e.isReply ? ' >' : ' :') +
                      ' ' + e.body);
        }
      });
    });
  });
}
