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

# Mirrors the Codable structs in Models/StoryModels.swift. A key listed as required
# here is non-optional in Swift; decoding fails on either side if it is absent.
SCHEMA = {
    "contact": {"required": {"id": str, "displayName": str, "accentHex": str},
                "optional": {}},
    "thread": {"required": {"id": str, "contactId": str, "startBeat": str, "pinned": bool},
               "optional": {}},
    "message": {"required": {"id": str, "from": str, "kind": str, "delayMs": int, "typingMs": int},
                "optional": {"body": str, "asset": str, "durationMs": int}},
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

        # -- mirrors testEveryThreadContactExists / testEveryThreadStartBeatExists
        for thread in story["threads"]:
            if thread.get("contactId") not in contact_ids:
                self.fail("thread '%s' has contactId '%s', which is not a known contact"
                          % (thread.get("id"), thread.get("contactId")))
            if thread.get("startBeat") not in beat_ids:
                self.fail("thread '%s' has startBeat '%s', which is not a known beat"
                          % (thread.get("id"), thread.get("startBeat")))

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
