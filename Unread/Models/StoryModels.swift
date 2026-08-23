import Foundation

enum MessageSender: String, Codable, Hashable {
    case them
    case me
    case system
}

enum MessageKind: String, Codable, Hashable {
    case text
    case photo
    case audio
    case system
}

struct Contact: Codable, Identifiable, Hashable {
    let id: String
    let displayName: String
    let accentHex: String
}

struct StoryThread: Codable, Identifiable, Hashable {
    let id: String
    let displayName: String
    let contactId: String?
    let participantIds: [String]?
    let startBeat: String
    let pinned: Bool
    let startsUnread: Bool?

    /// Synthesised Codable does not apply property defaults, so the JSON key is optional and
    /// the default lives here. Both `contactId` and `participantIds` absent is legal: that is
    /// the thread with no name, only a number.
    var beginsUnread: Bool { startsUnread ?? false }
}

struct Message: Codable, Identifiable, Hashable {
    let id: String
    let from: MessageSender
    let kind: MessageKind
    let fromContactId: String?
    let body: String?
    let asset: String?
    let durationMs: Int?
    let live: Bool?
    /// Minutes relative to the instant the player first launched the app; negative is the
    /// past. Absolute dates would be wrong the day after they were authored, so every
    /// displayed timestamp is GameState's stored launch instant plus this.
    let offsetMinutes: Int
    let delayMs: Int
    let typingMs: Int

    /// Default lives here rather than on the property, for the reason given on StoryThread.
    /// When false the message is history: it renders instantly and `delayMs`/`typingMs` are
    /// required to be zero, which StoryValidationTests enforces rather than assumes.
    var isLive: Bool { live ?? false }
}

struct Choice: Codable, Identifiable, Hashable {
    let id: String
    let label: String
    let next: String
    let setsFlags: [String]?
}

struct BeatNotification: Codable, Hashable {
    let afterSeconds: Int
    let title: String
    let body: String
    let resumeBeat: String
}

struct Beat: Codable, Identifiable, Hashable {
    let id: String
    let threadId: String
    let messages: [Message]
    let setsFlags: [String]?
    let requiresFlags: [String]?
    let choices: [Choice]?
    let notification: BeatNotification?
}

struct Ending: Codable, Identifiable, Hashable {
    let id: String
    let requiresFlags: [String]
    let beatId: String
}

struct Story: Codable, Hashable {
    let version: Int
    let contacts: [Contact]
    let threads: [StoryThread]
    let beats: [Beat]
    let endings: [Ending]
}
