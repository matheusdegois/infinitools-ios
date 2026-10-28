import {encodeScene,handlePaintReply} from '/ios/gif-fallback.mjs';
import {encodeVisualGif,GIF_SCENE_REVISION} from './gif-scene.mjs?v=4';
import {parseGif,decodeGif,gifSettings,transformGifFrame,writeGifFrame,GIFEncoder} from './gif-core.mjs?v=1';
let info=null,frames=null;
self.onmessage=async({data:m})=>{if(handlePaintReply(m))return;
 try{
  if(m.type==='load'){
   info=parseGif(new Uint8Array(m.bytes));frames=decodeGif(info,(value,total)=>self.postMessage({progress:value/total,stage:'Decodificando quadros'}));
   const summary={runtimeRevision:GIF_SCENE_REVISION,width:info.width,height:info.height,frames:info.frames.map(f=>({delay:f.delay,dispose:f.dispose})),loop:info.loop,duration:info.duration};self.postMessage({id:m.id,summary});
  }else{
   if(!info||!frames)throw new Error('Selecione um GIF primeiro.');
   if(m.type==='source'){if(!Number.isInteger(m.frame)||!frames[m.frame])throw new Error('Quadro inválido.');const rgba=frames[m.frame].rgba.slice();self.postMessage({id:m.id,rgba},[rgba.buffer]);return;}
   if(m.type==='export'&&m.scene){const result=await encodeScene(frames,info,m.scene,(value,total)=>self.postMessage({progress:value/total,stage:'Exportando quadros'}),encodeVisualGif);self.postMessage({id:m.id,...result},[result.bytes.buffer]);return;}
   const settings=gifSettings(info,m.settings);
   if(m.type==='preview'){const index=settings.selected.includes(m.frame)?m.frame:settings.selected[0],{rgba}=transformGifFrame(frames[index],info,settings);self.postMessage({id:m.id,rgba,width:settings.outputWidth,height:settings.outputHeight,frame:index,settings},[rgba.buffer]);}
   else if(m.type==='export'){
    const encoder=GIFEncoder();for(let i=0;i<settings.selected.length;i++){const {rgba}=transformGifFrame(frames[settings.selected[i]],info,settings);writeGifFrame(encoder,rgba,settings.outputWidth,settings.outputHeight,{delay:settings.delays[i],loop:settings.loop});self.postMessage({progress:(i+1)/settings.selected.length,stage:'Exportando quadros'});}
    encoder.finish();const bytes=encoder.bytes(),check=parseGif(bytes),duration=check.frames.reduce((sum,f)=>sum+f.delay,0);
    if(check.frames.length!==settings.selected.length||duration!==settings.duration||check.loop!==settings.loop)throw new Error('A verificação do GIF exportado falhou.');
    self.postMessage({id:m.id,bytes,summary:{width:check.width,height:check.height,frames:check.frames.length,duration,loop:check.loop}},[bytes.buffer]);
   }
  }
 }catch(error){self.postMessage({id:m.id,error:error.message||'Falha no processamento de GIF.'});}
};
