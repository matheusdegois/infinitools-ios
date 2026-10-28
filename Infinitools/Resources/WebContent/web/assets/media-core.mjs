// Profiles explicitly pair each container with compatible encoders.
const profile = (label, ext, mime, muxer, video, audio) => ({label, ext, mime, muxer, video, audio});
export const videoFormats = {
    mp4: profile('MP4', 'mp4', 'video/mp4', 'mp4', 'libx264', 'aac'),
    webm: profile('WebM', 'webm', 'video/webm', 'webm', 'libvpx-vp9', 'libopus'),
    mkv: profile('MKV', 'mkv', 'video/x-matroska', 'matroska', 'libx264', 'aac'),
    mov: profile('MOV', 'mov', 'video/quicktime', 'mov', 'libx264', 'aac'),
    avi: profile('AVI', 'avi', 'video/x-msvideo', 'avi', 'mpeg4', 'libmp3lame'),
    flv: profile('FLV', 'flv', 'video/x-flv', 'flv', 'flv', 'libmp3lame'),
    f4v: profile('F4V', 'f4v', 'video/mp4', 'f4v', 'libx264', 'aac'),
    wmv: profile('WMV', 'wmv', 'video/x-ms-wmv', 'asf', 'wmv2', 'wmav2'),
    mpeg: profile('MPEG / MPG', 'mpeg', 'video/mpeg', 'mpeg', 'mpeg2video', 'mp2'),
    '3gp': profile('3GP', '3gp', 'video/3gpp', '3gp', 'h263', 'aac'),
    ts: profile('TS', 'ts', 'video/mp2t', 'mpegts', 'libx264', 'aac'),
    ogv: profile('OGV', 'ogv', 'video/ogg', 'ogg', 'libtheora', 'libvorbis'),
    vob: profile('VOB (DVD)', 'vob', 'video/mpeg', 'vob', 'mpeg2video', 'ac3'),
    mxf: profile('MXF', 'mxf', 'application/mxf', 'mxf', 'mpeg2video', 'pcm_s16le'),
};
export const audioFormats = {
    mp3: profile('MP3', 'mp3', 'audio/mpeg', 'mp3', null, 'libmp3lame'),
    weba: profile('WebA (WebM / Opus)', 'weba', 'audio/webm', 'webm', null, 'libopus'),
    wav: profile('WAV (PCM sem compressão)', 'wav', 'audio/wav', 'wav', null, 'pcm_s16le'),
    aac: profile('AAC', 'aac', 'audio/aac', 'adts', null, 'aac'),
    m4a: profile('M4A (AAC)', 'm4a', 'audio/mp4', 'ipod', null, 'aac'),
    flac: profile('FLAC (sem perdas)', 'flac', 'audio/flac', 'flac', null, 'flac'),
    ogg: profile('OGG (Vorbis)', 'ogg', 'audio/ogg', 'ogg', null, 'libvorbis'),
    oga: profile('OGA (Vorbis)', 'oga', 'audio/ogg', 'ogg', null, 'libvorbis'),
    opus: profile('Opus', 'opus', 'audio/ogg', 'opus', null, 'libopus'),
    wma: profile('WMA', 'wma', 'audio/x-ms-wma', 'asf', null, 'wmav2'),
    aiff: profile('AIFF (PCM sem compressão)', 'aiff', 'audio/aiff', 'aiff', null, 'pcm_s16be'),
    mp2: profile('MP2', 'mp2', 'audio/mpeg', 'mp2', null, 'mp2'),
    m4b: profile('M4B (AAC)', 'm4b', 'audio/mp4', 'ipod', null, 'aac'),
    m4r: profile('M4R (toque do iPhone)', 'm4r', 'audio/mp4', 'ipod', null, 'aac'),
    ac3: profile('AC3 (Dolby Digital)', 'ac3', 'audio/ac3', 'ac3', null, 'ac3'),
};
export const imageFormats = {
    jpeg: {...profile('JPEG', 'jpeg', 'image/jpeg', 'image2', 'png', null), postProcess:true},
    jpg: {...profile('JPG', 'jpg', 'image/jpeg', 'image2', 'png', null), postProcess:true},
    png: profile('PNG', 'png', 'image/png', 'image2', 'png', null),
    webp: {...profile('WebP', 'webp', 'image/webp', 'image2', 'png', null), postProcess:true},
    pdf: {...profile('PDF', 'pdf', 'application/pdf', 'image2', 'png', null), postProcess:true},
    gif: {...profile('GIF', 'gif', 'image/gif', 'image2', 'png', null), postProcess:true},
};
export const animationFormats = {
    gif: profile('GIF animado', 'gif', 'image/gif', 'gif', 'gif', null),
    mp4: profile('MP4 compacto para WhatsApp', 'mp4', 'video/mp4', 'mp4', 'libx264', null),
};
export const videoExtensions = ['mp4','webm','mkv','mov','avi','flv','f4v','wmv','mpeg','mpg','3gp','ts','ogv','vob','rm','rmvb','mxf','m4v','mts','m2ts'];
export const audioExtensions = ['mp3','weba','webm','wav','aac','m4a','m4b','m4r','flac','ogg','oga','opus','wma','aiff','aif','amr','mp2','ape','ac3'];
export const photoExtensions = ['png','jpg','jpeg','webp','bmp'];
export const extension = name => name.toLowerCase().split('.').pop();
export const MAX_INPUT_BYTES = 256 * 1024 * 1024;
export function formatsFor(mode) {
    if (mode === 'audio' || mode === 'extract-audio') return audioFormats;
    if (mode === 'video-gif') return animationFormats;
    if (mode === 'video-image') return imageFormats;
    return videoFormats;
}
export function extensionsFor(mode) {
    return mode === 'audio' ? audioExtensions : mode === 'images-video' ? ['gif', ...photoExtensions] : videoExtensions;
}
export function validateFiles(files, mode) {
    if (!files.length) throw new Error('Selecione um arquivo para converter.');
    if (mode !== 'images-video' && files.length !== 1) throw new Error('Selecione somente um arquivo por conversão.');
    if (files.length > 50) throw new Error('Use até 50 fotos por sequência.');
    if (files.some(f => !f.size)) throw new Error('Um dos arquivos está vazio.');
    if (files.some(f => !extensionsFor(mode).includes(extension(f.name)))) throw new Error('Formato de entrada não aceito nesta ferramenta.');
    if (files.reduce((sum, f) => sum + f.size, 0) > MAX_INPUT_BYTES) throw new Error('Os arquivos excedem o limite de 256 MB por operação.');
    if (mode === 'images-video') {
        if (files.some(f => extension(f.name) === 'gif') && files.length !== 1) throw new Error('Selecione um GIF sozinho ou uma sequência de fotos sem GIF.');
        if (files.some(f => extension(f.name) !== 'gif' && f.size > 30 * 1024 * 1024)) throw new Error('Cada foto deve ter até 30 MB.');
    }
}
export function parseCapabilities(encoders, muxers) {
    const e = new Set(), m = new Set();
    for (const line of encoders.split('\n')) { const match = line.match(/^\s*[VAS][A-Z.]{5}\s+(\S+)/); if (match) e.add(match[1]); }
    for (const line of muxers.split('\n')) { const match = line.match(/^\s*E\s+(\S+)/); if (match) match[1].split(',').forEach(x => m.add(x)); }
    return {encoders:e, muxers:m};
}
export function supported(format, capabilities, codec = '') {
    // An encoder can be listed by FFmpeg while remaining unusable in this
    // single-thread build. Never advertise HEVC encoding based on presence alone.
    if ((codec || format.video) === 'libx265') return false;
    if (format.postProcess) return capabilities.muxers.has('image2') && capabilities.encoders.has('png');
    return capabilities.muxers.has(format.muxer) && [codec || format.video, format.audio].filter(Boolean).every(c => capabilities.encoders.has(c));
}
function numeric(value, fallback, min, max, label) {
    const n = value === '' || value == null ? fallback : Number(value);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label}: use um número entre ${min} e ${max}.`);
    return n;
}
export function settingsFor(mode, raw = {}) {
    const formats = formatsFor(mode), format = formats[raw.format || Object.keys(formats)[0]];
    if (!format) throw new Error('Formato de saída inválido.');
    const quality = raw.quality || 'balanced';
    if (!['small','balanced','high'].includes(quality)) throw new Error('Qualidade inválida.');
    const start = numeric(raw.start, 0, 0, 86400, 'Início');
    const duration = raw.duration === '' || raw.duration == null ? (mode === 'video-gif' ? 5 : null) : numeric(raw.duration, 5, .1, mode === 'video-gif' ? 6 : 86400, 'Duração');
    const fps = numeric(raw.fps, mode === 'video-gif' ? 10 : 0, 0, mode === 'video-gif' ? 15 : 60, 'FPS');
    if (mode === 'video-gif' && fps < 1) throw new Error('Animação: use entre 1 e 15 FPS.');
    const width = numeric(raw.width, mode === 'video-gif' ? 480 : 0, 0, mode === 'video-gif' ? 480 : 7680, 'Largura');
    if (width && (width < 16 || width % 2 !== 0)) throw new Error('A largura deve ser par e ter pelo menos 16 pixels.');
    const height = numeric(raw.height, 0, 0, 4320, 'Altura');
    if (height && (height < 16 || height % 2 !== 0)) throw new Error('A altura deve ser par e ter pelo menos 16 pixels.');
    if (width && height && width * height > 33177600) throw new Error('A resolução excede 8K.');
    const fit = raw.fit || 'contain';
    if (!['contain','cover','stretch'].includes(fit)) throw new Error('Ajuste de resolução inválido.');
    const bitrate = numeric(raw.bitrate, 192, 64, 320, 'Bitrate');
    if (![64,96,128,192,256,320].includes(bitrate)) throw new Error('Bitrate inválido.');
    const track = numeric(raw.track, 1, 1, 32, 'Faixa de áudio');
    if (!Number.isInteger(track)) throw new Error('A faixa de áudio deve ser um número inteiro.');
    const codec = raw.codec || format.video;
    const allowed = format.ext === 'webm' ? ['libvpx','libvpx-vp9'] : ['mp4','mov','mkv'].includes(format.ext) ? ['libx264','libx265'] : [format.video];
    if (codec === 'libx265') throw new Error('A codificação H.265 está desativada neste motor por instabilidade. Use H.264 ou VP9.');
    if (!allowed.includes(codec)) throw new Error('Codec incompatível com o formato escolhido.');
    const animationCrf = numeric(raw.animationCrf, 30, 18, 45, 'Compressão da animação');
    return {mode, format, quality, start, duration, fps, width, height, fit, upscale:raw.upscale === true || raw.upscale === 'yes', bitrate, track, codec, mute:!!raw.mute, seconds:numeric(raw.seconds, 2, .5, 30, 'Segundos por foto'), animationCrf};
}
export function resolutionFilter(s) {
    const dimension = (n, axis) => s.upscale ? String(n) : `'min(${n},${axis})'`;
    if (s.width && s.height) {
        const w=dimension(s.width,'iw'),h=dimension(s.height,'ih');
        if (s.fit === 'stretch') return `scale=${w}:${h}:flags=lanczos`;
        if (s.fit === 'cover') return `scale=${w}:${h}:force_original_aspect_ratio=increase:force_divisible_by=2:flags=lanczos,crop=${s.width}:${s.height}`;
        return `scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad=${s.width}:${s.height}:(ow-iw)/2:(oh-ih)/2`;
    }
    if (s.width) return `scale=w=${dimension(s.width,'iw')}:h=-2:flags=lanczos`;
    if (s.height) return `scale=w=-2:h=${dimension(s.height,'ih')}:flags=lanczos`;
    return 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
}
export function validateStreams(meta, settings) {
    const videos = (meta.streams || []).filter(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
    const audios = (meta.streams || []).filter(s => s.codec_type === 'audio');
    if (settings.mode !== 'audio' && !videos.length) throw new Error('Este arquivo não contém uma faixa de vídeo válida.');
    if (!['audio','extract-audio'].includes(settings.mode) && videos[0]?.codec_name === 'av1') throw new Error('Este arquivo usa vídeo AV1. O motor instalado não consegue decodificar AV1, mesmo dentro de MKV ou MP4. Use uma cópia em H.264, H.265, VP8 ou VP9. A extração de áudio ainda pode funcionar.');
    if (['audio','extract-audio'].includes(settings.mode) && !audios.length) throw new Error('Este arquivo não contém áudio para converter ou extrair.');
    if (!settings.mute && audios.length && settings.track > audios.length) throw new Error(`O arquivo possui ${audios.length} faixa(s) de áudio. Escolha uma faixa existente.`);
    const duration = Number(meta.format?.duration || videos[0]?.duration || audios[0]?.duration);
    if(settings.width&&settings.height&&settings.fit==='cover'&&!settings.upscale&&videos.length&&(settings.width>videos[0].width||settings.height>videos[0].height))throw new Error('Para preencher uma resolução maior que a original, permita aumentar a resolução ou escolha manter proporção e adicionar barras.');
    if (Number.isFinite(duration) && duration > 0 && settings.start >= duration) throw new Error('O instante inicial está fora da duração do arquivo.');
    return {videoIndex:videos[0]?.index, hasAudio:audios.length > 0, duration:Number.isFinite(duration) && duration > 0 ? duration : null};
}
// All input names are generated by the app; original names never enter FFmpeg commands.
export function buildCommand(input, settings, media = {}) {
    const s = settings, p = s.format;
    const args = ['-hide_banner','-protocol_whitelist','file,pipe'];
    if (media.sequence) args.push('-f','concat','-safe','1');
    else {
        if (s.start > 0) args.push('-ss',String(s.start));
        if (input.endsWith('.gif')) args.push('-ignore_loop','1');
    }
    args.push('-i',input);
    if (media.sequence && s.start > 0) args.push('-ss',String(s.start));
    const duration = s.duration ?? media.sequenceDuration;
    if (duration != null && s.mode !== 'video-image') args.push('-t',String(duration));
    args.push('-map_metadata','-1','-sn','-dn');
    if (p.video && !(s.mode === 'video-gif' && p.ext === 'gif')) args.push('-map',media.videoIndex == null ? '0:v:0' : `0:${media.videoIndex}`);
    if (p.video == null) args.push('-map',`0:a:${s.track - 1}`,'-vn');
    else if (!p.audio || s.mute || !media.hasAudio) args.push('-an');
    else args.push('-map',`0:a:${s.track - 1}`);
    if (s.mode === 'video-gif') {
        const scale = s.width ? `,scale=w='min(${s.width},iw)':h=-2:flags=lanczos` : ',scale=trunc(iw/2)*2:trunc(ih/2)*2';
        if (p.ext === 'gif') args.push('-filter_complex',`[0:${media.videoIndex ?? 'v:0'}]fps=${s.fps}${scale},setsar=1,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a[out]`,'-map','[out]','-c:v','gif','-loop','0','-an');
        else args.push('-vf',`fps=${s.fps}${scale},setsar=1`,'-c:v','libx264','-preset','veryfast','-crf',String(s.animationCrf),'-pix_fmt','yuv420p','-an','-movflags','+faststart');
    } else if (s.mode === 'video-image') {
        args.push('-frames:v','1','-c:v','png');
        if (s.width) args.push('-vf',`scale=w='min(${s.width},iw)':h=-2`);
    } else if (p.video) {
        let scale = resolutionFilter(s);
        if (p.ext === '3gp') scale = 'scale=352:288:force_original_aspect_ratio=decrease,pad=352:288:(ow-iw)/2:(oh-ih)/2';
        args.push('-vf',scale + ',setsar=1','-c:v',s.codec,'-pix_fmt','yuv420p','-threads','1');
        if (['libx264','libx265'].includes(s.codec)) {
            args.push('-preset','ultrafast','-crf',String({small:30,balanced:23,high:18}[s.quality]));
            if (s.codec === 'libx265') args.push('-x265-params','pools=none:frame-threads=1');
        } else if (s.codec.startsWith('libvpx')) args.push('-deadline','realtime','-cpu-used','5','-b:v','0','-crf',String({small:40,balanced:32,high:24}[s.quality]));
        else args.push('-q:v',String({small:10,balanced:5,high:2}[s.quality]));
        if (p.ext === 'mpeg' || p.ext === 'vob' || p.ext === 'mxf') args.push('-r','25');
        else if (p.ext === '3gp') args.push('-r','15');
        else if (s.fps) args.push('-r',String(s.fps));
        if (['mp4','mov','f4v'].includes(p.ext)) args.push('-movflags','+faststart');
        if (s.codec === 'libx265' && ['mp4','mov'].includes(p.ext)) args.push('-tag:v','hvc1');
    }
    if (p.audio && (p.video == null || (!s.mute && media.hasAudio))) {
        args.push('-c:a',p.audio);
        if (p.ext === 'mxf') args.push('-ar','48000');
        if (!['pcm_s16le','pcm_s16be','flac'].includes(p.audio)) {
            args.push('-b:a',`${p.audio === 'wmav2' ? Math.min(192,s.bitrate) : s.bitrate}k`,'-ac','2','-ar',p.audio === 'libopus' ? '48000' : '44100');
        }
    }
    args.push('-f',s.mode==='video-image'?'image2':p.muxer,'-y',`output.${s.mode==='video-image'?'png':p.ext}`);
    return args;
}
export function outputName(name, ext) {
    const base = name.replace(/\.[^.]+$/,'').replace(/[^\p{L}\p{N}._ -]/gu,'_').slice(0,90).replace(/^[. ]+|[. ]+$/g,'') || 'arquivo';
    return `${base}_convertido.${ext}`;
}
