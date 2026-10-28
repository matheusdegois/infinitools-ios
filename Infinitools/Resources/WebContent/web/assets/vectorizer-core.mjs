// The tracer receives bounded raster data only. SVG is serialized from numeric
// geometry here; filenames and imported markup never enter the output document.
export const LIMITS = Object.freeze({bytes:15*1024*1024, originalPixels:40_000_000, tracePixels:720_000, paths:12_000, segments:160_000, svgBytes:8*1024*1024});
export function traceSize(width, height, detail='normal') {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width<1 || height<1 || width*height>LIMITS.originalPixels) throw new Error('A imagem deve ter até 40 megapixels.');
    const edge = detail==='low'?600:detail==='high'?1200:900;
    const scale = Math.min(1, edge/Math.max(width,height), Math.sqrt(LIMITS.tracePixels/(width*height)));
    return {width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale))};
}

export function identifyRaster(bytes) {
    const b=bytes;
    if(b.length>=24 && b[0]===137 && b[1]===80 && b[2]===78 && b[3]===71 && b[4]===13 && b[5]===10 && b[6]===26 && b[7]===10) {
        const v=new DataView(b.buffer,b.byteOffset,b.byteLength);
        return {mime:'image/png',width:v.getUint32(16),height:v.getUint32(20)};
    }
    if(b.length>=12 && String.fromCharCode(...b.slice(0,4))==='RIFF' && String.fromCharCode(...b.slice(8,12))==='WEBP') {
        const type=String.fromCharCode(...b.slice(12,16));
        if(type==='VP8X' && b.length>=30) return {mime:'image/webp',width:1+b[24]+(b[25]<<8)+(b[26]<<16),height:1+b[27]+(b[28]<<8)+(b[29]<<16)};
        if(type==='VP8L' && b.length>=25 && b[20]===47) return {mime:'image/webp',width:1+b[21]+((b[22]&63)<<8),height:1+(b[22]>>6)+(b[23]<<2)+((b[24]&15)<<10)};
        if(type==='VP8 ' && b.length>=30 && b[23]===157 && b[24]===1 && b[25]===42) return {mime:'image/webp',width:(b[26]+(b[27]<<8))&16383,height:(b[28]+(b[29]<<8))&16383};
        return {mime:'image/webp'};
    }
    if(b.length>=4 && b[0]===255 && b[1]===216) {
        let i=2;
        while(i+8<b.length) {
            if(b[i++]!==255) break;
            while(b[i]===255) i++;
            const marker=b[i++];
            if(marker===218 || marker===217) break;
            if(marker===1 || marker>=208 && marker<=215) continue;
            const length=(b[i]<<8)|b[i+1];
            if(length<2 || i+length>b.length) break;
            if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) return {mime:'image/jpeg',height:(b[i+3]<<8)|b[i+4],width:(b[i+5]<<8)|b[i+6]};
            i+=length;
        }
        return {mime:'image/jpeg'};
    }
    throw new Error('Selecione uma imagem PNG, JPG ou WebP válida.');
}

// Remove only a near-uniform background reachable from image borders.
export function removeBorderBackground(data,width,height) {
    const corners=[0,(width-1)*4,(width*(height-1))*4,(width*height-1)*4];
    let best=corners[0],bestScore=-1;
    const similar=(a,b)=>Math.max(Math.abs(data[a]-data[b]),Math.abs(data[a+1]-data[b+1]),Math.abs(data[a+2]-data[b+2]))<=28;
    for(const p of corners) {
        if(data[p+3]<128) continue;
        const score=corners.filter(q=>data[q+3]>=128&&similar(p,q)).length;
        if(score>bestScore){best=p;bestScore=score;}
    }
    if(bestScore<2) return false;
    const rgb=[data[best],data[best+1],data[best+2]],count=width*height;
    const visited=new Uint8Array(count),queue=new Uint32Array(count);let head=0,tail=0;
    const add=(p)=>{if(visited[p])return;visited[p]=1;const j=p*4;if(data[j+3]<128||Math.max(Math.abs(data[j]-rgb[0]),Math.abs(data[j+1]-rgb[1]),Math.abs(data[j+2]-rgb[2]))<=28)queue[tail++]=p;};
    for(let x=0;x<width;x++){add(x);add((height-1)*width+x);}
    for(let y=0;y<height;y++){add(y*width);add(y*width+width-1);}
    while(head<tail){const p=queue[head++];data[p*4+3]=0;const x=p%width;if(x>0)add(p-1);if(x<width-1)add(p+1);if(p>=width)add(p-width);if(p<count-width)add(p+width);}
    return true;
}

function paletteFor(data,numberofcolors) {
    const bins=new Map();let transparent=false;
    for(let i=0;i<data.length;i+=4) {
        if(data[i+3]<128){data[i]=data[i+1]=data[i+2]=data[i+3]=0;transparent=true;continue;}
        data[i+3]=255;
        const key=(data[i]>>3)<<10|(data[i+1]>>3)<<5|(data[i+2]>>3);
        let bin=bins.get(key);if(!bin){bin={r:0,g:0,b:0,n:0};bins.set(key,bin);}
        bin.r+=data[i];bin.g+=data[i+1];bin.b+=data[i+2];bin.n++;
    }
    const candidates=[...bins.values()].map(c=>({r:Math.round(c.r/c.n),g:Math.round(c.g/c.n),b:Math.round(c.b/c.n),a:255,n:c.n})).sort((a,b)=>b.n-a.n);
    const palette=transparent?[{r:0,g:0,b:0,a:0}]:[];
    const chosen=[];
    while(chosen.length<numberofcolors && candidates.length) {
        let selected=0;
        if(chosen.length){let best=-1;for(let i=0;i<candidates.length;i++){const c=candidates[i];const distance=Math.min(...chosen.map(p=>(p.r-c.r)**2+(p.g-c.g)**2+(p.b-c.b)**2));const score=distance*Math.sqrt(c.n);if(score>best){best=score;selected=i;}}}
        chosen.push(candidates.splice(selected,1)[0]);
    }
    return palette.concat(chosen.map(({r,g,b,a})=>({r,g,b,a})));
}

function pathData(path) {
    if(!path.segments.length)return '';
    const num=value=>{if(!Number.isFinite(value))throw new Error('Não foi possível traçar esta imagem.');return +value.toFixed(2);};
    const segments=path.segments;
    let d=`M ${num(segments[0].x1)} ${num(segments[0].y1)}`;
    for(const s of segments){
        if(s.type==='L')d+=` L ${num(s.x2)} ${num(s.y2)}`;
        else if(s.type==='Q')d+=` Q ${num(s.x2)} ${num(s.y2)} ${num(s.x3)} ${num(s.y3)}`;
        else throw new Error('Traçado inválido.');
    }
    return d+' Z';
}

export function vectorize(tracer, image, settings={}) {
    const {width,height,data}=image;
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>LIMITS.tracePixels||!(data instanceof Uint8ClampedArray)||data.length!==width*height*4)throw new Error('Imagem grande demais para o traçado.');
    const originalWidth=settings.originalWidth??width,originalHeight=settings.originalHeight??height;
    traceSize(originalWidth,originalHeight);
    const preset=['logo','drawing','photo'].includes(settings.preset)?settings.preset:'logo';
    const colors=[4,8,16,24].includes(Number(settings.colors))?Number(settings.colors):8;
    const detail=['low','normal','high'].includes(settings.detail)?settings.detail:'normal';
    const pixels=new Uint8ClampedArray(data);
    const backgroundRemoved=settings.removeBackground?removeBorderBackground(pixels,width,height):false;
    let palette;
    if(preset==='drawing') {
        let hasAlpha=false;
        for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]<128){pixels[i]=pixels[i+1]=pixels[i+2]=pixels[i+3]=0;hasAlpha=true;}else{const value=.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2]<180?0:255;pixels[i]=pixels[i+1]=pixels[i+2]=value;pixels[i+3]=255;}}
        palette=[{r:0,g:0,b:0,a:255},{r:255,g:255,b:255,a:255}];if(hasAlpha)palette.unshift({r:0,g:0,b:0,a:0});
    }else palette=paletteFor(pixels,colors);
    if(!palette.some(c=>c.a))throw new Error('A imagem está totalmente transparente. Desative a remoção de fundo ou escolha outra imagem.');
    const options={pal:palette,colorquantcycles:1,mincolorratio:0,layering:0,pathomit:detail==='low'?20:detail==='high'?2:8,ltres:detail==='high'?.4:detail==='low'?2:1,qtres:detail==='high'?.4:detail==='low'?2:1,rightangleenhance:preset==='logo',blurradius:preset==='photo'?1:0,blurdelta:20};
    const traced=tracer.imagedataToTracedata({width,height,data:pixels},options);
    let paths=0,segments=0,body='';const usedColors=new Set();
    for(let l=0;l<traced.layers.length;l++) {
        const color=traced.palette[l];if(color.a<128)continue;
        const layer=traced.layers[l];
        for(const path of layer) {
            if(path.isholepath||!path.segments.length)continue;
            paths++;usedColors.add(l);segments+=path.segments.length;
            for(const hole of path.holechildren)segments+=layer[hole].segments.length;
            if(paths>LIMITS.paths||segments>LIMITS.segments)throw new Error('A imagem gerou detalhes demais. Use menos cores ou menos detalhes.');
            const d=pathData(path)+path.holechildren.map(h=>' '+pathData(layer[h])).join('');
            body+=`<path fill="rgb(${color.r},${color.g},${color.b})" fill-rule="evenodd" d="${d}"/>`;
            if(body.length>LIMITS.svgBytes)throw new Error('O SVG ficou grande demais. Use menos cores ou menos detalhes.');
        }
    }
    if(!paths)throw new Error('Nenhum contorno encontrado. Tente aumentar os detalhes ou desativar a remoção de fundo.');
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${originalWidth}" height="${originalHeight}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
    return {svg,paths,colors:usedColors.size,width,height,backgroundRemoved};
}
