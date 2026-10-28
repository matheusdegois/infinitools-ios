import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {webkit,chromium} from '@playwright/test';
import JSZip from 'jszip';
import {startServer} from './qa-server.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'Infinitools/Resources/WebContent/catalog.json')));
const out=path.join(root,'output/qa');fs.mkdirSync(out,{recursive:true});
const engine=process.argv.includes('--chromium')?'chromium':'webkit';
const online=!process.argv.includes('--offline'),screensOnly=process.argv.includes('--screens-only'),flowsOnly=process.argv.includes('--flows-only');
const report={date:new Date().toISOString(),engine,platform:process.platform,viewport:{width:393,height:852},nativeBridge:'simulated WK message handler; not the Swift ResultStore or iOS runtime',screens:[],flows:[],errors:[],limitations:['Desktop WebKit on Windows is not WKWebView on iOS. Native compilation, UI, camera, share extension, printing and Apple signing remain unverified here.']};
const fixture=await startServer(root,{online});
let browser,context,page;
let transfer=null,exported=[],ready=null;
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const check=(name,detail={})=>{report.flows.push({name,passed:true,...detail});console.log('OK '+name);};
const load=async(id)=>{
  const tool=typeof id==='string'?catalog.find(t=>t.id===id):id;assert.ok(tool,id);
  transfer=null;ready=null;
  await page.goto(fixture.origin+'/'+tool.route,{waitUntil:'load',timeout:60000});
  await page.waitForTimeout(300);
};
const exportCount=()=>exported.length;
const waitExport=async count=>{await page.waitForFunction(count=>window.__qaExportCount>count,count,{timeout:120000});return exported.at(-1);};
const generatePdf=async()=>Buffer.from(await page.evaluate(async()=>{
  if(!window.PDFLib)await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/assets/vendor/pdf-lib.min.js';s.onload=resolve;s.onerror=reject;document.head.append(s);});
  const pdf=await PDFLib.PDFDocument.create();pdf.addPage([320,400]).drawText('Infinitools iOS teste',{x:24,y:350,size:14});return Array.from(await pdf.save());
}));
try {
  browser=await(engine==='webkit'?webkit:chromium).launch({headless:true});
  context=await browser.newContext({viewport:report.viewport,deviceScaleFactor:2,isMobile:true,hasTouch:true});
  await context.addCookies([{name:'infinitools_session',value:fixture.token,url:fixture.origin,sameSite:'Strict'}]);
  await context.exposeBinding('__qaNative',async(source,raw)=>{
    const message=JSON.parse(raw),reply={requestId:message.requestId};
    if(source.frame!==source.page.mainFrame()||new URL(source.frame.url()).origin!==fixture.origin)return {...reply,error:'Untrusted frame'};
    try {
      switch(message.type){
      case 'start':assert.equal(transfer,null);assert.ok(Number.isInteger(message.size)&&message.size>=0&&message.size<=536870912);transfer={id:crypto.randomUUID(),name:message.name,mime:message.mime,size:message.size,chunks:[],received:0};return {...reply,transferId:transfer.id};
      case 'chunk':assert.equal(message.transferId,transfer?.id);assert.ok(message.data.length<=262144);{const bytes=Buffer.from(message.data,'base64');transfer.received+=bytes.length;assert.ok(transfer.received<=transfer.size);transfer.chunks.push(bytes);}break;
      case 'finish':assert.equal(message.transferId,transfer?.id);assert.equal(transfer.received,transfer.size);{const result={name:transfer.name,mime:transfer.mime,bytes:Buffer.concat(transfer.chunks)};exported.push(result);fs.writeFileSync(path.join(out,crypto.randomUUID()+'.bin'),result.bytes);transfer=null;await source.page.evaluate(count=>window.__qaExportCount=count,exported.length);return {...reply,name:result.name};}
      case 'abort':case 'abortAll':transfer=null;break;
      case 'shared':return {...reply,files:[]};
      case 'resultReady':ready=message;break;
      default:throw Error('Unknown native request '+message.type);
      }
      return reply;
    }catch(error){return {...reply,error:error.message};}
  });
  await context.addInitScript(()=>{
    window.__qaExportCount=0;
    if(window===window.top)window.webkit={messageHandlers:{infinitools:{postMessage:raw=>window.__qaNative(raw)}}};
  });
  page=await context.newPage();
  page.on('pageerror',error=>{report.errors.push({url:page.url(),message:error.message});console.error('JS '+page.url()+' '+error.message);});
  page.on('dialog',dialog=>dialog.accept());
  if(!flowsOnly)for(const tool of catalog){
    if(!online && tool.slug==='youtube-download'){report.screens.push({id:tool.id,skipped:true,reason:'Requires the live HTTPS page and CSRF session.'});continue;}
    const before=report.errors.length;
    try{
      await load(tool);
      const info=await page.evaluate(()=>({title:document.title,body:document.body.innerText.length,bridge:!!window.infinitoolsExportUrl,overflow:document.documentElement.scrollWidth>innerWidth+2,controls:document.querySelectorAll('input,button,canvas,textarea').length}));
      assert.ok(info.body>30&&info.bridge,'Missing editor or bridge');
      report.screens.push({id:tool.id,...info,jsErrors:report.errors.length-before});
    }catch(error){report.screens.push({id:tool.id,error:error.message});}
    if(report.screens.length%20===0)console.log(`${engine}: ${report.screens.length}/158 telas`);
  }
  if(!screensOnly){
    await load('pdf:merge');
    const pdf=await generatePdf();
    await page.locator('#fileInput').setInputFiles([{name:'primeiro.pdf',mimeType:'application/pdf',buffer:pdf},{name:'segundo.pdf',mimeType:'application/pdf',buffer:pdf}]);
    await page.locator('#processBtn').click();await page.locator('#downloadBtn').waitFor({state:'visible',timeout:45000});
    const pages=await page.evaluate(async()=>{const data=await fetch(document.querySelector('#downloadBtn').href).then(r=>r.arrayBuffer());return(await PDFLib.PDFDocument.load(data)).getPageCount();});assert.equal(pages,2);
    let count=exportCount();await page.locator('#downloadBtn').click();let result=await waitExport(count);assert.ok(result.bytes.subarray(0,5).equals(Buffer.from('%PDF-')));
    check('merge-two-pdfs-and-export',{pages,bytes:result.bytes.length});
    await page.screenshot({path:path.join(out,engine+'-pdf.png'),fullPage:true});
    count=exportCount();
    const payload=await page.evaluate(async()=>{const data=new Uint8Array(900001);for(let i=0;i<data.length;i++)data[i]=i%251;const url=URL.createObjectURL(new Blob([data]));await window.infinitoolsExportUrl(url,'integridade.bin');URL.revokeObjectURL(url);return Array.from(data);});
    result=await waitExport(count);assert.equal(hash(result.bytes),hash(Buffer.from(payload)));check('chunked-export-sha256',{bytes:result.bytes.length,sha256:hash(result.bytes)});
    await load('pdf:rasterize');await page.locator('#fileInput').setInputFiles({name:'raster.pdf',mimeType:'application/pdf',buffer:pdf});
    await page.locator('#processBtn').click();await page.locator('#downloadBtn').waitFor({state:'visible',timeout:45000});
    count=exportCount();await page.locator('#downloadBtn').click();result=await waitExport(count);assert.ok(result.bytes.subarray(0,5).equals(Buffer.from('%PDF-')));check('raster-pdf-local-assembly',{bytes:result.bytes.length});
    await load('utility:qr-code');await page.locator('#qrContent').fill('https://www.infinitools.com.br/');await page.locator('#utilityForm button[type=submit]').click();await page.waitForSelector('canvas');check('qr-code-canvas');
    await load('utility:password-generator');assert.ok((await page.locator('#utilityPreview').innerText()).length>10);check('cryptographic-password-generation');
    await load('image:jpg-png');
    const jpeg=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=120;c.height=90;const x=c.getContext('2d');x.fillStyle='#3473e8';x.fillRect(0,0,120,90);return c.toDataURL('image/jpeg').split(',')[1];}),'base64');
    await page.locator('#converterFiles').setInputFiles({name:'foto.jpg',mimeType:'image/jpeg',buffer:jpeg});count=exportCount();await page.locator('#converterStart').click();result=await waitExport(count);assert.equal(result.bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');check('jpg-to-png-and-export',{bytes:result.bytes.length});
    await load('image:jpg-png');
    await page.locator('#converterFiles').setInputFiles(['a','b'].map(name=>({name:name+'.jpg',mimeType:'image/jpeg',buffer:jpeg})));count=exportCount();await page.locator('#converterStart').click();result=await waitExport(count);
    const batch=await JSZip.loadAsync(result.bytes,{checkCRC32:true}),batchFiles=Object.values(batch.files).filter(f=>!f.dir);assert.equal(batchFiles.length,2);
    for(const file of batchFiles)assert.equal((await file.async('nodebuffer')).subarray(0,8).toString('hex'),'89504e470d0a1a0a');check('batch-two-jpgs-to-png-zip-crc');
    await load('utility:zip-files');await page.locator('#filesInput').setInputFiles([{name:'um.txt',mimeType:'text/plain',buffer:Buffer.from('Infinitools')},{name:'dois.txt',mimeType:'text/plain',buffer:Buffer.from('iOS')}]);
    count=exportCount();await page.locator('#fileStart').click();await page.locator('#fileResult a[download]').first().click();result=await waitExport(count);
    let zip=await JSZip.loadAsync(result.bytes,{checkCRC32:true});assert.equal(await zip.file('um.txt').async('string'),'Infinitools');assert.equal(await zip.file('dois.txt').async('string'),'iOS');check('zip-two-files-content-and-crc');
    await load('utility:publicador-web');
    await page.waitForFunction(()=>document.querySelector('.CodeMirror')?.CodeMirror?.getValue().includes('<!doctype html>'));
    assert.equal(await page.locator('#publishProject,#published,#copyLink,#deleteProject').count(),0);
    const draft=await page.evaluate(()=>document.querySelector('.CodeMirror').CodeMirror.getValue());
    await page.frameLocator('#preview').locator('#hello').click();assert.ok((await page.frameLocator('#preview').locator('#message').innerText()).includes('funcionando'));check('prototype-sandboxed-interactive-preview');
    const isolated=await page.frameLocator('#preview').locator('body').evaluate(()=>!window.InfinitoolsNative);assert.ok(isolated);check('prototype-has-no-native-capability');
    const project=new JSZip();project.file('index.html','<!doctype html><html><head><link rel="stylesheet" href="css/style.css"></head><body><button id="b">Teste</button><p id="r"></p><script src="js/script.js"></script></body></html>');project.file('css/style.css','body{background:rgb(230,240,250)}');project.file('js/script.js',"document.getElementById('b').onclick=()=>document.getElementById('r').textContent='iOS OK'");
    await page.locator('#zipInput').setInputFiles({name:'projeto.zip',mimeType:'application/zip',buffer:await project.generateAsync({type:'nodebuffer'})});await page.waitForFunction(()=>document.getElementById('status').textContent.includes('ZIP importado'));
    await page.frameLocator('#preview').locator('#b').click();assert.equal(await page.frameLocator('#preview').locator('#r').innerText(),'iOS OK');check('prototype-zip-folders-css-js');
    await page.waitForFunction(()=>document.getElementById('draftStatus').textContent.includes('Rascunho salvo'));
    await page.reload();await page.waitForFunction(()=>document.querySelector('.CodeMirror')?.CodeMirror?.getValue().includes('id="b"'));check('prototype-indexeddb-draft-restored');
    count=exportCount();await page.locator('#downloadProject').click();result=await waitExport(count);zip=await JSZip.loadAsync(result.bytes,{checkCRC32:true});assert.ok(zip.file('css/style.css'));assert.ok((await zip.file('js/script.js').async('string')).includes('iOS OK'));check('prototype-export-zip-content-and-crc');
    const retained=await page.evaluate(()=>document.querySelector('.CodeMirror').CodeMirror.getValue());
    for(const [name,entry,options,message]of [
      ['traversal','../escape.html',{},'Nome ou formato inválido'],
      ['executable','payload.exe',{},'Nome ou formato inválido'],
      ['symlink','link.html',{unixPermissions:0o120777},'Links simbólicos não são aceitos'],
      ['oversize','large.html',{},'excede os limites']
    ]){
      const hostile=new JSZip();hostile.file(entry,name==='oversize'?Buffer.alloc(5*1024*1024+1,65):'synthetic',options);
      await page.locator('#zipInput').setInputFiles({name:name+'.zip',mimeType:'application/zip',buffer:await hostile.generateAsync({type:'nodebuffer',compression:'DEFLATE',platform:'UNIX'})});
      await page.waitForFunction(message=>document.getElementById('status').textContent.includes(message),message);
      assert.equal(await page.evaluate(()=>document.querySelector('.CodeMirror').CodeMirror.getValue()),retained);check('prototype-rejects-'+name+'-preserving-draft');
    }
    await page.screenshot({path:path.join(out,engine+'-prototype.png'),fullPage:true});
    for(const viewport of [{width:852,height:393},{width:834,height:1194}]){
      await page.setViewportSize(viewport);await page.waitForTimeout(200);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));check('responsive-prototype-'+viewport.width,viewport);
    }
    await page.setViewportSize(report.viewport);
    await load('media:gif-editor');
    const gif=Buffer.from(await page.evaluate(async()=>{
      const {GIFEncoder}=await import('/assets/vendor/image-codecs/gifenc.esm.js');const encoder=GIFEncoder(),palette=[[255,255,255],[222,72,25]];
      for(let frame=0;frame<60;frame++){const pixels=new Uint8Array(64*48);for(let y=8;y<32;y++)for(let x=0;x<16;x++)pixels[y*64+(x+frame)%64]=1;encoder.writeFrame(pixels,64,48,{palette,delay:40,repeat:0});}encoder.finish();return Array.from(encoder.bytes());
    }));
    await page.locator('[data-gif=file]').setInputFiles({name:'sessenta.gif',mimeType:'image/gif',buffer:gif});await page.locator('[data-gif=workspace]').waitFor({state:'visible',timeout:30000});
    const frames=await page.locator('[data-gif=timeline] button').count();assert.equal(frames,60);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
    await page.locator('[data-gif=absolute]').check();await page.locator('[data-tool=add-text]').click();
    await page.locator('[data-gif=overlay]').click({position:{x:100,y:80}});await page.locator('[data-gif=text]').fill('iOS');await page.locator('[data-gif=speed]').selectOption('2');
    await page.locator('[data-gif=export]').click();await page.locator('[data-gif=download]').waitFor({state:'visible',timeout:60000});count=exportCount();await page.locator('[data-gif=download]').click();result=await waitExport(count);assert.match(result.bytes.subarray(0,6).toString(),/^GIF8[79]a$/);
    const gifSummary=await page.evaluate(async bytes=>{const {parseGif}=await import('/assets/gif-core.mjs?v=1');const p=parseGif(new Uint8Array(bytes));return{frames:p.frames.length,duration:p.duration};},Array.from(result.bytes));assert.equal(gifSummary.frames,60);assert.equal(gifSummary.duration,1200);check('gif-sixty-frames-text-speed-and-export',gifSummary);
    await load('media:lottie-viewer');
    const animation={v:'5.12.2',fr:30,ip:0,op:60,w:200,h:200,nm:'Teste iOS',ddd:0,assets:[],layers:[{ddd:0,ind:1,ty:4,nm:'Quadrado',sr:1,ks:{o:{a:0,k:100},r:{a:0,k:0},p:{a:0,k:[100,100,0]},a:{a:0,k:[0,0,0]},s:{a:0,k:[100,100,100]}},ao:0,shapes:[{ty:'rc',d:1,s:{a:0,k:[100,100]},p:{a:0,k:[0,0]},r:{a:0,k:10}},{ty:'fl',c:{a:0,k:[0.2,0.4,0.8,1]},o:{a:0,k:100},r:1}],ip:0,op:60,st:0,bm:0}]};
    await page.locator('#lottieFile').setInputFiles({name:'teste.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(animation))});
    await page.waitForFunction(()=>document.querySelector('#lottieStatus').textContent.includes('Animação pronta'),{},{timeout:30000});
    count=exportCount();await page.locator('#lottiePng').click();result=await waitExport(count);assert.equal(result.bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');check('lottie-opaque-sandbox-render-and-png');
    await load('pdf:protect');await page.locator('#fileInput').setInputFiles({name:'proteger.pdf',mimeType:'application/pdf',buffer:pdf});await page.locator('#password').fill('synthetic-test-only');await page.locator('#processBtn').click();await page.locator('#downloadBtn').waitFor({state:'visible',timeout:60000});
    count=exportCount();await page.locator('#downloadBtn').click();result=await waitExport(count);assert.ok(result.bytes.toString('latin1').includes('/Encrypt'));check('mupdf-encryption-and-export');
    await load('pdf:ocr');
    const scanned=Buffer.from(await page.evaluate(async()=>{
      if(!window.PDFLib)await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/assets/vendor/pdf-lib.min.js';s.onload=resolve;s.onerror=reject;document.head.append(s);});
      const c=document.createElement('canvas');c.width=1000;c.height=500;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,1000,500);x.fillStyle='black';x.font='60px sans-serif';x.fillText('Infinitools iOS 123',50,180);const p=await PDFLib.PDFDocument.create(),image=await p.embedPng(c.toDataURL('image/png'));p.addPage([500,250]).drawImage(image,{x:0,y:0,width:500,height:250});return Array.from(await p.save());
    }));
    await page.locator('#fileInput').setInputFiles({name:'digitalizado.pdf',mimeType:'application/pdf',buffer:scanned});await page.locator('#processBtn').click();await page.locator('#downloadBtn').waitFor({state:'visible',timeout:180000});
    const recognized=await page.evaluate(async()=>{const lib=await import('/assets/vendor/pdfjs/pdf.min.mjs');lib.GlobalWorkerOptions.workerSrc='/assets/vendor/pdfjs/pdf.worker.min.mjs';const bytes=await fetch(document.querySelector('#downloadBtn').href).then(r=>r.arrayBuffer());const p=await lib.getDocument({data:bytes}).promise;return(await(await p.getPage(1)).getTextContent()).items.map(i=>i.str).join(' ');});
    assert.ok(recognized.includes('123'),recognized);count=exportCount();await page.locator('#downloadBtn').click();await waitExport(count);check('tesseract-searchable-pdf-ocr',{recognized});
    if(online){
      await load('pdf:text-pdf');await page.locator('#sourceText').fill('Infinitools iOS - teste sintetico de integracao HTTPS.');await page.locator('#processBtn').click();await page.locator('#downloadBtn').waitFor({state:'visible',timeout:60000});
      count=exportCount();await page.locator('#downloadBtn').click();result=await waitExport(count);assert.equal(result.bytes.subarray(0,5).toString(),'%PDF-');check('text-to-pdf-https-backend-and-export');
      await load('pdf:pdf-pdfa');await page.locator('#fileInput').setInputFiles({name:'sintetico.pdf',mimeType:'application/pdf',buffer:pdf});await page.locator('#processBtn').click();await page.locator('#downloadBtn').waitFor({state:'visible',timeout:120000});
      count=exportCount();await page.locator('#downloadBtn').click();result=await waitExport(count);assert.equal(result.bytes.subarray(0,5).toString(),'%PDF-');check('pdfa-backend-output-and-export',{bytes:result.bytes.length,note:'Checks PDF output; does not independently certify PDF/A conformance.'});
    }
    // Real FFmpeg conversion, not a mocked codec. Kept last because it is CPU intensive.
    await load('media:audio');
    const rate=16000,wav=Buffer.alloc(44+rate*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(rate*2,40);for(let i=0;i<rate;i++)wav.writeInt16LE(Math.round(Math.sin(2*Math.PI*440*i/rate)*9000),44+i*2);
    await page.locator('#mediaInput').setInputFiles({name:'teste.wav',mimeType:'audio/wav',buffer:wav});await page.locator('#format').selectOption('mp3');await page.locator('#convertMedia').click();await page.locator('#mediaDownload').waitFor({state:'visible',timeout:180000});
    count=exportCount();await page.locator('#mediaDownload').click();result=await waitExport(count);assert.ok(result.bytes.length>1000);check('ffmpeg-wav-to-mp3-export',{bytes:result.bytes.length});
  }
}catch(error){report.failure=error.stack;console.error(error.stack);if(page){console.error((await page.locator('body').innerText()).slice(0,2500));await page.screenshot({path:path.join(out,engine+'-failure.png'),fullPage:true}).catch(()=>{});}}
finally{
  report.backendRequests=fixture.requests;report.fixtureFailures=fixture.failures;
  report.summary={screens:report.screens.length,screenFailures:report.screens.filter(s=>s.error).length,overflows:report.screens.filter(s=>s.overflow).length,jsErrors:report.errors.length,flows:report.flows.length};
  fs.mkdirSync(path.join(root,'docs/verification'),{recursive:true});fs.writeFileSync(path.join(root,'docs/verification',engine+(flowsOnly?(online?'-flows':'-offline'):'')+'.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report.summary));
  await browser?.close();await fixture.close();
}
if(report.failure||report.errors.length||report.screens.some(s=>s.error||s.overflow||s.jsErrors))process.exitCode=1;
