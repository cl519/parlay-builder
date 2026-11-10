import SwiftUI

/// "My bets": every open parlay, newest first, with each leg's live progress.
struct BetsView: View {
    @Environment(Store.self) private var store
    @AppStorage("sort") private var sort = SortOrder.newest

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 14) {
                    header
                    content
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 24)
            }
            .background(Color.bg)
            .refreshable { await store.refresh(relayout: true) }
            .navigationTitle("My parlays")
            .toolbarTitleDisplayMode(.inlineLarge)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { sortMenu }
            }
        }
    }

    // ---------- Header: balance, tonight, connection ----------

    @ViewBuilder private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                if let balance = store.balance {
                    Text("\(Text("Balance").foregroundStyle(Color.muted)) \(Text(Fmt.usd(balance)).bold())")
                        .font(.subheadline)
                        .monospacedDigit()
                }
                Spacer()
                updatedLabel
            }
            if let n = store.night { NightRow(night: n) }
            if let error = store.error, store.bets != nil {
                Label(error, systemImage: "wifi.exclamationmark")
                    .font(.caption)
                    .foregroundStyle(Color.warn)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.warn.opacity(0.1), in: .rect(cornerRadius: 10))
            }
        }
        .padding(.horizontal, 4)
        .padding(.top, 4)
    }

    private var updatedLabel: some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            HStack(spacing: 5) {
                Circle()
                    .fill(store.error == nil ? Color.accent : Color.warn)
                    .frame(width: 6, height: 6)
                    .opacity(store.loading ? 0.4 : 1)
                    .animation(.easeInOut(duration: 0.4).repeatForever(), value: store.loading)
                if let updated = store.updated {
                    Text(agoText(updated))
                }
            }
            .font(.caption)
            .foregroundStyle(Color.muted)
            .monospacedDigit()
        }
    }

    private func agoText(_ date: Date) -> String {
        let s = max(0, Int(Date.now.timeIntervalSince(date)))
        return s < 60 ? "updated \(s)s ago" : "updated \(s / 60)m ago"
    }

    private var sortMenu: some View {
        Menu {
            Picker("Sort", selection: $sort) {
                ForEach(SortOrder.allCases) { Text($0.label).tag($0) }
            }
        } label: {
            Label(sort.label, systemImage: "arrow.up.arrow.down")
                .labelStyle(.titleAndIcon)
                .font(.subheadline.weight(.semibold))
        }
    }

    // ---------- The cards ----------

    @ViewBuilder private var content: some View {
        if store.bets == nil {
            if let error = store.error {
                ContentUnavailableView {
                    Label("Can't reach your Mac", systemImage: "laptopcomputer.trianglebadge.exclamationmark")
                } description: {
                    Text(error)
                } actions: {
                    Button("Try again") { Task { await store.refresh(relayout: true) } }
                        .buttonStyle(.bordered)
                }
                .padding(.top, 60)
            } else {
                ForEach(0..<3, id: \.self) { _ in SkeletonCard() }
            }
        } else {
            let stacks = store.stacks(sortedBy: sort)
            if stacks.isEmpty {
                ContentUnavailableView("No open parlays", systemImage: "checkmark.seal",
                                       description: Text("Place one on the website and it shows up here."))
                    .padding(.top, 60)
            }
            ForEach(Array(stacks.enumerated()), id: \.element[0].ticker) { i, stack in
                ParlayCard(parlay: stack[0], title: "#\(i + 1)", others: Array(stack.dropFirst()))
            }
        }
    }
}

/// Tonight's money, as on the website: settled so far and what's still riding.
struct NightRow: View {
    let night: Store.Night

    var body: some View {
        let up = night.settled > 0.005, down = night.settled < -0.005
        HStack(spacing: 0) {
            stat(title: "Tonight", value: (up ? "+" : down ? "−" : "") + Fmt.usd(abs(night.settled)),
                 color: up ? .accent : down ? .danger : .text, caption: "settled")
            Divider().frame(height: 28).overlay(Color.line)
            stat(title: "Decided", value: night.decided == 0 ? "–" : "\(night.won)–\(night.lost)", color: .text, caption: "won–lost")
            Divider().frame(height: 28).overlay(Color.line)
            stat(title: "Riding", value: Fmt.usd(night.riding), color: .text,
                 caption: "on \(night.open) \(night.open == 1 ? "bet" : "bets")")
        }
        .padding(.vertical, 10)
        .background(Color.panel, in: .rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.line))
    }

    private func stat(title: String, value: String, color: Color, caption: String) -> some View {
        VStack(spacing: 2) {
            Text(title).font(.caption2.weight(.semibold)).foregroundStyle(Color.muted).textCase(.uppercase)
            Text(value).font(.headline).foregroundStyle(color).monospacedDigit()
                .contentTransition(.numericText())
            Text(caption).font(.caption2).foregroundStyle(Color.muted)
        }
        .frame(maxWidth: .infinity)
    }
}

/// A gray stand-in while the first load runs, the same shape as a card.
struct SkeletonCard: View {
    @State private var dim = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            bar(140, 14)
            bar(200, 10)
            bar(nil, 6)
            ForEach(0..<4, id: \.self) { _ in bar(nil, 26) }
        }
        .padding(16)
        .background(Color.panel, in: .rect(cornerRadius: 14))
        .opacity(dim ? 0.5 : 1)
        .animation(.easeInOut(duration: 0.9).repeatForever(), value: dim)
        .onAppear { dim = true }
    }

    private func bar(_ width: CGFloat?, _ height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 4).fill(Color.chip).frame(width: width, height: height)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
