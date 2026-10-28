import {recoverTrueTypeFonts} from './pdf-fonts.mjs?v=1';
import * as mupdf from './vendor/mupdf/package/dist/mupdf.js';

export const permissionBits={print:4,edit:8,copy:16,annotate:32,form:256,accessibility:512,assemble:1024,'print-hq':2048};
export function permissionMask(values={}) {
    return Object.entries(permissionBits).reduce((mask,[key,bit])=>values[key]===false?mask:mask|bit,0);
}
export function openDocument(bytes,password='') {
    const doc=new mupdf.PDFDocument(bytes);
    if(doc.needsPassword()&&!doc.authenticatePassword(password)){doc.destroy();throw new Error('Senha incorreta ou necessária para abrir este PDF.');}
    return doc;
}
function passwordOption(password) {
    if(typeof password!=='string'||password.length<4||new TextEncoder().encode(password).length>127||/[,\x00-\x1f]/.test(password))throw new Error('Use uma senha de 4 a 127 bytes, sem vírgulas ou caracteres de controle.');
    return password;
}
function assertUnsigned(doc) {
    for(let i=0;i<doc.countPages();i++){
        const page=doc.loadPage(i);
        try{for(const widget of page.getWidgets())if(widget.getFieldType()==='signature'&&!widget.getObject().get('V').isNull())throw new Error('Este PDF tem assinatura digital. Alterá-lo invalidaria a assinatura; use uma cópia sem assinatura.');}finally{page.destroy();}
    }
}
function save(doc,options) {
    const buffer=doc.saveToBuffer(options);
    try{return buffer.asUint8Array().slice();}finally{buffer.destroy();}
}
export function removePrivateData(doc,{attachments=false}={}) {
    // XRef-stream trailers may be synthesized on each getTrailer() call.
    // Remove the referenced information object too, not just that view.
    const info=doc.getTrailer().get('Info');if(info.isIndirect())doc.deleteObject(info.asIndirect());
    doc.getTrailer().delete('Info');
    for(let i=1;i<doc.countObjects();i++){
        const object=doc.newIndirect(i).resolve();
        if(object.isDictionary()||object.isStream())object.delete('Metadata');
    }
    if(attachments){
        const root=doc.getTrailer().get('Root');root.get('Names').delete('EmbeddedFiles');root.delete('AF');
        for(let i=1;i<doc.countObjects();i++){
            const object=doc.newIndirect(i).resolve();
            if(object.isDictionary()||object.isStream())object.delete('AF');
        }
        for(let i=0;i<doc.countPages();i++){
            const page=doc.loadPage(i);try{for(const annotation of page.getAnnotations())if(annotation.getType()==='FileAttachment')page.deleteAnnotation(annotation);}finally{page.destroy();}
        }
    }
}
export function structuralPdf(bytes,operation,settings={}) {
    const doc=openDocument(bytes,settings.openPassword||'');
    try{
        assertUnsigned(doc);
        const options={garbage:'deduplicate',compress:'yes','compress-fonts':'yes','compress-images':'yes',encrypt:'keep'};
        if(operation==='protect'){
            options.encrypt='aes-256';options['user-password']=passwordOption(settings.password);
            options['owner-password']=passwordOption(settings.ownerPassword||settings.password);
            if(options['owner-password']===options['user-password']&&Object.values(settings.permissions||{}).some(v=>v===false))throw new Error('Para restringir permissões, use uma senha de administração diferente da senha de abertura.');
            options.permissions=permissionMask(settings.permissions);
        }else if(operation==='unlock')options.encrypt='none';
        else if(operation==='remove-metadata')removePrivateData(doc,{attachments:!!settings.attachments});
        else if(operation!=='compress')throw new Error('Operação PDF inválida.');
        return save(doc,options);
    }finally{doc.destroy();mupdf.emptyStore();}
}
export function svgPages(bytes) {
    const doc=openDocument(bytes),pages=[];
    try{for(let i=0;i<doc.countPages();i++){
        const page=doc.loadPage(i),buffer=new mupdf.Buffer(),writer=new mupdf.DocumentWriter(buffer,'svg','text=path');
        try{const device=writer.beginPage(page.getBounds());page.run(device,mupdf.Matrix.identity);writer.endPage();writer.close();pages.push(buffer.asString());}finally{writer.destroy();buffer.destroy();page.destroy();}
    }return pages;}finally{doc.destroy();mupdf.emptyStore();}
}
export function documentLayout(bytes,settings={}) {
    const doc=openDocument(bytes),pages=[];
    try{for(let i=0;i<doc.countPages();i++){
        const page=doc.loadPage(i),text=page.toStructuredText('preserve-images,preserve-spans');
        try{
            const images=[],blocks=[];let block,line;
            const hex=color=>{const rgb=color.length===1?[color[0],color[0],color[0]]:color.length===4?[1-Math.min(1,color[0]+color[3]),1-Math.min(1,color[1]+color[3]),1-Math.min(1,color[2]+color[3])]:color;return '#'+rgb.slice(0,3).map(c=>Math.round(Math.max(0,Math.min(1,c))*255).toString(16).padStart(2,'0')).join('');};
            const bbox=r=>({x:r[0],y:r[1],w:r[2]-r[0],h:r[3]-r[1]});
            text.walk({
                beginTextBlock:rect=>{block={type:'text',bbox:bbox(rect),lines:[]};blocks.push(block);},
                beginLine:(rect,wmode,direction)=>{line={bbox:bbox(rect),direction,rotation:Math.atan2(direction[1],direction[0])*180/Math.PI,text:'',runs:[]};block.lines.push(line);},
                onChar:(c,origin,font,size,quad,color)=>{const style={name:font.getName(),size,weight:font.isBold()?'bold':'normal',style:font.isItalic()?'italic':'normal'},ink=hex(color),last=line.runs.at(-1);line.text+=c;line.font??=style;if(last&&JSON.stringify(last.font)===JSON.stringify(style)&&last.color===ink)last.text+=c;else line.runs.push({text:c,font:style,color:ink,origin});},
                onImageBlock:(rect,transform,image)=>{
                if(image.getWidth()*image.getHeight()>16000000)return;
                const pixmap=image.toPixmap();try{const png=pixmap.asPNG();let binary='';for(let at=0;at<png.length;at+=8192)binary+=String.fromCharCode(...png.subarray(at,at+8192));images.push({rect,data:'data:image/png;base64,'+btoa(binary)});}finally{pixmap.destroy();}
            }});
            pages.push({bounds:page.getBounds(),data:{...JSON.parse(text.asJSON()),blocks},html:text.asHTML(i+1),images});
        }finally{text.destroy();page.destroy();}
    }
    // Preserve drawings as a vector background while Office/HTML receives
    // editable text separately. This modifies only this in-memory copy.
    for(let i=0;i<doc.countPages();i++){
        const page=doc.loadPage(i);try{
            for(const block of pages[i].data.blocks||[])if(block.type==='text')for(const line of block.lines||[]){const b=line.bbox,annotation=page.createAnnotation('Redact');annotation.setRect([b.x,b.y,b.x+b.w,b.y+b.h]);annotation.update();}
            page.applyRedactions(false,mupdf.PDFPage.REDACT_IMAGE_NONE,mupdf.PDFPage.REDACT_LINE_ART_NONE,mupdf.PDFPage.REDACT_TEXT_REMOVE);
            const bounds=page.getBounds(),scale=Math.min(1.333,1600/Math.max(bounds[2]-bounds[0],bounds[3]-bounds[1])),pixmap=page.toPixmap(mupdf.Matrix.scale(scale,scale),mupdf.ColorSpace.DeviceRGB,false);
            try{const png=pixmap.asPNG();let binary='';for(let at=0;at<png.length;at+=8192)binary+=String.fromCharCode(...png.subarray(at,at+8192));pages[i].backgroundPng='data:image/png;base64,'+btoa(binary);}finally{pixmap.destroy();}
        }finally{page.destroy();}
    }
    const backgrounds=svgPages(save(doc,{compress:'yes'}));pages.forEach((page,index)=>page.backgroundSvg=backgrounds[index]);
    if(pages.length)pages[0].recoveredFonts=recoverTrueTypeFonts(doc,!!settings.reuseFonts);
    return pages;}finally{doc.destroy();mupdf.emptyStore();}
}
export function editOriginalContent(bytes,edits=[]) {
    const doc=openDocument(bytes);
    try{
        assertUnsigned(doc);
        const originals=[];
        for(let i=0;i<doc.countPages();i++){const page=doc.loadPage(i);try{const annotations=page.getObject().get('Annots'),copy=doc.newArray();for(let j=0;j<annotations.length;j++)copy.push(annotations.get(j));originals.push(copy);}finally{page.destroy();}}
        for(const edit of edits){
            if(!Number.isInteger(edit.page)||edit.page<0||edit.page>=doc.countPages()||!Array.isArray(edit.rect)||edit.rect.length!==4||!edit.rect.every(Number.isFinite))throw new Error('Área de edição inválida.');
            const page=doc.loadPage(edit.page);
            try{
                const redaction=page.createAnnotation('Redact');redaction.setRect(edit.rect);redaction.update();
                page.applyRedactions(false,edit.kind==='image'?mupdf.PDFPage.REDACT_IMAGE_PIXELS:mupdf.PDFPage.REDACT_IMAGE_NONE,mupdf.PDFPage.REDACT_LINE_ART_NONE,edit.kind==='image'?mupdf.PDFPage.REDACT_TEXT_NONE:mupdf.PDFPage.REDACT_TEXT_REMOVE);
                if(edit.text){
                    const rect=edit.replacementRect||edit.rect,font=new mupdf.Font('Helvetica'),lines=edit.text.split('\n');let width=0;
                    try{for(const line of lines)width=Math.max(width,[...line].reduce((n,char)=>n+font.advanceGlyph(font.encodeCharacter(char)),0));}finally{font.destroy();}
                    const vertical=Math.abs(edit.rotation||0)>45,availableWidth=vertical?rect[3]-rect[1]:rect[2]-rect[0],availableHeight=vertical?rect[2]-rect[0]:rect[3]-rect[1];
                    const size=Math.max(1,Math.min(edit.size||12,(availableWidth-2)/Math.max(.1,width),(availableHeight-1)/(lines.length*1.05)));
                    const annotation=page.createAnnotation('FreeText');annotation.setRect(rect);annotation.setContents(edit.text);annotation.setDefaultAppearance('Helv',size,edit.color||[0,0,0]);annotation.setBorderWidth(0);annotation.update();
                    if(edit.runs?.length){
                        const w=rect[2]-rect[0],h=rect[3]-rect[1],angle=(edit.rotation||0)*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),display=new mupdf.DisplayList([0,0,w,h]),device=new mupdf.DisplayListDevice(display);let at=0,x=sin<-.5?size:1,y=sin<-.5?h-1:size,remaining=edit.text,lineIndex=0;const baseX=x,baseY=y;
                        try{for(const [index,run] of edit.runs.entries()){const content=index===edit.runs.length-1?remaining:remaining.slice(0,run.text.length);remaining=remaining.slice(content.length);if(!content)continue;const serif=/times|serif/i.test(run.font?.name||''),mono=/courier|mono/i.test(run.font?.name||''),bold=run.font?.weight==='bold',italic=run.font?.style==='italic',name=serif?'Times'+(bold&&italic?'-BoldItalic':bold?'-Bold':italic?'-Italic':'-Roman'):mono?'Courier'+(bold&&italic?'-BoldOblique':bold?'-Bold':italic?'-Oblique':''):'Helvetica'+(bold&&italic?'-BoldOblique':bold?'-Bold':italic?'-Oblique':''),font=new mupdf.Font(name),text=new mupdf.Text();
                            try{const fontSize=(run.font?.size||edit.size||12)*(size/(edit.size||12)),ink=(run.color||'#000000').match(/[a-f0-9]{2}/gi)?.map(n=>parseInt(n,16)/255)||edit.color||[0,0,0];for(const [chunkIndex,chunk] of content.split('\n').entries()){if(chunkIndex){lineIndex++;x=baseX-sin*lineIndex*fontSize*1.2;y=baseY+cos*lineIndex*fontSize*1.2;}text.showString(font,[cos*fontSize,sin*fontSize,sin*fontSize,-cos*fontSize,x,y],chunk);const advance=[...chunk].reduce((sum,c)=>sum+font.advanceGlyph(font.encodeCharacter(c)),0)*fontSize;x+=advance*cos;y+=advance*sin;}device.fillText(text,mupdf.Matrix.identity,mupdf.ColorSpace.DeviceRGB,ink,1);}finally{text.destroy();font.destroy();}at+=content.length;
                        }device.close();annotation.setAppearanceFromDisplayList('N',null,mupdf.Matrix.identity,display);}finally{device.destroy();display.destroy();}
                    }
                }
                if(edit.dataUrl){const bytes=Uint8Array.from(atob(edit.dataUrl.split(',')[1]),char=>char.charCodeAt(0)),image=new mupdf.Image(bytes);try{const annotation=page.createAnnotation('Stamp');annotation.setStampImage(image);annotation.setRect(edit.replacementRect||edit.rect);annotation.update();}finally{image.destroy();}}
            }finally{page.destroy();}
        }
        // Bake only the newly generated replacement appearances. Existing
        // annotations and widgets stay interactive and are restored afterwards.
        for(let i=0;i<doc.countPages();i++){
            const page=doc.loadPage(i);try{const annotations=page.getObject().get('Annots'),temporary=doc.newArray(),old=new Set();for(let j=0;j<originals[i].length;j++)old.add(originals[i].get(j).toString());for(let j=0;j<annotations.length;j++){const object=annotations.get(j);if(!old.has(object.toString()))temporary.push(object);}page.getObject().put('Annots',temporary);}finally{page.destroy();}
        }
        doc.bake(true,false);
        for(let i=0;i<doc.countPages();i++){const page=doc.loadPage(i);try{if(originals[i].length)page.getObject().put('Annots',originals[i]);else page.getObject().delete('Annots');}finally{page.destroy();}}
        return save(doc,{garbage:'deduplicate',compress:'yes'});
    }finally{doc.destroy();mupdf.emptyStore();}
}
