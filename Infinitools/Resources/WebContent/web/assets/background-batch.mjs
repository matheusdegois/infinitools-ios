import {normalizeModelInput} from './image-core.mjs?v=2';

// One model session and one decoded image at a time; output masks preserve source alpha.
export class BackgroundBatch {
 constructor(){this.worker=new Worker(new URL('./background-worker.js',import.meta.url));this.cancelled=false;}
 terminate(){this.cancelled=true;this.worker.terminate();this.reject?.(new Error('cancelled'));this.reject=null;}
 infer(input){if(this.cancelled)return Promise.reject(new Error('cancelled'));return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.worker.terminate();reject(new Error('O recorte demorou demais. Tente uma imagem menor.'));},120000);this.reject=error=>{clearTimeout(timer);reject(error);};this.worker.onmessage=({data})=>{clearTimeout(timer);this.reject=null;data.error?reject(new Error('O motor não conseguiu remover o fundo.')):resolve(data.mask);};this.worker.onerror=()=>{clearTimeout(timer);this.reject=null;reject(new Error('Não foi possível carregar o motor de remoção de fundo.'));};this.worker.postMessage({input},[input.buffer]);});}
 async process(file){
  let bitmap,small,output;
  try{
   if(this.cancelled)throw new Error('cancelled');
   bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
   if(this.cancelled)throw new Error('cancelled');
   if(bitmap.width*bitmap.height>32000000)throw new Error('Esta imagem excede 32 megapixels.');
   small=document.createElement('canvas');small.width=small.height=320;const ctx=small.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,320,320);ctx.drawImage(bitmap,0,0,320,320);
   const mask=await this.infer(normalizeModelInput(ctx.getImageData(0,0,320,320).data));
   if(this.cancelled)throw new Error('cancelled');
   const pixels=ctx.createImageData(320,320);for(let i=0;i<mask.length;i++){pixels.data[i*4]=pixels.data[i*4+1]=pixels.data[i*4+2]=255;pixels.data[i*4+3]=mask[i];}ctx.putImageData(pixels,0,0);
   const scale=Math.min(1,Math.sqrt(4000000/(bitmap.width*bitmap.height)));output=document.createElement('canvas');output.width=Math.max(1,Math.floor(bitmap.width*scale));output.height=Math.max(1,Math.floor(bitmap.height*scale));const out=output.getContext('2d');out.drawImage(bitmap,0,0,output.width,output.height);out.globalCompositeOperation='destination-in';out.imageSmoothingQuality='high';out.drawImage(small,0,0,output.width,output.height);
   const blob=await new Promise(resolve=>output.toBlob(resolve,'image/png'));if(this.cancelled)throw new Error('cancelled');if(!blob)throw new Error('Não foi possível exportar o PNG.');return {blob,width:output.width,height:output.height,reduced:scale<1};
  }finally{bitmap?.close();if(small)small.width=small.height=1;if(output)output.width=output.height=1;}
 }
}
