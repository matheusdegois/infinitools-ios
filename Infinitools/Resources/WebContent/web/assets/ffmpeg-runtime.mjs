import createCore from './vendor/ffmpeg/core-0.12.10/ffmpeg-core.js';

// @ffmpeg/core 0.12.10 ships with a stack too small for Opus/VP9/HEVC.
// Reserve a separate, aligned stack in the module's own heap. Keep the upstream
// binary unchanged and restore this stack after FFmpeg's intentional abort/exit.
// Da/Ea are the stackSave/stackRestore exports in this EXACT pinned build.
// When upgrading the core, verify these exports and rerun the codec matrix.
export default async function createMediaCore(options) {
    const core = await createCore(options);
    const save = core.asm.Da, restore = core.asm.Ea;
    if (typeof save !== 'function' || typeof restore !== 'function') throw new Error('Motor incompatível: verifique a versão do FFmpeg.');
    const stackBytes = 16 * 1024 * 1024;
    const block = core._malloc(stackBytes);
    if (!block) throw new Error('Não há memória suficiente para iniciar o conversor.');
    const top = Math.floor((block + stackBytes) / 16) * 16;
    restore(top);
    if (save() !== top) throw new Error('Não foi possível configurar a memória do conversor.');
    for (const name of ['exec','ffprobe']) {
        const run = core[name];
        core[name] = (...args) => {
            restore(top);
            try { return run(...args); }
            finally { restore(top); }
        };
    }
    return core;
}
