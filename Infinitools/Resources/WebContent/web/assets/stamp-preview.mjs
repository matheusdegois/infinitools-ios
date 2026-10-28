import {applyStamps,stampPages} from './pdf-stamps.mjs?v=1';

export class StampPreview {
    constructor({host,options,pdfjs,loadLibrary,getSettings}){
        Object.assign(this,{pdfjs,loadLibrary,getSettings});this.revision=0;this.fileRevision=0;this.index=0;this.file=null;this.source=null;this.total=0;
        this.host=document.createElement('section');this.host.className='stamp-preview';
        this.host.innerHTML='<h2>Prévia do carimbo</h2><p>Confira a aplicação antes de baixar o PDF. As opções atualizam a prévia automaticamente.</p><div class="stamp-preview-nav"><button type="button" data-previous aria-label="Página anterior">Anterior</button><label>Página <input type="number" min="1" value="1" step="1" aria-label="Página da prévia"></label><span data-count></span><button type="button" data-next aria-label="Próxima página">Próxima</button></div><p data-status role="status" aria-live="polite">Selecione um PDF para visualizar.</p><div class="stamp-preview-sheet"><canvas aria-label="Página do PDF com a prévia do carimbo" hidden></canvas></div>';
        host.append(this.host);this.canvas=this.host.querySelector('canvas');this.status=this.host.querySelector('[data-status]');this.pageInput=this.host.querySelector('input');this.previous=this.host.querySelector('[data-previous]');this.next=this.host.querySelector('[data-next]');
        this.previous.onclick=()=>this.go(this.index-1);this.next.onclick=()=>this.go(this.index+1);this.pageInput.onchange=()=>this.go(Number(this.pageInput.value)-1);
        const changed=()=>this.schedule();options.addEventListener('input',changed);options.addEventListener('change',changed);this.updateNavigation();
        window.addEventListener('pagehide',()=>this.destroy(),{once:true});
    }
    updateNavigation(){this.previous.disabled=!this.total||this.index===0;this.next.disabled=!this.total||this.index>=this.total-1;this.pageInput.disabled=!this.total;this.pageInput.value=String(this.index+1);this.pageInput.max=String(this.total||1);this.host.querySelector('[data-count]').textContent=this.total?'de '+this.total:'';}
    go(index){this.index=Math.max(0,Math.min(this.total-1,Number.isInteger(index)?index:0));this.updateNavigation();this.schedule();}
    cancel(){clearTimeout(this.timer);this.task?.cancel();this.task=null;}
    async loadFile(file){
        if(file===this.file)return;this.cancel();this.revision++;const id=++this.fileRevision;this.host.removeAttribute('aria-busy');this.file=file;this.source=null;this.total=0;this.index=0;this.canvas.hidden=true;this.canvas.width=this.canvas.height=1;this.updateNavigation();
        if(!file){this.status.textContent='Selecione um PDF para visualizar.';return;}
        this.status.textContent='Abrindo o PDF para a prévia…';
        try{if(file.size>80*1024*1024)throw new Error('A prévia aceita PDFs de até 80 MB.');const lib=await this.loadLibrary(),source=await lib.PDFDocument.load(await file.arrayBuffer(),{updateMetadata:false});if(id!==this.fileRevision||this.file!==file)return;this.source=source;this.total=source.getPageCount();this.updateNavigation();this.schedule();}
        catch(error){if(id===this.fileRevision)this.status.textContent=error.message||'Não foi possível abrir o PDF.';}
    }
    schedule(){
        this.cancel();const id=++this.revision;if(!this.source)return;this.status.textContent='Atualizando a prévia…';this.host.setAttribute('aria-busy','true');this.timer=setTimeout(()=>this.render(id),180);
    }
    async render(id){
        let loading,document,canvas;
        try{
            const settings=await this.getSettings();if(id!==this.revision)return;
            const selected=stampPages(settings.pages||'',this.total).includes(this.index),lib=await this.loadLibrary(),copy=await lib.PDFDocument.create(),[page]=await copy.copyPages(this.source,[this.index]);copy.addPage(page);
            if(selected)await applyStamps(copy,lib,{...settings,pages:''});
            if(id!==this.revision)return;
            loading=this.pdfjs.getDocument({data:await copy.save({useObjectStreams:true})});document=await loading.promise;if(id!==this.revision)return;
            const pdfPage=await document.getPage(1),base=pdfPage.getViewport({scale:1}),viewport=pdfPage.getViewport({scale:Math.min(1.8,1000/base.width,1400/base.height)});
            canvas=window.document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
            if(id!==this.revision)return;const task=pdfPage.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport,background:'#fff'});this.task=task;await task.promise;
            if(id!==this.revision)return;this.canvas.width=canvas.width;this.canvas.height=canvas.height;this.canvas.getContext('2d').drawImage(canvas,0,0);this.canvas.hidden=false;this.canvas.dataset.page=String(this.index+1);this.canvas.dataset.applied=String(selected);this.status.textContent=selected?'Carimbo aplicado nesta página.':'Esta página não está na seleção e será exportada sem carimbo.';
        }catch(error){if(id===this.revision){this.canvas.hidden=true;this.status.textContent=error.message||'Não foi possível atualizar a prévia.';}}
        finally{if(canvas)canvas.width=canvas.height=1;if(document)await document.destroy();else if(loading)await loading.destroy();if(id===this.revision){this.task=null;this.host.removeAttribute('aria-busy');}}
    }
    destroy(){this.revision++;this.fileRevision++;this.cancel();this.source=null;this.file=null;this.canvas.width=this.canvas.height=1;}
}
