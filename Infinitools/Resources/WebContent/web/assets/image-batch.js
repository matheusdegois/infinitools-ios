import {BATCH_LIMITS,recipe,batchSize,validateBatch,outputNames} from './image-batch-core.mjs';
import {identifyRaster} from './vectorizer-core.mjs';
import {neutralAdjustments} from './image-memory.mjs';
import {encodeCanvas} from './image-formats.mjs?v=3';

const $=id=>document.getElementById(id),input=$('batchFiles'),preset=$('batchPreset'),format=$('batchFormat'),size=$('batchSize'),choice=$('batchPreviewFile'),start=$('batchStart'),cancel=$('batchCancel'),download=$('batchDownload'),status=$('batchStatus');
const sliders=[...document.querySelectorAll('[data-batch-setting]')],sharpness=$('batchSharpness'),before=$('batchBefore'),after=$('batchAfter'),errors=$('batchErrors'),progress=$('batchProgress');
const add=$('batchAdd'),more=$('batchMoreFiles'),expandButtons=[...document.querySelectorAll('[data-batch-expand]')],viewer=$('batchViewer'),viewCanvas=$('batchViewerCanvas'),viewScroll=$('batchViewerScroll');
let previewReady=false,viewZoom=1,viewFit=true;
let files=[],busy=false,revision=0,pending=null,job=null,downloadUrl=null;
const abort=()=>new DOMException('Cancelado','AbortError');
function current(token){if(token!==revision)throw abort();}
function say(text,error=false){status.textContent=text;status.classList.toggle('error',error);}
function stop(){revision++;clearTimeout(pending);pending=null;if(job){const old=job;job=null;old.worker.terminate();clearTimeout(old.timer);old.reject(abort());}}
function clearDownload(){download.hidden=true;download.removeAttribute('href');if(downloadUrl){URL.revokeObjectURL(downloadUrl);downloadUrl=null;}}
function settings(){return recipe(preset.value,Object.fromEntries([...sliders.map(s=>[s.dataset.batchSetting,Number(s.value)]),['sharpness',sharpness.checked]]));}
function syncProfile(){const values=recipe(preset.value);for(const s of sliders){s.value=values[s.dataset.batchSetting];$('batch-output-'+s.dataset.batchSetting).textContent=s.value;}sharpness.checked=false;}
function controls(disabled){input.disabled=disabled;for(const control of [preset,format,size,choice,sharpness,add,more,...sliders])control.disabled=disabled;for(const button of expandButtons)button.disabled=disabled||!previewReady;start.disabled=disabled||!files.length;}
function ready(value){previewReady=value;for(const button of expandButtons)button.disabled=busy||!value;}
function clearCanvas(c){c.width=1;c.height=1;}
function show(c,source){c.width=source.width;c.height=source.height;c.getContext('2d').drawImage(source,0,0);}
function whiteBackground(canvas){const context=canvas.getContext('2d');context.globalCompositeOperation='destination-over';context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.globalCompositeOperation='source-over';}
function zoom(value){viewZoom=Math.max(.01,Math.min(4,value));viewCanvas.style.width=`${viewCanvas.width*viewZoom}px`;viewCanvas.style.height=`${viewCanvas.height*viewZoom}px`;$('batchViewerZoom').textContent=`${Math.round(viewZoom*100)}%`;}
function fitView(){viewFit=true;zoom(Math.min(1,(viewScroll.clientWidth-24)/viewCanvas.width,(viewScroll.clientHeight-24)/viewCanvas.height));}
async function expand(kind){
    if(busy||!previewReady)return;
    const token=revision,file=files[Number(choice.value)||0],adjusted=kind==='after',values=settings(),target=format.value,edge=adjusted?Number(size.value):0;
    let source;viewFit=true;
    $('batchViewerTitle').textContent=`${adjusted?'Com os ajustes':'Original'} — ${file.name}`;
    show(viewCanvas,adjusted?after:before);viewer.showModal();fitView();
    $('batchViewerStatus').textContent='Carregando uma versão maior para visualizar os detalhes…';
    try{
        source=await load(file,token,false,edge);
        if(adjusted){await process(source.canvas,values,token);if(target==='jpg')whiteBackground(source.canvas);}
        current(token);if(!viewer.open)return;
        show(viewCanvas,source.canvas);if(viewFit)fitView();else zoom(viewZoom);
        $('batchViewerStatus').textContent=`${source.canvas.width} × ${source.canvas.height} pixels. Use 100% ou aumente o zoom para ler os detalhes.${source.canvas.width<source.width||source.canvas.height<source.height?' Visualização limitada ao tamanho de saída da ferramenta.':''}`;
    }catch(error){if(viewer.open&&token===revision)$('batchViewerStatus').textContent=error.message||'Não foi possível carregar a versão maior.';}
    finally{if(source)clearCanvas(source.canvas);}
}
for(const button of expandButtons)button.addEventListener('click',()=>expand(button.dataset.batchExpand));
$('batchViewerClose').addEventListener('click',()=>viewer.close());
viewer.addEventListener('close',()=>{stop();clearCanvas(viewCanvas);});
$('batchViewerFit').addEventListener('click',fitView);
$('batchViewerActual').addEventListener('click',()=>{viewFit=false;zoom(1);});
$('batchViewerMinus').addEventListener('click',()=>{viewFit=false;zoom(viewZoom/1.25);});
$('batchViewerPlus').addEventListener('click',()=>{viewFit=false;zoom(viewZoom*1.25);});
window.addEventListener('resize',()=>{if(viewer.open&&viewFit)fitView();});

async function load(file,token,preview=false,edge=0){
    current(token);
    const signature=identifyRaster(new Uint8Array(await file.slice(0,512*1024).arrayBuffer()));
    if(signature.width!==undefined)batchSize(signature.width,signature.height);
    current(token);
    if(typeof createImageBitmap!=='function')throw new Error('Atualize seu navegador para abrir imagens nesta ferramenta.');
    const bitmap=await createImageBitmap(new Blob([file],{type:signature.mime}),{imageOrientation:'from-image'});
    let canvas;
    try{
        current(token);const target=batchSize(bitmap.width,bitmap.height,edge,preview);
        canvas=document.createElement('canvas');canvas.width=target.width;canvas.height=target.height;canvas.getContext('2d').drawImage(bitmap,0,0,target.width,target.height);
        return {canvas,width:bitmap.width,height:bitmap.height};
    }catch(error){if(canvas)clearCanvas(canvas);throw error;}finally{bitmap.close();}
}

function process(canvas,values,token){
    current(token);if(neutralAdjustments(values))return Promise.resolve(canvas);
    const raster=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);
    return new Promise((resolve,reject)=>{
        const worker=new Worker(new URL('./image-adjust-worker.js?v=2',import.meta.url),{type:'module'});
        const cleanup=()=>{worker.terminate();clearTimeout(active.timer);if(job===active)job=null;};
        const fail=error=>{cleanup();reject(error);};
        const active={worker,reject,timer:setTimeout(()=>fail(new Error('O processamento demorou demais. Tente uma imagem menor.')),90_000)};job=active;
        worker.onerror=()=>fail(new Error('Não foi possível carregar os ajustes. Recarregue a página.'));
        worker.onmessage=({data})=>{
            cleanup();try{current(token);if(data.error)throw new Error(data.error);canvas.getContext('2d').putImageData(new ImageData(data.pixels,canvas.width,canvas.height),0,0);resolve(canvas);}catch(error){reject(error);}
        };
        try{worker.postMessage({id:1,kind:'adjust',pixels:raster.data,width:canvas.width,height:canvas.height,settings:values},[raster.data.buffer]);}catch(error){fail(error);}
    });
}

async function preview(){
    if(busy||!files.length)return;
    ready(false);
    const token=revision,file=files[Number(choice.value)||0];let source;
    cancel.hidden=false;
    try{
        say('Atualizando a prévia…');source=await load(file,token,true,Number(size.value));current(token);
        show(before,source.canvas);await process(source.canvas,settings(),token);current(token);if(format.value==='jpg')whiteBackground(source.canvas);show(after,source.canvas);
        const target=batchSize(source.width,source.height,Number(size.value));
        $('batchFileInfo').textContent=`${file.name} · Original: ${source.width} × ${source.height} · Saída: ${target.width} × ${target.height}`;
        say('Prévia pronta. Os mesmos ajustes serão aplicados a todas as imagens.');
        ready(true);
    }catch(error){if(token===revision){clearCanvas(after);say(error.message||'Não foi possível preparar a prévia.',true);}}
    finally{if(source)clearCanvas(source.canvas);if(token===revision)cancel.hidden=true;}
}
function changed(){
    if(busy)return;stop();ready(false);clearDownload();clearCanvas(after);
    if(files.length){say('Atualizando a prévia…');cancel.hidden=false;pending=setTimeout(()=>{pending=null;preview();},250);}
}
function select(selected,append=false){
    if(busy)return;
    if(!selected.length)return;
    const previous=Number(choice.value)||0,next=append?[...files,...selected]:[...selected];try{validateBatch(next);}catch(error){say(error.message+(append?' As imagens anteriores foram mantidas.':''),true);return;}
    stop();ready(false);clearDownload();files=next;clearCanvas(before);clearCanvas(after);errors.replaceChildren();errors.hidden=true;progress.hidden=true;
    choice.replaceChildren(...files.map((file,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=`${index+1}. ${file.name}`;return option;}));
    $('batchWorkspace').hidden=!files.length;start.textContent=files.length===1?'Aplicar e baixar imagem':'Aplicar e baixar ZIP';start.disabled=!files.length;
    $('batchCount').textContent=`${files.length} ${files.length===1?'imagem selecionada':'imagens selecionadas'}`;
    if(append)choice.value=String(previous);
    if(files.length)preview();else say('');
}
input.addEventListener('change',()=>{select(input.files);input.value='';});
add.addEventListener('click',()=>{if(!busy)more.click();});
more.addEventListener('change',()=>{select(more.files,true);more.value='';});
preset.addEventListener('change',()=>{syncProfile();changed();});
for(const control of [format,size,choice,sharpness])control.addEventListener('change',changed);
for(const slider of sliders)slider.addEventListener('input',()=>{$('batch-output-'+slider.dataset.batchSetting).textContent=slider.value;changed();});
cancel.addEventListener('click',()=>{stop();cancel.hidden=true;progress.hidden=true;say('Cancelado. Altere uma opção para gerar a prévia novamente ou clique em aplicar para processar o lote.');});

async function runBatch(){
    if(busy||!files.length)return;
    if(files.length>1&&typeof JSZip!=='function'){say('Não foi possível carregar o download ZIP. Recarregue a página.',true);return;}
    stop();clearDownload();const token=revision,batch=[...files],values=settings(),target=format.value,edge=Number(size.value),names=outputNames(batch,target);
    busy=true;controls(true);cancel.hidden=false;progress.hidden=false;progress.max=batch.length;progress.value=0;errors.replaceChildren();errors.hidden=true;
    const zip=batch.length>1?new JSZip():null;let completed=0,total=0,single=null;
    try{
        for(let index=0;index<batch.length;index++){
            current(token);const file=batch[index];let source;
            say(`Aplicando ajustes ${index+1} de ${batch.length}: ${file.name}`);
            try{
                source=await load(file,token,false,edge);await process(source.canvas,values,token);current(token);
                if(target==='jpg')whiteBackground(source.canvas);
                const encoded=await encodeCanvas(source.canvas,target,.92);current(token);
                if(total+encoded.blob.size>120*1024*1024)throw new Error('Os resultados ultrapassam 120 MB. Use JPG, WebP ou um tamanho de saída menor.');
                total+=encoded.blob.size;
                if(zip)zip.file(names[index],encoded.blob);else single=encoded.blob;
                completed++;
            }catch(error){if(error.name==='AbortError')throw error;const item=document.createElement('li');item.textContent=`${file.name}: ${error.message||'Não foi possível processar esta imagem.'}`;errors.append(item);errors.hidden=false;}
            finally{if(source)clearCanvas(source.canvas);}
            progress.value=index+1;
        }
        current(token);if(!completed){say('Nenhuma imagem pôde ser processada. Confira os erros.',true);return;}
        say('Preparando o download…');const blob=zip?await zip.generateAsync({type:'blob',compression:'STORE'}):single;current(token);
        downloadUrl=URL.createObjectURL(blob);download.href=downloadUrl;download.download=zip?'imagens-editadas.zip':names[0];download.hidden=false;download.click();
        say(`${completed} de ${batch.length} ${batch.length===1?'imagem pronta':'imagens prontas'}. Download iniciado.${completed<batch.length?' Confira os arquivos que falharam abaixo.':''}`);
    }catch(error){if(error.name!=='AbortError')say(error.message||'Não foi possível concluir o lote.',true);}
    finally{busy=false;controls(false);cancel.hidden=true;}
}
start.addEventListener('click',runBatch);
const drop=$('batchDrop');
for(const type of ['dragenter','dragover'])drop.addEventListener(type,e=>{e.preventDefault();if(!busy)drop.classList.add('dragover');});
for(const type of ['dragleave','drop'])drop.addEventListener(type,e=>{e.preventDefault();drop.classList.remove('dragover');});
drop.addEventListener('drop',e=>select(e.dataTransfer.files));
window.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();});
window.addEventListener('drop',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();});
window.addEventListener('pagehide',()=>{stop();clearDownload();});
window.addEventListener('pageshow',e=>{if(e.persisted&&!busy&&files.length)changed();});
syncProfile();
