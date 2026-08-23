# UNREAD
Web horror game. The player opens what looks like a stranger's messaging app and reads
their threads. All narrative content is data, not code.

**Read `DECISIONS.md` before this file.** It holds the rulings that are not derivable
from the code — what was decided, and why — and it is append-only. This file says how to
work; that file says what has already been settled. Do not re-litigate an entry in it,
and do not edit one: reverse a decision by appending a new entry that names the one it
supersedes.

The native build is deferred, not cancelled. See D18 for the three things that must stay
portable, and for the instruction not to pay more than that.

## Absolute rules
1. ZERO third-party runtime dependencies. The shipped artifact is one HTML file that
   loads nothing but a Google Font. Playwright is a test tool and is never shipped.
   If you want a runtime package, stop and ask.
2. All story text, contact names, message bodies, choice labels, ending text and timings
   live in `Resources/story.json`. NO story text in `src/engine.html`. This is enforced —
   see rule 11.
3. When fixing the engine, do not edit story.json. When editing story, do not touch
   `src/engine.html`. If a task seems to need both, stop and tell me why.
4. Do not create new files that are not in the file tree below without asking first.
5. `dist/unread.html` is GENERATED. Never hand-edit it, never commit it. It is rebuilt by
   `python3 tools/build.py` and it is gitignored.
6. The engine keeps the story layer separate from the DOM layer (D18). Anything that
   reads the schema goes in the `Story` module; anything that touches an element does
   not. A future native renderer replaces the second half and keeps the first.
7. If you are not certain an API exists with that exact signature, STOP and say so.
   Never invent a symbol, a method, or an option. A wrong guess costs an hour.
8. The away-hook (`visibilitychange`) may change what the game says, but must NEVER be
   required to reach an ending. Every beat is reachable without ever leaving the tab.
9. Never mimic another company's app name, icon, colours or logo. The messenger is
   called Loop and it is fictional. (App Store Guideline 4.1, which still applies the
   day this is wrapped for a store.)
   No title screen, no New Game, no menu before the app. Loop's own settings screen,
   reached from the thread list, is not a menu — it is the app being an app (D33).
10. Story text is inserted with `textContent`, never `innerHTML`. `innerHTML` is for
    fixed markup with no story in it.
11. **One ingress (D19).** Exactly one function puts story text on screen, and it takes
    only tokens minted by the Story or Director modules. Nothing else may assign
    `.textContent` on a bubble, a choice or a preview. `__unread.auditIngress()` returns
    anything that got there another way, and the suite asserts it is empty.
    Rule 15's word-count grep is kept as a second-line smoke test with a `not-story`
    opt-out, per line or as a `not-story:begin`/`:end` region for a block of UI chrome.
    `grep not-story src/engine.html` lists every exemption; an unclosed region fails.
12. **`bash tools/gate.sh` is the gate** (D21). It must exit 0, and for any phase that
    changes what is on screen the screenshots must show the intended screen. CI lives at
    `ci/gate.yml`, is a copy of the same steps, and has never run.
13. Every beat must be reachable and photographed by `tests/beats.spec.js`. A beat CI
    cannot photograph does not exist.
14. Tests assert against values read from `story.json`. Never paste story text into a
    test — it is code, and rule 2 applies to it for the same reason.
15. If a gate has been blocked on the same external action for two consecutive phases,
    that path is dead. Route around it or stop (D17).

## File tree — the whole project
README.md
CLAUDE.md
DECISIONS.md                   append-only rulings; read before CLAUDE.md
package.json                   dev-only: Playwright
playwright.config.js
Resources/
  story.json                   day 1; the only place a line of dialogue exists
  Images/  Audio/
content/
  cast.json                    characters, voice rules, reply budgets
  templates.json               event templates: slots, act range, flags, weight
  ladder.json                  the 100-day schedule
src/
  engine.html                  markup, CSS, engine. Zero story text.
  director.js                  seeded generation. No DOM, no Date, no Math.random.
tools/
  gate.sh                      THE gate (D21)
  validate_story.py            schema + graph + rule 15 + content audit
  beat_duration.py             counts and playback time; reports, never gates
  build.py                     story + content + director -> dist/unread.html
  director/content/transcript/check_run.js   determinism, decay, transcripts
tests/
  beats.spec.js                day 1's five beats, screenshotted
  days.spec.js                 days 1-10 in fast mode, 20 screenshots
  persistence.spec.js          the four away bands, and the ingress audit
ci/
  gate.yml                     a copy of the gate that has never run (D21)
dist/  shots/                  generated, gitignored

## Definition of done for any task
- `bash tools/gate.sh` prints GATE GREEN and exits 0.
- For anything visible: you have looked at the screenshots and said what they show.
- You state which files you changed and why, in one line each.
- Any append to DECISIONS.md is re-read and asserted present before you report it (D22).

    bash tools/gate.sh

## Style
No comments that restate the code. Comment only non-obvious timing, a ruling being
honoured, or a browser caveat.
