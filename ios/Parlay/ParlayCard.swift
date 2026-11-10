import SwiftUI

/// One parlay: money and chance up top, a segment per leg, then each leg's progress.
/// `others`: the rest of its stack (parlays asking the same questions), as rows underneath.
struct ParlayCard: View {
    @Environment(Store.self) private var store
    let parlay: Parlay
    let title: String
    var others: [Parlay] = []

    /// Long parlays show their shakiest legs first; the rest fold away, so a 30-leg card fits on a screen.
    static let firstLegs = 6

    @State private var showHits = false
    @State private var showAll = false
    @State private var openKids: Set<String> = []

    var body: some View {
        let board = store.board
        let s = board.summary(parlay)
        let main = store.mainLegs(parlay)
        let folded = parlay.legs.filter { leg in !main.contains { $0.ticker == leg.ticker } }

        VStack(alignment: .leading, spacing: 0) {
            head(dead: !s.dead.isEmpty)
            meter
            counts(s)
            VStack(spacing: 2) {
                ForEach(showAll ? main : Array(main.prefix(Self.firstLegs))) { LegRow(leg: $0) }
            }
            .padding(.horizontal, 6)
            .padding(.bottom, folded.isEmpty && others.isEmpty && main.count <= Self.firstLegs ? 8 : 2)

            if main.count > Self.firstLegs {
                foldButton(showAll ? "Show fewer legs" : "Show \(main.count - Self.firstLegs) more legs", open: showAll) { showAll.toggle() }
            }

            if !folded.isEmpty {
                foldButton("\(showHits ? "Hide" : "Show") \(folded.count) \(folded.count == 1 ? "leg" : "legs") that hit", open: showHits) { showHits.toggle() }
                if showHits {
                    VStack(spacing: 2) { ForEach(folded) { LegRow(leg: $0) } }
                        .padding(.horizontal, 6)
                        .padding(.bottom, 8)
                        .transition(.opacity)
                }
            }
            if !others.isEmpty { stack }
        }
        .background(Color.panel, in: .rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(board.tone(parlay)?.border ?? Color.line))
        .opacity(s.dead.isEmpty ? 1 : 0.55)
    }

    private func foldButton(_ title: String, open: Bool, toggle: @escaping () -> Void) -> some View {
        Button {
            withAnimation(.snappy) { toggle() }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "chevron.right").rotationEffect(.degrees(open ? 90 : 0))
                Text(title)
            }
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(TextPress())
    }

    // ---------- Head ----------

    private func head(dead: Bool) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("\(title) · \(parlay.single ? "single bet" : "\(parlay.legs.count)-leg parlay")")
                    .font(.system(size: 15, weight: .bold))
                Text("\(Fmt.usd(parlay.cost)) → \(Text(Fmt.usd(parlay.payout)).foregroundStyle(Color.accent).bold())")
                    .foregroundStyle(Color.muted)
                    .font(.subheadline)
                    .monospacedDigit()
                Text(placedLine).font(.caption).foregroundStyle(Color.muted)
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 1) {
                if dead {
                    Text("Lost").font(.system(size: 20, weight: .bold)).foregroundStyle(Color.danger)
                    Text("a leg missed").font(.caption2).foregroundStyle(Color.muted)
                } else if let est = parlay.estChance {
                    Text(Fmt.percent(est)).font(.system(size: 20, weight: .bold)).monospacedDigit()
                        .contentTransition(.numericText(value: est))
                    Text("est. chance · \(Fmt.multiple(est))").font(.caption2).foregroundStyle(Color.muted)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
        .padding(.bottom, 10)
    }

    private var placedLine: String {
        let id = Fmt.parlayID(parlay.ticker)
        guard let date = Fmt.date(parlay.placed) else { return id }
        return "placed \(date.formatted(date: .omitted, time: .shortened)) · \(id)"
    }

    /// One segment per leg, in the card's order: how far from hitting, at a glance.
    private var meter: some View {
        HStack(spacing: 2) {
            ForEach(meterLegs) { leg in
                RoundedRectangle(cornerRadius: 2)
                    .fill(store.board.tone(leg).fill)
                    .frame(height: 6)
            }
        }
        .padding(.horizontal, 16)
    }

    /// Hit legs first (left), then the rest as the card lists them: the bar fills up from the left.
    private var meterLegs: [Leg] {
        let main = store.mainLegs(parlay)
        let folded = parlay.legs.filter { leg in !main.contains { $0.ticker == leg.ticker } }
        return folded + main.reversed()
    }

    private func counts(_ s: LiveBoard.Summary) -> some View {
        HStack(spacing: 12) {
            if !s.hit.isEmpty { Text("✓ \(s.hit.count) hit").foregroundStyle(Color.accent) }
            if !s.dead.isEmpty { Text("✕ \(s.dead.count) missed").foregroundStyle(Color.danger) }
            if s.atRisk > 0 { Text("⚠ \(s.atRisk) at risk").foregroundStyle(Color.warn) }
            if !s.out.isEmpty { Text("○ \(s.out.count) out") }
            Text("\(s.open.count) to go")
            Spacer(minLength: 0)
        }
        .font(.caption.weight(.medium))
        .foregroundStyle(Color.muted)
        .monospacedDigit()
        .padding(.horizontal, 16)
        .padding(.top, 9)
        .padding(.bottom, 4)
    }

    // ---------- The rest of the stack ----------

    private var stack: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Also in this stack (\(others.count))")
                .font(.caption2.weight(.semibold))
                .textCase(.uppercase)
                .kerning(0.8)
                .foregroundStyle(Color.muted)
                .padding(.horizontal, 4)
            ForEach(others) { kid in
                StackRow(parlay: kid, top: parlay, open: openKids.contains(kid.ticker)) {
                    withAnimation(.snappy) {
                        if openKids.contains(kid.ticker) { openKids.remove(kid.ticker) } else { openKids.insert(kid.ticker) }
                    }
                }
                if openKids.contains(kid.ticker) {
                    ParlayCard(parlay: kid, title: "In this stack")
                        .padding(.leading, 12)
                        .overlay(alignment: .leading) { Rectangle().fill(Color.line).frame(width: 2) }
                        // Unfolds from under the row: a fade with a small settle, never sliding over it
                        .transition(.opacity.combined(with: .offset(y: -8)))
                }
            }
        }
        .padding(12)
        .background(Color.white.opacity(0.015))
        .overlay(alignment: .top) { Rectangle().fill(Color.line).frame(height: 1) }
    }
}

/// A parlay in another's stack, compact: how it differs from the card above it.
struct StackRow: View {
    @Environment(Store.self) private var store
    let parlay: Parlay
    let top: Parlay
    let open: Bool
    let toggle: () -> Void

    var body: some View {
        let board = store.board
        let s = board.summary(parlay)
        Button(action: toggle) {
            HStack(spacing: 8) {
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .rotationEffect(.degrees(open ? 90 : 0))
                    .foregroundStyle(Color.muted)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(Text("\(parlay.legs.count)-leg \(relation.name)").bold().foregroundStyle(Color.text)) · \(Fmt.usd(parlay.cost)) → \(Fmt.usd(parlay.payout))")
                        .font(.footnote)
                        .monospacedDigit()
                    Text(relation.text).font(.caption2).lineLimit(1)
                }
                .foregroundStyle(Color.muted)
                Spacer(minLength: 0)
                if s.atRisk > 0 { Text("⚠ \(s.atRisk)").font(.caption).foregroundStyle(Color.warn) }
                if let est = parlay.estChance {
                    Text(Fmt.percent(est)).font(.subheadline.weight(.bold)).monospacedDigit()
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 9)
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(board.tone(parlay)?.border ?? Color.line))
            .contentShape(.rect)
        }
        .buttonStyle(RowPress())
    }

    /// "replacement" only when it adds nothing and came later; text: adjusted / plus / without (bets.js relation).
    private var relation: (name: String, text: String) {
        let board = store.board
        let inMine = Dictionary(parlay.legs.map { ($0.question, $0) }, uniquingKeysWith: { a, _ in a })
        let inTop = Dictionary(top.legs.map { ($0.question, $0) }, uniquingKeysWith: { a, _ in a })
        let without = top.legs.filter { inMine[$0.question] == nil && !board.won($0) }
        let plus = parlay.legs.filter { inTop[$0.question] == nil }
        let changed = parlay.legs.filter { l in inTop[l.question].map { $0.ticker != l.ticker } ?? false }
        let later = (Fmt.date(parlay.placed) ?? .distantPast) > (Fmt.date(top.placed) ?? .distantPast)
        let adjusted = changed.map { l -> String in
            let was = inTop[l.question]!
            guard let player = l.player, let a = was.line, let b = l.line, let stat = l.stat else { return l.label }
            return "\(player) \(Fmt.line(a))+ → \(Fmt.line(b))+ \(stat)"
        }
        let parts = [
            changed.isEmpty ? nil : list(adjusted),
            plus.isEmpty ? nil : "plus " + list(plus.map(\.label)),
            without.isEmpty ? nil : "without " + list(without.map(\.label)),
        ].compactMap { $0 }
        return (plus.isEmpty && later ? "replacement" : "parlay", parts.isEmpty ? "same open legs" : parts.joined(separator: " · "))
    }

    private func list(_ names: [String]) -> String {
        names.prefix(3).joined(separator: ", ") + (names.count > 3 ? " and \(names.count - 3) more" : "")
    }
}

/// A tappable row: lightens and dips a hair while pressed, then springs back (no default dimming).
struct RowPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Color.chip : Color.panel2, in: .rect(cornerRadius: 10))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.spring(duration: 0.25), value: configuration.isPressed)
    }
}

/// A text button: brightens while pressed instead of fading.
struct TextPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(configuration.isPressed ? Color.text : Color.muted)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}
