# Licenças

Os assets públicos e os avisos foram reaproveitados do Infinitools Android 1.0.1, sem copiar o backend PHP, credenciais, chave Android, sessões ou certificados. A listagem dos avisos está no próprio app em Ajustes → Licenças de terceiros e no arquivo `Infinitools/Resources/WebContent/web/android/licenses.html`.

O código do site mantém sua licença original. Não se atribui uma licença aberta nova ao material do usuário por meio desta adaptação.

Componentes principais preservados:

| Componente | Licenciamento registrado no Android |
|---|---|
| MuPDF WASM | AGPL-3.0-or-later ou licença comercial aplicável |
| FFmpeg core WASM | GPL-2.0-or-later |
| FFmpeg wrapper | MIT |
| PDF.js | Apache-2.0 |
| pdf-lib, CodeMirror, JSZip, QRCode e ícones Tabler | Avisos MIT incluídos |
| Tesseract.js, OCR e dados de idiomas | Avisos específicos incluídos |
| ONNX Runtime, DeepFilterNet, Demucs e modelos de imagem | Licenças e model cards de cada componente |

O pacote também conserva arquivos públicos auxiliares de distribuições vendor, como um SWF histórico do Forge. iOS não executa esse SWF; a assinatura A1 usa o JavaScript do motor existente. Nenhum suporte a Flash é declarado pelo app.

Antes da distribuição pública, o responsável deve confirmar as licenças e as obrigações de código-fonte correspondente, avisos e compatibilidade com a App Store, ou obter as licenças comerciais necessárias. Este projeto preserva os motores e suas funcionalidades; não troca silenciosamente componentes copyleft por versões com menos recursos.

Referências: [MuPDF](https://mupdf.readthedocs.io/en/latest/license.html), [FFmpeg WASM](https://github.com/ffmpegwasm/ffmpeg.wasm), [PDF.js](https://github.com/mozilla/pdf.js), [Tesseract.js](https://github.com/naptha/tesseract.js).
