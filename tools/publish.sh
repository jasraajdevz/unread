#!/usr/bin/env bash
# D41: the playable build lives in a second, public repo, because dist/ is gitignored
# here and the source repo stays shut. This is the only thing that should ever put it
# there, and it refuses to publish anything the gate has not passed.
#
#   bash tools/publish.sh                 gate, build, push, then prove it is live
#   bash tools/publish.sh --dry-run       say what would go; change nothing, anywhere
#   bash tools/publish.sh --skip-gate     only when you just ran it yourself
#   bash tools/publish.sh --allow-dirty   publish from an uncommitted tree
#
# Overridable: UNREAD_MIRROR_REPO, UNREAD_MIRROR_DIR, UNREAD_LIVE_URL

set -uo pipefail
cd "$(dirname "$0")/.."

MIRROR_REPO="${UNREAD_MIRROR_REPO:-jasraajdevz/unread-play}"
# Not a sibling of this repo: the parent directory is itself a git repo that does not
# ignore this name, and a checkout there would show up as untracked in someone
# else's project. A cache directory belongs to nobody.
MIRROR_DIR="${UNREAD_MIRROR_DIR:-$HOME/.cache/unread-play}"
LIVE_URL="${UNREAD_LIVE_URL:-https://jasraajdevz.github.io/unread-play/}"
BUILT="dist/unread.html"

SKIP_GATE=0; DRY=0; ALLOW_DIRTY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run)     DRY=1 ;;
    --skip-gate)   SKIP_GATE=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    -h|--help)     sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf 'unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

say()  { printf '\n=== %s\n' "$*"; }
die()  { printf '\nPUBLISH RED — %s\n' "$*" >&2; exit 1; }
note() { printf '    %s\n' "$*"; }

PY=python3
command -v python3 >/dev/null 2>&1 || PY=python
command -v gh   >/dev/null 2>&1 || die "gh is not installed"
command -v curl >/dev/null 2>&1 || die "curl is not installed"

# A fresh clone inherits nothing, and this machine has no global identity: the source
# repo carries its own. Borrow it, and fall back to the account gh is signed in as.
GIT_NAME="$(git config user.name || true)"
GIT_EMAIL="$(git config user.email || true)"
if [ -z "$GIT_NAME" ] || [ -z "$GIT_EMAIL" ]; then
  GH_LOGIN="$(gh api user -q '.login' 2>/dev/null)"
  [ -n "$GH_LOGIN" ] || die "no git identity here and gh cannot say who you are"
  GIT_NAME="${GIT_NAME:-$GH_LOGIN}"
  GIT_EMAIL="${GIT_EMAIL:-$GH_LOGIN@users.noreply.github.com}"
fi

# ---------------------------------------------------------------------------
say "the source tree"
SHA="$(git rev-parse --short HEAD)"
SUBJECT="$(git log -1 --pretty=%s)"
note "$SHA  $SUBJECT"
if [ -n "$(git status --porcelain)" ]; then
  if [ "$ALLOW_DIRTY" -eq 1 ]; then
    note "uncommitted changes, publishing anyway (--allow-dirty)"
    SHA="$SHA-dirty"
  else
    git status --short
    die "uncommitted changes: what goes live would match no commit. Commit, or --allow-dirty."
  fi
fi

# ---------------------------------------------------------------------------
if [ "$SKIP_GATE" -eq 1 ]; then
  say "the gate"
  note "SKIPPED. Nothing has checked that what is about to be public works."
else
  say "the gate"
  if bash tools/gate.sh; then
    note "green"
  else
    die "the gate is red. A public URL is the last place to find that out."
  fi
fi

say "the build"
$PY tools/build.py || die "the build failed"
[ -f "$BUILT" ] || die "$BUILT is missing after a successful build"
LOCAL_HASH="$(sha256sum "$BUILT" | cut -d' ' -f1)"
note "$(du -h "$BUILT" | cut -f1)  ${LOCAL_HASH:0:12}"

# ---------------------------------------------------------------------------
say "the mirror"
if [ -d "$MIRROR_DIR/.git" ]; then
  note "$MIRROR_DIR"
  git -C "$MIRROR_DIR" fetch -q origin || die "cannot reach the mirror's origin"
  git -C "$MIRROR_DIR" checkout -q main || die "the mirror has no main branch"
  git -C "$MIRROR_DIR" reset -q --hard origin/main
else
  note "cloning $MIRROR_REPO into $MIRROR_DIR"
  [ "$DRY" -eq 1 ] && { note "(dry run: not cloning)"; exit 0; }
  gh repo clone "$MIRROR_REPO" "$MIRROR_DIR" -- -q \
    || die "cannot clone $MIRROR_REPO. Create it first, or set UNREAD_MIRROR_REPO."
fi

# Git on Windows checks out LF blobs as CRLF, which makes every tracked file read as
# modified and would make the byte comparison against the live site meaningless. Turn it
# off, write the rule down, and re-materialise the working tree from the blobs before
# anything is compared to anything.
git -C "$MIRROR_DIR" config core.autocrlf false
git -C "$MIRROR_DIR" config core.eol lf
printf '* -text\n' > "$MIRROR_DIR/.gitattributes"
git -C "$MIRROR_DIR" checkout -q --force -- . 2>/dev/null
: > "$MIRROR_DIR/.nojekyll"
cp "$BUILT" "$MIRROR_DIR/index.html"

if [ -z "$(git -C "$MIRROR_DIR" status --porcelain)" ]; then
  note "already identical to what is published"
  PUSHED=0
else
  git -C "$MIRROR_DIR" --no-pager diff --stat HEAD | sed 's/^/    /'
  if [ "$DRY" -eq 1 ]; then
    say "dry run"
    note "would commit and push the above, then verify $LIVE_URL"
    git -C "$MIRROR_DIR" checkout -q -- . 2>/dev/null
    exit 0
  fi
  git -C "$MIRROR_DIR" add -A
  git -C "$MIRROR_DIR" -c user.name="$GIT_NAME" -c user.email="$GIT_EMAIL" \
      commit -q -m "Deploy $SHA — $SUBJECT" || die "the mirror commit failed"
  git -C "$MIRROR_DIR" push -q origin main || die "the push failed"
  note "pushed $(git -C "$MIRROR_DIR" rev-parse --short HEAD)"
  PUSHED=1
fi

[ "$DRY" -eq 1 ] && { say "dry run"; note "nothing to do"; exit 0; }

# ---------------------------------------------------------------------------
# Pushing is not publishing. Pages builds afterwards, and a CDN can hold the old
# file for a while, so the only honest check is to fetch it and compare the bytes.
say "waiting for it to actually be live"
DEADLINE=$((SECONDS + 240))
STATE="pending"
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  BUILD="$(gh api "repos/$MIRROR_REPO/pages/builds/latest" -q '.status' 2>/dev/null)"
  LIVE_HASH="$(curl -fsSL "${LIVE_URL}index.html?v=$SHA-$SECONDS" 2>/dev/null \
               | sha256sum | cut -d' ' -f1)"
  if [ "$LIVE_HASH" = "$LOCAL_HASH" ]; then STATE="live"; break; fi
  if [ "$BUILD" = "errored" ]; then STATE="errored"; break; fi
  printf '    %s  %ss\n' "${BUILD:-unknown}" "$SECONDS"
  sleep 8
done

case "$STATE" in
  live)
    note "the file being served is byte-for-byte the file you built"
    ;;
  errored)
    die "the Pages build errored. gh api repos/$MIRROR_REPO/pages/builds/latest"
    ;;
  *)
    die "gave up after 240s. It may still land; re-run to check, or look at
    https://github.com/$MIRROR_REPO/deployments"
    ;;
esac

printf '\n=================================\n'
if [ "$PUSHED" -eq 1 ]; then printf 'PUBLISHED %s\n' "$SHA"; else printf 'ALREADY CURRENT (%s)\n' "$SHA"; fi
printf '%s\n' "$LIVE_URL"
