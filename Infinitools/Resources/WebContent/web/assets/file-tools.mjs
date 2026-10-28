import {ImageTemplateEditor} from './image-templates.mjs?v=5';
import {PngOptimizerUI} from './png-ui.mjs?v=4';

const $=id=>document.getElementById(id),mode=document.body.dataset.fileTool,status=$('fileStatus'),result=$('fileResult'),input=$('filesInput'),button=$('fileStart');
let busy=false,generation=0,engine=null,urls=[];
const isImage=['avatar','collage','thumbnail','photo-id','social-image'].includes(mode);
input.multiple=mode==='remove-background'||mode==='zip-files'||['collage','thumbnail','social-image'].includes(mode);input.accept=mode==='remove-background'?'image/png,image/jpeg,image/webp':mode==='unzip-files'?'.zip':mode==='optimize-png'?'.png,.apng,image/png,image/apng':isImage?'image/*':'';
if(mode==='media-metadata')input.accept='audio/*,video/*,.mkv,.avi,.mxf,.vob,.rm,.rmvb,.ts,.ape,.amr';
$('fileUploadHelp').textContent=mode==='remove-background'?'PNG, JPEG ou WebP · até 16 imagens · 80 MB no total · até 32 MP por imagem':mode==='optimize-png'?'PNG ou APNG · até 80 MB · sem upload':isImage?'Imagens · até '+(input.multiple?'16 arquivos':'1 arquivo')+' · 80 MB no total':mode==='media-metadata'?'Áudio ou vídeo · até 80 MB · relatório JSON':'Até 100 arquivos · 80 MB no total';
function setSelected(files){const transfer=new DataTransfer();files.forEach(file=>transfer.items.add(file));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));}
function renderSelection(){const selection=$('fileSelection');selection.replaceChildren();selection.hidden=!input.files.length;for(const [index,file] of [...input.files].entries()){const row=document.createElement('div');row.className='file-selection-row';const badge=document.createElement('span');badge.className='file-selection-badge';badge.textContent=file.name.split('.').pop().toUpperCase().slice(0,5);const copy=document.createElement('div'),name=document.createElement('strong'),size=document.createElement('small');name.textContent=file.name;size.textContent=(file.size/1048576).toLocaleString('pt-BR',{maximumFractionDigits:2})+' MB';copy.append(name,size);const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.disabled=busy;remove.setAttribute('aria-label','Remover '+file.name);remove.onclick=()=>{if(!busy)setSelected([...input.files].filter((_,i)=>i!==index));};row.append(badge,copy,remove);selection.append(row);}}
for(const event of ['dragenter','dragover'])$('fileDrop').addEventListener(event,e=>{e.preventDefault();if(!busy)$('fileDrop').classList.add('dragover');});
for(const event of ['dragleave','drop'])$('fileDrop').addEventListener(event,e=>{e.preventDefault();$('fileDrop').classList.remove('dragover');if(event==='drop'&&!busy&&e.dataTransfer.files.length)setSelected(input.multiple?[...e.dataTransfer.files]:[e.dataTransfer.files[0]]);});
const templateEditor=isImage?new ImageTemplateEditor(mode,$('fileOptions')):null;
const pngEditor=mode==='optimize-png'?new PngOptimizerUI($('fileOptions')):null;
function clear(){urls.forEach(URL.revokeObjectURL);urls=[];result.replaceChildren();}
function download(blob,name,id=generation){if(id!==generation)throw new Error('cancelled');const url=URL.createObjectURL(blob);urls.push(url);const link=document.createElement('a');link.href=url;link.download=name;link.className='btn btn-success';link.textContent='Baixar '+name;result.append(link);return url;}
input.onchange=async()=>{if(busy)return;const files=[...input.files],id=++generation;clear();renderSelection();button.disabled=true;status.textContent=files.length?'Arquivo selecionado. Configure as opções e processe quando estiver pronto.':'';if(!files.length){templateEditor?.destroy();if(templateEditor)templateEditor.preview.hidden=true;return;}try{validate(files);if(templateEditor){const loaded=await templateEditor.loadFiles(files);if(!loaded||id!==generation)return;}button.disabled=!files.length;}catch(error){if(id===generation)status.textContent=error.message;}};
if(templateEditor){$('fileOptions').addEventListener('input',clear);$('fileOptions').addEventListener('templatechange',clear);}
if(mode==='remove-background')$('fileOptions').innerHTML='<p class="utility-note">O recorte automático mantém o assunto principal e cria transparência. Confira cabelos e bordas. A saída tem até 4 megapixels; arquivos maiores são reduzidos proporcionalmente.</p>';
if(pngEditor)$('fileOptions').addEventListener('input',()=>{clear();status.textContent=input.files.length?'Opções alteradas. Clique em Processar para atualizar a comparação.':'';});
function validate(files){if(!files.length)throw new Error('Selecione um arquivo.');if(files.length>100||files.reduce((n,f)=>n+f.size,0)>80*1024*1024)throw new Error('Use até 100 arquivos e 80 MB no total.');if(mode==='remove-background'&&(files.length>16||files.some(file=>!(/\.(png|jpe?g|webp)$/i.test(file.name)||['image/png','image/jpeg','image/webp'].includes(file.type)))))throw new Error('Selecione até 16 imagens PNG, JPEG ou WebP.');if(mode==='collage'&&files.length>16)throw new Error('Use até 16 imagens por collage.');}
function safeName(name){return name.replace(/\\/g,'/').split('/').pop().replace(/[\x00-\x1f<>:"|?*]/g,'_').replace(/^\.+/,'').slice(0,160)||'arquivo';}
function uniqueName(name,names){const original=safeName(name);let result=original,index=2;while(names.has(result))result=index+++'-'+original;names.add(result);return result;}
function extractEntry(entry,expected,id){return new Promise((resolve,reject)=>{let size=0;const chunks=[],stream=entry.internalStream('uint8array');stream.on('data',chunk=>{size+=chunk.length;if(id!==generation||size>expected){stream.pause();chunks.length=0;reject(new Error(id!==generation?'cancelled':'Tamanho de entrada ZIP inconsistente.'));return;}chunks.push(chunk);});stream.on('error',reject);stream.on('end',()=>size===expected?resolve(new Blob(chunks,{type:'application/octet-stream'})):reject(new Error('Tamanho de entrada ZIP inconsistente.')));stream.resume();});}
async function inspectMedia(file,id){
    const {FFmpeg}=await import('./vendor/ffmpeg/0.12.15/index.js');engine=new FFmpeg();
    await engine.load({coreURL:new URL('./ffmpeg-runtime.mjs',import.meta.url).href,wasmURL:new URL('./vendor/ffmpeg/core-0.12.10/ffmpeg-core.wasm',import.meta.url).href});
    if(id!==generation)throw new Error('cancelled');
    await engine.writeFile('input.bin',new Uint8Array(await file.arrayBuffer()));
    const code=await engine.ffprobe(['-v','error','-protocol_whitelist','file,pipe','-show_format','-show_streams','-show_chapters','-of','json','input.bin','-o','metadata.json']);
    if(code!==0&&code!==-1)throw new Error('Não foi possível inspecionar esta mídia.');
    const metadata=JSON.parse(await engine.readFile('metadata.json','utf8'));if(!metadata.streams?.length)throw new Error('Arquivo de mídia sem faixas legíveis.');return metadata;
}
async function imageTemplate(files,id){
    const outputs=await templateEditor.export();if(id!==generation)throw new Error('cancelled');
    for(const output of outputs){const url=download(output.blob,output.name,id),preview=document.createElement('img');preview.src=url;preview.alt='Prévia: '+output.name;result.append(preview);}
}
button.onclick=async()=>{
    if(busy)return;const files=[...input.files];try{validate(files);}catch(error){status.textContent=error.message;return;}
    const id=++generation;busy=true;renderSelection();templateEditor?.setBusy(true);pngEditor?.setBusy(true);button.disabled=true;input.disabled=true;$('fileDrop').classList.add('busy');$('fileCancel').hidden=false;clear();status.textContent='Processando no navegador...';
    try{
        if(mode==='zip-files'){const zip=new JSZip(),names=new Set();for(const [index,file] of files.entries()){const name=uniqueName(file.name,names);zip.file(name,file);}download(await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}}),'arquivos.zip',id);}
        else if(mode==='unzip-files'){
            const zip=await JSZip.loadAsync(await files[0].arrayBuffer()),entries=Object.values(zip.files).filter(entry=>!entry.dir);if(entries.length>100)throw new Error('O ZIP excede 100 arquivos.');
            let total=0;const unpacked=[];const names=new Set();
            for(const [index,entry] of entries.entries()){if(id!==generation)throw new Error('cancelled');const expected=entry._data?.uncompressedSize;if(!Number.isFinite(expected)||expected>80*1024*1024||(total+=expected)>160*1024*1024)throw new Error('O ZIP excede o limite de 160 MB descompactados ou 80 MB por arquivo.');const blob=await extractEntry(entry,expected,id),name=uniqueName(entry.name,names);unpacked.push({blob,name});}
            if(!unpacked.length)throw new Error('Este ZIP não contém arquivos.');
            const bundle=new JSZip();for(const entry of unpacked){if(id!==generation)throw new Error('cancelled');bundle.file(entry.name,await entry.blob.arrayBuffer());}
            const all=await bundle.generateAsync({type:'blob',compression:'STORE',streamFiles:true},()=>{if(id!==generation)throw new Error('cancelled');});
            download(all,'arquivos-extraidos.zip',id);result.lastElementChild.textContent='Baixar todos os arquivos (ZIP)';result.lastElementChild.dataset.downloadAll='';
            unpacked.forEach(entry=>download(entry.blob,entry.name,id));
        }else if(mode==='media-metadata'){const metadata=await inspectMedia(files[0],id);if(id!==generation)throw new Error('cancelled');const pre=document.createElement('pre');pre.textContent=JSON.stringify(metadata,null,2);result.append(pre);download(new Blob([pre.textContent],{type:'application/json'}),safeName(files[0].name)+'.metadata.json',id);}
        else if(mode==='optimize-png'){const {bytes,summary}=await pngEditor.process(files[0],worker=>{if(id!==generation){worker.terminate();return false;}engine=worker;return true;});if(id!==generation)throw new Error('cancelled');const url=download(new Blob([bytes],{type:'image/png'}),safeName(files[0].name).replace(/\.(a?png)$/i,'')+'_otimizado.png',id),originalURL=URL.createObjectURL(files[0]);urls.push(originalURL);status.textContent=pngEditor.show(result,files[0],url,originalURL,summary,bytes.length);}
        else if(mode==='remove-background'){
            const {BackgroundBatch}=await import('./background-batch.mjs?v=1');if(id!==generation)throw new Error('cancelled');engine=new BackgroundBatch();let completed=0,failed=0;const names=new Set();
            for(const [index,file] of files.entries()){
                if(id!==generation)throw new Error('cancelled');status.textContent=`Tirando fundo · imagem ${index+1} de ${files.length} · o primeiro processamento carrega o modelo…`;
                try{const output=await engine.process(file);if(id!==generation)throw new Error('cancelled');const card=document.createElement('article');card.className='background-result';const title=document.createElement('h3');title.textContent=file.name;const image=document.createElement('img'),name=uniqueName(file.name.replace(/\.[^.]+$/,'')+'_sem-fundo.png',names),url=download(output.blob,name,id),link=result.lastElementChild;image.src=url;image.alt='Resultado sem fundo de '+file.name;const note=document.createElement('p');note.textContent=output.width+' × '+output.height+' px'+(output.reduced?' · reduzida proporcionalmente':'');card.append(title,image,note,link);result.append(card);completed++;}
                catch(error){if(id!==generation||error.message==='cancelled')throw error;failed++;const note=document.createElement('p');note.textContent=file.name+': '+(error.message||'Imagem não suportada.');result.append(note);engine.terminate();engine=new BackgroundBatch();}
            }
            status.textContent=`${completed} imagem(ns) pronta(s)`+(failed?` · ${failed} falha(s).`:'.')+' Confira as bordas e baixe os PNGs transparentes.';
        }
        else if(isImage)await imageTemplate(files,id);
        if(id===generation&&!['optimize-png','remove-background'].includes(mode))status.textContent='Resultado pronto. Confira a prévia e baixe o arquivo.';
    }catch(error){if(id===generation){clear();status.textContent=error.message||'Falha no processamento.';}}
    finally{if(id===generation){busy=false;renderSelection();$('fileDrop').classList.remove('busy');templateEditor?.setBusy(false);pngEditor?.setBusy(false);button.disabled=false;input.disabled=false;$('fileCancel').hidden=true;engine?.terminate();engine=null;}}
};
$('fileCancel').onclick=()=>{generation++;templateEditor?.backgroundEditor?.reset();engine?.terminate();engine=null;clear();busy=false;renderSelection();$('fileDrop').classList.remove('busy');templateEditor?.setBusy(false);pngEditor?.setBusy(false);button.disabled=!input.files.length;input.disabled=false;$('fileCancel').hidden=true;status.textContent='Processamento cancelado.';};
window.addEventListener('pagehide',()=>{generation++;engine?.terminate();templateEditor?.destroy();clear();});
