# FFmpeg local

- `0.12.15/`: ESM files from npm `@ffmpeg/ffmpeg@0.12.15`, MIT.
- `core-0.12.10/ffmpeg-core.js` and `.wasm`: unmodified ESM files from npm `@ffmpeg/core@0.12.10`, GPL-2.0-or-later.
- Upstream: https://github.com/ffmpegwasm/ffmpeg.wasm — includes build recipes and dependency sources.
- Package archives: https://registry.npmjs.org/@ffmpeg/ffmpeg/-/ffmpeg-0.12.15.tgz and https://registry.npmjs.org/@ffmpeg/core/-/core-0.12.10.tgz
- Core wasm SHA-256: `9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7`.
- The included `LICENSE-WRAPPER.txt` and `LICENSE-CORE.txt` contain the license texts. Preserve these notices when distributing the project.
- `.gz` files are precompressed transport copies of the corresponding original files.

## Runtime compatibility

`assets/ffmpeg-runtime.mjs` is application code, separate from the upstream package. It allocates a 16 MiB aligned stack inside the WebAssembly heap and restores it before/after FFmpeg and FFprobe calls. The stock core's stack overflows with VP9 and Opus, including sub-second fixtures. This allocation corrects that failure without modifying the binary or requiring SharedArrayBuffer/COOP/COEP.

The adapter uses the `Da` (stackSave) and `Ea` (stackRestore) exports of this exact pinned core, as named in its generated JavaScript. Do not substitute a different binary under the same version directory. On upgrade, review the adapter, verify the hash/exports, and rerun the real encoder/decoder matrix. The worker is terminated after each operation to free the stack, virtual files and codec memory.

H.265 encoding is deliberately excluded: libx265 deadlocks in this single-thread build. H.264 is the MP4/MOV/MKV default. AMR is input-only; AV1 output is not included. Container and codec capabilities are checked at runtime before conversion.
