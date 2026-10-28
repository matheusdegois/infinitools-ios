import SwiftUI

struct ResultsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var preview: PreviewFile?
    @State private var share: PreviewFile?
    @State private var save: PreviewFile?
    @State private var deleting: ResultFile?
    var body: some View {
        List {
            if model.results.isEmpty {
                ContentUnavailableView("Seus resultados aparecem aqui", systemImage: "folder", description: Text("Gere um arquivo em uma ferramenta e toque em Salvar resultado ou no download do editor."))
                    .listRowBackground(Color.clear)
            }
            ForEach(model.results) { result in
                VStack(alignment: .leading, spacing: 10) {
                    Button { withURL(result) { preview = PreviewFile(url: $0) } } label: {
                        HStack {
                            Image(systemName: "doc").font(.title2).foregroundStyle(Brand.orange)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(result.name).font(.headline).foregroundStyle(.primary)
                                Text("\(ByteCountFormatter.string(fromByteCount: result.bytes, countStyle: .file)) · \(result.created.formatted(date: .abbreviated, time: .shortened))")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }.buttonStyle(.plain)
                    HStack(spacing: 18) {
                        Button { withURL(result) { share = PreviewFile(url: $0) } } label: { Label("Compartilhar", systemImage: "square.and.arrow.up") }
                        Button { withURL(result) { save = PreviewFile(url: $0) } } label: { Label("Salvar", systemImage: "folder.badge.plus") }
                    }.font(.subheadline).buttonStyle(.borderless)
                }.padding(.vertical, 6)
                .swipeActions { Button("Excluir", role: .destructive) { deleting = result } }
                .contextMenu {
                    Button("Abrir") { withURL(result) { preview = PreviewFile(url: $0) } }
                    Button("Compartilhar") { withURL(result) { share = PreviewFile(url: $0) } }
                    Button("Salvar em Arquivos") { withURL(result) { save = PreviewFile(url: $0) } }
                    Button("Excluir", role: .destructive) { deleting = result }
                }
            }
            if !model.results.isEmpty {
                Text("Os resultados ficam neste aparelho. Salve uma cópia em Arquivos antes de desinstalar o app.").font(.footnote).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Arquivos")
        .refreshable { model.refreshResults() }
        .onAppear { model.refreshResults() }
        .sheet(item: $preview) { FilePreview(url: $0.url).ignoresSafeArea() }
        .sheet(item: $share) { ShareFile(url: $0.url).presentationDetents([.medium, .large]) }
        .sheet(item: $save) { SaveFile(url: $0.url) }
        .confirmationDialog("Excluir este resultado?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Excluir", role: .destructive) { if let result = deleting { model.delete(result) }; deleting = nil }
        } message: { Text(deleting?.name ?? "") }
    }
    private func withURL(_ result: ResultFile, action: (URL) -> Void) {
        do { guard let store = model.engine?.store else { return }; action(try store.fileURL(result)) }
        catch { model.message = error.localizedDescription }
    }
}
