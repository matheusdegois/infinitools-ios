import {decodeImageFile} from './image-formats.mjs?v=3';
import {parsePng,pngChunk} from './png-optimizer.mjs';
import {setupSocialEditor} from './social-template-ui.mjs?v=3';
import {setupPhotoEditor} from './photo-template-ui.mjs?v=2';
import {TemplateBackground} from './template-background.mjs?v=1';

const input=(id,label,value,type='number',extra='')=>`<label>${label}<input id="${id}" type="${type}" value="${value}" ${extra}></label>`;
const select=(id,label,options)=>`<label>${label}<select id="${id}">${options.map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></label>`;
const numeric=(root,id,min,max)=>{const n=Number(root.querySelector('#'+id)?.value);if(!Number.isFinite(n)||n<min||n>max)throw new Error(`Confira ${root.querySelector('#'+id)?.closest('label')?.firstChild.textContent||id}.`);return n;};
export function photoDimensions(widthCm,heightCm,dpi){if(![widthCm,heightCm,dpi].every(Number.isFinite)||widthCm<1||widthCm>10||heightCm<1||heightCm>10||![150,300,600].includes(dpi))throw new Error('Use dimensões entre 1 e 10 cm e resolução de 150, 300 ou 600 dpi.');return {width:Math.round(widthCm*dpi/2.54),height:Math.round(heightCm*dpi/2.54)};}
export function sheetPositions(width,height,photoWidth,photoHeight,count,dpi){const margin=Math.round(.5*dpi/2.54),gap=Math.round(.2*dpi/2.54),cols=Math.floor((width-margin*2+gap)/(photoWidth+gap)),rows=Math.floor((height-margin*2+gap)/(photoHeight+gap));if(!Number.isInteger(count)||count<1||count>24||cols*rows<count)throw new Error(`Cabem ${Math.max(0,cols*rows)} fotos nessa folha. Reduza a quantidade ou escolha uma folha maior.`);return Array.from({length:count},(_,i)=>({x:margin+(i%cols)*(photoWidth+gap),y:margin+Math.floor(i/cols)*(photoHeight+gap)}));}
async function png(canvas,dpi){const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Falha ao exportar PNG.')),'image/png'));if(!dpi)return blob;const bytes=new Uint8Array(await blob.arrayBuffer()),density=new Uint8Array(9),view=new DataView(density.buffer);view.setUint32(0,Math.round(dpi/0.0254));view.setUint32(4,Math.round(dpi/0.0254));density[8]=1;return new Blob([bytes.subarray(0,8),...parsePng(bytes).flatMap(c=>c.type==='IHDR'?[pngChunk(c.type,c.data),pngChunk('pHYs',density)]:c.type==='pHYs'?[]:[pngChunk(c.type,c.data)])],{type:'image/png'});}

export class ImageTemplateEditor {
    constructor(mode,root){
        this.mode=mode;this.root=root;this.images=[];this.layers=[];this.version=0;this.selected=0;
        const photo=mode==='photo-id',simple=photo||mode==='avatar';
        root.classList.add('template-options');
        root.innerHTML=input('background','Fundo','#ffffff','color')+(mode==='avatar'?select('shape','Formato',[['circle','Círculo'],['square','Quadrado']]):'')+
            (!simple?select('layoutPreset','Modelo',mode==='collage'?[['grid','Grade de fotos'],['feature','Foto em destaque'],['banner','Fotos com título']]:[['overlay','Imagem com faixa de texto'],['split','Imagem e texto lado a lado'],['minimal','Texto com imagem menor']]):'')+
            (mode==='social-image'?select('ratio','Formato',[['1:1','Quadrado 1080 × 1080'],['16:9','Horizontal 1920 × 1080'],['9:16','Vertical 1080 × 1920'],['4:5','Retrato 1080 × 1350']]):'')+
            (mode==='collage'?input('columns','Colunas',2,'number','min="1" max="8" step="1"')+input('gap','Espaçamento (px)',12,'number','min="0" max="100"'):'')+
            (photo?select('photoSize','Tamanho da foto',[['3:4','3 × 4 cm'],['3.5:4.5','3,5 × 4,5 cm'],['5:7','5 × 7 cm'],['custom','Personalizado']])+input('photoWidth','Largura (cm)',3,'number','min="1" max="10" step="0.1"')+input('photoHeight','Altura (cm)',4,'number','min="1" max="10" step="0.1"')+select('dpi','Resolução de impressão',[['300','300 dpi'],['150','150 dpi'],['600','600 dpi']])+'<label><input id="photoGuides" type="checkbox" checked> Mostrar guias de enquadramento</label>'+select('printSheet','Folha para impressão',[['none','Somente foto individual'],['10:15','10 × 15 cm'],['21:29.7','A4']])+input('photoCopies','Fotos na folha',6,'number','min="1" max="24" step="1"')+'<label><input id="cutMarks" type="checkbox" checked> Marcas de corte na folha</label><p class="template-note">As guias ajudam a enquadrar e não saem na foto. Confira separadamente as exigências do documento escolhido.</p>':'');
        if(!simple)root.insertAdjacentHTML('beforeend',select('layerSelect','Área selecionada',[])+'<div class="template-actions"><button type="button" id="addText">Adicionar texto</button><button type="button" id="addImage">Adicionar imagem</button><button type="button" id="removeLayer">Remover área</button></div><label>Adicionar ou substituir imagem<input id="layerImage" type="file" accept="image/*"></label><label>Texto da área<textarea id="title" maxlength="500" rows="3"></textarea></label>'+input('fontSize','Tamanho do texto (px)',64,'number','min="8" max="300"')+input('textColor','Cor do texto','#ffffff','color')+select('textAlign','Alinhamento',[['left','Esquerda'],['center','Centro'],['right','Direita']])+'<div class="template-geometry">'+input('layerX','Posição X (%)',0)+input('layerY','Posição Y (%)',0)+input('layerW','Largura (%)',100)+input('layerH','Altura (%)',100)+input('layerOpacity','Opacidade (%)',100)+'</div>');
        if(!simple)root.insertAdjacentHTML('beforeend',select('imageSource','Imagem da área',[]));
        root.insertAdjacentHTML('beforeend',input('cropX','Enquadramento horizontal (%)',50,'number','min="0" max="100"')+input('cropY','Enquadramento vertical (%)',50,'number','min="0" max="100"')+input('imageZoom','Zoom da imagem',1,'number','min="1" max="3" step="0.1"'));
        if(['photo-id','thumbnail','collage','avatar'].includes(mode)){
            root.insertAdjacentHTML('beforeend','<label class="template-background-permission"><input type="checkbox" id="allowImageBackground"> Permitir alterar o fundo da imagem</label><p id="templateBackgroundNote" class="template-background-note">Sem esta permissão, a cor escolhida preenche apenas áreas transparentes ou vazias. O fundo que já faz parte da foto é preservado. Ao marcar, você permite o recorte automático do fundo das fotos desta composição, no seu dispositivo, para aplicar a cor escolhida.</p><p id="templateBackgroundStatus" role="status" aria-live="polite"></p>');
            this.get('background').closest('label').classList.add('template-background-color');
            for(const [id,min,max,step]of[['cropX',0,100,1],['cropY',0,100,1],['imageZoom',1,3,.05]]){const control=this.get(id);control.type='range';control.min=min;control.max=max;control.step=step;const output=document.createElement('output');output.id=id+'Value';output.htmlFor=id;control.closest('label').append(output);}
        }
        this.preview=document.createElement('section');this.preview.className='template-preview';this.preview.innerHTML='<h2>Prévia editável</h2><p>Selecione uma área e arraste para mover. Ajuste texto, imagem e tamanho nas opções.</p><canvas aria-label="Prévia da composição" tabindex="0"></canvas><p class="template-size" role="status"></p>';
        if(simple)this.preview.querySelector('p').textContent='Ajuste o enquadramento horizontal, vertical e o zoom nas opções. As guias não são exportadas na foto individual.';this.canvas=this.preview.querySelector('canvas');if(['social-image','thumbnail','collage'].includes(mode))this.socialUI=setupSocialEditor(this);else if(simple)setupPhotoEditor(this);else root.after(this.preview);if(this.get('allowImageBackground'))this.backgroundEditor=new TemplateBackground(this);
        root.addEventListener('input',event=>this.onInput(event));root.addEventListener('change',event=>{if(event.target.id==='layerImage')this.replaceImage(event.target.files[0]);else if(event.target.id==='layerSelect'){this.selected=Number(event.target.value);this.sync();this.render();}});
        for(const id of ['addText','addImage','removeLayer'])this.get(id)?.addEventListener('click',()=>{if(id==='addText')this.layers.push({type:'text',text:'Novo texto',x:.1,y:.1,w:this.socialUI?.45:.8,h:.2,size:64,color:'#ffffff',align:'left',opacity:1});if(id==='addImage'){if(!this.images.length)return;this.layers.push({type:'image',image:0,x:.1,y:.1,w:.4,h:.4,cropX:50,cropY:50,zoom:1,opacity:1});}if(id==='removeLayer'){this.layers.splice(this.selected,1);this.selected=Math.max(0,this.selected-1);}else this.selected=this.layers.length-1;if(this.socialUI&&id!=='removeLayer')this.socialUI.placeNewLayer(id==='addText'?'text':'image');this.sync();this.render();this.root.dispatchEvent(new Event('templatechange'));});
        this.canvas.addEventListener('pointerdown',event=>{if(simple||this.socialUI)return;const p=this.point(event);for(let i=this.layers.length-1;i>=0;i--){const l=this.layers[i];if(p.x>=l.x&&p.y>=l.y&&p.x<=l.x+l.w&&p.y<=l.y+l.h){this.selected=i;this.drag={px:p.x,py:p.y,x:l.x,y:l.y};this.canvas.setPointerCapture(event.pointerId);this.sync();this.render();break;}}});
        this.canvas.addEventListener('pointermove',event=>{if(!this.drag)return;const p=this.point(event),l=this.layers[this.selected];l.x=Math.max(0,Math.min(1-l.w,this.drag.x+p.x-this.drag.px));l.y=Math.max(0,Math.min(1-l.h,this.drag.y+p.y-this.drag.py));this.sync();this.render();this.root.dispatchEvent(new Event('templatechange'));});for(const event of ['pointerup','pointercancel'])this.canvas.addEventListener(event,()=>this.drag=null);
        this.preview.hidden=true;
    }
    get(id){return this.root.querySelector('#'+id);}
    value(id){return this.get(id)?.value;}
    point(event){const r=this.canvas.getBoundingClientRect();return{x:(event.clientX-r.left)/r.width,y:(event.clientY-r.top)/r.height};}
    error(error){document.getElementById('fileStatus').textContent=error.message;}
    dimensions(){
        if(this.mode==='photo-id')return photoDimensions(numeric(this.root,'photoWidth',1,10),numeric(this.root,'photoHeight',1,10),Number(this.value('dpi')));
        if(this.mode==='thumbnail')return{width:1280,height:720};
        if(this.mode==='social-image'){const [w,h]=this.value('ratio').split(':').map(Number),width=w===16?1920:1080;return{width,height:Math.round(width*h/w)};}
        if(this.mode==='collage'){const cols=numeric(this.root,'columns',1,8);if(!Number.isInteger(cols))throw new Error('Use um número inteiro de colunas.');return{width:1200,height:Math.max(600,Math.ceil((this.sourceCount||0)/cols)*Math.round(1200/cols))};}
        return{width:512,height:512};
    }
    async loadFiles(files){
        this.backgroundEditor?.reset();
        const version=++this.version,images=[];if(files.length>16)throw new Error('Use até 16 imagens por composição.');
        try{for(const file of files){images.push(await decodeImageFile(file));if(images.reduce((n,image)=>n+image.width*image.height,0)>32e6)throw new Error('As imagens excedem 32 megapixels no total. Reduza a resolução ou a quantidade.');if(version!==this.version)return false;}this.images.forEach(image=>image.width=image.height=1);this.images=images;this.sourceCount=images.length;this.reset();this.preview.hidden=!images.length;return true;}
        finally{if(images!==this.images)images.forEach(image=>image.width=image.height=1);}
    }
    reset(){
        this.socialUI?.cancelPlacement();
        const photo=this.mode==='photo-id'||this.mode==='avatar',preset=this.value('layoutPreset'),{width,height}=this.dimensions(),sources=this.images.slice(0,this.sourceCount||this.images.length);this.layers=[];
        const addImage=(image,x,y,w,h)=>this.layers.push({type:'image',image,x,y,w,h,cropX:50,cropY:50,zoom:1,opacity:1});
        if(photo){if(this.images.length)addImage(0,0,0,1,1);}
        else if(this.mode==='collage'){
            const cols=Number(this.value('columns')),gapPixels=Number(this.value('gap')),gx=gapPixels/width,gy=gapPixels/height,rows=Math.ceil(sources.length/cols),bottom=preset==='banner'?.18:0;
            if(preset==='feature'&&sources.length>1){addImage(0,gx,gy,.64-gx*2,1-gy*2);sources.slice(1).forEach((_,i)=>addImage(i+1,.66,gy+i*(1-gy)/(sources.length-1),.34-gx,(1-gy)/(sources.length-1)-gy));}
            else sources.forEach((_,i)=>addImage(i,gx+(i%cols)*(1-gx)/cols,gy+Math.floor(i/cols)*(1-bottom-gy)/rows,(1-gx)/cols-gx,(1-bottom-gy)/rows-gy));
        }else if(this.images.length)addImage(0,preset==='minimal'?.62:0,0,preset==='split'?.55:preset==='minimal'?.38:1,1);
        if(!photo){const split=preset==='split'||preset==='minimal',color=split?'#17243a':'#ffffff';this.layers.push({type:'text',text:'Seu título',x:split?.59:.05,y:this.mode==='collage'?.84:split?.2:.68,w:split?.35:.9,h:this.mode==='collage'?.13:.22,size:Math.round(width/20),color,align:'left',opacity:1});if(this.mode!=='collage')this.layers.push({type:'text',text:'Edite esta descrição',x:split?.59:.05,y:split?.56:.9,w:split?.35:.9,h:.09,size:Math.round(width/40),color,align:'left',opacity:1});}
        this.selected=0;this.sync();this.render();if(this.backgroundEditor?.checkbox.checked)this.backgroundEditor.schedule();
    }
    sync(){
        const l=this.layers[this.selected];const selector=this.get('layerSelect');if(selector){selector.replaceChildren(...this.layers.map((layer,i)=>new Option(`${i+1}. ${layer.type==='text'?'Texto: '+layer.text.slice(0,25):'Imagem '+(layer.image+1)}`,String(i))));selector.value=String(this.selected);}
        const source=this.get('imageSource');if(source){source.replaceChildren(...this.images.map((_,i)=>new Option('Imagem '+(i+1),String(i))));source.disabled=!l||l.type!=='image';source.value=String(l?.image??0);}
        for(const [id,key,factor]of[['title','text',1],['fontSize','size',1],['textColor','color',1],['textAlign','align',1],['layerX','x',100],['layerY','y',100],['layerW','w',100],['layerH','h',100],['layerOpacity','opacity',100],['cropX','cropX',1],['cropY','cropY',1],['imageZoom','zoom',1]]){const el=this.get(id);if(!el)continue;el.disabled=!l||(['title','fontSize','textColor','textAlign'].includes(id)&&l.type!=='text')||(['cropX','cropY','imageZoom','layerImage'].includes(id)&&l.type!=='image');if(l&&l[key]!==undefined)el.value=typeof l[key]==='number'?String(Math.round(l[key]*factor*100)/100):l[key];}
        if(this.get('layerImage'))this.get('layerImage').disabled=!l||l.type!=='image';
        for(const id of ['cropX','cropY','imageZoom'])if(this.get(id+'Value'))this.get(id+'Value').textContent=id==='imageZoom'?Number(this.value(id)).toFixed(2)+'×':this.value(id)+'%';
        this.socialUI?.sync();
    }
    onInput(event){
        const id=event.target.id;
        if(id==='allowImageBackground'){this.backgroundEditor.schedule();return;}
        try{
            if(id==='photoSize'){if(this.value(id)!=='custom'){const [w,h]=this.value(id).split(':');this.get('photoWidth').value=w;this.get('photoHeight').value=h;}}
            if(['photoWidth','photoHeight'].includes(id))this.get('photoSize').value='custom';
            if(['layoutPreset','ratio','columns','gap'].includes(id)){if(this.mode==='collage')numeric(this.root,'gap',0,100);this.reset();return;}
            const l=this.layers[this.selected];if(l){if(id==='imageSource'&&l.type==='image')l.image=Number(event.target.value);const map={title:['text',1],fontSize:['size',1],textColor:['color',1],textAlign:['align',1],layerX:['x',100],layerY:['y',100],layerW:['w',100],layerH:['h',100],layerOpacity:['opacity',100],cropX:['cropX',1],cropY:['cropY',1],imageZoom:['zoom',1]};if(map[id]){const [key,factor]=map[id];let v=['text','color','align'].includes(key)?event.target.value:Number(event.target.value)/factor;if(typeof v==='number'){if(!Number.isFinite(v))throw new Error('Confira o valor informado.');if(['w','h'].includes(key))v=Math.max(.01,Math.min(1,v));if(['x','y','opacity'].includes(key))v=Math.max(0,Math.min(1,v));if(key==='size')v=Math.max(8,Math.min(300,v));if(key==='zoom')v=Math.max(1,Math.min(3,v));if(['cropX','cropY'].includes(key))v=Math.max(0,Math.min(100,v));}l[key]=v;l.x=Math.min(l.x,1-l.w);l.y=Math.min(l.y,1-l.h);}}
            this.render();
            for(const id of ['cropX','cropY','imageZoom'])if(this.get(id+'Value'))this.get(id+'Value').textContent=id==='imageZoom'?Number(this.value(id)).toFixed(2)+'×':this.value(id)+'%';
            if(id==='imageSource'&&this.backgroundEditor?.checkbox.checked)this.backgroundEditor.schedule();
        }catch(error){this.error(error);}
    }
    async replaceImage(file){if(!file)return;const layer=this.layers[this.selected],version=this.version;if(layer?.type!=='image')return;try{const image=await decodeImageFile(file);if(version!==this.version||!this.layers.includes(layer)){image.width=image.height=1;return;}if(this.images.reduce((n,img)=>n+img.width*img.height,0)+image.width*image.height>32e6){image.width=image.height=1;throw new Error('As imagens excedem 32 megapixels no total.');}layer.image=this.images.length;this.images.push(image);this.sync();this.render();if(this.backgroundEditor?.checkbox.checked)this.backgroundEditor.schedule();this.root.dispatchEvent(new Event('templatechange'));}catch(error){this.error(error);}}
    draw(ctx,width,height,preview=false){
        ctx.clearRect(0,0,width,height);ctx.save();if(this.mode==='avatar'&&this.value('shape')==='circle'){ctx.beginPath();ctx.arc(width/2,height/2,width/2,0,Math.PI*2);ctx.clip();}ctx.fillStyle=this.value('background');ctx.fillRect(0,0,width,height);
        for(const l of this.layers){ctx.save();ctx.globalAlpha=l.opacity;const x=l.x*width,y=l.y*height,w=l.w*width,h=l.h*height;ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();
            if(l.type==='image'){const image=this.backgroundEditor?.source(l.image)||this.images[l.image];if(image){const scale=Math.max(w/image.width,h/image.height)*(l.zoom||1),dw=image.width*scale,dh=image.height*scale;ctx.drawImage(image,x-(dw-w)*(l.cropX??50)/100,y-(dh-h)*(l.cropY??50)/100,dw,dh);}}
            else{if(this.value('layoutPreset')==='overlay'||this.value('layoutPreset')==='banner'){ctx.fillStyle='rgba(0,0,0,.65)';ctx.fillRect(x,y,w,h);}ctx.font=`bold ${l.size}px Arial`;ctx.textBaseline='top';ctx.fillStyle=l.color;ctx.textAlign=l.align;let row=0;const words=l.text.split('\n');for(const paragraph of words){let line='';for(const word of paragraph.split(/\s+/)){const next=line?line+' '+word:word;if(ctx.measureText(next).width>w-16&&line){ctx.fillText(line,x+(l.align==='center'?w/2:l.align==='right'?w-8:8),y+8+row++*l.size*1.15);line=word;}else line=next;}ctx.fillText(line,x+(l.align==='center'?w/2:l.align==='right'?w-8:8),y+8+row++*l.size*1.15);}}
            ctx.restore();
        }ctx.restore();
        if(preview&&this.mode==='photo-id'&&this.get('photoGuides').checked){ctx.save();ctx.strokeStyle='#00a5ff';ctx.lineWidth=width/180;ctx.setLineDash([width/40,width/60]);ctx.beginPath();ctx.moveTo(width/2,0);ctx.lineTo(width/2,height);ctx.moveTo(0,height*.28);ctx.lineTo(width,height*.28);ctx.moveTo(0,height*.78);ctx.lineTo(width,height*.78);ctx.stroke();ctx.beginPath();ctx.ellipse(width/2,height*.47,width*.27,height*.3,0,0,Math.PI*2);ctx.stroke();ctx.restore();}
        if(preview&&!['photo-id','avatar'].includes(this.mode)&&this.layers[this.selected]){const l=this.layers[this.selected];ctx.save();ctx.strokeStyle='#ff5a00';ctx.lineWidth=Math.max(2,width/350);ctx.setLineDash([width/90,width/120]);ctx.strokeRect(l.x*width,l.y*height,l.w*width,l.h*height);if(this.socialUI){ctx.setLineDash([]);ctx.fillStyle='#fff';const size=width/65;for(const [x,y] of [[l.x,l.y],[l.x+l.w,l.y],[l.x+l.w,l.y+l.h],[l.x,l.y+l.h]]){ctx.fillRect(x*width-size/2,y*height-size/2,size,size);ctx.strokeRect(x*width-size/2,y*height-size/2,size,size);}}ctx.restore();}
    }
    render(){const {width,height}=this.dimensions();if(width*height>16e6)throw new Error('A composição excede 16 megapixels.');this.canvas.width=width;this.canvas.height=height;this.draw(this.canvas.getContext('2d'),width,height,true);this.preview.querySelector('.template-size').textContent=`${width} × ${height} pixels`+(this.mode==='photo-id'?` · ${this.value('photoWidth')} × ${this.value('photoHeight')} cm · ${this.value('dpi')} dpi`:'');}
    async export(){
        await this.backgroundEditor?.ensure();
        if(!this.images.length)throw new Error('Selecione uma imagem.');const {width,height}=this.dimensions();if(width*height>16e6)throw new Error('A composição excede 16 megapixels.');const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;this.draw(canvas.getContext('2d'),width,height);const dpi=this.mode==='photo-id'?Number(this.value('dpi')):null,outputs=[];
        try{outputs.push({blob:await png(canvas,dpi),name:this.mode+'.png'});if(this.mode==='photo-id'&&this.value('printSheet')!=='none'){const [cmW,cmH]=this.value('printSheet').split(':').map(Number),sheet=document.createElement('canvas');const sheetWidth=Math.round(cmW*dpi/2.54),sheetHeight=Math.round(cmH*dpi/2.54);if(sheetWidth*sheetHeight>16e6)throw new Error('Essa folha excede 16 megapixels. Escolha 150 ou 300 dpi.');sheet.width=sheetWidth;sheet.height=sheetHeight;const positions=sheetPositions(sheet.width,sheet.height,width,height,numeric(this.root,'photoCopies',1,24),dpi),ctx=sheet.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,sheet.width,sheet.height);for(const p of positions){ctx.drawImage(canvas,p.x,p.y);if(this.get('cutMarks').checked){ctx.strokeStyle='#888';ctx.lineWidth=1;const len=Math.round(dpi*.08);for(const [x,y,sx,sy]of[[p.x,p.y,-1,-1],[p.x+width,p.y,1,-1],[p.x,p.y+height,-1,1],[p.x+width,p.y+height,1,1]]){ctx.beginPath();ctx.moveTo(x+sx*2,y);ctx.lineTo(x+sx*len,y);ctx.moveTo(x,y+sy*2);ctx.lineTo(x,y+sy*len);ctx.stroke();}}}outputs.push({blob:await png(sheet,dpi),name:'foto-folha-'+(cmW===21?'a4':'10x15')+'.png'});sheet.width=sheet.height=1;}return outputs;}
        finally{canvas.width=canvas.height=1;}
    }
    setBusy(value){this.root.inert=value;this.preview.inert=value;}
    destroy(){this.version++;this.backgroundEditor?.reset();this.images.forEach(image=>image.width=image.height=1);this.images=[];this.layers=[];this.socialUI?.sync();}
}
