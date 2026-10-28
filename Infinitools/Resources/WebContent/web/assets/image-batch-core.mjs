import {defaults} from './image-core.mjs';
export const BATCH_LIMITS=Object.freeze({files:10,fileBytes:15*1024*1024,totalBytes:80*1024*1024,inputPixels:40_000_000,outputPixels:8_000_000,previewPixels:700_000});
export function recipe(preset='balanced',values={}) {
    const profiles={none:{},balanced:{contrast:10,shadows:10,highlights:-8,vibrance:12},light:{brightness:12,shadows:20},warm:{temperature:25,vibrance:8},bw:{saturation:-100,contrast:10}};
    const result={...defaults(),...(profiles[preset]||profiles.balanced)};
    for(const key of ['brightness','contrast','saturation','temperature'])if(Number.isFinite(Number(values[key])))result[key]=Math.max(-100,Math.min(100,Number(values[key])));
    result.sharpness=values.sharpness?12:0;
    return result;
}
export function batchSize(width,height,maxEdge=0,preview=false) {
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>BATCH_LIMITS.inputPixels)throw new Error('A imagem deve ter até 40 megapixels.');
    const limit=preview?BATCH_LIMITS.previewPixels:BATCH_LIMITS.outputPixels;
    const edge=preview?1000:[1200,2000].includes(Number(maxEdge))?Number(maxEdge):Infinity;
    const scale=Math.min(1,edge/Math.max(width,height),Math.sqrt(limit/(width*height)));
    return {width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale))};
}
export function validateBatch(files) {
    if(files.length>BATCH_LIMITS.files)throw new Error('Selecione até 10 imagens por lote.');
    if(files.some(file=>!file.size||file.size>BATCH_LIMITS.fileBytes))throw new Error('Cada imagem deve ter até 15 MB.');
    if(files.reduce((sum,file)=>sum+file.size,0)>BATCH_LIMITS.totalBytes)throw new Error('O lote deve ter até 80 MB no total.');
}
export function outputNames(files,extension) {
    if(!['png','jpg','webp'].includes(extension))throw new Error('Formato de saída inválido.');
    const used=new Set();
    return files.map(file=>{
        const base=file.name.replace(/\.[^.]*$/,'').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').replace(/^\.+|[. ]+$/g,'').slice(0,80)||'imagem';
        let name=`${base}_editada.${extension}`,number=2;
        while(used.has(name.toLowerCase()))name=`${base}_editada-${number++}.${extension}`;
        used.add(name.toLowerCase());return name;
    });
}
