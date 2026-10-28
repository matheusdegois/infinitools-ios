import {audioFormats, buildCommand, extension, outputName, parseCapabilities, settingsFor, supported, validateStreams, videoFormats} from './media-core.mjs?v=5';

const $ = id => document.getElementById(id);
const sleep = (ms, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(new DOMException('Cancelado', 'AbortError')); };
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once:true});
});

function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function convertBlob(blob, filename, output, preferences, signal) {
    if (output === 'original') return {blob, filename};
    const {FFmpeg} = await import('./vendor/ffmpeg/0.12.15/index.js');
    if (signal.aborted) throw new DOMException('Cancelado', 'AbortError');
    const ffmpeg = new FFmpeg();
    const stop = () => ffmpeg.terminate();
    signal.addEventListener('abort', stop, {once:true});
    try {
        const base = new URL('./vendor/ffmpeg/core-0.12.10/', import.meta.url);
        await ffmpeg.load({coreURL:new URL('./ffmpeg-runtime.mjs',import.meta.url).href,wasmURL:new URL('ffmpeg-core.wasm',base).href});
        let logs = [];
        ffmpeg.on('log', ({message}) => { if (logs.length < 1000) logs.push(message); });
        await ffmpeg.exec(['-encoders']); const encoders = logs.join('\n');
        logs = []; await ffmpeg.exec(['-muxers']);
        const capabilities = parseCapabilities(encoders, logs.join('\n'));
        const sourceExtension = extension(filename) || 'mp4';
        const inputPath = `input.${sourceExtension}`;
        await ffmpeg.writeFile(inputPath, new Uint8Array(await blob.arrayBuffer()));
        const mode = Object.prototype.hasOwnProperty.call(audioFormats, output) ? 'extract-audio' : 'video';
        const settings = settingsFor(mode, {format:output, quality:preferences.quality, width:preferences.width, fps:'0', bitrate:preferences.bitrate, track:'1', start:'0', duration:'', mute:false});
        if (!supported(settings.format, capabilities, settings.codec)) throw new Error('Formato indisponível neste navegador.');
        const code = await ffmpeg.ffprobe(['-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json',inputPath,'-o','probe.json']);
        if (code !== 0 && code !== -1) throw new Error('Não foi possível analisar a mídia.');
        const media = validateStreams(JSON.parse(await ffmpeg.readFile('probe.json','utf8')), settings);
        if (await ffmpeg.exec(buildCommand(inputPath,settings,media),600000) !== 0) throw new Error('Não foi possível converter esta mídia.');
        const bytes = await ffmpeg.readFile(`output.${settings.format.ext}`);
        if (!bytes.length) throw new Error('Arquivo convertido vazio.');
        return {blob:new Blob([bytes],{type:settings.format.mime}),filename:outputName(filename,settings.format.ext)};
    } finally {
        signal.removeEventListener('abort', stop);
        ffmpeg.terminate();
    }
}

export function createPlaylistManager({apiJson, apiFile, provider, isYouTubeLink, isYouTubeBotCheck, onSingle}) {
    const items = [];
    let playlistUrl = '', nextOffset = null, active = 0, paused = false, running = false, serialConversion = Promise.resolve(), generation = 0;
    let queuePreferences = {format:'original',quality:'balanced',width:'0',bitrate:'192'};
    const maxActive = () => Math.max(1, Math.min(5, Number($('playlistConcurrency').value) || 5));
    const terminal = state => ['completed','failed','cancelled'].includes(state);
    const label = {queued:'Aguardando',preparing:'Preparando',downloading:'Transferindo',processing:'Convertendo',completed:'Concluído',failed:'Erro',cancelled:'Cancelado'};

    function updateProgress() {
        const finished = items.filter(item => item.state === 'completed').length;
        const done = items.filter(item => terminal(item.state)).length;
        $('playlistProgress').hidden = !running && !done;
        $('playlistProgressText').textContent = `${finished} / ${items.length} concluídos`;
        $('playlistProgressBar').value = items.length ? Math.round(done * 100 / items.length) : 0;
        if (running && active === 0 && !items.some(item => item.state === 'queued')) {
            running = false; $('playlistPause').hidden = true; $('playlistCancelAll').hidden = true;
        }
    }

    function setState(item, state, detail = '') {
        item.state = state;
        item.status.textContent = `${label[state]}${detail ? ` · ${detail}` : ''}`;
        item.row.dataset.state = state;
        item.retry.hidden = state !== 'failed' && state !== 'cancelled';
        item.cancel.hidden = terminal(state);
        updateProgress();
    }

    function addItem(data) {
        if (items.some(item => item.url === data.url)) return;
        const row = document.createElement('div'); row.className = 'playlist-item';
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = true; checkbox.setAttribute('aria-label',`Selecionar ${data.title}`);
        const thumbnail = document.createElement('img'); thumbnail.className = 'playlist-thumbnail'; thumbnail.alt = ''; thumbnail.loading = 'lazy'; thumbnail.referrerPolicy = 'no-referrer';
        if (data.thumbnail) thumbnail.src = data.thumbnail; else thumbnail.hidden = true;
        const description = document.createElement('div');
        const title = document.createElement('strong'); title.textContent = `${data.index}. ${data.title || 'Vídeo sem título'}`;
        const info = document.createElement('small'); info.textContent = data.uploader || '';
        description.append(title, info);
        if (/^https:\/\/open\.spotify\.com\/track\//i.test(data.url)) {
            const spotifyLink = document.createElement('a'); spotifyLink.href = data.url; spotifyLink.target = '_blank'; spotifyLink.rel = 'noopener noreferrer'; spotifyLink.textContent = 'Ver no Spotify'; description.append(spotifyLink);
        }
        const status = document.createElement('span'); status.className = 'playlist-item-status';
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Tentar novamente'; retry.hidden = true;
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancelar';
        const single = document.createElement('button'); single.type = 'button'; single.textContent = 'Escolher opções';
        row.append(checkbox, thumbnail, description, status, retry, cancel, single); $('playlistItems').append(row);
        const item = {url:data.url, title:data.title, row, checkbox, status, retry, cancel, state:'queued', controller:null, created:null, runId:0};
        items.push(item); setState(item,'queued');
        retry.onclick = () => { item.runId++; item.checkbox.checked = true; setState(item,'queued'); pump(); };
        cancel.onclick = () => { item.controller?.abort(); if (item.created) apiJson('cancel',{job_id:item.created.job_id,job_token:item.created.job_token}).catch(() => {}); setState(item,'cancelled'); pump(); };
        single.onclick = () => onSingle(item.url);
    }

    async function waitJob(created, item, signal) {
        const deadline = Date.now() + 35 * 60 * 1000;
        while (Date.now() < deadline) {
            const job = await apiJson('status',{job_id:created.job_id,job_token:created.job_token},signal);
            if (job.status === 'finished') return job.result;
            if (job.status === 'failed' || job.status === 'unavailable') throw new Error(job.error || 'A preparação falhou.');
            if (job.status === 'started' && item) setState(item,'preparing',`${job.progress || 0}%`);
            await sleep(5000,signal);
        }
        throw new Error('A preparação excedeu o tempo disponível.');
    }

    async function prepare(item, signal) {
        const action = provider === 'acethinker' ? 'prepare-youtube' : 'prepare';
        let created, result;
        try {
            created = await apiJson(action,{url:item.url},signal);
            item.created = created;
            result = await waitJob(created,item,signal);
        } catch (error) {
            if (action !== 'prepare' || !isYouTubeLink(item.url) || !isYouTubeBotCheck(error)) throw error;
            created = await apiJson('prepare-youtube',{url:item.url},signal);
            item.created = created;
            result = await waitJob(created,item,signal);
        }
        return {created,result};
    }

    async function process(item) {
        const currentGeneration = generation;
        const runId = ++item.runId;
        const controller = new AbortController(); item.controller = controller; item.created = null;
        const signal = controller.signal;
        try {
            setState(item,'preparing');
            let prepared;
            for (let attempt = 0; ; attempt++) {
                try { prepared = await prepare(item,signal); break; }
                catch (error) {
                    if (error.status !== 429 || attempt >= 7) throw error;
                    setState(item,'queued','Aguardando limite de solicitações');
                    await sleep(10000,signal);
                }
            }
            if (signal.aborted) throw new DOMException('Cancelado','AbortError');
            const {format, ...preferences} = queuePreferences;
            // Para conversões, aguarde o slot antes de receber o blob; evita vários arquivos grandes na memória.
            let release = null;
            if (format !== 'original') {
                const previous = serialConversion;
                serialConversion = new Promise(resolve => { release = resolve; });
                await previous;
            }
            try {
                if (signal.aborted) throw new DOMException('Cancelado','AbortError');
                setState(item,'downloading');
                const blob = await apiFile(prepared.created.job_id,prepared.created.job_token,signal);
                if (!blob.size || blob.size > 256 * 1024 * 1024) throw new Error('Arquivo vazio ou maior que 256 MB.');
                if (format !== 'original') setState(item,'processing');
                const file = await convertBlob(blob,prepared.result.filename || `${item.title}.mp4`,format,preferences,signal);
                if (signal.aborted) throw new DOMException('Cancelado','AbortError');
                saveBlob(file.blob,file.filename); setState(item,'completed');
            } finally { release?.(); }
        } catch (error) {
            if (currentGeneration === generation && runId === item.runId) setState(item,signal.aborted || error.name === 'AbortError' ? 'cancelled' : 'failed',signal.aborted ? '' : (error.message || 'Tente novamente'));
        } finally { item.controller = null; item.created = null; if (currentGeneration === generation) { active--; pump(); } }
    }

    function pump() {
        if (!running || paused) return;
        while (active < maxActive()) {
            const item = items.find(candidate => candidate.checkbox.checked && candidate.state === 'queued' && !candidate.controller);
            if (!item) break;
            active++; process(item);
        }
        updateProgress();
    }

    async function loadPage(offset = 0, signal) {
        const created = await apiJson('playlist',{url:playlistUrl,offset},signal);
        const result = await waitJob(created,null,signal);
        if (result?.type === 'video') return false;
        if (result?.type !== 'playlist') throw new Error('Não foi possível analisar a playlist.');
        const spotify = result.platform === 'spotify';
        for (const option of $('playlistOutput').options) option.disabled = spotify && Object.hasOwn(videoFormats, option.value);
        if (spotify && Object.hasOwn(videoFormats, $('playlistOutput').value)) $('playlistOutput').value = 'original';
        $('playlistWidth').disabled = spotify;
        $('playlistTitle').textContent = result.title || 'Playlist';
        $('playlistMeta').textContent = `${result.count ?? 'Vários'} itens · ${result.platform || 'Fonte não informada'} · ${result.items.length} carregados nesta página`;
        result.items.forEach(addItem);
        nextOffset = result.next_offset;
        $('playlistNext').hidden = nextOffset === null;
        $('playlistPanel').hidden = false;
        updateProgress();
        return true;
    }

    async function inspect(url, signal) {
        reset(); playlistUrl = url;
        return loadPage(0,signal);
    }

    function reset() {
        generation++;
        items.forEach(item => { item.controller?.abort(); if (item.created) apiJson('cancel',{job_id:item.created.job_id,job_token:item.created.job_token}).catch(() => {}); });
        items.length = 0; active = 0; running = false; paused = false; nextOffset = null;
        $('playlistItems').replaceChildren(); $('playlistPanel').hidden = true;
        $('playlistPause').hidden = true; $('playlistCancelAll').hidden = true;
    }

    $('playlistSelectAll').onclick = () => items.forEach(item => { if (item.state === 'queued') item.checkbox.checked = true; });
    $('playlistSelectNone').onclick = () => items.forEach(item => { if (item.state === 'queued') item.checkbox.checked = false; });
    $('playlistNext').onclick = async () => {
        const button = $('playlistNext'); button.disabled = true;
        try { await loadPage(nextOffset); } catch (error) { $('playlistMeta').textContent = error.message; }
        finally { button.disabled = false; }
    };
    $('playlistStart').onclick = () => {
        queuePreferences = {format:$('playlistOutput').value,quality:$('playlistQuality').value,width:$('playlistWidth').value,bitrate:$('playlistBitrate').value};
        running = true; paused = false; $('playlistPause').hidden = false; $('playlistCancelAll').hidden = false; pump();
    };
    $('playlistPause').onclick = () => {
        paused = !paused; $('playlistPause').textContent = paused ? 'Continuar fila' : 'Pausar fila'; pump();
    };
    $('playlistCancelAll').onclick = () => {
        running = false; items.forEach(item => { if (!terminal(item.state)) { item.controller?.abort(); if (item.created) apiJson('cancel',{job_id:item.created.job_id,job_token:item.created.job_token}).catch(() => {}); setState(item,'cancelled'); } });
        $('playlistPause').hidden = true; $('playlistCancelAll').hidden = true;
    };
    $('playlistConcurrency').onchange = pump;
    for (const [key,value] of Object.entries({...videoFormats,...audioFormats})) {
        const option = document.createElement('option'); option.value = key; option.textContent = value.label; $('playlistOutput').append(option);
    }
    return {inspect,reset};
}
