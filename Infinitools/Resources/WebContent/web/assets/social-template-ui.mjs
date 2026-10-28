const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

export function setupSocialEditor(editor){
 const root=editor.root;
 root.classList.add('social-template-options');
 const shell=document.createElement('div');shell.className='social-template-shell';
 const toolbar=document.createElement('div');toolbar.className='social-template-toolbar';
 const button=(id,text)=>{const b=document.createElement('button');b.id=id;b.type='button';b.textContent=text;return b;};
 const place=button('placeLayer','Posicionar com clique');place.setAttribute('aria-pressed','false');
 for(const id of ['addText','addImage'])toolbar.append(editor.get(id));toolbar.append(place);
 const sidebar=document.createElement('aside');sidebar.className='social-template-sidebar';sidebar.setAttribute('aria-label','Propriedades da composição');
 const tabs=document.createElement('div');tabs.className='social-template-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Opções da imagem');
 const panels=new Map(),tabButtons=[];
 for(const [id,label] of [['design','Modelo'],['text','Texto'],['image','Imagem'],['layers','Camadas']]){
  const tab=button('template-tab-'+id,label);tab.dataset.templateTab=id;tab.setAttribute('role','tab');tab.setAttribute('aria-controls','template-panel-'+id);tabs.append(tab);tabButtons.push(tab);
  const panel=document.createElement('section');panel.id='template-panel-'+id;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);panel.className='social-template-panel';panels.set(id,panel);
 }
 sidebar.append(tabs,editor.get('layerSelect').closest('label'),...panels.values());
 // Keep moved controls inside root so the existing editor lookup stays valid
 // while constructing the panels.
 shell.append(toolbar,sidebar);root.append(shell);
 const move=(id,panel)=>{const control=editor.get(id);if(control)panels.get(panel).append(control.closest('label'));};
 for(const id of ['background','layoutPreset','ratio','columns','gap'])move(id,'design');
 for(const id of ['allowImageBackground'])move(id,'design');
 for(const id of ['templateBackgroundNote','templateBackgroundStatus']){const node=editor.get(id);if(node)panels.get('design').append(node);}
 for(const id of ['title','fontSize','textColor','textAlign'])move(id,'text');
 for(const id of ['layerImage','imageSource','cropX','cropY','imageZoom'])move(id,'image');
 move('layerOpacity','layers');
 for(const id of ['layerX','layerY','layerW','layerH'])editor.get(id)?.closest('label').remove();
 editor.get('layerOpacity').type='range';editor.get('layerOpacity').min='0';editor.get('layerOpacity').max='100';
 for(const id of ['cropX','cropY','imageZoom']){const control=editor.get(id);control.type='range';}
 editor.get('imageZoom').min='1';editor.get('imageZoom').max='3';editor.get('imageZoom').step='0.05';
 const upload=editor.get('layerImage').closest('label');upload.classList.add('template-file-upload');upload.insertAdjacentHTML('afterbegin','<strong>Escolher outra imagem</strong><span>Clique para adicionar ou substituir a foto desta área</span>');
 const layerList=document.createElement('div');layerList.className='social-layer-list';panels.get('layers').append(layerList);
 const reorder=document.createElement('div');reorder.className='social-layer-actions';const front=button('layerFront','Trazer à frente'),back=button('layerBack','Enviar para trás');reorder.append(front,back,editor.get('removeLayer'));panels.get('layers').append(reorder);
 const note=document.createElement('p');note.className='template-interaction-note';note.setAttribute('role','status');note.setAttribute('aria-live','polite');
 const empty=document.createElement('div');empty.className='template-editor-empty';empty.innerHTML='<strong>Sua composição aparece aqui</strong><p>Escolha as imagens acima e personalize o modelo nas abas ao lado.</p>';
 shell.append(toolbar,empty,editor.preview,sidebar,note);root.replaceChildren(shell);
 let activeTab='design',placing=false,drag=null;
 const changed=()=>root.dispatchEvent(new Event('templatechange'));
 function showTab(id,selectType=true){
  activeTab=id;
  if(selectType&&['text','image'].includes(id)&&editor.layers[editor.selected]?.type!==id){const index=editor.layers.findIndex(l=>l.type===id);if(index>=0){editor.selected=index;editor.sync();editor.render();}}
  for(const b of tabButtons){const active=b.dataset.templateTab===id;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;}
  for(const [key,panel] of panels)panel.hidden=key!==id;
 }
 for(const b of tabButtons)b.onclick=()=>showTab(b.dataset.templateTab);
 tabs.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const available=tabButtons.filter(b=>!b.disabled),index=available.findIndex(b=>b===document.activeElement),next=event.key==='Home'?0:event.key==='End'?available.length-1:(index+(event.key==='ArrowRight'?1:available.length-1))%available.length;showTab(available[next].dataset.templateTab);available[next].focus();});
 function setPlacing(value){placing=value;place.setAttribute('aria-pressed',String(value));editor.canvas.classList.toggle('placing',value);note.textContent=value?'Clique ou toque na prévia para posicionar a área selecionada.':'Clique para selecionar. Arraste para mover e use os quadrados dos cantos para redimensionar.';}
 place.onclick=()=>setPlacing(!placing);
 for(const [b,delta] of [[front,1],[back,-1]])b.onclick=()=>{const next=editor.selected+delta;if(next<0||next>=editor.layers.length)return;[editor.layers[next],editor.layers[editor.selected]]=[editor.layers[editor.selected],editor.layers[next]];editor.selected=next;editor.sync();editor.render();changed();};
 // Replace dropdowns with buttons, retaining hidden selects as the editor's
 // source of truth for presets and export dimensions.
 for(const id of ['layoutPreset','ratio']){
  const control=editor.get(id);if(!control)continue;const label=control.closest('label'),group=document.createElement('div');group.className=id==='ratio'?'social-format-buttons':'social-preset-buttons';group.setAttribute('aria-label',id==='ratio'?'Formato da imagem':'Modelo da composição');
  for(const option of [...control.options]){const b=button('',option.textContent);b.dataset.templateControl=id;b.dataset.templateValue=option.value;if(id==='layoutPreset'){const swatch=document.createElement('span');swatch.className='social-preset-swatch preset-'+option.value;b.prepend(swatch);}b.onclick=()=>{control.value=option.value;control.dispatchEvent(new Event('input',{bubbles:true}));sync();};group.append(b);}
  control.hidden=true;label.append(group);
 }
 editor.preview.querySelector('p').textContent='Selecione e posicione as áreas diretamente na imagem. Os contornos não aparecem no arquivo final.';
 editor.canvas.setAttribute('aria-label','Composição editável: clique, arraste ou use as setas para posicionar a área selecionada');
 editor.canvas.addEventListener('pointerdown',event=>{
  if(event.button!==0)return;event.preventDefault();editor.canvas.focus({preventScroll:true});const p=editor.point(event),selected=editor.layers[editor.selected];
  if(placing&&selected){selected.x=clamp(p.x-selected.w/2,0,1-selected.w);selected.y=clamp(p.y-selected.h/2,0,1-selected.h);setPlacing(false);editor.sync();editor.render();changed();return;}
  let handle=null;
  if(selected){const box=editor.canvas.getBoundingClientRect(),tx=12/box.width,ty=12/box.height;for(const [name,x,y] of [['nw',selected.x,selected.y],['ne',selected.x+selected.w,selected.y],['se',selected.x+selected.w,selected.y+selected.h],['sw',selected.x,selected.y+selected.h]])if(Math.abs(p.x-x)<=tx&&Math.abs(p.y-y)<=ty){handle=name;break;}}
  if(!handle){let hit=-1;for(let i=editor.layers.length-1;i>=0;i--){const l=editor.layers[i];if(p.x>=l.x&&p.y>=l.y&&p.x<=l.x+l.w&&p.y<=l.y+l.h){hit=i;break;}}if(hit<0)return;editor.selected=hit;}
  const layer=editor.layers[editor.selected];drag={id:event.pointerId,handle,px:p.x,py:p.y,x:layer.x,y:layer.y,w:layer.w,h:layer.h,layer};editor.canvas.setPointerCapture(event.pointerId);editor.sync();showTab(layer.type,false);editor.render();
 });
 editor.canvas.addEventListener('pointermove',event=>{
  if(!drag||drag.id!==event.pointerId)return;const p=editor.point(event),l=drag.layer,dx=p.x-drag.px,dy=p.y-drag.py;
  if(drag.handle){let left=drag.x,top=drag.y,right=drag.x+drag.w,bottom=drag.y+drag.h;if(drag.handle.includes('w'))left=clamp(left+dx,0,right-.035);if(drag.handle.includes('e'))right=clamp(right+dx,left+.035,1);if(drag.handle.includes('n'))top=clamp(top+dy,0,bottom-.035);if(drag.handle.includes('s'))bottom=clamp(bottom+dy,top+.035,1);Object.assign(l,{x:left,y:top,w:right-left,h:bottom-top});}
  else{l.x=clamp(drag.x+dx,0,1-l.w);l.y=clamp(drag.y+dy,0,1-l.h);}
  editor.sync();editor.render();changed();
 });
 for(const name of ['pointerup','pointercancel','lostpointercapture'])editor.canvas.addEventListener(name,()=>drag=null);
 editor.canvas.addEventListener('keydown',event=>{const layer=editor.layers[editor.selected];if(!layer)return;if(event.key==='Delete'){editor.get('removeLayer').click();return;}if(!event.key.startsWith('Arrow'))return;event.preventDefault();const step=(event.shiftKey?10:1);if(['ArrowLeft','ArrowRight'].includes(event.key))layer.x=clamp(layer.x+(event.key==='ArrowRight'?step:-step)/editor.canvas.width,0,1-layer.w);else layer.y=clamp(layer.y+(event.key==='ArrowDown'?step:-step)/editor.canvas.height,0,1-layer.h);editor.sync();editor.render();changed();});
 function sync(){
  const selected=editor.layers[editor.selected];empty.hidden=!!editor.images.length;
  const ready=!!editor.images.length;place.disabled=!selected||!ready;front.disabled=!selected||!ready||editor.selected===editor.layers.length-1;back.disabled=!selected||!ready||editor.selected===0;editor.get('removeLayer').disabled=!selected||!ready;editor.get('addImage').disabled=!ready;editor.get('addText').disabled=!ready;for(const tab of tabButtons)tab.disabled=!ready&&tab.dataset.templateTab!=='design';
  for(const b of root.querySelectorAll('[data-template-control]'))b.setAttribute('aria-pressed',String(editor.value(b.dataset.templateControl)===b.dataset.templateValue));
  layerList.replaceChildren(...[...editor.layers.entries()].reverse().map(([index,layer])=>{const b=button('',layer.type==='text'?(layer.text||'Texto vazio').slice(0,45):'Imagem '+(layer.image+1));b.setAttribute('aria-pressed',String(index===editor.selected));b.onclick=()=>{editor.selected=index;setPlacing(false);editor.sync();editor.render();};return b;}));
 }
 showTab(activeTab,false);setPlacing(false);sync();
 return{sync,cancelPlacement(){setPlacing(false);drag=null;},placeNewLayer(type){showTab(type,false);setPlacing(true);}};
}
