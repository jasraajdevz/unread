#!/usr/bin/env python3
"""Validate Resources/story.json.

This is the exact mirror of Tests/StoryValidationTests.swift. Per CLAUDE.md rule 14,
the two must assert identical rules -- change both in the same commit or neither.

Runs on any machine with Python 3, in well under a second, so a dangling beat id is
caught before a 10x-billed macOS minute is ever spent.

    python3 tools/validate_story.py Unread/Resources/story.json
"""

import json
import os
import sys

PHOTO_EXTENSIONS = ("jpg", "jpeg", "png", "heic")
AUDIO_EXTENSIONS = ("m4a", "mp3", "wav", "caf", "aiff", "aif")

MESSAGE_KINDS = ("text", "photo", "audio", "system")
MESSAGE_SENDERS = ("them", "me", "system")

# Phase 2b. Older versions are rejected outright; there is no migration path and none
# should ever be added.

# Rule 13: date dividers are derived by the renderer from calendar-day changes, never
# authored. A system message whose body is a bare weekday name is a divider that came back.
WEEKDAY_NAMES = frozenset([
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "mon", "tue", "tues", "wed", "weds", "thu", "thur", "thurs", "fri", "sat", "sun",
    "today", "yesterday", "tomorrow",
])
SCHEMA_VERSION = 3

# Mirrors the Codable structs in Models/StoryModels.swift. A key listed as required
# here is non-optional in Swift; decoding fails on either side if it is absent.
SCHEMA = {
    "contact": {"required": {"id": str, "displayName": str, "accentHex": str},
                "optional": {}},
    "thread": {"required": {"id": str, "displayName": str, "startBeat": str, "pinned": bool},
               "optional": {"contactId": str, "participantIds": list, "startsUnread": bool}},
    "message": {"required": {"id": str, "from": str, "kind": str, "offsetMinutes": int,
                             "delayMs": int, "typingMs": int},
                "optional": {"body": str, "asset": str, "durationMs": int,
                             "live": bool, "fromContactId": str}},
    "choice": {"required": {"id": str, "label": str, "next": str},
               "optional": {"setsFlags": list}},
    "notification": {"required": {"afterSeconds": int, "title": str, "body": str, "resumeBeat": str},
                     "optional": {}},
    "beat": {"required": {"id": str, "threadId": str, "messages": list},
             "optional": {"setsFlags": list, "requiresFlags": list,
                          "choices": list, "notification": dict}},
    "ending": {"required": {"id": str, "requiresFlags": list, "beatId": str},
               "optional": {}},
}


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
                self.fail("%s: unknown key '%s' -- the Swift schema will ignore it silently, "
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
            self.fail("root: version is %r, but only version %d is supported. Version 2 was "
                      "superseded by Phase 2b, which added offsetMinutes and deleted authored "
                      "date dividers; there is no migration path"
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

        # -- mirrors testEveryEndingBeatExists
        for ending in story["endings"]:
            if ending.get("beatId") not in beat_ids:
                self.fail("ending '%s' points at beat '%s', which is not a known beat"
                          % (ending.get("id"), ending.get("beatId")))

        return self.errors

    def asset_exists(self, asset, extensions):
        # The Swift side asks Bundle.main, which flattens Resources/ subfolders, so a
        # match anywhere under Resources/ is the correct equivalent here.
        for root, _dirs, files in os.walk(self.resources_dir):
            for filename in files:
                stem, ext = os.path.splitext(filename)
                if stem == asset and ext.lstrip(".").lower() in extensions:
                    return True
        return False


def main(argv):
    if len(argv) != 2:
        print("usage: validate_story.py <path to story.json>", file=sys.stderr)
        return 2

    validator = Validator(argv[1])
    errors = validator.run()

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
