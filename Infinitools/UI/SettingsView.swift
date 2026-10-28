import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @ObservedObject var engine: WebEngine
    @State private var licenses = false
    @State private var clearing = false
    @State private var clearHistory = false
    var body: some View {
        Form {
            Section("Aparência") {
                Picker("Tema", selection: $model.theme) {
                    Text("Sistema").tag("system"); Text("Claro").tag("light"); Text("Escuro").tag("dark")
                }
            }
            Section("Neste aparelho") {
                Button("Limpar histórico de ferramentas", role: .destructive) { clearHistory = true }
                Button(clearing ? "Limpando motores…" : "Limpar motores baixados") {
                    clearing = true
                    engine.clearCache { clearing = false; model.message = "Motores removidos. Serão baixados novamente quando necessários." }
                }.disabled(clearing || model.selectedTool != nil)
                Text("Os resultados ficam no armazenamento privado. A limpeza de motores preserva os resultados e o rascunho do protótipo.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section("Sobre o Infinitools") {
                LabeledContent("Versão", value: "1.0.0 (1)")
                LabeledContent("Ferramentas", value: "\(model.catalog?.tools.count ?? 0)")
                Button("Licenças de terceiros") { engine.showLicenses(); licenses = true }.disabled(!engine.ready)
                Link("Política de privacidade", destination: URL(string: "https://www.infinitools.com.br/privacidade")!)
                Text("Ferramentas locais podem precisar do primeiro download de um motor. Conversões com servidor precisam de internet. Arquivos grandes e formatos específicos dependem dos recursos do aparelho.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }.navigationTitle("Ajustes")
            .confirmationDialog("Limpar histórico?", isPresented: $clearHistory, titleVisibility: .visible) { Button("Limpar", role: .destructive) { model.recentIDs = [] } }
            .sheet(isPresented: $licenses, onDismiss: { engine.close() }) {
                NavigationStack { ToolWebView(engine: engine).navigationTitle("Licenças").navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Concluído") { licenses = false } } } }
            }
    }
}
