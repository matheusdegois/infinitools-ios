/* Ponte de exportação com mensagens de origem restrita e transferência em blocos. */
(() => {
  'use strict';
  if (window.__infinitoolsAndroid) return;
  window.__infinitoolsAndroid = true;
  const native = window.InfinitoolsNative;
  if (!native) return;
  const browserFetch=window.fetch.bind(window);
  let pdfLibrary;
  async function localPdfLibrary(){
    if(window.PDFLib)return window.PDFLib;
    if(!pdfLibrary)pdfLibrary=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/assets/vendor/pdf-lib.min.js';script.onload=()=>resolve(window.PDFLib);script.onerror=()=>reject(new Error('Motor PDF indisponível.'));document.head.append(script);});
    return pdfLibrary;
  }
  // O site envia páginas rasterizadas ao PHP. O Android monta o mesmo PDF localmente.
  window.fetch=async(input,options)=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href),form=options?.body;
    if(url.origin===location.origin&&url.pathname==='/api/raster-pdf.php'&&form instanceof FormData&&!form.get('password')&&!form.get('pdfa')){
      const lib=await localPdfLibrary(),pdf=await lib.PDFDocument.create(),metadata=JSON.parse(form.get('metadata')||'{"pages":[]}');
      const pages=form.getAll('pages[]');if(!pages.length)throw new Error('Nenhuma página foi recebida.');
      for(let i=0;i<pages.length;i++){
        const image=await pdf.embedJpg(await pages[i].arrayBuffer()),spec=metadata.pages[i]||{},w=Number(spec.widthPt)||image.width,h=Number(spec.heightPt)||image.height;
        const page=pdf.addPage([w,h]);page.drawImage(image,{x:0,y:0,width:w,height:h});
      }
      pdf.setProducer('Infinitools iOS');return new Response(await pdf.save(),{status:200,headers:{'Content-Type':'application/pdf'}});
    }
    return browserFetch(input,options);
  };
  let sequence = 0;
  const pending = new Map();
  native.onmessage = event => {
    try { const response=JSON.parse(event.data), p=pending.get(response.requestId); if(!p)return;
      pending.delete(response.requestId); clearTimeout(p.timeout);
      response.error ? p.reject(new Error(response.error)) : p.resolve(response);
    } catch(error) { console.warn('Resposta iOS inválida', error); }
  };
  function send(type, data={}) {
    return new Promise((resolve,reject)=>{
      const requestId=String(++sequence);
      const timeout=setTimeout(()=>{pending.delete(requestId);reject(new Error('O iOS não respondeu à exportação.'));},60000);
      pending.set(requestId,{resolve,reject,timeout});
      native.postMessage(JSON.stringify({type,requestId,...data}));
    });
  }
  function toast(message) {
    if(!document.body)return; // A página pode estar sendo encerrada durante uma resposta nativa.
    const el=document.createElement('div');el.className='android-toast';el.textContent=message;el.setAttribute('role','status');document.body.append(el);setTimeout(()=>el.remove(),5000);
  }
  let exporting=false;
  async function exportBlob(blob, name) {
    if(exporting){toast('Aguarde a exportação atual.');return;}
    exporting=true;
    let transfer;
    try {
      transfer=await send('start',{name:name||'arquivo',mime:blob.type||'application/octet-stream',size:blob.size});
      for(let offset=0;offset<blob.size;offset+=196608){
        const bytes=new Uint8Array(await blob.slice(offset,offset+196608).arrayBuffer());
        let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
        await send('chunk',{transferId:transfer.transferId,data:btoa(binary)});
      }
      await send('finish',{transferId:transfer.transferId});toast('Arquivo salvo. Abra a aba Arquivos para compartilhar ou salvar em outra pasta.');
    } catch(error){if(transfer)send('abort',{transferId:transfer.transferId}).catch(()=>{});toast('Não foi possível salvar: '+error.message);}
    finally{exporting=false;}
  }
  window.infinitoolsExportUrl=(url,name)=>fetch(url).then(r=>{if(!r.ok)throw new Error('Falha no download.');return r.blob();}).then(blob=>exportBlob(blob,name)).catch(e=>toast(e.message));
  function handle(anchor) {
    const href=anchor.href;
    if(!href||(!anchor.hasAttribute('download')&&!/^(blob:|data:)/.test(href)))return false;
    // Start reading immediately, before the tool revokes its object URL.
    const response=fetch(href);
    response.then(r=>{if(!r.ok)throw new Error('Falha ao ler o arquivo.');return r.blob();}).then(blob=>exportBlob(blob,anchor.download)).catch(e=>toast(e.message));
    return true;
  }
  document.addEventListener('click',event=>{
    const anchor=event.target.closest?.('a');if(anchor&&handle(anchor)){event.preventDefault();event.stopImmediatePropagation();}
  },true);
  const originalClick=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){if(!handle(this))originalClick.call(this);};
  window.infinitoolsImportShared=async()=>{
    try{
      const response=await send('shared');if(!response.files?.length){toast('Nenhum arquivo recebido.');return;}
      const input=[...document.querySelectorAll('input[type=file]')].find(el=>!el.disabled);
      if(!input){toast('Selecione uma ferramenta com entrada de arquivos.');return;}
      const dt=new DataTransfer();
      for(const item of (input.multiple?response.files:response.files.slice(0,1))){const blob=await fetch(item.url).then(r=>r.blob());dt.items.add(new File([blob],item.name,{type:item.mime}));}
      input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
      toast(dt.files.length+' arquivo(s) importado(s).');
    }catch(error){toast('Falha ao importar: '+error.message);}
  };
  // Prevent advertising/analytics preferences from starting third-party scripts.
  try{Object.defineProperty(window,'__infinitoolsAndroidNoAds',{value:true});}catch{}
  
  document.addEventListener('DOMContentLoaded',()=>{
    let lastResult=null,readyTimer;
    const updateReady=()=>{
      const anchor=[...document.querySelectorAll('a[download]')].find(a=>/^(blob:|data:)/.test(a.href)&&!a.closest('[hidden]'));
      const key=anchor?anchor.href:'';if(key===lastResult)return;lastResult=key;
      send('resultReady',{url:key,name:anchor?.download||'arquivo'}).catch(()=>{});
    };
    new MutationObserver(()=>{clearTimeout(readyTimer);readyTimer=setTimeout(updateReady,60);}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['href','download','hidden']});
    updateReady();
    const note=document.querySelector('aside.notice-card'),workspace=document.querySelector('.workspace');
    if(note&&workspace){const details=document.createElement('details');details.className='notice-card';const summary=document.createElement('summary');summary.textContent='Cuidados com o resultado';const content=document.createElement('div');content.innerHTML=note.innerHTML;details.append(summary,content);note.remove();workspace.append(details);}
    // O seletor de pasta webkitdirectory não funciona em WebViews Android.
    // ZIP preserva diretórios; seleção avulsa reutiliza a entrada de assets do editor.
    const folder=document.getElementById('importFolder');if(folder){folder.textContent='Adicionar arquivos';folder.onclick=()=>document.getElementById('assetInput').click();}
  },{once:true});
})();
