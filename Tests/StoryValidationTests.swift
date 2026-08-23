import XCTest
import Foundation
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
    private static let threadKeys: Set<String> = ["id", "displayName", "contactId",
                                                  "participantIds", "startBeat", "pinned",
                                                  "startsUnread"]
    private static let beatKeys: Set<String> = ["id", "threadId", "messages", "setsFlags",
                                                "requiresFlags", "choices", "notification"]
    private static let messageKeys: Set<String> = ["id", "from", "kind", "fromContactId",
                                                   "body", "asset", "durationMs", "live",
                                                   "offsetMinutes", "delayMs", "typingMs"]

    private static let choiceKeys: Set<String> = ["id", "label", "next", "setsFlags"]
    private static let notificationKeys: Set<String> = ["afterSeconds", "title", "body", "resumeBeat"]
    private static let endingKeys: Set<String> = ["id", "requiresFlags", "beatId"]

    /// Phase 2b. Older versions are rejected outright; there is no migration path and none
    /// should ever be added.
    private static let schemaVersion = 3

    /// RULE 13: date dividers are derived by the renderer from calendar-day changes, never
    /// authored. A system message whose body is a bare weekday name is a divider that came back.
    private static let weekdayNames: Set<String> = [
        "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
        "mon", "tue", "tues", "wed", "weds", "thu", "thur", "thurs", "fri", "sat", "sun",
        "today", "yesterday", "tomorrow",
    ]

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
        XCTAssertFalse(story.beats.isEmpty, "story has no beats")
        XCTAssertFalse(story.threads.isEmpty, "story has no threads")
        XCTAssertFalse(story.contacts.isEmpty, "story has no contacts")
    }

    /// RULE 1 / RULE 14 -- schema version is exactly `schemaVersion`; older files are
    /// rejected, never migrated. A v2 file fails here naming the phase that moved it on.
    func testSchemaVersionIsCurrent() throws {
        let story = try loadStory()
        XCTAssertEqual(
            story.version, Self.schemaVersion,
            "story version is \(story.version), but only version \(Self.schemaVersion) is "
            + "supported. Version 2 was superseded by Phase 2b, which added offsetMinutes and "
            + "deleted authored date dividers; there is no migration path"
        )
    }

    /// RULE 10 -- within a beat, offsetMinutes is non-decreasing in message order.
    func testOffsetsNeverGoBackwardsWithinABeat() throws {
        let story = try loadStory()
        for beat in story.beats {
            var previous: Message?
            for message in beat.messages {
                if let earlier = previous {
                    XCTAssertGreaterThanOrEqual(
                        message.offsetMinutes, earlier.offsetMinutes,
                        "message '\(message.id)' in beat '\(beat.id)' has offsetMinutes "
                        + "\(message.offsetMinutes), which is earlier than '\(earlier.id)' at "
                        + "\(earlier.offsetMinutes) immediately before it"
                    )
                }
                previous = message
            }
        }
    }

    /// RULE 11 -- across a thread's beats in reachable order, offsetMinutes is non-decreasing.
    /// Checked per edge, which stays well defined once beats branch.
    func testOffsetsNeverGoBackwardsAcrossBeats() throws {
        let story = try loadStory()
        let beatsById = Dictionary(story.beats.map { ($0.id, $0) },
                                   uniquingKeysWith: { first, _ in first })

        for beat in story.beats {
            guard let last = beat.messages.last?.offsetMinutes else { continue }
            var outgoing = (beat.choices ?? []).map(\.next)
            if let resume = beat.notification?.resumeBeat { outgoing.append(resume) }

            for targetId in outgoing {
                guard let first = beatsById[targetId]?.messages.first?.offsetMinutes else { continue }
                XCTAssertGreaterThanOrEqual(
                    first, last,
                    "beat '\(beat.id)' ends at offsetMinutes \(last) but leads to beat "
                    + "'\(targetId)' which starts at \(first), going backwards in time"
                )
            }
        }
    }

    /// RULE 12 -- the future is only reachable live. This is what keeps beat 3 honest:
    /// nothing may claim to be from the future unless it is actually arriving in the present.
    func testFutureMessagesAreLive() throws {
        let story = try loadStory()
        for beat in story.beats {
            for message in beat.messages where message.offsetMinutes > 0 {
                XCTAssertTrue(
                    message.isLive,
                    "message '\(message.id)' in beat '\(beat.id)' has offsetMinutes "
                    + "\(message.offsetMinutes), which is in the future, but is not live"
                )
            }
        }
    }

    /// RULE 13 -- date dividers are derived by the renderer, never authored.
    func testNoAuthoredDateDividersRemain() throws {
        let story = try loadStory()
        let trim = CharacterSet(charactersIn: "-\u{2014} ")
        for beat in story.beats {
            for message in beat.messages where message.kind == .system {
                let label = (message.body ?? "")
                    .trimmingCharacters(in: trim)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                    .lowercased()
                XCTAssertFalse(
                    Self.weekdayNames.contains(label),
                    "message '\(message.id)' in beat '\(beat.id)' is a system message whose body "
                    + "is the bare day name; date dividers are derived from offsetMinutes, "
                    + "not authored"
                )
            }
        }
    }

    /// RULE 2 -- displayName is required and must carry something.
    func testEveryThreadHasADisplayName() throws {
        let story = try loadStory()
        for thread in story.threads {
            XCTAssertFalse(
                thread.displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                "thread '\(thread.id)' has an empty displayName"
            )
        }
    }

    /// RULE 4 -- participantIds, when present, is non-empty, duplicate-free and resolves.
    func testEveryThreadParticipantExists() throws {
        let story = try loadStory()
        let contactIds = Set(story.contacts.map(\.id))
        for thread in story.threads {
            guard let participants = thread.participantIds else { continue }
            XCTAssertFalse(
                participants.isEmpty,
                "thread '\(thread.id)' has an empty participantIds; omit the key instead"
            )
            assertUnique(participants, label: "participant in thread '\(thread.id)'")
            for participant in participants {
                XCTAssertTrue(
                    contactIds.contains(participant),
                    "thread '\(thread.id)' has participant '\(participant)', which is not a known contact"
                )
            }
        }
    }

    /// RULE 5 and RULE 6 -- fromContactId resolves, belongs to its thread, and only `them` carries it.
    func testEveryMessageSpeakerBelongsToItsThread() throws {
        let story = try loadStory()
        let contactIds = Set(story.contacts.map(\.id))
        let threadsById = Dictionary(story.threads.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })

        for beat in story.beats {
            let thread = threadsById[beat.threadId]
            var allowed = Set(thread?.participantIds ?? [])
            if let contactId = thread?.contactId { allowed.insert(contactId) }

            for message in beat.messages {
                guard let speaker = message.fromContactId else { continue }

                XCTAssertTrue(
                    contactIds.contains(speaker),
                    "message '\(message.id)' in beat '\(beat.id)' has fromContactId '\(speaker)', "
                    + "which is not a known contact"
                )
                XCTAssertEqual(
                    message.from, .them,
                    "message '\(message.id)' in beat '\(beat.id)' is from '\(message.from.rawValue)' "
                    + "but carries a fromContactId; only 'them' messages name a speaker"
                )
                if !allowed.isEmpty {
                    XCTAssertTrue(
                        allowed.contains(speaker),
                        "message '\(message.id)' in beat '\(beat.id)' names speaker '\(speaker)', "
                        + "who is not in thread '\(beat.threadId)' (\(allowed.sorted().joined(separator: ", ")))"
                    )
                }
            }
        }
    }

    /// RULE 7 -- the load-bearing one. A non-live message renders instantly, so a non-zero
    /// delay or typing time is dead data that silently misleads anyone reading or measuring
    /// the file. Error, never a warning.
    func testNonLiveMessagesCarryNoTiming() throws {
        let story = try loadStory()
        for beat in story.beats {
            for message in beat.messages where !message.isLive {
                XCTAssertEqual(
                    message.delayMs, 0,
                    "message '\(message.id)' in beat '\(beat.id)' is not live but has delayMs "
                    + "\(message.delayMs); history renders instantly, so it must be 0"
                )
                XCTAssertEqual(
                    message.typingMs, 0,
                    "message '\(message.id)' in beat '\(beat.id)' is not live but has typingMs "
                    + "\(message.typingMs); history renders instantly, so it must be 0"
                )
            }
        }
    }

    /// RULE 8 -- in a multi-speaker thread every `them` message must name its speaker,
    /// otherwise the group chat renders as one person arguing with themselves.
    func testGroupMessagesNameTheirSpeaker() throws {
        let story = try loadStory()
        let threadsById = Dictionary(story.threads.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })

        for beat in story.beats {
            guard let participants = threadsById[beat.threadId]?.participantIds,
                  !participants.isEmpty else { continue }
            for message in beat.messages where message.from == .them {
                XCTAssertNotNil(
                    message.fromContactId,
                    "message '\(message.id)' in beat '\(beat.id)' is in multi-participant thread "
                    + "'\(beat.threadId)' but has no fromContactId"
                )
            }
        }
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

    /// RULE 3 -- contactId, when present, resolves. Absent is legal: a thread may have
    /// participants instead, or neither, which is the thread with only a number.
    func testEveryThreadContactExists() throws {
        let story = try loadStory()
        let contactIds = Set(story.contacts.map(\.id))
        for thread in story.threads {
            guard let contactId = thread.contactId else { continue }
            XCTAssertTrue(
                contactIds.contains(contactId),
                "thread '\(thread.id)' has contactId '\(contactId)', which is not a known contact"
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
