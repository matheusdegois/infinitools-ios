import {audioFormats, buildCommand, extension, outputName, parseCapabilities, settingsFor, supported, validateStreams, videoFormats} from './media-core.mjs?v=5';
import {createPlaylistManager} from './playlist-manager.js?v=2';
import {looksLikePlaylist} from './playlist-url.mjs?v=3';

const $ = id => document.getElementById(id);
const endpoint = document.body.dataset.downloaderEndpoint;
const csrf = document.body.dataset.downloaderCsrf;
const provider = document.body.dataset.downloaderProvider || 'native';
const MAX_BROWSER_FILE = 256 * 1024 * 1024;
let sourceUrl = '';
let sourceInfo = null;
let sourceAccess = null;
let busy = false;
let operation = 0;
let controller = null;
let engine = null;
let logs = [];
let progressDuration = null;
let resultUrl = null;
let preservingPlaylist = false;

const videoOutputKeys = Object.keys(videoFormats);
const audioOutputKeys = Object.keys(audioFormats);
const RETRY_GUIDANCE = 'Aguarde alguns minutos antes de buscar o link novamente.';
const REQUEST_ERROR_MESSAGE = 'Ops, ocorreu um erro com sua requisição. Estamos trabalhando nisso. Por favor, aguarde.';

function currentErrorMessage(message) {
    const value = String(message || '');
    if (/^(?:O YouTube pediu confirmação de que a VPS não é um bot|O provedor recusou o arquivo|A fonte alternativa não conseguiu preparar|Não foi possível processar esta mídia)/i.test(value)) {
        return REQUEST_ERROR_MESSAGE;
    }
    if (value === 'O YouTube bloqueou temporariamente o endereço da VPS. Tente novamente em alguns minutos') {
        return `O YouTube bloqueou temporariamente o endereço da VPS. ${RETRY_GUIDANCE}`;
    }
    if (value === 'O provedor recusou o arquivo temporariamente. Tente outra qualidade ou aguarde alguns minutos') {
        return `O provedor recusou o arquivo temporariamente. ${RETRY_GUIDANCE}`;
    }
    return value;
}

function fileSize(bytes) {
    if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) return 'Não informado';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = Number(bytes), unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return `${value.toLocaleString('pt-BR',{maximumFractionDigits:unit ? 1 : 0})} ${units[unit]}`;
}

function durationLabel(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) return 'Duração não informada';
    const hours = Math.floor(value / 3600), minutes = Math.floor(value % 3600 / 60), remaining = Math.floor(value % 60);
    return hours ? `${hours}:${String(minutes).padStart(2,'0')}:${String(remaining).padStart(2,'0')}` : `${minutes}:${String(remaining).padStart(2,'0')}`;
}

function setStatus(message, error = false) {
    const status = $('remoteStatus');
    const visibleMessage = currentErrorMessage(message);
    status.textContent = visibleMessage;
    status.classList.toggle('error', error);
    status.classList.toggle('success', !error);
    status.hidden = !visibleMessage;
    if (visibleMessage && error) requestAnimationFrame(() => status.scrollIntoView({behavior:'smooth',block:'center'}));
}

function setProgress(title, text, percent = null) {
    $('remoteProgressTitle').textContent = title;
    $('remoteProgressText').textContent = text;
    if (percent == null) $('remoteProgressBar').removeAttribute('value');
    else $('remoteProgressBar').value = Math.max(0, Math.min(100, percent));
}

function setBusy(value) {
    busy = value;
    $('remoteMediaUrl').disabled = value;
    $('remoteSearchButton').disabled = value;
    $('remoteProgress').hidden = !value;
    for (const control of $('remoteFormatList').querySelectorAll('button,select')) control.disabled = value;
}

function clearFinalResult() {
    for (const media of $('remotePreview').querySelectorAll('video,audio')) { media.pause(); media.removeAttribute('src'); media.load(); }
    $('remotePreview').replaceChildren();
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = null;
    $('remoteFinalDownload').removeAttribute('href');
    $('remoteFinalResult').hidden = true;
}

function validateUrl(value) {
    const raw = value.trim();
    if (!raw || raw.length > 2048) throw new Error('Cole uma URL pública válida.');
    let parsed;
    try { parsed = new URL(raw); } catch { throw new Error('Cole uma URL pública válida.'); }
    if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Somente URLs HTTP ou HTTPS sem credenciais são aceitas.');
    return parsed.href;
}

function isYouTubeLink(url) {
    const host = new URL(url).hostname.toLowerCase();
    return ['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be','www.youtu.be'].includes(host);
}

function isYouTubeBotCheck(error) {
    return /youtube.*(?:bot|bloqueou)|sign in to confirm.*bot/i.test(String(error?.message || ''));
}

async function apiJson(action, payload, signal) {
    const response = await fetch(`${endpoint}?action=${encodeURIComponent(action)}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {'Content-Type':'application/json','Accept':'application/json','X-CSRF-Token':csrf},
        body: JSON.stringify(payload),
        signal,
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('O servidor retornou uma resposta inválida.'); }
    if (!response.ok) {
        const error = new Error(data.message || data.detail || 'A solicitação não pôde ser concluída.');
        error.status = response.status;
        throw error;
    }
    return data;
}

async function apiFile(jobId, jobToken, signal) {
    const response = await fetch(`${endpoint}?action=file`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {'Content-Type':'application/json','Accept':'application/octet-stream','X-CSRF-Token':csrf},
        body: JSON.stringify({job_id:jobId,job_token:jobToken}),
        signal,
    });
    if (!response.ok) {
        const text = await response.text();
        try { const data = JSON.parse(text); throw new Error(data.message || data.detail || 'Falha ao receber o arquivo.'); }
        catch (error) { if (error instanceof SyntaxError) throw new Error('Falha ao receber o arquivo temporário.'); throw error; }
    }
    return response.blob();
}

const playlistManager = createPlaylistManager({
    apiJson, apiFile, provider, isYouTubeLink, isYouTubeBotCheck,
    onSingle: url => { preservingPlaylist = true; $('remoteMediaUrl').value = url; $('remoteMediaForm').requestSubmit(); },
});

async function waitForJob(created, label, id, signal) {
    const started = Date.now();
    let statusFailures = 0;
    while (Date.now() - started < 15 * 60 * 1000) {
        if (id !== operation) throw new Error('cancelled');
        let job;
        try {
            job = await apiJson('status', {job_id:created.job_id,job_token:created.job_token}, signal);
            statusFailures = 0;
        } catch (error) {
            if (![502,503].includes(error.status) || ++statusFailures > 3) throw error;
            setProgress(label, 'A conexão com a VPS oscilou. Consultando o mesmo trabalho novamente...');
            await new Promise(resolve => setTimeout(resolve, 1500 * statusFailures));
            continue;
        }
        setProgress(label, job.status === 'queued' ? 'Aguardando o worker disponível...' : `${job.progress || 0}% concluído.`, job.status === 'queued' ? null : Number(job.progress || 0));
        if (job.status === 'finished') return job.result;
        if (job.status === 'failed' || job.status === 'unavailable') throw new Error(job.error || 'A mídia não pôde ser processada.');
        await new Promise(resolve => setTimeout(resolve, 1200));
    }
    throw new Error('A operação demorou mais que o esperado. Tente novamente.');
}

function option(value, label) {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = label;
    return element;
}

function field(label, control) {
    const wrapper = document.createElement('label');
    wrapper.className = 'youtube-card-field';
    const title = document.createElement('span');
    title.textContent = label;
    wrapper.append(title, control);
    return wrapper;
}

function metadataRow(term, value) {
    const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = term; dd.textContent = value; row.append(dt,dd); return row;
}

function codecLabel(value) {
    return !value || ['none','unknown','null','n/a'].includes(String(value).toLowerCase()) ? 'Não informado' : String(value);
}

function sourceKind(item) {
    if (item.has_video && item.has_audio) return 'Vídeo com áudio';
    if (item.has_video) return 'Vídeo; áudio será combinado quando disponível';
    return 'Somente áudio';
}

function qualityLabel(item) {
    if (item.height) return `${item.height}p${item.fps ? ` • ${item.fps} FPS` : ''}`;
    if (item.quality && item.quality !== 'Não informada') return item.quality;
    if (item.tbr) return `${item.tbr} kbps`;
    return String(item.ext || 'arquivo').toUpperCase();
}

function outputSelect(item) {
    const select = document.createElement('select');
    select.append(option('original',`Original (${String(item.ext || 'arquivo').toUpperCase()}, sem converter)`));
    const appendGroup = (label, keys, catalog) => {
        const group = document.createElement('optgroup'); group.label = label;
        for (const key of keys) group.append(option(key,catalog[key].label));
        select.append(group);
    };
    if (item.has_video) appendGroup('Vídeo',videoOutputKeys,videoFormats);
    appendGroup('Áudio',audioOutputKeys,audioFormats);
    select.value = 'original';
    return select;
}

function createSourceCard(item) {
    const card = document.createElement('article'); card.className = 'youtube-option-card';
    const heading = document.createElement('div'); heading.className = 'youtube-quality';
    const quality = document.createElement('strong'); quality.textContent = qualityLabel(item);
    const kind = document.createElement('span'); kind.className = `media-kind${item.has_video && !item.has_audio ? ' warning' : ''}`; kind.textContent = sourceKind(item);
    heading.append(quality,kind);
    const details = document.createElement('dl');
    details.append(metadataRow('Origem',String(item.ext || '').toUpperCase()),metadataRow('Tamanho',fileSize(item.filesize)));
    if (item.width || item.height) details.append(metadataRow('Dimensões',`${item.width || '?'} × ${item.height || '?'}`));
    if (item.has_video) details.append(metadataRow('Vídeo',codecLabel(item.vcodec)));
    if (item.has_audio) details.append(metadataRow('Áudio',codecLabel(item.acodec)));

    const controls = document.createElement('div'); controls.className = 'youtube-card-controls';
    const format = outputSelect(item);
    const qualityMode = document.createElement('select');
    qualityMode.append(option('small','Arquivo menor'),option('balanced','Equilibrada'),option('high','Maior qualidade'));
    qualityMode.value = 'balanced';
    const width = document.createElement('select');
    width.append(option('0','Manter tamanho'),option('1920','Até 1920 px'),option('1280','Até 1280 px'),option('854','Até 854 px'),option('640','Até 640 px'));
    const bitrate = document.createElement('select');
    bitrate.append(option('128','128 kbps'),option('192','192 kbps'),option('256','256 kbps'),option('320','320 kbps'),option('96','96 kbps'),option('64','64 kbps'));
    bitrate.value = '192';
    const qualityField = field('Qualidade final',qualityMode), widthField = field('Largura final',width), bitrateField = field('Qualidade do áudio',bitrate);
    controls.append(field('Formato final',format),qualityField,widthField,bitrateField);
    const updateControls = () => {
        const audioOnly = Object.prototype.hasOwnProperty.call(audioFormats,format.value);
        const original = format.value === 'original';
        qualityField.hidden = audioOnly || original;
        widthField.hidden = audioOnly || original;
        bitrateField.hidden = original;
    };
    format.addEventListener('change',updateControls); updateControls();
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-primary youtube-download-button'; button.textContent = 'Baixar e converter';
    button.addEventListener('click',() => convertSource(item,{format,qualityMode,width,bitrate}));
    card.append(heading,details,controls,button);
    return card;
}

function renderFormats(result) {
    sourceInfo = result;
    $('remoteResultTitle').textContent = result.title || 'Mídia encontrada';
    $('remoteResultMeta').textContent = `${durationLabel(result.duration)} • ${result.formats.length} ${result.formats.length === 1 ? 'opção encontrada' : 'opções encontradas'} • Fonte: ${result.source || 'não informada'}`;
    const thumbnail = $('remoteThumbnail');
    if (result.thumbnail) { thumbnail.src = result.thumbnail; thumbnail.hidden = false; }
    else { thumbnail.removeAttribute('src'); thumbnail.hidden = true; }
    const groups = new Map();
    for (const item of result.formats) {
        const key = String(item.ext || 'arquivo').toLowerCase();
        if (!groups.has(key)) groups.set(key,[]);
        groups.get(key).push(item);
    }
    const sections = [];
    for (const [ext,items] of groups) {
        const section = document.createElement('section'); section.className = 'youtube-format-group';
        const header = document.createElement('header'), headerCopy = document.createElement('div'), chip = document.createElement('span'), title = document.createElement('h2'), count = document.createElement('small');
        chip.className = 'format-chip'; chip.textContent = ext.toUpperCase(); title.textContent = `Origem ${ext.toUpperCase()}`; count.textContent = `${items.length} ${items.length === 1 ? 'opção' : 'opções'}`;
        headerCopy.append(chip,title); header.append(headerCopy,count);
        const grid = document.createElement('div'); grid.className = 'youtube-options-grid'; grid.append(...items.map(createSourceCard));
        section.append(header,grid); sections.push(section);
    }
    $('remoteFormatList').replaceChildren(...sections);
    $('remoteResults').hidden = false;
}

function assertCurrent(id) { if (id !== operation) throw new Error('cancelled'); }

async function deadline(promise, milliseconds, message) {
    let timer;
    try { return await Promise.race([promise,new Promise((_,reject) => { timer = setTimeout(() => reject(new Error(message)),milliseconds); })]); }
    finally { clearTimeout(timer); }
}

async function getEngine(id) {
    if (typeof WebAssembly === 'undefined' || typeof Worker === 'undefined') throw new Error('Use um navegador atualizado com suporte a WebAssembly.');
    setProgress('Carregando o conversor local...','O motor possui cerca de 31 MB no primeiro uso.');
    const {FFmpeg} = await import('./vendor/ffmpeg/0.12.15/index.js'); assertCurrent(id);
    const instance = new FFmpeg(); engine = instance;
    instance.on('log',({message}) => { logs.push(message); if (logs.length > 2000) logs.shift(); });
    instance.on('progress',({time}) => {
        if (engine !== instance || id !== operation) return;
        const seconds = time / 1000000;
        const percent = progressDuration ? Math.min(98,Math.round(seconds / progressDuration * 100)) : null;
        setProgress('Convertendo neste dispositivo...',percent == null ? 'O tempo depende do arquivo e do aparelho.' : `${percent}% estimado.`,percent);
    });
    const base = new URL('./vendor/ffmpeg/core-0.12.10/',import.meta.url);
    await deadline(instance.load({coreURL:new URL('./ffmpeg-runtime.mjs',import.meta.url).href,wasmURL:new URL('ffmpeg-core.wasm',base).href}),120000,'Não foi possível carregar o conversor local.');
    assertCurrent(id);
    logs = []; await instance.exec(['-encoders']); const encoders = logs.join('\n');
    logs = []; await instance.exec(['-muxers']); const capabilities = parseCapabilities(encoders,logs.join('\n'));
    return {instance,capabilities};
}

async function inspect(instance, path) {
    const code = await instance.ffprobe(['-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json',path,'-o','probe.json']);
    try {
        if (code !== 0 && code !== -1) throw new Error('probe');
        const data = JSON.parse(await instance.readFile('probe.json','utf8'));
        if (!data.streams?.length || data.error) throw new Error('probe');
        return data;
    } catch { throw new Error('O arquivo recebido usa um codec que este navegador não conseguiu ler.'); }
    finally { try { await instance.deleteFile('probe.json'); } catch {} }
}

function presentResult(bytes, settings, sourceName) {
    const name = outputName(sourceName,settings.format.ext);
    resultUrl = URL.createObjectURL(new Blob([bytes],{type:settings.format.mime}));
    $('remoteFinalDownload').href = resultUrl; $('remoteFinalDownload').download = name;
    $('remoteFinalInfo').textContent = `${name} • ${fileSize(bytes.length)}`;
    const media = document.createElement(settings.format.mime.startsWith('audio/') ? 'audio' : 'video');
    media.src = resultUrl; media.controls = true; media.preload = 'metadata';
    const note = document.createElement('p'); note.className = 'media-preview-note'; note.textContent = 'Se a prévia não abrir, use o botão de download.';
    $('remotePreview').replaceChildren(media,note); $('remoteFinalResult').hidden = false;
    const automatic = document.createElement('a'); automatic.href = resultUrl; automatic.download = name; document.body.append(automatic); automatic.click(); automatic.remove();
    setStatus('Conversão concluída. O download foi iniciado automaticamente.');
    $('remoteFinalResult').scrollIntoView({behavior:'smooth',block:'center'});
}

function presentOriginal(blob, sourceName, mime) {
    const name = sourceName || 'midia';
    resultUrl = URL.createObjectURL(blob);
    $('remoteFinalDownload').href = resultUrl;
    $('remoteFinalDownload').download = name;
    $('remoteFinalInfo').textContent = `${name} • ${fileSize(blob.size)} • formato original`;
    const media = document.createElement(String(mime || blob.type).startsWith('audio/') ? 'audio' : 'video');
    media.src = resultUrl; media.controls = true; media.preload = 'metadata';
    const note = document.createElement('p'); note.className = 'media-preview-note'; note.textContent = 'Arquivo original preparado pela VPS, sem nova conversão.';
    $('remotePreview').replaceChildren(media,note); $('remoteFinalResult').hidden = false;
    const automatic = document.createElement('a'); automatic.href = resultUrl; automatic.download = name; document.body.append(automatic); automatic.click(); automatic.remove();
    setStatus('Arquivo original recebido. O download foi iniciado automaticamente.');
    $('remoteFinalResult').scrollIntoView({behavior:'smooth',block:'center'});
}

async function convertSource(item, controls) {
    if (busy) return;
    const id = ++operation; controller?.abort(); controller = new AbortController(); clearFinalResult(); setStatus(''); setBusy(true);
    let instance;
    try {
        if (!sourceAccess) throw new Error('As opções desta consulta expiraram. Busque o link novamente.');
        const sourceBytes = Number(sourceInfo?.size || item.filesize || 0);
        if (sourceBytes > MAX_BROWSER_FILE) throw new Error(`O arquivo de origem possui ${fileSize(sourceBytes)}. O limite para conversão no navegador é 256 MB.`);
        setProgress('Transferindo para este dispositivo...','A cópia temporária será programada para exclusão após esta transferência.');
        const blob = await apiFile(sourceAccess.job_id,sourceAccess.job_token,controller.signal); assertCurrent(id);
        if (!blob.size || blob.size > MAX_BROWSER_FILE) throw new Error('O arquivo recebido está vazio ou ultrapassa 256 MB.');
        const sourceFilename = sourceInfo?.filename || `origem.${item.ext}`;
        const sourceExtension = extension(sourceFilename);
        if (controls.format.value === 'original') {
            presentOriginal(blob,sourceFilename,sourceInfo?.content_type || blob.type);
            return;
        }
        const inputPath = `input.${sourceExtension}`;
        const loaded = await getEngine(id); instance = loaded.instance; assertCurrent(id);
        setProgress('Analisando o arquivo...','Verificando vídeo, áudio e duração.');
        await instance.writeFile(inputPath,new Uint8Array(await blob.arrayBuffer())); assertCurrent(id);
        const output = controls.format.value;
        const mode = Object.prototype.hasOwnProperty.call(audioFormats,output) ? 'extract-audio' : 'video';
        const settings = settingsFor(mode,{
            format:output,
            quality:controls.qualityMode.value,
            width:controls.width.value,
            fps:'0',
            bitrate:controls.bitrate.value,
            track:'1',
            start:'0',
            duration:'',
            mute:false,
        });
        if (!supported(settings.format,loaded.capabilities,settings.codec)) throw new Error('O formato escolhido não está disponível no conversor deste navegador.');
        const media = validateStreams(await inspect(instance,inputPath),settings); assertCurrent(id);
        progressDuration = media.duration || null;
        setProgress('Convertendo neste dispositivo...','Mantenha esta aba aberta.');
        logs = [];
        const code = await deadline(instance.exec(buildCommand(inputPath,settings,media),600000),610000,'A conversão excedeu o tempo disponível.');
        assertCurrent(id);
        if (code !== 0) throw new Error('Não foi possível converter com essa combinação de formato e codec.');
        const bytes = await instance.readFile(`output.${settings.format.ext}`); assertCurrent(id);
        if (!bytes.length) throw new Error('O arquivo convertido ficou vazio.');
        presentResult(bytes,settings,`${sourceInfo?.title || 'midia'}.${sourceExtension}`);
    } catch (error) {
        if (id !== operation || error.name === 'AbortError' || error.message === 'cancelled') return;
        const message = /memory|out of bounds|allocation/i.test(String(error)) ? 'A memória deste dispositivo não foi suficiente. Escolha uma opção menor.' : (error.message || 'Não foi possível concluir a conversão.');
        setStatus(message,true);
    } finally {
        instance?.terminate();
        if (engine === instance) engine = null;
        progressDuration = null;
        if (id === operation) setBusy(false);
    }
}

$('remoteMediaForm').addEventListener('submit',async event => {
    event.preventDefault(); if (busy) return;
    let url;
    try { url = validateUrl($('remoteMediaUrl').value); }
    catch (error) { setStatus(error.message,true); return; }
    const preservePlaylist = preservingPlaylist;
    preservingPlaylist = false;
    const inspectPlaylist = looksLikePlaylist(url);
    const id = ++operation; controller?.abort(); controller = new AbortController(); sourceUrl = url; sourceInfo = null; sourceAccess = null;
    clearFinalResult(); $('remoteResults').hidden = true; $('remoteFormatList').replaceChildren(); setStatus(''); setBusy(true);
    try {
        if (inspectPlaylist) {
            setProgress('Analisando playlist...','Listando itens sem baixar os arquivos.');
            if (await playlistManager.inspect(url,controller.signal)) {
                assertCurrent(id);
                setStatus('Playlist encontrada. Selecione os itens e inicie a fila.');
                $('playlistPanel').scrollIntoView({behavior:'smooth',block:'start'});
                return;
            }
        } else if (!preservePlaylist) playlistManager.reset();
        setProgress('Preparando a mídia na VPS...','A VPS consulta a plataforma e baixa um arquivo-base temporário.');
        const action = provider === 'acethinker' ? 'prepare-youtube' : 'prepare';
        let created, result;
        try {
            created = await apiJson(action,{url},controller.signal);
            result = await waitForJob(created,'Baixando uma cópia temporária na VPS...',id,controller.signal);
        } catch (error) {
            assertCurrent(id);
            if (action !== 'prepare' || !isYouTubeLink(url) || !isYouTubeBotCheck(error)) throw error;
            setProgress('Tentando uma fonte alternativa para YouTube...','O YouTube recusou a consulta direta da VPS. Preparando uma única cópia por outra fonte.');
            created = await apiJson('prepare-youtube',{url},controller.signal);
            result = await waitForJob(created,'Baixando pela fonte alternativa...',id,controller.signal);
        }
        assertCurrent(id);
        if (!Array.isArray(result?.formats) || !result.formats.length) throw new Error('Nenhum formato disponível foi encontrado.');
        sourceAccess = {job_id:created.job_id,job_token:created.job_token};
        renderFormats(result);
        setStatus('Arquivo temporário preparado. Escolha o formato final ou mantenha o original.');
        $('remoteResults').scrollIntoView({behavior:'smooth',block:'start'});
    } catch (error) {
        if (id !== operation || error.name === 'AbortError' || error.message === 'cancelled') return;
        setStatus(error.message || 'Não foi possível consultar esta mídia.',true);
    } finally { if (id === operation) setBusy(false); }
});


$('remoteCancel').addEventListener('click',() => {
    if (!busy) return;
    operation++; controller?.abort(); engine?.terminate(); engine = null; progressDuration = null; setBusy(false); setStatus('Operação cancelada.');
});

window.addEventListener('pagehide',() => { operation++; controller?.abort(); playlistManager.reset(); engine?.terminate(); engine = null; clearFinalResult(); });
