(()=>{
    const $=id=>document.getElementById(id);
    const mode=document.body.dataset.sortMode;
    const imageMode=mode==='sorteio-imagens',numberMode=mode==='sorteio-numeros';
    const status=$('drawStatus');
    let images=[],pool=[],rounds=[],nextImageId=0,busy=false,drawToken=0;
    let countdownImageUrl=null,audioBuffer=null,audioContext=null;
    const say=(message,error=false)=>{status.textContent=message;status.classList.toggle('error',error)};

    function render(){
        const current=$('drawCurrent'),history=$('drawHistory');current.replaceChildren();history.replaceChildren();
        const last=rounds.at(-1);
        if(last){
            for(const item of last){const card=document.createElement('div');card.className='draw-result';if(imageMode){const picture=document.createElement('img');picture.src=item.url;picture.alt=item.label;card.append(picture)}const label=document.createElement('strong');label.textContent=item.label;card.append(label);current.append(card)}
            rounds.forEach((round,index)=>{const row=document.createElement('li');row.textContent=`Rodada ${index+1}: ${round.map(item=>item.label).join(', ')}`;history.append(row)});
        }
        const used=new Set(rounds.flat().map(item=>item.id)),remaining=pool.filter(item=>!used.has(item.id)).length;
        $('drawRemaining').textContent=pool.length?`${pool.length} itens na lista • ${remaining} ainda não sorteados`:'Prepare a lista e clique em Sortear.';
        $('drawStart').disabled=busy;$('drawAgain').disabled=busy||!rounds.length;$('drawRestart').disabled=busy||!rounds.length;$('drawExport').disabled=busy||!rounds.length;
    }
    function cancelPending(){drawToken++;$('drawCountdownOverlay').hidden=true}
    function reset(){cancelPending();pool=[];rounds=[];render();say('Lista alterada. Clique em “Sortear” para iniciar um novo sorteio.')}
    function parsePool(){
        if(imageMode){if(!images.length)throw new Error('Importe pelo menos uma imagem antes de sortear.');return [...images]}
        const raw=$('drawList').value.trim();
        if(raw){const values=[...new Set(raw.split(/[\n,]+/).map(value=>value.trim()).filter(Boolean))];if(values.length>5000)throw new Error('Use no máximo 5.000 itens na lista.');if(numberMode)for(const value of values)if(!/^-?\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw new Error(`“${value}” não é um número inteiro válido.`);return values.map((label,index)=>({id:String(index),label}))}
        if(!numberMode)throw new Error('Digite ou importe uma lista separada por vírgulas.');
        const min=Number($('drawMin').value),max=Number($('drawMax').value);
        if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||min>max)throw new Error('Informe um intervalo válido: número inicial menor ou igual ao final.');
        if(max-min+1>100000)throw new Error('O intervalo pode conter no máximo 100.000 números.');
        return Array.from({length:max-min+1},(_,index)=>({id:String(index),label:String(min+index)}));
    }
    function desiredCount(){const value=Number($('drawCount').value);if(!Number.isInteger(value)||value<1||value>100)throw new Error('Escolha de 1 a 100 itens por rodada.');return value}
    function randomIndex(max){const values=new Uint32Array(1),limit=Math.floor(0x100000000/max)*max;do{crypto.getRandomValues(values)}while(values[0]>=limit);return values[0]%max}
    function choose(candidates,count){const list=[...candidates];for(let i=0;i<count;i++){const j=i+randomIndex(list.length-i);[list[i],list[j]]=[list[j],list[i]]}return list.slice(0,count)}

    function getAudioContext(){if(!audioContext){const AudioContextClass=window.AudioContext||window.webkitAudioContext;if(!AudioContextClass)return null;audioContext=new AudioContextClass()}audioContext.resume().catch(()=>{});return audioContext}
    function tone(frequency,duration,delay=0,shape='sine',strength=.45){
        const context=getAudioContext();if(!context)return;const volume=Number($('drawSoundVolume').value)/100;if(!volume)return;
        const oscillator=context.createOscillator(),gain=context.createGain(),start=context.currentTime+delay;
        oscillator.type=shape;oscillator.frequency.setValueAtTime(frequency,start);gain.gain.setValueAtTime(.001,start);gain.gain.exponentialRampToValueAtTime(Math.max(.001,volume*strength),start+.02);gain.gain.exponentialRampToValueAtTime(.001,start+duration);
        oscillator.connect(gain).connect(context.destination);oscillator.start(start);oscillator.stop(start+duration+.02);
    }
    function playTick(){if(!$('drawSoundEnabled').checked)return;tone(480,.12,0,'sine',.2)}
    function playReveal(){
        if(!$('drawSoundEnabled').checked)return;const preset=$('drawSoundPreset').value,context=getAudioContext();if(!context)return;
        if(preset==='custom'){if(!audioBuffer)return;const source=context.createBufferSource(),gain=context.createGain();source.buffer=audioBuffer;gain.gain.value=Number($('drawSoundVolume').value)/100;source.connect(gain).connect(context.destination);source.start(0,0,Math.min(audioBuffer.duration,8));return}
        if(preset==='drum'){tone(150,.3,0,'triangle',.65);tone(85,.4,.12,'triangle',.55)}
        else if(preset==='beep'){tone(740,.22,0,'square',.27);tone(980,.35,.26,'square',.27)}
        else{tone(523,.3,0);tone(659,.3,.16);tone(784,.55,.32)}
    }
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    async function countdown(token){
        if(!$('drawCountdownEnabled').checked)return true;
        const overlay=$('drawCountdownOverlay'),number=$('drawCountdownNumber'),cancel=$('drawCountdownCancel'),focused=document.activeElement;
        $('drawCountdownLabel').textContent=$('drawCountdownText').value.trim()||'Preparando o sorteio';
        number.style.color=$('drawCountdownColor').value;
        const backdrop=$('drawCountdownBackdrop');backdrop.hidden=!countdownImageUrl;if(countdownImageUrl)backdrop.src=countdownImageUrl;
        overlay.hidden=false;cancel.focus();
        for(let value=Number($('drawCountdownSeconds').value);value>0;value--){number.textContent=String(value);number.classList.remove('pulse');void number.offsetWidth;number.classList.add('pulse');playTick();await wait(1000);if(token!==drawToken){overlay.hidden=true;setTimeout(()=>focused?.focus?.(),0);return false}}
        overlay.hidden=true;setTimeout(()=>focused?.focus?.(),0);return true;
    }
    async function take(kind){
        if(busy)return;
        try{
            const count=desiredCount(),candidatePool=rounds.length?pool:parsePool();
            if($('drawSoundEnabled').checked&&$('drawSoundPreset').value==='custom'&&!audioBuffer)throw new Error('Importe um arquivo de áudio em Personalizar som antes de sortear.');
            const baseRounds=kind==='again'&&rounds.length?rounds.slice(0,-1):[...rounds];
            const previous=kind==='again'?rounds.at(-1):null,used=new Set(baseRounds.flat().map(item=>item.id));
            let available=candidatePool.filter(item=>!used.has(item.id));
            if(previous&&available.length===previous.length&&available.every(item=>previous.some(old=>old.id===item.id)))throw new Error('Não há outros itens disponíveis para substituir a última rodada.');
            if(previous&&available.length-previous.length>=count){const oldIds=new Set(previous.map(item=>item.id));available=available.filter(item=>!oldIds.has(item.id))}
            if(count>available.length)throw new Error(`Restam ${available.length} itens. Reduza a quantidade por rodada ou clique em “Recomeçar”.`);
            const token=drawToken;busy=true;render();if($('drawSoundEnabled').checked)getAudioContext();
            if(!await countdown(token)||token!==drawToken)return;
            pool=candidatePool;rounds=[...baseRounds,choose(available,count)];playReveal();say(previous?'Última rodada substituída.':'Sorteio realizado sem repetir itens anteriores.');
        }catch(error){say(error.message||'Não foi possível sortear.',true)}finally{busy=false;render()}
    }

    function renderImageList(){const list=$('drawImageList');list.replaceChildren(...images.map(item=>{const card=document.createElement('div');card.className='draw-image-item';const image=document.createElement('img');image.src=item.url;image.alt=item.label;const remove=document.createElement('button');remove.type='button';remove.className='draw-image-remove';remove.textContent='×';remove.setAttribute('aria-label',`Remover imagem ${item.label}`);remove.onclick=()=>{cancelPending();images=images.filter(candidate=>candidate.id!==item.id);pool=pool.filter(candidate=>candidate.id!==item.id);rounds=rounds.map(round=>round.filter(candidate=>candidate.id!==item.id)).filter(round=>round.length);renderImageList();render();URL.revokeObjectURL(item.url);say(`Imagem removida: ${item.label}.`)};card.append(image,remove);return card}));list.hidden=!images.length}
    if(imageMode){
        $('drawImages').addEventListener('change',event=>{const files=[...event.target.files];event.target.value='';if(!files.length)return;const totalCount=images.length+files.length,totalBytes=images.reduce((sum,item)=>sum+item.size,0)+files.reduce((sum,file)=>sum+file.size,0);if(totalCount>100||totalBytes>80*1024*1024){$('drawLimitHelp').hidden=false;say(`Limite excedido: a lista teria ${totalCount} imagens e ${(totalBytes/1024/1024).toFixed(1)} MB. O máximo é 100 imagens e 80 MB.`,true);return}if(files.some(file=>!/^image\/(png|jpeg|webp|gif|avif)$/.test(file.type))){say('Use imagens PNG, JPG, WebP, GIF ou AVIF.',true);return}cancelPending();$('drawLimitHelp').hidden=true;images.push(...files.map(file=>({id:String(nextImageId++),label:file.name,size:file.size,url:URL.createObjectURL(file)})));if(pool.length)pool=[...images];renderImageList();render();say(`${files.length} imagem(ns) adicionada(s). ${images.length} na lista.`)});
    }else{
        $('drawList').addEventListener('input',reset);
        $('drawTextFile').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;if(file.size>1024*1024){say('A lista deve ter até 1 MB.',true);return}try{$('drawList').value=(await file.text()).replace(/^\uFEFF/,'');reset();say(`Lista importada: ${file.name}. Confira os itens e clique em “Sortear”.`)}catch{say('Não foi possível ler a lista.',true)}event.target.value=''})
    }
    if(numberMode){$('drawMin').addEventListener('input',reset);$('drawMax').addEventListener('input',reset)}
    $('drawStart').addEventListener('click',()=>take('draw'));
    $('drawAgain').addEventListener('click',()=>take('again'));
    $('drawRestart').addEventListener('click',()=>{if(busy)return;cancelPending();rounds=[];render();say('Resultados apagados. A lista foi mantida; clique em “Sortear” para começar novamente.')});
    $('drawExport').addEventListener('click',()=>{if(!rounds.length)return;const cell=value=>{const text=String(value),safe=/^[\s]*[=+\-@\t\r]/.test(text)?`'${text}`:text;return`"${safe.replace(/"/g,'""')}"`},lines=['Rodada,Posição,Resultado'];rounds.forEach((round,index)=>round.forEach((item,position)=>lines.push(`${index+1},${position+1},${cell(item.label)}`)));const blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${mode}-resultados.csv`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);say('Resultados exportados em CSV.')});

    const dialog=$('drawCustomization');
    function openSettings(which){$('drawCustomizationTitle').textContent=which==='countdown'?'Personalizar contagem regressiva':'Personalizar som';$('drawCountdownSettings').hidden=which!=='countdown';$('drawSoundSettings').hidden=which!=='sound';$(which==='countdown'?'drawCountdownEnabled':'drawSoundEnabled').checked=true;dialog.showModal();}
    $('drawCustomizeCountdown').onclick=()=>openSettings('countdown');$('drawCustomizeSound').onclick=()=>openSettings('sound');
    $('drawCustomizationClose').onclick=()=>dialog.close();$('drawCustomizationDone').onclick=()=>dialog.close();
    $('drawCountdownCancel').onclick=()=>{cancelPending();say('Contagem regressiva cancelada.')};
    $('drawCountdownOverlay').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();cancelPending();say('Contagem regressiva cancelada.')}else if(event.key==='Tab'){event.preventDefault();$('drawCountdownCancel').focus()}});
    $('drawCountdownFile').addEventListener('change',event=>{const file=event.target.files[0];if(!file)return;if(file.size>10*1024*1024||!/^image\/(gif|png|jpeg|webp)$/.test(file.type)){say('Escolha um GIF ou imagem de até 10 MB.',true);event.target.value='';return}if(countdownImageUrl)URL.revokeObjectURL(countdownImageUrl);countdownImageUrl=URL.createObjectURL(file);$('drawCountdownPreview').src=countdownImageUrl;$('drawCountdownPreview').hidden=false;event.target.value=''});
    $('drawCountdownClear').onclick=()=>{if(countdownImageUrl)URL.revokeObjectURL(countdownImageUrl);countdownImageUrl=null;$('drawCountdownPreview').hidden=true;$('drawCountdownPreview').removeAttribute('src')};
    $('drawSoundPreset').onchange=()=>{$('drawSoundFileWrap').hidden=$('drawSoundPreset').value!=='custom'};
    $('drawSoundVolume').oninput=()=>{$('drawSoundVolumeValue').textContent=`${$('drawSoundVolume').value}%`};
    $('drawSoundFile').onchange=async event=>{const file=event.target.files[0];if(!file)return;if(file.size>5*1024*1024){say('Escolha um áudio de até 5 MB.',true);event.target.value='';return}try{const context=getAudioContext();if(!context)throw new Error('Este navegador não consegue reproduzir áudio.');audioBuffer=await context.decodeAudioData(await file.arrayBuffer());say(`Áudio pronto: ${file.name}.`)}catch(error){audioBuffer=null;say(error.message||'Não foi possível abrir o áudio.',true)}event.target.value=''};
    $('drawSoundPreview').onclick=()=>{if($('drawSoundPreset').value==='custom'&&!audioBuffer){say('Importe um arquivo de áudio para ouvir a prévia.',true);return}const enabled=$('drawSoundEnabled').checked;$('drawSoundEnabled').checked=true;playReveal();$('drawSoundEnabled').checked=enabled};
    window.addEventListener('beforeunload',()=>{for(const item of images)URL.revokeObjectURL(item.url);if(countdownImageUrl)URL.revokeObjectURL(countdownImageUrl);audioContext?.close?.()});
    render();
})();
