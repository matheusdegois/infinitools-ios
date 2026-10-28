# Arquitetura iOS

## Interface e estado

`AppModel` mantém catálogo, favoritos, recentes, tema, resultados e arquivos recebidos. Preferências simples usam UserDefaults; arquivos, certificados importados e conteúdo de documentos não entram no histórico. `RootView` usa SwiftUI, com abas de ferramentas, favoritos, arquivos e ajustes. `ToolScreen` mantém a mesma instância de WKWebView ao consultar resultados. A rotação também conserva o editor.

`ResultStore` recebe um arquivo por vez, em blocos de até 192 KiB. Os dados são escritos em `.part`, sincronizados e publicados apenas quando o tamanho confere. UUIDs escolhem diretórios internos; o nome informado pela página só nomeia o arquivo dentro desse diretório. Metadados são atômicos. Arquivos parciais e diretórios deixados por uma interrupção antes da publicação são removidos na inicialização. O limite é 512 MiB, incluindo a validação antes de reservar espaço para uma exportação.

Quick Look abre o resultado com a extensão original. UIActivityViewController compartilha uma cópia por ação explícita. UIDocumentPicker exporta para o app Arquivos sem carregar o resultado inteiro na memória nativa. Excluir pede confirmação. O armazenamento de resultados fica fora do backup automático; a desinstalação apaga essas cópias.

## Origem local e backend

WKWebView não fornece a interceptação arbitrária de HTTPS usada pelo Android. A adaptação usa `NWListener` vinculado exclusivamente a **127.0.0.1:18763**. Nenhum serviço é exposto à rede Wi-Fi. A porta fixa conserva a origem do IndexedDB e do armazenamento web entre execuções. Se a porta estiver ocupada, há erro explícito; o app não muda silenciosamente a origem e perde os rascunhos.

Um cookie de capacidade aleatório por execução autentica as solicitações locais. Host, origem e contexto de navegação são conferidos antes de receber o corpo de um upload. Pedidos HTTP são lidos incrementalmente, com cabeçalho limitado, rejeição de comprimentos ambíguos, suporte a Content-Length e chunked, e corpo em arquivo privado temporário. Respostas e arquivos são enviados em blocos de 64 KiB, com suporte a HEAD e intervalos de bytes. O limite de conexão e os prazos evitam manter requisições incompletas indefinidamente.

`AssetRouter` resolve as rotas para os snapshots públicos. Assets `.traineddata.gz.raw` conservam o nome de URL `.traineddata.gz` esperado pelo OCR. O app entrega COOP/COEP, MIME de WASM e cabeçalhos de isolamento. O transporte JavaScript adapta chamadas absolutas ao domínio Infinitools para a origem local, conservando os parâmetros e corpos de formulários.

Somente a página do downloader e os endpoints públicos de processamento listados em `AssetRouter.endpoints` são encaminhados. `Backend` usa URLSession por HTTPS, validação normal de certificado e cookies efêmeros próprios para manter a sessão CSRF do downloader. O cookie de capacidade local nunca é encaminhado. Redirecionamentos voltam pelo roteador e a lista de endpoints é reaplicada. Um erro HTTPS não recebe exceção de certificado.

A exceção ATS é somente `NSAllowsLocalNetworking`, necessária para o loopback. Não há `NSAllowsArbitraryLoads`, certificados autoassinados ou APIs privadas do WebKit.

`EngineCache` confere tamanho e SHA-256 dos motores remotos, incluindo arquivos já presentes no cache. Bytes divergentes não são executados. Solicitações simultâneas do mesmo motor são agrupadas. O cache usa Caches, separado dos resultados e dos dados persistentes da WebView.

O proxy conserva Content-Type, Content-Disposition e `X-PDFA-Validated`, além dos cabeçalhos de intervalo/redirecionamento permitidos. A confirmação PDF/A do servidor não é sintetizada: o editor exige o valor real `veraPDF` antes de oferecer o resultado. Esse fluxo foi incluído na regressão após identificar a perda do cabeçalho na adaptação inicial.

## Ponte nativa e prévias

`WKScriptMessageHandlerWithReply` recebe somente mensagens do documento principal da origem exata, com limite de tamanho. As ações disponíveis são iniciar/escrever/finalizar/abortar exportação, informar resultado pronto e obter descritores dos arquivos previamente recebidos pelo usuário. Não existe acesso a caminhos arbitrários, execução nativa de código ou proxy genérico por URL.

A exportação aguarda confirmação de cada bloco antes de continuar. Troca de ferramenta, recarga ou encerramento do processo web abortam as transferências pendentes. A injeção do adaptador ocorre no início do documento principal; chamadas diretas de um iframe ao handler também são recusadas pelo nativo.

O testador de protótipos conserva `sandbox="allow-scripts"`, CSP própria sem rede e os limites de ZIP do Android. Não há publicação, token de hospedagem ou chamadas à API de protótipos. O IndexedDB pertence à origem loopback fixa e ao data store persistente do WKWebView.

A prévia Lottie também conserva sandbox opaco. Como esse iframe não pode enviar o cookie da origem local para buscar dependências, o importador cria um documento Blob com os dois scripts públicos incorporados e autorizados por hashes CSP. As quebras de linha são normalizadas antes de calcular o hash, pois o parser HTML normaliza CRLF. A imagem PNG retorna ao documento principal por mensagem; o iframe não recebe a capacidade de exportação nativa.

O GIF mantém seu worker para decodificação/codificação. Quando o worker não oferece OffscreenCanvas 2D, ele solicita a rasterização de um quadro por vez ao documento principal. O adaptador usa a mesma função de cena do motor original com canvas DOM, transfere o buffer RGBA de volta e conserva a conferência de quadros, duração e repetição na saída. O ResizeObserver agenda as escritas de layout em requestAnimationFrame, evitando o ciclo detectado no WebKit. Há cobertura com 60 quadros, texto aplicado a todos e mudança de velocidade.

## Recebimento de arquivos

O app e `InfinitoolsShare` compartilham apenas o App Group `group.br.com.infinitools.ios`. A extensão importa até 20 anexos, copia a representação do provedor durante seu callback e publica cada documento por renomeação após concluir. Pastas de cópia em andamento ficam ocultas, evitando que o app leia um arquivo parcial. A abertura direta de documentos usa a mesma importação, com acesso security-scoped e NSFileCoordinator.

O app apresenta os documentos recebidos e o usuário escolhe a ferramenta. A ponte fornece URLs temporárias com identificador aleatório somente para essas entradas. Dispensar as entradas remove as cópias do inbox. O seletor de arquivos do próprio editor continua sob controle do WKWebView/iOS.

## Limites

O app reaproveita motores web e serviços existentes. A presença de uma ferramenta não garante que qualquer arquivo, codec, modelo de IA ou configuração caiba na memória de todo iPhone. Não se implementa token A3, ausente no Android; A1 continua no motor público e precisa de teste com certificado de teste. Execução de código no compilador depende da configuração do provedor no backend.

Não há sincronização de favoritos ou migração automática do banco IndexedDB do Android para o iPhone. O usuário pode transferir arquivos e ZIPs exportados. A arquitetura nativa ainda requer build e execução em Apple para confirmação.

Referências primárias: [WKURLSchemeHandler](https://developer.apple.com/documentation/webkit/wkurlschemehandler), [NWListener](https://developer.apple.com/documentation/network/nwlistener), [WKScriptMessageHandlerWithReply](https://developer.apple.com/documentation/webkit/wkscriptmessagehandlerwithreply), [NSAllowsLocalNetworking](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking).
