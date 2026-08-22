#!/usr/bin/env bash
# tools/doctor.sh -- one command that answers "can this machine build UNREAD?"
#
#   cd unread && bash tools/doctor.sh
#
# Prints a GREEN / AMBER / RED verdict and the exact next command for your branch.
# Paste the whole block back. Read-only: this script installs nothing and changes nothing.

set -u

VERDICT="GREEN"
NEXT=""
NOTES=""

demote() { # demote <GREEN|AMBER|RED>
  case "$1" in
    RED)   VERDICT="RED" ;;
    AMBER) [ "$VERDICT" = "RED" ] || VERDICT="AMBER" ;;
  esac
}
ok()   { printf '  [OK] %s\n' "$*"; }
warn() { printf '  [!!] %s\n' "$*"; demote AMBER; }
bad()  { printf '  [XX] %s\n' "$*"; demote RED; }
info() { printf '       %s\n' "$*"; }
head_() { printf '\n== %s\n' "$*"; }
note() { NOTES="${NOTES}${NOTES:+
}  - $*"; }

printf '===== UNREAD doctor =====\n'

# ---------------------------------------------------------------- 1. host ----
head_ "Host"
UNAME="$(uname -s 2>/dev/null || echo unknown)"
info "uname: $UNAME"

if [ "$UNAME" != "Darwin" ]; then
  bad "Not macOS. Xcode, the iOS SDK and simulators do not exist here."
  info "This is expected on the Windows authoring machine."
  NEXT='gh repo create unread --private --source=. --push   # CI is your only build gate'
  note "On a non-Mac host the CI gate is mandatory, not optional."
  # Still run the parts that do work off-Mac.
  head_ "Repo sanity (host-independent)"
  if [ -f project.yml ]; then ok "project.yml present"; else bad "project.yml missing"; fi
  if ls -d ./*.xcodeproj >/dev/null 2>&1; then
    bad "a .xcodeproj is on disk -- it must be generated, never committed (rule 12)"
  else
    ok "no committed .xcodeproj (rule 12)"
  fi
  if command -v python3 >/dev/null 2>&1; then PY=python3
  elif command -v python >/dev/null 2>&1; then PY=python
  else PY=""; fi
  if [ -n "$PY" ]; then
    if "$PY" tools/validate_story.py Unread/Resources/story.json >/dev/null 2>&1; then
      ok "story validation passes"
    else
      bad "story validation FAILS -- run: $PY tools/validate_story.py Unread/Resources/story.json"
    fi
  else
    warn "no python3 on PATH; cannot run the story validator"
  fi
  printf '\n===== VERDICT: %s =====\n' "$VERDICT"
  [ -n "$NOTES" ] && printf 'Notes:\n%s\n' "$NOTES"
  printf '\nNext command:\n  %s\n' "$NEXT"
  exit 0
fi

MACOS="$(sw_vers -productVersion 2>/dev/null || echo 0)"
MAJOR="${MACOS%%.*}"
REST="${MACOS#*.}"
MINOR="${REST%%.*}"
case "$MINOR" in ''|*[!0-9]*) MINOR=0 ;; esac
info "macOS: $MACOS  (build $(sw_vers -buildVersion 2>/dev/null || echo '?'))"
info "arch:  $(uname -m)"

# --------------------------------------------------------------- 2. xcode ----
head_ "Xcode"
SELECTED="$(xcode-select -p 2>/dev/null || echo none)"
info "xcode-select -p: $SELECTED"

HAS_FULL_XCODE=0
case "$SELECTED" in
  *CommandLineTools*)
    bad "Command Line Tools only -- no iOS SDK and no simulators."
    note "CLT gives you clang and git. It cannot build an iOS app."
    ;;
  none)
    bad "no developer directory selected"
    ;;
  *)
    if command -v xcodebuild >/dev/null 2>&1 && xcodebuild -version >/dev/null 2>&1; then
      HAS_FULL_XCODE=1
      XCODE_VER="$(xcodebuild -version 2>/dev/null | head -1 | awk '{print $2}')"
      ok "Xcode $XCODE_VER at $SELECTED"
    else
      bad "xcodebuild present but not usable -- license may be unaccepted"
      note "Try: sudo xcodebuild -license accept && xcodebuild -runFirstLaunch"
    fi
    ;;
esac

# macOS -> max Xcode, per the Phase 1.5 compatibility table.
head_ "macOS / Xcode compatibility"
case "$MAJOR" in
  26|27|28)
    ok "macOS $MACOS supports Xcode 26. Everything works, terminal-only." ;;
  15)
    ok "macOS $MACOS supports Xcode 16.4. Everything works." ;;
  14)
    if [ "$MINOR" -ge 5 ]; then
      ok "macOS $MACOS supports Xcode 16.0-16.2. Works; stay on 16.2."
    else
      ok "macOS $MACOS caps at Xcode 15.x -- fine for UNREAD."
      note "The old objectVersion-77 hazard is GONE: XcodeGen writes a fixed, deliberately old"
      note "project format and never inspects your Xcode, so that table row no longer applies."
      note "Version-independent by construction, not by detection."
    fi
    ;;
  13)
    # Xcode 15.0's floor is macOS 13.5. Below that you top out at Xcode 14.3.x, whose newest
    # SDK is iOS 16.4 -- which makes CLAUDE.md rule 5 (@Observable) physically unsatisfiable.
    # This boundary is the whole point of the check; do not collapse it back into one band.
    if [ "$MINOR" -ge 5 ]; then
      warn "macOS $MACOS supports Xcode 15.0-15.2. iOS 17 SDK is present, so @Observable compiles."
      note "Pin Xcode 15.2 and treat CI as the real gate."
    else
      bad "macOS $MACOS tops out at Xcode 14.3.x (Xcode 15.0 requires macOS 13.5+)."
      note "Xcode 14.3.x ships iOS 16.4 as its newest SDK, so CLAUDE.md rule 5 is physically"
      note "unsatisfiable here: you would hit \"cannot find '@Observable' in scope\" with"
      note "nothing pointing at the machine as the cause. Do not attempt a local build."
      note "Either update to macOS 13.5+ for Xcode 15.2, or let CI be the only gate."
    fi
    ;;
  *)
    if [ "$MAJOR" -le 12 ] && [ "$MAJOR" -gt 0 ]; then
      bad "macOS $MACOS caps at Xcode 14 -- NO iOS 17 SDK. @Observable cannot compile locally."
      note "CI is mandatory on this machine, not optional."
    else
      warn "unrecognised macOS version '$MACOS' -- check the table by hand."
    fi
    ;;
esac

# ------------------------------------------------------- 3. sdk + simulators --
head_ "iOS SDK and simulators"
if [ "$HAS_FULL_XCODE" -eq 1 ]; then
  SDK="$(xcodebuild -showsdks 2>/dev/null | grep -o 'iphonesimulator[0-9][0-9.]*' | sed 's/iphonesimulator//' | sort -t. -k1,1n -k2,2n | tail -1)"
  if [ -n "${SDK:-}" ]; then
    SDK_MAJOR="${SDK%%.*}"
    if [ "$SDK_MAJOR" -ge 17 ] 2>/dev/null; then
      ok "iOS Simulator SDK $SDK (>= 17.0 required)"
    else
      bad "iOS Simulator SDK $SDK is older than 17.0 -- deployment target cannot be met"
    fi
  else
    bad "no iphonesimulator SDK found"
  fi

  # grep -c prints "0" and exits 1 on no match, so an `|| echo 0` here would emit two lines.
  IPHONES="$(xcrun simctl list devices available 2>/dev/null | grep -c 'iPhone')"
  case "$IPHONES" in ''|*[!0-9]*) IPHONES=0 ;; esac
  if [ "$IPHONES" -gt 0 ]; then
    ok "$IPHONES iPhone simulator(s) available"
    FIRST="$(xcrun simctl list devices available 2>/dev/null | grep -o 'iPhone[^(]*' | head -1 | sed 's/ *$//')"
    info "first match: $FIRST"
  else
    bad "no iPhone simulators installed"
    note "Try: xcodebuild -downloadPlatform iOS"
  fi
else
  bad "skipped -- no usable Xcode"
fi

# ------------------------------------------------------------- 4. toolchain --
head_ "Build tooling"
if command -v xcodegen >/dev/null 2>&1; then
  ok "xcodegen $(xcodegen --version 2>/dev/null | head -1)"
else
  warn "xcodegen not installed (CI installs its own; only needed for local builds)"
  note "Install locally with: brew install xcodegen"
fi
command -v python3 >/dev/null 2>&1 && ok "python3 $(python3 -V 2>&1 | awk '{print $2}')" \
                                   || bad "python3 missing -- the story validator cannot run"
command -v gh >/dev/null 2>&1 && ok "gh $(gh --version 2>/dev/null | head -1 | awk '{print $3}')" \
                              || warn "gh not installed -- needed once, to create the private repo"

# ------------------------------------------------------------ 5. repo state --
head_ "Repo sanity"
[ -f project.yml ] && ok "project.yml present" || bad "project.yml missing -- wrong directory?"
[ -f .github/workflows/gate.yml ] && ok "gate.yml present" || bad "gate.yml missing"
if ls -d ./*.xcodeproj >/dev/null 2>&1; then
  bad "a .xcodeproj is on disk -- generated only, never committed (rule 12)"
  info "if git tracks it: git rm -r --cached *.xcodeproj"
else
  ok "no committed .xcodeproj (rule 12)"
fi
if command -v python3 >/dev/null 2>&1; then
  if python3 tools/validate_story.py Unread/Resources/story.json >/dev/null 2>&1; then
    ok "story validation passes"
  else
    bad "story validation FAILS"
    info "run: python3 tools/validate_story.py Unread/Resources/story.json"
  fi
fi

# --------------------------------------------------------------- 6. verdict --
if [ -z "$NEXT" ]; then
  case "$VERDICT" in
    GREEN)
      NEXT='brew install xcodegen && xcodegen generate && xcodebuild -project Unread.xcodeproj -scheme Unread -destination "platform=iOS Simulator,name='"${FIRST:-iPhone 16}"'" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build test' ;;
    AMBER)
      NEXT='gh repo create unread --private --source=. --push   # then read the gate log before building locally' ;;
    RED)
      if [ "$HAS_FULL_XCODE" -eq 0 ]; then
        NEXT='# Install Xcode.app from the App Store, then:
  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
  sudo xcodebuild -license accept
  xcodebuild -runFirstLaunch'
      else
        NEXT='gh repo create unread --private --source=. --push   # this Mac cannot build UNREAD; CI must'
      fi
      ;;
  esac
fi

printf '\n===== VERDICT: %s =====\n' "$VERDICT"
[ -n "$NOTES" ] && printf 'Notes:\n%s\n' "$NOTES"
printf '\nNext command:\n  %s\n' "$NEXT"
printf '\n(paste this whole block back, plus the first gate result)\n'
