import {GIFEncoder,quantize,applyPalette} from './vendor/image-codecs/gifenc.esm.js';
const fail=message=>{throw new Error(message||'Estrutura GIF inválida ou incompleta.');};
export function isGif(bytes){return /^GIF8[79]a$/.test(new TextDecoder().decode(bytes.subarray(0,6)));}
export function parseGif(bytes,{limits=true}={}){
 if(!isGif(bytes))fail('Arquivo GIF inválido.');if(bytes.length>80*1048576)fail('Use um GIF de até 80 MB.');
 let at=6;const take=n=>{if(at+n>bytes.length)fail();const result=bytes.subarray(at,at+n);at+=n;return result;},byte=()=>take(1)[0],short=()=>{const b=take(2);return b[0]|b[1]<<8;};
 const width=short(),height=short(),packed=byte(),backgroundIndex=byte();byte();if(!width||!height)fail();
 const table=n=>{const data=take(3*n);return Array.from({length:n},(_,i)=>[...data.subarray(i*3,i*3+3)]);};
 const globalPalette=packed&128?table(1<<((packed&7)+1)):null;
 const blocks=()=>{const parts=[];let length,total=0;while((length=byte())){parts.push(take(length));total+=length;}const data=new Uint8Array(total);let pos=0;for(const p of parts){data.set(p,pos);pos+=p.length;}return data;};
 const frames=[];let loop=null,control=null,ended=false;
 while(at<bytes.length){const type=byte();if(type===59){ended=true;break;}
  if(type===33){const label=byte();if(label===249){if(byte()!==4)fail();const bits=byte(),delay=short()*10,transparentIndex=byte();if(byte()!==0||(bits>>2&7)>3)fail();if(bits&2)fail('GIF com espera por interação do usuário não é suportado.');control={delay,dispose:bits>>2&7,transparent:!!(bits&1),transparentIndex};}
   else if(label===255){const application=new TextDecoder().decode(take(byte())),data=blocks();if(['NETSCAPE2.0','ANIMEXTS1.0'].includes(application)&&data.length>=3&&data[0]===1)loop=data[1]|data[2]<<8;}
   else if(label===1)fail('GIF com bloco de texto nativo precisa ser convertido antes da edição.');else blocks();
  }else if(type===44){const x=short(),y=short(),w=short(),h=short(),flags=byte(),palette=flags&128?table(1<<((flags&7)+1)):globalPalette,minCodeSize=byte(),data=blocks();
   if(!w||!h||x+w>width||y+h>height||!palette||minCodeSize<2||minCodeSize>8)fail();
   frames.push({x,y,width:w,height:h,interlaced:!!(flags&64),palette,minCodeSize,data,...(control||{delay:0,dispose:0,transparent:false,transparentIndex:0})});control=null;
   if(frames.length>5000)fail('GIF excede o limite de quadros para inspeção.');
  }else fail();
 }
 if(!ended||!frames.length)fail();
 if(limits&&(bytes.length>30*1048576||width*height>4000000||frames.length>300||width*height*frames.length>40000000))fail('Para editar, use GIF de até 30 MB, 4 megapixels, 300 quadros e 40 megapixels somados.');
 return {width,height,frames,loop,background:globalPalette?.[backgroundIndex]||null,duration:frames.reduce((sum,f)=>sum+f.delay,0),animated:frames.length>1};
}
export function lzwDecode(frame){
 const {data,minCodeSize,width,height}=frame,clear=1<<minCodeSize,end=clear+1,prefix=new Uint16Array(4096),suffix=new Uint8Array(4096),stack=new Uint8Array(4097),out=new Uint8Array(width*height);let bits=0,codeSize=minCodeSize+1,next=end+1,old=-1,first=0,pos=0,ended=false;
 for(let i=0;i<clear;i++)suffix[i]=i;
 const read=()=>{if(bits+codeSize>data.length*8)fail('Dados LZW incompletos.');let value=0;for(let i=0;i<codeSize;i++)value|=((data[(bits+i)>>3]>>((bits+i)&7))&1)<<i;bits+=codeSize;return value;};
 while(bits<data.length*8){let code=read();if(code===clear){codeSize=minCodeSize+1;next=end+1;old=-1;continue;}if(code===end){ended=true;break;}const initial=code;let top=0;
  if(old===-1){if(code>=clear)fail('Código LZW inválido.');if(pos>=out.length)fail();out[pos++]=suffix[code];first=suffix[code];old=code;continue;}
  if(code===next){stack[top++]=first;code=old;}else if(code>next)fail('Código LZW inválido.');
  while(code>=clear){if(code>=next||top>=4096)fail('Dicionário LZW inválido.');stack[top++]=suffix[code];code=prefix[code];}
  first=suffix[code];stack[top++]=first;
  while(top){if(pos>=out.length)fail('Dados GIF excedem o tamanho do quadro.');out[pos++]=stack[--top];}
  if(next<4096){prefix[next]=old;suffix[next++]=first;if(next===(1<<codeSize)&&codeSize<12)codeSize++;}old=initial;
 }
 if(!ended||pos!==out.length)fail('Quadro GIF incompleto.');
 if(!frame.interlaced)return out;
 const rows=new Uint8Array(out.length);let row=0;for(const [start,step] of [[0,8],[4,8],[2,4],[1,2]])for(let y=start;y<height;y+=step)rows.set(out.subarray(row++*width,row*width),y*width);return rows;
}
function fillRect(canvas,screenWidth,frame,color){for(let y=frame.y;y<frame.y+frame.height;y++)for(let x=frame.x;x<frame.x+frame.width;x++)canvas.set(color,(y*screenWidth+x)*4);}
export function decodeGif(parsed,onProgress=()=>{}){
 const {width,height,frames,background}=parsed,canvas=new Uint8ClampedArray(width*height*4),output=[],bg=background?[...background,255]:[0,0,0,0];
 if(!frames[0].transparent)fillRect(canvas,width,{x:0,y:0,width,height},bg);
 for(let i=0;i<frames.length;i++){const f=frames[i],previous=f.dispose===3?canvas.slice():null,pixels=lzwDecode(f);
  for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++){const index=pixels[y*f.width+x];if(f.transparent&&index===f.transparentIndex)continue;const color=f.palette[index];if(!color)fail('Índice de cor GIF inválido.');canvas.set([...color,255],((y+f.y)*width+x+f.x)*4);}
  output.push({rgba:canvas.slice(),delay:f.delay});
  if(f.dispose===2)fillRect(canvas,width,f,f.transparent?[0,0,0,0]:bg);if(previous)canvas.set(previous);onProgress(i+1,frames.length);
 }return output;
}
function integer(value,min,max,name){const n=Number(value);if(!Number.isInteger(n)||n<min||n>max)fail(`${name}: use um inteiro entre ${min} e ${max}.`);return n;}
export function gifSettings(info,raw={}){
 const x=integer(raw.x??0,0,info.width-1,'Recorte X'),y=integer(raw.y??0,0,info.height-1,'Recorte Y'),cropWidth=integer(raw.cropWidth??info.width,1,info.width-x,'Largura do recorte'),cropHeight=integer(raw.cropHeight??info.height,1,info.height-y,'Altura do recorte'),width=integer(raw.width??cropWidth,1,4096,'Largura'),height=integer(raw.height??cropHeight,1,4096,'Altura'),rotation=integer(raw.rotation??0,0,270,'Rotação');if(![0,90,180,270].includes(rotation))fail('Rotação inválida.');
 const first=integer(raw.first??1,1,info.frames.length,'Primeiro quadro'),last=integer(raw.last??info.frames.length,first,info.frames.length,'Último quadro'),excluded=new Set();
 for(const part of String(raw.exclude||'').split(',').map(s=>s.trim()).filter(Boolean)){const match=/^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);if(!match)fail('Excluir quadros: use números e intervalos, como 2, 5-7.');const a=integer(match[1],1,info.frames.length,'Quadro excluído'),b=integer(match[2]??a,a,info.frames.length,'Quadro excluído');for(let i=a;i<=b;i++)excluded.add(i);}
 const selected=[];for(let i=first;i<=last;i++)if(!excluded.has(i))selected.push(i-1);if(!selected.length)fail('Mantenha pelo menos um quadro.');
 if(width*height>4000000||width*height*selected.length>40000000)fail('A saída excede 4 megapixels por quadro ou 40 megapixels somados.');
 const speed=Number(raw.speed??1);if(!Number.isFinite(speed)||speed<.25||speed>4)fail('Velocidade: use entre 0,25 e 4.');
 const loop=raw.loop==null||raw.loop==='keep'?info.loop:raw.loop==='once'?null:raw.loop==='forever'?0:integer(raw.repeat,1,65535,'Repetições');
 const fontSize=integer(raw.fontSize??32,8,200,'Tamanho do texto'),textX=Number(raw.textX??50),textY=Number(raw.textY??90),text=String(raw.text||'').slice(0,300),color=String(raw.color||'#ffffff');if(!/^#[0-9a-f]{6}$/i.test(color)||![textX,textY].every(n=>Number.isFinite(n)&&n>=0&&n<=100))fail('Posição ou cor do texto inválida.');
 const delays=selected.map(i=>info.frames[i].delay===0?0:Math.max(10,Math.round(info.frames[i].delay/speed/10)*10));if(delays.some(d=>d>655350))fail('Tempo de quadro excede o limite do GIF.');
 return {x,y,cropWidth,cropHeight,width,height,rotation,selected,speed,loop,fontSize,textX,textY,text,color,delays,outputWidth:rotation%180?height:width,outputHeight:rotation%180?width:height,duration:delays.reduce((a,b)=>a+b,0)};
}
export function transformGifFrame(frame,info,s,Canvas=OffscreenCanvas){
 const source=new Canvas(info.width,info.height);source.getContext('2d').putImageData(new ImageData(frame.rgba,info.width,info.height),0,0);
 const out=new Canvas(s.outputWidth,s.outputHeight),ctx=out.getContext('2d');ctx.save();ctx.translate(out.width/2,out.height/2);ctx.rotate(s.rotation*Math.PI/180);ctx.drawImage(source,s.x,s.y,s.cropWidth,s.cropHeight,-s.width/2,-s.height/2,s.width,s.height);ctx.restore();
 if(s.text){ctx.font=`bold ${s.fontSize}px Arial`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.lineWidth=Math.max(2,s.fontSize/12);ctx.strokeStyle='#000000';ctx.fillStyle=s.color;const lines=s.text.split('\n');lines.forEach((line,i)=>{const x=out.width*s.textX/100,y=out.height*s.textY/100+(i-(lines.length-1)/2)*s.fontSize*1.2;ctx.strokeText(line,x,y);ctx.fillText(line,x,y);});}
 return {canvas:out,rgba:ctx.getImageData(0,0,out.width,out.height).data};
}
export function writeGifFrame(encoder,rgba,width,height,{delay=0,loop=null,colors=256}={}){
 // Reserve palette index zero for transparency, including opaque frames. Dispose the full screen.
 const sample=[],step=Math.max(1,Math.ceil(rgba.length/4/250000));for(let p=0;p<rgba.length;p+=step*4)if(rgba[p+3]>=128)sample.push(rgba[p],rgba[p+1],rgba[p+2],255);
 const palette=[[0,0,0],...(sample.length?quantize(new Uint8Array(sample),colors-1,{format:'rgb565'}):[[0,0,0]])],index=applyPalette(rgba,palette.slice(1),'rgb565');
 // Map against visible colors so opaque black cannot become the reserved transparent index.
 for(let p=0;p<index.length;p++)index[p]=rgba[p*4+3]<128?0:index[p]+1;
 encoder.writeFrame(index,width,height,{palette,transparent:true,transparentIndex:0,dispose:2,delay,repeat:loop==null?-1:loop});
}
export {GIFEncoder};
