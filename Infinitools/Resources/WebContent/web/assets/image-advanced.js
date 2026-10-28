import {clamp} from './image-core.mjs';
import {colorRegion,combineMasks,edgeMap,snapToEdge,sliceRects,reorderLayers,validQuad,warpPerspective,localFilter} from './image-advanced-core.mjs';

export const MODE_KEYS={move:'V',marquee:'M','ellipse-select':'Shift+M',lasso:'L','polygon-lasso':'Shift+L','magnetic-lasso':'Alt+L',wand:'W','quick-select':'Shift+W','object-select':'Alt+W',crop:'C',perspective:'Shift+C',slice:'Alt+C',brush:'B',pencil:'Shift+B',clone:'S',eraser:'E',bucket:'G',gradient:'Shift+G',blur:'R',sharpen:'Shift+R',smudge:'Alt+R',text:'T','text-vertical':'Shift+T',pen:'P',rectangle:'U',ellipse:'Shift+U',polygon:'Alt+U',zoom:'Z',hand:'H',background:'Alt+B',merge:'Alt+M',rotate:'Alt+O',exposure:'Alt+E',contrast:'Alt+K',lights:'Alt+I',temperature:'Alt+T',saturation:'Alt+S',hue:'Alt+H',sharpness:'Alt+N',noise:'Alt+D',heal:'J',insert:'I',layers:'K',curves:'Q','webp-jpg':'Alt+J','webp-png':'Alt+P'};
const SELECT_MODES=['marquee','ellipse-select','lasso','polygon-lasso','magnetic-lasso','wand','quick-select','object-select'];
const PAINT_MODES=['brush','pencil','eraser','blur','sharpen','smudge'];
const SHAPE_MODES=['rectangle','ellipse','polygon'];

export function createAdvancedEditor(host){
    const {$,canvas,overlay,viewport,makeCanvas,copyCanvas,checkpoint,changed,message,activity,drawOverlay,renderControls,renderLayerList}=host;
    const S=()=>host.state,L=()=>host.selected(),M=()=>host.mode;
    let gesture=null,path=[],pathHover=null,edgeData=null,quad=null,spaceHeld=false,selectionCache=null,lastState=S(),lastDimensions='',layerDrag=null,touchSort=null,aiWorker=null;
    let selectionOp='replace',moveTarget='layer',paintSize=35,opacity=100,hardness=80,texture='round',brushText='A',color='#ff5a0a',secondColor='#ffffff',tolerance=35,contiguous=true,gradientType='linear',sliceColumns=2,sliceRows=2,objectThreshold=120;
    let textValue='Seu texto',fontFamily='Arial',fontSize=36,textColor='#000000',textBold=false,textItalic=false,textAlign='left',textEditActive=false,shapeStroke='#20252c',lineWidth=3,shapeFill=true,sides=6,pathClosed=true,pathEditId=null;
    const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const button=(id,label,primary=false)=>`<button type="button" class="image-command${primary?' primary':''}" data-command="${id}">${label}</button>`;
    const select=(id,label,items,value)=>`<label class="image-control"><span>${label}</span><select id="${id}">${items.map(([v,t])=>`<option value="${v}"${String(value)===v?' selected':''}>${t}</option>`).join('')}</select></label>`;
    const range=(id,label,min,max,value)=>`<label class="image-control"><span>${label}<output>${value}</output></span><input id="${id}" type="range" min="${min}" max="${max}" value="${value}"></label>`;
    const number=(id,label,value,min,max)=>`<label class="image-control"><span>${label}</span><input id="${id}" type="number" value="${value}" min="${min}" max="${max}"></label>`;
    const colorInput=(id,label,value)=>`<label class="image-control"><span>${label}</span><input id="${id}" type="color" value="${value}"></label>`;
    const check=(id,label,value)=>`<label class="image-check"><input id="${id}" type="checkbox"${value?' checked':''}> ${label}</label>`;
    function selectionControls(){return select('selectionOperation','Combinar seleção',[['replace','Nova seleção'],['add','Adicionar (Shift)'],['subtract','Subtrair (Alt)'],['intersect','Interseção']],selectionOp)+button('select-all','Selecionar tudo')+button('deselect','Desmarcar seleção')+button('invert-selection','Inverter seleção')+button('selection-layer','Copiar seleção para camada')+button('cut-selection-layer','Recortar seleção para camada')+button('selection-mask','Usar seleção como máscara')+button('delete-selection','Apagar pixels selecionados')+'<p>A seleção limita pintura e preenchimentos. Para aplicar ajustes de cor só à seleção, copie-a para uma camada.</p>'}
    function paintControls(){return range('paintSize','Tamanho (px)',1,250,paintSize)+range('paintOpacity','Opacidade / força (%)',1,100,opacity)+range('paintHardness','Dureza (%)',0,100,hardness)+select('paintTexture','Ponta',[['round','Redonda'],['square','Quadrada'],['rectangle','Retangular'],['letter','Letra / símbolo'],['chalk','Giz'],['spray','Spray']],texture)+`<label class="image-control brush-letter-control${texture==='letter'?' visible':''}"><span>Letra ou símbolo</span><input id="brushText" value="${escape(brushText)}" maxlength="4" aria-label="Letra ou símbolo usado como ponta"></label>`+colorInput('paintColor','Cor',color)+button('blank-layer','Nova camada transparente')}
    function vectorStyle(){return colorInput('paintColor','Preenchimento',color)+colorInput('shapeStroke','Contorno',shapeStroke)+number('shapeLineWidth','Espessura do contorno (px)',lineWidth,0,100)+check('shapeFill','Preencher forma',shapeFill)}
    function controls(mode,layer){
        if(mode==='text'||mode==='text-vertical')textEditActive=false;
        let html=null,hint='';
        if(SELECT_MODES.includes(mode)){
            hint='Arraste na imagem para selecionar. Shift adiciona e Alt subtrai. A seleção não altera a imagem até você aplicar uma ação.';
            html='';
            if(['wand','quick-select'].includes(mode)){html+=range('colorTolerance','Tolerância de cor',0,255,tolerance)+check('colorContiguous','Somente regiões conectadas',contiguous);hint=mode==='wand'?'Clique em uma cor para selecionar uma região semelhante.':'Clique e arraste: as regiões semelhantes tocadas pelo pincel são somadas à seleção.'}
            if(mode==='quick-select')html+=range('paintSize','Diâmetro do pincel (px)',2,150,paintSize);
            if(mode==='polygon-lasso'){hint='Clique nos vértices. Enter, duplo clique ou Concluir fecha o contorno. Esc cancela.';html+=button('finish-path','Concluir seleção',true)+button('cancel-path','Cancelar contorno')}
            if(mode==='magnetic-lasso')hint='Clique e segure, seguindo o contorno. O traçado se aproxima das bordas contrastantes; solte para fechar.';
            if(mode==='object-select'){hint='Arraste um retângulo ao redor do objeto. A IA local seleciona o primeiro plano dessa área; refine somando ou subtraindo seleções.';html+=range('objectThreshold','Limiar da seleção',20,230,objectThreshold)+button('select-subject','Selecionar primeiro plano inteiro',true)+'<p>Não identifica categorias nem separa sempre objetos sobrepostos. Use uma área menor e refine quando necessário.</p>'}
            html+=selectionControls();
        }
        if(mode==='move'){hint='Arraste para mover. Use as setas para deslocar 1 px ou Shift+setas para 10 px. As guias não aparecem no arquivo final.';html=select('moveTarget','Mover',[['layer','Camada'],['selection','Contorno da seleção'],['guides','Guias']],moveTarget)+button('guide-vertical','Adicionar guia vertical')+button('guide-horizontal','Adicionar guia horizontal')+button('clear-guides','Remover guias')+button('selection-layer','Copiar seleção para camada')+button('cut-selection-layer','Recortar seleção para camada')}
        if(mode==='perspective'){ensureQuad();hint='Arraste os quatro cantos: superior esquerdo, superior direito, inferior direito e inferior esquerdo. Aplicar une as camadas; Desfazer recupera o original.';html=button('apply-perspective','Aplicar perspectiva (unir camadas)',true)+button('reset-perspective','Redefinir quatro cantos')+'<p>A área delimitada será retificada em um retângulo.</p>'}
        if(mode==='slice'){hint='Escolha uma grade. As linhas mostram cada fatia que será exportada; o documento original permanece intacto.';html=number('sliceColumns','Colunas',sliceColumns,1,10)+number('sliceRows','Linhas',sliceRows,1,10)+button('export-slices','Finalizar fatias em ZIP',true)+'<p>Até 100 arquivos PNG, com transparência e sem intervalos entre as fatias.</p>'}
        if(PAINT_MODES.includes(mode)){hint=mode==='smudge'?'Arraste para espalhar as cores da camada. A seleção, se houver, limita o efeito.':mode==='eraser'?'A borracha apaga somente elementos e camadas adicionados. A imagem original permanece protegida.':'Pinte diretamente na camada selecionada. A seleção, se houver, limita os traços.';html=paintControls();if(mode==='pencil')html+='<p>O lápis usa ponta dura, independentemente da dureza do pincel.</p>';if(layer.vector)html+='<p>Pintar nesta camada requer convertê-la em pixels. Você será avisado antes de iniciar.</p>'}
        if(mode==='bucket'||mode==='gradient'){hint=mode==='bucket'?'Clique em uma região para preenchê-la com a cor escolhida.':'Arraste do início ao fim do degradê. A seleção limita o preenchimento.';html=colorInput('paintColor','Cor inicial',color)+range('paintOpacity','Opacidade (%)',1,100,opacity);if(mode==='bucket')html+=range('colorTolerance','Tolerância de cor',0,255,tolerance)+check('colorContiguous','Somente regiões conectadas',contiguous);else html+=colorInput('secondColor','Cor final',secondColor)+select('gradientType','Tipo',[['linear','Linear'],['radial','Radial']],gradientType);html+=button('blank-layer','Nova camada transparente')}
        if(mode==='text'||mode==='text-vertical'){
            if(layer.vector?.type==='text'){const v=layer.vector;textValue=v.text;fontFamily=v.font;fontSize=v.size;textBold=v.bold;textItalic=v.italic;textAlign=v.align;textColor=v.color||'#000000'}
            hint='Arraste para criar uma caixa de texto. Selecione uma camada de texto e altere o conteúdo, a fonte ou a cor: a imagem é atualizada enquanto você edita.';
            html=`<label class="image-control"><span>Texto</span><textarea id="vectorText" rows="5" maxlength="3000">${escape(textValue)}</textarea></label>`+select('textFont','Fonte',[['Arial','Arial'],['Helvetica','Helvetica'],['Segoe UI','Segoe UI'],['Calibri','Calibri'],['Cambria','Cambria'],['Georgia','Georgia'],['Garamond','Garamond'],['Palatino Linotype','Palatino Linotype'],['Verdana','Verdana'],['Tahoma','Tahoma'],['Trebuchet MS','Trebuchet MS'],['Century Gothic','Century Gothic'],['Franklin Gothic Medium','Franklin Gothic'],['Lucida Sans Unicode','Lucida Sans'],['Times New Roman','Times New Roman'],['Courier New','Courier New'],['Consolas','Consolas'],['Impact','Impact'],['Comic Sans MS','Comic Sans MS']],fontFamily)+number('textSize','Tamanho (px)',fontSize,6,500)+colorInput('textColor','Cor do texto',textColor)+check('textBold','Negrito',textBold)+check('textItalic','Itálico',textItalic)+select('textAlign','Alinhamento',[['left','Esquerda'],['center','Centro'],['right','Direita']],textAlign)+`<button type="button" data-command="apply-text" hidden>Aplicar texto</button>`+button('new-text','Nova caixa de texto')+'<p>As mudanças aparecem automaticamente. O texto permanece editável durante esta sessão; o download final é uma imagem achatada.</p>';
        }
        if(SHAPE_MODES.includes(mode)){if(layer.vector?.type==='shape'){color=layer.vector.fill;shapeStroke=layer.vector.stroke;shapeFill=layer.vector.filled;lineWidth=layer.vector.lineWidth;sides=layer.vector.sides||sides}hint='Arraste para desenhar uma forma. Segure Shift para manter largura e altura iguais. Selecione a camada e use Atualizar forma para editar seu estilo.';html=vectorStyle();if(mode==='polygon')html+=number('polygonSides','Número de lados',sides,3,20);html+=button('apply-shape','Atualizar forma selecionada',true)}
        if(mode==='pen'){hint='Clique para criar vértices. Clique e arraste para criar alças Bézier. Enter conclui; Esc cancela. Em Editar pontos, arraste vértices ou alças.';html=vectorStyle()+check('pathClosed','Fechar caminho',pathClosed)+button('finish-path','Concluir caminho',true)+button('edit-path','Editar pontos da camada')+button('new-path','Novo caminho')+button('path-selection','Caminho para seleção')+button('cancel-path','Cancelar contorno')}
        if(mode==='zoom'){hint='Clique para ampliar; Alt+clique para reduzir. Use + e − ou Ctrl+0 para ajustar à tela.';html=button('zoom-in','Ampliar')+button('zoom-out','Reduzir')+button('zoom-fit','Ajustar à tela')+button('zoom-actual','Tamanho real (100%)')}
        if(mode==='hand'){hint='Clique e arraste para deslocar a área visível. Segure Espaço em outra ferramenta para usar a mão temporariamente.';html=button('zoom-fit','Ajustar à tela')+button('zoom-actual','Tamanho real (100%)')}
        if(mode==='webp-jpg'||mode==='webp-png'){const format=mode==='webp-jpg'?'JPG':'PNG';hint=`Edite a imagem normalmente e clique em Exportar para baixar em ${format}.`;html=`<p>O formato de saída já está definido como <strong>${format}</strong>. Todas as ferramentas do editor continuam disponíveis antes da conversão.</p>`}
        if(html!==null)$('imageHint').textContent=hint;
        return html;
    }

    function bindControls(){
        const bind=(id,setter,type='change')=>{const el=$(id);if(!el)return;el.addEventListener(type,()=>{setter(el);if(el.type==='range')el.previousElementSibling?.querySelector('output')?.replaceChildren(String(el.value));drawOverlay()})};
        bind('selectionOperation',el=>selectionOp=el.value);bind('moveTarget',el=>moveTarget=el.value);
        bind('paintSize',el=>paintSize=clamp(+el.value,1,250),'input');bind('paintOpacity',el=>opacity=clamp(+el.value,1,100),'input');bind('paintHardness',el=>hardness=clamp(+el.value,0,100),'input');bind('paintTexture',el=>{texture=el.value;host.renderControls()});bind('brushText',el=>brushText=el.value||'A','input');
        bind('paintColor',el=>color=el.value);bind('secondColor',el=>secondColor=el.value);bind('gradientType',el=>gradientType=el.value);
        bind('colorTolerance',el=>tolerance=clamp(+el.value,0,255),'input');bind('colorContiguous',el=>contiguous=el.checked);bind('objectThreshold',el=>objectThreshold=clamp(+el.value,20,230),'input');
        bind('sliceColumns',el=>{sliceColumns=clamp(+el.value||1,1,10);el.value=sliceColumns});bind('sliceRows',el=>{sliceRows=clamp(+el.value||1,1,10);el.value=sliceRows});
        const liveText=()=>updateLiveText();bind('vectorText',el=>{textValue=el.value;liveText()},'input');bind('textFont',el=>{fontFamily=el.value;liveText()});bind('textSize',el=>{fontSize=clamp(+el.value||36,6,500);liveText()},'input');bind('textColor',el=>{textColor=el.value;liveText()},'input');bind('textBold',el=>{textBold=el.checked;liveText()});bind('textItalic',el=>{textItalic=el.checked;liveText()});bind('textAlign',el=>{textAlign=el.value;liveText()});
        bind('shapeStroke',el=>shapeStroke=el.value);bind('shapeLineWidth',el=>lineWidth=clamp(+el.value||0,0,100));bind('shapeFill',el=>shapeFill=el.checked);bind('polygonSides',el=>sides=clamp(Math.round(+el.value)||6,3,20));bind('pathClosed',el=>pathClosed=el.checked);
        host.controlsElement.querySelectorAll('[data-command]').forEach(el=>el.onclick=()=>{if(!host.busy)host.dispatch(el.dataset.command)});
    }

    function maskCanvas(alpha,w=S().width,h=S().height){const c=makeCanvas(w,h),ctx=c.getContext('2d'),d=ctx.createImageData(w,h);for(let i=0;i<alpha.length;i++){d.data[i*4]=255;d.data[i*4+1]=255;d.data[i*4+2]=255;d.data[i*4+3]=alpha[i]}ctx.putImageData(d,0,0);return c}
    function alphaOf(c){if(!c)return null;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data,out=new Uint8Array(d.length/4);for(let i=0;i<out.length;i++)out[i]=d[i*4+3];return out}
    function setSelection(mask,operation=selectionOp,save=true){if(save)checkpoint();S().selection=maskCanvas(combineMasks(alphaOf(S().selection),alphaOf(mask),operation));selectionCache=null;changed();drawOverlay()}
    function selectionOperation(e){return e?.altKey?'subtract':e?.shiftKey?'add':selectionOp}
    function pathMask(points,ellipse=false){const c=makeCanvas(S().width,S().height),ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.beginPath();if(ellipse){const[a,b]=points;ctx.ellipse((a.x+b.x)/2,(a.y+b.y)/2,Math.abs(b.x-a.x)/2,Math.abs(b.y-a.y)/2,0,0,Math.PI*2)}else{points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath()}ctx.fill();return c}
    function rectangular(a,b,square=false){let dx=b.x-a.x,dy=b.y-a.y;if(square){const size=Math.min(Math.abs(dx),Math.abs(dy));dx=Math.sign(dx||1)*size;dy=Math.sign(dy||1)*size}return{x:Math.min(a.x,a.x+dx),y:Math.min(a.y,a.y+dy),w:Math.abs(dx),h:Math.abs(dy)}}
    function corners(r){return[{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.h},{x:r.x,y:r.y+r.h}]}
    function localSelection(layer){
        const sel=S().selection;if(!sel)return null;const c=makeCanvas(layer.source.width,layer.source.height),ctx=c.getContext('2d');
        ctx.scale(c.width/layer.w,c.height/layer.h);ctx.translate(layer.w/2,layer.h/2);ctx.scale(layer.flipX?-1:1,layer.flipY?-1:1);ctx.rotate(-layer.angle*Math.PI/180);ctx.translate(-layer.x-layer.w/2,-layer.y-layer.h/2);ctx.drawImage(sel,0,0);return c;
    }
    function applySelectionToCanvas(c,mask){if(mask){const ctx=c.getContext('2d');ctx.save();ctx.globalCompositeOperation='destination-in';ctx.drawImage(mask,0,0);ctx.restore()}return c}
    function preserveOutside(candidate,original,mask,buffers){
        if(!mask)return candidate;
        if(!buffers){const outside=copyCanvas(original),ctx=outside.getContext('2d');ctx.globalCompositeOperation='destination-out';ctx.drawImage(mask,0,0);ctx.globalCompositeOperation='source-over';ctx.drawImage(applySelectionToCanvas(copyCanvas(candidate),mask),0,0);return outside;}
        // These buffers belong to one gesture only, never to another stroke
        // or a history snapshot. Reuse them instead of copying full canvases
        // on every pointer movement while painting inside a selection.
        const outside=buffers.outside??=makeCanvas(original.width,original.height),inside=buffers.inside??=makeCanvas(candidate.width,candidate.height);
        const ctx=outside.getContext('2d'),ic=inside.getContext('2d');
        ctx.globalCompositeOperation='source-over';ctx.clearRect(0,0,outside.width,outside.height);ctx.drawImage(original,0,0);ctx.globalCompositeOperation='destination-out';ctx.drawImage(mask,0,0);ctx.globalCompositeOperation='source-over';
        ic.globalCompositeOperation='source-over';ic.clearRect(0,0,inside.width,inside.height);ic.drawImage(candidate,0,0);ic.globalCompositeOperation='destination-in';ic.drawImage(mask,0,0);ic.globalCompositeOperation='source-over';ctx.drawImage(inside,0,0);return outside;
    }
    function requireRaster(layer){if(layer.vector)message('A camada vetorial foi convertida em pixels. Use Desfazer para recuperar a versão editável.');return true}
    function touch(layer){layer.pixelVersion=(layer.pixelVersion||0)+1;layer.cache=null;layer.thumb=host.thumbnail(layer.source);changed()}
    function canAdd(source){if(S().layers.length>=8){message('O limite é de 8 camadas. Exclua ou reutilize uma camada.',true);return false}const pixels=S().layers.reduce((total,l)=>total+l.source.width*l.source.height,0)+source.width*source.height;if(pixels>16000000){message('As camadas excedem 16 megapixels. Use um documento menor.',true);return false}return true}
    function addLayer(source,name,options={}){if(!canAdd(source))return null;checkpoint();const layer={...host.newLayer(source,name),...options};S().layers.push(layer);S().selected=layer.id;changed(true);return layer}
    function selectionLayer(cut=false){
        if(!S().selection){message('Crie uma seleção primeiro.',true);return}const layer=L(),mask=localSelection(layer),source=applySelectionToCanvas(copyCanvas(layer.source),mask);if(!canAdd(source)||cut&&!requireRaster(layer))return;
        checkpoint();const copy={...layer,id:crypto.randomUUID(),name:layer.name+' — seleção',isBase:false,source,mask:copyCanvas(layer.mask),adjust:{...layer.adjust,curve:[...layer.adjust.curve]},vector:null,cache:null,thumb:host.thumbnail(source)};
        if(cut){layer.source=copyCanvas(layer.source);const ctx=layer.source.getContext('2d');ctx.globalCompositeOperation='destination-out';ctx.drawImage(mask,0,0);ctx.globalCompositeOperation='source-over';layer.vector=null;layer.cache=null}
        S().layers.push(copy);S().selected=copy.id;S().selection=null;changed(true);message('Seleção em uma camada independente. Use Mover para posicioná-la.');
    }
    function eraseSelection(){if(!S().selection){message('Crie uma seleção antes de apagar pixels.',true);return}const layer=L();if(!requireRaster(layer))return;checkpoint();layer.source=copyCanvas(layer.source);const ctx=layer.source.getContext('2d');ctx.globalCompositeOperation='destination-out';ctx.drawImage(localSelection(layer),0,0);ctx.globalCompositeOperation='source-over';layer.vector=null;touch(layer)}

    function forward(layer,p){const x=(p.x/layer.source.width*layer.w-layer.w/2)*(layer.flipX?-1:1),y=(p.y/layer.source.height*layer.h-layer.h/2)*(layer.flipY?-1:1),a=layer.angle*Math.PI/180;return{x:layer.x+layer.w/2+x*Math.cos(a)-y*Math.sin(a),y:layer.y+layer.h/2+x*Math.sin(a)+y*Math.cos(a)}}
    function hitLayer(p,type){return [...S().layers].reverse().find(layer=>{if(!layer.visible||type&&layer.vector?.type!==type)return false;const q=host.toLayerPoint(layer,p);return q.x>=0&&q.y>=0&&q.x<=layer.source.width&&q.y<=layer.source.height})}
    function hitAddedLayer(p){return [...S().layers].reverse().find(layer=>{if(layer.isBase||!layer.visible||layer.locked)return false;const q=host.toLayerPoint(layer,p);return q.x>=0&&q.y>=0&&q.x<=layer.source.width&&q.y<=layer.source.height})}
    function ensureQuad(){if(!quad)quad=[{x:0,y:0},{x:S().width,y:0},{x:S().width,y:S().height},{x:0,y:S().height}]}

    // Vector descriptions stay separate from their raster previews, making text/style/points editable.
    function tracePath(ctx,nodes,closed){if(!nodes.length)return;ctx.moveTo(nodes[0].x,nodes[0].y);const segment=(a,b)=>ctx.bezierCurveTo(a.out?.x??a.x,a.out?.y??a.y,b.in?.x??b.x,b.in?.y??b.y,b.x,b.y);for(let i=1;i<nodes.length;i++)segment(nodes[i-1],nodes[i]);if(closed&&nodes.length>2){segment(nodes.at(-1),nodes[0]);ctx.closePath()}}
    function vectorCanvas(v,w,h){
        const c=makeCanvas(w,h),ctx=c.getContext('2d');
        if(v.type==='text'){
            ctx.font=`${v.italic?'italic ':''}${v.bold?'bold ':''}${v.size}px "${v.font}"`;ctx.fillStyle=v.color;ctx.textBaseline='top';const leading=v.size*1.25,pad=4;
            if(v.vertical){let x=pad,y=pad;for(const char of [...v.text]){if(char==='\n'||y+leading>h){x+=leading;y=pad;if(char==='\n')continue}ctx.fillText(char,x,y);y+=leading}}
            else{ctx.textAlign=v.align;const x=v.align==='center'?w/2:v.align==='right'?w-pad:pad;let y=pad;for(const paragraph of v.text.split('\n')){let line='';for(const char of [...paragraph]){if(line&&ctx.measureText(line+char).width>w-pad*2){ctx.fillText(line,x,y);y+=leading;line=''}line+=char}ctx.fillText(line,x,y);y+=leading}}
        }else{
            ctx.scale(w/(v.viewW||w),h/(v.viewH||h));ctx.fillStyle=v.fill;ctx.strokeStyle=v.stroke;ctx.lineWidth=v.lineWidth;ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();const vw=v.viewW||w,vh=v.viewH||h,pad=Math.min(v.lineWidth/2+1,vw/3,vh/3);
            if(v.type==='path')tracePath(ctx,v.nodes,v.closed);
            else if(v.shape==='rectangle')ctx.rect(pad,pad,Math.max(1,vw-pad*2),Math.max(1,vh-pad*2));
            else if(v.shape==='ellipse')ctx.ellipse(vw/2,vh/2,Math.max(.5,vw/2-pad),Math.max(.5,vh/2-pad),0,0,Math.PI*2);
            else{for(let i=0;i<v.sides;i++){const a=-Math.PI/2+i*Math.PI*2/v.sides,x=vw/2+(vw/2-pad)*Math.cos(a),y=vh/2+(vh/2-pad)*Math.sin(a);i?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.closePath()}
            if(v.filled)ctx.fill();if(v.lineWidth>0)ctx.stroke();
        }return c;
    }
    function textSpec(vertical=M()==='text-vertical'){return{type:'text',text:textValue,font:fontFamily,size:fontSize,color:textColor,bold:textBold,italic:textItalic,align:textAlign,vertical}}
    function newText(rect){const v=textSpec(),source=vectorCanvas(v,rect.w,rect.h);addLayer(source,'Texto: '+textValue.slice(0,30),{x:rect.x,y:rect.y,vector:v});renderControls()}
    function applyText(){const layer=L();if(layer.vector?.type!=='text'){newText({x:S().width*.1,y:S().height*.1,w:Math.max(20,S().width*.8),h:Math.max(20,Math.min(S().height*.5,fontSize*4))});return}checkpoint();layer.vector=textSpec(layer.vector.vertical);layer.source=vectorCanvas(layer.vector,layer.source.width,layer.source.height);layer.name='Texto: '+textValue.slice(0,30);touch(layer);renderLayerList()}
    function updateLiveText(){const layer=L();if(layer.vector?.type!=='text')return;if(!textEditActive){checkpoint();textEditActive=true}layer.vector=textSpec(layer.vector.vertical);layer.source=vectorCanvas(layer.vector,layer.source.width,layer.source.height);layer.name='Texto: '+textValue.slice(0,30);touch(layer)}
    function createShape(rect,shape){const v={type:'shape',shape,fill:color,stroke:shapeStroke,filled:shapeFill,lineWidth,sides,viewW:rect.w,viewH:rect.h};addLayer(vectorCanvas(v,rect.w,rect.h),`Forma: ${shape}`,{x:rect.x,y:rect.y,vector:v})}
    function finishVectorPath(){
        if(path.length<2){message('Marque pelo menos dois pontos.',true);return}const coords=path.flatMap(n=>[n,n.in,n.out].filter(Boolean)),padding=Math.max(2,lineWidth),x=Math.min(...coords.map(p=>p.x))-padding,y=Math.min(...coords.map(p=>p.y))-padding,w=Math.max(2,Math.max(...coords.map(p=>p.x))-x+padding),h=Math.max(2,Math.max(...coords.map(p=>p.y))-y+padding);
        const local=p=>p?{x:p.x-x,y:p.y-y}:undefined,v={type:'path',nodes:path.map(n=>({...local(n),in:local(n.in),out:local(n.out)})),closed:pathClosed,fill:color,stroke:shapeStroke,filled:shapeFill&&pathClosed,lineWidth,viewW:w,viewH:h},source=vectorCanvas(v,w,h);
        if(pathEditId){const layer=S().layers.find(l=>l.id===pathEditId);if(layer){checkpoint();Object.assign(layer,host.newLayer(source,layer.name),{id:pathEditId,x,y,vector:v});S().selected=layer.id;changed(true)}}else addLayer(source,'Caminho vetorial',{x,y,vector:v});
        path=[];pathEditId=null;pathHover=null;drawOverlay();
    }
    function editPath(){const layer=L();if(layer.vector?.type!=='path'){message('Selecione uma camada criada pela Caneta.',true);return}path=layer.vector.nodes.map(n=>({...forward(layer,n),in:n.in?forward(layer,n.in):undefined,out:n.out?forward(layer,n.out):undefined}));pathEditId=layer.id;const v=layer.vector;color=v.fill;shapeStroke=v.stroke;shapeFill=v.filled;lineWidth=v.lineWidth;pathClosed=v.closed;renderControls();drawOverlay()}

    function command(cmd){
        const known=['select-all','deselect','invert-selection','selection-layer','cut-selection-layer','selection-mask','delete-selection','guide-vertical','guide-horizontal','clear-guides','apply-perspective','reset-perspective','export-slices','blank-layer','apply-text','new-text','apply-shape','finish-path','cancel-path','new-path','edit-path','path-selection','select-subject','zoom-in','zoom-out','zoom-fit','zoom-actual'];
        if(!known.includes(cmd))return false;if(host.busy)return true;
        if(cmd==='select-all'){const c=makeCanvas(S().width,S().height);c.getContext('2d').fillRect(0,0,c.width,c.height);setSelection(c,'replace')}
        if(cmd==='deselect'){checkpoint();S().selection=null;changed();drawOverlay()}
        if(cmd==='invert-selection'){const a=alphaOf(S().selection)||new Uint8Array(S().width*S().height);setSelection(maskCanvas(a.map(v=>255-v)),'replace')}
        if(cmd==='selection-layer')selectionLayer();if(cmd==='cut-selection-layer')selectionLayer(true);if(cmd==='delete-selection')eraseSelection();
        if(cmd==='selection-mask'){if(!S().selection)message('Crie uma seleção primeiro.',true);else{checkpoint();L().mask=localSelection(L());changed();message('Seleção aplicada como máscara da camada.')}}
        if(cmd.startsWith('guide-')){checkpoint();S().guides=[...(S().guides||[]),{id:crypto.randomUUID(),axis:cmd==='guide-vertical'?'x':'y',value:Math.round((cmd==='guide-vertical'?S().width:S().height)/2)}];moveTarget='guides';changed(true)}
        if(cmd==='clear-guides'){checkpoint();S().guides=[];changed()}
        if(cmd==='reset-perspective'){quad=null;ensureQuad();drawOverlay()}
        if(cmd==='apply-perspective')applyPerspective();if(cmd==='export-slices')exportSlices();
        if(cmd==='blank-layer')addLayer(makeCanvas(S().width,S().height),'Camada transparente');
        if(cmd==='apply-text')applyText();if(cmd==='new-text'){newText({x:S().width*.1,y:S().height*.1,w:S().width*.7,h:Math.min(S().height*.6,fontSize*4)});message('Nova caixa criada. Edite o texto e clique em Aplicar texto.')}
        if(cmd==='apply-shape'){const layer=L();if(layer.vector?.type!=='shape')message('Selecione uma camada de forma.',true);else{checkpoint();layer.vector={...layer.vector,fill:color,stroke:shapeStroke,filled:shapeFill,lineWidth,sides};layer.source=vectorCanvas(layer.vector,layer.source.width,layer.source.height);touch(layer);renderLayerList()}}
        if(cmd==='finish-path'){if(M()==='pen')finishVectorPath();else finishSelectionPath()}
        if(cmd==='cancel-path'||cmd==='new-path'){path=[];pathEditId=null;pathHover=null;drawOverlay()}
        if(cmd==='edit-path')editPath();if(cmd==='path-selection'){if(path.length>2){const c=makeCanvas(S().width,S().height),ctx=c.getContext('2d');ctx.beginPath();tracePath(ctx,path,true);ctx.fill();setSelection(c)}else message('Crie ou abra um caminho com pelo menos três pontos.',true)}
        if(cmd==='select-subject')selectObject({x:0,y:0,w:S().width,h:S().height},selectionOp);
        if(cmd==='zoom-in')zoom(1.25);if(cmd==='zoom-out')zoom(.8);if(cmd==='zoom-fit')setZoom(1);if(cmd==='zoom-actual'){const fit=Math.min(1,Math.max(100,viewport.clientWidth-44)/S().width);setZoom(1/fit)}
        return true;
    }

    // Remaining interaction hooks are defined below; initialization happens only after all closures exist.
    function stateChanged(){
        const dimensions=`${S().width}x${S().height}`;
        if(S()!==lastState||dimensions!==lastDimensions){gesture=null;path=[];pathHover=null;pathEditId=null;quad=null;edgeData=null;selectionCache=null;lastState=S();lastDimensions=dimensions}
        if(S().selection&&(S().selection.width!==S().width||S().selection.height!==S().height))S().selection=null;
    }
    function switchMode(){gesture=null;path=[];pathHover=null;pathEditId=null;edgeData=null;overlay.style.cursor=M()==='hand'?'grab':M()==='move'?'move':M()==='zoom'?'zoom-in':'crosshair';if(M()==='perspective')ensureQuad()}

    function selectionOutline(){
        const sel=S().selection;if(!sel)return null;if(selectionCache?.source===sel)return selectionCache;
        const a=alphaOf(sel),w=sel.width,h=sel.height,c=makeCanvas(w,h),ctx=c.getContext('2d'),d=ctx.createImageData(w,h);let left=w,top=h,right=0,bottom=0;
        for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(a[i]<64)continue;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);if(!x||!y||x===w-1||y===h-1||a[i-1]<64||a[i+1]<64||a[i-w]<64||a[i+w]<64){const white=(x+y)%8<4;d.data[i*4]=white?255:20;d.data[i*4+1]=white?255:45;d.data[i*4+2]=white?255:70;d.data[i*4+3]=255}}
        ctx.putImageData(d,0,0);selectionCache={source:sel,outline:c,bounds:right>=left?{x:left,y:top,w:right-left+1,h:bottom-top+1}:null};return selectionCache;
    }
    function draw(ctx,scale){
        ctx.save();
        const selection=selectionOutline();if(selection){ctx.globalAlpha=.13;ctx.drawImage(selection.source,0,0);ctx.globalAlpha=1;ctx.drawImage(selection.outline,0,0)}
        ctx.lineWidth=scale;ctx.strokeStyle='#04a5de';ctx.setLineDash([6*scale,3*scale]);
        for(const guide of S().guides||[]){ctx.beginPath();ctx.moveTo(guide.axis==='x'?guide.value:0,guide.axis==='y'?guide.value:0);ctx.lineTo(guide.axis==='x'?guide.value:S().width,guide.axis==='y'?guide.value:S().height);ctx.stroke()}
        ctx.setLineDash([]);ctx.strokeStyle='#ff5a0a';ctx.lineWidth=2*scale;
        if(M()==='perspective'){ensureQuad();ctx.beginPath();quad.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.stroke();quad.forEach((p,i)=>{ctx.fillStyle='#fff';ctx.fillRect(p.x-6*scale,p.y-6*scale,12*scale,12*scale);ctx.strokeRect(p.x-6*scale,p.y-6*scale,12*scale,12*scale);ctx.font=`${14*scale}px Arial`;ctx.fillStyle='#9a3200';ctx.fillText(String(i+1),p.x+9*scale,p.y+17*scale)})}
        if(M()==='slice'){ctx.strokeStyle='#1583af';ctx.setLineDash([6*scale,3*scale]);for(const r of sliceRects(S().width,S().height,sliceColumns,sliceRows)){ctx.strokeRect(r.x,r.y,r.w,r.h);ctx.font=`${14*scale}px Arial`;ctx.fillStyle='#005d82';ctx.fillText(`${r.row}-${r.column}`,r.x+7*scale,r.y+20*scale)}ctx.setLineDash([])}
        if(gesture?.rect){const r=gesture.rect;ctx.setLineDash([6*scale,3*scale]);if(gesture.kind==='ellipse-select'){ctx.beginPath();ctx.ellipse(r.x+r.w/2,r.y+r.h/2,r.w/2,r.h/2,0,0,Math.PI*2);ctx.stroke()}else ctx.strokeRect(r.x,r.y,r.w,r.h);ctx.setLineDash([])}
        const nodes=gesture?.kind==='lasso'||gesture?.kind==='magnetic-lasso'?gesture.points:path;
        if(nodes.length){ctx.beginPath();if(M()==='pen')tracePath(ctx,nodes,false);else nodes.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));if(pathHover&&!gesture)ctx.lineTo(pathHover.x,pathHover.y);ctx.stroke();for(const n of nodes){if(M()==='pen')for(const p of [n.in,n.out].filter(Boolean)){ctx.strokeStyle='#237eb3';ctx.beginPath();ctx.moveTo(n.x,n.y);ctx.lineTo(p.x,p.y);ctx.stroke();ctx.fillStyle='#fff';ctx.fillRect(p.x-3*scale,p.y-3*scale,6*scale,6*scale);ctx.strokeRect(p.x-3*scale,p.y-3*scale,6*scale,6*scale)}ctx.fillStyle='#ff5a0a';ctx.fillRect(n.x-4*scale,n.y-4*scale,8*scale,8*scale)}}
        if(gesture?.kind==='gradient'){ctx.beginPath();ctx.moveTo(gesture.start.x,gesture.start.y);ctx.lineTo(gesture.lastDoc.x,gesture.lastDoc.y);ctx.stroke()}
        ctx.restore();
    }

    let pathOperation='replace';
    function finishSelectionPath(){if(path.length<3){message('Marque pelo menos três vértices.',true);return}setSelection(pathMask(path),pathOperation);path=[];pathHover=null;drawOverlay()}
    function colorSelection(p,g){
        const samples=M()==='quick-select'?[p,{x:p.x-paintSize/3,y:p.y},{x:p.x+paintSize/3,y:p.y},{x:p.x,y:p.y-paintSize/3},{x:p.x,y:p.y+paintSize/3}]:[p];
        for(const seed of samples){const x=clamp(Math.floor(seed.x),0,S().width-1),y=clamp(Math.floor(seed.y),0,S().height-1);if(g.region[y*S().width+x])continue;const region=colorRegion(g.pixels,S().width,S().height,x,y,tolerance,contiguous);g.region=combineMasks(g.region,region,'add')}const base=g.baseSelection;
        S().selection=maskCanvas(combineMasks(base,g.region,g.operation));selectionCache=null;changed();drawOverlay();
    }
    function pointerDown(e,p){
        if(host.busy)return true;
        if(spaceHeld||M()==='hand'){gesture={kind:'pan',client:{x:e.clientX,y:e.clientY},scroll:{x:viewport.scrollLeft,y:viewport.scrollTop}};overlay.style.cursor='grabbing';return true}
        if(M()==='zoom'){zoom(e.altKey ? 0.8 : 1.25,p);return true}
        if(M()==='move'&&moveTarget==='guides'){const hit=(S().guides||[]).find(g=>Math.abs(p[g.axis]-g.value)<10*host.screenScale());if(hit){checkpoint();gesture={kind:'guide',id:hit.id}}return true}
        if(M()==='move'&&moveTarget==='selection'){if(!S().selection){message('Crie uma seleção primeiro.',true);return true}checkpoint();gesture={kind:'move-selection',start:p,original:S().selection};return true}
        if(M()==='perspective'){ensureQuad();const i=quad.findIndex(q=>Math.hypot(q.x-p.x,q.y-p.y)<16*host.screenScale());if(i>=0)gesture={kind:'quad',index:i};return true}
        if(['marquee','ellipse-select','object-select',...SHAPE_MODES].includes(M())){gesture={kind:M(),start:p,rect:{x:p.x,y:p.y,w:0,h:0},operation:selectionOperation(e)};return true}
        if(M()==='text'||M()==='text-vertical'){const hit=hitLayer(p,'text');if(hit&&!e.shiftKey){host.selectLayer(hit.id);return true}gesture={kind:'text-box',start:p,rect:{x:p.x,y:p.y,w:0,h:0}};return true}
        if(M()==='polygon-lasso'){if(!path.length)pathOperation=selectionOperation(e);if(path.length>2&&Math.hypot(p.x-path[0].x,p.y-path[0].y)<8*host.screenScale()){finishSelectionPath();return true}path.push(p);drawOverlay();return true}
        if(M()==='lasso'||M()==='magnetic-lasso'){if(M()==='magnetic-lasso')edgeData=edgeMap(canvas.getContext('2d').getImageData(0,0,S().width,S().height).data,S().width,S().height);gesture={kind:M(),points:[p],operation:selectionOperation(e)};return true}
        if(M()==='wand'||M()==='quick-select'){checkpoint();gesture={kind:'color-selection',pixels:canvas.getContext('2d').getImageData(0,0,S().width,S().height).data,baseSelection:alphaOf(S().selection),region:new Uint8Array(S().width*S().height),operation:selectionOperation(e),last:p};colorSelection(p,gesture);return true}
        if(M()==='pen'){
            if(pathEditId){let found=null;path.forEach((n,i)=>{for(const key of ['in','out','node']){const q=key==='node'?n:n[key];if(q&&Math.hypot(q.x-p.x,q.y-p.y)<10*host.screenScale())found={i,key}}});if(found)gesture={kind:'edit-node',...found,start:p,original:structuredClone(path[found.i])};return true}
            path.push({...p});gesture={kind:'pen-node',index:path.length-1,start:p};drawOverlay();return true;
        }
        if(PAINT_MODES.includes(M())){
            let layer=L(),created=false;
            if(M()==='eraser'&&layer.isBase){layer=hitAddedLayer(p);if(!layer){message('A borracha protege a imagem original. Selecione ou adicione um elemento para apagá-lo.',true);return true}host.selectLayer(layer.id)}
            if((M()==='brush'||M()==='pencil')&&layer.isBase){layer=addLayer(makeCanvas(S().width,S().height),M()==='brush'?'Traços de pincel':'Traços de lápis',{isBase:false});if(!layer)return true;created=true}
            if(!requireRaster(layer))return true;if(!created)checkpoint();layer.vector=null;const lp=host.toLayerPoint(layer,p),original=layer.source;gesture={kind:'paint',tool:M(),layer,original,working:copyCanvas(original),mask:localSelection(layer),last:lp};paintTo(lp);return true
        }
        if(M()==='bucket'){fillRegion(p);return true}
        if(M()==='gradient'){if(!requireRaster(L()))return true;gesture={kind:'gradient',start:p,lastDoc:p};return true}
        if(M()==='slice')return true;
        return false;
    }
    function pointerMove(e,p){
        if(!gesture){if(path.length){pathHover=p;drawOverlay();return true}return false}
        const g=gesture;
        if(g.kind==='pan'){viewport.scrollLeft=g.scroll.x-(e.clientX-g.client.x);viewport.scrollTop=g.scroll.y-(e.clientY-g.client.y);return true}
        if(g.kind==='guide'){S().guides=S().guides.map(guide=>guide.id===g.id?{...guide,value:p[guide.axis]}:guide);changed();drawOverlay();return true}
        if(g.kind==='move-selection'){const c=makeCanvas(S().width,S().height);c.getContext('2d').drawImage(g.original,Math.round(p.x-g.start.x),Math.round(p.y-g.start.y));S().selection=c;selectionCache=null;changed();drawOverlay();return true}
        if(g.kind==='quad'){quad=quad.map((q,i)=>i===g.index?p:q);drawOverlay();return true}
        if(g.rect){g.rect=rectangular(g.start,p,e.shiftKey&&g.kind!=='object-select');drawOverlay();return true}
        if(g.kind==='lasso'||g.kind==='magnetic-lasso'){const q=g.kind==='magnetic-lasso'?snapToEdge(edgeData,S().width,S().height,p,12*host.screenScale()):p;if(Math.hypot(q.x-g.points.at(-1).x,q.y-g.points.at(-1).y)>1){g.points.push(q);drawOverlay()}return true}
        if(g.kind==='color-selection'){if(M()==='quick-select'&&Math.hypot(p.x-g.last.x,p.y-g.last.y)>Math.max(3,paintSize/4)){colorSelection(p,g);g.last=p}return true}
        if(g.kind==='pen-node'){const node=path[g.index],dx=p.x-g.start.x,dy=p.y-g.start.y;if(Math.hypot(dx,dy)>2){node.out={x:node.x+dx,y:node.y+dy};node.in={x:node.x-dx,y:node.y-dy}}drawOverlay();return true}
        if(g.kind==='edit-node'){const n=path[g.i];if(g.key==='node'){const dx=p.x-g.start.x,dy=p.y-g.start.y;Object.assign(n,{x:g.original.x+dx,y:g.original.y+dy});for(const key of ['in','out'])if(g.original[key])n[key]={x:g.original[key].x+dx,y:g.original[key].y+dy}}else{n[g.key]=p;if(!e.altKey)n[g.key==='in'?'out':'in']={x:2*n.x-p.x,y:2*n.y-p.y}}drawOverlay();return true}
        if(g.kind==='paint'){paintTo(host.toLayerPoint(g.layer,p));return true}
        if(g.kind==='gradient'){g.lastDoc=p;drawOverlay();return true}
        return true;
    }
    async function pointerUp(){
        if(!gesture)return false;const g=gesture;gesture=null;
        if(g.kind==='pan')overlay.style.cursor=M()==='hand'?'grab':'crosshair';
        if(g.kind==='marquee'&&g.rect.w>=1&&g.rect.h>=1)setSelection(pathMask(corners(g.rect)),g.operation);
        if(g.kind==='ellipse-select'&&g.rect.w>=1&&g.rect.h>=1)setSelection(pathMask([corners(g.rect)[0],corners(g.rect)[2]],true),g.operation);
        if(g.kind==='object-select'&&g.rect.w>=4&&g.rect.h>=4)await selectObject(g.rect,g.operation);
        if((g.kind==='lasso'||g.kind==='magnetic-lasso')&&g.points.length>=3)setSelection(pathMask(g.points),g.operation);
        if(SHAPE_MODES.includes(g.kind)&&g.rect.w>=2&&g.rect.h>=2)createShape(g.rect,g.kind);
        if(g.kind==='text-box'){if(g.rect.w<10||g.rect.h<10)g.rect={x:g.start.x,y:g.start.y,w:Math.min(300,S().width-g.start.x),h:Math.min(150,S().height-g.start.y)};if(g.rect.w>=10&&g.rect.h>=10)newText(g.rect)}
        if(g.kind==='gradient')applyGradient(g.start,g.lastDoc);
        if(g.kind==='paint'){g.layer.thumb=host.thumbnail(g.layer.source);changed();renderLayerList()}drawOverlay();return true;
    }
    function cancelPointer(){if(!gesture)return false;const g=gesture;gesture=null;if(g.kind==='paint'){g.layer.source=g.original;touch(g.layer)}drawOverlay();return true}

    function brushStamp(size,tool){
        const c=makeCanvas(size,size),ctx=c.getContext('2d'),r=size/2,stampColor=tool==='eraser'?'#ffffff':color;ctx.globalAlpha=opacity/100;
        if(texture==='square'){ctx.fillStyle=stampColor;ctx.fillRect(0,0,size,size)}
        else if(texture==='rectangle'){ctx.fillStyle=stampColor;ctx.fillRect(0,size*.25,size,size*.5)}
        else if(texture==='letter'){ctx.fillStyle=stampColor;ctx.font=`900 ${Math.max(6,size*.82)}px Arial, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(brushText||'A',r,r,size)}
        else if(texture==='round'){if(tool==='pencil'){ctx.fillStyle=stampColor;ctx.beginPath();ctx.arc(r,r,r,0,Math.PI*2);ctx.fill()}else{const gradient=ctx.createRadialGradient(r,r,Math.max(0,r*hardness/100-.01),r,r,r);gradient.addColorStop(0,stampColor);gradient.addColorStop(1,stampColor+'00');ctx.fillStyle=gradient;ctx.fillRect(0,0,size,size)}}
        else{ctx.fillStyle=stampColor;let seed=173;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};for(let i=0;i<(texture==='chalk'?size*5:size*2);i++){const a=random()*Math.PI*2,d=Math.sqrt(random())*r,x=r+Math.cos(a)*d,y=r+Math.sin(a)*d;ctx.globalAlpha=opacity/100*(texture==='chalk'?.45:.3);ctx.fillRect(x,y,texture==='chalk'?2:1,texture==='chalk'?2:1)}}return c;
    }
    function paintTo(p){
        const g=gesture,layer=g.layer,size=paintSize,r=size/2,ctx=g.working.getContext('2d'),distance=Math.hypot(p.x-g.last.x,p.y-g.last.y),steps=Math.max(1,Math.ceil(distance/Math.max(1,size/5))),stamp=brushStamp(size,g.tool);let previous=g.last;
        for(let i=0;i<=steps;i++){const t=i/steps,x=g.last.x+(p.x-g.last.x)*t,y=g.last.y+(p.y-g.last.y)*t;
            if(g.tool==='blur'||g.tool==='sharpen'){const rawLeft=Math.floor(x-r),rawTop=Math.floor(y-r),left=Math.max(0,rawLeft),top=Math.max(0,rawTop),right=Math.min(g.working.width,Math.ceil(x+r)),bottom=Math.min(g.working.height,Math.ceil(y+r)),pieceWidth=right-left,pieceHeight=bottom-top;if(pieceWidth>0&&pieceHeight>0){const data=ctx.getImageData(left,top,pieceWidth,pieceHeight),filtered=localFilter(data.data,data.width,data.height,g.tool),piece=makeCanvas(data.width,data.height),pc=piece.getContext('2d');pc.putImageData(new ImageData(filtered,data.width,data.height),0,0);pc.globalCompositeOperation='destination-in';pc.drawImage(stamp,left-rawLeft,top-rawTop,pieceWidth,pieceHeight,0,0,pieceWidth,pieceHeight);ctx.drawImage(piece,left,top)}}
            else if(g.tool==='smudge'){const piece=makeCanvas(size,size),pc=piece.getContext('2d');pc.drawImage(g.working,previous.x-r,previous.y-r,size,size,0,0,size,size);pc.globalCompositeOperation='destination-in';pc.drawImage(stamp,0,0);ctx.drawImage(piece,x-r,y-r)}
            else{ctx.save();ctx.globalCompositeOperation=g.tool==='eraser'?'destination-out':'source-over';ctx.drawImage(stamp,x-r,y-r);ctx.restore()}previous={x,y};
        }
        layer.source=preserveOutside(g.working,g.original,g.mask,g.buffers??={});g.last=p;layer.pixelVersion=(layer.pixelVersion||0)+1;layer.cache=null;host.previewRasterLayer(layer,layer.source);drawOverlay();
    }
    function fillRegion(p){
        const layer=L(),lp=host.toLayerPoint(layer,p),source=layer.source;if(lp.x<0||lp.y<0||lp.x>=source.width||lp.y>=source.height||!requireRaster(layer))return;const ctx=source.getContext('2d'),data=ctx.getImageData(0,0,source.width,source.height),localMask=localSelection(layer),alpha=colorRegion(data.data,source.width,source.height,lp.x,lp.y,tolerance,contiguous,alphaOf(localMask)),fill=makeCanvas(source.width,source.height),fc=fill.getContext('2d');fc.fillStyle=color;fc.globalAlpha=opacity/100;fc.fillRect(0,0,fill.width,fill.height);fc.globalAlpha=1;applySelectionToCanvas(fill,maskCanvas(alpha,fill.width,fill.height));applySelectionToCanvas(fill,localMask);
        checkpoint();layer.vector=null;layer.source=copyCanvas(source);layer.source.getContext('2d').drawImage(fill,0,0);touch(layer);
    }
    function applyGradient(start,end){
        const layer=L(),a=host.toLayerPoint(layer,start),b=host.toLayerPoint(layer,end);if(Math.hypot(a.x-b.x,a.y-b.y)<1)return;
        const fill=makeCanvas(layer.source.width,layer.source.height),ctx=fill.getContext('2d'),g=gradientType==='radial'?ctx.createRadialGradient(a.x,a.y,0,a.x,a.y,Math.hypot(b.x-a.x,b.y-a.y)):ctx.createLinearGradient(a.x,a.y,b.x,b.y);g.addColorStop(0,color);g.addColorStop(1,secondColor);ctx.fillStyle=g;ctx.globalAlpha=opacity/100;ctx.fillRect(0,0,fill.width,fill.height);applySelectionToCanvas(fill,localSelection(layer));checkpoint();layer.vector=null;layer.source=copyCanvas(layer.source);layer.source.getContext('2d').drawImage(fill,0,0);touch(layer);
    }

    async function applyPerspective(){
        ensureQuad();if(!validQuad(quad)){message('Os quatro cantos não podem se cruzar nem formar uma linha.',true);return}
        await activity('Corrigindo a perspectiva...',async()=>{await host.renderScene();const w=Math.max(1,Math.round(Math.max(Math.hypot(quad[1].x-quad[0].x,quad[1].y-quad[0].y),Math.hypot(quad[2].x-quad[3].x,quad[2].y-quad[3].y)))),h=Math.max(1,Math.round(Math.max(Math.hypot(quad[3].x-quad[0].x,quad[3].y-quad[0].y),Math.hypot(quad[2].x-quad[1].x,quad[2].y-quad[1].y))));
            if(w*h>16000000||w>6000||h>6000)throw new Error('A perspectiva excede o limite de tamanho do editor.');await new Promise(resolve=>requestAnimationFrame(resolve));const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height),pixels=warpPerspective(data.data,canvas.width,canvas.height,quad,w,h),source=makeCanvas(w,h);source.getContext('2d').putImageData(new ImageData(pixels,w,h),0,0);checkpoint();const layer=host.newLayer(source,'Imagem retificada');layer.isBase=true;host.state={width:w,height:h,layers:[layer],selected:layer.id};host.resetCrop();changed(true);message('Perspectiva aplicada. Desfazer recupera as camadas anteriores.')});
    }
    async function selectObject(rect,operation){
        await activity('Selecionando o objeto com IA local...',async()=>{await host.renderScene();const small=makeCanvas(320,320),ctx=small.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,320,320);ctx.drawImage(canvas,rect.x,rect.y,rect.w,rect.h,0,0,320,320);const {normalizeModelInput}=await import('./image-core.mjs'),input=normalizeModelInput(ctx.getImageData(0,0,320,320).data);
            if(!aiWorker)aiWorker=new Worker(new URL('./background-worker.js',import.meta.url));
            const alpha=await new Promise((resolve,reject)=>{const fail=error=>{clearTimeout(timer);aiWorker?.terminate();aiWorker=null;reject(error)},timer=setTimeout(()=>fail(new Error('A IA demorou demais. Tente delimitar uma área menor.')),120000);aiWorker.onmessage=({data})=>{clearTimeout(timer);if(data.error)fail(new Error(data.error));else resolve(data.mask)};aiWorker.onerror=()=>fail(new Error('Não foi possível carregar o modelo local de seleção.'));aiWorker.postMessage({input},[input.buffer])});
            if(!alpha.some(value=>value>=objectThreshold))throw new Error('Nenhum primeiro plano foi identificado. Delimite outra área ou diminua o limiar.');
            const binary=maskCanvas(alpha.map(v=>v>=objectThreshold?255:0),320,320),mask=makeCanvas(S().width,S().height);mask.getContext('2d').drawImage(binary,rect.x,rect.y,rect.w,rect.h);setSelection(mask,operation);message('Seleção automática pronta. Revise as bordas e refine com Shift/Alt nas ferramentas de seleção.')});
    }
    async function exportSlices(){
        await activity('Preparando as fatias...',async()=>{await host.renderScene();if(!window.JSZip)throw new Error('A biblioteca local de ZIP não carregou. Recarregue a página.');const zip=new window.JSZip();for(const r of sliceRects(S().width,S().height,sliceColumns,sliceRows)){const c=makeCanvas(r.w,r.h);c.getContext('2d').drawImage(canvas,r.x,r.y,r.w,r.h,0,0,r.w,r.h);const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));if(!blob)throw new Error('Não foi possível gerar uma das fatias.');zip.file(`${host.fileName}_${r.row}-${r.column}.png`,await blob.arrayBuffer())}
            const blob=await zip.generateAsync({type:'blob'});host.invalidateResult();host.outputUrl=URL.createObjectURL(blob);$('imageDownload').href=host.outputUrl;$('imageDownload').download=host.fileName+'_fatias.zip';$('imageResultPreview').src=canvas.toDataURL('image/png');$('imageResultInfo').textContent=`${sliceColumns*sliceRows} fatias PNG • ${(blob.size/1024).toFixed(1)} KB`;$('imageResult').hidden=false;$('imageResult').scrollIntoView({behavior:'smooth',block:'center'});message('Fatias prontas. Clique em Baixar imagem para baixar o ZIP.')});
    }

    function setZoom(value,p=null){const select=$('imageZoom'),previous=+select.value,next=clamp(value,.1,8);let option=[...select.options].find(o=>Math.abs(+o.value-next)<.001);if(!option){option=document.createElement('option');option.value=String(next);option.textContent=Math.round(next*100)+'% da visualização ajustada';select.append(option)}select.value=option.value;const left=viewport.scrollLeft,top=viewport.scrollTop;host.refreshView();if(p){const factor=next/previous;viewport.scrollLeft=(left+viewport.clientWidth/2)*factor-viewport.clientWidth/2;viewport.scrollTop=(top+viewport.clientHeight/2)*factor-viewport.clientHeight/2}}
    function zoom(factor,p=null){setZoom(Number($('imageZoom').value)*factor,p)}

    function changeOrder(sourceId,targetId,before){
        const next=reorderLayers(S().layers,sourceId,targetId,before);if(next===S().layers||next.every((l,i)=>l===S().layers[i]))return;
        checkpoint();S().layers=next;S().selected=sourceId;changed(true);message('Ordem das camadas alterada. Desfazer restaura a ordem anterior.');
    }
    function clearDropMarkers(){$('imageLayerList').querySelectorAll('.image-layer-row').forEach(row=>row.classList.remove('drop-before','drop-after','layer-dragging'))}
    function wireLayers(){
        $('imageLayerList').querySelectorAll('.image-layer-row').forEach(row=>{
            const selectButton=row.querySelector('[data-select-layer]'),id=selectButton.dataset.selectLayer;row.dataset.layerId=id;row.draggable=true;row.title='Arraste para mudar a ordem. Alt+↑ / Alt+↓ move a camada selecionada.';row.querySelector('img').draggable=false;
            const grip=document.createElement('span');grip.className='image-layer-grip';grip.textContent='⠿';grip.setAttribute('aria-hidden','true');row.prepend(grip);
            row.ondragstart=e=>{if(host.busy){e.preventDefault();return}layerDrag=id;row.classList.add('layer-dragging');if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',id)}};
            row.ondragover=e=>{if(!layerDrag||host.busy)return;e.preventDefault();clearDropMarkers();row.classList.add(e.clientY<row.getBoundingClientRect().top+row.getBoundingClientRect().height/2?'drop-before':'drop-after');if(e.dataTransfer)e.dataTransfer.dropEffect='move'};
            row.ondrop=e=>{if(!layerDrag||host.busy)return;e.preventDefault();e.stopPropagation();const sourceId=layerDrag;layerDrag=null;const rect=row.getBoundingClientRect();changeOrder(sourceId,id,e.clientY<rect.top+rect.height/2);clearDropMarkers()};
            row.ondragend=()=>{layerDrag=null;clearDropMarkers()};
            grip.onpointerdown=e=>{if(e.pointerType==='mouse'||host.busy)return;e.preventDefault();e.stopPropagation();grip.setPointerCapture(e.pointerId);touchSort={sourceId:id,targetId:id,before:true};row.classList.add('layer-dragging')};
            grip.onpointermove=e=>{if(!touchSort)return;e.preventDefault();const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-layer-id]');if(!target)return;const rect=target.getBoundingClientRect();touchSort.targetId=target.dataset.layerId;touchSort.before=e.clientY<rect.top+rect.height/2;clearDropMarkers();target.classList.add(touchSort.before?'drop-before':'drop-after')};
            grip.onpointerup=()=>{if(touchSort){const sort=touchSort;touchSort=null;changeOrder(sort.sourceId,sort.targetId,sort.before);clearDropMarkers()}};grip.onpointercancel=()=>{touchSort=null;clearDropMarkers()};
        });
    }
    const SHORTCUT_STORAGE='tacano-image-shortcuts-v1';let customShortcuts={},capturingShortcut=null;
    try{customShortcuts=JSON.parse(globalThis.localStorage?.getItem(SHORTCUT_STORAGE)||'{}')||{}}catch{customShortcuts={}}
    const FIXED_KEYS={imageUndo:{id:'fixed:undo',key:'Ctrl+Z'},imageRedo:{id:'fixed:redo',key:'Ctrl+Shift+Z'},imageReplace:{id:'fixed:open',key:'Ctrl+O'},imageFinalize:{id:'fixed:export',key:'Ctrl+Enter'},imageContinue:{id:'fixed:continue',key:'Ctrl+Alt+E'},imageDownload:{id:'fixed:download',key:'Ctrl+Shift+S'},imageShortcutsButton:{id:'fixed:shortcuts',key:'?'}};
    const EXTRA_KEYS=[
        {id:'fixed:redo-alt',label:'Refazer (alternativa)',key:'Ctrl+Y'},
        {id:'fixed:export-alt',label:'Exportar / salvar (alternativa)',key:'Ctrl+S'},
        {id:'action:select-all',label:'Selecionar tudo',key:'Ctrl+A'},
        {id:'action:deselect',label:'Desmarcar seleção',key:'Ctrl+D'},
        {id:'action:invert-selection',label:'Inverter seleção',key:'Ctrl+Shift+I'},
        {id:'action:duplicate',label:'Duplicar camada / copiar seleção',key:'Ctrl+J'},
        {id:'action:layer-up',label:'Subir camada',key:'Alt+ArrowUp'},
        {id:'action:layer-down',label:'Descer camada',key:'Alt+ArrowDown'},
        {id:'action:zoom-fit',label:'Ajustar à tela',key:'Ctrl+0'},
        {id:'action:zoom-in',label:'Ampliar',key:'+'},
        {id:'action:zoom-out',label:'Reduzir',key:'-'},
        {id:'action:delete',label:'Excluir seleção ou camada',key:'Delete'},
        {id:'action:delete-alt',label:'Excluir seleção ou camada (alternativa)',key:'Backspace'},
        {id:'action:finish',label:'Concluir caminho / seleção',key:'Enter'},
        {id:'action:brush-smaller',label:'Diminuir pincel',key:'['},
        {id:'action:brush-larger',label:'Aumentar pincel',key:']'},
    ];
    const shortcutValue=(id,fallback)=>customShortcuts[id]||fallback;
    function shortcutDefinitions(){
        const fixed=Object.entries(FIXED_KEYS).filter(([elementId])=>$(elementId)).map(([elementId,definition])=>({...definition,label:$(elementId).dataset.label||$(elementId).textContent.trim(),elementId}));
        const modeDefs=host.modes.map(el=>({id:'mode:'+el.dataset.imageMode,label:el.dataset.label,key:MODE_KEYS[el.dataset.imageMode],mode:el.dataset.imageMode})).filter(item=>item.key);
        const panel=[...host.controlsElement.querySelectorAll('[data-command]:not([hidden])')].map((el,i)=>({id:'panel:'+el.dataset.command,label:el.dataset.label||el.textContent.trim(),key:'Alt+'+((i+1)%10),command:el.dataset.command}));
        return[...fixed,...EXTRA_KEYS,...modeDefs,...panel];
    }
    function labelButton(el,shortcut){if(!el)return;if(!el.dataset.label)el.dataset.label=el.textContent.trim();const isTool=el.hasAttribute('data-image-mode');if(isTool)el.removeAttribute('title');if(!shortcut){delete el.dataset.shortcut;if(!isTool)el.title=el.dataset.label;el.removeAttribute('aria-keyshortcuts');el.querySelector('.image-key')?.remove();return}el.dataset.shortcut=shortcut;if(!isTool)el.title=el.dataset.label+' — '+shortcut;el.setAttribute('aria-keyshortcuts',String(shortcut).replaceAll('Ctrl','Control').replace('Esc','Escape'));let hint=el.querySelector('.image-key');if(!hint){hint=document.createElement('kbd');hint.className='image-key';el.append(hint)}hint.textContent=shortcut}
    function decorateButtons(){
        host.modes.forEach(el=>labelButton(el,shortcutValue('mode:'+el.dataset.imageMode,MODE_KEYS[el.dataset.imageMode])));
        for(const[elementId,definition]of Object.entries(FIXED_KEYS))labelButton($(elementId),shortcutValue(definition.id,definition.key));
        [...host.controlsElement.querySelectorAll('[data-command]:not([hidden])')].forEach((el,i)=>labelButton(el,shortcutValue('panel:'+el.dataset.command,'Alt+'+((i+1)%10))));
        [...$('imageLayerList').querySelectorAll('[data-select-layer]')].forEach((el,i)=>{el.dataset.shortcut='Ctrl+Alt+'+(i+1);el.title='Selecionar camada — Ctrl+Alt+'+(i+1);el.setAttribute('aria-keyshortcuts','Control+Alt+'+(i+1))});
    }
    function saveShortcuts(){try{globalThis.localStorage?.setItem(SHORTCUT_STORAGE,JSON.stringify(customShortcuts))}catch{message('O navegador não permitiu salvar os atalhos personalizados.',true)}}
    function chordFromEvent(e){if(['Control','Shift','Alt','Meta'].includes(e.key))return null;let key=e.key===' '?'Space':e.key.length===1?e.key.toUpperCase():e.key;const parts=[];if(e.ctrlKey||e.metaKey)parts.push('Ctrl');if(e.altKey)parts.push('Alt');if(e.shiftKey&&!['+','?','_'].includes(key))parts.push('Shift');parts.push(key);return parts.join('+')}
    function assignShortcut(id,newKey){const definitions=shortcutDefinitions(),target=definitions.find(item=>item.id===id);if(!target)return;const oldKey=shortcutValue(target.id,target.key),conflict=definitions.find(item=>item.id!==id&&shortcutValue(item.id,item.key)===newKey);customShortcuts[id]=newKey;if(conflict)customShortcuts[conflict.id]=oldKey;saveShortcuts();capturingShortcut=null;decorateButtons();showShortcuts();message(conflict?`Atalhos trocados: ${target.label} agora usa ${newKey}.`:`Novo atalho salvo para ${target.label}: ${newKey}.`)}
    function showShortcuts(){
        decorateButtons();const definitions=shortcutDefinitions(),rows=definitions.map(item=>`<div class="shortcut-row" data-shortcut-id="${escape(item.id)}"><span>${escape(item.label)}</span><button type="button" class="shortcut-capture" title="Clique para alterar o atalho de ${escape(item.label)}"><kbd>${escape(shortcutValue(item.id,item.key))}</kbd></button></div>`).join('')+`<div class="shortcut-row shortcut-info"><span>Mover 1 px / 10 px</span><kbd>Setas / Shift+setas</kbd></div><div class="shortcut-row shortcut-info"><span>Mão temporária</span><kbd>Espaço</kbd></div><div class="shortcut-row shortcut-info"><span>Cancelar / fechar</span><kbd>Esc</kbd></div>`;
        $('imageShortcutList').innerHTML=rows;$('imageShortcutList').querySelectorAll('[data-shortcut-id] .shortcut-capture').forEach(button=>button.onclick=()=>{capturingShortcut=button.closest('[data-shortcut-id]').dataset.shortcutId;$('imageShortcutList').querySelectorAll('.shortcut-row').forEach(row=>row.classList.toggle('capturing',row.dataset.shortcutId===capturingShortcut));button.querySelector('kbd').textContent='Pressione o novo atalho…';button.focus()});const dialog=$('imageShortcuts');dialog.hidden=false;if(!dialog.hasAttribute('open')){if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','')}
    }
    function closeShortcuts(){capturingShortcut=null;const dialog=$('imageShortcuts');if(dialog.close)dialog.close();else dialog.removeAttribute('open');dialog.hidden=true}
    function nudge(key,amount){const dx=key==='ArrowLeft'?-amount:key==='ArrowRight'?amount:0,dy=key==='ArrowUp'?-amount:key==='ArrowDown'?amount:0;checkpoint();if(M()==='move'&&moveTarget==='selection'&&S().selection){const c=makeCanvas(S().width,S().height);c.getContext('2d').drawImage(S().selection,dx,dy);S().selection=c;selectionCache=null}else{L().x+=dx;L().y+=dy}changed();drawOverlay()}
    function executeShortcut(definition){const id=definition.id;if(id.startsWith('mode:')){host.setMode(definition.mode);return true}if(id.startsWith('panel:')){host.controlsElement.querySelector(`[data-command="${definition.command}"]`)?.click();return true}if(id==='fixed:open'){S().layers.length?$('imageReplace').click():$('imageInput').click();return true}const buttonId=id==='fixed:undo'?'imageUndo':id==='fixed:redo'||id==='fixed:redo-alt'?'imageRedo':id==='fixed:export'||id==='fixed:export-alt'?'imageFinalize':id==='fixed:continue'?'imageContinue':id==='fixed:download'?'imageDownload':id==='fixed:shortcuts'?'imageShortcutsButton':null;if(buttonId){if(id==='fixed:download'&&($('imageResult').hidden||!$('imageDownload').hasAttribute('href')))message('Exporte a imagem antes de baixar.',true);else $(buttonId).click();return true}if(id==='action:select-all')command('select-all');if(id==='action:deselect')command('deselect');if(id==='action:invert-selection')command('invert-selection');if(id==='action:duplicate')S().selection?selectionLayer():host.dispatch('duplicate');if(id==='action:layer-up')host.dispatch('up');if(id==='action:layer-down')host.dispatch('down');if(id==='action:zoom-fit')setZoom(1);if(id==='action:zoom-in')zoom(1.25);if(id==='action:zoom-out')zoom(.8);if(id==='action:delete'||id==='action:delete-alt')S().selection?eraseSelection():host.dispatch('delete');if(id==='action:finish'&&path.length)(M()==='pen'?finishVectorPath():finishSelectionPath());if(id==='action:brush-smaller'||id==='action:brush-larger'){paintSize=clamp(paintSize+(id.endsWith('larger')?5:-5),1,250);host.setBrushSize(paintSize)}return true}
    function keyDown(e){
        const key=e.key,ctrl=e.ctrlKey||e.metaKey,editable=e.target?.isContentEditable||e.target?.closest?.('input,textarea,select,[contenteditable="true"]');
        if(capturingShortcut){e.preventDefault();e.stopPropagation();if(key==='Escape'){capturingShortcut=null;showShortcuts();return}const captured=chordFromEvent(e);if(captured)assignShortcut(capturingShortcut,captured);return}
        if(key==='Escape'&&$('imageShortcuts').hasAttribute('open')){e.preventDefault();closeShortcuts();return}
        if($('imageShortcuts').hasAttribute('open'))return;
        if(editable||e.isComposing||host.busy)return;
        const chord=chordFromEvent(e),definition=shortcutDefinitions().find(item=>shortcutValue(item.id,item.key)===chord);if(definition){if(!S().layers.length&&!['fixed:open','fixed:shortcuts'].includes(definition.id))return;e.preventDefault();executeShortcut(definition);return}
        if(!S().layers.length)return;
        if(ctrl&&e.altKey&&/^[1-8]$/.test(key)){e.preventDefault();$('imageLayerList').querySelectorAll('[data-select-layer]')[Number(key)-1]?.click();return}
        if(key===' '&&!ctrl&&!e.altKey){if(e.target?.closest?.('button,a'))return;e.preventDefault();spaceHeld=true;overlay.style.cursor='grab';return}
        if(key==='Escape'){e.preventDefault();cancelPointer();path=[];pathHover=null;pathEditId=null;drawOverlay();return}
        if(key.startsWith('Arrow')&&!ctrl&&!e.altKey){e.preventDefault();nudge(key,e.shiftKey?10:1);return}
    }
    function initialize(){
        decorateButtons();$('imageShortcutsButton').onclick=showShortcuts;$('imageShortcutsClose').onclick=closeShortcuts;$('imageShortcutsReset').onclick=()=>{customShortcuts={};saveShortcuts();capturingShortcut=null;decorateButtons();showShortcuts();message('Atalhos padrão restaurados.')};
        document.addEventListener('keydown',keyDown);document.addEventListener('keyup',e=>{if(e.key===' '){spaceHeld=false;if(!gesture)overlay.style.cursor=M()==='hand'?'grab':'crosshair'}});
        window.addEventListener('blur',()=>{spaceHeld=false;cancelPointer();touchSort=null;clearDropMarkers()});
        window.addEventListener('beforeunload',()=>aiWorker?.terminate());
        overlay.ondblclick=e=>{if(host.busy)return;if(path.length){e.preventDefault();M()==='pen'?finishVectorPath():finishSelectionPath()}};
        viewport.addEventListener('pointerdown',e=>{if(e.target!==overlay&&(spaceHeld||M()==='hand')&&!host.busy){e.preventDefault();viewport.setPointerCapture(e.pointerId);pointerDown(e,host.point(e))}});
        viewport.addEventListener('pointermove',e=>{if(e.target!==overlay&&gesture?.kind==='pan')pointerMove(e,host.point(e))});viewport.addEventListener('pointerup',e=>{if(e.target!==overlay&&gesture?.kind==='pan')pointerUp(e)});
    }
    initialize();
    return{controls,bindControls,command,stateChanged,switchMode,draw,pointerDown,pointerMove,pointerUp,cancelPointer,wireLayers,decorateButtons,brushSize(){return paintSize},brushPreview(){return{size:paintSize,tip:texture,text:brushText}},canRasterize:requireRaster,restrictStroke(layer,candidate,original){return preserveOutside(candidate,original,localSelection(layer))}};
}
