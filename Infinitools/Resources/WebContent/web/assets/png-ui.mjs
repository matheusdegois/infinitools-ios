import {qualityColors} from './png-optimizer.mjs?v=3';
export class PngOptimizerUI {
    constructor(options){
        this.options=options;
        options.classList.add('png-options');
        options.innerHTML=`<label>Modo de otimização<select id="pngMode"><option value="lossless">Sem alteração dos pixels</option><option value="colors">Redução de cores (altera os pixels)</option></select></label>
        <label id="pngQualityLabel" hidden>Qualidade da redução de cores <input id="pngQuality" type="range" min="0" max="100" value="80"><output id="pngQualityValue"></output></label>
        <label class="png-check"><input type="checkbox" id="stripMetadata" checked> Remover EXIF e metadados de texto</label>
        <label class="png-check"><input type="checkbox" id="pngKeepSmaller" checked> Usar redução de cores somente se o arquivo ficar menor</label>
        <p class="png-note">O modo padrão preserva os pixels. A redução de cores pode alterar tons e degradês; confira a comparação antes de baixar. A transparência é preservada. APNG mantém todos os quadros, seus tempos e repetições.</p>`;
        this.mode=options.querySelector('#pngMode');this.quality=options.querySelector('#pngQuality');
        const update=()=>{options.querySelector('#pngQualityLabel').hidden=this.mode.value!=='colors';options.querySelector('#pngQualityValue').textContent=`${this.quality.value}% · paleta de referência: ${qualityColors(this.quality.value)} cores`;options.querySelector('#pngKeepSmaller').disabled=this.mode.value!=='colors';};
        options.addEventListener('input',update);update();
    }
    setBusy(busy){for(const el of this.options.querySelectorAll('input,select'))el.disabled=busy;this.options.querySelector('#pngKeepSmaller').disabled=busy||this.mode.value!=='colors';}
    async process(file,setWorker){
        const bytes=await file.arrayBuffer(),options={mode:this.mode.value,quality:Number(this.quality.value),stripMetadata:this.options.querySelector('#stripMetadata').checked,keepSmaller:this.options.querySelector('#pngKeepSmaller').checked};
        return new Promise((resolve,reject)=>{
            const worker=new Worker(new URL('./png-worker.js?v=3',import.meta.url)),terminate=worker.terminate.bind(worker);
            const timer=setTimeout(()=>{terminate();reject(new Error('O processamento excedeu 2 minutos. Use uma imagem menor.'));},120000);
            worker.onerror=()=>{clearTimeout(timer);terminate();reject(new Error('Não foi possível carregar o otimizador PNG. Recarregue a página.'));};
            // Termination also settles cancellation and releases the timer.
            worker.terminate=()=>{clearTimeout(timer);terminate();reject(new Error('cancelled'));};
            worker.onmessage=({data})=>{clearTimeout(timer);terminate();data.error?reject(new Error(data.error)):resolve(data);};
            if(setWorker(worker)!==false)worker.postMessage({bytes,options},[bytes]);
        });
    }
    show(result,file,outputURL,originalURL,summary,size){
        const format=n=>`${n.toLocaleString('pt-BR')} bytes (${(n/1024).toLocaleString('pt-BR',{maximumFractionDigits:1})} KB)`,saved=file.size-size,percent=(Math.abs(saved)/file.size*100).toLocaleString('pt-BR',{maximumFractionDigits:1});
        const panel=document.createElement('section');panel.className='png-comparison';
        const stats=document.createElement('div');stats.className='png-sizes';
        for(const [label,value] of [['Original',format(file.size)],['Resultado',format(size)],[saved>=0?'Economia':'Aumento',`${percent}% · ${format(Math.abs(saved))}`]]){const card=document.createElement('p'),strong=document.createElement('strong');strong.textContent=label;card.append(strong,document.createElement('br'),value);stats.append(card);}
        const note=document.createElement('p');note.className='png-note';note.textContent=`${summary.width} × ${summary.height} px. ${summary.reduced?'Cores reduzidas; pixels RGB alterados.':'Pixels preservados.'} ${summary.animated?`APNG: ${summary.frames} quadros; tempos e transparência preservados. As prévias animam independentemente.`:''} ${summary.note}`;
        const controls=document.createElement('label');controls.textContent='Fundo da comparação';const background=document.createElement('select');background.id='pngComparisonBackground';for(const [value,label] of [['checker','Transparência (xadrez)'],['white','Branco'],['black','Preto']]){const o=document.createElement('option');o.value=value;o.textContent=label;background.append(o);}controls.append(background);
        const pair=document.createElement('div');pair.className='png-pair';
        for(const [label,url] of [['Original',originalURL],['Resultado',outputURL]]){const figure=document.createElement('figure'),caption=document.createElement('figcaption'),frame=document.createElement('div'),image=document.createElement('img');frame.className='png-preview-frame';caption.textContent=label;image.alt=label+' do PNG';image.src=url;frame.append(image);figure.append(caption,frame);pair.append(figure);}
        const updateBackground=()=>{pair.dataset.background=background.value;pair.style.setProperty('--comparison-background',background.value==='black'?'#000':background.value==='white'?'#fff':'repeating-conic-gradient(#e2e5e9 0% 25%,#fff 0% 50%) 0/16px 16px');};background.addEventListener('input',updateBackground);background.addEventListener('change',updateBackground);updateBackground();
        panel.append(stats,note,controls,pair);result.append(panel);
        return `Original: ${file.size} bytes. Resultado: ${size} bytes. ${note.textContent}`;
    }
}
