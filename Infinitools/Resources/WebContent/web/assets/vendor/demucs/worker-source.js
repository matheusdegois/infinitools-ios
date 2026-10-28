import * as ort from 'onnxruntime-web/wasm';

ort.env.wasm.wasmPaths = new URL('./', self.location.href).href;
ort.env.wasm.numThreads = 1;

const SOURCES = ['drums', 'bass', 'other', 'vocals'];
const RATE = 44100;
const SEGMENT = 343980;
const OVERLAP = Math.floor(SEGMENT / 4);
const STRIDE = SEGMENT - OVERLAP;
let session = null;

function pcmWav(left, right) {
    const length = left.length;
    const buffer = new ArrayBuffer(44 + length * 4);
    const view = new DataView(buffer);
    const ascii = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    ascii(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); ascii(8, 'WAVE');
    ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 2, true); view.setUint32(24, RATE, true); view.setUint32(28, RATE * 4, true);
    view.setUint16(32, 4, true); view.setUint16(34, 16, true);
    ascii(36, 'data'); view.setUint32(40, length * 4, true);
    for (let i = 0; i < length; i++) {
        view.setInt16(44 + i * 4, Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), true);
        view.setInt16(46 + i * 4, Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), true);
    }
    return buffer;
}

async function split(rawAudio, id) {
    if (!session) throw new Error('O modelo Demucs ainda não foi carregado.');
    if (rawAudio.sampleRate !== RATE || rawAudio.channelData?.length !== 2) throw new Error('O Demucs precisa de áudio estéreo em 44,1 kHz.');
    const [left, right] = rawAudio.channelData;
    const total = left.length;
    if (!total || right.length !== total) throw new Error('O áudio estéreo está incompleto.');
    const count = Math.max(1, Math.ceil((total - SEGMENT) / STRIDE) + 1);
    const sum = SOURCES.map(() => [new Float32Array(total), new Float32Array(total)]);
    const weight = new Float32Array(total);
    for (let step = 0; step < count; step++) {
        const start = step * STRIDE;
        const valid = Math.min(SEGMENT, total - start);
        const input = new Float32Array(SEGMENT * 2);
        input.set(left.subarray(start, start + valid));
        input.set(right.subarray(start, start + valid), SEGMENT);
        const output = await session.run({mix: new ort.Tensor('float32', input, [1, 2, SEGMENT])});
        const tensor = output.stems;
        if (!tensor || tensor.data.length !== 4 * 2 * SEGMENT) throw new Error('O modelo ONNX não retornou quatro fontes estéreo.');
        for (let index = 0; index < valid; index++) {
            const fadeIn = step === 0 ? 1 : Math.min(1, (index + 1) / OVERLAP);
            const fadeOut = step === count - 1 ? 1 : Math.min(1, (valid - index) / OVERLAP);
            const gain = Math.min(fadeIn, fadeOut);
            const target = start + index;
            weight[target] += gain;
            for (let source = 0; source < 4; source++) {
                sum[source][0][target] += tensor.data[source * 2 * SEGMENT + index] * gain;
                sum[source][1][target] += tensor.data[source * 2 * SEGMENT + SEGMENT + index] * gain;
            }
        }
        self.postMessage({type:'progress', id, step:step + 1, total:count});
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    const files = {};
    for (let source = 0; source < 4; source++) {
        for (let channel = 0; channel < 2; channel++) {
            const samples = sum[source][channel];
            for (let index = 0; index < total; index++) samples[index] /= Math.max(weight[index], 1e-8);
        }
        files[SOURCES[source]] = pcmWav(sum[source][0], sum[source][1]);
    }
    return files;
}

self.addEventListener('message', async event => {
    const {type, id} = event.data || {};
    try {
        if (type === 'load') {
            session?.release();
            session = await ort.InferenceSession.create(event.data.weights || event.data.url, {executionProviders:['wasm'], graphOptimizationLevel:'disabled'});
            if (session.inputNames.length !== 1 || session.outputNames.length !== 1 || session.inputNames[0] !== 'mix' || session.outputNames[0] !== 'stems') throw new Error('Modelo incompatível. Use um HT-Demucs ONNX com entrada mix e saída stems.');
            self.postMessage({type:'ready', id});
        } else if (type === 'split') {
            const output = await split(event.data.rawAudio, id);
            self.postMessage({type:'done', id, output}, Object.values(output));
        }
    } catch (error) {
        self.postMessage({type:'error', id, message:error instanceof Error ? error.message : String(error)});
    }
});
