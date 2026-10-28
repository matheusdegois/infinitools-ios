import SwiftUI

enum Brand {
    static let orange = Color(red: 0.87, green: 0.28, blue: 0.10)
    static let navy = Color(red: 0.09, green: 0.15, blue: 0.21)
    struct Family: Identifiable {
        let id: String, name: String, symbol: String
        let color: Color
    }
    static let families: [Family] = [
        Family(id: "pdf", name: "PDF", symbol: "doc.richtext", color: .red), Family(id: "image", name: "Imagem", symbol: "photo", color: .green),
        Family(id: "media", name: "Áudio e vídeo", symbol: "play.rectangle", color: .purple), Family(id: "utility", name: "Utilidades", symbol: "square.grid.2x2", color: .blue)
    ]
    static func color(_ family: String) -> Color { families.first { $0.id == family }?.color ?? .blue }
}

struct RootView: View {
    @EnvironmentObject private var model: AppModel
    var body: some View {
        Group {
            if let error = model.startupError {
                ContentUnavailableView("Não foi possível iniciar", systemImage: "exclamationmark.triangle", description: Text(error))
            } else if let engine = model.engine {
                MainTabs(engine: engine)
            } else { ProgressView("Preparando ferramentas…") }
        }
        .alert("Infinitools", isPresented: Binding(get: { model.message != nil }, set: { if !$0 { model.message = nil } })) {
            Button("OK", role: .cancel) { model.message = nil }
        } message: { Text(model.message ?? "") }
    }
}

private struct MainTabs: View {
    @EnvironmentObject private var model: AppModel
    @ObservedObject var engine: WebEngine
    var body: some View {
        TabView(selection: $model.selectedTab) {
            NavigationStack { CatalogView(favoritesOnly: false) }
                .tabItem { Label("Ferramentas", systemImage: "square.grid.2x2") }.tag(0)
            NavigationStack { CatalogView(favoritesOnly: true) }
                .tabItem { Label("Favoritos", systemImage: "star") }.tag(1)
            NavigationStack { ResultsView() }
                .tabItem { Label("Arquivos", systemImage: "folder") }.tag(2)
            NavigationStack { SettingsView(engine: engine) }
                .tabItem { Label("Ajustes", systemImage: "slider.horizontal.3") }.tag(3)
        }
        .overlay(alignment: .top) {
            if !engine.ready {
                if let error = engine.error {
                    Text(error).font(.callout).padding().frame(maxWidth: .infinity).background(.regularMaterial)
                } else { ProgressView("Iniciando motor local…").padding().background(.regularMaterial, in: Capsule()) }
            }
        }
        .fullScreenCover(item: $model.selectedTool, onDismiss: { engine.close() }) { tool in
            ToolScreen(engine: engine, tool: tool).environmentObject(model)
        }
    }
}

struct CatalogView: View {
    @EnvironmentObject private var model: AppModel
    let favoritesOnly: Bool
    @State private var query = ""
    @State private var selectedFamily: String?
    private var tools: [Tool] {
        (model.catalog?.search(query, family: selectedFamily) ?? []).filter { !favoritesOnly || model.favoriteIDs.contains($0.id) }
    }
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                if !favoritesOnly { hero }
                else { Text("Suas ferramentas favoritas, em um lugar.").foregroundStyle(.secondary) }
                if !model.incoming.isEmpty { incomingBanner }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        familyButton("Todas", id: nil, symbol: "square.grid.2x2")
                        ForEach(Brand.families, id: \.id) { family in familyButton(family.name, id: family.id, symbol: family.symbol) }
                    }
                }
                if !favoritesOnly, query.isEmpty, selectedFamily == nil, !model.recentIDs.isEmpty {
                    Text("Usadas recentemente").font(.headline)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(model.recentIDs.prefix(6).compactMap { model.catalog?.byID[$0] }) { tool in
                                Button { model.open(tool) } label: {
                                    VStack(alignment: .leading, spacing: 10) {
                                        Image(systemName: tool.symbol).foregroundStyle(Brand.color(tool.family))
                                        Text(tool.name).font(.subheadline.weight(.semibold)).foregroundStyle(.primary).lineLimit(2)
                                    }.frame(width: 130, height: 70, alignment: .leading).padding(14)
                                        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
                                }.buttonStyle(.plain)
                            }
                        }
                    }
                }
                HStack { Text(favoritesOnly ? "Favoritas" : "Explore as ferramentas").font(.headline); Spacer(); Text("\(tools.count)").foregroundStyle(.secondary) }
                if tools.isEmpty {
                    ContentUnavailableView(favoritesOnly && query.isEmpty ? "Seu atalho começa aqui" : "Nenhuma ferramenta encontrada",
                                           systemImage: favoritesOnly ? "star" : "magnifyingglass",
                                           description: Text(favoritesOnly && query.isEmpty ? "Toque na estrela de uma ferramenta para encontrá-la nesta aba." : "Tente outro nome ou categoria."))
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 12)], spacing: 12) {
                    ForEach(tools) { tool in ToolCard(tool: tool) }
                }
                Text("* Motores locais podem exigir um primeiro download. Algumas operações usam o servidor, conforme informado na ferramenta.")
                    .font(.footnote).foregroundStyle(.secondary)
            }.padding(18)
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationTitle(favoritesOnly ? "Sempre à mão" : "infinitools")
        .searchable(text: $query, prompt: "O que você quer fazer?")
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Text("iOS").font(.caption.weight(.bold)).foregroundStyle(.secondary) } }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("\(model.catalog?.tools.count ?? 0) POSSIBILIDADES").font(.caption.weight(.bold)).tracking(2).foregroundStyle(.orange.opacity(0.9))
            Text("Crie. Converta.\nSimplifique.").font(.largeTitle.weight(.bold)).foregroundStyle(.white)
            Text("Seus arquivos, novas possibilidades.").foregroundStyle(.white.opacity(0.8)).font(.subheadline)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(24)
            .background(LinearGradient(colors: [Brand.navy, Color(red: 0.19, green: 0.27, blue: 0.35)], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 24))
    }
    private var incomingBanner: some View {
        HStack {
            Label("\(model.incoming.count) arquivo(s) recebido(s). Escolha uma ferramenta para importar.", systemImage: "tray.and.arrow.down")
                .font(.subheadline)
            Spacer()
            Button { model.dismissIncoming() } label: { Image(systemName: "xmark.circle.fill") }.accessibilityLabel("Dispensar arquivos recebidos")
        }.padding().background(Brand.orange.opacity(0.10), in: RoundedRectangle(cornerRadius: 16))
    }
    private func familyButton(_ title: String, id: String?, symbol: String) -> some View {
        Button { selectedFamily = id } label: {
            Label(title, systemImage: symbol).font(.subheadline.weight(.medium)).padding(.horizontal, 14).padding(.vertical, 11)
                .background(selectedFamily == id ? Brand.orange.opacity(0.15) : Color(uiColor: .secondarySystemGroupedBackground), in: Capsule())
        }.buttonStyle(.plain).foregroundStyle(selectedFamily == id ? Brand.orange : .primary)
            .accessibilityAddTraits(selectedFamily == id ? [.isSelected] : [])
    }
}

private struct ToolCard: View {
    @EnvironmentObject private var model: AppModel
    let tool: Tool
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button { model.open(tool) } label: {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: tool.symbol).font(.title2).foregroundStyle(Brand.color(tool.family))
                        .frame(width: 44, height: 44).background(Brand.color(tool.family).opacity(0.1), in: RoundedRectangle(cornerRadius: 13))
                    VStack(alignment: .leading, spacing: 5) {
                        Text(tool.name).font(.headline).foregroundStyle(.primary).multilineTextAlignment(.leading)
                        Text(tool.description).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.leading)
                        Text(tool.modeLabel).font(.caption.weight(.medium)).foregroundStyle(Brand.color(tool.family)).padding(.top, 4)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }.contentShape(Rectangle())
            }.buttonStyle(.plain)
            Button { model.toggleFavorite(tool) } label: {
                Image(systemName: model.favoriteIDs.contains(tool.id) ? "star.fill" : "star").frame(width: 44, height: 44)
            }.buttonStyle(.plain).foregroundStyle(Brand.orange)
                .accessibilityLabel(model.favoriteIDs.contains(tool.id) ? "Remover \(tool.name) dos favoritos" : "Adicionar \(tool.name) aos favoritos")
        }.padding(14).background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18))
    }
}
