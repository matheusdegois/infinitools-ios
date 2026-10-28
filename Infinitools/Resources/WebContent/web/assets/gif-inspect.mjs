export async function inspectGifFile(file){
    const header=new Uint8Array(await file.slice(0,6).arrayBuffer());
    if(!/^GIF8[79]a$/.test(new TextDecoder().decode(header)))return null;
    const {parseGif}=await import('./gif-core.mjs?v=1');
    const info=parseGif(new Uint8Array(await file.arrayBuffer()),{limits:false});
    return {width:info.width,height:info.height,animated:info.animated,frames:info.frames.length,duration:info.duration,loop:info.loop};
}
