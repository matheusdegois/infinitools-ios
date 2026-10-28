import {restorationFilters,outputProfile,readPcm16StereoWav,restoredVideoProfile,restoredVideoCommand} from './audio-restoration-core.mjs';

const $ = id => document.getElementById(id);
const MAX_FILE = 256 * 1048576;
let sourceFile = null, sourceUrl = null, resultUrl = null, stemUrls = [], engine = null, aiWorker = null, activeRun = 0, busy = false, logs = [];
const pendingWorkerTasks = new Set();
const check = id => $(id).checked;
const size = bytes => `${(bytes / 1048576).toFixed(1)} MB`;
function status(message,error=false){$('restoreStatus').textContent=message;$('restoreStatus').classList.toggle('error',error);}
function progress(title,message,percent=null){$('restoreProgress').hidden=false;$('restoreProgressTitle').textContent=title;$('restoreProgressText').textContent=message;if(percent==null)$('restoreProgressBar').removeAttribute('value');else $('restoreProgressBar').value=Math.max(0,Math.min(100,percent));}
function revokeResults(){for(const id of ['compareOriginal','compareResult','compareVideoOriginal','compareVideoResult']){const player=$(id);player.pause();player.removeAttribute('src');player.load();}if(resultUrl)URL.revokeObjectURL(resultUrl);resultUrl=null;for(const url of stemUrls)URL.revokeObjectURL(url);stemUrls=[];$('restoreResult').hidden=true;$('stemDownloads').replaceChildren();}
function setBusy(value){busy=value;$('restoreStart').disabled=value||!sourceFile;$('restoreInput').disabled=value;$('demucsModel').disabled=value;$('restoreCancel').disabled=!value;if(!value)$('restoreProgress').hidden=true;}
function settings(){const names=['declip','declick','dehum','denoise','gate','deepfilter','demucs','eq','compressor','limiter','normalize'];const value=Object.fromEntries(names.map(name=>[name,check(name)]));value.humFrequency=$('humFrequency').value;value.noiseStrength=$('noiseStrength').value;value.format=$('restoreFormat').value;value.outputMode=$('restoreOutputMode').value;value.track=Number($('audioTrack').value);value.demucsOutput=$('demucsOutput').value;if(!['audio','video'].includes(value.outputMode))throw new Error('Escolha uma saída válida.');if(!Number.isInteger(value.track)||value.track<1||value.track>32)throw new Error('Escolha uma faixa de áudio entre 1 e 32.');if(value.demucs&&value.deepfilter&&value.demucsOutput==='instrumental')throw new Error('A limpeza de voz por IA não altera uma saída apenas instrumental. Escolha voz ou mistura, ou desative DeepFilterNet.');restorationFilters(value,'repair');restorationFilters(value,'finish');outputProfile(value.format);return value;}
function ensureCurrent(id){if(activeRun!==id)throw new Error('cancelled');}
async function getEngine(id){progress('Preparando o motor','Carregando FFmpeg WebAssembly no navegador.');const {FFmpeg}=await import('./vendor/ffmpeg/0.12.15/index.js');ensureCurrent(id);const instance=new FFmpeg();engine=instance;instance.on('log',({message})=>{logs.push(message);if(logs.length>200)logs.shift();});const base=new URL('./vendor/ffmpeg/core-0.12.10/',import.meta.url);await instance.load({coreURL:new URL('./ffmpeg-runtime.mjs',import.meta.url).href,wasmURL:new URL('ffmpeg-core.wasm',base).href});ensureCurrent(id);return instance;}
async function ff(instance,args,title,id){ensureCurrent(id);progress(title,'Processando no dispositivo; mantenha esta aba aberta.');logs=[];const result=await instance.exec(['-hide_banner','-nostdin','-y','-protocol_whitelist','file,pipe',...args],600000);ensureCurrent(id);if(result!==0){const details=logs.slice(-8).join(' ');throw new Error(`O FFmpeg não concluiu esta etapa.${details?' '+details.slice(-320):''}`);}}
async function probe(instance,path,id){ensureCurrent(id);const result=await instance.ffprobe(['-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json',path,'-o','restore-probe.json']);ensureCurrent(id);let meta;try{meta=JSON.parse(await instance.readFile('restore-probe.json','utf8'));}catch{throw new Error('O arquivo não pôde ser lido. Verifique o contêiner e o codec.');}finally{try{await instance.deleteFile('restore-probe.json');}catch{}}if(result!==0&&result!==-1)throw new Error('Não foi possível inspecionar o arquivo.');return meta;}
function workerTask(worker,type,data={},transfers=[],onProgress=()=>{}){const id=Math.random().toString(36).slice(2);return new Promise((resolve,reject)=>{const cleanup=()=>{worker.removeEventListener('message',handler);worker.removeEventListener('error',errorHandler);pendingWorkerTasks.delete(cancel);};const cancel=()=>{cleanup();reject(new Error('cancelled'));};const handler=event=>{const message=event.data;if(message?.id!==id)return;if(message.type==='progress'){onProgress(message);return;}cleanup();if(message.type==='error')reject(new Error(message.message||'Falha no modelo.'));else resolve(message);};const errorHandler=event=>{cleanup();reject(new Error(event.message||'Falha no worker de IA.'));};pendingWorkerTasks.add(cancel);worker.addEventListener('message',handler);worker.addEventListener('error',errorHandler);try{worker.postMessage({type,id,...data},transfers);}catch(error){cleanup();reject(error);}});}
async function deepFilter(instance,input,id){ensureCurrent(id);await ff(instance,['-i',input,'-map','0:a:0','-ac','1','-ar','48000','-f','f32le','voice-input.f32'],'Preparando voz para DeepFilterNet',id);const pcm=await instance.readFile('voice-input.f32');if(pcm.length%4!==0)throw new Error('Amostras de áudio inválidas para DeepFilterNet.');aiWorker=new Worker(new URL('./audio-deepfilter-worker.mjs',import.meta.url),{type:'module'});const buffer=pcm.slice().buffer;progress('DeepFilterNet','Carregando o modelo local de voz.');const answer=await workerTask(aiWorker,'process',{buffer},[buffer],message=>progress('Limpando voz com IA',`${Math.round(message.done/message.total*100)}% dos quadros processados.`,Math.round(message.done/message.total*100)));ensureCurrent(id);aiWorker.terminate();aiWorker=null;await instance.writeFile('voice-clean.f32',new Uint8Array(answer.buffer));await ff(instance,['-f','f32le','-ar','48000','-ac','1','-i','voice-clean.f32','-c:a','pcm_s16le','-ar','48000','voice-clean.wav'],'Montando voz limpa',id);return 'voice-clean.wav';}
async function demucsSeparate(instance,input,modelFile,id){
  if(modelFile&&modelFile.size>512*1048576)throw new Error('O modelo ONNX excede 512 MB.');
  const bytes=await instance.readFile(input);
  const rawAudio=readPcm16StereoWav(bytes);
  aiWorker=new Worker(new URL('./vendor/demucs/worker.js',import.meta.url));
  let model;
  if(modelFile){
    progress('Demucs','Lendo o modelo ONNX selecionado no dispositivo.');
    const weights=await modelFile.arrayBuffer();
    model={weights};
  }else{
    progress('Demucs','Carregando o modelo base incluído no site (~166 MB).');
    model={url:new URL('./vendor/demucs/htdemucs_fp16weights.onnx?v=d05c269d',import.meta.url).href};
  }
  ensureCurrent(id);
  await workerTask(aiWorker,'load',model,model.weights?[model.weights]:[]);
  ensureCurrent(id);
  progress('Demucs','Separando voz, bateria, baixo e outros.');
  const transfers=[...new Set(rawAudio.channelData.map(channel=>channel.buffer))];
  const answer=await workerTask(aiWorker,'split',{rawAudio},transfers,message=>progress('Separando fontes com Demucs',`Bloco ${message.step} de ${message.total}.`,Math.round(message.step/message.total*100)));
  ensureCurrent(id);
  aiWorker.terminate();aiWorker=null;
  for(const name of ['vocals','drums','bass','other'])if(!(answer.output?.[name] instanceof ArrayBuffer))throw new Error(`O Demucs não retornou a faixa ${name}.`);
  return answer.output;
}
async function mixStems(instance,names,id){const args=[];for(const name of names)args.push('-i',`stem-${name}.wav`);const labels=names.map((_,index)=>`[${index}:a]`).join('');args.push('-filter_complex',`${labels}amix=inputs=${names.length}:duration=longest:normalize=0,alimiter=limit=0.95[out]`,'-map','[out]','-c:a','pcm_s16le','-ar','44100','stem-mix.wav');await ff(instance,args,'Misturando faixas separadas',id);return 'stem-mix.wav';}
function offerStemDownloads(output,base){const container=$('stemDownloads');container.replaceChildren();for(const [name,buffer] of Object.entries(output)){const url=URL.createObjectURL(new Blob([buffer],{type:'audio/wav'}));stemUrls.push(url);const link=document.createElement('a');link.href=url;link.download=`${base}_${name}.wav`;link.textContent=`Baixar ${name}`;container.append(link);}}
function present(bytes,profile,mode){const base=(sourceFile?.name||'audio').replace(/\.[^.]+$/,'').replace(/[^\p{L}\p{N}._ -]/gu,'_').slice(0,80)||'audio';resultUrl=URL.createObjectURL(new Blob([bytes],{type:profile.mime}));$('restoreDownload').href=resultUrl;$('restoreDownload').download=`${base}_restaurado.${profile.ext}`;$('restoreResultInfo').textContent=`${base}_restaurado.${profile.ext} · ${size(bytes.length)}`;const video=mode==='video';$('restoreResultTitle').textContent=video?'Vídeo com áudio restaurado':'Áudio pronto';$('restoreAudioPlayers').hidden=video;$('restoreVideoPlayers').hidden=!video;if(video){$('compareVideoOriginal').src=sourceUrl;$('compareVideoResult').src=resultUrl;}else{$('compareOriginal').src=sourceUrl;$('compareResult').src=resultUrl;}$('restoreResult').hidden=false;$('restoreResult').scrollIntoView({behavior:'smooth',block:'nearest'});status('Processamento concluído no navegador. Compare o resultado com o original antes de baixar.');}
async function run(){
  if(busy||!sourceFile)return;
  let options;
  try{options=settings();}catch(error){status(error.message,true);return;}
  const id=++activeRun;
  revokeResults();status('');setBusy(true);
  let instance;
  try{
    instance=await getEngine(id);
    const ext=(sourceFile.name.split('.').pop()||'bin').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,8)||'bin';
    const input=`restore-input.${ext}`;
    progress('Lendo o arquivo','Copiando o arquivo para a memória local do navegador.');
    await instance.writeFile(input,new Uint8Array(await sourceFile.arrayBuffer()));
    ensureCurrent(id);
    const meta=await probe(instance,input,id);
    const audioStreams=(meta.streams||[]).filter(stream=>stream.codec_type==='audio');
    const videoStream=(meta.streams||[]).find(stream=>stream.codec_type==='video'&&!stream.disposition?.attached_pic);
    if(audioStreams.length<options.track)throw new Error(`O arquivo contém ${audioStreams.length} faixa(s) de áudio; escolha uma faixa existente.`);
    if(options.outputMode==='video'&&!videoStream)throw new Error('Este arquivo não contém uma faixa de vídeo. Escolha saída somente em áudio.');
    const seconds=Number(meta.format?.duration||audioStreams[0]?.duration||0);
    if(options.demucs&&seconds>180)throw new Error('Demucs no navegador aceita até 3 minutos por operação. Corte o arquivo antes de tentar.');
    if(options.deepfilter&&seconds>600)throw new Error('DeepFilterNet no navegador aceita até 10 minutos por operação. Corte o arquivo antes de tentar.');
    const repair=restorationFilters(options,'repair');
    const preArgs=['-i',input,'-map',`0:a:${options.track-1}`,'-vn','-sn','-dn','-map_metadata','-1'];
    if(repair.length)preArgs.push('-af',repair.join(','));
    preArgs.push('-ac',options.demucs?'2':'1','-ar',options.demucs?'44100':'48000','-c:a','pcm_s16le','restore-pre.wav');
    await ff(instance,preArgs,'Reparando e preparando o áudio',id);
    let current='restore-pre.wav',stems=null;
    if(options.demucs){
      stems=await demucsSeparate(instance,current,$('demucsModel').files[0],id);
      ensureCurrent(id);
      for(const [name,buffer] of Object.entries(stems))await instance.writeFile(`stem-${name}.wav`,new Uint8Array(buffer));
      if(options.deepfilter){
        const clean=await deepFilter(instance,'stem-vocals.wav',id);
        const cleaned=await instance.readFile(clean);
        await instance.writeFile('stem-vocals.wav',cleaned);
        stems.vocals=cleaned.slice().buffer;
      }
      if(options.demucsOutput==='vocals')current='stem-vocals.wav';
      else if(options.demucsOutput==='instrumental')current=await mixStems(instance,['drums','bass','other'],id);
      else current=await mixStems(instance,['vocals','drums','bass','other'],id);
    }else if(options.deepfilter)current=await deepFilter(instance,current,id);
    const finish=restorationFilters(options,'finish');
    const finalArgs=['-i',current,'-map','0:a:0','-vn','-sn','-dn','-map_metadata','-1'];
    if(finish.length)finalArgs.push('-af',finish.join(','));
    let profile,outputPath;
    if(options.outputMode==='video'){
      finalArgs.push('-c:a','pcm_s16le','-ar','48000','restore-final-audio.wav');
      await ff(instance,finalArgs,'Finalizando o áudio restaurado',id);
      profile=restoredVideoProfile(videoStream.codec_name);
      try{
        await ff(instance,restoredVideoCommand(input,'restore-final-audio.wav',profile,videoStream.index),'Colocando o áudio restaurado no vídeo',id);
      }catch(error){
        if(profile.ext!=='mp4'||error.message==='cancelled')throw error;
        profile={ext:'mkv',mime:'video/x-matroska'};
        await ff(instance,restoredVideoCommand(input,'restore-final-audio.wav',profile,videoStream.index),'Tentando contêiner MKV',id);
      }
      outputPath=`restore-final.${profile.ext}`;
    }else{
      profile=outputProfile(options.format);
      outputPath=`restore-final.${profile.ext}`;
      finalArgs.push(...profile.args,outputPath);
      await ff(instance,finalArgs,'Finalizando e codificando',id);
    }
    const result=await instance.readFile(outputPath);
    ensureCurrent(id);
    if(!result.length)throw new Error('O arquivo final ficou vazio.');
    present(result,profile,options.outputMode);
    if(stems){const base=sourceFile.name.replace(/\.[^.]+$/,'').slice(0,70)||'audio';offerStemDownloads(stems,base);}
  }catch(error){if(error.message!=='cancelled')status(error.message,true);}
  finally{aiWorker?.terminate();aiWorker=null;instance?.terminate();engine=null;setBusy(false);}
}
function updateOutputMode(){const video=$('restoreOutputMode').value==='video';$('audioFormatControl').hidden=video;$('videoOutputNote').hidden=!video;}
function selectFile(file){if(!file)return;if(file.size>MAX_FILE){status('Arquivo maior que 256 MB. Escolha um trecho menor.',true);return;}if(sourceUrl)URL.revokeObjectURL(sourceUrl);sourceFile=file;sourceUrl=URL.createObjectURL(file);const likelyVideo=file.type.startsWith('video/')||(!file.type.startsWith('audio/')&&/\.(mp4|m4v|mov|mkv|webm|avi|flv|wmv|mxf|vob|mpeg|mpg|3gp|ts|ogv|rmvb)$/i.test(file.name));$('restoreOutputMode').querySelector('[value="video"]').disabled=!likelyVideo;if(!likelyVideo)$('restoreOutputMode').value='audio';updateOutputMode();$('selectedFile').textContent=`${file.name} · ${size(file.size)}`;$('selectedFile').hidden=false;$('originalPreview').hidden=likelyVideo;$('originalVideoPreview').hidden=!likelyVideo;if(likelyVideo){$('originalVideoPreview').src=sourceUrl;$('originalPreview').removeAttribute('src');}else{$('originalPreview').src=sourceUrl;$('originalVideoPreview').removeAttribute('src');}revokeResults();$('restoreStart').disabled=false;status('Arquivo selecionado. Escolha as etapas e clique em Restaurar áudio agora.');}
$('restoreInput').addEventListener('change',event=>{selectFile(event.target.files[0]);event.target.value='';});for(const type of ['dragenter','dragover'])$('restoreDrop').addEventListener(type,event=>{event.preventDefault();$('restoreDrop').classList.add('dragover');});for(const type of ['dragleave','drop'])$('restoreDrop').addEventListener(type,event=>{event.preventDefault();$('restoreDrop').classList.remove('dragover');if(type==='drop'&&!busy)selectFile(event.dataTransfer.files[0]);});$('restoreOutputMode').addEventListener('change',updateOutputMode);$('demucs').addEventListener('change',()=>{$('demucsSettings').hidden=!check('demucs');});$('restoreStart').addEventListener('click',run);$('restoreCancel').addEventListener('click',()=>{activeRun++;for(const cancel of [...pendingWorkerTasks])cancel();aiWorker?.terminate();aiWorker=null;engine?.terminate();engine=null;status('Processamento cancelado.');});
