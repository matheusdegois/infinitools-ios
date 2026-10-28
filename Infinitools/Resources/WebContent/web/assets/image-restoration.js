import {restorationProfile,outputDimensions} from './image-restoration-core.mjs';
import {tiledUpscale} from './image-ai-tiles.mjs';
const $=id=>document.getElementById(id);
let files=[],urls=[],cancelled=false,busy=false,aiEngine=null;
const keys=['Denoise','Deblock','Details','Color'];
function status(message,error=false){$('irStatus').textContent=message;$('irStatus').classList.toggle('error',error)}
function setBusy(value){busy=value;$('irStart').disabled=value||!files.length;$('irInput').disabled=value;$('irProgress').hidden=!value}
function applyPreset(){const value=$('irPreset').value;const profile=restorationProfile(value,640,480);if(!profile)return;for(const key of keys)$('ir'+key).checked=profile[key.toLowerCase()];$('irScale').value=profile.scale;$('irAi').checked=profile.ai}
function cleanup(){for(const url of urls)URL.revokeObjectURL(url);urls=[];$('irResultList').replaceChildren();$('irResults').hidden=true}
function pause(){return new Promise(resolve=>setTimeout(resolve,0))}
async function decode(file){const bitmap=await createImageBitmap(file);if(bitmap.width*bitmap.height>16_000_000){bitmap.close();throw Error('A imagem excede 16 milhões de pixels.')}return bitmap}
function chooseSettings(width,height){const profile=restorationProfile($('irPreset').value,width,height);if(profile)return profile;return Object.fromEntries([...keys.map(key=>[key.toLowerCase(),$('ir'+key).checked]),['scale',Number($('irScale').value)],['ai',$('irAi').checked]])}
function filteredPixels(canvas,settings){const ctx=canvas.getContext('2d',{willReadFrequently:true});const {width,height}=canvas;const original=ctx.getImageData(0,0,width,height);const src=original.data;const out=new Uint8ClampedArray(src);const stride=width*4;const edge=(x,y)=>{const i=(y*width+x)*4;return (src[i]*0.2126+src[i+1]*0.7152+src[i+2]*0.0722)};
  if(settings.denoise||settings.deblock){for(let y=1;y<height-1;y++){for(let x=1;x<width-1;x++){const i=(y*width+x)*4;const center=edge(x,y);const blockEdge=settings.deblock&&(x%8===0||y%8===0);for(let c=0;c<3;c++){let total=0,weight=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const j=i+dy*stride+dx*4;const diff=Math.abs(src[j]-src[i]);const threshold=blockEdge?42:22;if(diff>threshold)continue;const w=(dx===0&&dy===0)?3:1;total+=src[j+c]*w;weight+=w}if(weight)out[i+c]=Math.round(total/weight)}}}}
  if(settings.color){let mean=0,count=0;for(let i=0;i<out.length;i+=64){mean+=.2126*out[i]+.7152*out[i+1]+.0722*out[i+2];count++}mean/=count||1;const lift=Math.max(-12,Math.min(12,(120-mean)*.16));for(let i=0;i<out.length;i+=4){const l=.2126*out[i]+.7152*out[i+1]+.0722*out[i+2];for(let c=0;c<3;c++)out[i+c]=Math.max(0,Math.min(255,(out[i+c]-l)*1.06+(l-128)*1.04+128+lift))}}
  if(settings.details){const copy=new Uint8ClampedArray(out);for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){const i=(y*width+x)*4;for(let c=0;c<3;c++){const avg=(copy[i-4+c]+copy[i+4+c]+copy[i-stride+c]+copy[i+stride+c])/4;const diff=copy[i+c]-avg;if(Math.abs(diff)>3&&Math.abs(diff)<48)out[i+c]=Math.max(0,Math.min(255,copy[i+c]+diff*.3))}}}
  original.data.set(out);ctx.putImageData(original,0,0)}
async function toBlob(canvas){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Não foi possível exportar a imagem.')),'image/png'))}
async function aiUpscale(canvas){
  if(canvas.width>256||canvas.height>256)return tiledUpscale(canvas,aiUpscale,{cancelled:()=>cancelled,onProgress:(index,total)=>{$('irProgressText').textContent=`Ampliação por IA: bloco ${index} de ${total}…`;}});
  if(!aiEngine){
    $('irProgressText').textContent='Carregando o modelo Swin2SR local no navegador…';
    const {pipeline,env}=await import('./vendor/image-restoration-ai/transformers.bundle.mjs');
    env.allowRemoteModels=false;
    env.allowLocalModels=true;
    env.localModelPath=new URL('./vendor/image-restoration-ai/models/',import.meta.url).pathname;
    env.backends.onnx.wasm.wasmPaths=new URL('./vendor/image-restoration-ai/',import.meta.url).href;
    env.backends.onnx.wasm.numThreads=1;
    aiEngine=await pipeline('image-to-image','swin2sr',{dtype:'q8',device:'wasm'});
  }
  $('irProgressText').textContent='Reconstruindo detalhes com Swin2SR…';
  const image=await aiEngine(canvas.toDataURL('image/png'));
  const result=document.createElement('canvas');result.width=image.width;result.height=image.height;
  const ctx=result.getContext('2d');const pixels=ctx.createImageData(image.width,image.height);
  const mask=document.createElement('canvas');mask.width=image.width;mask.height=image.height;const maskCtx=mask.getContext('2d');maskCtx.imageSmoothingEnabled=true;maskCtx.drawImage(canvas,0,0,image.width,image.height);const alpha=maskCtx.getImageData(0,0,image.width,image.height).data;
  for(let i=0,j=0;i<image.data.length;i+=image.channels,j+=4){pixels.data[j]=image.data[i];pixels.data[j+1]=image.data[i+1];pixels.data[j+2]=image.data[i+2];pixels.data[j+3]=alpha[j+3]}
  ctx.putImageData(pixels,0,0);return result;
}
function showResult(file,originalUrl,resultUrl,source,result){const article=document.createElement('article');const title=document.createElement('h3');title.textContent=file.name;const compare=document.createElement('div');compare.className='ir-comparison';for(const [label,url] of [['Original',originalUrl],['Restaurada',resultUrl]]){const figure=document.createElement('figure');const img=document.createElement('img');img.src=url;img.alt=`${label}: ${file.name}`;const caption=document.createElement('figcaption');caption.textContent=label;figure.append(img,caption);compare.append(figure)}const meta=document.createElement('p');meta.className='ir-meta';meta.textContent=`${source.width} × ${source.height} → ${result.width} × ${result.height} pixels`;const link=document.createElement('a');link.className='btn btn-success';link.href=resultUrl;link.download=file.name.replace(/\.[^.]+$/,'')+'-restaurada.png';link.textContent='Baixar PNG';article.append(title,compare,meta,link);$('irResultList').append(article);$('irResults').hidden=false}
async function process(){
  if(busy||!files.length)return;
  cancelled=false;cleanup();setBusy(true);status('');
  try{
    for(let index=0;index<files.length;index++){
      if(cancelled)break;
      const file=files[index];$('irProgressText').textContent=`Imagem ${index+1} de ${files.length}: ${file.name}`;$('irBar').value=index/files.length*100;
      await pause();const bitmap=await decode(file);const settings=chooseSettings(bitmap.width,bitmap.height);
      if(settings.ai&&(bitmap.width>1024||bitmap.height>1024||settings.scale!==2)){bitmap.close();throw Error('O modo IA exige imagem de até 1024 × 1024 e saída 2×. Ajuste as opções ou use a ampliação convencional.')}
      const target=outputDimensions(bitmap.width,bitmap.height,settings.scale);
      const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);bitmap.close();
      filteredPixels(canvas,settings);
      let output=canvas;
      if(settings.ai)output=await aiUpscale(canvas);
      else if(settings.scale!==1){output=document.createElement('canvas');output.width=target.width;output.height=target.height;const ctx=output.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(canvas,0,0,target.width,target.height)}
      const blob=await toBlob(output);if(cancelled)break;
      const originalUrl=URL.createObjectURL(file),resultUrl=URL.createObjectURL(blob);urls.push(originalUrl,resultUrl);
      showResult(file,originalUrl,resultUrl,{width:canvas.width,height:canvas.height},target);await pause();
    }
    status(cancelled?'Processamento cancelado. Os resultados concluídos permanecem disponíveis.':'Imagens prontas. Compare os resultados antes de baixar.');
  }catch(error){status(error.message||'Falha ao restaurar imagem.',true)}finally{setBusy(false);$('irBar').value=100}
}
$('irInput').addEventListener('change',event=>{cleanup();const selected=[...(event.target.files||[])];if(selected.length>10||selected.some(file=>file.size>20*1048576)){files=[];status('Selecione até 10 imagens de no máximo 20 MB cada.',true)}else{files=selected;status('')}$('irFiles').replaceChildren();for(const file of files){const li=document.createElement('li');li.textContent=`${file.name} · ${(file.size/1048576).toFixed(1)} MB`;$('irFiles').append(li)}setBusy(false)});
$('irPreset').addEventListener('change',applyPreset);$('irStart').addEventListener('click',process);$('irCancel').addEventListener('click',()=>{cancelled=true;$('irProgressText').textContent='Cancelando após a imagem atual…'});applyPreset();
for(const key of keys)$('ir'+key).addEventListener('change',()=>$('irPreset').value='manual');
$('irScale').addEventListener('change',()=>$('irPreset').value='manual');
$('irAi').addEventListener('change',()=>{if($('irAi').checked)$('irScale').value='2';$('irPreset').value='manual'});
