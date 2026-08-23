#!/usr/bin/env python3
"""Report the shape of story.json: message counts, and playback time where it exists.

A measurement tool, not a validator. It reports and always exits 0 -- the gate is
tools/validate_story.py.

    python3 tools/beat_duration.py
    python3 tools/beat_duration.py --selftest

Phase 2a repointed this tool. It used to measure a 4:00 playback target for beat 1, which
was wrong twice over: beat 1 is history, so it has no playback at all, and the thing that
actually matters there is how long a person takes to READ it. No script can measure that.
The target is gone. A human measures reading time in the harness; this reports counts.

Playback time is computed only for `live: true` messages, using:

    typingMs   as authored           `them` only; `me` messages do not type
    delayMs    as authored
    divider    flat 700ms for a `system` message, regardless of what it carries

Non-live messages contribute 0. Validator rule 7 already guarantees their delayMs and
typingMs are zero, so this agrees with the file rather than papering over it.
"""

import json
import os
import sys

DIVIDER_MS = 700
DEFAULT_STORY = os.path.join("Unread", "Resources", "story.json")


def is_live(message):
    return bool(message.get("live", False))


def measure_beat(beat):
    """Return (live_ms, messages, dividers, live_count) for one beat."""
    live_ms = 0
    messages = 0
    dividers = 0
    live_count = 0

    for message in beat.get("messages", []):
        if message.get("kind") == "system":
            dividers += 1
            if is_live(message):
                live_ms += DIVIDER_MS
                live_count += 1
            continue

        messages += 1
        if not is_live(message):
            continue

        live_count += 1
        live_ms += message.get("delayMs", 0)
        if message.get("from") == "them":
            live_ms += message.get("typingMs", 0)

    return live_ms, messages, dividers, live_count


def human(minutes):
    """Render an offsetMinutes as the distance a person would read off a screen."""
    if minutes is None:
        return "--"
    if minutes == 0:
        return "now"
    magnitude = abs(minutes)
    if magnitude < 60:
        unit = "%d minute%s" % (magnitude, "" if magnitude == 1 else "s")
    elif magnitude < 1440:
        hours = magnitude // 60
        unit = "%d hour%s" % (hours, "" if hours == 1 else "s")
    else:
        days = magnitude // 1440
        unit = "%d day%s" % (days, "" if days == 1 else "s")
    return unit + (" ago" if minutes < 0 else " from now")


def measure(story):
    """Return (rows, totals). A row is (name, messages, dividers, live_count, live_ms,
    earliest, latest), ordered by latest offsetMinutes descending -- the same ordering the
    thread list uses, so this report shows what the player will actually see on top."""
    beats_by_thread = {}
    for beat in story.get("beats", []):
        beats_by_thread.setdefault(beat.get("threadId"), []).append(beat)

    rows = []
    totals = {"messages": 0, "dividers": 0, "live": 0, "live_ms": 0}

    for thread in story.get("threads", []):
        name = thread.get("displayName", thread.get("id"))
        live_ms = messages = dividers = live_count = 0
        offsets = []
        for beat in beats_by_thread.get(thread.get("id"), []):
            beat_ms, beat_messages, beat_dividers, beat_live = measure_beat(beat)
            live_ms += beat_ms
            messages += beat_messages
            dividers += beat_dividers
            live_count += beat_live
            offsets.extend(m.get("offsetMinutes") for m in beat.get("messages", [])
                           if isinstance(m.get("offsetMinutes"), int))
        earliest = min(offsets) if offsets else None
        latest = max(offsets) if offsets else None
        rows.append((name, messages, dividers, live_count, live_ms, earliest, latest))
        totals["messages"] += messages
        totals["dividers"] += dividers
        totals["live"] += live_count
        totals["live_ms"] += live_ms

    rows.sort(key=lambda row: (row[6] is not None, row[6]), reverse=True)
    return rows, totals


def clock(ms):
    seconds = int(round(ms / 1000.0))
    return "%d:%02d" % (seconds // 60, seconds % 60)


def report(rows, totals):
    width = max([len(row[0]) for row in rows] + [12])
    print("thread list order is max(offsetMinutes) descending -- top row is what the player")
    print("sees first when the app opens.\n")
    print("%-*s  %5s  %5s  %9s  %-26s" % (width, "thread", "msgs", "live", "playback", "span"))
    print("-" * (width + 52))
    for name, messages, dividers, live_count, live_ms, earliest, latest in rows:
        playback = "%.1fs" % (live_ms / 1000.0) if live_count else "--"
        span = "%s -> %s" % (human(earliest), human(latest))
        print("%-*s  %5d  %5d  %9s  %-26s" % (width, name, messages, live_count, playback, span))

    print("-" * (width + 52))
    playback = "%.1fs" % (totals["live_ms"] / 1000.0) if totals["live"] else "--"
    print("%-*s  %5d  %5d  %9s" % (width, "TOTAL", totals["messages"], totals["live"], playback))

    if totals["dividers"]:
        print("\n%d authored divider message(s) remain -- Phase 2b deleted these; the renderer"
              % totals["dividers"])
        print("derives day breaks from offsetMinutes. Validator rule 13 should have caught this.")

    if totals["live"]:
        print("\nplayback %s = %s across %d live message(s)"
              % (playback, clock(totals["live_ms"]), totals["live"]))
    else:
        print("\nno live messages: this is all history and renders instantly.")
        print("reading time is not measurable here -- time a human in the harness.")


# ---------------------------------------------------------------- selftest ----

def selftest():
    """Hand-computed fixture. Non-live contributes nothing; live is summed as authored.

        them  live   typing 1400 + delay 1000                      = 2400
        me    live   typing ignored for `me`, delay 500             =  500
        system live  flat divider                                   =  700
        them  history (live absent)                                 =    0
        me    history (live false)                                  =    0
        system history                                              =    0
                                                              live total = 3600
        counted: 4 messages, 2 dividers, 3 live
    """
    fixture = {
        "version": 3,
        "contacts": [{"id": "c", "displayName": "Fixture", "accentHex": "#000000"}],
        "threads": [{"id": "t", "displayName": "Fixture", "contactId": "c",
                     "startBeat": "b", "pinned": False}],
        "beats": [{
            "id": "b", "threadId": "t",
            "messages": [
                {"id": "1", "from": "them",   "kind": "text",   "body": "x", "live": True,
                 "offsetMinutes": -10, "delayMs": 1000, "typingMs": 1400},
                {"id": "2", "from": "me",     "kind": "text",   "body": "x", "live": True,
                 "offsetMinutes": -10, "delayMs": 500,  "typingMs": 9999},
                {"id": "3", "from": "system", "kind": "system", "body": "x", "live": True,
                 "offsetMinutes": -10, "delayMs": 0,    "typingMs": 0},
                {"id": "4", "from": "them",   "kind": "text",   "body": "x",
                 "offsetMinutes": -10, "delayMs": 0,    "typingMs": 0},
                {"id": "5", "from": "me",     "kind": "text",   "body": "x", "live": False,
                 "offsetMinutes": -10, "delayMs": 0,    "typingMs": 0},
                {"id": "6", "from": "system", "kind": "system", "body": "x",
                 "offsetMinutes": -10, "delayMs": 0,    "typingMs": 0},
            ],
        }],
        "endings": [],
    }

    rows, totals = measure(fixture)
    _, messages, dividers, live_count, live_ms, earliest, latest = rows[0]

    checks = [
        ("live playback ms",           live_ms,        3600),
        ("me typingMs ignored",        live_ms < 9999, True),
        ("counted messages",           messages,       4),
        ("counted dividers",           dividers,       2),
        ("live count",                 live_count,     3),
        ("live absent means history",  is_live({}),    False),
        ("live false means history",   is_live({"live": False}), False),
        ("live true",                  is_live({"live": True}),  True),
        ("totals agree",               totals["live_ms"], 3600),
        ("clock 3600ms",               clock(3600),    "0:04"),
        ("span earliest",              earliest,       -10),
        ("span latest",                latest,         -10),
        ("human days",                 human(-8640),   "6 days ago"),
        ("human hours",                human(-120),    "2 hours ago"),
        ("human one minute",           human(-1),      "1 minute ago"),
        ("human now",                  human(0),       "now"),
        ("human future",               human(30),      "30 minutes from now"),
        ("human none",                 human(None),    "--"),
    ]

    failures = 0
    for label, got, want in checks:
        hit = got == want
        failures += not hit
        print("  %s  %-28s got %-8r want %r" % ("PASS" if hit else "FAIL", label, got, want))

    print("\n%d/%d arithmetic checks passed" % (len(checks) - failures, len(checks)))
    return failures == 0


def main(argv):
    if "--selftest" in argv:
        selftest()
        return 0

    path = next((a for a in argv[1:] if not a.startswith("-")), DEFAULT_STORY)
    try:
        with open(path, encoding="utf-8") as handle:
            story = json.load(handle)
    except (OSError, ValueError) as error:
        print("could not read %s: %s" % (path, error), file=sys.stderr)
        return 0

    rows, totals = measure(story)
    report(rows, totals)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
