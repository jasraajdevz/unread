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
    let contactId: String
    let startBeat: String
    let pinned: Bool
}

struct Message: Codable, Identifiable, Hashable {
    let id: String
    let from: MessageSender
    let kind: MessageKind
    let body: String?
    let asset: String?
    let durationMs: Int?
    let delayMs: Int
    let typingMs: Int
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
