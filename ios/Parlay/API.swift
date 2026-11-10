import Foundation

/// Reads from the parlay server on your Mac, over Tailscale. Read-only: the server refuses anything else.
nonisolated enum API {
    enum Failure: LocalizedError {
        case unreachable, refused, server(Int)

        var errorDescription: String? {
            switch self {
            case .unreachable: "Can't reach your Mac. Check that it's awake, Tailscale is on here, and ./parlay is running."
            case .refused: "Your Mac refused this phone's token. Run ./parlay phone, then ios/configure, and reinstall."
            case .server(let code): "Your Mac's server had a problem (\(code)). It'll retry."
            }
        }
    }

    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 12
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()

    static func get<T: Decodable>(_ path: String, as type: T.Type = T.self) async throws -> T {
        var request = URLRequest(url: URL(string: Secrets.server + path)!)
        request.setValue("Bearer \(Secrets.token)", forHTTPHeaderField: "Authorization")
        let data: Data, response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw Failure.unreachable
        }
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        if code == 403 { throw Failure.refused }
        guard code == 200 else { throw Failure.server(code) }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
