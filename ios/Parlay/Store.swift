import SwiftUI
import UIKit

enum SortOrder: String, CaseIterable, Identifiable {
    case newest, payout, likely, staked

    var id: String { rawValue }

    var label: String {
        switch self {
        case .newest: "Newest"
        case .payout: "Max payout"
        case .likely: "Most likely"
        case .staked: "Most staked"
        }
    }
}

/// Your open parlays and tonight's live stats, kept fresh while the app is open.
@Observable
final class Store {
    static let pollSeconds: UInt64 = 20
    static let legMargin = 0.05  // a leg moves above another only if it's at least 5 points shakier

    var bets: BetsPayload?
    var board = LiveBoard()
    var balance: Double?
    var error: String?
    var updated: Date?
    var loading = false
    /// Legs that reached their line since the last refresh, for a brief glow.
    var justHit: Set<String> = []

    /// Each parlay's legs still to go, shakiest first. Fixed at a layout so rows don't jump;
    /// legs that hit after that stay where they are, turned green.
    private var legOrder: [String: [String]] = [:]
    private var wonBefore: Set<String>?

    // ---------- Loading ----------

    func refresh(relayout: Bool = false) async {
        loading = true
        defer { loading = false }
        do {
            async let b: BetsPayload = API.get("/api/bets")
            async let l: LivePayload = API.get("/api/live")
            let (newBets, live) = try await (b, l)
            withAnimation(.snappy) {
                bets = newBets
                board = LiveBoard(games: live.games, now: .now)
                if relayout { legOrder = [:] }
                reorderLegs()
                noticeHits()
            }
            updated = .now
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        if let b: Balance = try? await API.get("/api/balance") { balance = b.available }
    }

    /// Poll while the app is on screen; the caller cancels it when the app goes to the background.
    func poll() async {
        await refresh(relayout: true)
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: Self.pollSeconds * 1_000_000_000)
            if Task.isCancelled { break }
            await refresh()
        }
    }

    // ---------- What's shown ----------

    /// Stacks to show: no parlays that already lost, each stack's best one on top.
    func stacks(sortedBy sort: SortOrder) -> [[Parlay]] {
        guard let bets else { return [] }
        let key = sortKey(sort)
        let less = { (a: Parlay, b: Parlay) in key(a).lexicographicallyPrecedes(key(b)) }
        return Stacks.group(bets.parlays)
            .map { $0.filter { !board.lost($0) }.sorted(by: less) }
            .filter { !$0.isEmpty }
            .sorted { less($0[0], $1[0]) }
    }

    private func sortKey(_ sort: SortOrder) -> (Parlay) -> [Double] {
        let placed = { (p: Parlay) in Fmt.date(p.placed)?.timeIntervalSince1970 ?? 0 }
        switch sort {
        case .newest: return { [-placed($0)] }
        case .payout: return { [-$0.payout] }
        case .likely: return { [-($0.estChance ?? 0)] }
        case .staked: return { [-$0.cost] }
        }
    }

    /// The legs shown in a card, in order; the rest had already hit and fold away.
    func mainLegs(_ p: Parlay) -> [Leg] {
        let byTicker = Dictionary(p.legs.map { ($0.ticker, $0) }, uniquingKeysWith: { a, _ in a })
        let order = legOrder[p.ticker] ?? p.legs.filter { !board.won($0) }.map(\.ticker)
        return order.compactMap { byTicker[$0] }
    }

    private func reorderLegs() {
        guard let bets else { return }
        var next: [String: [String]] = [:]
        for p in bets.parlays {
            let legs = Dictionary(p.legs.map { ($0.ticker, $0) }, uniquingKeysWith: { a, _ in a })
            let rank = { (t: String) in legs[t].map(self.board.rank) ?? 9 }
            if let prev = legOrder[p.ticker], prev.allSatisfy({ legs[$0] != nil }) {
                next[p.ticker] = stickyOrder(prev, rank: rank, margin: Self.legMargin)
            } else {
                next[p.ticker] = stickyOrder(p.legs.filter { !board.won($0) }.map(\.ticker), rank: rank)
            }
        }
        legOrder = next
    }

    /// A tap of the phone when a leg you're riding reaches its line.
    private func noticeHits() {
        guard let bets else { return }
        let riding = bets.parlays.filter { !board.lost($0) }
        let won = Set(riding.flatMap { p in p.legs.filter(board.won).map(\.ticker) })
        defer { wonBefore = won }
        guard let before = wonBefore else { return }
        let fresh = won.subtracting(before)
        guard !fresh.isEmpty else { return }
        justHit = fresh
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        Task {
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            withAnimation(.easeOut(duration: 0.8)) { justHit.subtract(fresh) }
        }
    }

    // ---------- Tonight ----------

    struct Night {
        var settled: Double, won: Int, lost: Int, decided: Int, riding: Double, open: Int
    }

    /// Won, lost or cashed out so far tonight, and what's still riding (nightHTML in bets.js).
    var night: Night? {
        guard let rows = bets?.tonight?.rows, !rows.isEmpty else { return nil }
        let decided = rows.filter { $0.riding == 0 }, open = rows.filter { $0.riding > 0 }
        return Night(
            settled: rows.reduce(0) { $0 + $1.paid + $1.locked - ($1.staked - $1.riding) },
            won: decided.filter { $0.paid + $0.locked > $0.staked }.count,
            lost: decided.filter { $0.paid + $0.locked <= $0.staked }.count,
            decided: decided.count,
            riding: open.reduce(0) { $0 + $1.riding },
            open: open.count
        )
    }
}
