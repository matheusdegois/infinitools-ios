# Preparar a distribuição

O projeto ainda precisa ser compilado e validado no Xcode. Não há IPA assinada, publicação no App Store Connect nem validação da conta Apple nesta entrega.

1. Abra `Infinitools.xcodeproj` no Mac e execute `bash scripts/test-ios.sh`. Corrija qualquer diagnóstico de compilação, XCTest ou comportamento em WKWebView antes de prosseguir.
2. Configure a mesma equipe Apple nos targets Infinitools e InfinitoolsShare. Registre os bundle IDs e o App Group; habilite o grupo nos dois targets e perfis de provisionamento.
3. Teste em iPhone e iPad reais os fluxos descritos em `VALIDACAO.md`, incluindo recebimento pela extensão, entrada pela câmera, arquivos em iCloud Drive, resultados grandes, rotação, retorno do segundo plano, encerramento do processo web, VoiceOver e fontes ampliadas.
4. Confira a disponibilidade e configuração dos serviços de produção. Uma resposta da lista de linguagens não comprova que o compilador executa código. Faça testes com documentos sintéticos e certificado de teste; não use uma chave pessoal real no relatório de QA.
5. Resolva as licenças dos motores antes da distribuição. MuPDF AGPL e FFmpeg GPL precisam de avaliação específica para a forma de distribuição na App Store; os avisos originais não constituem uma licença comercial.
6. Revise a política de privacidade e a ficha App Privacy considerando o backend: arquivos enviados para conversões, mídia temporária, IP, logs operacionais e preferências por IP do compilador. O app não inclui analytics/ads nem solicita rastreamento. A ficha da loja precisa descrever o comportamento real do servidor, incluindo retenção, mesmo que ele preexista ao app.
7. Confira os dois `PrivacyInfo.xcprivacy`, descrições da câmera/fotos e respostas de criptografia/export compliance para os motores de assinatura e proteção PDF. Não há exceção de criptografia presumida no Info.plist.
8. Com um destino de dispositivo genérico, use Product → Archive, valide o archive no Organizer e envie primeiro para TestFlight. Defina screenshots reais de iPhone/iPad, descrição, suporte, privacidade e informações para a revisão.

O workflow de GitHub Actions foi preparado para executar as verificações, mas não foi disparado. Aprovação da Apple, elegibilidade de bibliotecas, assinatura e instalação só podem ser confirmadas nas etapas correspondentes.
