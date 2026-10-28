# Paridade Android → iOS

Inventário baseado no Android 1.0.1: **158 ferramentas**, 157 snapshots locais e uma página online de downloader. Revisão em 27/10/2026.

“Tela OK” significa que a página foi aberta em WebKit desktop com a ponte iOS, conteúdo e largura conferidos. Não significa testar todas as opções da ferramenta ou executar o app no iPhone. O comportamento nativo está implementado e aguarda validação no Xcode. Os fluxos com arquivos reais estão descritos em [VALIDACAO.md](VALIDACAO.md).

| ID | Ferramenta | Modo | Rota | Tela WebKit |
|---|---|---|---|---|
| pdf:merge | Juntar PDF | local | tool?tool=merge | OK |
| pdf:split | Dividir PDF | local | tool?tool=split | OK |
| pdf:extract | Extrair páginas | local | tool?tool=extract | OK |
| pdf:remove | Remover páginas | local | tool?tool=remove | OK |
| pdf:reorder | Reordenar páginas | local | tool?tool=reorder | OK |
| pdf:organize | Organizar páginas | local | tool?tool=organize | OK |
| pdf:copy | Copiar PDF | local | tool?tool=copy | OK |
| pdf:pages-per-sheet | Páginas por folha | local | tool?tool=pages-per-sheet | OK |
| pdf:scan | Digitalizar para PDF | local | tool?tool=scan | OK |
| pdf:compress | Comprimir PDF | local | tool?tool=compress | OK |
| pdf:repair | Reparar PDF | local | tool?tool=repair | OK |
| pdf:ocr | OCR PDF | local | tool?tool=ocr | OK |
| pdf:flatten | Achatar PDF | local | tool?tool=flatten | OK |
| pdf:rasterize | Rasterizar PDF | local | tool?tool=rasterize | OK |
| pdf:office-pdf | Office para PDF | hybrid | tool?tool=office-pdf | OK |
| pdf:word-pdf | Word para PDF | hybrid | tool?tool=word-pdf | OK |
| pdf:powerpoint-pdf | PowerPoint para PDF | local | tool?tool=powerpoint-pdf | OK |
| pdf:excel-pdf | Excel para PDF | hybrid | tool?tool=excel-pdf | OK |
| pdf:image-pdf | Imagem para PDF | local | tool?tool=image-pdf | OK |
| pdf:jpg-pdf | JPG para PDF | local | tool?tool=jpg-pdf | OK |
| pdf:web-pdf | Web / HTML para PDF | hybrid | tool?tool=web-pdf | OK |
| pdf:text-pdf | Texto para PDF | hybrid | tool?tool=text-pdf | OK |
| pdf:markdown-pdf | Markdown para PDF | hybrid | tool?tool=markdown-pdf | OK |
| pdf:png-pdf | PNG para PDF | local | tool?tool=png-pdf | OK |
| pdf:webp-pdf | WebP para PDF | local | tool?tool=webp-pdf | OK |
| pdf:svg-pdf | SVG para PDF | local | tool?tool=svg-pdf | OK |
| pdf:rtf-pdf | RTF para PDF | hybrid | tool?tool=rtf-pdf | OK |
| pdf:epub-pdf | EPUB para PDF | hybrid | tool?tool=epub-pdf | OK |
| pdf:pdf-word | PDF para Word | local | tool?tool=pdf-word | OK |
| pdf:pdf-word-ocr | PDF para Word com OCR | local | tool?tool=pdf-word-ocr | OK |
| pdf:pdf-powerpoint | PDF para PowerPoint | local | tool?tool=pdf-powerpoint | OK |
| pdf:pdf-excel | PDF para Excel | local | tool?tool=pdf-excel | OK |
| pdf:pdf-excel-ocr | PDF para Excel com OCR | local | tool?tool=pdf-excel-ocr | OK |
| pdf:pdf-jpg | PDF para JPG | local | tool?tool=pdf-jpg | OK |
| pdf:pdf-png | PDF para PNG | local | tool?tool=pdf-png | OK |
| pdf:pdf-svg | PDF para SVG | local | tool?tool=pdf-svg | OK |
| pdf:pdf-text | PDF para texto | local | tool?tool=pdf-text | OK |
| pdf:pdf-html | PDF para HTML | local | tool?tool=pdf-html | OK |
| pdf:pdf-rtf | PDF para RTF | local | tool?tool=pdf-rtf | OK |
| pdf:pdf-epub | PDF para EPUB | local | tool?tool=pdf-epub | OK |
| pdf:pdf-pdfa | PDF para PDF/A | hybrid | tool?tool=pdf-pdfa | OK |
| pdf:pdf-markdown | PDF para Markdown | local | tool?tool=pdf-markdown | OK |
| pdf:stamps | Carimbar PDF | local | tool?tool=stamps | OK |
| pdf:header-footer | Cabeçalho e rodapé | local | tool?tool=header-footer | OK |
| pdf:edit | Editar PDF | local | tool?tool=edit | OK |
| pdf:page-numbers | Inserir números de página | local | tool?tool=page-numbers | OK |
| pdf:watermark | Inserir marca-d'água | local | tool?tool=watermark | OK |
| pdf:rotate | Rodar PDF | local | tool?tool=rotate | OK |
| pdf:crop | Recortar PDF | local | tool?tool=crop | OK |
| pdf:forms | Formulários PDF | local | tool?tool=forms | OK |
| pdf:overlay | Sobrepor PDFs | local | tool?tool=overlay | OK |
| pdf:resize-page | Alterar tamanho da página | local | tool?tool=resize-page | OK |
| pdf:metadata | Editar informações do PDF | local | tool?tool=metadata | OK |
| pdf:digital-sign | Assinar PDF com certificado | local | tool?tool=digital-sign | OK |
| pdf:sanitize | Sanitizar PDF | local | pdf-sanitize | OK |
| pdf:protect | Proteger PDF | local | tool?tool=protect | OK |
| pdf:unlock | Desbloquear PDF | local | tool?tool=unlock | OK |
| pdf:redact | Ocultar / rasurar PDF | local | redact | OK |
| pdf:remove-metadata | Remover metadados | local | tool?tool=remove-metadata | OK |
| pdf:view-pdf | Visualizar PDF | local | viewer | OK |
| pdf:compare-pdf | Comparar PDFs | local | tool?tool=compare-pdf | OK |
| pdf:viewer-preferences | Preferências do visualizador | local | tool?tool=viewer-preferences | OK |
| image:remove-background | Tirar fundo | local | utility?tool=remove-background | OK |
| image:avatar | Criar avatar | local | utility?tool=avatar | OK |
| image:collage | Criar collage | local | utility?tool=collage | OK |
| image:thumbnail | Criar thumbnail | local | utility?tool=thumbnail | OK |
| image:photo-id | Foto 3×4 | local | utility?tool=photo-id | OK |
| image:social-image | Imagem para redes sociais | local | utility?tool=social-image | OK |
| image:optimize-png | Otimizar PNG | local | utility?tool=optimize-png | OK |
| image:editor | Editor de imagem | local | image-editor?tool=editor | OK |
| image:vectorize | Vetorizar imagem | local | image-vectorizer | OK |
| image:batch-adjust | Editar imagens em lote | local | image-batch | OK |
| image:sticker | Imagem para figurinha | local | image-editor?tool=sticker | OK |
| image:image-restore | Restauração/aumento de qualidade de imagem | local | image-editor?tool=image-restore | OK |
| image:move | Mover | local | image-editor?tool=move | OK |
| image:marquee | Letreiro retangular | local | image-editor?tool=marquee | OK |
| image:ellipse-select | Letreiro elíptico | local | image-editor?tool=ellipse-select | OK |
| image:lasso | Laço livre | local | image-editor?tool=lasso | OK |
| image:polygon-lasso | Laço poligonal | local | image-editor?tool=polygon-lasso | OK |
| image:magnetic-lasso | Laço magnético | local | image-editor?tool=magnetic-lasso | OK |
| image:wand | Varinha mágica | local | image-editor?tool=wand | OK |
| image:quick-select | Seleção rápida | local | image-editor?tool=quick-select | OK |
| image:object-select | Seleção de objeto | local | image-editor?tool=object-select | OK |
| image:perspective | Recortar em perspectiva | local | image-editor?tool=perspective | OK |
| image:slice | Fatiar imagem | local | image-editor?tool=slice | OK |
| image:brush | Pincel | local | image-editor?tool=brush | OK |
| image:pencil | Lápis | local | image-editor?tool=pencil | OK |
| image:clone | Carimbo | local | image-editor?tool=clone | OK |
| image:eraser | Borracha | local | image-editor?tool=eraser | OK |
| image:bucket | Lata de tinta | local | image-editor?tool=bucket | OK |
| image:gradient | Gradiente | local | image-editor?tool=gradient | OK |
| image:blur | Desfoque localizado | local | image-editor?tool=blur | OK |
| image:sharpen | Nitidez localizada | local | image-editor?tool=sharpen | OK |
| image:smudge | Borrão | local | image-editor?tool=smudge | OK |
| image:text | Texto horizontal | local | image-editor?tool=text | OK |
| image:text-vertical | Texto vertical | local | image-editor?tool=text-vertical | OK |
| image:pen | Caneta | local | image-editor?tool=pen | OK |
| image:rectangle | Retângulo | local | image-editor?tool=rectangle | OK |
| image:ellipse | Elipse | local | image-editor?tool=ellipse | OK |
| image:polygon | Polígono | local | image-editor?tool=polygon | OK |
| image:zoom | Zoom | local | image-editor?tool=zoom | OK |
| image:hand | Mão | local | image-editor?tool=hand | OK |
| image:background | Tirar fundo no editor | local | image-editor?tool=background | OK |
| image:merge | Mesclar imagens | local | image-editor?tool=merge | OK |
| image:crop | Cortar imagem | local | image-editor?tool=crop | OK |
| image:rotate | Rotação de imagem | local | image-editor?tool=rotate | OK |
| image:exposure | Exposição e Brilho | local | image-editor?tool=exposure | OK |
| image:contrast | Contraste | local | image-editor?tool=contrast | OK |
| image:lights | Realces e Sombras | local | image-editor?tool=lights | OK |
| image:temperature | Temperatura de Cor | local | image-editor?tool=temperature | OK |
| image:saturation | Saturação e Intensidade | local | image-editor?tool=saturation | OK |
| image:hue | Matiz | local | image-editor?tool=hue | OK |
| image:sharpness | Nitidez e Claridade | local | image-editor?tool=sharpness | OK |
| image:noise | Redução de Ruído | local | image-editor?tool=noise | OK |
| image:heal | Remoção de Manchas/Objetos | local | image-editor?tool=heal | OK |
| image:insert | Inserir imagem | local | image-editor?tool=insert | OK |
| image:layers | Camadas e Máscaras | local | image-editor?tool=layers | OK |
| image:curves | Curvas de Tom | local | image-editor?tool=curves | OK |
| image:convert-image | Converter imagens | local | image-converter?tool=convert-image | OK |
| image:jpg-png | JPG para PNG | local | image-converter?tool=jpg-png | OK |
| image:png-jpg | PNG para JPG | local | image-converter?tool=png-jpg | OK |
| image:png-webp | PNG para WebP | local | image-converter?tool=png-webp | OK |
| image:webp-jpg | WebP para JPG | local | image-converter?tool=webp-jpg | OK |
| image:webp-png | WebP para PNG | local | image-converter?tool=webp-png | OK |
| image:heic-jpg | HEIC para JPG | local | image-converter?tool=heic-jpg | OK |
| image:heic-png | HEIC para PNG | local | image-converter?tool=heic-png | OK |
| image:tiff-jpg | TIFF para JPG | local | image-converter?tool=tiff-jpg | OK |
| image:svg-png | SVG para PNG | local | image-converter?tool=svg-png | OK |
| image:raw-jpg | RAW para JPG | local | image-converter?tool=raw-jpg | OK |
| image:psd-png | PSD para PNG | local | image-converter?tool=psd-png | OK |
| image:ai-png | AI para PNG | local | image-converter?tool=ai-png | OK |
| image:image-pdf | Imagem para PDF | local | image-converter?tool=image-pdf | OK |
| image:image-gif | Imagem para GIF | local | image-converter?tool=image-gif | OK |
| media:gif-editor | Editar GIF animado | local | utility?tool=gif-editor | OK |
| media:lottie-viewer | Visualizar Lottie | local | lottie-viewer | OK |
| media:video | Converter vídeo | local | media?tool=video | OK |
| media:audio | Converter áudio | local | media?tool=audio | OK |
| media:audio-restore | Restauração/aumento de qualidade de áudio | local | media?tool=audio-restore | OK |
| media:video-restore | Restauração/aumento de qualidade de vídeo | local | media?tool=video-restore | OK |
| media:extract-audio | Extrair áudio de vídeo | local | media?tool=extract-audio | OK |
| media:video-gif | Vídeo para GIF | local | media?tool=video-gif | OK |
| media:video-image | Capturar imagem do vídeo | local | media?tool=video-image | OK |
| media:images-video | GIF ou fotos para vídeo | local | media?tool=images-video | OK |
| media:youtube-download | Baixar mídia por link | online | youtube-download | OK |
| utility:media-metadata | Inspecionar metadados de mídia | local | utility?tool=media-metadata | OK |
| utility:zip-files | Compactar arquivos ZIP | local | utility?tool=zip-files | OK |
| utility:unzip-files | Descompactar ZIP | local | utility?tool=unzip-files | OK |
| utility:compiladores | Compiladores | online | compiladores | OK |
| utility:qr-code | Gerar código QR | local | utility?tool=qr-code | OK |
| utility:password-generator | Gerar senha segura | local | utility?tool=password-generator | OK |
| utility:create-invoice | Criar fatura PDF | hybrid | utility?tool=create-invoice | OK |
| utility:job-application | Criar candidatura de trabalho | hybrid | utility?tool=job-application | OK |
| utility:sorteio-numeros | Sortear números | local | sorteio-numeros | OK |
| utility:sorteio-times | Sortear times | local | sorteio-times | OK |
| utility:sorteio-palavras | Sortear palavras | local | sorteio-palavras | OK |
| utility:sorteio-imagens | Sortear imagens | local | sorteio-imagens | OK |
| utility:cubo-magico | Cubo mágico | local | cubo-magico | OK |
| utility:publicador-web | Testar protótipo web | local | publicador-web.php | OK |
