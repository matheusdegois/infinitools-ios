# Modelo local de super-resolução

- Modelo: `Xenova/swin2SR-classical-sr-x2-64`, conversão ONNX do modelo original `caidas/swin2SR-classical-sr-x2-64`. Página: https://huggingface.co/Xenova/swin2SR-classical-sr-x2-64
- Pesos: `models/swin2sr/onnx/model_quantized.onnx`, 21.471.413 bytes, SHA-256 `83cff83efba9df253c5d11cda5b944d0ce4d4ef595d2669dc268421519fe34ec`.
- Modelo original: https://huggingface.co/caidas/swin2SR-classical-sr-x2-64, licença Apache-2.0. Consulte `LICENSE-SWIN2SR.txt`.
- Runtime: `@huggingface/transformers@3.7.2` (Apache-2.0), compilado em `transformers.bundle.mjs` com esbuild para uso local. Licença em `LICENSE-TRANSFORMERS.txt`.
- Execução ONNX: `onnxruntime-web@1.22.0-dev.20250409-89f8206ba4`, dependência de Transformers.js, com arquivos WebAssembly locais; licença MIT em `LICENSE-ONNXRUNTIME.txt`.

O navegador baixa os pesos e o runtime deste site apenas ao usar o aumento por IA. A imagem fica no navegador. O limite de entrada da interface é 256 × 256 pixels; o processamento WebAssembly pode ser demorado em aparelhos modestos. O modelo estima detalhes plausíveis e não garante fidelidade ao original.
