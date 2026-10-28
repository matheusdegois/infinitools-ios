export function layoutLines(page) {
    const result=[];
    for(const [blockIndex,block] of (page.data.blocks||[]).entries())if(block.type==='text'){
        const lines=[];
        for(const source of block.lines||[]){
            if(!source.text?.trim())continue;
            const line={...source,blockIndex,runs:source.runs||[{text:source.text,font:source.font||{}}]},last=lines.at(-1);
            const a=last?.runs?.[0]?.origin,b=line.runs[0]?.origin;
            if(last&&Math.abs(line.rotation||0)<1&&Math.abs(last.rotation||0)<1&&a&&b&&Math.abs(a[1]-b[1])<1&&line.bbox.x-(last.bbox.x+last.bbox.w)<(line.font?.size||12)*1.5){
                const right=Math.max(last.bbox.x+last.bbox.w,line.bbox.x+line.bbox.w),bottom=Math.max(last.bbox.y+last.bbox.h,line.bbox.y+line.bbox.h);last.bbox={x:Math.min(last.bbox.x,line.bbox.x),y:Math.min(last.bbox.y,line.bbox.y),w:right-Math.min(last.bbox.x,line.bbox.x),h:bottom-Math.min(last.bbox.y,line.bbox.y)};last.text+=line.text;last.runs.push(...line.runs);
            }else lines.push(line);
        }
        result.push(...lines);
    }
    return result;
}
export function layoutParagraphs(page){
    const paragraphs=[];
    for(const line of layoutLines(page)){
        const last=paragraphs.at(-1),box=line.bbox,size=line.font?.size||12;
        if(last&&(last.blockIndex===line.blockIndex||(Math.abs(box.x-last.bbox.x)<1&&Math.abs((last.font?.size||12)-size)<1))&&Math.abs(line.rotation||0)<1&&Math.abs(last.rotation||0)<1&&Math.abs(box.x-last.bbox.x)<size&&box.y>=last.bbox.y+last.bbox.h-2&&box.y-last.bbox.y-last.bbox.h<size){
            last.lineHeight??=box.y-last.bbox.y;last.runs.push({text:'\n',font:line.font},...line.runs);last.text+='\n'+line.text;last.bbox.w=Math.max(last.bbox.w,box.x+box.w-last.bbox.x);last.bbox.h=box.y+box.h-last.bbox.y;
        }else paragraphs.push({...line,bbox:{...box},runs:[...line.runs]});
    }
    return readingOrder(paragraphs);
}
export function readingOrder(items){
    if(items.length<2)return items;
    const cut=(axis,minGap)=>{const start=axis==='y'?'y':'x',size=axis==='y'?'h':'w',sorted=[...items].sort((a,b)=>a.bbox[start]-b.bbox[start]);let end=sorted[0].bbox[start]+sorted[0].bbox[size];for(let i=1;i<sorted.length;i++){const b=sorted[i].bbox;if(b[start]-end>minGap){const left=sorted.slice(0,i),right=sorted.slice(i);if(axis==='x'&&!left.concat(right).some(p=>p.bbox.h>(p.font?.size||12)*2))continue;return [...readingOrder(left),...readingOrder(right)];}end=Math.max(end,b[start]+b[size]);}return null;};
    return cut('y',18)||cut('x',24)||[...items].sort((a,b)=>a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x);
}
export function ocrLayout(pages){return pages.map(page=>{
    const scale=page.width/page.pixelWidth,blocks=[];
    for(const word of page.words||[]){const b=word.bbox;if(!word.text?.trim()||!b)continue;const bbox={x:b.x0*scale,y:b.y0*scale,w:(b.x1-b.x0)*scale,h:(b.y1-b.y0)*scale},size=Math.max(4,bbox.h*1.25);let block=blocks.find(x=>Math.abs(x.bbox.y-bbox.y)<size*.5);if(!block){block={type:'text',bbox:{...bbox},lines:[]};blocks.push(block);}block.lines.push({text:word.text+' ',bbox,font:{name:'Arial',size},rotation:0,runs:[{text:word.text+' ',font:{name:'Arial',size},color:'#000000',origin:[bbox.x,bbox.y+bbox.h]}]});}
    blocks.sort((a,b)=>a.bbox.y-b.bbox.y);for(const block of blocks){block.lines.sort((a,b)=>a.bbox.x-b.bbox.x);const sizes=block.lines.map(l=>l.font.size).sort((a,b)=>a-b),size=sizes[Math.floor((sizes.length-1)/2)];for(const line of block.lines){line.font.size=size;line.runs[0].font.size=size;line.runs[0].origin[1]=block.bbox.y+size;}}
    return {bounds:[0,0,page.width,page.height],data:{blocks},source:'ocr'};
});}
export function tableRows(items,tolerance=4) {
    const rows=[];
    for(const item of [...items].sort((a,b)=>a.y-b.y||a.x-b.x)){
        let row=rows.find(r=>Math.abs(r.y-item.y)<=tolerance);
        if(!row){row={y:item.y,cells:[]};rows.push(row);}row.cells.push(item);
    }
    const columns=[];
    for(const row of rows)for(const cell of row.cells)if(!columns.some(x=>Math.abs(x-cell.x)<12))columns.push(cell.x);
    columns.sort((a,b)=>a-b);
    return rows.map(row=>{
        const values=Array(columns.length).fill('');
        for(const cell of row.cells){let nearest=0;columns.forEach((x,i)=>{if(Math.abs(x-cell.x)<Math.abs(columns[nearest]-cell.x))nearest=i;});values[nearest]+=(values[nearest]?' ':'')+cell.text;}
        return values;
    });
}
export function layoutMarkdown(pages) {
    return pages.map((page,i)=>{
        const lines=layoutParagraphs(page),sizes=lines.map(l=>l.font?.size||12).sort((a,b)=>a-b),body=sizes[Math.floor(sizes.length/2)]||12;
        return `<!-- Página ${i+1} -->\n\n`+lines.map(line=>{
            const size=line.font?.size||body,text=line.text.replace(/([\\`*_{}\[\]])/g,'\\$1');
            if(size>=body*1.6)return '# '+text;
            if(size>=body*1.25)return '## '+text;
            if(/^\s*[•●]\s*/.test(text))return '- '+text.replace(/^\s*[•●]\s*/,'');
            return line.font?.weight==='bold'?`**${text}**`:text;
        }).join('\n\n');
    }).join('\n\n---\n\n');
}
export function ocrWords(data) {
    if(data.words?.length)return data.words;
    return (data.blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>(p.lines||[]).flatMap(l=>l.words||[])));
}
