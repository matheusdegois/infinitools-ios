import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const json = p => JSON.parse(read(p));
const walk = dir => fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+'/'+e.name):[dir+'/'+e.name]);
const report={date:new Date().toISOString(),environment:process.platform,checks:[],limitations:['Swift type checking, Xcode build, XCTest, simulator and physical iOS execution require macOS and have not been run by this script.']};
function check(name,fn){try{const detail=fn();report.checks.push({name,passed:true,...(detail?{detail}: {})});console.log('OK '+name);}catch(e){report.checks.push({name,passed:false,error:e.stack});console.error('FAIL '+name+': '+e.message);process.exitCode=1;}}
const content='Infinitools/Resources/WebContent';
check('catalog parity and unique family IDs',()=>{
  const catalog=json(content+'/catalog.json');assert.equal(catalog.length,158);assert.equal(new Set(catalog.map(t=>t.id)).size,158);
  assert.deepEqual(Object.fromEntries(['local','hybrid','online'].map(mode=>[mode,catalog.filter(t=>t.mode===mode).length])),{local:145,hybrid:11,online:2});
  for(const tool of catalog){assert.ok(['pdf','image','media','utility'].includes(tool.family));assert.ok(!tool.route.includes('..')&&!tool.route.includes(':'));}
  return {tools:catalog.length};
});
check('157 local pages and real downloader route',()=>{
  const routes=json(content+'/routes.json'),catalog=json(content+'/catalog.json');assert.equal(Object.keys(routes).length,157);
  for(const tool of catalog){const key='/'+tool.route.replace(/\.php(?=\?|$)/,'');if(tool.slug==='youtube-download'){assert.equal(routes[key],undefined);continue;}
    const relative=routes[key];assert.ok(relative,tool.id);const html=read(content+'/web/'+relative);
    assert.ok(html.includes('<html'));assert.ok(html.includes('/ios/transport.js'));assert.ok(html.includes('/android/bridge.js'));assert.ok(html.includes('/android/mobile.css'));
  }
});
check('imported resource integrity',()=>{
  const manifest=json('docs/import-manifest.json');for(const item of manifest.files){const data=fs.readFileSync(path.join(root,content,item.path));assert.equal(data.length,item.bytes,item.path);assert.equal(crypto.createHash('sha256').update(data).digest('hex'),item.sha256,item.path);}
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,content,'catalog.json'))).digest('hex'),manifest.catalogSHA256);
  assert.equal(read(content+'/web/ios/transport.js'),read('web-adapter/transport.js')); return {files:manifest.files.length};
});
check('GIF fallback uses the original scene renderer and defers resize writes',()=>{
  assert.equal(read(content+'/web/ios/gif-fallback.mjs'),read('web-adapter/gif-fallback.mjs'));
  assert.ok(read(content+'/web/assets/gif-worker.mjs').includes('await encodeScene('));
  assert.ok(read(content+'/web/assets/gif-ui.mjs').includes('requestAnimationFrame(()=>{this.resizeFrame=null;this.render();})'));
});
check('seven authenticated remote engines',()=>{
  const remote=json(content+'/remote-assets.json');assert.equal(Object.keys(remote).length,7);
  for(const [p,spec]of Object.entries(remote)){assert.ok(p.startsWith('/assets/'));assert.match(spec.sha256,/^[a-f0-9]{64}$/);assert.ok(spec.bytes>0);}
});
check('no PHP source, credentials or private paths in app resources',()=>{
  for(const file of walk('Infinitools/Resources')){assert.ok(!/\.(php\d*|phtml|jks|keystore|p12|pfx|pem|env)$/i.test(file),file);assert.ok(!/(^|\/)(private|\.secrets|sessions|uploads)(\/|$)/i.test(file),file);}
});
check('Swift syntax trees',()=>{
  const Parser=require('tree-sitter'),Swift=require('tree-sitter-swift');const parser=new Parser();parser.setLanguage(Swift);
  const sources=['Package.swift',...walk('Infinitools').filter(f=>f.endsWith('.swift')),...walk('Shared'),...walk('ShareExtension').filter(f=>f.endsWith('.swift')),...walk('Tests').filter(f=>f.endsWith('.swift'))];
  for(const file of sources){const tree=parser.parse(read(file));const errors=[];function visit(n){if(n.type==='ERROR'||n.isMissing)errors.push(`${n.startPosition.row+1}:${n.startPosition.column+1} ${n.text.slice(0,120)}`);for(const child of n.children)visit(child);}visit(tree.rootNode);assert.equal(errors.length,0,file+' '+errors.join('; '));}return {files:sources.length,note:'Parser syntax check only, not Swift compilation.'};
});
check('Xcode target references, resources, test host and source membership',()=>{
  const project=require('xcode').project(path.join(root,'Infinitools.xcodeproj/project.pbxproj'));project.parseSync();
  const objects=project.hash.project.objects;const entries=Object.entries(objects);
  const targets=entries.filter(([,v])=>v.isa==='PBXNativeTarget').map(([,v])=>v.name.replaceAll('"',''));
  assert.deepEqual(targets.sort(),['Infinitools','InfinitoolsShare','InfinitoolsTests','InfinitoolsUITests'].sort());
  const refs=entries.filter(([,v])=>v.isa==='PBXFileReference');
  for(const [,ref]of refs)if(ref.sourceTree==='"<group>"'||ref.sourceTree==='<group>'){assert.ok(fs.existsSync(path.join(root,ref.path.replaceAll('"',''))),ref.path);}
  const sourceFiles=walk('Infinitools').filter(f=>f.endsWith('.swift'));for(const f of sourceFiles)assert.ok(refs.some(([,r])=>r.path.replaceAll('"','')===f),f);
  for(const [,object] of entries){for(const field of ['fileRef','target','targetProxy','buildConfigurationList','productReference','containerPortal'])if(object[field])assert.ok(objects[object[field]],'Missing '+field+' '+object[field]);}
  const scheme=read('Infinitools.xcodeproj/xcshareddata/xcschemes/Infinitools.xcscheme');assert.ok(scheme.includes('InfinitoolsTests'));assert.ok(scheme.includes('InfinitoolsUITests'));
  return {targets};
});
check('prototype remains local, isolated and without publication',()=>{
  const routes=json(content+'/routes.json'),html=read(content+'/web/'+routes['/publicador-web']),script=read(content+'/web/android/prototype.js');
  assert.ok(html.includes('sandbox="allow-scripts"'));assert.ok(!html.includes('id="publishProject"'));assert.ok(!script.includes('/api/prototypes.php'));
  assert.ok(script.includes('indexedDB.open'));assert.ok(script.includes("unsafeOriginalName"));assert.ok(script.includes('0xa000'));
});
check('opaque Lottie preview has authenticated inline scripts and blob loading',()=>{
  const html=read(content+'/web/assets/lottie-frame.html');
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);assert.equal(scripts.length,2);
  for(const script of scripts){const expected='sha256-'+crypto.createHash('sha256').update(script.replace(/\r\n?/g,'\n')).digest('base64');assert.ok(html.includes(expected));}
  assert.ok(read(content+'/web/assets/lottie-viewer.js').includes('frame.src=isolatedLottieSource()'));
  const page=read(content+'/web/'+json(content+'/routes.json')['/lottie-viewer']);assert.ok(page.includes('sandbox="allow-scripts"'));assert.ok(!page.includes('allow-same-origin'));
});
check('native bridge and loopback restrictions exist',()=>{
  const engine=read('Infinitools/Web/WebEngine.swift'),server=read('Infinitools/Web/LocalServer.swift'),backend=read('Infinitools/Web/Backend.swift');
  assert.ok(engine.includes('message.frameInfo.isMainFrame'));assert.ok(engine.includes('origin.port == Int(LocalServer.port)'));assert.ok(engine.includes('forMainFrameOnly: true'));
  assert.ok(server.includes('host: "127.0.0.1"'));assert.ok(server.includes('infinitools_session='));assert.ok(server.includes('cross-site'));assert.ok(backend.includes('SHA256()'));
  assert.ok(!engine.includes('NSAllowsArbitraryLoads'));assert.ok(!backend.includes('serverTrust'));
});
fs.mkdirSync(path.join(root,'docs/verification'),{recursive:true});fs.writeFileSync(path.join(root,'docs/verification/static.json'),JSON.stringify(report,null,2)+'\n');
