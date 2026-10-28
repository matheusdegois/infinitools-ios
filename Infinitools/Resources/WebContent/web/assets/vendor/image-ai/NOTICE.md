# Dependências locais de remoção de fundo

## ONNX Runtime Web 1.22.0

- Arquivos: `ort.wasm.min.js`, `ort-wasm-simd-threaded.mjs`, `ort-wasm-simd-threaded.wasm`.
- Distribuição: https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.22.0.tgz
- Projeto: https://github.com/microsoft/onnxruntime
- Licença MIT: `LICENSE-ONNXRUNTIME.txt`.
- Todos os arquivos do runtime são da mesma versão. O editor utiliza uma única thread WebAssembly, sem exigir isolamento cross-origin.

## U²-Net pequeno (U2NETP)

- Modelo: `u2netp.onnx`, 4.574.861 bytes.
- Distribuição: https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx
- MD5 de integridade do upstream: `8e83ca70e441ab06c318d82300c84806`.
- Projeto original: https://github.com/xuebinqin/U-2-Net
- Licença Apache 2.0: `LICENSE-U2NET.txt`.
- Conversão/distribuição e referência de pré-processamento: https://github.com/danielgatis/rembg
- Licença MIT do rembg: `LICENSE-REMBG.txt`.

O editor implementa o pré-processamento RGB 320 × 320 e executa o modelo no navegador. Não utiliza o serviço remoto do rembg. As licenças e atribuições devem acompanhar a distribuição do projeto.
