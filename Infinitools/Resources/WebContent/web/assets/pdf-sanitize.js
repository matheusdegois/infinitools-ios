import * as pdfjs from './vendor/pdfjs/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc='./assets/vendor/pdfjs/pdf.worker.min.mjs';
const file=document.querySelector('#sanitizeFile'),start=document.querySelector('#sanitizeStart'),cancel=document.querySelector('#sanitizeCancel'),link=document.querySelector('#sanitizeDownload'),status=document.querySelector('#sanitizeStatus'),progress=document.querySelector('#sanitizeProgress');
let revision=0,task=null,render=null,url=null;
function clearDownload(){if(url)URL.revokeObjectURL(url);url=null;link.hidden=true;link.removeAttribute('href');}
function abort(){revision++;render?.cancel();task?.destroy();task=null;render=null;}
const drop=document.querySelector('#sanitizeDrop'),selection=document.querySelector('#sanitizeSelection'),remove=document.querySelector('#sanitizeRemove');
file.addEventListener('change',()=>{abort();clearDownload();start.disabled=!file.files.length;status.textContent='';const selected=file.files[0];selection.hidden=!selected;document.querySelector('#sanitizeName').textContent=selected?.name||'';document.querySelector('#sanitizeSize').textContent=selected?`${(selected.size/1024).toLocaleString('pt-BR',{maximumFractionDigits:1})} KB`:'';});
remove.addEventListener('click',()=>{if(file.disabled)return;file.value='';file.dispatchEvent(new Event('change'));});
for(const type of ['dragenter','dragover'])drop.addEventListener(type,event=>{event.preventDefault();if(!file.disabled)drop.classList.add('dragover');});
for(const type of ['dragleave','drop'])drop.addEventListener(type,event=>{event.preventDefault();drop.classList.remove('dragover');});
drop.addEventListener('drop',event=>{if(file.disabled)return;const files=event.dataTransfer?.files;if(!files?.length)return;if(files.length>1){status.textContent='Selecione um PDF por vez.';return;}file.files=files;file.dispatchEvent(new Event('change'));});
cancel.addEventListener('click',()=>{abort();status.textContent='Cancelado. Nenhum arquivo foi gerado.';busy(false);});
function busy(value){file.disabled=value;remove.disabled=value;drop.setAttribute('aria-disabled',String(value));start.disabled=value||!file.files.length;cancel.hidden=!value;progress.hidden=!value;}
start.addEventListener('click',async()=>{
 const selected=file.files[0];if(!selected)return;abort();const id=revision;clearDownload();busy(true);progress.value=0;status.textContent='Lendo PDF…';let document=null,canvas=null,passwordRequired=false;
 const check=()=>{if(id!==revision)throw new DOMException('Cancelado','AbortError');};
 try{
  if(selected.size>30*1024*1024)throw new Error('Selecione um PDF de até 30 MB.');
  const bytes=new Uint8Array(await selected.arrayBuffer());check();
  if(!new TextDecoder().decode(bytes.subarray(0,1024)).includes('%PDF-'))throw new Error('O arquivo não é um PDF válido.');
  task=pdfjs.getDocument({data:bytes,isEvalSupported:false,stopAtErrors:true,enableXfa:false});
  task.onPassword=()=>{passwordRequired=true;task.destroy();};
  document=await task.promise;check();if(document.isPureXfa)throw new Error('Formulários XFA não são aceitos.');
  if(document.numPages>50)throw new Error('Selecione um PDF de até 50 páginas.');
  const output=await PDFLib.PDFDocument.create();output.context.trailerInfo.Info=undefined;
  progress.max=document.numPages;canvas=window.document.createElement('canvas');let total=0;
  for(let n=1;n<=document.numPages;n++){
   check();status.textContent=`Preparando página ${n} de ${document.numPages}…`;
   const page=await document.getPage(n);check();const base=page.getViewport({scale:1});
   if(!Number.isFinite(base.width*base.height)||base.width<=0||base.height<=0)throw new Error('Uma página possui dimensões inválidas.');
   const scale=Math.min(2,Math.sqrt(8000000/(base.width*base.height)),16000/Math.max(base.width,base.height));const viewport=page.getViewport({scale});
   canvas.width=Math.max(1,Math.floor(viewport.width));canvas.height=Math.max(1,Math.floor(viewport.height));
   render=page.render({canvasContext:canvas.getContext('2d'),viewport,background:'white',annotationMode:pdfjs.AnnotationMode.DISABLE});await render.promise;render=null;check();
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.94));check();if(!blob)throw new Error('Não foi possível gerar a imagem da página.');total+=blob.size;
   if(total>100*1024*1024)throw new Error('O resultado excede 100 MB. Divida o PDF em partes menores.');
   const image=await output.embedJpg(await blob.arrayBuffer());check();output.addPage([base.width,base.height]).drawImage(image,{x:0,y:0,width:base.width,height:base.height});page.cleanup();canvas.width=canvas.height=1;progress.value=n;
   await new Promise(resolve=>setTimeout(resolve,0));
  }
  const result=await output.save();check();url=URL.createObjectURL(new Blob([result],{type:'application/pdf'}));link.href=url;link.hidden=false;status.textContent='PDF limpo pronto. Baixe e confira todas as páginas antes de compartilhar.';
 }catch(error){if(id===revision)status.textContent=passwordRequired||error.name==='PasswordException'?'PDF protegido por senha. Desbloqueie uma cópia antes de continuar.':(error.message||'Não foi possível ler este PDF.');}
 finally{if(canvas)canvas.width=canvas.height=1;await document?.destroy();if(id===revision){task=null;busy(false);}}
});
window.addEventListener('pagehide',()=>{abort();clearDownload();});
