import SwiftUI

@main
struct ParlayApp: App {
    @State private var store = Store()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            BetsView()
                .environment(store)
                .preferredColorScheme(.dark)
                .tint(.accent)
                // Poll only while you're looking: leaving the app cancels it, coming back re-lays out
                .task(id: phase == .active) {
                    if phase == .active { await store.poll() }
                }
        }
    }
}
