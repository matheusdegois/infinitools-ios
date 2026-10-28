`worker.js` is built from `worker-source.js`, which implements browser inference and overlap-add for a four-stem HT-Demucs ONNX model.

The ONNX Runtime Web files are from `onnxruntime-web@1.30.0` (MIT). See `ONNX-LICENSE`.
Source: https://github.com/microsoft/onnxruntime

The bundled `htdemucs_fp16weights.onnx` comes from `StemSplitio/htdemucs-onnx`, licensed MIT by its publisher. It is an ONNX export of Meta's HT-Demucs model.
Source: https://huggingface.co/StemSplitio/htdemucs-onnx
SHA-256: d05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a
See `MODEL-LICENSE` for the original Meta project and `EXPORT-LICENSE` for StemSplit's ONNX export project.

