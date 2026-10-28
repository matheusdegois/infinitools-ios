import SwiftUI

@main
struct InfinitoolsApp: App {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(model)
                .tint(Brand.orange)
                .preferredColorScheme(model.colorScheme)
                .onOpenURL { url in if url.isFileURL { model.receive(url) } }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { model.refreshResults(); model.receivePending() }
                }
        }
    }
}
