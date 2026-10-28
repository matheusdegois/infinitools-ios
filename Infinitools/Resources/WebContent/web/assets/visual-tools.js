import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs';
import {pdfEngine} from './pdf-engine.mjs?v=3';
import {formMetadata} from './pdf-form-fields.mjs?v=1';
import {layoutLines} from './pdf-layout.mjs?v=2';

pdfjsLib.GlobalWorkerOptions.workerSrc='./assets/vendor/pdfjs/pdf.worker.min.mjs';

const uid=()=>crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`;
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const icon=name=>`<svg class="ui-icon-svg" aria-hidden="true"><use href="assets/icons/tabler-sprite.svg#icon-${name}"></use></svg>`;

export class VisualPdfWorkspace{
    constructor(mode,host,optionRoot){
        this.mode=mode;this.host=host;this.optionRoot=optionRoot;this.optionHome=optionRoot.parentElement;this.pdf=null;this.pages=[];this.items=[];this.activeTool=mode==='forms'?'text':mode==='edit'?'select':'crop';this.selectedId=null;this.crop={left:.035,right:.035,top:.025,bottom:.025};this.zoom=1;this.pageObserver=null;this.undoStack=[];this.redoStack=[];this.maxHistory=60;
    }
    async load(file){
        this.destroy();this.file=file;this.host.hidden=false;
        if(this.mode==='edit'){
            document.body.classList.add('pdf-editor-active');
            this.host.innerHTML=`<section class="visual-workspace edit-workspace"><header class="pdf-editor-topbar"><div class="pdf-editor-file"><span class="pdf-editor-mark">PDF</span><div><strong>${this.escape(file.name)}</strong><small>Edição local e privada</small></div></div><div class="pdf-editor-page-status" aria-live="polite">Página <strong>1</strong> de <span>—</span></div><div class="pdf-editor-actions"><button type="button" class="btn btn-secondary" data-action="change-file">Trocar PDF</button><button type="button" class="btn btn-primary" data-action="finish">Finalizar e baixar</button></div></header><div class="visual-toolbar" aria-label="Ferramentas de edição"></div><aside class="visual-page-sidebar"><div class="visual-sidebar-heading"><strong>Páginas</strong><span>—</span></div><div class="visual-thumbnails"></div></aside><div class="visual-document"><div class="visual-hint"></div><div class="visual-pages"></div></div><aside class="visual-properties"><div class="visual-properties-heading"><strong>Propriedades</strong><small>Ajuste a ferramenta selecionada</small></div></aside></section>`;
        }else this.host.innerHTML=`<section class="visual-workspace ${this.mode}-workspace"><div class="visual-toolbar" aria-label="Ferramentas"></div><div class="visual-document"><div class="visual-hint"></div><div class="visual-pages"></div></div></section>`;
        this.toolbar=this.host.querySelector('.visual-toolbar');this.documentHost=this.host.querySelector('.visual-document');this.pagesHost=this.host.querySelector('.visual-pages');this.hint=this.host.querySelector('.visual-hint');this.thumbHost=this.host.querySelector('.visual-thumbnails');
        if(this.mode==='edit')this.host.querySelector('.visual-properties').append(this.optionRoot);
        if(this.mode==='forms'){
            if(!globalThis.PDFLib)await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='assets/vendor/pdf-lib.min.js';script.onload=resolve;script.onerror=()=>reject(new Error('Não foi possível carregar o editor de campos.'));document.head.append(script);});
            const source=await PDFLib.PDFDocument.load(await file.arrayBuffer(),{updateMetadata:false});this.fieldMetadata=formMetadata(source,PDFLib);
        }
        this.buildToolbar();this.pdf=await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
        if(this.mode==='edit')this.updateEditorPageLabels(1);
        const limit=this.mode==='crop'?1:this.pdf.numPages;
        for(let i=1;i<=limit;i++)await this.renderPage(i);
        if(this.mode==='edit'){this.setZoom(this.zoom);this.setupEditorChrome();}
        if(this.mode==='crop'){this.setupCropOptions();this.renderCrop();}
        if(this.mode==='forms'){await this.importExistingFields();this.setupFormOptions();this.renderItems();}
        this.updateHint();
    }
    destroy(){this.originalContentLoaded=false;if(this.cropControls&&this.cropSync){this.cropControls.forEach(el=>el?.removeEventListener('input',this.cropSync))}if(this.formType&&this.formTypeSync)this.formType.removeEventListener('change',this.formTypeSync);if(this.keyHandler)document.removeEventListener('keydown',this.keyHandler);if(this.formKeyHandler)document.removeEventListener('keydown',this.formKeyHandler);if(this.optionInputHandler)this.optionRoot.removeEventListener('input',this.optionInputHandler);if(this.optionPointerHandler)this.optionRoot.removeEventListener('pointerdown',this.optionPointerHandler);if(this.optionChangeHandler)this.optionRoot.removeEventListener('change',this.optionChangeHandler);this.pageObserver?.disconnect();this.pageObserver=null;this.cropReadout?.parentElement?.remove();if(this.optionHome&&this.optionRoot.parentElement!==this.optionHome)this.optionHome.append(this.optionRoot);document.body.classList.remove('pdf-editor-active');if(this.host){this.host.innerHTML='';this.host.hidden=true}this.pages=[];this.items=[];this.pdf=null;this.selectedId=null;this.undoStack=[];this.redoStack=[];this.cropControls=null;this.cropSync=null;this.formType=null;this.formTypeSync=null;this.formKeyHandler=null;this.thumbHost=null;this.documentHost=null}
    cleanItems(){return this.items.map(({element,...item})=>({...item,points:item.points?.map(point=>({...point}))}))}
    getState(){return{mode:this.mode,items:this.cleanItems(),crop:{...this.crop},originalFieldNames:[...(this.originalFieldNames||[])]}}
    async importExistingFields(){
        this.originalFieldNames=new Set();
        for(const page of this.pages){
            const annotations=await page.page.getAnnotations({intent:'display'});
            for(const annotation of annotations){
                if(annotation.subtype!=='Widget'||!annotation.fieldName||!['Tx','Btn','Ch','Sig'].includes(annotation.fieldType)||annotation.pushButton)continue;
                const rect=page.base.convertToViewportRectangle(annotation.rect),x=Math.min(rect[0],rect[2])/page.base.width,y=Math.min(rect[1],rect[3])/page.base.height,w=Math.abs(rect[2]-rect[0])/page.base.width,h=Math.abs(rect[3]-rect[1])/page.base.height;
                const type=annotation.fieldType==='Sig'?'signature':annotation.fieldType==='Tx'?'text':annotation.fieldType==='Ch'?(annotation.comboBox?'dropdown':'list'):annotation.radioButton?'radio':'checkbox';
                this.originalFieldNames.add(annotation.fieldName);
                const {widgets,...metadata}=this.fieldMetadata[annotation.fieldName]||{};
                if(!this.fieldMetadata[annotation.fieldName])throw new Error('Widget sem campo canônico correspondente. Este formulário exige reparo próprio antes da edição.');
                const item={id:uid(),page:page.pageIndex,type,x,y,w,h,...metadata,name:annotation.fieldName,originalName:annotation.fieldName,originalId:annotation.id,value:annotation.fieldValue||'',exportValue:annotation.exportValue||annotation.buttonValue||'Yes',options:(annotation.options||[]).map(option=>({label:option.displayValue,value:option.exportValue})),readOnly:annotation.readOnly,element:null};
                item.originalState=JSON.parse(JSON.stringify({...item,element:undefined}));this.items.push(item);
            }
        }
        for(const [name,{widgets,...metadata}] of Object.entries(this.fieldMetadata))if(metadata.signature&&!this.originalFieldNames.has(name)){
            const item={...metadata,id:uid(),name,originalName:name,type:'signature',page:0,x:0,y:0,w:0,h:0,hiddenField:true,value:'',element:null};item.originalState=JSON.parse(JSON.stringify({...item,element:undefined}));this.originalFieldNames.add(name);this.items.push(item);
        }
    }
    async importOriginalContent(){
        if(this.originalContentLoaded)return;
        const pages=await pdfEngine(this.file,'layout');this.pushUndoSnapshot();
        for(const [index,source] of pages.entries()){
            const [x0,y0,x1,y1]=source.bounds,width=x1-x0,height=y1-y0;
            const add=(type,rect,properties)=>{const [x,y,right,bottom]=rect;const item={id:uid(),page:index,type,x:(x-x0)/width,y:(y-y0)/height,w:(right-x)/width,h:(bottom-y)/height,originalRect:rect,pageBounds:source.bounds,originalKind:type==='image'?'image':'text',...properties,element:null};item.originalState={x:item.x,y:item.y,w:item.w,h:item.h,text:item.text,dataUrl:item.dataUrl,size:item.size,color:item.color};this.items.push(item);};
            for(const line of layoutLines(source)){const b=line.bbox;add('text',[b.x,b.y,b.x+b.w,b.y+b.h],{text:line.text,size:line.font?.size||12,color:line.runs?.[0]?.color||'#000000',runs:line.runs,rotation:line.rotation||0,fontName:line.font?.name||'Arial'});}
            for(const image of source.images||[])add('image',image.rect,{dataUrl:image.data});
        }
        this.originalContentLoaded=true;this.setTool('select');this.renderItems();this.hint.textContent='Conteúdo original carregado. Edite o texto, mova ou exclua um elemento. A exportação remove o conteúdo antigo da área; fontes podem variar. Para substituir imagem, selecione-a e use Substituir imagem.';
    }
    snapshot(){return this.cleanItems()}
    restore(snapshot){this.items=snapshot.map(item=>({...item,points:item.points?.map(point=>({...point})),element:null}));this.originalContentLoaded=this.items.some(item=>item.originalRect);this.selectedId=null;this.renderItems();this.updateHistoryButtons();if(this.mode==='forms')this.refreshFieldPicker()}
    pushUndoSnapshot(snapshot=this.snapshot()){this.undoStack.push(snapshot);if(this.undoStack.length>this.maxHistory)this.undoStack.shift();this.redoStack=[];this.updateHistoryButtons()}
    buildToolbar(){
        if(this.mode==='crop'){this.toolbar.innerHTML=`<span class="visual-tool-title">RECORTE</span><button type="button" data-action="reset" title="Redefinir recorte">${icon('restore')}<small>Redefinir</small></button>`;this.toolbar.querySelector('button').onclick=()=>{this.applySymmetricCrop(20,20);this.renderCrop()};return}
        const tools=this.mode==='edit'?
            [['select','arrows-move','Selecionar e mover'],['text','text-size','Adicionar texto'],['draw','pencil','Desenho livre'],['highlight','color-swatch','Destaque'],['rect','rectangle','Retângulo'],['ellipse','circle','Elipse'],['line','wave-sine','Linha'],['check','check','Verificação'],['date','history','Data'],['time','clock','Hora'],['signature','rubber-stamp','Assinatura'],['whiteout','eye-off','Cobrir conteúdo'],['image','photo-plus','Adicionar imagem']]:
            [['select','arrows-move','Selecionar e mover'],['text','text-size','Campo de texto'],['checkbox','forms','Caixa de seleção'],['radio','circle-dashed','Botão de opção'],['dropdown','layout-grid','Lista suspensa'],['list','layout-grid','Lista múltipla'],['signature','rubber-stamp','Campo de assinatura']];
        const toolButtons=tools.map(([tool,iconName,label])=>`<button type="button" data-tool="${tool}" title="${label}" aria-label="${label}">${icon(iconName)}<small>${label}</small></button>`).join('');
        this.toolbar.innerHTML=this.mode==='edit'?`<div class="visual-tool-group">${toolButtons}<button type="button" data-action="duplicate" title="Duplicar selecionado (Ctrl+D)" aria-label="Duplicar selecionado">${icon('copy-plus')}<small>Duplicar</small></button><button type="button" data-action="delete" title="Excluir selecionado (Delete)" aria-label="Excluir selecionado">${icon('trash')}<small>Excluir</small></button><button type="button" data-action="undo" title="Desfazer (Ctrl+Z)" aria-label="Desfazer">${icon('arrow-back-up')}<small>Desfazer</small></button><button type="button" data-action="redo" title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer">${icon('restore')}<small>Refazer</small></button></div><div class="visual-zoom" aria-label="Controle de zoom"><button type="button" data-action="zoom-out" aria-label="Diminuir zoom">−</button><input type="range" min="60" max="160" step="10" value="100" aria-label="Zoom do documento"><button type="button" data-action="zoom-in" aria-label="Aumentar zoom">+</button><output>100%</output></div>`:toolButtons+`<span class="toolbar-spacer"></span><button type="button" data-action="delete" title="Excluir selecionado" aria-label="Excluir selecionado">${icon('trash')}<small>Excluir</small></button><button type="button" data-action="undo" title="Desfazer (Ctrl+Z)" aria-label="Desfazer">${icon('arrow-back-up')}<small>Desfazer</small></button><button type="button" data-action="redo" title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer">${icon('restore')}<small>Refazer</small></button>`;
        this.toolbar.querySelectorAll('[data-tool]').forEach(btn=>btn.onclick=()=>this.setTool(btn.dataset.tool));
        if(this.mode==='edit'){
            const original=document.createElement('button');original.type='button';original.textContent='Editar conteúdo original';original.dataset.action='original';original.onclick=async()=>{original.disabled=true;try{await this.importOriginalContent();}catch(error){alert(error.message);}finally{original.disabled=false;}};this.toolbar.querySelector('.visual-tool-group').append(original);
            const replace=document.createElement('button');replace.type='button';replace.textContent='Substituir imagem';replace.onclick=async()=>{const item=this.items.find(value=>value.id===this.selectedId),file=this.optionRoot.querySelector('#overlayImage')?.files?.[0];if(item?.type!=='image'||!file){alert('Selecione uma imagem na página e escolha o arquivo de substituição nas propriedades.');return;}this.pushUndoSnapshot();item.dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});this.renderItem(item);};this.toolbar.querySelector('.visual-tool-group').append(replace);
        }
        this.toolbar.querySelector('[data-action="delete"]').onclick=()=>{if(this.selectedId)this.removeItem(this.selectedId)};this.toolbar.querySelector('[data-action="undo"]').onclick=()=>this.undo();this.toolbar.querySelector('[data-action="redo"]')?.addEventListener('click',()=>this.redo());this.toolbar.querySelector('[data-action="duplicate"]')?.addEventListener('click',()=>this.duplicateSelected());this.setTool(this.activeTool);this.updateHistoryButtons();
        if(this.mode==='edit'){
            const range=this.toolbar.querySelector('.visual-zoom input'),setZoom=value=>{range.value=String(clamp(value,60,160));this.setZoom(Number(range.value)/100)};
            range.addEventListener('input',()=>this.setZoom(Number(range.value)/100));this.toolbar.querySelector('[data-action="zoom-out"]').onclick=()=>setZoom(Number(range.value)-10);this.toolbar.querySelector('[data-action="zoom-in"]').onclick=()=>setZoom(Number(range.value)+10);
        }
    }
    setTool(tool){this.activeTool=tool;if(tool!=='select')this.selectedId=null;this.toolbar.querySelectorAll('[data-tool]').forEach(btn=>btn.classList.toggle('active',btn.dataset.tool===tool));this.pagesHost?.classList.toggle('drawing',tool==='draw');this.updateHint();this.renderItems()}
    updateHint(){
        if(!this.hint)return;
        const edit={select:'Clique em um elemento para selecionar. Arraste para mover ou use as alças dos cantos para redimensionar.',text:'Digite o texto nas opções e clique no PDF para posicioná-lo.',draw:'Clique e arraste diretamente sobre a página para desenhar.',highlight:'Clique e arraste para destacar uma área.',rect:'Clique e arraste para criar um retângulo.',ellipse:'Clique e arraste para criar uma elipse.',line:'Clique e arraste para criar uma linha.',check:'Clique e arraste para inserir uma marca de verificação.',date:'Clique no PDF para inserir a data atual.',time:'Clique no PDF para inserir a hora atual.',signature:'Digite a assinatura nas propriedades e clique no PDF.',whiteout:'Clique e arraste para cobrir uma área existente.',image:'Selecione uma imagem nas opções e clique no PDF para posicioná-la.'};
        const forms={select:'Selecione um campo na lista de propriedades ou na página. Widgets com o mesmo nome compartilham valor e propriedades.',text:'Clique e arraste para criar o campo. Digite nele; Enter salva e Ctrl+Enter cria uma nova linha.',checkbox:'Clique e arraste para criar uma caixa de seleção.',radio:'Use o mesmo nome para os radios de um grupo e um valor de opção diferente para cada botão.',dropdown:'Clique e arraste para criar uma lista suspensa.',list:'Clique e arraste para criar uma lista; Ctrl ou Command seleciona vários valores.',signature:'Clique e arraste para criar um campo vazio de assinatura. O campo não assina o PDF.'};
        this.hint.textContent=this.mode==='crop'?'Arraste a área clara, as bordas ou os cantos. O recorte visual será aplicado proporcionalmente a todas as páginas.':(this.mode==='edit'?edit[this.activeTool]:forms[this.activeTool]);
    }
    async renderPage(pageNumber){
        const page=await this.pdf.getPage(pageNumber),base=page.getViewport({scale:1}),room=this.mode==='edit'?window.innerWidth-570:window.innerWidth-150,available=Math.max(300,Math.min(850,room)),scale=Math.min(1.45,available/base.width),viewport=page.getViewport({scale}),ratio=Math.min(2,window.devicePixelRatio||1);
        const card=document.createElement('article');card.className='visual-page-card';card.innerHTML=`<header><strong>Página ${pageNumber}</strong><span>${Math.round(base.width)} × ${Math.round(base.height)} pt</span></header>`;
        const stage=document.createElement('div');stage.className='visual-page-stage';stage.style.width=`${viewport.width}px`;stage.style.height=`${viewport.height}px`;stage.style.aspectRatio=`${base.width} / ${base.height}`;
        const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`;
        const overlay=document.createElement('div');overlay.className='visual-overlay';overlay.dataset.page=String(pageNumber-1);
        stage.append(canvas,overlay);card.append(stage);this.pagesHost.append(card);
        await page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport,transform:ratio!==1?[ratio,0,0,ratio,0,0]:null,background:'#fff'}).promise;
        const state={pageIndex:pageNumber-1,page,base,stage,overlay,canvas,displayWidth:viewport.width,displayHeight:viewport.height,card};this.pages.push(state);this.bindOverlay(state);
        if(this.mode==='edit'&&this.thumbHost)this.addThumbnail(state,pageNumber);
        return state;
    }
    escape(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
    addThumbnail(page,pageNumber){
        const button=document.createElement('button');button.type='button';button.className='visual-thumbnail';button.dataset.page=String(pageNumber);button.setAttribute('aria-label',`Ir para a página ${pageNumber}`);
        const canvas=document.createElement('canvas'),width=150,height=Math.max(90,Math.round(width*(page.canvas.height/page.canvas.width)));canvas.width=width;canvas.height=height;canvas.getContext('2d',{alpha:false}).drawImage(page.canvas,0,0,width,height);button.append(canvas,Object.assign(document.createElement('span'),{textContent:`Página ${pageNumber}`}));button.onclick=()=>page.card.scrollIntoView({behavior:'smooth',block:'start'});this.thumbHost.append(button);
    }
    setupEditorChrome(){
        this.host.querySelector('[data-action="change-file"]').onclick=()=>document.getElementById('fileInput')?.click();this.host.querySelector('[data-action="finish"]').onclick=()=>document.getElementById('processBtn')?.click();
        this.pageObserver=new IntersectionObserver(entries=>{const visible=entries.filter(entry=>entry.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];if(visible)this.updateEditorPageLabels(Number(visible.target.dataset.page)||1)},{root:this.documentHost,threshold:[.15,.4,.7]});
        this.pages.forEach((page,index)=>{page.card.dataset.page=String(index+1);this.pageObserver.observe(page.card)});this.updateEditorPageLabels(1);
        this.keyHandler=event=>{const typing=event.target.matches?.('input,textarea,select')||event.target.isContentEditable;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&!typing){event.preventDefault();event.shiftKey?this.redo():this.undo();return}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='d'&&!typing){event.preventDefault();this.duplicateSelected();return}if(!typing&&(event.key==='Delete'||event.key==='Backspace')&&this.selectedId){event.preventDefault();this.removeItem(this.selectedId)}if(!typing&&event.key==='Escape')this.selectItem(null)};document.addEventListener('keydown',this.keyHandler);
        this.optionPointerHandler=()=>{this.pendingOptionSnapshot=this.snapshot()};this.optionInputHandler=event=>this.applyOptionToSelected(event.target);this.optionChangeHandler=()=>{if(this.pendingOptionSnapshot){this.pushUndoSnapshot(this.pendingOptionSnapshot);this.pendingOptionSnapshot=null}};this.optionRoot.addEventListener('pointerdown',this.optionPointerHandler);this.optionRoot.addEventListener('input',this.optionInputHandler);this.optionRoot.addEventListener('change',this.optionChangeHandler);
    }
    updateEditorPageLabels(pageNumber){
        const status=this.host.querySelector('.pdf-editor-page-status'),side=this.host.querySelector('.visual-sidebar-heading span'),total=this.pdf?.numPages||'—';if(status){status.querySelector('strong').textContent=String(pageNumber);status.querySelector('span').textContent=String(total)}if(side)side.textContent=String(total);this.host.querySelectorAll('.visual-thumbnail').forEach(button=>button.classList.toggle('active',button.dataset.page===String(pageNumber)));
    }
    setZoom(zoom){this.zoom=clamp(zoom,.6,1.6);this.pages.forEach(page=>{page.stage.style.width=`${page.displayWidth*this.zoom}px`;page.stage.style.height=`${page.displayHeight*this.zoom}px`});const output=this.toolbar?.querySelector('.visual-zoom output');if(output)output.textContent=`${Math.round(this.zoom*100)}%`;requestAnimationFrame(()=>this.renderItems())}
    bindOverlay(page){
        if(this.mode==='crop'){this.buildCropOverlay(page);return}
        let draft=null,start=null,pointerId=null;
        page.overlay.addEventListener('pointerdown',event=>{
            if(event.button!==0||event.target.closest('.visual-item'))return;
            const activeEditor=document.activeElement;if((this.mode==='forms'&&activeEditor?.matches?.('.visual-form-value'))||(this.mode==='edit'&&activeEditor?.isContentEditable&&activeEditor.classList.contains('item-text'))){event.preventDefault();activeEditor.blur();return}
            const point=this.point(page.overlay,event);start=point;pointerId=event.pointerId;page.overlay.setPointerCapture(pointerId);
            if(this.mode==='edit'&&this.activeTool==='text'){this.addText(page,point);start=null;return}
            if(this.mode==='edit'&&this.activeTool==='image'){this.addImage(page,point);start=null;return}
            if(this.mode==='edit'&&['date','time','signature'].includes(this.activeTool)){this.addPresetText(page,point,this.activeTool);start=null;return}
            if(this.activeTool==='select'){this.selectItem(null);start=null;return}
            this.pushUndoSnapshot();draft={id:uid(),page:page.pageIndex,type:this.activeTool,x:point.x,y:point.y,w:0,h:0,points:['draw','line'].includes(this.activeTool)?[point]:[],color:this.color(),size:this.size(),text:'',element:null};
            if(this.mode==='forms'){
                const base=this.optionValue('fieldName','campo');draft.name=this.activeTool==='radio'?base:`${base}_${this.items.length+1}`;draft.value='';draft.defaultValue='';draft.required=false;draft.readOnly=false;draft.maxLength=0;draft.multiselect=this.activeTool==='list';draft.font='Helvetica';draft.fontSize=12;draft.textColor='#000000';draft.borderColor='#000000';draft.backgroundColor='#ffffff';draft.borderWidth=1;draft.exportValue=this.optionValue('fieldExportValue',`Opção ${this.items.length+1}`);draft.options=[{label:'Opção 1',value:'Opção 1'},{label:'Opção 2',value:'Opção 2'}];
            }
            this.items.push(draft);this.renderItem(draft);
        });
        page.overlay.addEventListener('pointermove',event=>{
            if(!start||!draft||event.pointerId!==pointerId)return;const point=this.point(page.overlay,event);
            if(draft.type==='draw'){draft.points.push(point);this.updateDrawBounds(draft);this.renderItem(draft);return}
            if(draft.type==='line'){draft.points[1]=point;draft.x=Math.min(start.x,point.x);draft.y=Math.min(start.y,point.y);draft.w=Math.max(.008,Math.abs(point.x-start.x));draft.h=Math.max(.008,Math.abs(point.y-start.y));this.renderItem(draft);return}
            draft.x=Math.min(start.x,point.x);draft.y=Math.min(start.y,point.y);draft.w=Math.abs(point.x-start.x);draft.h=Math.abs(point.y-start.y);this.renderItem(draft);
        });
        const finish=event=>{if(!start||!draft||event.pointerId!==pointerId)return;if(draft.type==='draw')this.updateDrawBounds(draft);else if(draft.w<.015||draft.h<.015){if(draft.type==='check'){draft.w=.055;draft.h=.045}else this.removeItem(draft.id,false)}const created=this.items.includes(draft)?draft:null;draft=null;start=null;pointerId=null;this.updateHistoryButtons();if(this.mode==='forms'&&created){this.refreshFieldPicker();this.selectItem(created.id);}};
        page.overlay.addEventListener('pointerup',finish);page.overlay.addEventListener('pointercancel',finish);
    }
    point(overlay,event){const r=overlay.getBoundingClientRect();return{x:clamp((event.clientX-r.left)/r.width,0,1),y:clamp((event.clientY-r.top)/r.height,0,1)}}
    addText(page,point){const text=this.optionValue('editText','Novo texto').trim();if(!text){alert('Digite o texto nas opções antes de clicar na página.');return}this.pushUndoSnapshot();const item={id:uid(),page:page.pageIndex,type:'text',x:clamp(point.x,0,.76),y:clamp(point.y,0,.94),w:.24,h:.06,text,color:this.color(),size:this.size(),element:null};this.items.push(item);this.selectedId=item.id;this.setTool('select')}
    addPresetText(page,point,type){const now=new Date(),values={date:now.toLocaleDateString('pt-BR'),time:now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}),signature:this.optionValue('signatureText','Assinatura').trim()||'Assinatura'};this.pushUndoSnapshot();const item={id:uid(),page:page.pageIndex,type:'text',subtype:type,x:clamp(point.x,0,.72),y:clamp(point.y,0,.94),w:.28,h:.06,text:values[type],color:this.color(),size:this.size(),element:null};this.items.push(item);this.selectedId=item.id;this.setTool('select')}
    async addImage(page,point){const file=this.optionRoot.querySelector('#overlayImage')?.files?.[0];if(!file){alert('Selecione uma imagem nas opções antes de posicioná-la.');return}const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)});const bitmap=await createImageBitmap(file),ratio=bitmap.width/bitmap.height;bitmap.close();const w=.28,h=Math.min(.3,w/(ratio*(page.overlay.clientWidth/page.overlay.clientHeight)));this.pushUndoSnapshot();const item={id:uid(),page:page.pageIndex,type:'image',x:clamp(point.x-w/2,0,1-w),y:clamp(point.y-h/2,0,1-h),w,h,dataUrl,element:null};this.items.push(item);this.selectedId=item.id;this.setTool('select')}
    color(){return this.optionValue('color','#ff5a0a')}
    size(){return clamp(Number(this.optionValue('fontSize','18'))||18,4,150)}
    optionValue(id,fallback){const el=this.optionRoot.querySelector(`#${id}`);return el&&el.value!==''?el.value:fallback}
    renderItems(){this.pages.forEach(p=>p.overlay.querySelectorAll('.visual-item').forEach(el=>el.remove()));this.items.forEach(item=>this.renderItem(item))}
    renderItem(item){
        if(item.hiddenField)return;
        const page=this.pages.find(p=>p.pageIndex===item.page);if(!page)return;let el=item.element,needsBinding=false;
        if(!el||!el.isConnected){el=document.createElement('div');el.className=`visual-item item-${item.type}`;el.dataset.id=item.id;page.overlay.append(el);item.element=el;needsBinding=true}
        el.querySelectorAll('.visual-resize-handle').forEach(handle=>handle.remove());
        el.className=`visual-item item-${item.type}${item.subtype?` subtype-${item.subtype}`:''}${this.selectedId===item.id?' selected':''}`;el.style.inset='auto';el.style.left=`${item.x*100}%`;el.style.top=`${item.y*100}%`;el.style.width=`${Math.max(item.w||.01,.008)*100}%`;el.style.height=`${Math.max(item.h||.01,.008)*100}%`;
        if(this.mode==='forms'){
            if(item.type==='text'){let input=el.querySelector('.visual-form-value');if(!input){el.innerHTML=`<textarea class="visual-form-value" rows="1" placeholder="Digite o valor" aria-label="Valor de ${this.escape(item.name)}"></textarea><small></small>`;input=el.querySelector('.visual-form-value')}if(document.activeElement!==input)input.value=item.value||'';el.querySelector('small').textContent=item.name}
            else if(item.type==='signature'){el.textContent='Assinatura: '+item.name;el.setAttribute('aria-label','Campo de assinatura '+item.name);}
            else if(!el.querySelector('.visual-form-choice')){
                const control=document.createElement(['dropdown','list'].includes(item.type)?'select':'input');control.className='visual-form-choice';control.setAttribute('aria-label',`Valor de ${item.name}`);
                if(['dropdown','list'].includes(item.type)){const choices=item.options?.length?item.options:[{value:'Opção 1',label:'Opção 1'},{value:'Opção 2',label:'Opção 2'},{value:'Opção 3',label:'Opção 3'}];control.multiple=!!item.multiselect;if(item.type==='list')control.size=3;const selected=Array.isArray(item.value)?item.value:[item.value];for(const choice of choices)control.add(new Option(choice.label,choice.value,false,selected.includes(choice.value)));if(!item.multiselect&&!selected.some(Boolean))control.selectedIndex=-1;}
                else{control.type='checkbox';control.checked=!!item.value&&item.value!=='Off'&&(item.type!=='radio'||item.value===item.exportValue);}
                control.addEventListener('pointerdown',event=>event.stopPropagation());control.addEventListener('focus',()=>{this.selectedId=item.id;this.syncFormOptions(item);});control.addEventListener('change',()=>{this.pushUndoSnapshot();item.value=['dropdown','list'].includes(item.type)?(item.multiselect?[...control.selectedOptions].map(o=>o.value):control.value):control.checked?(item.exportValue||'Yes'):'Off';this.shareFormValue(item);this.renderItems();this.syncFormOptions(item);});
                el.replaceChildren(control,Object.assign(document.createElement('small'),{textContent:item.name}));
            }
            el.querySelector('.visual-form-value,.visual-form-choice')?.toggleAttribute('disabled',!!item.readOnly);
            if(item.appearanceDirty){el.style.background=item.backgroundColor;el.style.borderColor=item.borderColor;el.style.borderWidth=`${item.borderWidth}px`;const control=el.querySelector('.visual-form-value,.visual-form-choice');if(control){control.style.color=item.textColor;control.style.fontSize=`${item.fontSize}px`;control.style.fontFamily=item.font==='TimesRoman'?'Times New Roman':item.font;}}
        }
        else if(item.type==='text'){if(document.activeElement!==el&&el.dataset.renderedText!==item.text){el.dataset.renderedText=item.text;el.replaceChildren();if(item.runs&&item.text===item.runs.map(run=>run.text).join('')){for(const run of item.runs){const span=document.createElement('span');span.textContent=run.text;span.style.fontWeight=run.font?.weight||'normal';span.style.fontStyle=run.font?.style||'normal';span.style.color=run.color||item.color;span.style.fontFamily=(run.font?.name||'Arial').replace(/^[A-Z]{6}\+/,'').replace(/^Helvetica.*$/,'Arial').replace(/^Times.*$/,'Times New Roman').replace(/^Courier.*$/,'Courier New');span.style.fontSize=((run.font?.size||item.size)/item.size)+'em';el.append(span);}}else el.textContent=item.text;}el.style.fontFamily=item.fontName||'Arial';el.style.writingMode=Math.abs(item.rotation||0)>45?(item.rotation<0?'sideways-lr':'vertical-rl'):'horizontal-tb';el.style.color=item.color;el.style.fontSize=`${Math.max(10,item.size*(page.overlay.clientWidth/page.base.width))}px`;el.contentEditable=this.selectedId===item.id?'true':'false';if(item.originalRect)el.style.background='#fff';}
        else if(item.type==='original-removed'){el.style.background='#fff';el.style.pointerEvents='none';el.textContent='';}
        else if(item.type==='image'){el.innerHTML=`<img src="${item.dataUrl}" alt="Imagem adicionada">`}
        else if(item.type==='draw'||item.type==='line'){el.style.pointerEvents=item.type==='draw'&&this.activeTool!=='select'?'none':'auto';this.drawStroke(el,item,page)}
        else if(item.type==='check'){el.style.setProperty('--item-color',item.color);el.innerHTML='<svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="10,55 38,82 92,12"/></svg>'}
        else{el.style.setProperty('--item-color',item.type==='whiteout'?'#fff':item.color);el.style.setProperty('--item-opacity',item.type==='whiteout'?'1':item.type==='highlight'?'.3':'.14')}
        if(this.selectedId===item.id&&this.isResizable(item))this.addResizeHandles(el);
        if(needsBinding)this.bindItem(item,el);
    }
    drawStroke(el,item,page){let svg=el.querySelector('svg');if(!svg){el.innerHTML='<svg viewBox="0 0 1000 1000" preserveAspectRatio="none"><polyline/></svg>';svg=el.querySelector('svg')}const line=svg.querySelector('polyline'),w=Math.max(item.w,.001),h=Math.max(item.h,.001);line.setAttribute('points',(item.points||[]).map(p=>`${((p.x-item.x)/w)*1000},${((p.y-item.y)/h)*1000}`).join(' '));line.setAttribute('stroke',item.color);line.setAttribute('stroke-width',String(Math.max(4,(item.size/3)/(Math.min(w*page.overlay.clientWidth,h*page.overlay.clientHeight)||1)*1000)));line.setAttribute('fill','none');line.setAttribute('stroke-linecap','round');line.setAttribute('stroke-linejoin','round')}
    updateDrawBounds(item){if(!item.points?.length)return;const pad=.006,minX=Math.min(...item.points.map(p=>p.x)),maxX=Math.max(...item.points.map(p=>p.x)),minY=Math.min(...item.points.map(p=>p.y)),maxY=Math.max(...item.points.map(p=>p.y));item.x=clamp(minX-pad,0,1);item.y=clamp(minY-pad,0,1);item.w=Math.max(.012,Math.min(1-item.x,maxX-minX+pad*2));item.h=Math.max(.012,Math.min(1-item.y,maxY-minY+pad*2))}
    isResizable(item){return(this.mode==='edit'&&item.type!=='draw')||this.mode==='forms'}
    addResizeHandles(el){['nw','ne','se','sw'].forEach(name=>{const handle=document.createElement('i');handle.className='visual-resize-handle';handle.dataset.resize=name;handle.setAttribute('aria-hidden','true');el.append(handle)})}
    bindItem(item,el){
        el.addEventListener('input',()=>{if(this.mode==='edit'&&item.type==='text')item.text=el.textContent.replace(/\r/g,'')});
        if(this.mode==='forms'&&item.type==='text'){
            const input=el.querySelector('.visual-form-value');
            input?.addEventListener('focus',()=>{this.formEditSnapshot=this.snapshot();this.formEditInitial=item.value||'';this.selectedId=item.id;this.items.forEach(value=>value.element?.classList.toggle('selected',value.id===item.id));this.renderItem(item);this.syncFormOptions(item)});
            input?.addEventListener('input',()=>{item.value=input.value;this.shareFormValue(item)});
            input?.addEventListener('keydown',event=>{if(event.key!=='Enter'||event.isComposing)return;event.preventDefault();if(event.ctrlKey||event.metaKey){const start=input.selectionStart,end=input.selectionEnd;input.setRangeText('\n',start,end,'end');item.value=input.value;input.dispatchEvent(new Event('input',{bubbles:true}))}else input.blur()});
            input?.addEventListener('blur',()=>{item.value=input.value;this.shareFormValue(item);if(item.value!==this.formEditInitial&&this.formEditSnapshot)this.pushUndoSnapshot(this.formEditSnapshot);this.formEditSnapshot=null;this.formEditInitial=null;this.renderItems()});
        }
        if(this.mode==='edit'&&item.type==='text'){
            el.addEventListener('focus',()=>{if(!this.textEditSnapshot){this.textEditSnapshot=this.snapshot();this.textEditInitial=item.text||''}});
            el.addEventListener('keydown',event=>{if(event.key!=='Enter'||event.isComposing)return;event.preventDefault();if(event.ctrlKey||event.metaKey){const selection=getSelection();if(selection?.rangeCount){const range=selection.getRangeAt(0),breakNode=document.createTextNode('\n');range.deleteContents();range.insertNode(breakNode);range.setStartAfter(breakNode);range.collapse(true);selection.removeAllRanges();selection.addRange(range);item.text=el.textContent.replace(/\r/g,'')}}else el.blur()});
            el.addEventListener('blur',()=>{item.text=el.textContent.replace(/\r/g,'');if(item.text!==this.textEditInitial&&this.textEditSnapshot)this.pushUndoSnapshot(this.textEditSnapshot);this.textEditSnapshot=null;this.textEditInitial=null;this.selectedId=null;this.renderItems()});
        }
        el.addEventListener('pointerdown',event=>{
            if(event.target.closest('.visual-form-value,.visual-form-choice')){event.stopPropagation();return}
            if(this.activeTool!=='select'){event.stopPropagation();return}event.stopPropagation();event.preventDefault();this.selectItem(item.id);const page=this.pages.find(p=>p.pageIndex===item.page),start=this.point(page.overlay,event),origin={x:item.x,y:item.y,w:item.w,h:item.h,points:item.points?.map(point=>({...point}))},handle=event.target.closest('[data-resize]')?.dataset.resize,before=this.snapshot();let changed=false;el.setPointerCapture(event.pointerId);
            const move=e=>{const p=this.point(page.overlay,e),dx=p.x-start.x,dy=p.y-start.y;if(!changed){this.pushUndoSnapshot(before);changed=true}if(handle){this.resizeItem(item,origin,handle,dx,dy)}else{const nx=clamp(origin.x+dx,0,1-origin.w),ny=clamp(origin.y+dy,0,1-origin.h),mx=nx-origin.x,my=ny-origin.y;item.x=nx;item.y=ny;if(item.points)item.points=origin.points.map(point=>({x:point.x+mx,y:point.y+my}))}this.renderItem(item)};
            const up=()=>{el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);el.removeEventListener('pointercancel',up)};el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);
        });
        el.addEventListener('dblclick',event=>{event.stopPropagation();if(this.mode==='edit'&&item.type==='text'){this.selectItem(item.id);const current=item.element;current.contentEditable='true';current.focus();const range=document.createRange();range.selectNodeContents(current);range.collapse(false);const selection=getSelection();selection.removeAllRanges();selection.addRange(range)}});
    }
    resizeItem(item,origin,handle,dx,dy){const minW=item.type==='text'?.05:.025,minH=.025;let left=origin.x,top=origin.y,right=origin.x+origin.w,bottom=origin.y+origin.h;if(handle.includes('w'))left=clamp(origin.x+dx,0,right-minW);if(handle.includes('e'))right=clamp(origin.x+origin.w+dx,left+minW,1);if(handle.includes('n'))top=clamp(origin.y+dy,0,bottom-minH);if(handle.includes('s'))bottom=clamp(origin.y+origin.h+dy,top+minH,1);item.x=left;item.y=top;item.w=right-left;item.h=bottom-top;if(item.points&&origin.points){item.points=origin.points.map(point=>({x:left+((point.x-origin.x)/origin.w)*item.w,y:top+((point.y-origin.y)/origin.h)*item.h}))}}
    selectItem(id){this.selectedId=id;this.items.forEach(item=>this.renderItem(item));const item=this.items.find(value=>value.id===id);if(item)this.syncOptionsFromItem(item)}
    syncOptionsFromItem(item){if(this.mode==='forms'){this.syncFormOptions(item);return;}const text=this.optionRoot.querySelector('#editText'),signature=this.optionRoot.querySelector('#signatureText'),size=this.optionRoot.querySelector('#fontSize'),color=this.optionRoot.querySelector('#color');if(text&&item.type==='text')text.value=item.text||'';if(signature&&item.subtype==='signature')signature.value=item.text||'';if(size&&item.size)size.value=String(item.size);if(color&&item.color)color.value=item.color}
    applyOptionToSelected(target){const item=this.items.find(value=>value.id===this.selectedId);if(!item)return;if(target.id==='editText'&&item.type==='text')item.text=target.value;if(target.id==='signatureText'&&item.subtype==='signature')item.text=target.value;if(target.id==='fontSize'&&['text','draw','line','check'].includes(item.type))item.size=this.size();if(target.id==='color'&&item.type!=='image'&&item.type!=='whiteout')item.color=target.value;if(item.runs&&['color','fontSize'].includes(target.id)){item.runs=item.runs.map(run=>({...run,color:target.id==='color'?item.color:run.color,font:{...run.font,size:target.id==='fontSize'?item.size:run.font?.size}}));if(item.element)delete item.element.dataset.renderedText;}this.renderItem(item)}
    fieldIcon(type){return{checkbox:'☑',radio:'◉',dropdown:'▾',text:'T'}[type]||'T'}
    cleanFieldName(){return(this.optionValue('fieldName','campo').replace(/[^a-zA-Z0-9_-]/g,'_')||'campo')}
    setupFormOptions(){
        const type=this.optionRoot.querySelector('#fieldType');
        if(type){type.value=this.activeTool;this.formType=type;this.formTypeSync=()=>this.setTool(type.value);type.addEventListener('change',this.formTypeSync)}
        this.optionChangeHandler=event=>{
            const target=event.target;if(target.id==='fieldPicker'){this.selectItem(target.value||null);return;}
            const item=this.items.find(i=>i.id===this.selectedId);if(!item)return;
            const properties={fieldName:'name',fieldCurrentValue:'value',fieldDefaultValue:'defaultValue',fieldRequired:'required',fieldReadOnly:'readOnly',fieldMaxLength:'maxLength',fieldMultiselect:'multiselect',fieldFont:'font',fieldFontSize:'fontSize',fieldTextColor:'textColor',fieldBorderColor:'borderColor',fieldBackgroundColor:'backgroundColor',fieldBorderWidth:'borderWidth',fieldExportValue:'exportValue'};
            const property=properties[target.id];if(!property)return;this.pushUndoSnapshot();
            let value=target.type==='checkbox'?target.checked:target.type==='number'?Number(target.value):target.value;
            if(['value','defaultValue'].includes(property)&&['list','dropdown'].includes(item.type))value=item.multiselect?String(value).split('\n').filter(Boolean):String(value);
            const logical=item.originalName||item.name;
            const widgets=property==='exportValue'?[item]:this.items.filter(i=>(i.originalName||i.name)===logical);
            for(const widget of widgets){widget[property]=value;if(['font','fontSize','textColor','borderColor','backgroundColor','borderWidth'].includes(property))widget.appearanceDirty=true;widget.element?.remove();widget.element=null;}
            this.renderItems();this.refreshFieldPicker();this.syncFormOptions(item);
        };this.optionRoot.addEventListener('change',this.optionChangeHandler);this.refreshFieldPicker();
        this.formKeyHandler=event=>{const typing=event.target.matches?.('input,textarea,select')||event.target.isContentEditable;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&!typing){event.preventDefault();event.shiftKey?this.redo():this.undo();return}if(!typing&&(event.key==='Delete'||event.key==='Backspace')&&this.selectedId){event.preventDefault();this.removeItem(this.selectedId)}if(event.key==='Escape'&&typing)event.target.blur();else if(!typing&&event.key==='Escape')this.selectItem(null)};document.addEventListener('keydown',this.formKeyHandler);
    }
    shareFormValue(item){const key=item.originalName||item.name;for(const other of this.items)if(other!==item&&(other.originalName||other.name)===key){other.value=Array.isArray(item.value)?[...item.value]:item.value;const input=other.element?.querySelector('.visual-form-value');if(input&&document.activeElement!==input)input.value=item.value;else{other.element?.remove();other.element=null;}}}
    refreshFieldPicker(){const picker=this.optionRoot.querySelector('#fieldPicker');if(!picker)return;picker.replaceChildren(new Option('Selecione um campo',''),...this.items.map(item=>new Option(`${item.name} · ${item.hiddenField?'sem widget visível':'página '+(item.page+1)} · ${item.type}`,item.id)));picker.value=this.selectedId||'';}
    syncFormOptions(item){
        const mapping={fieldPicker:item.id,fieldName:item.name,fieldCurrentValue:item.value,fieldDefaultValue:item.defaultValue,fieldRequired:item.required,fieldReadOnly:item.readOnly,fieldMaxLength:item.maxLength,fieldMultiselect:item.multiselect,fieldFont:item.font,fieldFontSize:item.fontSize,fieldTextColor:item.textColor,fieldBorderColor:item.borderColor,fieldBackgroundColor:item.backgroundColor,fieldBorderWidth:item.borderWidth,fieldExportValue:item.exportValue};
        for(const [id,value] of Object.entries(mapping)){const control=this.optionRoot.querySelector('#'+id);if(!control)continue;if(control.type==='checkbox')control.checked=!!value;else control.value=Array.isArray(value)?value.join('\n'):value??'';}
        for(const id of ['fieldCurrentValue','fieldDefaultValue'])this.optionRoot.querySelector('#'+id).disabled=item.type==='signature';
        this.optionRoot.querySelector('#fieldMaxLength').disabled=item.type!=='text';this.optionRoot.querySelector('#fieldMultiselect').disabled=!['dropdown','list'].includes(item.type);this.optionRoot.querySelector('#fieldExportValue').disabled=item.type!=='radio'||!!item.originalName;
    }
    removeItem(id,record=true){const i=this.items.findIndex(x=>x.id===id);if(i>=0){if(record)this.pushUndoSnapshot();if(this.items[i].originalRect){const item=this.items[i];Object.assign(item,item.originalState,{type:'original-removed',deleted:true});this.selectedId=null;this.renderItems();return;}const originalName=this.items[i].originalName;const removed=this.items.filter(item=>item.id===id||(this.mode==='forms'&&originalName&&item.originalName===originalName));removed.forEach(item=>item.element?.remove());this.items=this.items.filter(item=>!removed.includes(item));this.selectedId=null;this.renderItems();this.updateHistoryButtons();if(this.mode==='forms')this.refreshFieldPicker()}}
    duplicateSelected(){const item=this.items.find(value=>value.id===this.selectedId);if(!item)return;this.pushUndoSnapshot();const copy={...item,id:uid(),x:clamp(item.x+.02,0,1-item.w),y:clamp(item.y+.02,0,1-item.h),points:item.points?.map(point=>({x:clamp(point.x+.02,0,1),y:clamp(point.y+.02,0,1)})),element:null};delete copy.originalRect;delete copy.originalState;delete copy.originalName;delete copy.originalId;this.items.push(copy);this.selectItem(copy.id)}
    undo(){if(!this.undoStack.length)return;this.redoStack.push(this.snapshot());this.restore(this.undoStack.pop())}
    redo(){if(!this.redoStack.length)return;this.undoStack.push(this.snapshot());this.restore(this.redoStack.pop())}
    updateHistoryButtons(){const undo=this.toolbar?.querySelector('[data-action="undo"]'),redo=this.toolbar?.querySelector('[data-action="redo"]');if(undo)undo.disabled=!this.undoStack.length;if(redo)redo.disabled=!this.redoStack.length}
    buildCropOverlay(page){
        page.overlay.innerHTML='<div class="crop-shade crop-top"></div><div class="crop-shade crop-left"></div><div class="crop-shade crop-right"></div><div class="crop-shade crop-bottom"></div><div class="crop-box"><span class="crop-label">Área preservada</span><i data-handle="nw"></i><i data-handle="n"></i><i data-handle="ne"></i><i data-handle="e"></i><i data-handle="se"></i><i data-handle="s"></i><i data-handle="sw"></i><i data-handle="w"></i></div>';
        this.cropBox=page.overlay.querySelector('.crop-box');this.cropShades=[...page.overlay.querySelectorAll('.crop-shade')];
        page.overlay.addEventListener('pointerdown',event=>{
            const handle=event.target.dataset.handle,moveBox=event.target.closest('.crop-box')&&!handle;if(!handle&&!moveBox)return;event.preventDefault();const start=this.point(page.overlay,event),origin={...this.crop};page.overlay.setPointerCapture(event.pointerId);
            const move=e=>{const p=this.point(page.overlay,e),dx=p.x-start.x,dy=p.y-start.y,min=.05;let c={...origin};if(moveBox){const width=1-origin.left-origin.right,height=1-origin.top-origin.bottom;c.left=clamp(origin.left+dx,0,1-width);c.right=1-c.left-width;c.top=clamp(origin.top+dy,0,1-height);c.bottom=1-c.top-height}else{if(handle.includes('w'))c.left=clamp(origin.left+dx,0,1-origin.right-min);if(handle.includes('e'))c.right=clamp(origin.right-dx,0,1-origin.left-min);if(handle.includes('n'))c.top=clamp(origin.top+dy,0,1-origin.bottom-min);if(handle.includes('s'))c.bottom=clamp(origin.bottom-dy,0,1-origin.top-min)}this.crop=c;this.renderCrop();this.updateCropOptions()};
            const up=e=>{page.overlay.removeEventListener('pointermove',move);page.overlay.removeEventListener('pointerup',up);page.overlay.removeEventListener('pointercancel',up)};page.overlay.addEventListener('pointermove',move);page.overlay.addEventListener('pointerup',up);page.overlay.addEventListener('pointercancel',up);
        });
    }
    setupCropOptions(){
        const horizontal=this.optionRoot.querySelector('#horizontal'),vertical=this.optionRoot.querySelector('#vertical');if(horizontal)horizontal.value='20';if(vertical)vertical.value='20';this.applySymmetricCrop(20,20);
        const readout=document.createElement('div');readout.className='crop-values';readout.innerHTML='<strong>Margens visuais</strong><span></span>';this.optionRoot.append(readout);this.cropReadout=readout.querySelector('span');
        const sync=()=>{this.applySymmetricCrop(Number(horizontal?.value)||0,Number(vertical?.value)||0);this.renderCrop();this.updateCropOptions(false)};this.cropControls=[horizontal,vertical];this.cropSync=sync;horizontal?.addEventListener('input',sync);vertical?.addEventListener('input',sync);this.updateCropOptions(false);
    }
    applySymmetricCrop(horizontalPt,verticalPt){const base=this.pages[0]?.base;if(!base)return;this.crop.left=this.crop.right=clamp(horizontalPt/base.width,0,.45);this.crop.top=this.crop.bottom=clamp(verticalPt/base.height,0,.45)}
    updateCropOptions(updateInputs=true){const base=this.pages[0]?.base;if(!base)return;const vals={e:this.crop.left*base.width,d:this.crop.right*base.width,t:this.crop.top*base.height,b:this.crop.bottom*base.height};if(this.cropReadout)this.cropReadout.textContent=`Esq. ${vals.e.toFixed(0)} pt • Dir. ${vals.d.toFixed(0)} pt • Topo ${vals.t.toFixed(0)} pt • Base ${vals.b.toFixed(0)} pt`;if(updateInputs){const h=this.optionRoot.querySelector('#horizontal'),v=this.optionRoot.querySelector('#vertical');if(h)h.value=((vals.e+vals.d)/2).toFixed(0);if(v)v.value=((vals.t+vals.b)/2).toFixed(0)}}
    renderCrop(){if(!this.cropBox)return;const c=this.crop,w=1-c.left-c.right,h=1-c.top-c.bottom;Object.assign(this.cropBox.style,{left:`${c.left*100}%`,top:`${c.top*100}%`,width:`${w*100}%`,height:`${h*100}%`});const [top,left,right,bottom]=this.cropShades;Object.assign(top.style,{left:'0',top:'0',width:'100%',height:`${c.top*100}%`});Object.assign(bottom.style,{left:'0',top:`${(1-c.bottom)*100}%`,width:'100%',height:`${c.bottom*100}%`});Object.assign(left.style,{left:'0',top:`${c.top*100}%`,width:`${c.left*100}%`,height:`${h*100}%`});Object.assign(right.style,{left:`${(1-c.right)*100}%`,top:`${c.top*100}%`,width:`${c.right*100}%`,height:`${h*100}%`})}
}

