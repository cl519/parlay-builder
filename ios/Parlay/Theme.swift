import SwiftUI

// The website's palette (web/styles.css :root), so the phone feels like the same product.

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255, opacity: opacity)
    }

    static let bg = Color(hex: 0x0E1116)
    static let panel = Color(hex: 0x161B22)
    static let panel2 = Color(hex: 0x1C222B)
    static let line = Color(hex: 0x262D38)
    static let text = Color(hex: 0xE6EDF3)
    static let muted = Color(hex: 0x8B949E)
    static let chip = Color(hex: 0x212833)
    static let chipHover = Color(hex: 0x2A3340)
    static let accent = Color(hex: 0x2ECC71)
    static let warn = Color(hex: 0xE3B341)
    static let danger = Color(hex: 0xF85149)
    static let blue = Color(hex: 0x4C8DFF)
}

extension Tone {
    /// Meter segments and progress fills.
    var fill: Color {
        switch self {
        case .hit: .accent
        case .live: .blue
        case .risk: .warn
        case .danger, .dead: .danger
        case .out: .muted
        case .pending, .unknown: .chipHover
        }
    }

    /// Card borders (toneClass in bets.js): softer than the fills.
    var border: Color {
        switch self {
        case .danger: Color(hex: 0xF85149, opacity: 0.5)
        case .risk: Color(hex: 0xE3B341, opacity: 0.45)
        case .hit: Color(hex: 0x2ECC71, opacity: 0.45)
        case .live: Color(hex: 0x4C8DFF, opacity: 0.45)
        default: .line
        }
    }
}

enum Fmt {
    static func usd(_ x: Double) -> String {
        x.formatted(.currency(code: "USD").precision(.fractionLength(2)))
    }

    /// Whole lines as "15", halves as "225.5".
    static func line(_ x: Double) -> String {
        x == x.rounded() ? String(Int(x)) : String(x)
    }

    static func percent(_ p: Double) -> String {
        p < 0.001 ? "<0.1%" : String(format: "%.1f%%", p * 100)
    }

    static func multiple(_ p: Double) -> String {
        let x = 1 / max(p, 1e-6)
        return x >= 100 ? "\(Int(x.rounded()).formatted())x" : String(format: "%.1fx", x)
    }

    /// The server's "2026-10-31T23:23:35.348558Z" (microseconds, which ISO8601DateFormatter won't read).
    static func date(_ s: String?) -> Date? {
        guard let s else { return nil }
        let whole = s.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression)
        return ISO8601DateFormatter().date(from: whole)
    }

    /// The end of a parlay's Kalshi ticker, to find it on the website too.
    static func parlayID(_ ticker: String) -> String {
        String((ticker.split(separator: "-").last ?? "").suffix(6))
    }
}
