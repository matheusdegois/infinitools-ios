import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let status = UILabel()
    private var started = false
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        status.text = "Recebendo arquivos…"; status.numberOfLines = 0; status.textAlignment = .center
        status.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(status)
        NSLayoutConstraint.activate([
            status.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            status.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            status.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !started else { return }; started = true
        let attachments = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        guard !attachments.isEmpty, attachments.count <= 20 else { finish(message: "Compartilhe entre 1 e 20 arquivos."); return }
        process(attachments, index: 0, imported: 0)
    }
    private func process(_ providers: [NSItemProvider], index: Int, imported: Int) {
        guard index < providers.count else { finish(message: "\(imported) arquivo(s) recebido(s). Abra o Infinitools e escolha uma ferramenta para importar."); return }
        let provider = providers[index]
        guard let type = provider.registeredTypeIdentifiers.first(where: { UTType($0)?.conforms(to: .data) == true }) else {
            finish(message: "Formato não suportado. Compartilhe o arquivo pelo app Arquivos."); return
        }
        provider.loadFileRepresentation(forTypeIdentifier: type) { [weak self] url, error in
            // Provider URL is valid only during this callback; copy before returning.
            do {
                if let error = error { throw error }
                guard let url = url else { throw NSError(domain: "Infinitools", code: 1, userInfo: [NSLocalizedDescriptionKey: "Não foi possível ler o arquivo compartilhado."]) }
                _ = try IncomingFiles.copy(url, to: IncomingFiles.inbox())
                DispatchQueue.main.async { self?.process(providers, index: index + 1, imported: imported + 1) }
            } catch { DispatchQueue.main.async { self?.finish(message: "\(imported) arquivo(s) recebido(s). \(error.localizedDescription)") } }
        }
    }
    private func finish(message: String) {
        status.text = message
        let button = UIButton(type: .system)
        button.setTitle("Concluído", for: .normal); button.translatesAutoresizingMaskIntoConstraints = false
        button.addTarget(self, action: #selector(done), for: .touchUpInside)
        view.addSubview(button)
        NSLayoutConstraint.activate([button.topAnchor.constraint(equalTo: status.bottomAnchor, constant: 24), button.centerXAnchor.constraint(equalTo: view.centerXAnchor), button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)])
    }
    @objc private func done() { extensionContext?.completeRequest(returningItems: nil) }
}
