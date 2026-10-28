const signature=[137,80,78,71,13,10,26,10],metadata=new Set(['tEXt','iTXt','zTXt','eXIf']);
const view=d=>new DataView(d.buffer,d.byteOffset,d.byteLength);
export function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
export function pngChunk(type,data){const out=new Uint8Array(data.length+12),v=view(out);v.setUint32(0,data.length);out.set(new TextEncoder().encode(type),4);out.set(data,8);v.setUint32(out.length-4,crc32(out.subarray(4,out.length-4)));return out;}
async function join(parts){return new Uint8Array(await new Blob(parts).arrayBuffer());}
export function parsePng(bytes){
 if(bytes.length>80*1024*1024)throw new Error('Use um PNG de até 80 MB.');
 if(!signature.every((b,i)=>bytes[i]===b))throw new Error('Arquivo PNG inválido.');
 const chunks=[];let at=8;
 while(at+12<=bytes.length){const length=view(bytes.subarray(at,at+4)).getUint32(0);if(at+12+length>bytes.length)throw new Error('Estrutura PNG inválida.');const type=new TextDecoder().decode(bytes.subarray(at+4,at+8)),data=bytes.subarray(at+8,at+8+length);if(crc32(bytes.subarray(at+4,at+8+length))!==view(bytes.subarray(at+8+length,at+12+length)).getUint32(0))throw new Error('PNG com checksum inválido.');chunks.push({type,data});at+=12+length;if(type==='IEND')break;}
 if(chunks[0]?.type!=='IHDR'||chunks[0].data.length!==13||chunks.at(-1)?.type!=='IEND'||chunks.at(-1).data.length||at!==bytes.length)throw new Error('PNG incompleto ou com dados após IEND.');
 const h=view(chunks[0].data),w=h.getUint32(0),height=h.getUint32(4),depth=h.getUint8(8),color=h.getUint8(9);
 if(!w||!height||w*height>16000000)throw new Error('Use um PNG de até 16 megapixels.');
 if(!({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]}[color]?.includes(depth))||h.getUint8(10)||h.getUint8(11)||h.getUint8(12)>1)throw new Error('Cabeçalho PNG inválido.');
 if(chunks.filter(c=>c.type==='IHDR').length!==1||!chunks.some(c=>c.type==='IDAT'))throw new Error('Estrutura PNG incompleta.');
 const known=new Set(['IHDR','PLTE','IDAT','IEND']);if(chunks.some(c=>c.type[0]===c.type[0].toUpperCase()&&!known.has(c.type)))throw new Error('PNG contém um bloco crítico não suportado.');
 inspectChunks(chunks);return chunks;
}
function inspectChunks(chunks){
 const h=view(chunks[0].data),width=h.getUint32(0),height=h.getUint32(4),actl=chunks.filter(c=>c.type==='acTL'),frames=[],main={chunks:[],width,height},groups=[main];let current=null,seenIDAT=false,endedIDAT=false,sequence=0;
 if(actl.length>1||actl[0]&&(actl[0].data.length!==8||chunks.indexOf(actl[0])>chunks.findIndex(c=>c.type==='IDAT')))throw new Error('Controle APNG inválido.');
 for(const c of chunks){
  if(c.type==='fcTL'){
   if(!actl.length||c.data.length!==26||view(c.data).getUint32(0)!==sequence++)throw new Error('Sequência APNG inválida.');
   if(current&&!current.chunks.length)throw new Error('Quadro APNG sem dados.');
   const v=view(c.data),f={control:c,width:v.getUint32(4),height:v.getUint32(8),x:v.getUint32(12),y:v.getUint32(16),delayNum:v.getUint16(20),delayDen:v.getUint16(22),dispose:c.data[24],blend:c.data[25],chunks:[]};
   if(!f.width||!f.height||f.x+f.width>width||f.y+f.height>height||f.dispose>2||f.blend>1)throw new Error('Dimensões ou operação APNG inválidas.');
   if(!seenIDAT){if(frames.length||f.width!==width||f.height!==height||f.x||f.y)throw new Error('Primeiro quadro APNG inválido.');f.chunks=main.chunks;}else groups.push(f);
   frames.push(f);current=f;
  }else if(c.type==='IDAT'){if(endedIDAT)throw new Error('Blocos IDAT fora de ordem.');main.chunks.push(c);seenIDAT=true;}
  else if(c.type==='fdAT'){if(!seenIDAT||!current||current.chunks===main.chunks||c.data.length<4||view(c.data).getUint32(0)!==sequence++)throw new Error('Dados APNG fora de ordem.');current.chunks.push(c);}
  if(seenIDAT&&c.type!=='IDAT')endedIDAT=true;
 }
 if(current&&!current.chunks.length)throw new Error('Quadro APNG sem dados.');
 if(actl.length&&(!frames.length||frames.length!==view(actl[0].data).getUint32(0)||frames.length>100||width*height*(frames.length+1)>64000000))throw new Error('Use APNG com até 100 quadros e 64 megapixels somados.');
 if(!actl.length&&chunks.some(c=>['fcTL','fdAT'].includes(c.type)))throw new Error('APNG sem controle de animação.');
 return {width,height,depth:h.getUint8(8),color:h.getUint8(9),interlace:h.getUint8(12),animated:!!actl.length,frames,groups,loops:actl.length?view(actl[0].data).getUint32(4):0,poster:!!frames.length&&frames[0].chunks!==main.chunks};
}
export function inspectPng(bytes){return inspectChunks(parsePng(bytes));}
function expectedSize(info,w,h){const bpp=({0:1,2:3,3:1,4:2,6:4}[info.color])*info.depth,row=(w,h)=>h*(1+Math.ceil(w*bpp/8));if(!info.interlace)return row(w,h);return [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]].reduce((sum,[x,y,dx,dy])=>{const pw=Math.max(0,Math.ceil((w-x)/dx)),ph=Math.max(0,Math.ceil((h-y)/dy));return sum+(pw&&ph?row(pw,ph):0);},0);}
async function inflate(bytes,limit){const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader(),parts=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;if((size+=value.length)>limit)throw new Error('Dados PNG excedem as dimensões declaradas.');parts.push(value);}}finally{await reader.cancel();}if(size!==limit)throw new Error('Dados PNG incompletos.');return join(parts);}
async function deflate(bytes){return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());}
async function recompress(bytes,removeMetadata){
 const chunks=parsePng(bytes),info=inspectChunks(chunks),replacements=new Map();
 // Recompress each stream without changing scanlines, frame controls or sequence numbers.
 for(const g of info.groups){const data=await join(g.chunks.map(c=>c.type==='fdAT'?c.data.subarray(4):c.data)),raw=await inflate(data,expectedSize(info,g.width,g.height)),compressed=await deflate(raw);
  if(compressed.length<data.length&&compressed.length>=g.chunks.length){let at=0;for(let i=0;i<g.chunks.length;i++){const c=g.chunks[i],left=g.chunks.length-i-1,take=i===g.chunks.length-1?compressed.length-at:Math.min(c.data.length-(c.type==='fdAT'?4:0),compressed.length-at-left),part=compressed.subarray(at,at+take);at+=take;replacements.set(c,c.type==='fdAT'?await join([c.data.subarray(0,4),part]):part);}}
 }
 return {bytes:await join([new Uint8Array(signature),...chunks.filter(c=>!removeMetadata||!metadata.has(c.type)).map(c=>pngChunk(c.type,replacements.get(c)||c.data))]),info,chunks};
}
export async function optimizePng(bytes,removeMetadata=true){return (await recompress(bytes,removeMetadata)).bytes;}
export function qualityColors(q){return Math.round(16+240*Math.max(0,Math.min(100,Number(q)||0))/100);}
async function decodedGroup(group,chunks,UPNG){
 const header=new Uint8Array(chunks[0].data),v=view(header);v.setUint32(0,group.width);v.setUint32(4,group.height);
 // Decode each rectangle separately, retaining raw frame alpha and APNG compositing semantics.
 const data=await join(group.chunks.map(c=>c.type==='fdAT'?c.data.subarray(4):c.data));
 const png=await join([new Uint8Array(signature),pngChunk('IHDR',header),...chunks.filter(c=>['PLTE','tRNS'].includes(c.type)).map(c=>pngChunk(c.type,c.data)),pngChunk('IDAT',data),pngChunk('IEND',new Uint8Array())]);
 return UPNG.toRGBA8(UPNG.decode(png.buffer))[0];
}
function filteredRgba(rgba,w,h){const stride=w*4,out=new Uint8Array((stride+1)*h);for(let y=0;y<h;y++){let best=null,score=Infinity,filter=0;for(let type=0;type<5;type++){const row=new Uint8Array(stride);let cost=0;for(let x=0;x<stride;x++){const p=y*stride+x,a=x>=4?rgba[p-4]:0,b=y?rgba[p-stride]:0,c=y&&x>=4?rgba[p-stride-4]:0,pa=a+b-c,paeth=Math.abs(pa-a)<=Math.abs(pa-b)&&Math.abs(pa-a)<=Math.abs(pa-c)?a:Math.abs(pa-b)<=Math.abs(pa-c)?b:c,predict=[0,a,b,(a+b)>>>1,paeth][type],v=(rgba[p]-predict)&255;row[x]=v;cost+=Math.min(v,256-v);}if(cost<score){score=cost;best=row;filter=type;}}const pos=y*(stride+1);out[pos]=filter;out.set(best,pos+1);}return out;}
async function encodeReduced(frames,poster,info,chunks,strip,pako){
 const header=new Uint8Array(chunks[0].data);header[8]=8;header[9]=6;header[12]=0;
 // Retain color profiles and physical dimensions; discard unknown unsafe-to-copy ancillary data.
 const retained=chunks.filter(c=>!['IHDR','PLTE','tRNS','IDAT','IEND','acTL','fcTL','fdAT','sBIT','hIST','bKGD'].includes(c.type)&&(!strip||!metadata.has(c.type))&&(c.type[3]===c.type[3].toLowerCase()||['iCCP','sRGB','gAMA','cHRM','cICP','pHYs'].includes(c.type)));
 const parts=[new Uint8Array(signature),pngChunk('IHDR',header),...retained.map(c=>pngChunk(c.type,c.data))];let seq=0;
 const compressed=(rgba,w=info.width,h=info.height)=>pako.deflate(filteredRgba(new Uint8Array(rgba),w,h),{level:9});
 if(info.animated){const c=new Uint8Array(8);view(c).setUint32(0,frames.length);view(c).setUint32(4,info.loops);parts.push(pngChunk('acTL',c));}
 if(poster)parts.push(pngChunk('IDAT',compressed(poster)));
 for(let i=0;i<frames.length;i++){
  if(info.animated){const c=new Uint8Array(info.frames[i].control.data);view(c).setUint32(0,seq++);parts.push(pngChunk('fcTL',c));}
  const f=info.animated?info.frames[i]:info,data=compressed(frames[i],f.width,f.height);if(!i&&!poster)parts.push(pngChunk('IDAT',data));else{const prefix=new Uint8Array(4);view(prefix).setUint32(0,seq++);parts.push(pngChunk('fdAT',await join([prefix,data])));}
 }parts.push(pngChunk('IEND',new Uint8Array()));return join(parts);
}
export async function processPng(bytes,options={},libraries={}){
 const lossless=await recompress(bytes,options.stripMetadata!==false),{info,chunks}=lossless,summary={width:info.width,height:info.height,animated:info.animated,frames:info.frames.length||1,loops:info.loops,colors:qualityColors(options.quality??80),reduced:false,note:''};
 if(options.mode!=='colors')return {bytes:lossless.bytes,summary};
 if(info.depth===16){summary.note='PNG de 16 bits: aplicado apenas o modo sem alteração dos pixels.';return {bytes:lossless.bytes,summary};}
 if(info.width*info.height*((info.frames.length||1)+(info.poster?1:0))>8000000)throw new Error('Para redução de cores, use até 8 megapixels somados entre os quadros. O modo sem alteração dos pixels aceita imagens maiores.');
 const {UPNG,pako}=libraries;if(!UPNG||!pako)throw new Error('Biblioteca de redução de cores indisponível.');
 const all=[];
 for(const group of info.groups)all.push(await decodedGroup(group,chunks,UPNG));
 const quantized=UPNG.quantize(all,summary.colors,false).bufs,poster=info.poster;
 // Restore exact per-pixel alpha after quantization, including partial transparency.
 for(let f=0;f<all.length;f++){const a=new Uint8Array(all[f]),b=new Uint8Array(quantized[f]);for(let i=3;i<a.length;i+=4)b[i]=a[i];}
 const reduced=await encodeReduced(poster?quantized.slice(1):quantized,poster?quantized[0]:null,info,chunks,options.stripMetadata!==false,pako);
 if(options.keepSmaller!==false&&reduced.length>=lossless.bytes.length){summary.note='A redução de cores não diminuiu o arquivo; mantido o resultado sem alteração dos pixels.';return {bytes:lossless.bytes,summary};}
 summary.reduced=true;return {bytes:reduced,summary};
}
