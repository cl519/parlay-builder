import Foundation

// What the Mac server sends (app/bets.py, app/live_stats.py). Field names match its JSON.

nonisolated struct BetsPayload: Decodable {
    let parlays: [Parlay]
    let tonight: Tonight?
}

nonisolated struct Parlay: Decodable, Identifiable, Equatable {
    let ticker: String
    let cost: Double
    let payout: Double
    let placed: String?
    let estChance: Double?
    let single: Bool
    let legs: [Leg]
    let parent: String?

    var id: String { ticker }

    enum CodingKeys: String, CodingKey {
        case ticker, cost, payout, placed, single, legs, parent
        case estChance = "est_chance"
    }
}

nonisolated struct Leg: Decodable, Identifiable, Equatable {
    let ticker: String
    let side: String
    let game: String
    let kind: String        // PTS, REB, AST, PRA, 3PT, STL, BLK, STL+BLK, or ml / spread / total / other
    let status: String?
    let result: String?     // "yes" / "no" once settled; "scalar" = player didn't play
    let settledValue: Double?
    let chance: Double?
    let thin: Bool?
    let player: String?
    let team: String?
    let stat: String?
    let line: Double?
    let hcp: Double?
    let dir: String?        // totals: "over" / "under"
    let label: String
    let family: String?     // same question on any line, e.g. "KXNBAPTS-...-SASSCASTLE5-|yes"

    var id: String { ticker }
    var question: String { family ?? ticker + "|" + side }

    enum CodingKeys: String, CodingKey {
        case ticker, side, game, kind, status, result, chance, thin, player, team, stat, line, hcp, dir, label, family
        case settledValue = "settled_value"
    }
}

/// Tonight's money: one row per bet whose last game is tonight (app/nights.py).
nonisolated struct Tonight: Decodable {
    let night: String
    let rows: [Row]

    struct Row: Decodable {
        let ticker: String
        let staked: Double
        let paid: Double
        let locked: Double
        let riding: Double
    }
}

nonisolated struct LivePayload: Decodable {
    let games: [String: LiveGame]
}

nonisolated struct LiveGame: Decodable, Equatable {
    let state: String?      // pre / in / post
    let detail: String?     // "6:52 - 2nd", "Final", "10/31 - 7:30 PM EDT"
    let awayScore: Int
    let homeScore: Int
    let players: [String: PlayerLine]?
    let out: [String: String]?

    enum CodingKeys: String, CodingKey {
        case state, detail, players, out
        case awayScore = "away_score"
        case homeScore = "home_score"
    }

    var started: Bool { state == "in" || state == "post" }
}

nonisolated struct PlayerLine: Decodable, Equatable {
    let min, pts, reb, ast, stl, blk, threes, fouls: Int
    let onCourt: Bool

    enum CodingKeys: String, CodingKey {
        case min = "MIN", pts = "PTS", reb = "REB", ast = "AST", stl = "STL", blk = "BLK"
        case threes = "3PM", fouls = "PF", onCourt = "ON"
    }

    func value(_ stat: String) -> Int? {
        switch stat {
        case "PTS": pts
        case "REB": reb
        case "AST": ast
        case "3PT": threes
        case "STL": stl
        case "BLK": blk
        case "STL+BLK": stl + blk
        case "PRA": pts + reb + ast
        default: nil
        }
    }
}

nonisolated struct Balance: Decodable {
    let available: Double
}
