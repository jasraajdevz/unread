# DECISIONS

Rulings that shape UNREAD but are not derivable from the code. They live here because
chat does not survive `/clear` and a decision that exists only in a transcript is a
decision that will be silently re-litigated, or silently broken, three sessions later.

**Append-only.** A decision is reversed by adding a new entry that names the one it
supersedes. Never edit or delete an existing entry — a wrong decision that was made and
then reversed is more useful than no record of either. Numbers are permanent and are
never reused.

Each entry states what is enforced in code and what is only convention. Convention is
what rots; if an entry says "convention only", treat it as the next thing worth turning
into a validator rule.

---

## D1 — `me` bubbles are one global colour; `accentHex` is avatar-only

**Status:** active · **Scope:** `Views/` · **Enforced by:** convention

The player's own messages render in a single colour, the same in every thread.
`Contact.accentHex` tints the avatar and nothing else.

**Why:** the earlier reading — "my bubbles take the contact's accentHex" — created a gap
with no answer, because `t_flat` and `t_unknown` have no `contactId` and therefore no
accent. That gap does not need a fallback rule. It does not exist. A messenger where the
player's own colour changes per thread is also not how any real messenger behaves, and
beat 1 only works if the app reads as ordinary.

**Consequence:** do not add a default accent, a thread-level accent, or a per-thread
`me` colour. If a view needs the player's colour it is a constant, not a lookup.

---

## D2 — CLAUDE.md rule 16 is the `Models/` computed-accessor carve-out

**VOID — superseded by D14.** This describes a Swift file that no longer exists.
Retained as history; do not act on it.

**Status:** active · **Scope:** `Models/`, `CLAUDE.md` · **Enforced by:** convention

`Models/StoryModels.swift` says "Codable structs only, no logic". Synthesised `Codable`
does not apply Swift property defaults, so a JSON key that is optional-with-a-default
requires either a hand-written `init(from:)` or an optional stored property plus a
computed accessor. Rule 16 permits the accessor, and only that: `isLive`,
`beginsUnread`, and future accessors of the same shape. No formatting, no lookups, no
derivation across types.

**Also decided:** a CLAUDE.md rule restating "story.json is version N, older versions are
rejected" is **rejected as dead weight**. Validator rule 14 enforces it in executable
code on both sides. A prose restatement of a rule that already fails the build adds a
second place to forget to update.

---

## D3 — `+44 7700 900931` sits at `offsetMinutes: -8665` and does not move

**Status:** active · **Scope:** `Resources/story.json` · **Enforced by:** convention

The unnamed number's single message is the **earliest** message in the cluster where
every thread goes quiet — not the latest.

**Why, and this is now spec rather than a side effect:** it buys two properties at once.

1. It sorts to the bottom of the thread list, because ordering is `max(offsetMinutes)`
   descending. That is the whole job of that thread in beat 1 — to be boring enough to
   scroll past. Placed last in the cluster it would sort directly under Notify, second
   from the top, and the player would open it first.
2. It arrives *before* Ren stops answering. Someone asked **is this still ren's**, and
   then he stopped replying to everyone. The causality is implied by the timestamps and
   stated by no line of dialogue.

**Consequence:** do not "tidy" this to the end of the Tuesday cluster. Any future change
to the cluster must keep `-8665` the minimum of it.

---

## D4 — the weekday-name requirement is withdrawn

**Status:** active · **Supersedes:** the Phase 2b instruction to "choose spans that make
the rendered day names match what the deleted dividers used to say" · **Scope:**
`Resources/story.json` · **Enforced by:** n/a

That requirement was self-contradictory and no assignment of offsets could satisfy it.
`offsetMinutes` is relative to the player's first launch, so the weekday a message
renders as depends on when the game is opened. Launch on a Thursday and `-8640` is a
Friday. The authored dividers said "Tuesday" precisely because they were absolute, which
is the property Phase 2b removed on purpose.

**What is preserved instead:** day *distances*, which carry the meaning. Dave's three
attempts remain 4 and 3 days apart, Notify's second code remains 3 days after the
silence, the flat's `ren?` remains 2 days after the bin argument.

**Consequence:** never reintroduce an absolute date, weekday name or authored divider to
recover this. See D6 and validator rule 13.

---

## D5 — a date divider needs a day change **and** a gap of ≥30 minutes

**Status:** active · **Scope:** `Views/` (Phase 2 renderer) · **Enforced by:** convention

The renderer emits a day divider between two consecutive messages only when both hold:

1. the calendar day differs, and
2. the gap between them is at least 30 minutes.

**Why:** calendar days break at midnight, but offsets are anchored to the player's launch
*time of day*. A single 40-minute exchange therefore has a real chance of straddling
midnight and being cut in half by a day header, which reads as a bug. The 30-minute floor
means a continuous conversation is never split, whatever time the player first opened the
app.

**Accepted trade:** a genuine day boundary crossed inside 30 minutes gets no divider, so
those messages sit under the previous day's header. That is the correct failure — a
conversation that flows without interruption, rather than one visibly severed.

---

## D6 — validator rule 13 stays scoped to `kind: "system"`

**Status:** active · **Scope:** `tools/validate_story.py`,
`Tests/StoryValidationTests.swift` · **Enforced by:** validator rule 13

Rule 13 rejects a *system* message whose body is a bare weekday name. It deliberately
does not check `text` messages.

**Why:** a divider smuggled in as `kind: "text"` renders as an ordinary chat bubble
saying "tuesday" — obvious in the first screenshot anyone looks at. Widening the rule to
all messages would false-positive on real dialogue, because a person answering "when?"
with "tuesday" is exactly how these characters talk. A visible failure beats a silent
one; a false positive on dialogue is a silent tax on every future writing session.

---

## D7 — the causality in D3 was stated backwards; `-8665` still does not move

**Status:** active · **Supersedes:** the second property claimed in D3 · **Scope:**
`Resources/story.json` · **Enforced by:** convention

D3 claimed the unknown number arrives *before* Ren goes quiet. Against the data that is
false: Ren's last reply is at `-11466`, roughly two days before `-8665`. The placement was
right; the sentence describing it was wrong.

**The true sequence, which is better than the one claimed:** Ren stops replying. Two days
pass and nobody notices. An unknown number asks whether the phone is still his. Then his
friends start noticing. **The number knows before they do.**

**Consequence:** no file changes. `-8665` stays. When reasoning about this thread, reason
from the sequence above, not from D3's original wording.

---

## D8 — the final cluster spreads across ~14 hours, not 25 minutes

**Status:** active · **Scope:** `Resources/story.json` · **Enforced by:** convention

Five threads falling silent inside 25 minutes is a coincidence that reads as authored.
It matters specifically because beat 3 teaches the player to read timestamps; once that
instinct exists they can scroll back through beat 1 and find a synchronised burst.

Same calendar day — the list shows day granularity and every row reading the same day is
the scare — but spread across roughly 14 hours inside it. Mom's `ren did you go on
thursday` sits in the afternoon, after the appointment it refers to has been missed.

**As built.** D7 pins `+44` at `-8665` as the earliest message, which forces the window
forward to `[-8665, -7825]`:

    +0h    -8665   +44       is this still ren's
    +4h    -8425   Dave      Thursday between 12 and 4?
    +8h    -8185   Mom       ren did you go on thursday
    +13h   -7885   the flat  ren?
    +14h   -7825   the flat  is he with you

**Measured cost, unresolved.** A 14-hour window covers 10 of 24 hours, so it lands inside
one calendar day for 41.7% of launch times whichever way it points. But *which* 10 hours
is decided by where the window sits:

| window | contained when the player first launches between | evening coverage |
|---|---|---|
| `[-8665, -7825]` as built | **00:25 – 10:24** | **0%** |
| `[-9480, -8640]` ending at the anchor | **14:00 – 23:59** | **100%** |

The built window holds only for morning launches. This is a horror game; it will mostly
be opened at night, which is exactly when the same-day scare breaks and the rows show two
different days. The alternative window keeps `+44` earliest and last in the list and keeps
the D7 sequence intact — it costs only D7's literal `-8665` and Phase 2b's "within the
same hour". **Not actioned: reversing D7 is not mine to do.** See the open question at the
end of this file.

---

## D9 — freeze: no new phases until gate run-1 completes

**Status:** active · **Scope:** everything · **Enforced by:** this entry

Three phases are staged and nothing has proven a single line of Swift compiles. Every
Swift claim so far rests on reading, not a compiler. The cost of the first red grows with
every phase, because `xcodebuild` will report four phases of accumulated errors at once
instead of one.

**Permitted until run-1 completes:** `story.json` content, documentation, and fixing what
run-1 reports. Nothing else.

**Blocked on:** `gh auth refresh -h github.com -s workflow`, then
`git push -u origin main`. If that auth flow is the sticking point, say so — there is a
version of this that proves the build without GitHub at all.

---

## D10 — D5 is testable, and its fixtures ship with Phase 2

**Status:** active · **Amends:** D5's "Enforced by: convention" · **Scope:** `Views/`,
`Tests/` · **Enforced by:** the four fixtures below, once Phase 2 lands

D5 was recorded as convention-only. That was wrong. Divider placement is a pure function:

    dividerIndices(messages) -> [Int]

Four fixtures, shipping **with** Phase 2 and not after it:

1. all messages on the same day — no dividers
2. day change with a 5-minute gap — no divider
3. day change with a 45-minute gap — one divider
4. a 40-minute exchange straddling midnight — no divider, one unbroken block

**Why this is a separate entry rather than an edit to D5:** this file is append-only, so
D5's "convention" line stands as written and is corrected here. This entry was not among
the three requested; it is recorded because the fixture specification would otherwise
exist only in chat, which is the exact failure this file was created to prevent. Say the
word and it comes out.

---

---

## D11 — the final cluster is 9 hours, anchored to end at the last message

**Status:** active · **Supersedes:** D8's 14 hours and D7's literal `-8665` · **Resolves:**
O1 · **Scope:** `Resources/story.json` · **Enforced by:** convention

D8's 14 hours was an arbitrary number. The goal was "not a 25-minute synchronised burst",
and nine hours does that just as well.

**The insight D8's measurement made visible:** same-calendar-day coverage is `24 - W`
hours, and if the window is anchored to *end* at the last message it always runs backwards
from midnight — so it always includes the evening, which is when this game gets opened.
Coverage is bought linearly by shortening `W`, not by moving the window.

    W = 14h  ->  41.7%
    W =  9h  ->  62.5%, covering launches 09:00-23:59

**As built, and verified:**

    -9180   +44 7700 900931   is this still ren's        <- earliest, sorts last
    -8940   Dave              Thursday between 12 and 4?
    -8760   Mom               ren did you go on thursday
    -8645   the flat          ren?
    -8640   the flat          is he with you             <- the anchor

Measured across all 1440 launch minutes: span 540 min, coverage **62.5%**, single window
**09:00-23:59**, evening fully covered. Thread order stays Notify, the flat, Mom, Dave,
`+44`. Ren's last reply at `-11466` is 1.6 days ahead of `+44`, so the D7 sequence holds.
All four cluster threads now read "6 days ago"; under D8's forward window `+44` read 6 and
the rest read 5.

**Spent:** the literal `-8665` and Phase 2b's "within the same hour". Neither was
load-bearing — every *property* D7 protects survives.

---

## D12 — a correction landing on an uneditable line becomes an entry, without asking

**Status:** active · **Scope:** `DECISIONS.md` · **Enforced by:** convention

D10 was added unasked, to record a correction to D5's `Enforced by` line that append-only
forbids editing. That was the mechanism working, not an overstep. Do it again: when a
ruling lands on a line that cannot be edited, append the entry and say so in the report.
Do not ask first, and do not leave the correction in chat.

---

## D13 — the local Mac build is the primary route, and a local green lifts D9

**VOID — superseded by D14 and D16.** This describes a platform that is no longer
targeted. Retained as history; do not act on it.

**Status:** active · **Amends:** D9 · **Scope:** everything · **Enforced by:** convention

D9 assumed run-1 meant CI. Four phases then waited on an OAuth scope grant, which made the
freeze a dependency on a human's browser rather than on the code.

Gates 1 and 2 need no GitHub. On a Mac that `doctor.sh` reports GREEN:

    xcodegen generate
    xcodebuild -project Unread.xcodeproj -scheme Unread \
      -destination "platform=iOS Simulator,name=<sim doctor.sh confirmed>" \
      CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build test

**A local green satisfies D9 and lifts the freeze.** CI and gate 3 (screenshots) stay open
and are still worth doing; they stop being what four phases of Swift are queued behind.

**Expect the first red to carry four phases of accumulated errors at once. Work them in
file order, not compiler order** — the compiler reports whatever it reached first, which
scatters one root cause across several files.

**Follow-on changes made under this entry:** `doctor.sh` no longer prints
`gh repo create` as the next command for a buildable Mac, and a missing `gh` is now
informational rather than an AMBER demotion — under D13 it would have changed the printed
next command for no reason. Re-verified against 13 stubbed environments.

---

## QUESTIONS

**O1 — does D7's literal `-8665` outrank D8's same-day scare?** · **RESOLVED by D11.**
Neither horn: the window shortened to 9 hours and anchored to end at the last message,
which keeps every property D7 protects and buys the evening. Recorded here rather than
deleted — this section was briefly removed while appending D11, which was itself a
violation of the append-only rule at the top of this file. Restored.

---

## D14 — the Swift is deleted, not ported

**Status:** decided · **Scope:** repo · **Enforced by:** absence of the files

A Mac is expected later (see D18). That does not make the existing Swift worth keeping. It
has never compiled. It is four phases of unverified reading, and when a Mac does arrive,
regenerating it from `story.json` and a working reference implementation will be faster and
more correct than debugging code no compiler has ever seen. Keeping it preserves the
illusion of progress, not the progress.

Deleted outright — not ported, not archived in a branch, not commented out:

    Unread/Models/StoryModels.swift
    Unread/Engine/StoryLoader.swift
    Unread/UnreadApp.swift
    Tests/StoryValidationTests.swift
    project.yml
    .github/workflows/gate.yml          (rewritten under D16, not kept)
    tools/doctor.sh

**Void as a consequence:** D2 (the `Models/` carve-out) and D13 (the local Mac build).
Marked, not deleted. D9's freeze is also spent — the compiler it waited on will never run.

**Survives untouched:** `Resources/story.json`, `tools/validate_story.py`,
`tools/beat_duration.py`, and D1, D5, D7, D8, D11.

**The `VOID` banners on D2 and D13 are edits to existing entries**, which the append-only
rule forbids. They are made because this entry instructs "mark them so; do not delete the
entries", and a reader who acts on a void entry does more damage than the banner does. No
existing wording was altered — only a line added above it.

---

## D15 — story.json stays the source; the HTML is generated

**Status:** decided · **Scope:** architecture · **Enforced by:** validator rule 15

The published implementation has its content inlined, which breaks the story/code
separation that is the reason this project survived nine phases of context loss. It is not
accepted as-is.

    Resources/story.json      the only place any line of dialogue exists
    src/engine.html           template: markup, CSS, engine. Zero story text.
    tools/build.py            story.json + src/engine.html -> dist/unread.html
    dist/unread.html          generated, gitignored, self-contained, publishable

`tools/build.py` injects the story as a single `<script>window.STORY = {...}</script>` at a
marked insertion point. One artifact file, no external fetch, and authors still never open
the engine.

**Rule 15:** no string literal longer than three words may appear in `src/engine.html`
outside CSS, comments, or the fixed UI-chrome allowlist (`Loop`, `Today`, `Yesterday`,
`now`, `Photo`, `Start again`, `A WORK OF FICTION`, weekday and month names). Story text in
the engine is a build failure. This is the web equivalent of the old string audit, and it
is what stops the inlining creeping back.

---

## D16 — CI moves to Linux, and gate 3 finally becomes cheap

**Status:** decided · **Scope:** `.github/workflows/gate.yml` · **Enforced by:** the workflow

Dropping Xcode removes the entire CI cost problem. `ubuntu-latest` bills at 1x, not the
macOS 10x. The 200-minutes-a-month constraint that shaped D9, D13 and half of Phase 1.5 is
gone.

The gate, all on `ubuntu-latest`: validate the story; report its shape; build
`dist/unread.html`; audit rule 15; drive the built file headless with Playwright through
every beat, screenshotting each boundary and asserting the expected text is on screen;
upload the screenshots.

`concurrency` with `cancel-in-progress` is kept. `paths-ignore` is dropped — at 1x it is
not worth an unverified glob.

**Step 5 is the gate this project never had.** On iOS it needed a Mac, a simulator and a
signed build. In a browser it is twenty lines of Playwright, and it verifies that the beats
fire, not merely that the code compiles.

---

## D17 — log the cost

**Status:** record · **Scope:** none · Written so a fresh session understands why the repo
has a hole in it.

Phases 1.5 through 2b built infrastructure for a platform that was never reachable, because
the blocking question — can this machine actually run Xcode — was asked repeatedly and
never answered, and neither agent treated the silence itself as the answer. Roughly four
phases of work were discarded.

**Rule for the rest of this project: if a gate has been blocked on the same external action
for two consecutive phases, that path is dead. Route around it or stop. Do not open new
scope behind an unanswered dependency.**

---

## D18 — iOS is deferred, not cancelled; the portability contract is three things

**Status:** decided · **Scope:** architecture constraint on all web work

A Mac is expected at some later point. Nothing in this phase forecloses a native build, and
nothing in this phase is done for it either — the way to arrive at iOS with the least work
is to arrive with a game that already works.

What carries across, and must therefore stay platform-neutral:

1. `Resources/story.json` — no web-specific fields. No CSS, no DOM, no millisecond values
   tied to browser behaviour. Timings stay in the abstract units v3 established.
2. `DECISIONS.md` — D1, D5, D7, D8, D11 are render and content rulings a SwiftUI renderer
   obeys identically.
3. The working web build — a reference implementation to port *from*. Porting from
   something that runs is a different activity from writing something that might.

**Constraint this places on W1:** keep the story-consuming layer of the engine thin and
separate from the DOM layer. A future native renderer should read the same `story.json` and
honour the same rulings without reverse-engineering anything.

**That is the entire cost of keeping iOS open. Do not pay more than that today** — no
abstraction layers, no shared-format ceremony, no "we might need this later" schema fields.

---

## D19 — rule 15 is replaced, not tightened

**Status:** decided · **Supersedes:** rule 15's word-count form · **Scope:** `src/`
**Enforced by:** construction, plus the old grep as a smoke test

`[delete this conversation]` passes at exactly three words. Tightening the threshold would
false-positive on real dialogue, because these characters answer "when?" with "tuesday".
The rule is the wrong *shape*, not the wrong number.

1. **Construction.** The engine has exactly one function that puts text into a message
   bubble or a choice label, and it accepts only values that came out of `window.STORY`.
   No other code path may assign `.textContent` or `.innerHTML` on a bubble or a choice.
   This makes story text in the engine impossible rather than merely detectable.
2. **Lint, kept and deliberately weakened.** The word-count grep stays as a cheap smoke
   test with its floor documented in the suite. It is now the second line, not the first.

A grep can be fooled by a short string. A single ingress point cannot.

---

## D20 — endings declare a mechanic; text stays in story.json

**Status:** decided · **Scope:** schema v5, `Ending` · **Enforced by:** validator

`ENDING_TIMING` keyed by ending id is not a leak. Endings are *behaviour*, not prose: the
silence ending is a typing indicator that never resolves, which is a mechanic and belongs
in the engine. What was wrong is that the binding was implicit.

`Ending.mechanic` is an enum:

- `linear` — deliver the closing messages, then the card. (found)
- `hold` — a typing indicator that never resolves, then the card. (silence)
- `reappear` — remove the thread, restore it after a delay with one new message. (delete)

A fourth ending reusing an existing mechanic needs zero engine work. A fourth ending
needing new behaviour legitimately needs engine work, and now says so in the schema.

---

## D21 — CI moves to `ci/gate.yml` and stops blocking anything

**Status:** decided · **Applies:** D17 · **Scope:** repo

`git push` is rejected *only* for commits touching `.github/workflows/`. Everything else
pushes with the token already present. Two phases have waited on a scope grant that has
not come, which is exactly the condition D17 says makes a path dead.

- The workflow moves to **`ci/gate.yml`**. Not a workflow path; pushes without the scope.
- A README line says to copy it to `.github/workflows/gate.yml` when the scope exists.
- **`tools/gate.sh` is the canonical gate.** It runs the validators, the build, the rule
  suites and Playwright locally and exits non-zero on any failure. That is what "green"
  means from now on.
- Push everything. Getting nine phases of work off a single machine matters more than CI.

CI stays unproven. That is now an accepted, recorded state rather than an open blocker.

---

## D22 — verify every append before reporting it

**Status:** decided · **Scope:** process · **Enforced by:** the append scripts

A `DECISIONS.md` append once silently did not land and was reported as success. After any
append, re-read the file and assert the new headings are present before reporting. A
decisions file that can silently drop a decision is worse than no decisions file, because
it is trusted.

---

## D23 — recovering artifacts is a standing procedure

**Status:** record · **Scope:** process

Files sent in chat never reach the filesystem. When a brief references an implementation
that cannot be found: list the published artifacts, fetch the relevant one by URL, and
work from that source. This is the documented route, not a workaround.

---

## D24 — the game runs on real elapsed time between sessions

**Status:** decided · **Scope:** architecture · **Enforced by:** the persistence tests

100 days at 20 minutes is not one sitting. The player closes the game and comes back, so
the game must know how long they were gone and act on it.

Persisted to `localStorage`: `runSeed` (random once, never regenerated), `day` (1..100),
`phase` (`day` | `night`), `phaseStartedAt`, `lastSeenAt` (written on `visibilitychange`
and unload), `flags`, `contactState`, `cluesFound`.

On return, `awayMs = now - lastSeenAt` branches:

| away | behaviour |
|---|---|
| < 2 min | resume in place, nothing changed |
| 2 min – 1 h | the phase advanced without you: 1-3 messages are already waiting, delivered as history, timestamped while you were gone |
| 1 h – 12 h | the phase completed. You may read what arrived but not reply — the reply options are gone |
| > 12 h | the day advanced. One day per 12 hours away, capped at +3 |

**"You can read it but not reply" is the mechanic.** Missing a message is a real loss,
permanent, and the game never says so. A player who leaves during Act II comes back to a
mother who was waiting for an answer that never came, and the thread has moved on.

This is also the notification hook with no server and no push permission: the phone kept
going while you were gone. Web Push stays a later option, never a dependency.

**Anti-abuse: none.** Clock-shifting is not defended against. A player who sets their
clock forward to skip is a player choosing to skip. Do not build a cheat check into a
horror game.

---

## D25 — the four-minute target is retired; Act I is the wall

**Status:** decided · **Supersedes:** the 4:00 beat-1 target from Phase 6a ·
**Scope:** content, `tools/beat_duration.py`

Beat 1 was designed to be boring for four solid minutes, and Phase 6a measured it at 3:20
and extended it to reach the target. All of that measured *playback* — messages arriving
one at a time behind typing indicators.

D24 made history render instantly, correctly, and the four minutes went with it. Played at
real speed, beat 1 is **75 messages, 293 words — about one minute of reading** at any
plausible speed. The target was not missed; it stopped being a measurable thing.

**Act I is the wall now.** Twenty days of nothing being wrong is a better version of the
same idea than four minutes of it, and it is the mechanic the ladder already implements.

**Consequence:** do not pad beat 1 to recover four minutes. Do not reintroduce a duration
target anywhere. `beat_duration.py` reports counts and live playback and states no target;
leave it that way. The thing to protect is the *twenty days*, not the four minutes.

---

## D26 — the player can always reply; decay is something that happens to other people

**Status:** decided · **Scope:** `src/director.js`, content · **Enforced by:** the gate

Act I's decay takes replies away from the cast. It must never take them away from the
player. A phase that offers the player nothing to say is a phase where the game has
stopped being a messaging app.

Day 10 night, as generated, offered **zero** choices. That is the bug this entry exists
to close.

1. **Every phase offers at least one reply.** The director guarantees it: if a phase's
   draw produces no choices, it draws again from the choice-bearing templates.
2. **The player's replies are never budget-limited.** `repliesRemaining` gates cast lines
   only. Nothing decays the player.
3. **Replies never run out across the run.** Templates repeat with different slot values,
   so the supply is unbounded by construction — the player can keep answering for a
   hundred days.

The one exception is D24's missed band: replies are gone because *the moment* has gone,
not because the player ran out. That is a different thing and it stays.

---

## D27 — replies that reveal something are clues, and clues are declared

**Status:** decided · **Scope:** `content/clues.json`, templates · **Enforced by:** validator

A reply that changes nothing is a button. Some replies should reveal something the player
can later realise mattered.

- `content/clues.json` declares each clue: an id, what it is, and the act that pays it off.
- A choice may carry `revealsClue`, which must resolve to a declared clue.
- Picking that choice writes the clue id into `cluesFound`, alongside the `tells` that
  already writes `lastToldByRen`.

**Validated both ways, because both directions are bugs:** a `revealsClue` naming a clue
that does not exist, and a declared clue that no choice can ever reveal. The second is the
orphan clue — content that can never be found, which is worse, because nothing fails.

Clues in Act I only accumulate. Nothing reads them until Act II, for the same reason
`lastToldByRen` is written from day one: memory cannot be retrofitted onto history the
player has already lived through.

---

## D28 — a reply belongs to the thread it answers

**Status:** decided · **Scope:** `src/engine.html` · **Enforced by:** the gate

Choices were rendered as one pool: opening Mom showed Dave's replies too, and answering
any of them consumed all of them. Nothing had ruled it wrong, and it would have read as
wrong the first time a human played day 3.

1. **A thread offers its own replies and nobody else's.** A pending choice carries the
   `threadId` of the template that produced it, and opening a thread renders only that
   thread's.
2. **Answering spends only that thread's replies.** The others are still there when you
   open the conversation they belong to.
3. **The reply lands in the thread as a message from you.** This is not a separate
   feature. A choice that vanishes without changing the conversation is a broken button,
   so per-thread choices are only half-built without it.

The authored beat-5 choices on day 1 are unaffected: they are the ending, they belong to
the one thread that matters at that moment, and they still end the run.

---

## D29 — a reply answers a question, not a thread

**Status:** decided · **Supersedes:** D28's grouping (D28's other two points stand) ·
**Scope:** `src/engine.html` · **Enforced by:** the gate

D28 made replies per-thread, and flagged what that still got wrong: if Mom asked about
the weekend *and* about the car in one phase, answering the weekend silently discarded
the ability to answer about the car. That is the same bug D28 fixed, one level down.

1. **Replies are grouped by the template that produced them.** Answering one question
   spends that question's replies and nothing else.
2. **A conversation offers one question's answers at a time**, oldest first. Four buttons
   at once is a wall; two, then two more when the first is answered, reads as working
   down a conversation.
3. **The later reply lands at the bottom**, after the messages that came in while it went
   unanswered. That is chronologically odd and exactly what a real messenger does when
   you reply late to something further up.

**Consequence for content:** a clue-revealing reply may sit behind an earlier question in
the same thread, and the player has to answer through to reach it. That is acceptable —
the clue is still reachable, and the gate proves all six are within days 1-10.

D28 stands on the other two points: a thread never shows another thread's replies, and
answering always lands the reply in the conversation as a message from the player.

---

## D30 — Act II is recall, and it costs the seed its independence

**Status:** decided · **Scope:** `content/`, `src/director.js` · **Enforced by:** the gate

Act II (days 21-60) reads what Act I wrote. Three shapes, deliberately only three:

- **a person half-remembers** — Mom quotes your promise back and it is not what happened
- **a person checks** — Dave waited twenty minutes for someone who said they would be in
- **the number quotes you exactly, to the wrong person** — it says back to you, in the
  unnamed thread, something you only ever said in the flat. It has read the other threads.

**Mechanics that make it work:**

1. **A choice records a `memory`: a tag and a fragment.** `tells` is prose *about* the
   player ("said he would come the weekend") and cannot go in anyone's mouth. The
   fragment is written as it will be said back ("you said you were coming saturday").
2. **A memory is quoted back once.** Twice is nagging; once, weeks later, is the mechanic.
3. **A memory nothing quotes is deleted, not kept.** An unread memory is the same waste as
   an orphan clue, and the validator rejects both. Sixteen were dropped for this.
4. **Act I's texture continues underneath.** Without it the world simply vanishes on day
   21 and Act II reads as a different game rather than the same one with something wrong
   in it. Seventy-one ordinary messages still arrive across days 21-40.

**The cost, and it is real: the director is no longer a pure function of the seed.**
Determinism is now *seed AND memory*. A bug report needs both to reproduce. The gate
asserts the property in that form, and separately asserts that the same Act II day plays
differently with and without memory — which is the mechanic existing at all.

**Act I is unchanged and must stay so.** The gate asserts Act I quotes the player back
exactly zero times. Twenty days of nothing being wrong is still the wall.
