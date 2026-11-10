import SwiftUI

/// One leg: what it is and where it stands (left), its chance (right), and a progress track.
struct LegRow: View {
    @Environment(Store.self) private var store
    let leg: Leg

    var body: some View {
        let board = store.board
        let tone = board.tone(leg)
        let p = board.progress(leg)
        let glowing = store.justHit.contains(leg.ticker)

        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(leg.label)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(labelColor(tone))
                        .lineLimit(1)
                    sub(p)
                }
                Spacer(minLength: 0)
                odds(tone)
            }
            Track(progress: p, tone: tone)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(glowing ? Color.accent.opacity(0.14) : .clear, in: .rect(cornerRadius: 10))
    }

    private func labelColor(_ tone: Tone) -> Color {
        switch tone {
        case .hit, .out: .muted
        case .dead: .danger
        default: .text
        }
    }

    /// "12 / 15 PTS · 24m · 6:52 - 2nd", then (live) on court or bench, and fouls when they matter.
    private func sub(_ p: Progress) -> some View {
        HStack(spacing: 0) {
            Text(p.text).lineLimit(1).truncationMode(.middle)
            if let on = p.onCourt {
                Text(" · ")
                if on { Circle().fill(Color.accent).frame(width: 6, height: 6).padding(.trailing, 3) }
                Text(on ? "on court" : "bench")
            }
            if let pf = p.fouls, pf >= 3 {
                Text(" · ")
                Text(pf >= 6 ? "fouled out" : "\(pf) fouls").foregroundStyle(pf >= 5 ? Color.danger : Color.warn)
            }
        }
        .font(.system(size: 12))
        .foregroundStyle(Color.muted)
        .monospacedDigit()
    }

    @ViewBuilder private func odds(_ tone: Tone) -> some View {
        VStack(alignment: .trailing, spacing: 0) {
            if leg.result == "scalar" {
                Text("\(Int(((leg.settledValue ?? 0) * 100).rounded()))¢").bold().foregroundStyle(Color.muted)
                Text("settled").font(.caption2).foregroundStyle(Color.muted)
            } else if store.board.outReason(leg) != nil {
                Text("Out").bold().foregroundStyle(Color.muted)
                Text("fair price").font(.caption2).foregroundStyle(Color.muted)
            } else if tone == .hit {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.accent).font(.system(size: 17))
            } else if let c = leg.chance, leg.result == nil {
                Text((leg.thin == true ? "≈" : "") + "\(Int((c * 100).rounded()))%")
                    .bold()
                    .foregroundStyle(tone == .risk ? Color.warn : tone == .danger ? Color.danger : Color.text)
                    .contentTransition(.numericText(value: c))
                Text(Fmt.multiple(c)).font(.caption2).foregroundStyle(Color.muted)
            }
        }
        .font(.system(size: 14))
        .monospacedDigit()
    }
}

/// How far along: fills toward the line. Moneyline / spread tracks put the goal in the middle.
struct Track: View {
    let progress: Progress
    let tone: Tone

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.chipHover)
                Capsule().fill(fill).frame(width: max(0, geo.size.width * progress.pct))
                if progress.center {
                    Rectangle().fill(Color.muted).frame(width: 2, height: 8).offset(x: geo.size.width / 2 - 1)
                }
            }
        }
        .frame(height: 4)
        .animation(.easeOut(duration: 0.5), value: progress.pct)
    }

    private var fill: Color {
        if progress.under && tone != .hit { return .warn }
        return tone == .pending ? .line : tone == .unknown ? .blue : tone.fill
    }
}
