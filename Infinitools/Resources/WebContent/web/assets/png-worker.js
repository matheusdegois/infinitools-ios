self.window=self;
self.onmessage=async({data})=>{
 try{
  const {processPng}=await import('./png-optimizer.mjs?v=3');
  if(data.options.mode==='colors')importScripts('./vendor/png/pako/package/dist/pako.min.js','./vendor/png/upng/package/UPNG.js');
  const result=await processPng(new Uint8Array(data.bytes),data.options,{UPNG:self.UPNG,pako:self.pako});
  self.postMessage(result,[result.bytes.buffer]);
 }catch(error){self.postMessage({error:error.message||'Falha ao otimizar PNG.'});}
};
