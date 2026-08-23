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
10. Story text is inserted with `textContent`, never `innerHTML`. `innerHTML` is for
    fixed markup with no story in it.
11. **Rule 15 (the engine string audit).** No string literal longer than three words may
    appear in `src/engine.html` outside CSS, comments, or the UI-chrome allowlist.
    `python3 tools/validate_story.py Resources/story.json --engine src/engine.html`
    fails the build. Known limit: three words or fewer passes, so it catches prose, not
    one-liners.
12. The build gate is CI, not your judgment. A phase is done when the `gate` workflow is
    green and the screenshot artifact shows the intended screen. Name the run.
13. Every beat must be reachable and photographed by `tests/beats.spec.js`. A beat CI
    cannot photograph does not exist.
14. Tests assert against values read from `story.json`. Never paste story text into a
    test — it is code, and rule 2 applies to it for the same reason.
15. If a gate has been blocked on the same external action for two consecutive phases,
    that path is dead. Route around it or stop (D17).

## File tree — the whole project
CLAUDE.md
DECISIONS.md                   append-only rulings; read before CLAUDE.md
package.json                   dev-only: Playwright
playwright.config.js
Resources/
  story.json                   the only place a line of dialogue exists
  Images/
  Audio/
src/
  engine.html                  markup, CSS, engine. Zero story text.
tools/
  validate_story.py            schema + graph + rule 15
  beat_duration.py             counts and playback time; reports, never gates
  build.py                     story.json + engine.html -> dist/unread.html
tests/
  beats.spec.js                drives every beat headless, screenshots each
.github/workflows/
  gate.yml                     the only source of "done"
dist/                          generated, gitignored
shots/                         generated, gitignored

## Definition of done for any task
- `python3 tools/validate_story.py Resources/story.json` exits 0.
- `python3 tools/validate_story.py Resources/story.json --engine src/engine.html` exits 0.
- `python3 tools/build.py` produces `dist/unread.html`.
- `npx playwright test` passes.
- The `gate` workflow is green on the pushed commit. Name the run.
- You state which files you changed and why, in one line each.

The whole gate, locally:

    python3 tools/validate_story.py Resources/story.json --engine src/engine.html
    python3 tools/build.py
    npx playwright test

## Style
No comments that restate the code. Comment only non-obvious timing, a ruling being
honoured, or a browser caveat.
