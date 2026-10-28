import {DeepFilter} from './vendor/deepfilternet/index.js';

self.addEventListener('message', async event => {
    if (event.data?.type !== 'process') return;
    const id = event.data.id;
    let filter;
    try {
        filter = await DeepFilter.create();
        const input = new Float32Array(event.data.buffer);
        const frameLength = filter.frameLength;
        const output = new Float32Array(input.length);
        const frames = Math.ceil(input.length / frameLength);
        for (let i = 0; i < frames; i++) {
            const start = i * frameLength;
            const frame = new Float32Array(frameLength);
            frame.set(input.subarray(start, Math.min(input.length, start + frameLength)));
            const clean = filter.process(frame);
            output.set(clean.subarray(0, Math.min(frameLength, output.length - start)), start);
            if (i % 100 === 0) { self.postMessage({type:'progress',id,done:i,total:frames}); await new Promise(resolve => setTimeout(resolve,0)); }
        }
        self.postMessage({type:'done',id,buffer:output.buffer},[output.buffer]);
    } catch (error) {
        self.postMessage({type:'error',id,message:error instanceof Error ? error.message : String(error)});
    } finally { filter?.destroy(); }
});
