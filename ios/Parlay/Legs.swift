import Foundation

// How a leg is doing, from its Kalshi data plus ESPN's live box score. A port of the website's
// web/js/bets.js and markets.js, so the phone and the site agree on every leg.

let riskBelow = 0.5      // leg chance below this (2x+) = at risk
let dangerBelow = 1.0 / 3  // below this (3x+) = probably gone

enum Tone {
    case hit, dead, out, danger, risk, live, pending, unknown
}

struct Progress {
    var pct: Double
    var text: String
    var center = false      // moneyline / spread: the goal sits mid-track
    var under = false       // an under: filling up is bad
    var onCourt: Bool?      // live props: on the floor right now
    var fouls: Int?
}

/// Everything about one moment's live data that legs are judged against.
struct LiveBoard {
    var games: [String: LiveGame] = [:]
    var now = Date()

    func game(_ key: String) -> LiveGame? {
        guard let g = games[key], g.started else { return nil }
        return g
    }

    func stats(_ leg: Leg) -> PlayerLine? {
        guard let player = leg.player else { return nil }
        return Names.find(game(leg.game)?.players, player)
    }

    // ---------- Leg state ----------

    func isOpen(_ leg: Leg) -> Bool { leg.result == nil }

    /// Settled against you. Not "scalar": a player who didn't play is settled at a fair price that still pays.
    func missed(_ leg: Leg) -> Bool {
        (leg.result == "yes" || leg.result == "no") && leg.result != leg.side
    }

    /// Why a prop's player isn't playing: settled as "scalar", or out on ESPN before Kalshi settles it.
    func outReason(_ leg: Leg) -> String? {
        if leg.result == "scalar" { return "Didn't play" }
        guard leg.result == nil, let player = leg.player else { return nil }
        return game(leg.game)?.out?[Names.normalize(player)]
    }

    /// A prop or over already past its line, before Kalshi settles it.
    func reached(_ leg: Leg) -> Bool {
        guard leg.result == nil, game(leg.game) != nil else { return false }
        if leg.kind == "total" { return leg.dir == "over" && progress(leg).pct >= 1 }
        guard let stat = leg.stat, let line = leg.line, let v = stats(leg)?.value(stat) else { return false }
        return Double(v) >= line
    }

    func won(_ leg: Leg) -> Bool { (leg.result != nil && leg.result == leg.side) || reached(leg) }

    func tone(_ leg: Leg) -> Tone {
        if let r = leg.result { return r == leg.side ? .hit : missed(leg) ? .dead : .out }
        if reached(leg) { return .hit }
        if outReason(leg) != nil { return .out }
        guard let c = leg.chance else { return .unknown }
        if c < dangerBelow { return .danger }
        if c < riskBelow { return .risk }
        return game(leg.game) != nil ? .live : .pending
    }

    /// Sort key inside a card, shakiest first: missed on top, then by chance, then hit.
    func rank(_ leg: Leg) -> Double {
        if let r = leg.result { return r == leg.side ? 3 : missed(leg) ? -1 : 2.5 }
        if reached(leg) { return 3 }
        if outReason(leg) != nil { return 2.5 }
        return leg.chance ?? 2
    }

    // ---------- Progress text and track ----------

    func progress(_ leg: Leg) -> Progress {
        if leg.result == "scalar" {
            return Progress(pct: 0, text: "Didn't play · settled at \(Int(((leg.settledValue ?? 0) * 100).rounded()))¢, still pays")
        }
        if let r = leg.result {
            // Kalshi settles a prop the moment it's reached, mid-game: keep showing the count
            let hit = r == leg.side
            var p = Progress(pct: hit ? 1 : 0, text: hit ? "Hit" : "Missed")
            if let g = game(leg.game), let live = liveProgress(leg, g), live.fromStats { p.text += " · " + live.p.text }
            return p
        }
        if let out = outReason(leg) { return Progress(pct: 0, text: "\(out) · settles at a fair price, not a loss") }
        guard let g = game(leg.game) else { return Progress(pct: 0, text: notStartedText(leg)) }
        return liveProgress(leg, g)?.p ?? Progress(pct: 0, text: g.detail ?? "")
    }

    /// No live data yet: tip-off time if ESPN lists the game, else whether it should have started.
    private func notStartedText(_ leg: Leg) -> String {
        if let g = games[leg.game], g.state == "pre", let detail = g.detail {
            // "10/31 - 7:30 PM EDT" -> "Tip 7:30 PM"
            let time = detail.components(separatedBy: " - ").last ?? detail
            return "Tip " + time.replacingOccurrences(of: " EDT", with: "").replacingOccurrences(of: " EST", with: "")
        }
        if let day = GameKey.date(leg.game), day > GameKey.today(now) { return "Not started" }
        return "Waiting for live stats"
    }

    private func liveProgress(_ leg: Leg, _ g: LiveGame) -> (p: Progress, fromStats: Bool)? {
        let clock = g.state == "post" ? "Final" : (g.detail ?? "")
        let away = GameKey.away(leg.game)
        let total = g.awayScore + g.homeScore
        func margin(_ team: String?) -> Int { (team == away ? 1 : -1) * (g.awayScore - g.homeScore) }
        func marginText(_ m: Int) -> String { m > 0 ? "up \(m)" : m < 0 ? "down \(-m)" : "tied" }
        let clamp = { (x: Double) in min(1, max(0, x)) }

        switch leg.kind {
        case "ml":
            let m = margin(leg.team)
            return (Progress(pct: clamp(0.5 + Double(m) / 30), text: "\(leg.team ?? "") \(marginText(m)) · \(clock)", center: true), true)
        case "spread":
            let m = margin(leg.team)
            let cover = Double(m) + (leg.hcp ?? 0)
            return (Progress(pct: clamp(0.5 + cover / 30), text: "\(leg.team ?? "") \(marginText(m)) · \(clock)", center: true), true)
        case "total":
            return (Progress(pct: clamp(Double(total) / (leg.line ?? 1)), text: "\(total) pts · \(clock)", under: leg.dir == "under"), true)
        case "other":
            return (Progress(pct: 0, text: clock), false)
        default:
            guard let stat = leg.stat, let line = leg.line else { return nil }
            guard let ps = stats(leg), let v = ps.value(stat) else {
                return (Progress(pct: 0, text: "hasn't played · \(clock)"), false)
            }
            var p = Progress(pct: clamp(Double(v) / line), text: "\(v) / \(Fmt.line(line)) \(stat) · \(ps.min)m · \(clock)")
            if g.state == "in" {
                p.onCourt = ps.onCourt
                p.fouls = ps.fouls
            }
            return (p, true)
        }
    }

    // ---------- Parlays ----------

    struct Summary {
        var open: [Leg], hit: [Leg], dead: [Leg], out: [Leg]
        var atRisk: Int
    }

    func summary(_ p: Parlay) -> Summary {
        let open = p.legs.filter { isOpen($0) && !reached($0) && outReason($0) == nil }
        return Summary(
            open: open,
            hit: p.legs.filter(won),
            dead: p.legs.filter(missed),
            out: p.legs.filter { outReason($0) != nil },
            atRisk: open.filter { ($0.chance ?? 1) < riskBelow }.count
        )
    }

    func lost(_ p: Parlay) -> Bool { p.legs.contains(where: missed) }

    /// Border tone, worst leg first: red under 33%, yellow under 50%; else by the parlay's chance.
    func tone(_ p: Parlay) -> Tone? {
        let s = summary(p)
        if !s.dead.isEmpty { return .dead }
        if s.open.contains(where: { ($0.chance ?? 1) < dangerBelow }) { return .danger }
        if s.atRisk > 0 { return .risk }
        if (p.estChance ?? 0) >= 0.5 { return .hit }
        return (p.estChance ?? 0) >= 0.03 ? .live : nil
    }
}

// ---------- Kalshi game keys: "26OCT31MINSAS" ----------

enum GameKey {
    private static let eastern = TimeZone(identifier: "America/New_York")!

    /// "26OCT31MINSAS" -> "26OCT31" as a comparable "2026-10-31".
    static func date(_ key: String) -> String? {
        guard key.count >= 7 else { return nil }
        let months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
        let s = Array(key)
        guard let m = months.firstIndex(of: String(s[2..<5])) else { return nil }
        return "20\(String(s[0..<2]))-\(String(format: "%02d", m + 1))-\(String(s[5..<7]))"
    }

    static func today(_ now: Date) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = eastern
        let c = cal.dateComponents([.year, .month, .day], from: now)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    /// The away team: the key ends with away + home codes ("MIN" in "...MINSAS").
    static func away(_ key: String) -> String {
        String(key.dropLast(3).suffix(3))
    }
}

// ---------- Matching Kalshi's player names to ESPN's (web/js/names.js) ----------

enum Names {
    private static let suffixes: Set<String> = ["jr", "sr", "ii", "iii", "iv"]

    /// "Luka Dončić" -> "luka doncic", "Michael Porter Jr." -> "michael porter". Same keys as the server.
    static func normalize(_ name: String) -> String {
        let ascii = String(String.UnicodeScalarView(
            name.replacingOccurrences(of: "\u{2019}", with: "'")
                .decomposedStringWithCompatibilityMapping.unicodeScalars.filter(\.isASCII)
        )).lowercased()
        let cleaned = ascii.filter { !".,'".contains($0) }.replacingOccurrences(of: "-", with: " ")
        return cleaned.split(whereSeparator: \.isWhitespace).map(String.init).filter { !suffixes.contains($0) }.joined(separator: " ")
    }

    /// Exact match first; else a last-name match, only when one player in the game has it.
    static func find(_ box: [String: PlayerLine]?, _ name: String) -> PlayerLine? {
        guard let box else { return nil }
        let key = normalize(name)
        if let hit = box[key] { return hit }
        let last = key.split(separator: " ").last.map(String.init)
        let same = box.keys.filter { $0.split(separator: " ").last.map(String.init) == last }
        return same.count == 1 ? box[same[0]] : nil
    }
}

// ---------- Stacks: parlays linked to their smallest open leg-superset (server's `parent`) ----------

enum Stacks {
    static func group(_ parlays: [Parlay]) -> [[Parlay]] {
        let byTicker = Dictionary(parlays.map { ($0.ticker, $0) }, uniquingKeysWith: { a, _ in a })
        var groups: [String: [Parlay]] = [:]
        var order: [String] = []
        for p in parlays {
            var root = p
            var seen: Set<String> = [p.ticker]
            while let parent = root.parent, let next = byTicker[parent], seen.insert(parent).inserted { root = next }
            if groups[root.ticker] == nil { order.append(root.ticker) }
            groups[root.ticker, default: []].append(p)
        }
        return order.compactMap { groups[$0] }
    }
}

/// Re-sort ids by rank (lower first), moving one above another only when it's lower by `margin`,
/// so near-ties don't swap on every refresh (web/js/order.js stickyOrder).
func stickyOrder(_ prev: [String], rank: (String) -> Double, margin: Double = 0) -> [String] {
    var order = prev
    let r = Dictionary(order.map { ($0, rank($0)) }, uniquingKeysWith: { a, _ in a })
    var moved = true
    while moved {
        moved = false
        for i in 0..<max(0, order.count - 1) where r[order[i + 1]]! < r[order[i]]! - margin {
            order.swapAt(i, i + 1)
            moved = true
        }
    }
    return order
}
