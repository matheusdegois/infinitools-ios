import {formatsFor, extensionsFor, extension, validateFiles, settingsFor, validateStreams, buildCommand, outputName, parseCapabilities, supported} from './media-core.mjs?v=9';
import {encodeCanvas} from './image-formats.mjs?v=3';
import {createMediaTrim} from './media-trim.js?v=3';

const $ = id => document.getElementById(id);
const mode = document.body.dataset.mediaTool;
const formats = formatsFor(mode);
let files = [], busy = false, engine = null, capabilities = null, generation = 0, resultURL = null;
let logs = [], progressDuration = null, converting = false;
const WHATSAPP_ANIMATION_LIMIT_BYTES = 850 * 1024;
const size = bytes => `${(bytes / 1048576).toFixed(1)} MB`;
const select = (id, label, values) => `<div class="field"><label for="${id}">${label}</label><select id="${id}">${values.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select></div>`;
const number = (id, label, value, min, max, step = 1, help = '') => `<div class="field"><label for="${id}">${label}</label><input type="number" id="${id}" value="${value}" min="${min}" max="${max}" step="${step}">${help ? `<small>${help}</small>` : ''}</div>`;
const videoOutput = mode === 'video' || mode === 'images-video';
const audioOutput = mode === 'audio' || mode === 'extract-audio';
$('mediaFields').innerHTML = select('format', 'Formato de saída', Object.entries(formats).map(([key, p]) => [key, p.label]))
    + (videoOutput ? `<div id="codecField">${select('codec', 'Codec de vídeo', [])}</div>` + select('quality', 'Qualidade do vídeo', [['balanced','Equilibrada'],['small','Arquivo menor'],['high','Maior qualidade']]) : '')
    + (videoOutput || mode === 'video-image' ? number('width','Largura (px, 0 = original)',0,0,7680,2) : '')
    + (videoOutput ? number('height','Altura (px, 0 = proporcional)',0,0,4320,2)+select('fit','Enquadramento',[['contain','Manter proporção e adicionar barras'],['cover','Preencher e recortar'],['stretch','Esticar']])+select('upscale','Ampliação',[['no','Limitar a imagem ao tamanho original'],['yes','Permitir aumentar a resolução']]) : '')
    + (mode === 'video-gif' ? select('width', 'Largura máxima', [['480','480 px'],['360','360 px'],['320','320 px'],['240','240 px']]) : '')
    + (videoOutput ? select('fps', 'Quadros por segundo', [['0','Manter FPS'],['24','24 FPS'],['25','25 FPS'],['30','30 FPS'],['60','60 FPS']]) : '')
    + (mode === 'video-gif' ? select('fps', 'Quadros por segundo', [['10','10 FPS'],['12','12 FPS'],['8','8 FPS'],['15','15 FPS']]) : '')
    + (audioOutput || mode === 'video' ? `<div id="audioFields">${select('bitrate', 'Qualidade do áudio', [['192','192 kbps'],['128','128 kbps'],['256','256 kbps'],['320','320 kbps'],['96','96 kbps'],['64','64 kbps']])}${number('track', 'Faixa de áudio', 1, 1, 32, 1, '1 = primeira faixa de áudio. O arquivo final terá uma faixa.')}</div>` : '')
    + (mode === 'video' ? select('mute', 'Som do vídeo', [['no','Manter áudio, se houver'],['yes','Remover áudio']]) : '')
    + (mode === 'images-video' ? number('seconds', 'Segundos por foto', 2, .5, 30, .5, 'Fotos são ajustadas a 1280 × 720. GIF mantém sua duração e usa as opções de tamanho acima.') : '')
    + (mode !== 'images-video' ? number('start', mode === 'video-image' ? 'Instante do quadro (segundos)' : 'Início do trecho (segundos)', 0, 0, 86400, .1) : '')
    + (!['images-video','video-image'].includes(mode) ? number('duration', mode === 'video-gif' ? 'Duração do GIF (segundos)' : 'Duração do trecho (segundos)', mode === 'video-gif' ? 5 : '', .1, mode === 'video-gif' ? 6 : 86400, .1, mode === 'video-gif' ? 'Até 6 segundos, como os GIFs criados pelo WhatsApp.' : 'Vazio = até o fim do arquivo.') : '')
    + '<p class="media-help" id="profileHelp"></p>';
const preferredOutput = document.body.dataset.mediaOutput;
if (preferredOutput && formats[preferredOutput]) $('format').value = preferredOutput;
$('mediaInput').accept = extensionsFor(mode).map(x => `.${x}`).join(',');
$('mediaInput').multiple = mode === 'images-video';
$('selectLabel').textContent = mode === 'images-video' ? 'Selecionar GIF ou fotos' : 'Selecionar arquivo';
$('acceptHint').textContent = `${extensionsFor(mode).map(x => x.toUpperCase()).join(', ')} • até 256 MB`;
$('sequenceHint').hidden = mode !== 'images-video';

function updateProfile() {
    const format = formats[$('format').value];
    if (videoOutput) {
        const previous = $('codec').value;
        const choices = format.ext === 'webm' ? [['libvpx-vp9','VP9'],['libvpx','VP8']] : ['mp4','mov','mkv'].includes(format.ext) ? [['libx264','H.264'],['libx265','H.265 / HEVC']] : [[format.video,format.video]];
        $('codec').replaceChildren(...choices.map(([value,label]) => new Option(label,value)));
        if (choices.some(([value]) => value === previous)) $('codec').value = previous;
        $('codecField').hidden = choices.length === 1;
        for (const option of $('codec').options) {
            option.disabled = option.value === 'libx265' || !!capabilities && !supported(format,capabilities,option.value);
            if (option.value === 'libx265') option.textContent += ' — indisponível neste motor';
        }
        if ($('codec').selectedOptions[0]?.disabled) $('codec').value = [...$('codec').options].find(o => !o.disabled)?.value || '';
    }
    if ($('audioFields')) $('audioFields').hidden = $('mute')?.value === 'yes';
    if ($('bitrate')) $('bitrate').disabled = busy || ['pcm_s16le','pcm_s16be','flac'].includes(format.audio) || $('mute')?.value === 'yes';
    const legacy = format.ext === '3gp' ? '3GP usa 352 × 288 e 15 FPS para compatibilidade.' : format.ext === 'mpeg' ? 'MPEG usa 25 FPS para compatibilidade.' : '';
    if ($('width')) $('width').disabled = busy || format.ext === '3gp';
    if ($('fps')) $('fps').disabled = busy || ['3gp','mpeg'].includes(format.ext);
    $('profileHelp').textContent = mode === 'video-gif' ? (format.ext==='gif'?'Gera um arquivo GIF animado com paleta otimizada. Até 6 segundos.':'Gera MP4 curto e sem áudio para WhatsApp; tenta manter até 850 KB.') : legacy || (format.ext === 'wma' || format.ext === 'wmv' ? 'WMA usa até 192 kbps, estéreo.' : ['wav','aiff'].includes(format.ext) ? 'PCM de 16 bits, sem compressão; pode gerar arquivos grandes.' : format.ext === 'flac' ? 'Sem perdas na codificação. Converter um áudio comprimido não recupera detalhes já perdidos.' : 'A compatibilidade depende também do codec presente no arquivo de entrada.');
}
updateProfile();
const sourceTrim=createMediaTrim(mode,clearResult);
function clearResult() {
    for (const player of $('mediaPreview').querySelectorAll('video,audio')) { player.pause(); player.removeAttribute('src'); player.load(); }
    $('mediaPreview').replaceChildren();
    if (resultURL) URL.revokeObjectURL(resultURL);
    resultURL = null;
    $('mediaDownload').removeAttribute('href');
    $('mediaResult').hidden = true;
}
function status(text, error = false) { $('mediaStatus').textContent = text; $('mediaStatus').classList.toggle('error', error); }
function setBusy(value) {
    busy = value;
    sourceTrim.busy(value);
    document.body.classList.toggle('media-busy', value);
    $('mediaOptions').disabled = value;
    $('mediaInput').disabled = value;
    $('mediaProgress').hidden = !value;
    $('convertMedia').disabled = value || !files.length;
    renderFiles();
    updateProfile();
}
function progress(title, text, percent = null) {
    $('progressTitle').textContent = title;
    $('progressText').textContent = text;
    if (percent == null) $('mediaProgressBar').removeAttribute('value');
    else $('mediaProgressBar').value = Math.max(0,Math.min(99,percent));
}
function renderFiles() {
    $('mediaFiles').replaceChildren(...files.map((file,index) => {
        const row = document.createElement('li'), copy = document.createElement('span'), name = document.createElement('strong'), info = document.createElement('small'), actions = document.createElement('span');
        copy.className = 'file-copy'; name.textContent = `${index + 1}. ${file.name}`; info.textContent = size(file.size); copy.append(name,info); actions.className = 'media-file-actions';
        const button = (text,label,disabled,fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.setAttribute('aria-label',label); b.disabled = busy || disabled; b.onclick = () => { fn(); clearResult(); renderFiles(); $('convertMedia').disabled = !files.length; }; actions.append(b); };
        if (mode === 'images-video') {
            button('↑',`Mover ${file.name} para cima`,index === 0,() => [files[index-1],files[index]] = [files[index],files[index-1]]);
            button('↓',`Mover ${file.name} para baixo`,index === files.length-1,() => [files[index+1],files[index]] = [files[index],files[index+1]]);
        }
        button('×',`Remover ${file.name}`,false,() => {files.splice(index,1);sourceTrim.load(files[0]);}); row.append(copy,actions); return row;
    }));
}
function addFiles(incoming) {
    if (busy || !incoming.length) return;
    const next = mode === 'images-video' ? [...files,...incoming] : incoming;
    try { validateFiles(next,mode); files = next; clearResult(); renderFiles(); sourceTrim.load(files[0]);status('Arquivo selecionado. Configure as opções e clique em Converter agora.'); $('convertMedia').disabled = false; }
    catch (error) { status(error.message,true); }
}
$('mediaInput').addEventListener('change',e => { addFiles([...e.target.files]); e.target.value = ''; });
for (const type of ['dragenter','dragover']) $('mediaDrop').addEventListener(type,e => { e.preventDefault(); if (!busy) $('mediaDrop').classList.add('dragover'); });
for (const type of ['dragleave','drop']) $('mediaDrop').addEventListener(type,e => { e.preventDefault(); $('mediaDrop').classList.remove('dragover'); if (type === 'drop') addFiles([...e.dataTransfer.files]); });
$('mediaFields').addEventListener('input',clearResult);
$('mediaFields').addEventListener('change',() => { clearResult(); updateProfile(); });
const assertCurrent = id => { if (generation !== id) throw new Error('cancelled'); };
async function deadline(promise, ms, message) {
    let timer;
    try { return await Promise.race([promise,new Promise((_,reject) => { timer = setTimeout(() => reject(new Error(message)),ms); })]); }
    finally { clearTimeout(timer); }
}
async function getEngine(id) {
    if (engine?.loaded) return engine;
    if (typeof WebAssembly === 'undefined' || typeof Worker === 'undefined') throw new Error('Este navegador não oferece WebAssembly e workers. Use um navegador atualizado.');
    progress('Carregando o conversor...', 'Preparando o motor local (cerca de 31 MB na primeira conversão).');
    const {FFmpeg} = await import('./vendor/ffmpeg/0.12.15/index.js');
    assertCurrent(id);
    const instance = new FFmpeg(); engine = instance;
    instance.on('log',({message}) => { if (engine !== instance) return; logs.push(message); if (logs.length > 2000) logs.shift(); });
    instance.on('progress',({time}) => {
        if (!busy || !converting || engine !== instance) return;
        const seconds = time / 1000000;
        const percent = progressDuration ? Math.min(98,Math.round(seconds / progressDuration * 100)) : null;
        progress('Convertendo no seu dispositivo...', percent == null ? 'O tempo depende do tamanho do arquivo e do seu aparelho.' : `${percent}% estimado. Mantenha esta aba aberta.`,percent);
    });
    const base = new URL('./vendor/ffmpeg/core-0.12.10/',import.meta.url);
    await deadline(instance.load({coreURL:new URL('./ffmpeg-runtime.mjs',import.meta.url).href,wasmURL:new URL('ffmpeg-core.wasm',base).href}),120000,'Não foi possível carregar o motor. Verifique a conexão e tente novamente.');
    assertCurrent(id);
    logs = []; await instance.exec(['-encoders']); const encoders = logs.join('\n');
    logs = []; await instance.exec(['-muxers']); capabilities = parseCapabilities(encoders,logs.join('\n'));
    for (const option of $('format').options) { option.disabled = !supported(formats[option.value],capabilities); if (option.disabled) option.textContent += ' — indisponível'; }
    return instance;
}
async function inspect(instance,path) {
    const code = await instance.ffprobe(['-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json',path,'-o','probe.json']);
    try {
        // core 0.12.10 can return -1 after a successful ffprobe. Validate its JSON too.
        if (code !== 0 && code !== -1) throw new Error('probe');
        const data = JSON.parse(await instance.readFile('probe.json','utf8'));
        if (!data.streams?.length || data.error) throw new Error('probe');
        return data;
    } catch { throw new Error('Não foi possível ler este arquivo. Ele pode estar danificado ou usar um codec não suportado.'); }
    finally { try { await instance.deleteFile('probe.json'); } catch {} }
}
async function preparePhotos(instance,id,s) {
    const names = [];
    for (let i = 0; i < files.length; i++) {
        assertCurrent(id); progress('Preparando a sequência...',`Foto ${i + 1} de ${files.length}.`);
        const source = `photo-source.${extension(files[i].name)}`;
        await instance.writeFile(source,new Uint8Array(await files[i].arrayBuffer())); assertCurrent(id);
        const meta = await inspect(instance,source), stream = meta.streams?.find(s => s.codec_type === 'video');
        await instance.deleteFile(source);
        if (!stream || stream.width * stream.height > 16000000 || stream.width > 8192 || stream.height > 8192) throw new Error('Uma foto excede 16 megapixels ou 8192 pixels por lado. Reduza a imagem antes de continuar.');
        const bitmap = await createImageBitmap(files[i]);
        try {
            assertCurrent(id);
            const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
            const ctx = canvas.getContext('2d',{alpha:false}); ctx.fillStyle = '#000'; ctx.fillRect(0,0,1280,720);
            const scale = Math.min(1280 / bitmap.width,720 / bitmap.height), w = bitmap.width * scale, h = bitmap.height * scale;
            ctx.drawImage(bitmap,(1280-w)/2,(720-h)/2,w,h);
            const blob = await new Promise((resolve,reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Falha ao preparar foto.')),'image/png'));
            assertCurrent(id); const name = `photo-${String(i).padStart(3,'0')}.png`;
            await instance.writeFile(name,new Uint8Array(await blob.arrayBuffer())); names.push(name); canvas.width = canvas.height = 1;
        } finally { bitmap.close(); }
    }
    const list = names.map(name => `file '${name}'\nduration ${s.seconds}\n`).join('') + `file '${names.at(-1)}'\n`;
    await instance.writeFile('sequence.txt',new TextEncoder().encode(list));
    return {path:'sequence.txt',media:{sequence:true,sequenceDuration:files.length * s.seconds,hasAudio:false}};
}
function present(bytes,s,name) {
    resultURL = URL.createObjectURL(new Blob([bytes],{type:s.format.mime}));
    $('mediaDownload').href = resultURL; $('mediaDownload').download = name;
    $('mediaResultInfo').textContent = `${name} • ${size(bytes.length)}`;
    const tag = s.format.mime === 'application/pdf' ? 'iframe' : s.format.mime.startsWith('audio/') ? 'audio' : s.format.mime.startsWith('image/') ? 'img' : 'video';
    const preview = document.createElement(tag); preview.src = resultURL;
    if (tag === 'img') preview.alt = 'Resultado da conversão';
    else if(tag==='iframe')preview.title='Prévia do PDF gerado';
    else {
        preview.controls = true; preview.preload = 'metadata';
        if (mode === 'video-gif') { preview.autoplay = true; preview.loop = true; preview.muted = true; preview.playsInline = true; }
    }
    const note = document.createElement('p'); note.className = 'media-preview-note'; note.textContent = 'Se a prévia não for compatível com seu navegador, baixe o arquivo para abri-lo em outro reprodutor.';
    $('mediaPreview').replaceChildren(preview,note); $('mediaResult').hidden = false;
    status(mode === 'video-gif' ? `${s.format.ext==='gif'?'GIF animado':'MP4 sem áudio'} com ${(bytes.length / 1024).toFixed(0)} KB, pronto para baixar.` : 'Conversão concluída no navegador. Seu arquivo está pronto para baixar.');
    $('mediaDownload').focus();
}
async function executeOutput(instance,path,s,media,id,timeout=610000) {
    logs = []; converting = true;
    const code = await deadline(instance.exec(buildCommand(path,s,media),timeout-10000),timeout,'A conversão excedeu o tempo disponível. Tente um trecho menor ou resolução mais baixa.');
    converting = false; assertCurrent(id);
    if (code !== 0) {
        if (code === 1 && /timeout|timed out/i.test(logs.join('\n'))) throw new Error('A conversão excedeu o tempo disponível. Tente um trecho menor.');
        throw new Error('Não foi possível converter este arquivo com as opções escolhidas. Tente outro formato, um trecho menor ou uma resolução mais baixa.');
    }
    const bytes = await instance.readFile(`output.${s.mode==='video-image'?'png':s.format.ext}`);assertCurrent(id);
    if (!bytes.length) throw new Error('O resultado ficou vazio. Verifique o instante ou o trecho escolhido.');
    return bytes;
}
async function optimizeWhatsAppAnimation(instance,path,s,media,id,initialBytes) {
    if (initialBytes.length <= WHATSAPP_ANIMATION_LIMIT_BYTES) return {bytes:initialBytes,settings:s};
    let bestBytes=initialBytes;
    const baseWidth=s.width||480,presets=[[.85,9,32],[.7,8,34],[.55,7,36],[.42,6,38],[.32,5,40],[.24,4,42]];
    for (let index=0;index<presets.length;index++) {
        const [factor,fps,animationCrf]=presets[index],width=Math.max(96,Math.round(baseWidth*factor/2)*2),candidate={...s,width,fps:Math.min(s.fps,fps),animationCrf};
        progress('Otimizando para WhatsApp...',`Tentativa ${index+1} de ${presets.length}: reduzindo dimensões, quadros e taxa de bits.`);
        const bytes=await executeOutput(instance,path,candidate,media,id,190000);
        if(bytes.length<bestBytes.length)bestBytes=bytes;
        if(bytes.length<=WHATSAPP_ANIMATION_LIMIT_BYTES)return{bytes,settings:candidate};
    }
    throw new Error(`O menor GIF em MP4 ficou com ${(bestBytes.length/1024).toFixed(0)} KB. Escolha um trecho mais curto para atingir a meta de 850 KB.`);
}
$('mediaForm').addEventListener('submit',async event => {
    event.preventDefault(); if (busy) return;
    let s;
    try {
        validateFiles(files,mode);
        const raw = Object.fromEntries([...$('mediaFields').querySelectorAll('input,select')].map(el => [el.id,el.value])); raw.mute = raw.mute === 'yes';
        s = settingsFor(mode,raw);
    } catch (error) { status(error.message,true); return; }
    const id = ++generation; clearResult(); status(''); setBusy(true);
    let instance;
    try {
        instance = await getEngine(id); assertCurrent(id);
        if (!supported(s.format,capabilities,s.codec)) throw new Error('Este formato ou codec não está disponível no motor instalado. Escolha outra opção.');
        let path, media;
        if (mode === 'images-video' && extension(files[0].name) !== 'gif') ({path,media} = await preparePhotos(instance,id,s));
        else {
            progress('Lendo o arquivo local...', 'Verificando as faixas e a duração.');
            path = `input.${extension(files[0].name)}`;
            await instance.writeFile(path,new Uint8Array(await files[0].arrayBuffer())); assertCurrent(id);
            media = validateStreams(await inspect(instance,path),s);
        }
        assertCurrent(id);
        const remaining = media.duration ? media.duration - s.start : media.sequenceDuration;
        progressDuration = s.duration && remaining ? Math.min(s.duration,remaining) : s.duration || remaining || null;
        progress('Convertendo no seu dispositivo...', 'Você pode cancelar a qualquer momento.');
        let bytes = await executeOutput(instance,path,s,media,id);
        if(mode==='video-image'&&s.format.ext!=='png'){
            progress('Gerando o formato escolhido...',`Convertendo o quadro para ${s.format.label}.`);
            const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'})),frame=document.createElement('canvas');frame.width=bitmap.width;frame.height=bitmap.height;frame.getContext('2d').drawImage(bitmap,0,0);bitmap.close?.();const converted=await encodeCanvas(frame,s.format.ext,.94);bytes=new Uint8Array(await converted.blob.arrayBuffer());frame.width=frame.height=1;
        }
        progress('Preparando o download...', 'A conversão terminou.');
        if(mode==='video-gif'&&s.format.ext==='mp4'){const optimized=await optimizeWhatsAppAnimation(instance,path,s,media,id,bytes);bytes=optimized.bytes;s=optimized.settings}
        present(bytes,s,outputName(mode === 'images-video' && files.length > 1 ? 'sequencia' : files[0].name,s.format.ext));
    } catch (error) {
        if (id !== generation) return;
        if (engine) engine.terminate(); engine = null; capabilities = null;
        status(/memory|out of bounds|allocation/i.test(String(error)) ? 'A memória do navegador não foi suficiente. Use um arquivo menor, reduza o trecho ou tente no computador.' : error.message || 'Falha na conversão. Tente novamente.',true);
    } finally {
        if (id === generation) {
            converting = false;
            // Drop the virtual filesystem, codec allocations and worker after every job.
            // Versioned HTTP/Wasm caches still avoid downloading the engine again.
            instance?.terminate();
            if (engine === instance) engine = null;
            setBusy(false);
        }
    }
});
$('cancelMedia').addEventListener('click',() => {
    if (!busy) return;
    generation++; converting = false; engine?.terminate(); engine = null; capabilities = null;
    setBusy(false); status('Conversão cancelada. Você pode ajustar as opções e tentar novamente.');
});
window.addEventListener('pagehide',() => { generation++; engine?.terminate(); engine = null; sourceTrim.destroy();clearResult(); });
