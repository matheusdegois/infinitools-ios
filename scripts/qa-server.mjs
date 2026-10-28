// Development fixture for the exact bundled pages. This is NOT the Swift loopback server.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

export async function startServer(root, {online = true} = {}) {
  const directory=path.join(root,'Infinitools/Resources/WebContent');
  const routes=JSON.parse(fs.readFileSync(path.join(directory,'routes.json')));
  const remote=JSON.parse(fs.readFileSync(path.join(directory,'remote-assets.json')));
  const token=crypto.randomUUID(), origin='http://127.0.0.1:18763';
  const mime=file=>({js:'text/javascript',mjs:'text/javascript',html:'text/html; charset=utf-8',css:'text/css',json:'application/json',wasm:'application/wasm',svg:'image/svg+xml',png:'image/png',ico:'image/x-icon',raw:'application/gzip',woff:'font/woff',woff2:'font/woff2'})[file.split('.').pop()]||'application/octet-stream';
  const endpoints=new Set(['/api/compiler.php','/api/compiler-preferences.php','/api/html-pdf.php','/api/pdfa.php','/api/raster-pdf.php','/api/downloader.php','/youtube-download','/youtube-download.php']);
  const requests=[], failures=[];
  let backendCookies='';
  const server=http.createServer(async(req,res)=>{
    try {
      res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
      res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"frame-ancestors 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:; connect-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'");
      if(req.headers.host!=='127.0.0.1:18763'||!req.headers.cookie?.split(';').map(v=>v.trim()).includes('infinitools_session='+token)||req.headers.origin&&req.headers.origin!==origin){res.writeHead(403);res.end('Unauthorized');return;}
      const url=new URL(req.url,origin),decoded=decodeURIComponent(url.pathname);
      if(decoded.includes('\\')||decoded.includes('\0')||decoded.includes('%')||decoded.split('/').some(p=>p==='..'||p==='.')){res.writeHead(400);res.end();return;}
      const key=decoded.replace(/\.php$/,'')+(url.searchParams.has('tool')?'?tool='+url.searchParams.get('tool'):'');
      let file;
      if(decoded.startsWith('/assets/')||decoded.startsWith('/android/')||decoded.startsWith('/ios/'))file=path.join(directory,'web',decoded.slice(1)+(decoded.endsWith('.gz')?'.raw':''));
      else if(routes[key])file=path.join(directory,'web',routes[key]);
      if(file&&fs.existsSync(file)){
        res.setHeader('Content-Type',mime(file));res.setHeader('Content-Length',fs.statSync(file).size);res.writeHead(200);
        if(req.method==='HEAD')res.end();else await pipeline(fs.createReadStream(file),res);return;
      }
      if(endpoints.has(decoded)||remote[decoded]){
        requests.push({path:decoded,method:req.method});
        if(!online){res.writeHead(503);res.end('Offline fixture');return;}
        const bodyChunks=[];for await(const chunk of req)bodyChunks.push(chunk);
        const headers={'User-Agent':'Mozilla/5.0 InfinitoolsIOS-QA/1.0','Origin':'https://www.infinitools.com.br','Referer':'https://www.infinitools.com.br/'};
        for(const name of ['content-type','accept','x-csrf-token','x-requested-with'])if(req.headers[name])headers[name]=req.headers[name];
        if(backendCookies)headers.Cookie=backendCookies;
        const response=await fetch('https://www.infinitools.com.br'+req.url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(bodyChunks),redirect:'manual',signal:AbortSignal.timeout(120000)});
        const cookies=response.headers.getSetCookie();if(cookies.length)backendCookies=cookies.map(v=>v.split(';')[0]).join('; ');
        if(remote[decoded]){
          const data=Buffer.from(await response.arrayBuffer()),spec=remote[decoded];
          if(data.length!==spec.bytes||crypto.createHash('sha256').update(data).digest('hex')!==spec.sha256)throw Error('Remote hash mismatch: '+decoded);
          res.setHeader('Content-Type',mime(decoded));res.writeHead(response.status);res.end(data);return;
        }
        const type=response.headers.get('content-type')||'application/octet-stream';res.setHeader('Content-Type',type);
        for(const name of ['Content-Disposition','X-PDFA-Validated'])if(response.headers.has(name))res.setHeader(name,response.headers.get(name));
        let data=Buffer.from(await response.arrayBuffer());
        if(type.includes('text/html'))data=Buffer.from(data.toString().replaceAll('https://www.infinitools.com.br/','/').replace(/<script\b[^>]*src=["'][^"']*privacy-consent[^"']*["'][^>]*>\s*<\/script>/gi,'').replace(/<head>/i,'<head><base href="/"><script src="/ios/transport.js"></script><script src="/android/bridge.js"></script><link rel="stylesheet" href="/android/mobile.css">'));
        res.writeHead(response.status);res.end(data);return;
      }
      res.writeHead(404);res.end('Not found');
    }catch(error){if(error.code==='ERR_STREAM_PREMATURE_CLOSE'||req.destroyed)return;if(!res.headersSent)res.writeHead(502);res.end(error.message);failures.push({path:req.url,error:error.message});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(18763,'127.0.0.1',resolve);});
  return {server,origin,token,requests,failures,close:()=>new Promise(resolve=>server.close(resolve))};
}
