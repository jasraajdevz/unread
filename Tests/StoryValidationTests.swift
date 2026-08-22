import XCTest
@testable import Unread

// CLAUDE.md rule 14: this file and tools/validate_story.py assert identical rules.
// Change both in the same commit or neither.
final class StoryValidationTests: XCTestCase {

    // Hosted unit tests run inside the app process, so Bundle.main is normally the host app
    // bundle -- which is what we want, because the asset checks must prove the *app* ships
    // the file. If TEST_HOST is ever lost, fall back to the test bundle so the failure is a
    // named assertion rather than a bare "resource missing".
    private static let storyBundle: Bundle = {
        let resolved = Bundle.main.url(forResource: StoryLoader.resourceName,
                                       withExtension: StoryLoader.resourceExtension)
        return resolved != nil ? Bundle.main : Bundle(for: StoryValidationTests.self)
    }()

    private static let photoExtensions = ["jpg", "jpeg", "png", "heic"]
    private static let audioExtensions = ["m4a", "mp3", "wav", "caf", "aiff", "aif"]

    private static let rootKeys: Set<String> = ["version", "contacts", "threads", "beats", "endings"]
    private static let contactKeys: Set<String> = ["id", "displayName", "accentHex"]
    private static let threadKeys: Set<String> = ["id", "contactId", "startBeat", "pinned"]
    private static let beatKeys: Set<String> = ["id", "threadId", "messages", "setsFlags",
                                                "requiresFlags", "choices", "notification"]
    private static let messageKeys: Set<String> = ["id", "from", "kind", "body", "asset",
                                                   "durationMs", "delayMs", "typingMs"]
    private static let choiceKeys: Set<String> = ["id", "label", "next", "setsFlags"]
    private static let notificationKeys: Set<String> = ["afterSeconds", "title", "body", "resumeBeat"]
    private static let endingKeys: Set<String> = ["id", "requiresFlags", "beatId"]

    private func loadStory() throws -> Story {
        try StoryLoader.load(from: Self.storyBundle)
    }

    /// Runs first alphabetically-independent of the others so a bundle-resolution failure
    /// reports as itself instead of as nine confusing "resource missing" errors.
    func testStoryResourceResolves() {
        XCTAssertNotNil(
            Self.storyBundle.url(forResource: StoryLoader.resourceName,
                                 withExtension: StoryLoader.resourceExtension),
            """
            \(StoryLoader.resourceFilename) is in neither the host app bundle \
            (\(Bundle.main.bundlePath)) nor the test bundle \
            (\(Bundle(for: StoryValidationTests.self).bundlePath)). \
            Check TEST_HOST and BUNDLE_LOADER in project.yml.
            """
        )
    }

    /// Decoding covers the schema rules the Python mirror checks explicitly: a missing
    /// required key, a wrong value type, and an unrecognised `kind` or `from` all throw here.
    func testStoryDecodesFromBundle() throws {
        let story = try loadStory()
        XCTAssertEqual(story.version, 1)
        XCTAssertFalse(story.beats.isEmpty, "story has no beats")
        XCTAssertFalse(story.threads.isEmpty, "story has no threads")
        XCTAssertFalse(story.contacts.isEmpty, "story has no contacts")
    }

    /// JSONDecoder ignores keys it does not recognise, so a typo like `delaysMs` would
    /// decode cleanly and silently take its default behaviour. Audit the raw JSON instead.
    func testNoUnknownKeys() throws {
        let root = try rawStoryObject()
        assertKeys(of: root, match: Self.rootKeys, at: "root")

        for (index, contact) in array(root, "contacts").enumerated() {
            assertKeys(of: contact, match: Self.contactKeys, at: "contacts[\(index)]")
        }
        for (index, thread) in array(root, "threads").enumerated() {
            assertKeys(of: thread, match: Self.threadKeys, at: "threads[\(index)]")
        }
        for (index, ending) in array(root, "endings").enumerated() {
            assertKeys(of: ending, match: Self.endingKeys, at: "endings[\(index)]")
        }
        for (index, beat) in array(root, "beats").enumerated() {
            let where_ = "beats[\(index)]"
            assertKeys(of: beat, match: Self.beatKeys, at: where_)
            for (m, message) in array(beat, "messages").enumerated() {
                assertKeys(of: message, match: Self.messageKeys, at: "\(where_).messages[\(m)]")
            }
            for (c, choice) in array(beat, "choices").enumerated() {
                assertKeys(of: choice, match: Self.choiceKeys, at: "\(where_).choices[\(c)]")
            }
            if let notification = beat["notification"] as? [String: Any] {
                assertKeys(of: notification, match: Self.notificationKeys, at: "\(where_).notification")
            }
        }
    }

    func testIdentifiersAreUnique() throws {
        let story = try loadStory()
        assertUnique(story.contacts.map(\.id), label: "contact")
        assertUnique(story.threads.map(\.id), label: "thread")
        assertUnique(story.beats.map(\.id), label: "beat")
        assertUnique(story.endings.map(\.id), label: "ending")
        for beat in story.beats {
            assertUnique(beat.messages.map(\.id), label: "message in beat '\(beat.id)'")
            assertUnique((beat.choices ?? []).map(\.id), label: "choice in beat '\(beat.id)'")
        }
    }

    func testEveryThreadContactExists() throws {
        let story = try loadStory()
        let contactIds = Set(story.contacts.map(\.id))
        for thread in story.threads {
            XCTAssertTrue(
                contactIds.contains(thread.contactId),
                "thread '\(thread.id)' has contactId '\(thread.contactId)', which is not a known contact"
            )
        }
    }

    func testEveryThreadStartBeatExists() throws {
        let story = try loadStory()
        let beatIds = Set(story.beats.map(\.id))
        for thread in story.threads {
            XCTAssertTrue(
                beatIds.contains(thread.startBeat),
                "thread '\(thread.id)' has startBeat '\(thread.startBeat)', which is not a known beat"
            )
        }
    }

    func testEveryBeatThreadExists() throws {
        let story = try loadStory()
        let threadIds = Set(story.threads.map(\.id))
        for beat in story.beats {
            XCTAssertTrue(
                threadIds.contains(beat.threadId),
                "beat '\(beat.id)' has threadId '\(beat.threadId)', which is not a known thread"
            )
        }
    }

    func testEveryChoiceTargetExists() throws {
        let story = try loadStory()
        let beatIds = Set(story.beats.map(\.id))
        for beat in story.beats {
            for choice in beat.choices ?? [] {
                XCTAssertTrue(
                    beatIds.contains(choice.next),
                    "choice '\(choice.id)' in beat '\(beat.id)' points at '\(choice.next)', which is not a known beat"
                )
            }
        }
    }

    func testEveryNotificationResumeBeatExists() throws {
        let story = try loadStory()
        let beatIds = Set(story.beats.map(\.id))
        for beat in story.beats {
            guard let notification = beat.notification else { continue }
            XCTAssertTrue(
                beatIds.contains(notification.resumeBeat),
                "beat '\(beat.id)' notification resumes at '\(notification.resumeBeat)', which is not a known beat"
            )
        }
    }

    func testEveryEndingBeatExists() throws {
        let story = try loadStory()
        let beatIds = Set(story.beats.map(\.id))
        for ending in story.endings {
            XCTAssertTrue(
                beatIds.contains(ending.beatId),
                "ending '\(ending.id)' points at beat '\(ending.beatId)', which is not a known beat"
            )
        }
    }

    func testEveryReferencedAssetIsInBundle() throws {
        let story = try loadStory()
        for beat in story.beats {
            for message in beat.messages {
                let extensions: [String]
                switch message.kind {
                case .photo: extensions = Self.photoExtensions
                case .audio: extensions = Self.audioExtensions
                case .text, .system:
                    XCTAssertNil(
                        message.asset,
                        "message '\(message.id)' in beat '\(beat.id)' is kind '\(message.kind.rawValue)' but names an asset"
                    )
                    continue
                }

                guard let asset = message.asset else {
                    XCTFail("message '\(message.id)' in beat '\(beat.id)' is kind '\(message.kind.rawValue)' but has no asset")
                    continue
                }

                let found = extensions.contains { ext in
                    Self.storyBundle.url(forResource: asset, withExtension: ext) != nil
                }
                XCTAssertTrue(
                    found,
                    "asset '\(asset)' referenced by message '\(message.id)' in beat '\(beat.id)' is not in Resources "
                    + "(tried extensions: \(extensions.joined(separator: ", ")))"
                )
            }
        }
    }

    func testTextMessagesHaveBodies() throws {
        let story = try loadStory()
        for beat in story.beats {
            for message in beat.messages where message.kind == .text || message.kind == .system {
                let body = message.body ?? ""
                XCTAssertFalse(
                    body.isEmpty,
                    "message '\(message.id)' in beat '\(beat.id)' is kind '\(message.kind.rawValue)' but has no body"
                )
            }
        }
    }

    // MARK: - Helpers

    private func rawStoryObject(file: StaticString = #filePath, line: UInt = #line) throws -> [String: Any] {
        let url = try XCTUnwrap(
            Self.storyBundle.url(forResource: StoryLoader.resourceName, withExtension: StoryLoader.resourceExtension),
            "\(StoryLoader.resourceFilename) is not in the bundle",
            file: file, line: line
        )
        let data = try Data(contentsOf: url)
        let object = try JSONSerialization.jsonObject(with: data)
        return try XCTUnwrap(object as? [String: Any], "story root is not a JSON object", file: file, line: line)
    }

    private func array(_ object: [String: Any], _ key: String) -> [[String: Any]] {
        (object[key] as? [[String: Any]]) ?? []
    }

    private func assertKeys(
        of object: [String: Any],
        match allowed: Set<String>,
        at location: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        for key in Set(object.keys).subtracting(allowed).sorted() {
            XCTFail(
                "\(location): unknown key '\(key)' -- the Swift schema will ignore it silently, "
                + "so it is almost certainly a typo",
                file: file, line: line
            )
        }
    }

    private func assertUnique(_ ids: [String], label: String, file: StaticString = #filePath, line: UInt = #line) {
        var seen = Set<String>()
        for id in ids where !seen.insert(id).inserted {
            XCTFail("duplicate \(label) id '\(id)'", file: file, line: line)
        }
    }
}
