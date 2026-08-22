import Foundation

enum StoryLoadError: Error, LocalizedError {
    case resourceMissing(resource: String, bundlePath: String)
    case unreadable(resource: String, underlying: Error)
    case malformed(resource: String, detail: String)

    var errorDescription: String? {
        switch self {
        case let .resourceMissing(resource, bundlePath):
            return "Story resource '\(resource)' is not in the bundle at \(bundlePath). "
                 + "Check that it is a member of the target's Copy Bundle Resources phase."
        case let .unreadable(resource, underlying):
            return "Story resource '\(resource)' could not be read: \(underlying.localizedDescription)"
        case let .malformed(resource, detail):
            return "Story resource '\(resource)' failed to decode. \(detail)"
        }
    }
}

enum StoryLoader {
    static let resourceName = "story"
    static let resourceExtension = "json"

    static var resourceFilename: String { "\(resourceName).\(resourceExtension)" }

    static func load(from bundle: Bundle = .main) throws -> Story {
        guard let url = bundle.url(forResource: resourceName, withExtension: resourceExtension) else {
            throw StoryLoadError.resourceMissing(resource: resourceFilename, bundlePath: bundle.bundlePath)
        }
        return try load(contentsOf: url)
    }

    static func load(contentsOf url: URL) throws -> Story {
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            throw StoryLoadError.unreadable(resource: url.lastPathComponent, underlying: error)
        }
        do {
            return try JSONDecoder().decode(Story.self, from: data)
        } catch let error as DecodingError {
            throw StoryLoadError.malformed(resource: url.lastPathComponent, detail: describe(error))
        } catch {
            throw StoryLoadError.malformed(resource: url.lastPathComponent, detail: error.localizedDescription)
        }
    }

    private static func describe(_ error: DecodingError) -> String {
        switch error {
        case let .keyNotFound(key, context):
            return "Missing key '\(key.stringValue)' at \(path(context))."
        case let .typeMismatch(type, context):
            return "Expected \(type) at \(path(context)). \(context.debugDescription)"
        case let .valueNotFound(type, context):
            return "Found null where \(type) was required at \(path(context))."
        case let .dataCorrupted(context):
            return "Corrupted value at \(path(context)). \(context.debugDescription)"
        @unknown default:
            return error.localizedDescription
        }
    }

    private static func path(_ context: DecodingError.Context) -> String {
        let steps = context.codingPath.map { key -> String in
            if let index = key.intValue { return "[\(index)]" }
            return key.stringValue
        }
        return steps.isEmpty ? "the root object" : steps.joined(separator: ".")
    }
}
