import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(process.argv[2] || path.join(root, '..', 'infinitools android'));
const assets = path.join(source, 'app', 'src', 'main', 'assets');
const finalDestination = path.join(root, 'Infinitools', 'Resources', 'WebContent');
const destination = path.join(path.dirname(finalDestination), '.WebContent-stage-' + crypto.randomUUID());
const read = name => JSON.parse(fs.readFileSync(path.join(assets, name), 'utf8'));
const catalog = read('catalog.json'), routes = read('routes.json'), remote = read('remote-assets.json');
if (catalog.length !== 158 || new Set(catalog.map(t => t.id)).size !== 158 || Object.keys(routes).length !== 157) throw Error('Catálogo Android incompleto ou alterado; revise a paridade antes de importar.');
for (const route of Object.values(routes)) if (!fs.existsSync(path.join(assets, 'web', route))) throw Error('Template ausente: ' + route);
// Import only the already-public, generated Android bundle. No PHP, keystores or private directories.
if (!destination.startsWith(root + path.sep) || path.dirname(destination) !== path.dirname(finalDestination)) throw Error('Destino inválido.');
fs.mkdirSync(destination, {recursive: true});
const allowed = new Set(['.html','.js','.mjs','.ts','.css','.json','.png','.jpg','.jpeg','.gif','.webp','.ico','.svg','.wasm','.onnx','.bin','.raw','.woff','.woff2','.ttf','.otf','.txt','.md','.data','.map','.xml','.bcmap','.pfb','.afm','.traineddata','.csv','.zip','.mp3','.wav','.mp4','.webm','.swf']);
let count = 0, bytes = 0;
const manifest = [];
function isolatedLottieFrame() {
  const renderer = fs.readFileSync(path.join(assets,'web/assets/vendor/lottie/lottie_light_canvas.min.js'),'utf8').replace(/\r\n?/g,'\n').replace(/<\/script/gi,'<\\/script');
  const controller = fs.readFileSync(path.join(assets,'web/assets/lottie-frame.js'),'utf8').replace(/\r\n?/g,'\n').replace(/<\/script/gi,'<\\/script');
  const hashes = [renderer,controller].map(s=>"'sha256-"+crypto.createHash('sha256').update(s).digest('base64')+"'").join(' ');
  return fs.readFileSync(path.join(assets,'web/assets/lottie-frame.html'),'utf8').replace("script-src 'self'",'script-src '+hashes)
    .replace('<script src="vendor/lottie/lottie_light_canvas.min.js"></script>',()=>'<script>'+renderer+'</script>')
    .replace('<script src="lottie-frame.js?v=2"></script>',()=>'<script>'+controller+'</script>');
}
const lottieFrameHTML = isolatedLottieFrame();
function walk(from, relative = '') {
  for (const entry of fs.readdirSync(from, {withFileTypes: true})) {
    const rel = path.join(relative, entry.name), file = path.join(from, entry.name), target = path.join(destination, 'web', rel);
    if (entry.isSymbolicLink()) throw Error('Link simbólico não permitido: ' + rel);
    if (entry.isDirectory()) { walk(file, rel); continue; }
    if (entry.name.startsWith('.') || /\.(php\d*|phtml|jks|keystore|pem|p12|pfx|env)$/i.test(entry.name) || !allowed.has(path.extname(entry.name).toLowerCase()) && !/license|notice|copying|^readme$/i.test(entry.name)) throw Error('Recurso não aprovado: ' + rel);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    let content = fs.readFileSync(file);
    if (rel.replaceAll('\\','/') === 'assets/lottie-frame.html') {
      // An opaque sandbox cannot fetch authenticated loopback subresources under COEP.
      // Inline the two trusted scripts, authorizing their exact bytes with CSP hashes.
      content = Buffer.from(lottieFrameHTML);
    }
    if (rel.replaceAll('\\','/') === 'assets/lottie-viewer.js') {
      const source = content.toString('utf8');
      const marker = "frame.src='assets/lottie-frame.html?load='+token;";
      if (!source.includes(marker)) throw Error('Revise o carregador Lottie atualizado.');
      const factory = 'let isolatedLottieURL;function isolatedLottieSource(){if(isolatedLottieURL)URL.revokeObjectURL(isolatedLottieURL);return isolatedLottieURL=URL.createObjectURL(new Blob(['+JSON.stringify(lottieFrameHTML)+'],{type:"text/html"}));}\n';
      content = Buffer.from(factory + source.replace(marker,'frame.src=isolatedLottieSource();'));
    }
    if (rel.replaceAll('\\','/') === 'assets/gif-ui.mjs') {
      const original = 'this.observer=new ResizeObserver(()=>this.render());';
      const source = content.toString('utf8');
      if (!source.includes(original)) throw Error('Revise o ResizeObserver do editor GIF atualizado.');
      const adapted = source.replace(original,'this.observer=new ResizeObserver(()=>{cancelAnimationFrame(this.resizeFrame);this.resizeFrame=requestAnimationFrame(()=>{this.resizeFrame=null;this.render();});});')
        .replace('this.observer.disconnect();','this.observer.disconnect();cancelAnimationFrame(this.resizeFrame);')
        .replace('this.worker.onmessage=({data})=>{',`this.worker.onmessage=({data})=>{if(data.type==='paint'){const worker=this.worker;requestAnimationFrame(()=>{try{const rgba=paintScene(data);worker.postMessage({type:'painted',paintID:data.paintID,rgba},[rgba.buffer]);}catch(error){worker.postMessage({type:'painted',paintID:data.paintID,error:error.message});}});return;}`);
      content = Buffer.from("import {paintScene} from '/ios/gif-fallback.mjs';\n" + adapted);
    }
    if (rel.replaceAll('\\','/') === 'assets/gif-worker.mjs') {
      const source = content.toString('utf8');
      const original = 'const result=encodeVisualGif(frames,info,m.scene,';
      if (!source.includes(original)) throw Error('Revise o exportador GIF atualizado.');
      const adapted = source.replace('self.onmessage=async({data:m})=>{', 'self.onmessage=async({data:m})=>{if(handlePaintReply(m))return;')
        .replace(original, 'const result=await encodeScene(frames,info,m.scene,')
        .replace("stage:'Exportando quadros'}));self.postMessage({id:m.id,...result}", "stage:'Exportando quadros'}),encodeVisualGif);self.postMessage({id:m.id,...result}");
      content = Buffer.from("import {encodeScene,handlePaintReply} from '/ios/gif-fallback.mjs';\n" + adapted);
    }
    if (rel.replaceAll('\\','/') === 'android/bridge.js') {
      let script = content.toString('utf8').replaceAll('Infinitools Android', 'Infinitools iOS')
        .replaceAll('Resposta Android inválida', 'Resposta iOS inválida').replaceAll('O Android não respondeu', 'O iOS não respondeu');
      // Lifecycle belongs to the native navigation generation; an old document must not abort a new one.
      script = script.replace("window.addEventListener('beforeunload',()=>send('abortAll').catch(()=>{}));", '');
      content = Buffer.from(script);
    }
    if (rel.startsWith('pages' + path.sep)) {
      let html = content.toString('utf8');
      html = html.replace('<script src="/android/bridge.js', '<script src="/ios/transport.js"></script><script src="/android/bridge.js');
      html = html.replace('src="assets/lottie-frame.html"','src="about:blank"');
      content = Buffer.from(html);
    }
    fs.writeFileSync(target, content); count++; bytes += content.length;
    manifest.push({path: 'web/' + rel.replaceAll('\\','/'), bytes: content.length, sha256: crypto.createHash('sha256').update(content).digest('hex')});
  }
}
// Stage separately; a failed import leaves the existing bundle untouched.
walk(path.join(assets, 'web'));
for (const name of ['catalog.json','routes.json','remote-assets.json']) fs.copyFileSync(path.join(assets, name), path.join(destination, name));
const ios = path.join(destination, 'web', 'ios'); fs.mkdirSync(ios, {recursive: true});
for (const name of ['transport.js', 'gif-fallback.mjs']) fs.copyFileSync(path.join(root, 'web-adapter', name), path.join(ios, name));
const previous = path.join(path.dirname(finalDestination), '.WebContent-previous-' + crypto.randomUUID());
if (fs.existsSync(finalDestination)) fs.renameSync(finalDestination, previous);
try { fs.renameSync(destination, finalDestination); }
catch (error) { if (fs.existsSync(previous)) fs.renameSync(previous, finalDestination); throw error; }
if (fs.existsSync(previous)) {
  if (!previous.startsWith(root + path.sep) || path.dirname(previous) !== path.dirname(finalDestination)) throw Error('Limpeza fora do destino gerado.');
  fs.rmSync(previous, {recursive: true});
}
const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(assets,'catalog.json'))).digest('hex');
const report = {schema: 1, importedAt: new Date().toISOString(), source: 'infinitools android 1.0.1', tools: catalog.length, bundledPages: Object.keys(routes).length, bundledFiles: count, bundledBytes: bytes, remoteEngines: Object.keys(remote).length, catalogSHA256: hash, files: manifest};
fs.mkdirSync(path.join(root, 'docs'), {recursive: true});
fs.writeFileSync(path.join(root, 'docs', 'import-manifest.json'), JSON.stringify(report, null, 2) + '\n');
fs.copyFileSync(path.join(source, 'play-store', 'graphics', 'icone-512.png'), path.join(root, 'Infinitools', 'Resources', 'brand.png'));
console.log(JSON.stringify({tools: catalog.length, pages: Object.keys(routes).length, files: count, MiB: +(bytes / 1048576).toFixed(2), remote: Object.keys(remote).length}));
