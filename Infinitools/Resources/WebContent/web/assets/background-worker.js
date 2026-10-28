/* All inference assets are hosted alongside this application. */
importScripts('./vendor/image-ai/ort.wasm.min.js');
ort.env.wasm.numThreads=1;
ort.env.wasm.wasmPaths=new URL('./vendor/image-ai/',self.location.href).href;
ort.env.logLevel='error';
let session;
self.onmessage=async event=>{
    try{
        if(!session)session=await ort.InferenceSession.create(new URL('./vendor/image-ai/u2netp.onnx',self.location.href).href,{executionProviders:['wasm']});
        const tensor=new ort.Tensor('float32',event.data.input,[1,3,320,320]),result=await session.run({[session.inputNames[0]]:tensor}),values=result[session.outputNames[0]].data;
        let min=Infinity,max=-Infinity;for(let i=0;i<320*320;i++){min=Math.min(min,values[i]);max=Math.max(max,values[i])}
        const mask=new Uint8ClampedArray(320*320);for(let i=0;i<mask.length;i++)mask[i]=Math.max(0,Math.min(255,(values[i]-min)/Math.max(1e-8,max-min)*255));
        tensor.dispose();Object.values(result).forEach(t=>t.dispose());self.postMessage({mask},[mask.buffer]);
    }catch(error){session=null;self.postMessage({error:error.message||String(error)})}
};
