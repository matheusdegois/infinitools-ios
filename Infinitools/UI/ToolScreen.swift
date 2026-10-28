import SwiftUI

struct ToolScreen: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var engine: WebEngine
    let tool: Tool
    @State private var showingFiles = false
    @State private var confirmingClose = false
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if tool.mode != "local" {
                    Label("Esta ferramenta pode enviar arquivos ao servidor para processar.", systemImage: "network")
                        .font(.footnote).frame(maxWidth: .infinity, alignment: .leading).padding(12).background(Brand.orange.opacity(0.1))
                }
                if engine.loading { ProgressView().progressViewStyle(.linear) }
                if let error = engine.error {
                    VStack(spacing: 12) {
                        Text(error).font(.callout)
                        Button("Recarregar ferramenta") { engine.reload() }.buttonStyle(.borderedProminent)
                    }.frame(maxWidth: .infinity).padding().background(Color(uiColor: .secondarySystemBackground))
                }
                ToolWebView(engine: engine)
                if let message = engine.savedMessage {
                    HStack { Label(message, systemImage: "checkmark.circle").font(.footnote); Spacer(); Button("Ver arquivos") { showingFiles = true } }
                        .padding(12).background(.regularMaterial)
                }
                HStack(spacing: 16) {
                    Button { showingFiles = true } label: { Label("Arquivos", systemImage: "folder") }
                    Spacer()
                    if engine.resultReady != nil {
                        Button { engine.exportReady() } label: { Label("Salvar resultado", systemImage: "arrow.down.doc") }.buttonStyle(.borderedProminent)
                    }
                }.font(.subheadline).padding(12).background(.bar)
            }
            .navigationTitle(tool.name).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Fechar") { confirmingClose = true } }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { model.toggleFavorite(tool) } label: { Label(model.favoriteIDs.contains(tool.id) ? "Remover dos favoritos" : "Favoritar", systemImage: "star") }
                        if !model.incoming.isEmpty { Button("Importar \(model.incoming.count) arquivo(s) recebido(s)") { engine.importIncoming() } }
                        Button { engine.printPage() } label: { Label("Imprimir", systemImage: "printer") }
                        Button { confirmingClose = true } label: { Label("Reabrir ou fechar", systemImage: "arrow.clockwise") }
                    } label: { Image(systemName: "ellipsis.circle") }.accessibilityLabel("Ações da ferramenta")
                }
            }
            .sheet(isPresented: $showingFiles) { NavigationStack { ResultsView().toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Concluído") { showingFiles = false } } } }.environmentObject(model) }
            .confirmationDialog("O estado atual do editor será encerrado.", isPresented: $confirmingClose, titleVisibility: .visible) {
                Button("Fechar ferramenta", role: .destructive) { dismiss() }
                Button("Recarregar ferramenta", role: .destructive) { engine.reload() }
                Button("Cancelar", role: .cancel) {}
            } message: { Text("Salve os resultados antes de continuar. O rascunho do testador de protótipos é recuperado automaticamente.") }
        }
        .interactiveDismissDisabled()
    }
}
