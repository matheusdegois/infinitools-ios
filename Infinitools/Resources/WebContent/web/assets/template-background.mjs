import {normalizeModelInput} from './image-core.mjs?v=2';

export class TemplateBackground {
 constructor(editor){this.editor=editor;this.checkbox=editor.get('allowImageBackground');this.status=editor.get('templateBackgroundStatus');this.cache=new Map();this.epoch=0;}
 source(index){return this.checkbox.checked?this.cache.get(index)?.canvas||this.editor.images[index]:this.editor.images[index];}
 reset(){this.epoch++;this.worker?.terminate();this.worker=null;this.reject?.(new Error('cancelled'));this.reject=null;this.job=null;for(const item of this.cache.values())item.canvas.width=item.canvas.height=1;this.cache.clear();this.checkbox.checked=false;this.status.textContent='O fundo original das fotos é preservado.';}
 schedule(){if(!this.checkbox.checked){this.reset();this.editor.render();return;}this.ensure().catch(error=>{if(error.message!=='cancelled'){this.checkbox.checked=false;this.status.textContent=error.message;this.editor.render();}});}
 async ensure(){
  if(!this.checkbox.checked)return;if(this.job){await this.job;return this.ensure();}
  const indices=[...new Set(this.editor.layers.filter(l=>l.type==='image').map(l=>l.image))].filter(index=>this.cache.get(index)?.source!==this.editor.images[index]);if(!indices.length)return;
  const epoch=this.epoch;
  const operation=async()=>{
   this.worker=new Worker(new URL('./background-worker.js',import.meta.url));
   try{for(const [position,index] of indices.entries()){
    if(epoch!==this.epoch)throw new Error('cancelled');this.status.textContent=`Removendo o fundo no dispositivo · imagem ${position+1} de ${indices.length}…`;
    const source=this.editor.images[index],small=document.createElement('canvas');small.width=small.height=320;const ctx=small.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,320,320);ctx.drawImage(source,0,0,320,320);const input=normalizeModelInput(ctx.getImageData(0,0,320,320).data);
    const mask=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('A remoção de fundo demorou demais. Tente uma foto menor.')),120000);this.reject=error=>{clearTimeout(timer);reject(error);};this.worker.onmessage=({data})=>{clearTimeout(timer);data.error?reject(new Error('Não foi possível recortar o fundo automaticamente.')):resolve(data.mask);};this.worker.onerror=()=>{clearTimeout(timer);reject(new Error('Não foi possível carregar a remoção de fundo local.'));};this.worker.postMessage({input},[input.buffer]);});
    if(epoch!==this.epoch)throw new Error('cancelled');
    const pixels=ctx.createImageData(320,320);for(let i=0;i<mask.length;i++){pixels.data[i*4]=pixels.data[i*4+1]=pixels.data[i*4+2]=255;pixels.data[i*4+3]=mask[i];}ctx.putImageData(pixels,0,0);
    const canvas=document.createElement('canvas'),scale=Math.min(1,Math.sqrt(4000000/(source.width*source.height)));canvas.width=Math.max(1,Math.round(source.width*scale));canvas.height=Math.max(1,Math.round(source.height*scale));const out=canvas.getContext('2d');out.drawImage(source,0,0,canvas.width,canvas.height);out.globalCompositeOperation='destination-in';out.imageSmoothingQuality='high';out.drawImage(small,0,0,canvas.width,canvas.height);small.width=small.height=1;this.cache.set(index,{source,canvas});this.editor.render();
   }this.status.textContent='Fundo recortado automaticamente. Confira cabelos, bordas e detalhes antes de baixar.';
   }finally{if(epoch===this.epoch){this.worker?.terminate();this.worker=null;this.reject=null;}}
  };
  const job=operation();this.job=job;try{await job;}finally{if(this.job===job)this.job=null;}
 }
}
