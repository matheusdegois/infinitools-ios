// Install the listener before MuPDF's top-level WASM initialization awaits.
// A message posted during a static module import can otherwise be lost.
let corePromise;
self.onmessage=async({data:{id,bytes,operation,settings={}}})=>{
 try{
  corePromise??=Promise.all([import('./pdf-engine-core.mjs?v=2'),import('./pdf-cleanup.mjs?v=1')]);
  const [{structuralPdf,svgPages,documentLayout,editOriginalContent},{cleanupPdf}]=await corePromise;
  const result=operation==='cleanup'?cleanupPdf(bytes,settings):operation==='layout'?documentLayout(bytes,settings):operation==='svg'?svgPages(bytes):operation==='edit-original'?editOriginalContent(bytes,settings.edits):structuralPdf(bytes,operation,settings);
  const buffer=result instanceof Uint8Array?result.buffer:result?.bytes?.buffer;
  self.postMessage({id,result},buffer?[buffer]:[]);
 }catch(error){self.postMessage({id,error:error.message||'Falha ao processar PDF.'});}
};
