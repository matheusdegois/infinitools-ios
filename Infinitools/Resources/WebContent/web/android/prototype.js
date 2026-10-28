/* Editor de protótipos do Infinitools, adaptado para uso local no Android. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id), textExt=/\.(html?|css|m?js|json|txt|svg)$/i;
  const MAX=20*1024*1024, SINGLE=5*1024*1024, allowed=/\.(html?|css|m?js|json|txt|svg|png|jpe?g|webp|gif|ico|woff2?)$/i;
  let files=new Map(), current='', editor, changing=false, busy=false, mode='add';
  let previewBudget=8*1024*1024;
  const initial={
    'index.html':'<!doctype html>\n<html lang="pt-BR">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>Meu protótipo</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <main class="card">\n    <span>MEU PRIMEIRO PROTÓTIPO</span>\n    <h1>Uma ideia pronta para o mundo.</h1>\n    <p>Edite os arquivos ao lado e dê vida ao seu projeto.</p>\n    <button id="hello">Experimentar</button>\n    <p id="message"></p>\n  </main>\n  <script src="script.js"></script>\n</body>\n</html>',
    'style.css':'* { box-sizing: border-box; }\nbody { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #eef2ff; color: #15213b; font: 16px system-ui; padding: 24px; }\n.card { max-width: 600px; background: white; padding: 40px; border-radius: 24px; box-shadow: 0 20px 60px #25396318; }\nspan { color: #4267cf; font-size: 11px; letter-spacing: 2px; font-weight: 700; }\nh1 { font-size: clamp(28px, 7vw, 44px); letter-spacing: -1.5px; }\np { line-height: 1.6; }\nbutton { border: 0; background: #4267cf; color: white; padding: 13px 20px; border-radius: 12px; cursor: pointer; font: inherit; }',
    'script.js':'document.getElementById("hello").addEventListener("click", () => {\n  document.getElementById("message").textContent = "Seu protótipo já está funcionando!";\n});'
  };
  function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
  function path(name){if(typeof name!=='string'||name.length>240||! /^[a-zA-Z0-9_ /.-]+$/.test(name)||name.split('/').some(p=>!p||p[0]==='.'||p.trim()!==p||p.endsWith('.')||/\.(php\d*|phtml|cgi|pl|py|sh|exe|dll|htaccess)(\.|$)/i.test(p))||!allowed.test(name))throw Error('Nome ou formato inválido. Use arquivos estáticos e caminhos como css/style.css.');return name;}
  function validate(map){if(!map.size||map.size>200)throw Error('Use entre 1 e 200 arquivos.');let total=0;const seen=new Set();for(const [name,bytes]of map){path(name);if(seen.has(name.toLowerCase()))throw Error('Há nomes repetidos.');seen.add(name.toLowerCase());if(bytes.length>SINGLE)throw Error(name+': limite de 5 MB por arquivo.');total+=bytes.length;}if(total>MAX)throw Error('O projeto deve ter até 20 MB.');return total;}
  function b64(bytes){let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);}
  function mark(){$('draftStatus').textContent='Salvando rascunho…';clearTimeout(mark.timer);mark.timer=setTimeout(save,700);}
  const db=new Promise(resolve=>{try{const r=indexedDB.open('infinitools-prototypes',1);r.onupgradeneeded=()=>r.result.createObjectStore('draft');r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve(null);}catch{resolve(null);}});
  async function save(){const database=await db;if(!database){$('draftStatus').textContent='Armazenamento indisponível — baixe seu ZIP';return;}try{const t=database.transaction('draft','readwrite');t.objectStore('draft').put({files:[...files]},'current');t.oncomplete=()=>{$('draftStatus').textContent='Rascunho salvo neste aparelho';};t.onerror=()=>{$('draftStatus').textContent='Não foi possível salvar — baixe seu ZIP';};}catch{$('draftStatus').textContent='Não foi possível salvar — baixe seu ZIP';}}
  async function restore(){const database=await db;if(!database)return null;return new Promise(resolve=>{try{const r=database.transaction('draft').objectStore('draft').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve(null);}catch{resolve(null);}});}
  function controls(value){busy=value;document.querySelectorAll('.prototype button').forEach(b=>b.disabled=value);editor?.setOption('readOnly',value);}
  async function work(fn){if(busy)return;controls(true);try{await fn();}catch(e){status(e.message,true);}finally{controls(false);}}
  function showFile(name){current=name;changing=true;const isText=textExt.test(name),text=isText?new TextDecoder().decode(files.get(name)):'';$('currentFile').textContent=name;$('binaryFile').hidden=isText;const cm=editor?.getWrapperElement();if(cm)cm.hidden=!isText;else $('code').hidden=!isText;if(editor){editor.setValue(text);editor.setOption('mode',/\.css$/i.test(name)?'css':/\.m?js$/i.test(name)?'javascript':/\.json$/i.test(name)?{name:'javascript',json:true}:'htmlmixed');editor.refresh();}else $('code').value=text;changing=false;renderList();}
  function renderList(){const list=$('fileList');list.replaceChildren();for(const name of [...files.keys()].sort()){const b=document.createElement('button');b.type='button';b.textContent=name;b.classList.toggle('active',name===current);b.setAttribute('aria-pressed',String(name===current));b.addEventListener('click',()=>{if(!busy)showFile(name);});b.disabled=busy;list.append(b);}const total=validate(files);$('projectSize').textContent=`${files.size} arquivos · ${(total/1024/1024).toFixed(2)} MB`;}
  function replaceProject(next){validate(next);files=next;showFile(files.has('index.html')?'index.html':files.keys().next().value);mark();preview();}
  function localURL(value,base,depth=0){if(depth>5)return '';if(!value||value.startsWith('#')||/^(data:|blob:)/i.test(value))return value;try{const url=new URL(value,'https://prototype.invalid/'+base);if(url.origin!=='https://prototype.invalid')return '';const name=decodeURIComponent(url.pathname.slice(1));const bytes=files.get(name);if(!bytes||bytes.length>previewBudget)return '';previewBudget-=bytes.length;const ext=name.split('.').pop().toLowerCase();const mime={html:'text/html',css:'text/css',js:'text/javascript',mjs:'text/javascript',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',woff:'font/woff',woff2:'font/woff2',ico:'image/x-icon'}[ext]||'application/octet-stream';if(ext==='css'){const css=new TextDecoder().decode(bytes).replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi,(_,q,v)=>'url("'+localURL(v,name,depth+1)+'")');return 'data:text/css;base64,'+b64(new TextEncoder().encode(css));}return 'data:'+mime+';base64,'+b64(bytes);}catch{return '';}}
  function preview(){previewBudget=8*1024*1024;if(!files.has('index.html')){status('Inclua index.html para ver a prévia.',true);return;}const doc=new DOMParser().parseFromString(new TextDecoder().decode(files.get('index.html')),'text/html');doc.querySelectorAll('base,meta[http-equiv]').forEach(e=>e.remove());doc.querySelectorAll('[src],[href],[poster]').forEach(e=>{for(const attr of ['src','href','poster'])if(e.hasAttribute(attr))e.setAttribute(attr,localURL(e.getAttribute(attr),'index.html'));});doc.querySelectorAll('[srcset]').forEach(e=>e.removeAttribute('srcset'));doc.querySelectorAll('style').forEach(e=>{e.textContent=e.textContent.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi,(_,q,v)=>'url("'+localURL(v,'index.html')+'")');});const csp=doc.createElement('meta');csp.httpEquiv='Content-Security-Policy';csp.content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";doc.head.prepend(csp);$('preview').srcdoc='<!doctype html>'+doc.documentElement.outerHTML;}

  // Extração em memória, com limites durante a descompressão; nenhum upload.
  async function importArchive(file){
    const zip=await JSZip.loadAsync(file), entries=Object.values(zip.files).filter(e=>!e.dir);
    if(!entries.length||entries.length>200)throw Error('Use entre 1 e 200 arquivos.');
    const next=new Map(), names=new Set();let total=0;
    for(const entry of entries){
      const name=path(entry.unsafeOriginalName||entry.name);
      if(names.has(name.toLowerCase()))throw Error('Há nomes repetidos no ZIP.');
      if(((Number(entry.unixPermissions)||0)&0xf000)===0xa000)throw Error('Links simbólicos não são aceitos.');
      names.add(name.toLowerCase());
      const bytes=await new Promise((resolve,reject)=>{
        const chunks=[];let size=0,failed=false;const stream=entry.internalStream('uint8array');
        stream.on('data',chunk=>{
          if(failed)return;size+=chunk.length;
          if(size>SINGLE||total+size>MAX){failed=true;stream.pause();reject(Error('O ZIP excede os limites de tamanho.'));return;}
          chunks.push(chunk);
        }).on('error',reject).on('end',()=>{
          if(failed)return;const result=new Uint8Array(size);let offset=0;
          for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}resolve(result);
        }).resume();
      });
      total+=bytes.length;next.set(name,bytes);
    }
    validate(next);return next;
  }
  async function importZIP(file){if(!file)return;if(file.size>MAX)throw Error('O ZIP deve ter até 20 MB.');if(!confirm('Substituir o rascunho atual? Exporte o ZIP antes se quiser guardá-lo.'))return;status('Validando e importando ZIP…');const next=await importArchive(file);replaceProject(next);status('ZIP importado. Confira os arquivos e a prévia.');}
  async function importFiles(list,folder=false){if(!list.length)return;if(folder&&!confirm('Substituir o rascunho atual? Exporte o ZIP antes se quiser guardá-lo.'))return;const next=folder?new Map():new Map(files);if(list.length>200)throw Error('Importe até 200 arquivos.');let bytes=0;for(const f of list){if(f.size>SINGLE)throw Error(f.name+': limite de 5 MB.');bytes+=f.size;if(bytes>MAX)throw Error('Limite de 20 MB.');const name=path(folder?f.webkitRelativePath.split('/').slice(1).join('/'):f.name);if(next.has(name)&&!folder)throw Error('Já existe um arquivo chamado '+name+'. Renomeie antes de importar.');next.set(name,new Uint8Array(await f.arrayBuffer()));}validate(next);if(folder)replaceProject(next);else{files=next;renderList();mark();}status('Arquivos importados.');}
  if(window.CodeMirror)editor=CodeMirror.fromTextArea($('code'),{lineNumbers:true,mode:'htmlmixed',indentUnit:2,tabSize:2,lineWrapping:true});
  const changed=()=>{if(changing||busy||!current)return;const value=editor?editor.getValue():$('code').value;const bytes=new TextEncoder().encode(value);files.set(current,bytes);try{renderList();mark();}catch(e){status(e.message,true);}};
  if(editor)editor.on('change',changed);else $('code').addEventListener('input',changed);
  $('newProject').addEventListener('click',()=>{if(confirm('Criar um novo rascunho? Baixe o projeto atual se quiser guardá-lo.')){replaceProject(new Map(Object.entries(initial).map(([n,t])=>[n,new TextEncoder().encode(t)])));status('Novo projeto pronto para editar.');}});
  $('importZip').onclick=()=>$('zipInput').click();$('importFolder').onclick=()=>$('assetInput').click();$('addAssets').onclick=()=>$('assetInput').click();
  $('zipInput').onchange=()=>work(async()=>{try{await importZIP($('zipInput').files[0]);}finally{$('zipInput').value='';}});
  $('assetInput').onchange=()=>work(async()=>{try{await importFiles([...$('assetInput').files]);}finally{$('assetInput').value='';}});
  const zone=$('dropzone');zone.ondragover=e=>{e.preventDefault();zone.classList.add('dragging');};zone.ondragleave=()=>zone.classList.remove('dragging');zone.ondrop=e=>{e.preventDefault();zone.classList.remove('dragging');if(!busy)work(()=>importZIP(e.dataTransfer.files[0]));};
  $('refreshPreview').onclick=()=>{try{preview();status('Prévia atualizada.');}catch(e){status(e.message,true);}};
  $('downloadProject').onclick=()=>work(async()=>{validate(files);status('Preparando ZIP…');const zip=new JSZip();for(const [name,data]of files)zip.file(name,data);const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:3}});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='meu-prototipo.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);status('ZIP preparado. Confira o resultado na área Arquivos.');});
  function dialog(kind){mode=kind;$('fileDialogTitle').textContent=kind==='add'?'Criar arquivo':'Renomear arquivo';$('filePath').value=kind==='add'?'':current;$('fileError').textContent='';$('fileDialog').showModal();$('filePath').focus();}
  $('addFile').onclick=()=>dialog('add');$('renameFile').onclick=()=>dialog('rename');$('cancelFile').onclick=()=>$('fileDialog').close();
  $('fileForm').onsubmit=e=>{e.preventDefault();try{const name=path($('filePath').value);if([...files.keys()].some(n=>n.toLowerCase()===name.toLowerCase()&&!(mode==='rename'&&n===current)))throw Error('Esse nome já existe.');const next=new Map(files);if(mode==='rename'){next.set(name,next.get(current));next.delete(current);}else next.set(name,new Uint8Array());validate(next);files=next;showFile(name);mark();$('fileDialog').close();}catch(error){$('fileError').textContent=error.message;}};
  $('removeFile').onclick=()=>{if(files.size===1){status('Mantenha pelo menos um arquivo.',true);return;}if(confirm('Remover '+current+' do rascunho?')){files.delete(current);showFile(files.keys().next().value);mark();}};
  window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue='';}});
  controls(true);
  (async()=>{const stored=await restore();try{if(stored?.files){files=new Map(stored.files);validate(files);}else files=new Map(Object.entries(initial).map(([n,t])=>[n,new TextEncoder().encode(t)]));}catch{files=new Map(Object.entries(initial).map(([n,t])=>[n,new TextEncoder().encode(t)]));}showFile(files.has('index.html')?'index.html':files.keys().next().value);preview();controls(false);})();
})();
