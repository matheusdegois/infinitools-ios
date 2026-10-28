const scriptPromises = new Map();

function loadScript(src) {
    if (scriptPromises.has(src)) return scriptPromises.get(src);
    const promise = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing?.dataset.loaded === 'true') return resolve();
        const script = existing || document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
        script.onerror = () => reject(new Error('Não foi possível carregar o decodificador local desta imagem.'));
        if (!existing) document.head.append(script);
    });
    scriptPromises.set(src, promise);
    return promise;
}

const extension = name => String(name || '').toLowerCase().split('.').pop();
const canvas = (width, height) => {
    const element = document.createElement('canvas');
    element.width = Math.max(1, Math.round(width));
    element.height = Math.max(1, Math.round(height));
    return element;
};

async function bitmapCanvas(blob) {
    const bitmap = await createImageBitmap(blob, {imageOrientation:'from-image'});
    const out = canvas(bitmap.width, bitmap.height);
    out.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return out;
}

async function decodeHeic(file) {
    await loadScript('assets/vendor/image-codecs/heic2any.min.js');
    const converted = await globalThis.heic2any({blob:file, toType:'image/png'});
    return bitmapCanvas(Array.isArray(converted) ? converted[0] : converted);
}

async function decodeTiff(file) {
    await loadScript('assets/vendor/image-codecs/utif.js');
    const bytes = await file.arrayBuffer(), ifds = globalThis.UTIF.decode(bytes);
    if (!ifds.length) throw new Error('O arquivo TIFF não contém uma imagem legível.');
    globalThis.UTIF.decodeImage(bytes, ifds[0]);
    const rgba = globalThis.UTIF.toRGBA8(ifds[0]), out = canvas(ifds[0].width, ifds[0].height);
    out.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), out.width, out.height), 0, 0);
    return out;
}

async function decodePsd(file) {
    await loadScript('assets/vendor/image-codecs/ag-psd.js');
    const psd = globalThis.agPsd.readPsd(await file.arrayBuffer(), {skipLayerImageData:true, skipThumbnail:true});
    if (psd.canvas) return psd.canvas;
    if (!psd.imageData) throw new Error('O PSD não possui uma prévia composta que possa ser aberta.');
    const out = canvas(psd.width, psd.height);
    out.getContext('2d').putImageData(psd.imageData, 0, 0);
    return out;
}

async function decodeRaw(file) {
    const {default:LibRaw} = await import('./vendor/image-codecs/libraw-index.js');
    const decoder = new LibRaw();
    try {
        await decoder.open(await file.arrayBuffer(), {outputBps:8, useCameraWb:true, halfSize:false});
        const image = await decoder.imageData();
        if (!image?.data?.length) throw new Error('O RAW não contém uma imagem revelável.');
        const out = canvas(image.width, image.height), rgba = new Uint8ClampedArray(image.width * image.height * 4);
        const source = image.data, channels = Math.max(1, image.colors || 3), scale = image.bits > 8 ? 255 / 65535 : 1;
        for (let i=0, p=0; i<rgba.length; i+=4, p+=channels) {
            rgba[i] = source[p] * scale;
            rgba[i+1] = source[p + Math.min(1, channels-1)] * scale;
            rgba[i+2] = source[p + Math.min(2, channels-1)] * scale;
            rgba[i+3] = 255;
        }
        out.getContext('2d').putImageData(new ImageData(rgba, out.width, out.height), 0, 0);
        return out;
    } finally { decoder.dispose(); }
}

async function decodePdfCompatible(file) {
    const pdfjs = await import('./vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = './assets/vendor/pdfjs/pdf.worker.min.mjs';
    const pdf = await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
    const page = await pdf.getPage(1), viewport = page.getViewport({scale:2});
    const out = canvas(viewport.width, viewport.height);
    await page.render({canvasContext:out.getContext('2d'), viewport, background:'#fff'}).promise;
    return out;
}

export async function decodeImageFile(file,{allowFirstFrame=false}={}) {
    if (!file || file.size > 80 * 1024 * 1024) throw new Error('Selecione uma imagem de até 80 MB.');
    if(!allowFirstFrame){const {inspectGifFile}=await import('./gif-inspect.mjs?v=1');const gif=await inspectGifFile(file);if(gif?.animated){const error=new Error('GIF animado: use Editar GIF animado no catálogo para preservar os quadros, ou escolha explicitamente converter apenas o primeiro quadro no conversor.');error.code='GIF_ANIMATED';throw error;}}
    const ext = extension(file.name);
    if (['heic','heif'].includes(ext)) return decodeHeic(file);
    if (['tif','tiff'].includes(ext)) return decodeTiff(file);
    if (ext === 'psd') return decodePsd(file);
    if (['cr2','nef','arw'].includes(ext)) return decodeRaw(file);
    if (ext === 'ai') {
        try { return await decodePdfCompatible(file); }
        catch { throw new Error('Este AI não possui conteúdo PDF compatível. Salve-o no Illustrator com “Criar arquivo compatível com PDF”.'); }
    }
    if (!['png','jpg','jpeg','webp','bmp','svg','avif','gif'].includes(ext)) throw new Error('Formato de imagem não reconhecido.');
    try { return await bitmapCanvas(file); }
    catch { throw new Error('O navegador não conseguiu abrir esta imagem. Tente convertê-la para PNG ou JPEG.'); }
}

const blobFromCanvas = (source, type, quality) => new Promise((resolve, reject) => source.toBlob(
    value => value ? resolve(value) : reject(new Error(`O navegador não conseguiu gerar ${type}.`)), type, quality
));

async function pdfBlob(source, quality) {
    await loadScript('assets/vendor/pdf-lib.min.js');
    const doc = await globalThis.PDFLib.PDFDocument.create();
    const jpeg = await blobFromCanvas(source, 'image/jpeg', quality), image = await doc.embedJpg(await jpeg.arrayBuffer());
    const page = doc.addPage([image.width, image.height]);
    page.drawImage(image, {x:0, y:0, width:image.width, height:image.height});
    return new Blob([await doc.save()], {type:'application/pdf'});
}

async function gifBlob(source) {
    const {GIFEncoder} = await import('./vendor/image-codecs/gifenc.esm.js');
    const rgba = source.getContext('2d').getImageData(0, 0, source.width, source.height).data;
    const {writeGifFrame}=await import('./gif-core.mjs?v=1');
    const encoder = GIFEncoder();
    writeGifFrame(encoder,rgba,source.width,source.height,{loop:null});
    encoder.finish();
    return new Blob([encoder.bytes()], {type:'image/gif'});
}

export async function encodeCanvas(source, format, quality=.94) {
    const key = String(format || 'png').toLowerCase();
    if (key === 'pdf') return {blob:await pdfBlob(source, quality), extension:'pdf', mime:'application/pdf'};
    if (key === 'gif') return {blob:await gifBlob(source), extension:'gif', mime:'image/gif'};
    const mime = key === 'jpeg' || key === 'jpg' ? 'image/jpeg' : key === 'webp' ? 'image/webp' : 'image/png';
    const blob = await blobFromCanvas(source, mime, quality);
    if (key === 'webp' && blob.type !== 'image/webp') throw new Error('Este navegador não possui codificador WebP. Use Chrome, Edge ou Firefox atualizado.');
    return {blob, extension:key === 'jpeg' ? 'jpeg' : key === 'jpg' ? 'jpg' : key, mime};
}

export function fitSticker(source, background='transparent', color='#ffffff') {
    const out = canvas(512, 512), context = out.getContext('2d');
    if (background === 'color') { context.fillStyle = color; context.fillRect(0,0,512,512); }
    const scale = Math.min(512/source.width, 512/source.height), width = source.width*scale, height=source.height*scale;
    context.drawImage(source, (512-width)/2, (512-height)/2, width, height);
    return out;
}

export async function encodeSticker(source, background='transparent', color='#ffffff', preferredQuality=.94) {
    let output = fitSticker(source, background, color), encoded = await encodeCanvas(output, 'webp', preferredQuality);
    if (encoded.blob.size > 100*1024) {
        for (const quality of [.8,.68,.56,.44,.34,.25,.18]) {
            encoded = await encodeCanvas(output, 'webp', quality);
            if (encoded.blob.size <= 100*1024) break;
        }
    }
    if (encoded.blob.size > 100*1024) {
        let best=encoded,bestCanvas=output;
        for (const resolution of [384,320,256,192,128]) {
            const reduced=canvas(resolution,resolution),flattened=canvas(512,512),context=flattened.getContext('2d');
            reduced.getContext('2d').drawImage(output,0,0,resolution,resolution);context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(reduced,0,0,512,512);
            for (const quality of [.22,.14,.08,.04]) {
                const candidate=await encodeCanvas(flattened,'webp',quality);
                if (candidate.blob.size < best.blob.size) {best=candidate;bestCanvas=flattened}
                if (candidate.blob.size <= 100*1024) break;
            }
            if (best.blob.size <= 100*1024) break;
        }
        encoded=best;output=bestCanvas;
    }
    if (encoded.blob.size > 100*1024) throw new Error(`Não foi possível reduzir esta imagem abaixo de 100 KB. O menor resultado ficou com ${(encoded.blob.size/1024).toFixed(1)} KB.`);
    return {canvas:output, ...encoded};
}

export const acceptedImageExtensions = ['jpeg','jpg','png','webp','heic','heif','tiff','tif','bmp','svg','cr2','nef','arw','psd','ai','avif','gif'];
