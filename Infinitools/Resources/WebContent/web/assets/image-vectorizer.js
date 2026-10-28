import {LIMITS,identifyRaster,traceSize} from './vectorizer-core.mjs';

const el=id=>document.getElementById(id);
const fileInput=el('vectorFile'),drop=el('vectorDrop'),workspace=el('vectorWorkspace');
const preset=el('vectorPreset'),colors=el('vectorColors'),detail=el('vectorDetail'),background=el('vectorBackground');
const cancel=el('vectorCancel'),download=el('vectorDownload'),preview=el('vectorPreview'),placeholder=el('vectorPlaceholder'),status=el('vectorStatus');
const original=el('vectorOriginal');
let worker=null,timer=null,pending=null,epoch=0,source=null,svgUrl=null,filename='imagem',originalWidth=0,originalHeight=0;

function message(text,error=false){status.textContent=text;status.classList.toggle('error',error);}
function busy(value){workspace.setAttribute('aria-busy',String(value));cancel.hidden=!value;}
function stop(){epoch++;if(worker){worker.terminate();worker=null;}clearTimeout(timer);timer=null;clearTimeout(pending);pending=null;busy(false);}
function clearResult(){download.hidden=true;download.removeAttribute('href');preview.hidden=true;preview.removeAttribute('src');if(svgUrl){URL.revokeObjectURL(svgUrl);svgUrl=null;}el('vectorStats').textContent='';placeholder.hidden=false;}
function bytes(value){return value<1024*1024?`${(value/1024).toFixed(1)} KB`:`${(value/(1024*1024)).toFixed(1)} MB`;}

async function decode(blob){
    if(typeof createImageBitmap==='function')return createImageBitmap(blob,{imageOrientation:'from-image'});
    const url=URL.createObjectURL(blob),image=new Image();
    try{image.src=url;await image.decode();return image;}finally{URL.revokeObjectURL(url);}
}

async function select(files){
    if(!files.length)return;
    if(files.length!==1){message('Selecione uma imagem por vez.',true);return;}
    stop();clearResult();source=null;workspace.hidden=true;
    const current=epoch,file=files[0];
    if(!file.size||file.size>LIMITS.bytes){message('Selecione uma imagem de até 15 MB.',true);return;}
    if(typeof Worker!=='function'){message('Este navegador não oferece processamento em segundo plano. Use uma versão atual do Chrome, Edge, Firefox ou Safari.',true);return;}
    message('Abrindo imagem…');
    let bitmap;
    try{
        const header=new Uint8Array(await file.slice(0,512*1024).arrayBuffer());
        const identified=identifyRaster(header);
        if(identified.width!==undefined)traceSize(identified.width,identified.height);
        if(current!==epoch)return;
        bitmap=await decode(new Blob([file],{type:identified.mime}));
        if(current!==epoch)return;
        originalWidth=bitmap.width||bitmap.naturalWidth;originalHeight=bitmap.height||bitmap.naturalHeight;
        const size=traceSize(originalWidth,originalHeight,'high');
        source=document.createElement('canvas');source.width=size.width;source.height=size.height;
        const context=source.getContext('2d');if(!context)throw new Error('Não foi possível abrir a imagem neste navegador.');
        context.drawImage(bitmap,0,0,size.width,size.height);
        original.width=size.width;original.height=size.height;original.getContext('2d').drawImage(source,0,0);
        filename=file.name.replace(/\.[^.]*$/,'').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,100)||'imagem';
        el('vectorFileInfo').textContent=`${file.name} · ${originalWidth} × ${originalHeight} · ${bytes(file.size)}`;
        workspace.hidden=false;
        run();
    }catch(error){if(current===epoch){source=null;message(error.message||'Não foi possível abrir esta imagem.',true);}}
    finally{bitmap?.close?.();}
}

function run(){
    if(!source)return;
    stop();clearResult();const current=epoch;
    const size=traceSize(originalWidth,originalHeight,detail.value);
    const canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;
    const context=canvas.getContext('2d',{willReadFrequently:true});
    try{
        context.drawImage(source,0,0,size.width,size.height);
        const raster=context.getImageData(0,0,size.width,size.height);
        busy(true);placeholder.textContent='Traçando formas e curvas…';message('Vetorizando a imagem. Você pode cancelar a qualquer momento.');
        worker=new Worker(new URL('./vectorizer-worker.js?v=1',import.meta.url),{type:'module'});
        const fail=text=>{if(current!==epoch)return;stop();clearResult();placeholder.textContent='Ajuste as opções e tente novamente.';message(text,true);};
        worker.onerror=()=>fail('Não foi possível carregar o motor de vetorização. Recarregue a página ou tente outro navegador atualizado.');
        worker.onmessage=({data})=>{
            if(current!==epoch)return;
            if(!data.ok){fail(data.error);return;}
            stop();
            const blob=new Blob([data.svg],{type:'image/svg+xml;charset=utf-8'});
            svgUrl=URL.createObjectURL(blob);preview.src=svgUrl;preview.hidden=false;placeholder.hidden=true;
            download.href=svgUrl;download.download=`${filename}_vetorizado.svg`;download.hidden=false;
            const reduced=size.width<originalWidth||size.height<originalHeight;
            el('vectorStats').textContent=`${data.paths.toLocaleString('pt-BR')} ${data.paths===1?'forma':'formas'} · ${data.colors} ${data.colors===1?'cor':'cores'} · ${bytes(blob.size)}${reduced?` · Traçado em ${size.width} × ${size.height}; SVG com as dimensões originais.`:''}`;
            message(background.checked&&!data.backgroundRemoved?'SVG pronto. Não foi encontrado um fundo uniforme nas bordas; ele foi mantido.':'SVG pronto. Compare o resultado e clique em “Baixar SVG”.');
        };
        timer=setTimeout(()=>fail('O traçado demorou demais. Tente menos cores ou menos detalhes.'),45_000);
        worker.postMessage({width:size.width,height:size.height,buffer:raster.data.buffer,settings:{preset:preset.value,colors:Number(colors.value),detail:detail.value,removeBackground:background.checked,originalWidth,originalHeight}},[raster.data.buffer]);
    }catch(error){stop();message(error.message||'Não foi possível iniciar a vetorização.',true);}
}

function changed(){
    stop();clearResult();
    if(source){placeholder.textContent='Atualizando a prévia…';message('Atualizando a prévia com as novas opções…');busy(true);pending=setTimeout(run,250);}
}
preset.addEventListener('change',()=>{colors.value=preset.value==='photo'?'16':'8';colors.disabled=preset.value==='drawing';el('vectorColorsLabel').hidden=preset.value==='drawing';changed();});
for(const input of [colors,detail,background])input.addEventListener('change',changed);
fileInput.addEventListener('change',()=>{select([...fileInput.files]);fileInput.value='';});
cancel.addEventListener('click',()=>{stop();clearResult();placeholder.textContent='Vetorização cancelada.';message('Cancelado. Você pode ajustar as opções e tentar novamente.');});
for(const event of ['dragenter','dragover'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.add('dragover');});
for(const event of ['dragleave','drop'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.remove('dragover');});
drop.addEventListener('drop',e=>select([...e.dataTransfer.files]));
// Do not navigate away when a file is dropped outside the upload target.
window.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();});
window.addEventListener('drop',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();});
window.addEventListener('pagehide',()=>{stop();clearResult();if(source)placeholder.textContent='Preparando a prévia…';});
window.addEventListener('pageshow',event=>{if(event.persisted&&source)run();});
