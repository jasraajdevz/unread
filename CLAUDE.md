# UNREAD
Mobile horror game. iOS 17+, SwiftUI, Swift 5.9+. The player reads a stranger's
messenger app. All narrative content is data, not code.

## Absolute rules
1. ZERO third-party dependencies. No SPM packages. If you want a package, stop and ask.
   (XcodeGen is a build-time tool, not a dependency of the app.)
2. All story text, contact names, message bodies, choice labels and timings live in
   `Resources/story.json`. NO story text in any .swift file, including tests, previews
   and placeholder strings. Use `"[placeholder]"` if you need a literal.
3. When fixing code, do not edit story.json. When editing story, do not touch .swift files.
   If a task seems to need both, stop and tell me why.
4. Do not create new files that are not in the file tree below without asking first.
5. iOS 17 minimum. Use `@Observable` (Observation framework), NOT `ObservableObject`.
6. Persistence is `Codable` -> JSON in the Documents directory. No SwiftData. No CoreData.
   No UserDefaults for game state. (UserDefaults IS used for the `-uiSnapshotBeat` launch
   argument and for the mute/haptics toggles. Neither is game state.)
7. If you are not certain an API exists with that exact signature, STOP and say so.
   Never invent a symbol, a modifier, or an initializer. A wrong guess costs an hour.
8. Notifications must NEVER be required to progress. Every notification beat has an
   in-app fallback that fires on next foreground. App Store Guideline 4.5.4.
9. Never mimic another company's app name, icon, colors or logo. Guideline 4.1.
10. No force unwraps (`!`) outside of tests. No `fatalError` in shipping paths.
11. The build gate is CI, not your judgment. A phase is done when the `gate` workflow is green.
    For any UI phase it is done when the screenshot artifact shows the intended screen.
    Never say a phase is complete without naming the run you are relying on.
12. NEVER hand-edit an .xcodeproj or project.pbxproj. The project is generated from project.yml
    by `xcodegen generate` and is gitignored. If you find a committed .xcodeproj, delete it.
13. Every UI phase must add its screen to the `-uiSnapshotBeat` launch-argument switch so CI can
    photograph it. A screen CI cannot photograph does not exist.
14. tools/validate_story.py and Tests/StoryValidationTests.swift must assert identical rules.
    Change both in the same commit or neither.
15. If the local Xcode cannot build the current project format, say so and stop.
    Do not "fix" the project file. Regenerate it from project.yml.

## File tree — the whole project
project.yml                    the project; .xcodeproj is generated and gitignored
CLAUDE.md
tools/
  validate_story.py            mirror of StoryValidationTests; see rule 14
  doctor.sh                    read-only; GREEN/AMBER/RED on whether this machine can build
.github/workflows/
  gate.yml                     build + test + screenshots; the only source of "done"
Unread/
  UnreadApp.swift
  Models/
    StoryModels.swift          Codable structs only, no logic
    GameState.swift            @Observable, flags, save/load
  Engine/
    StoryLoader.swift          bundle -> Story, descriptive errors, no story text
    StoryEngine.swift          advances beats; contains no story text
    NotificationScheduler.swift
    AudioPlayer.swift
    Haptics.swift
  Views/
    ThreadListView.swift
    ConversationView.swift
    MessageBubble.swift
    ChoiceBar.swift
    PhotoViewerView.swift
  Resources/
    story.json
    Audio/
    Images/
Tests/
  StoryValidationTests.swift

## Definition of done for any task
- `python3 tools/validate_story.py Unread/Resources/story.json` exits 0. Run this first;
  it needs no Mac and costs under a second.
- The `gate` workflow is green on the pushed commit. Name the run.
- For a UI phase: the screenshot artifact from that run shows the intended screen, and you
  have described what each image actually contains.
- Zero new compiler warnings.
- You state which files you changed and why, in one line each.

Locally on a Mac, the same gate is:
    xcodegen generate
    xcodebuild -project Unread.xcodeproj -scheme Unread \
      -destination "platform=iOS Simulator,name=<a sim from xcrun simctl list devices available>" \
      build test

## Style
No comments that restate the code. Comment only non-obvious timing or Apple-API caveats.
