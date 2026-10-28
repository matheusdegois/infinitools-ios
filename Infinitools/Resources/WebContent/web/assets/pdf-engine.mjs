export async function pdfEngine(file,operation,settings={}) {
    if(file.size>80*1024*1024)throw new Error('Use um PDF de até 80 MB para processamento estrutural.');
    const bytes=new Uint8Array(await file.arrayBuffer()),worker=new Worker(new URL('./pdf-engine-worker.mjs?v=3',import.meta.url),{type:'module'});
    return new Promise((resolve,reject)=>{
        const finish=(error,result)=>{clearTimeout(timer);worker.terminate();error?reject(new Error(error)):resolve(result);};
        const timer=setTimeout(()=>finish('O processamento demorou demais. Tente um PDF menor.'),180000);
        worker.onerror=()=>finish('Não foi possível carregar o motor PDF local. Atualize a página e tente novamente.');
        worker.onmessage=event=>finish(event.data.error,event.data.result);
        worker.postMessage({id:1,bytes,operation,settings},[bytes.buffer]);
    });
}
