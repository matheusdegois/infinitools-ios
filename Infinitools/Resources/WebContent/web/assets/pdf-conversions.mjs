import {layoutLines,layoutParagraphs,layoutMarkdown,tableRows} from './pdf-layout.mjs?v=2';
import {editableGeometry} from './pdf-geometry.mjs?v=1';
const fontName=name=>(name||'Arial').replace(/^[A-Z]{6}\+/,'').replace(/^Helvetica.*$/,'Arial').replace(/^Times.*$/,'Times New Roman').replace(/^Courier.*$/,'Courier New');
const runsOf=line=>line.runs||[{text:line.text,font:line.font||{}}];
function svgData(svg){return 'data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(svg)));}

export function layoutHtml(pages,title='Documento') {
    const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const fontCss=pages.flatMap(p=>p.recoveredFonts||[]).map(font=>`@font-face{font-family:'${font.name}';src:url('${font.data}') format('truetype')}`).join('');
    return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${escape(title)}</title><link rel="icon" href="${new URL('./images/infinitools-favicon.ico',import.meta.url).href}"><link rel="apple-touch-icon" href="${new URL('./images/infinitools-icon-180.png',import.meta.url).href}"><style>${fontCss}body{background:#eee;margin:20px}body>div{position:relative;background:white;margin:20px auto;overflow:hidden;box-shadow:0 1px 4px #aaa}p{position:absolute;white-space:pre;margin:0}img{position:absolute} @media print{body{background:white;margin:0}body>div{break-after:page;margin:0;box-shadow:none}}</style><body>${pages.map(p=>p.html.replace(/(<div[^>]*>)/,`$1<img alt="Elementos gráficos" style="left:0;top:0;width:100%;height:100%" src="${svgData(p.backgroundSvg)}">`)).join('\n')}</body></html>`;
}
// Strengthen neutral gray labels without changing colored text or white knockout text.
export function readableTextColor(color='#000000',enhance=false) {
    const hex=/^#[0-9a-f]{6}$/i.test(color)?color.slice(1):'000000';
    const rgb=hex.match(/../g).map(v=>parseInt(v,16));
    return enhance && Math.max(...rgb)-Math.min(...rgb)<=4 && Math.min(...rgb)>51 && Math.max(...rgb)<224 ? '333333' : hex;
}
export async function wordFromLayout(pages,d,{enhanceContrast=false}={}) {
    const none={style:d.BorderStyle.NONE,size:0,color:'FFFFFF'},borders={top:none,bottom:none,left:none,right:none,insideHorizontal:none,insideVertical:none};
    const sections=pages.map(page=>{
        const [x0,y0,x1,y1]=page.bounds,children=[];
        for(const line of layoutParagraphs(page)){
            const box=line.bbox,size=line.font?.size||12;
            children.push(new d.Table({
                width:{size:Math.max(100,box.w*20+100),type:d.WidthType.DXA},columnWidths:[Math.max(100,box.w*20+100)],borders,margins:{top:0,bottom:0,left:0,right:0},
                float:{horizontalAnchor:d.TableAnchorType.PAGE,verticalAnchor:d.TableAnchorType.PAGE,absoluteHorizontalPosition:Math.max(0,(box.x-x0)*20),absoluteVerticalPosition:Math.max(0,(box.y-y0+(page.source!=='ocr'&&Math.abs(line.rotation||0)<45?size*.265-Math.max(0,(line.lineHeight||size)-size)*.8:0))*20),overlap:d.OverlapType.OVERLAP},
                rows:[new d.TableRow({height:Math.abs(line.rotation||0)>45?{value:Math.round(box.h*20+80),rule:d.HeightRule.EXACT}:undefined,children:[new d.TableCell({textDirection:Math.abs(line.rotation||0)>45?(line.rotation<0?'btLr':'tbRl'):undefined,borders,margins:{top:0,bottom:0,left:0,right:0},children:[new d.Paragraph({spacing:{before:0,after:0,line:Math.round((line.lineHeight||size)*20),lineRule:d.LineRuleType.EXACT},children:[...runsOf(line).flatMap(run=>run.text.split('\n').flatMap((text,index)=>[...(index?[new d.TextRun({break:1})]:[]),new d.TextRun({text,font:fontName(run.font?.name),size:Math.round((run.font?.size||size)*2),bold:run.font?.weight==='bold',italics:run.font?.style==='italic',color:readableTextColor(run.color,enhanceContrast)})]))]})]})]})]
            }));
        }
        // The bundled docx version supports PNG only. Render the graphical
        // background, keeping every text line above it as editable Word content.
        if(page.backgroundPng)children.push(new d.Paragraph({children:[new d.ImageRun({data:Uint8Array.from(atob(page.backgroundPng.split(',')[1]),c=>c.charCodeAt(0)),transformation:{width:(x1-x0)*96/72,height:(y1-y0)*96/72},floating:{horizontalPosition:{relative:d.HorizontalPositionRelativeFrom.PAGE,offset:0},verticalPosition:{relative:d.VerticalPositionRelativeFrom.PAGE,offset:0},wrap:{type:d.TextWrappingType.NONE},behindDocument:true}})]}));
        children.push(new d.Paragraph({spacing:{before:0,after:0},children:[]}));
        return {properties:{type:d.SectionType.NEXT_PAGE,page:{size:{width:Math.round((x1-x0)*20),height:Math.round((y1-y0)*20)},margin:{top:0,bottom:0,left:0,right:0}}},children};
    });
    const fonts=pages.flatMap(page=>page.recoveredFonts||[]).map(font=>({name:font.name,data:Uint8Array.from(atob(font.data.split(',')[1]),c=>c.charCodeAt(0))}));
    return d.Packer.toBlob(new d.Document({sections,fonts}));
}
export function pptFromLayout(pages,Ctor,{enhanceContrast=false}={}) {
    const pptx=new Ctor();pptx.author='infinitools';
    for(const [index,page] of pages.entries()){
        const [x0,y0,x1,y1]=page.bounds,width=(x1-x0)/72,height=(y1-y0)/72,name='PAGE'+index;
        pptx.defineLayout({name,width,height});if(index===0)pptx.layout=name;
        const slide=pptx.addSlide();
        // PowerPoint uses one page size for the whole deck. Fit mixed page sizes.
        const first=pages[0].bounds,targetW=(first[2]-first[0])/72,targetH=(first[3]-first[1])/72,scale=Math.min(targetW/width,targetH/height),dx=(targetW-width*scale)/2,dy=(targetH-height*scale)/2;
        const geometry=editableGeometry(page.backgroundSvg);
        if(page.backgroundSvg)slide.addImage({data:svgData(geometry.svg),x:dx,y:dy,w:width*scale,h:height*scale});
        for(const shape of geometry.shapes){const line=shape.type==='line';slide.addShape(line?'line':'rect',{x:dx+(shape.x-x0)/72*scale,y:dy+(shape.y-y0)/72*scale,w:shape.w/72*scale,h:shape.h/72*scale,flipV:line&&((shape.points[1][0]-shape.points[0][0])*(shape.points[1][1]-shape.points[0][1])<0),line:{color:shape.stroke==='none'?'FFFFFF':shape.stroke.slice(1),transparency:shape.stroke==='none'?100:0,width:shape.width*scale},fill:{color:shape.fill==='none'?'FFFFFF':shape.fill.slice(1),transparency:shape.fill==='none'?100:0}});}
        for(const line of layoutParagraphs(page)){const b=line.bbox,angle=(line.rotation||0),quarter=Math.abs(angle)>45&&Math.abs(angle)<135,w=(quarter?b.h:b.w)/72*scale+.04,h=(quarter?b.w:b.h)/72*scale;slide.addText(runsOf(line).map(run=>({text:run.text,options:{fontFace:fontName(run.font?.name),fontSize:(run.font?.size||12)*scale,bold:run.font?.weight==='bold',italic:run.font?.style==='italic',color:readableTextColor(run.color,enhanceContrast)}})),{x:quarter?dx+(b.x-x0+b.w/2)/72*scale-w/2:dx+(b.x-x0)/72*scale,y:dy+(b.y-y0+b.h/2)/72*scale-h/2,w:Math.max(.05,w),h:Math.max(.05,h),rotate:(angle+360)%360,margin:0,breakLine:false,fit:'shrink',vertAlign:'mid',paraSpaceAfter:0,lineSpacing:line.lineHeight?line.lineHeight*scale:undefined});}

    }
    return pptx;
}
export {layoutMarkdown,tableRows};
