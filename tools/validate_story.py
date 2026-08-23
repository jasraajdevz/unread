#!/usr/bin/env python3
"""Validate Resources/story.json.

Checks the schema, the story graph, and -- with --engine -- rule 15, which keeps story
text out of the engine template.

Runs on any machine with Python 3 in well under a second, so a dangling beat id never
reaches a browser download.

    python3 tools/validate_story.py Resources/story.json
    python3 tools/validate_story.py Resources/story.json --engine src/engine.html
"""

import json
import os
import re
import sys

PHOTO_EXTENSIONS = ("jpg", "jpeg", "png", "heic")
AUDIO_EXTENSIONS = ("m4a", "mp3", "wav", "caf", "aiff", "aif")

MESSAGE_KINDS = ("text", "photo", "audio", "system")
MESSAGE_SENDERS = ("them", "me", "system")

# D20: an ending declares the behaviour the engine runs for it. A new value here is a
# deliberate statement that new engine work is needed.
ENDING_MECHANICS = ("linear", "hold", "reappear")

# Phase 2b. Older versions are rejected outright; there is no migration path and none
# should ever be added.

# Rule 13: date dividers are derived by the renderer from calendar-day changes, never
# authored. A system message whose body is a bare weekday name is a divider that came back.
WEEKDAY_NAMES = frozenset([
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "mon", "tue", "tues", "wed", "weds", "thu", "thur", "thurs", "fri", "sat", "sun",
    "today", "yesterday", "tomorrow",
])
SCHEMA_VERSION = 5

# The shape of story.json. A required key must be present; an optional one may be
# absent but must have the right type when it is there.
SCHEMA = {
    "contact": {"required": {"id": str, "displayName": str, "accentHex": str},
                "optional": {}},
    "thread": {"required": {"id": str, "displayName": str, "startBeat": str, "pinned": bool},
               "optional": {"contactId": str, "participantIds": list, "startsUnread": bool,
                            "accentHex": str}},
    "message": {"required": {"id": str, "from": str, "kind": str, "offsetMinutes": int,
                             "delayMs": int, "typingMs": int},
                "optional": {"body": str, "asset": str, "durationMs": int,
                             "live": bool, "fromContactId": str,
                             "showTimestamp": bool, "requiresFlags": list}},
    "choice": {"required": {"id": str, "label": str, "next": str},
               "optional": {"setsFlags": list}},
    "notification": {"required": {"afterSeconds": int, "title": str, "body": str, "resumeBeat": str},
                     "optional": {}},
    "beat": {"required": {"id": str, "threadId": str, "messages": list},
             "optional": {"setsFlags": list, "requiresFlags": list,
                          "choices": list, "notification": dict, "next": str}},
    "ending": {"required": {"id": str, "requiresFlags": list, "beatId": str,
                            "title": str, "body": str, "mechanic": str},
               "optional": {}},
}


# ---------------------------------------------------------------- rule 15 ----
# D15: story text must never appear in the engine. This is the web equivalent of the old
# string audit, and it is what stops the inlining creeping back.

RULE_15_ALLOWLIST = frozenset(x.lower() for x in [
    "Loop", "Today", "Yesterday", "now", "Photo", "Start again", "A WORK OF FICTION",
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
    "January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December",
    "Jan", "Feb", "Mar", "Apr", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
])

RULE_15_MAX_WORDS = 3


def _strip_blocks(text, open_tag, close_tag):
    out = []
    index = 0
    while True:
        start = text.find(open_tag, index)
        if start < 0:
            out.append(text[index:])
            return "".join(out)
        out.append(text[index:start])
        end = text.find(close_tag, start)
        index = len(text) if end < 0 else end + len(close_tag)


OPT_OUT = "not-story"


def _js_string_literals(source):
    """Walk a script body and yield (literal, line_number), skipping comments.

    Deliberately simple: it does not model regex literals, because the engine contains
    none. If one is ever added, this may mis-scan and should be revisited.
    """
    literals = []
    i, n, line = 0, len(source), 1
    while i < n:
        ch = source[i]
        if ch == "\n":
            line += 1
            i += 1
        elif ch == "/" and i + 1 < n and source[i + 1] == "/":
            newline = source.find("\n", i)
            i = n if newline < 0 else newline
        elif ch == "/" and i + 1 < n and source[i + 1] == "*":
            end = source.find("*/", i + 2)
            chunk = source[i:(n if end < 0 else end + 2)]
            line += chunk.count("\n")
            i = n if end < 0 else end + 2
        elif ch in "\"'`":
            quote, j, buf, start_line = ch, i + 1, [], line
            while j < n:
                if source[j] == "\\":
                    buf.append(source[j + 1] if j + 1 < n else "")
                    j += 2
                    continue
                if source[j] == quote:
                    break
                if source[j] == "\n":
                    line += 1
                buf.append(source[j])
                j += 1
            literals.append(("".join(buf), start_line))
            i = j + 1
        else:
            i += 1
    return literals


def _visible_words(text):
    """Words left after removing markup. A token counts only if it contains a letter or
    digit, so '<span>' and '<<' and '-' are not words."""
    stripped = re.sub(r"<[^>]*>", " ", text)
    stripped = re.sub(r"&[a-zA-Z#0-9]+;", " ", stripped)
    return [t for t in stripped.split() if re.search(r"[A-Za-z0-9]", t)]


def audit_engine(path):
    """Return a list of rule 15 violations in an engine template."""
    try:
        with open(path, encoding="utf-8") as handle:
            source = handle.read()
    except OSError as error:
        return ["engine template could not be read: %s" % error]

    source = _strip_blocks(source, "<!--", "-->")
    source = _strip_blocks(source, "<style", "</style>")

    lines = source.splitlines()

    def opted_out(line_number):
        """A literal is exempt if its own line, or the line above, carries the marker."""
        for index in (line_number - 1, line_number - 2):
            if 0 <= index < len(lines) and OPT_OUT in lines[index]:
                return True
        return False

    candidates = []
    remainder = source
    while True:
        start = remainder.find("<script")
        if start < 0:
            break
        body_start = remainder.find(">", start)
        end = remainder.find("</script>", body_start if body_start > 0 else start)
        if body_start < 0 or end < 0:
            break
        offset = source[:source.find(remainder[body_start + 1:end])].count("\n") \
            if remainder[body_start + 1:end] in source else 0
        for literal, line_number in _js_string_literals(remainder[body_start + 1:end]):
            candidates.append((literal, line_number + offset))
        remainder = remainder[:start] + " " + remainder[end + len("</script>"):]

    # whatever markup is left contributes its text nodes
    for text in re.sub(r"<[^>]*>", "\n", remainder).splitlines():
        candidates.append((text, None))

    violations = []
    for raw, line_number in candidates:
        normalised = " ".join(raw.split())
        if not normalised or normalised.lower() in RULE_15_ALLOWLIST:
            continue
        if line_number is not None and opted_out(line_number):
            continue
        words = _visible_words(normalised)
        if len(words) > RULE_15_MAX_WORDS:
            violations.append(
                "%d-word string literal in the engine: %r -- story text belongs in "
                "story.json (rule 15)" % (len(words), normalised[:90]))
    return violations


# ------------------------------------------------------------ content audit ----
# Gate 8: every template validates. Known cast, valid act range, resolvable flags,
# no orphan slot.

def audit_content(content_dir):
    problems = []

    def read(name):
        with open(os.path.join(content_dir, name), encoding="utf-8") as handle:
            return json.load(handle)

    try:
        cast = read("cast.json")
        templates = read("templates.json")
        ladder = read("ladder.json")
    except (OSError, ValueError) as error:
        return ["content bundle could not be read: %s" % error]

    cast_ids = {c["id"] for c in cast.get("cast", [])}
    acts = {a["id"] for a in ladder.get("acts", [])}
    act_range = (min(acts), max(acts)) if acts else (0, 0)

    produced = set()
    for template in templates.get("templates", []):
        produced.update(template.get("setsFlags") or [])

    seen_ids = set()
    for template in templates.get("templates", []):
        tid = template.get("id", "<no id>")
        if tid in seen_ids:
            problems.append("duplicate template id '%s'" % tid)
        seen_ids.add(tid)

        for speaker in {line.get("speaker") for line in template.get("lines", [])}:
            if speaker not in cast_ids:
                problems.append("template '%s' names speaker '%s', who is not in the cast"
                                % (tid, speaker))

        span = template.get("acts") or []
        if len(span) != 2 or span[0] > span[1]:
            problems.append("template '%s' has act range %r, which is not [low, high]"
                            % (tid, span))
        elif span[0] < act_range[0] or span[1] > act_range[1]:
            problems.append("template '%s' spans acts %r, but the ladder only defines %s"
                            % (tid, span, sorted(acts)))

        for flag in template.get("requiresFlags") or []:
            if flag not in produced:
                problems.append("template '%s' requires flag '%s', which no template sets"
                                % (tid, flag))

        # no orphan slot: every {SLOT} used is declared, and every declared slot is used
        slots = template.get("slots") or {}
        used = set()
        for line in template.get("lines", []):
            used.update(re.findall(r"\{([A-Z_]+)\}", line.get("text", "")))
        for choice in template.get("choices") or []:
            used.update(re.findall(r"\{([A-Z_]+)\}", choice.get("tells") or ""))
            used.update(re.findall(r"\{([A-Z_]+)\}", choice.get("label") or ""))
        for name in sorted(used - set(slots)):
            problems.append("template '%s' uses slot {%s}, which it does not declare" % (tid, name))
        for name in sorted(set(slots) - used):
            problems.append("template '%s' declares slot {%s}, which nothing uses" % (tid, name))
        for name, options in slots.items():
            if not isinstance(options, list) or not options:
                problems.append("template '%s' slot {%s} has no options" % (tid, name))

    days = [d.get("day") for d in ladder.get("days", [])]
    if days != sorted(days):
        problems.append("ladder days are not in order")
    budgets = [d.get("replyBudget") for d in ladder.get("days", [])]
    for i in range(1, len(budgets)):
        if budgets[i] > budgets[i - 1]:
            problems.append("ladder replyBudget rises at day %d (%.2f -> %.2f); Act I decays"
                            % (days[i], budgets[i - 1], budgets[i]))
    for entry in ladder.get("days", []):
        if entry.get("act") not in acts:
            problems.append("ladder day %s names act %r, which is not defined"
                            % (entry.get("day"), entry.get("act")))

    return problems


class Validator:
    def __init__(self, story_path):
        self.story_path = os.path.abspath(story_path)
        self.resources_dir = os.path.dirname(self.story_path)
        self.errors = []

    def fail(self, message):
        self.errors.append(message)

    # -- mirrors testStoryDecodesFromBundle ----------------------------------
    def check_shape(self, obj, kind, where):
        spec = SCHEMA[kind]
        if not isinstance(obj, dict):
            self.fail("%s: expected an object, found %s" % (where, type(obj).__name__))
            return False
        ok = True
        for key, expected in spec["required"].items():
            if key not in obj:
                self.fail("%s: missing required key '%s'" % (where, key))
                ok = False
            elif not self.is_type(obj[key], expected):
                self.fail("%s: key '%s' should be %s, found %s"
                          % (where, key, expected.__name__, type(obj[key]).__name__))
                ok = False
        for key, expected in spec["optional"].items():
            if key in obj and obj[key] is not None and not self.is_type(obj[key], expected):
                self.fail("%s: key '%s' should be %s, found %s"
                          % (where, key, expected.__name__, type(obj[key]).__name__))
                ok = False
        known = set(spec["required"]) | set(spec["optional"])
        for key in obj:
            if key not in known:
                self.fail("%s: unknown key '%s' -- the engine will ignore it silently, "
                          "so it is almost certainly a typo" % (where, key))
                ok = False
        return ok

    @staticmethod
    def is_type(value, expected):
        if expected is int:
            return isinstance(value, int) and not isinstance(value, bool)
        if expected is bool:
            return isinstance(value, bool)
        return isinstance(value, expected)

    # -- mirrors testIdentifiersAreUnique ------------------------------------
    def check_unique(self, ids, label):
        seen = set()
        for identifier in ids:
            if identifier in seen:
                self.fail("duplicate %s id '%s'" % (label, identifier))
            seen.add(identifier)

    def run(self):
        try:
            with open(self.story_path, encoding="utf-8") as handle:
                story = json.load(handle)
        except FileNotFoundError:
            self.fail("story file not found at %s" % self.story_path)
            return self.errors
        except json.JSONDecodeError as error:
            self.fail("story file is not valid JSON: %s" % error)
            return self.errors

        for key, expected in (("version", int), ("contacts", list), ("threads", list),
                              ("beats", list), ("endings", list)):
            if key not in story:
                self.fail("root: missing required key '%s'" % key)
            elif not self.is_type(story[key], expected):
                self.fail("root: key '%s' should be %s" % (key, expected.__name__))
        if self.errors:
            return self.errors

        for name in ("contacts", "threads", "beats"):
            if not story[name]:
                self.fail("root: '%s' is empty" % name)

        for index, contact in enumerate(story["contacts"]):
            self.check_shape(contact, "contact", "contacts[%d]" % index)
        for index, thread in enumerate(story["threads"]):
            self.check_shape(thread, "thread", "threads[%d]" % index)
        for index, ending in enumerate(story["endings"]):
            self.check_shape(ending, "ending", "endings[%d]" % index)
        for index, beat in enumerate(story["beats"]):
            where = "beats[%d]" % index
            if not self.check_shape(beat, "beat", where):
                continue
            for m_index, message in enumerate(beat["messages"]):
                self.check_shape(message, "message", "%s.messages[%d]" % (where, m_index))
            for c_index, choice in enumerate(beat.get("choices") or []):
                self.check_shape(choice, "choice", "%s.choices[%d]" % (where, c_index))
            if beat.get("notification") is not None:
                self.check_shape(beat["notification"], "notification", "%s.notification" % where)

        contact_ids = {c.get("id") for c in story["contacts"]}
        thread_ids = {t.get("id") for t in story["threads"]}
        beat_ids = {b.get("id") for b in story["beats"]}

        self.check_unique([c.get("id") for c in story["contacts"]], "contact")
        self.check_unique([t.get("id") for t in story["threads"]], "thread")
        self.check_unique([b.get("id") for b in story["beats"]], "beat")
        self.check_unique([e.get("id") for e in story["endings"]], "ending")
        for beat in story["beats"]:
            self.check_unique([m.get("id") for m in beat.get("messages", [])],
                              "message in beat '%s'" % beat.get("id"))
            self.check_unique([c.get("id") for c in (beat.get("choices") or [])],
                              "choice in beat '%s'" % beat.get("id"))

        # RULE 1 / RULE 14 -- schema version is exactly SCHEMA_VERSION; older files are
        # rejected, never migrated. A v2 file fails here naming the phase that moved it on.
        if story["version"] != SCHEMA_VERSION:
            self.fail("root: version is %r, but only version %d is supported. v3 was "
                      "superseded by Phase W2a, which added Ending.mechanic (D20); "
                      "there is no migration path"
                      % (story["version"], SCHEMA_VERSION))

        threads_by_id = {t.get("id"): t for t in story["threads"]}

        for thread in story["threads"]:
            thread_id = thread.get("id")

            # RULE 2 -- displayName is required and must carry something.
            if not (thread.get("displayName") or "").strip():
                self.fail("thread '%s' has an empty displayName" % thread_id)

            # RULE 3 -- contactId, when present, resolves.
            if "contactId" in thread and thread["contactId"] not in contact_ids:
                self.fail("thread '%s' has contactId '%s', which is not a known contact"
                          % (thread_id, thread["contactId"]))

            # RULE 4 -- participantIds, when present, is non-empty, duplicate-free and resolves.
            if "participantIds" in thread:
                participants = thread["participantIds"]
                if not participants:
                    self.fail("thread '%s' has an empty participantIds; omit the key instead"
                              % thread_id)
                seen = set()
                for participant in participants:
                    if not isinstance(participant, str):
                        self.fail("thread '%s' participantIds contains a non-string entry %r"
                                  % (thread_id, participant))
                        continue
                    if participant in seen:
                        self.fail("thread '%s' lists participant '%s' twice"
                                  % (thread_id, participant))
                    seen.add(participant)
                    if participant not in contact_ids:
                        self.fail("thread '%s' has participant '%s', which is not a known contact"
                                  % (thread_id, participant))

            if thread.get("startBeat") not in beat_ids:
                self.fail("thread '%s' has startBeat '%s', which is not a known beat"
                          % (thread_id, thread.get("startBeat")))

        for beat in story["beats"]:
            beat_id = beat.get("id")

            # -- mirrors testEveryBeatThreadExists
            if beat.get("threadId") not in thread_ids:
                self.fail("beat '%s' has threadId '%s', which is not a known thread"
                          % (beat_id, beat.get("threadId")))

            # -- mirrors testEveryChoiceTargetExists
            for choice in beat.get("choices") or []:
                if choice.get("next") not in beat_ids:
                    self.fail("choice '%s' in beat '%s' points at '%s', which is not a known beat"
                              % (choice.get("id"), beat_id, choice.get("next")))

            # -- mirrors testEveryNotificationResumeBeatExists
            notification = beat.get("notification")
            if notification and notification.get("resumeBeat") not in beat_ids:
                self.fail("beat '%s' notification resumes at '%s', which is not a known beat"
                          % (beat_id, notification.get("resumeBeat")))

            for message in beat.get("messages", []):
                message_id = message.get("id")
                kind = message.get("kind")
                sender = message.get("from")

                if kind not in MESSAGE_KINDS:
                    self.fail("message '%s' in beat '%s' has kind '%s', which is not one of %s"
                              % (message_id, beat_id, kind, ", ".join(MESSAGE_KINDS)))
                    continue
                if sender not in MESSAGE_SENDERS:
                    self.fail("message '%s' in beat '%s' has from '%s', which is not one of %s"
                              % (message_id, beat_id, sender, ", ".join(MESSAGE_SENDERS)))

                thread = threads_by_id.get(beat.get("threadId")) or {}
                participants = thread.get("participantIds")
                speaker = message.get("fromContactId")

                # RULE 5 -- fromContactId, when present, resolves to a contact.
                if speaker is not None and speaker not in contact_ids:
                    self.fail("message '%s' in beat '%s' has fromContactId '%s', "
                              "which is not a known contact" % (message_id, beat_id, speaker))

                # RULE 6 -- fromContactId belongs to this thread, and only `them` may carry it.
                if speaker is not None:
                    if sender != "them":
                        self.fail("message '%s' in beat '%s' is from '%s' but carries a "
                                  "fromContactId; only 'them' messages name a speaker"
                                  % (message_id, beat_id, sender))
                    allowed = set(participants or [])
                    if thread.get("contactId"):
                        allowed.add(thread["contactId"])
                    if allowed and speaker not in allowed:
                        self.fail("message '%s' in beat '%s' names speaker '%s', who is not in "
                                  "thread '%s' (%s)"
                                  % (message_id, beat_id, speaker, thread.get("id"),
                                     ", ".join(sorted(allowed)) or "no members"))

                # RULE 7 -- the load-bearing one. A non-live message renders instantly, so a
                # non-zero delay or typing time is dead data that silently misleads anyone
                # reading the file or measuring it. Error, never a warning.
                if message.get("live") is not True:
                    for field in ("delayMs", "typingMs"):
                        value = message.get(field, 0)
                        # A wrong-typed value is already reported by the shape check; re-reporting
                        # it here would crash on the format string and hide every later error.
                        if not self.is_type(value, int):
                            continue
                        if value:
                            self.fail("message '%s' in beat '%s' is not live but has %s %d; "
                                      "history renders instantly, so it must be 0"
                                      % (message_id, beat_id, field, value))

                # RULE 8 -- in a multi-speaker thread every `them` message must name its speaker,
                # otherwise the group chat renders as one person arguing with themselves.
                if participants and sender == "them" and speaker is None:
                    self.fail("message '%s' in beat '%s' is in multi-participant thread '%s' "
                              "but has no fromContactId"
                              % (message_id, beat_id, thread.get("id")))

                # RULE 12 -- the future is only reachable live. This is what keeps beat 3
                # honest: nothing may claim to be from the future unless it is actually
                # arriving in the present.
                offset = message.get("offsetMinutes")
                if self.is_type(offset, int) and offset > 0 and message.get("live") is not True:
                    self.fail("message '%s' in beat '%s' has offsetMinutes %d, which is in the "
                              "future, but is not live" % (message_id, beat_id, offset))

                # RULE 13 -- date dividers are derived by the renderer, never authored.
                if kind == "system":
                    label = (message.get("body") or "").strip().strip("-— ").lower()
                    if label in WEEKDAY_NAMES:
                        self.fail("message '%s' in beat '%s' is a system message whose body is "
                                  "the bare day name %r; date dividers are derived from "
                                  "offsetMinutes, not authored"
                                  % (message_id, beat_id, message.get("body")))

                # -- mirrors testEveryReferencedAssetIsInBundle
                if kind in ("text", "system"):
                    if message.get("asset") is not None:
                        self.fail("message '%s' in beat '%s' is kind '%s' but names an asset"
                                  % (message_id, beat_id, kind))
                    # -- mirrors testTextMessagesHaveBodies
                    if not (message.get("body") or ""):
                        self.fail("message '%s' in beat '%s' is kind '%s' but has no body"
                                  % (message_id, beat_id, kind))
                    continue

                extensions = PHOTO_EXTENSIONS if kind == "photo" else AUDIO_EXTENSIONS
                asset = message.get("asset")
                if not asset:
                    self.fail("message '%s' in beat '%s' is kind '%s' but has no asset"
                              % (message_id, beat_id, kind))
                    continue
                if not self.asset_exists(asset, extensions):
                    self.fail("asset '%s' referenced by message '%s' in beat '%s' is not in "
                              "Resources (tried extensions: %s)"
                              % (asset, message_id, beat_id, ", ".join(extensions)))

        # RULE 10 -- within a beat, offsetMinutes is non-decreasing in message order.
        for beat in story["beats"]:
            previous = None
            previous_id = None
            for message in beat.get("messages", []):
                offset = message.get("offsetMinutes")
                if not self.is_type(offset, int):
                    continue
                if previous is not None and offset < previous:
                    self.fail("message '%s' in beat '%s' has offsetMinutes %d, which is earlier "
                              "than '%s' at %d immediately before it"
                              % (message.get("id"), beat.get("id"), offset, previous_id, previous))
                previous, previous_id = offset, message.get("id")

        # RULE 11 -- across a thread's beats in reachable order, offsetMinutes is
        # non-decreasing. Checked per edge, which stays well defined once beats branch.
        beats_by_id = {b.get("id"): b for b in story["beats"]}

        def offsets_of(beat):
            return [m.get("offsetMinutes") for m in beat.get("messages", [])
                    if self.is_type(m.get("offsetMinutes"), int)]

        for beat in story["beats"]:
            outgoing = [c.get("next") for c in (beat.get("choices") or [])]
            notification = beat.get("notification")
            if notification:
                outgoing.append(notification.get("resumeBeat"))
            if beat.get("next"):
                outgoing.append(beat["next"])
            here = offsets_of(beat)
            if not here:
                continue
            for target_id in outgoing:
                target = beats_by_id.get(target_id)
                if target is None:
                    continue
                there = offsets_of(target)
                if there and there[0] < here[-1]:
                    self.fail("beat '%s' ends at offsetMinutes %d but leads to beat '%s' which "
                              "starts at %d, going backwards in time"
                              % (beat.get("id"), here[-1], target_id, there[0]))

        # RULE 16 -- every ending declares a mechanic the engine implements (D20).
        for ending in story["endings"]:
            mechanic = ending.get("mechanic")
            if mechanic not in ENDING_MECHANICS:
                self.fail("ending '%s' declares mechanic %r, which is not one of %s. A new "
                          "mechanic is new engine work and must be added deliberately."
                          % (ending.get("id"), mechanic, ", ".join(ENDING_MECHANICS)))

        # -- mirrors testEveryEndingBeatExists
        for ending in story["endings"]:
            if ending.get("beatId") not in beat_ids:
                self.fail("ending '%s' points at beat '%s', which is not a known beat"
                          % (ending.get("id"), ending.get("beatId")))

        return self.errors

    def asset_exists(self, asset, extensions):
        # Assets may sit in any subfolder of Resources/, so match anywhere beneath it.
        for root, _dirs, files in os.walk(self.resources_dir):
            for filename in files:
                stem, ext = os.path.splitext(filename)
                if stem == asset and ext.lstrip(".").lower() in extensions:
                    return True
        return False


def main(argv):
    positional = []
    skip = False
    for index, arg in enumerate(argv[1:], start=1):
        if skip:
            skip = False
            continue
        if arg in ("--engine", "--content"):
            skip = True
            continue
        if arg.startswith("-"):
            continue
        positional.append(arg)
    if len(positional) != 1:
        print("usage: validate_story.py <path to story.json> [--engine <engine.html>]",
              file=sys.stderr)
        return 2
    argv = [argv[0], positional[0]] + argv[1:]

    validator = Validator(argv[1])
    errors = validator.run()

    # RULE 15 -- audit the engine template if one is present beside the story.
    engine = None
    if "--engine" in argv:
        engine = argv[argv.index("--engine") + 1]
    else:
        root = os.path.dirname(os.path.dirname(validator.story_path))
        candidate = os.path.join(root, "src", "engine.html")
        if os.path.exists(candidate):
            engine = candidate
    if engine:
        errors = errors + audit_engine(engine)

    content_dir = None
    if "--content" in argv:
        content_dir = argv[argv.index("--content") + 1]
    else:
        root = os.path.dirname(os.path.dirname(validator.story_path))
        candidate = os.path.join(root, "content")
        if os.path.isdir(candidate):
            content_dir = candidate
    if content_dir:
        errors = errors + audit_content(content_dir)

    if errors:
        print("story validation FAILED (%d problem%s)"
              % (len(errors), "" if len(errors) == 1 else "s"), file=sys.stderr)
        for error in errors:
            print("  - %s" % error, file=sys.stderr)
        return 1

    print("story validation PASSED: %s" % validator.story_path)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
