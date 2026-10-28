export function restorationFilters(options, stage) {
    const filters = [];
    if (stage === 'repair') {
        if (options.declip) filters.push('adeclip');
        if (options.declick) filters.push('adeclick');
        if (options.dehum) {
            const hz = Number(options.humFrequency);
            if (hz !== 50 && hz !== 60) throw new Error('Escolha 50 ou 60 Hz para remover zumbido.');
            for (let harmonic = 1; harmonic <= 3; harmonic++) filters.push(`bandreject=f=${hz * harmonic}:t=h:w=5`);
        }
        if (options.denoise) {
            const strength = Number(options.noiseStrength);
            if (![8, 12, 18].includes(strength)) throw new Error('Intensidade de redução de ruído inválida.');
            filters.push(`afftdn=nr=${strength}:nf=-50`);
        }
        if (options.gate) filters.push('agate=threshold=0.015:ratio=2:attack=20:release=250');
    } else if (stage === 'finish') {
        if (options.eq) filters.push('highpass=f=75', 'equalizer=f=3000:t=q:w=1:g=2');
        if (options.compressor) filters.push('acompressor=threshold=0.12:ratio=2.5:attack=20:release=200');
        if (options.limiter) filters.push('alimiter=limit=0.94');
        if (options.normalize) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
    } else throw new Error('Etapa de restauração inválida.');
    return filters;
}

export function outputProfile(format) {
    if (format === 'wav') return {ext:'wav',mime:'audio/wav',args:['-c:a','pcm_s16le','-ar','48000']};
    if (format === 'flac') return {ext:'flac',mime:'audio/flac',args:['-c:a','flac','-ar','48000']};
    if (format === 'mp3') return {ext:'mp3',mime:'audio/mpeg',args:['-c:a','libmp3lame','-b:a','320k','-ar','48000']};
    throw new Error('Formato final inválido.');
}

export function restoredVideoProfile(codec) {
    const mp4Codecs = new Set(['h264', 'hevc', 'mpeg4', 'av1']);
    return mp4Codecs.has(String(codec || '').toLowerCase())
        ? {ext:'mp4', mime:'video/mp4'}
        : {ext:'mkv', mime:'video/x-matroska'};
}

export function restoredVideoCommand(videoPath, audioPath, profile, videoIndex = 0) {
    if (!['mp4', 'mkv'].includes(profile.ext)) throw new Error('Contêiner de vídeo inválido.');
    if (!Number.isInteger(videoIndex) || videoIndex < 0) throw new Error('Faixa de vídeo inválida.');
    return [
        '-i', videoPath, '-i', audioPath,
        '-map', `0:${videoIndex}`, '-map', '1:a:0',
        '-map_metadata', '-1', '-sn', '-dn',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
        '-shortest',
        ...(profile.ext === 'mp4' ? ['-movflags', '+faststart'] : []),
        `restore-final.${profile.ext}`,
    ];
}

export function readPcm16StereoWav(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const text = (at,len) => String.fromCharCode(...bytes.subarray(at,at+len));
    if (text(0,4) !== 'RIFF' || text(8,4) !== 'WAVE') throw new Error('WAV inválido para o modelo Demucs.');
    let offset = 12, format = null, dataOffset = -1, dataLength = 0;
    while (offset + 8 <= bytes.length) {
        const type = text(offset,4), length = view.getUint32(offset+4,true), start = offset+8;
        if (start+length > bytes.length) break;
        if (type === 'fmt ') format = {pcm:view.getUint16(start,true),channels:view.getUint16(start+2,true),sampleRate:view.getUint32(start+4,true),bits:view.getUint16(start+14,true)};
        if (type === 'data') { dataOffset=start; dataLength=length; break; }
        offset = start+length+(length&1);
    }
    if (!format || format.pcm !== 1 || format.channels !== 2 || format.sampleRate !== 44100 || format.bits !== 16 || dataOffset < 0) throw new Error('O Demucs requer WAV PCM estéreo de 44,1 kHz.');
    const samples = Math.floor(dataLength/4), buffer = new Float32Array(samples*2);
    for(let i=0;i<samples;i++){buffer[i]=view.getInt16(dataOffset+i*4,true)/32768;buffer[samples+i]=view.getInt16(dataOffset+i*4+2,true)/32768;}
    return {channelData:[buffer.subarray(0,samples),buffer.subarray(samples)],sampleRate:44100};
}
