# UNREAD

A horror game that is a messaging app. You found someone's phone.

Read `DECISIONS.md` first, then `CLAUDE.md`.

## Run it

    python3 tools/build.py && open dist/unread.html

`dist/unread.html` is generated and gitignored. It is one self-contained file.

## The gate

    bash tools/gate.sh

That is what "green" means (D21). It runs the validators, the build, the determinism and
decay checks, and the full Playwright suite.

## CI

The workflow lives at **`ci/gate.yml`**, not `.github/workflows/`. Pushing to a workflow
path needs an OAuth scope this repo has waited two phases for, and D17 says a path blocked
twice is dead. When the scope exists:

    mkdir -p .github/workflows && cp ci/gate.yml .github/workflows/gate.yml

Until then CI is unproven, and that is a recorded state rather than an open blocker.

## Layout

    Resources/story.json   day 1, and the only place a line of dialogue exists
    content/               cast, event templates, and the 100-day ladder
    src/engine.html        markup, CSS, engine. Zero story text.
    src/director.js        seeded generation. Pure: no DOM, no Date, no Math.random.
    tools/                 validators, build, gate
    tests/                 Playwright: beats, days, persistence
