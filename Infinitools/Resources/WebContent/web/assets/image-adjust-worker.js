import {adjustPixels,healPixels} from './image-core.mjs?v=2';
self.onmessage=({data:m})=>{try{const result=m.kind==='heal'?healPixels(m.pixels,m.width,m.height,m.mask,m.settings):adjustPixels(m.pixels,m.width,m.height,m.settings);self.postMessage({id:m.id,pixels:result},[result.buffer])}catch(e){self.postMessage({id:m.id,error:e.message})}};
