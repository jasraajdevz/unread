#!/usr/bin/env python3
"""Build dist/unread.html from Resources/story.json + src/engine.html.

D15: story.json is the only place a line of dialogue exists. The engine is a template
with a single insertion point; this injects the story as one inline script so the output
is a self-contained file with no external fetch.

    python3 tools/build.py
    python3 tools/build.py --check      # verify the output is current, build nothing

Exit 1 on any failure. The gate runs this before the browser ever opens the result.
"""

import io
import json
import os
import sys

MARKER = "<!--STORY-->"
CONTENT_MARKER = "<!--CONTENT-->"
DIRECTOR_MARKER = "<!--DIRECTOR-->"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORY = os.path.join(ROOT, "Resources", "story.json")
ENGINE = os.path.join(ROOT, "src", "engine.html")
DIRECTOR = os.path.join(ROOT, "src", "director.js")
CONTENT_DIR = os.path.join(ROOT, "content")
OUT = os.path.join(ROOT, "dist", "unread.html")

DOCTYPE = "<!doctype html>\n<html lang=\"en\">\n"
CLOSE = "\n</html>\n"


def escape_for_script(payload):
    """`</script>` inside a JSON string would close the tag early. U+2028/9 are valid in
    JSON but are line terminators in older JS parsers."""
    return (payload
            .replace("<", "\\u003c")
            .replace(">", "\\u003e")
            .replace(" ", "\\u2028")
            .replace(" ", "\\u2029"))


def build():
    try:
        with io.open(STORY, encoding="utf-8") as handle:
            story = json.load(handle)
    except (OSError, ValueError) as error:
        print("cannot read %s: %s" % (STORY, error), file=sys.stderr)
        return None

    try:
        with io.open(ENGINE, encoding="utf-8") as handle:
            engine = handle.read()
    except OSError as error:
        print("cannot read %s: %s" % (ENGINE, error), file=sys.stderr)
        return None

    for marker in (MARKER, CONTENT_MARKER, DIRECTOR_MARKER):
        if engine.count(marker) != 1:
            print("%s must contain exactly one %s (found %d)"
                  % (ENGINE, marker, engine.count(marker)), file=sys.stderr)
            return None
    if engine.count(MARKER) != 1:
        print("%s must contain exactly one %s insertion point (found %d)"
              % (ENGINE, MARKER, engine.count(MARKER)), file=sys.stderr)
        return None

    bundle = {}
    for name in ("cast", "templates", "ladder"):
        path = os.path.join(CONTENT_DIR, name + ".json")
        try:
            with io.open(path, encoding="utf-8") as handle:
                bundle[name] = json.load(handle)
        except (OSError, ValueError) as error:
            print("cannot read %s: %s" % (path, error), file=sys.stderr)
            return None

    try:
        with io.open(DIRECTOR, encoding="utf-8") as handle:
            director = handle.read()
    except OSError as error:
        print("cannot read %s: %s" % (DIRECTOR, error), file=sys.stderr)
        return None

    def inline(obj):
        return escape_for_script(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))

    engine = engine.replace(MARKER, "<script>window.STORY=%s;</script>" % inline(story), 1)
    engine = engine.replace(CONTENT_MARKER,
                            "<script>window.CONTENT=%s;</script>" % inline(bundle), 1)
    engine = engine.replace(DIRECTOR_MARKER, "<script>\n%s\n</script>" % director, 1)
    return DOCTYPE + engine + CLOSE


def main(argv):
    html = build()
    if html is None:
        return 1

    if "--check" in argv:
        if not os.path.exists(OUT):
            print("dist/unread.html does not exist; run tools/build.py", file=sys.stderr)
            return 1
        with io.open(OUT, encoding="utf-8") as handle:
            if handle.read() != html:
                print("dist/unread.html is stale; run tools/build.py", file=sys.stderr)
                return 1
        print("dist/unread.html is current")
        return 0

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(html)

    size = os.path.getsize(OUT)
    with io.open(STORY, encoding="utf-8") as handle:
        story = json.load(handle)
    print("built %s" % os.path.relpath(OUT, ROOT))
    print("  %.0f KB, self-contained, story schema v%s" % (size / 1024.0, story["version"]))
    print("  %d threads, %d beats, %d messages, %d endings"
          % (len(story["threads"]), len(story["beats"]),
             sum(len(b["messages"]) for b in story["beats"]), len(story["endings"])))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
