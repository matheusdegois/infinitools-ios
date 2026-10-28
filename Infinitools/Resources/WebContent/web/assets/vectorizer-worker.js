import './vendor/imagetracer/imagetracer-1.2.6.js';
import {vectorize} from './vectorizer-core.mjs';
self.onmessage=({data})=>{
    try {
        const result=vectorize(self.ImageTracer,{width:data.width,height:data.height,data:new Uint8ClampedArray(data.buffer)},data.settings);
        self.postMessage({ok:true,...result});
    } catch(error) {self.postMessage({ok:false,error:error.message||'Não foi possível vetorizar esta imagem.'});}
};
