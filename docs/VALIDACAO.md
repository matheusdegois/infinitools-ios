# Validação e limites

Revisão em **27/10/2026**, Windows, Node.js e **Playwright WebKit 26.5** em viewport 393 × 852 com toque. Os horários exatos dos relatórios JSON são UTC. O adaptador foi testado com os recursos empacotados e um servidor de testes Node. **Não houve build Xcode, type checking Swift, execução de XCTest, simulador ou aparelho iOS neste computador.**

## Resultados executados

| Verificação | Resultado registrado |
|---|---|
| Catálogo | 158 IDs únicos e correspondentes ao Android; 145 locais, 11 híbridos, 2 online |
| Páginas em WebKit desktop | 158 abertas; 0 falhas de tela; 0 excessos de largura; 0 erros JavaScript |
| Fluxos funcionais na rodada completa | 26 aprovados |
| Fluxos offline | 24 aprovados; 0 erros JavaScript |
| Verificação estática | 11/11 grupos passaram |
| Ponte JavaScript | 12 testes passaram; JUnit em verification/bridge.xml |
| Configuração Apple | 6 plists/manifests/entitlements e esquema XML lidos; 18 variantes de ícone conferidas |
| Código Swift | 22 arquivos aceitos pelo parser sintático; sem compilação ou checagem de tipos |
| Serviços | Lista com 116 linguagens, página do downloader com CSRF, política de privacidade e sete motores com HEAD 200 e tamanho esperado |

## Fluxos com arquivos sintéticos

| Fluxo | Resultado |
|---|---|
| merge-two-pdfs-and-export | Passou |
| chunked-export-sha256 | Passou |
| raster-pdf-local-assembly | Passou |
| qr-code-canvas | Passou |
| cryptographic-password-generation | Passou |
| jpg-to-png-and-export | Passou |
| batch-two-jpgs-to-png-zip-crc | Passou |
| zip-two-files-content-and-crc | Passou |
| prototype-sandboxed-interactive-preview | Passou |
| prototype-has-no-native-capability | Passou |
| prototype-zip-folders-css-js | Passou |
| prototype-indexeddb-draft-restored | Passou |
| prototype-export-zip-content-and-crc | Passou |
| prototype-rejects-traversal-preserving-draft | Passou |
| prototype-rejects-executable-preserving-draft | Passou |
| prototype-rejects-symlink-preserving-draft | Passou |
| prototype-rejects-oversize-preserving-draft | Passou |
| responsive-prototype-852 | Passou |
| responsive-prototype-834 | Passou |
| gif-sixty-frames-text-speed-and-export | Passou |
| lottie-opaque-sandbox-render-and-png | Passou |
| mupdf-encryption-and-export | Passou |
| tesseract-searchable-pdf-ocr | Passou |
| text-to-pdf-https-backend-and-export | Passou |
| pdfa-backend-output-and-export | Passou |
| ffmpeg-wav-to-mp3-export | Passou |

A conferência de exportação usa 900.001 bytes com conteúdo determinístico e SHA-256. PDFs de teste têm páginas/textos conhecidos; a junção é reaberta e deve ter duas páginas. PNGs têm assinatura binária conferida; ZIPs são abertos com CRC e conteúdo comparados. OCR deve produzir texto pesquisável contendo “123”. A amostra de áudio é um WAV de um segundo gerado no teste. A saída PDF/A é conferida como PDF retornado pelo serviço; não houve certificação independente de conformidade por veraPDF nesta sessão.

O fixture simula o handler WK e verifica tamanho/transferência em blocos, mas **não executa o ResultStore, o parser HTTP ou o servidor Swift**. Os testes dessas implementações estão preparados para macOS/iOS. A exportação nativa real, o fluxo do seletor e o compartilhamento ainda não estão confirmados.

## Problemas encontrados e corrigidos

- Lottie: a prévia com origem opaca não conseguia buscar scripts no loopback autenticado. O documento agora é um Blob isolado, com scripts incorporados e hashes CSP calculados após normalizar quebras de linha. A reprodução e a exportação de PNG foram verificadas.
- GIF: WebKit desktop não disponibilizou OffscreenCanvas 2D no worker. A adaptação mantém a decodificação/codificação no worker e usa o mesmo renderizador de cena com canvas do documento para cada quadro quando necessário. A resposta é transferida em buffers, um quadro por vez. Não se falsifica a presença de APIs nem se remove edição de texto/recorte/rotação. O ResizeObserver agenda escrita de layout no próximo frame para evitar o ciclo observado no WebKit.
- Importação: o pacote é montado separadamente antes da troca de diretório; arquivos privados, PHP e links simbólicos não entram no app.
- Arquivos nativos: autenticação dos pedidos ocorre antes de ler o corpo; arquivos parciais não são publicados; entradas compartilhadas são expostas somente após a cópia completa.
- PDF/A: a adaptação inicial do proxy descartava X-PDFA-Validated. O cabeçalho real do servidor agora é preservado; o editor continua exigindo a confirmação veraPDF, sem simular aprovação.

Capturas em output/qa foram inspecionadas visualmente para PDF e protótipos. São capturas dos editores em WebKit desktop, sem a interface SwiftUI. Não são screenshots de um aplicativo iOS instalado.

## Verificações preparadas, ainda não executadas

- **19 métodos XCTest Foundation** para catálogo, busca, rotas, nomes seguros, integridade em blocos, arquivos incompletos, metadados corrompidos, limpeza após interrupção, parsing incremental/chunked, autenticação antes do corpo e intervalos HTTP.
- Teste iOS hospedado no app: páginas locais em WKWebView real, exportação nativa de 900.001 bytes e prévia isolada sem capacidade de exportação.
- Teste de interface iOS: busca, favoritos, arquivos e ajustes.
- Build Debug/testes e Release em macOS via scripts/test-ios.sh e workflow GitHub Actions. O workflow não foi disparado nesta sessão.

## Validação final em Apple

No Mac, execute bash scripts/test-ios.sh e confira o xcresult. Em iPhone/iPad reais, complete:

1. Compilação e assinatura dos dois targets, App Group e abertura do app instalado.
2. Catálogo, busca sem acentos, favoritos/recentes persistidos após encerrar o processo, tema e acessibilidade com VoiceOver/fontes ampliadas.
3. Seleção única/múltipla de arquivos locais e iCloud; câmera, cancelamento do seletor, abertura de documento e recebimento pela extensão de compartilhamento.
4. Processamento, botão nativo Salvar resultado, prévia Quick Look, compartilhar, salvar no app Arquivos, cancelar exportação e excluir com confirmação.
5. Arquivos perto de 512 MiB, espaço insuficiente, interrupções de escrita, PDFs danificados/protegidos, formatos raros, codecs e motores de IA no limite da memória do aparelho.
6. Orientação, Split View, teclado, retorno do segundo plano e encerramento do processo web sem apresentar como concluído um resultado parcial.
7. Assinatura A1 com certificado de teste e validação do resultado por ferramenta independente. Não se implementa suporte a token A3.
8. Restauração completa de áudio/vídeo, separação Demucs e modelos ONNX em aparelhos representativos, com primeiro download, cache, falta de internet e divergência de hash.
9. Compilador com provedor configurado e downloader com mídia autorizada. A consulta de 116 linguagens não comprova execução de código. Não houve execução paga nem download de conteúdo de terceiros.

Não foram testadas todas as combinações de opções das 158 ferramentas. O inventário completo e os motores foram preservados; os resultados acima delimitam o que foi efetivamente executado.

## Reproduzir

Consulte os comandos no README. Evidências: [WebKit](verification/webkit.json), [offline](verification/webkit-offline.json), [estática](verification/static.json), [backend](verification/backend.json), [configuração](verification/config.json), [JUnit da ponte](verification/bridge.xml) e [manifesto de importação](import-manifest.json).
