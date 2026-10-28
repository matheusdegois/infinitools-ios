# Infinitools para iPhone e iPad

Versão iOS nativa em **SwiftUI + WKWebView**, baseada no Infinitools Android 1.0.1. Destino mínimo: **iOS/iPadOS 17**. O projeto contém as **158 ferramentas**, os **157 editores locais** e o manifesto dos **7 motores baixados sob demanda**. Os motores públicos acompanham o projeto; não é necessário ter a pasta Android para abrir no Mac.

O projeto foi criado em Windows. **A compilação Swift/Xcode, a execução de XCTest e a validação em simulador/aparelho Apple ainda precisam ser realizadas no macOS.** A verificação de sintaxe e os testes de WebKit desktop não substituem essas etapas. Resultados e limitações estão em [docs/VALIDACAO.md](docs/VALIDACAO.md).

## Abrir no Mac

1. Copie esta pasta para um Mac com Xcode 16 ou superior.
2. Abra `Infinitools.xcodeproj` e selecione o esquema **Infinitools**.
3. Para executar no simulador, selecione um iPhone/iPad disponível e pressione Run.
4. Para instalar em aparelho, configure **Signing & Capabilities → Team** nos targets **Infinitools** e **InfinitoolsShare**. Ative em ambos o App Group `group.br.com.infinitools.ios` na sua equipe Apple. O recebimento de compartilhamentos depende desse grupo.
5. Se alterar o identificador do grupo, atualize os dois `.entitlements` e `Shared/IncomingFiles.swift`. Os bundle IDs do app e da extensão devem pertencer à sua equipe.

Não há dependências Swift externas. `node_modules`, Python e Playwright são usados apenas na manutenção e nos testes, sem entrar no aplicativo. O projeto Xcode já está gerado; não depende de XcodeGen, CocoaPods ou de acesso ao projeto Android para compilar.

## Funcionalidades

- Catálogo completo, busca sem acentos, quatro famílias, favoritos e 16 ferramentas recentes.
- Editores originais de PDF, imagem, áudio, vídeo e utilidades; protótipos com editor, prévia isolada, rascunho persistente e ZIP.
- Entrada de arquivos pelo seletor do WKWebView, seleção múltipla e captura de imagem pelo seletor do sistema quando suportada pela ferramenta.
- Resultados privados com exportação em blocos, limite de 512 MiB, tamanho conferido, nomes seguros, prévia Quick Look, compartilhamento, salvar no app Arquivos e exclusão.
- Recebimento de documentos de outros apps por **Compartilhar → Infinitools** e por abertura de arquivos. Após compartilhar, abra o Infinitools, escolha a ferramenta e use **Ações → Importar arquivos recebidos**.
- Consulta de resultados sem desmontar o editor, impressão AirPrint, temas nativos claro/escuro/sistema, rotação e layout para iPad.
- APIs HTTPS originais e downloads de motores com SHA-256. A lista de linguagens, as conversões com servidor e o downloader continuam sujeitos à disponibilidade do backend.

O tema nativo acompanha a preferência do usuário; os editores web preservam a aparência do Android, predominantemente clara. Processamento pesado deve permanecer em primeiro plano. Fechar/recarregar uma ferramenta encerra o estado do editor, exceto o rascunho persistido do testador de protótipos. O iOS pode encerrar o processo web por pressão de memória; o app apresenta uma opção de recarga.

## Verificar e testar

Em Windows, macOS ou Linux, com Node.js 22 e ferramentas de compilação de módulos Node:

```sh
npm ci
npm test
npx playwright install webkit
node scripts/qa-web.mjs
node scripts/qa-web.mjs --flows-only --offline
node scripts/audit-backend.mjs
```

O fixture HTTP em Node e a ponte simulada servem apenas aos testes de motores. A aplicação usa o servidor e o armazenamento implementados em Swift. Os relatórios JSON distinguem esses ambientes.

No Mac:

```sh
bash scripts/test-ios.sh
```

O script executa os testes Foundation (`swift test`), os testes WKWebView e de interface no simulador e um build Release para dispositivo sem assinatura. Use `INFINITOOLS_SIMULATOR_ID` para selecionar outro simulador. Há também um workflow em `.github/workflows/ios.yml`; ele foi preparado, mas sua execução depende de colocar o projeto em um repositório GitHub.

## Atualizar a partir do Android

```sh
node scripts/import-android.mjs "../infinitools android"
node scripts/generate-project.mjs
```

O importador lê apenas os assets públicos já gerados do Android. Faz as adaptações iOS em uma árvore temporária e substitui somente `Infinitools/Resources/WebContent` após concluir. O projeto Android permanece intacto. As adaptações do Lottie, da ponte e da origem local são reproduzíveis; o manifesto registra os hashes de cada arquivo importado.

Para recriar os ícones da marca original, instale Pillow e execute `python scripts/make-icons.py`. Os ícones já acompanham o projeto.

## Documentação

- [Arquitetura e limites da adaptação](docs/ARQUITETURA.md)
- [Validação executada e pendências](docs/VALIDACAO.md)
- [Paridade das 158 ferramentas](docs/PARIDADE.md)
- [Preparação para TestFlight e App Store](docs/PUBLICACAO.md)
- [Licenças dos motores reaproveitados](docs/LICENCAS.md)

O projeto não contém uma IPA assinada e não foi enviado à Apple. Assinatura, instalação e distribuição dependem da equipe Apple e da validação no Xcode.
