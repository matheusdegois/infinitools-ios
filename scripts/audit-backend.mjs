import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const remote=JSON.parse(fs.readFileSync(path.join(root,'Infinitools/Resources/WebContent/remote-assets.json')));
const specs=[{path:'/api/compiler.php',method:'GET'},{path:'/youtube-download',method:'GET'},{path:'/privacidade',method:'HEAD'},...Object.entries(remote).map(([path,spec])=>({path,method:'HEAD',expectedBytes:spec.bytes}))];
const checks=await Promise.all(specs.map(async spec=>{
  try{
    const response=await fetch('https://www.infinitools.com.br'+spec.path,{method:spec.method,headers:{'Accept-Encoding':'identity'},redirect:'follow',signal:AbortSignal.timeout(30000)});
    const result={...spec,status:response.status,contentType:response.headers.get('content-type'),bytes:Number(response.headers.get('content-length'))||null};
    if(spec.path==='/api/compiler.php'){const body=await response.json();result.languages=Array.isArray(body)?body.length:0;}
    if(spec.path==='/youtube-download'){const body=await response.text();result.hasCSRFAttribute=body.includes('data-downloader-csrf=');result.hasDownloaderEndpoint=body.includes('api/downloader.php');}
    if(spec.expectedBytes)result.sizeMatches=result.bytes===spec.expectedBytes;
    return result;
  }catch(error){return {...spec,error:error.message};}
}));
const report={date:new Date().toISOString(),checks,limitations:['HEAD does not verify remote file SHA-256. Swift EngineCache verifies downloaded bytes before use.','No execution of paid compiler, third-party media download or personal certificate signing was performed.']};
fs.mkdirSync(path.join(root,'docs/verification'),{recursive:true});fs.writeFileSync(path.join(root,'docs/verification/backend.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(checks,null,2));
if(checks.some(c=>c.error||c.status!==200||c.sizeMatches===false))process.exitCode=1;
