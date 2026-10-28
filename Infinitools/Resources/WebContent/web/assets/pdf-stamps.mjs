export const stampModels={approved:{text:'APROVADO',color:'#16834b'},received:{text:'RECEBIDO',color:'#1666b0'},confidential:{text:'CONFIDENCIAL',color:'#b62525'},date:{text:'',color:'#273448'},custom:{text:'CARIMBO',color:'#273448'},image:{text:'',color:'#273448'}};
export function stampPages(spec,total){
    if(!String(spec).trim())return Array.from({length:total},(_,i)=>i);
    const result=new Set();
    for(const token of String(spec).split(',')){const match=token.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);if(!match)throw new Error('Informe páginas como 1, 3-5.');const a=Number(match[1]),b=Number(match[2]||a);if(a<1||b<1||a>total||b>total)throw new Error(`As páginas devem estar entre 1 e ${total}.`);for(let n=a;n<=b;n++)result.add(n-1);if(a>b)throw new Error('Use intervalos em ordem crescente.');}
    return [...result];
}
export function stampBox(width,height,{position='bottom-right',widthPercent=35,heightPercent=12,x=50,y=50}={}){
    if(![widthPercent,heightPercent,x,y].every(Number.isFinite)||widthPercent<5||widthPercent>90||heightPercent<3||heightPercent>50||x<0||x>100||y<0||y>100)throw new Error('Confira tamanho e posição do carimbo.');
    const pad=Math.min(20,width*.04,height*.04),w=Math.min(width*widthPercent/100,width-pad*2),h=Math.min(height*heightPercent/100,height-pad*2);
    const px=position==='custom'?x/100:position.endsWith('left')?0:position.endsWith('right')?1:.5,py=position==='custom'?y/100:position.startsWith('top')?0:position.startsWith('bottom')?1:.5;
    return {x:pad+(width-pad*2-w)*px,y:pad+(height-pad*2-h)*(1-py),w,h};
}
function coordinates(page,x,y){const c=page.getCropBox(),angle=((page.getRotation().angle%360)+360)%360;return angle===90?[c.x+c.width-y,c.y+x]:angle===180?[c.x+c.width-x,c.y+c.height-y]:angle===270?[c.x+y,c.y+c.height-x]:[c.x+x,c.y+y];}
export async function applyStamps(doc,lib,settings){
    const indexes=stampPages(settings.pages||'',doc.getPageCount()),opacity=Number(settings.opacity??.7);
    if(!Number.isFinite(opacity)||opacity<.05||opacity>1)throw new Error('A opacidade deve ficar entre 5% e 100%.');
    const model=stampModels[settings.model]||stampModels.custom,text=String(settings.text||model.text).trim();
    if(settings.model!=='image'&&!text)throw new Error('Informe o texto do carimbo.');
    const color=String(settings.color||model.color);if(!/^#[\da-f]{6}$/i.test(color))throw new Error('Cor inválida.');
    const rgb=lib.rgb(...color.match(/[\da-f]{2}/gi).map(s=>parseInt(s,16)/255)),font=await doc.embedFont(lib.StandardFonts.HelveticaBold);
    let image;if(settings.model==='image'){if(!settings.imageBytes)throw new Error('Selecione a imagem do carimbo.');image=await doc.embedPng(settings.imageBytes);}
    for(const index of indexes){const page=doc.getPage(index),crop=page.getCropBox(),angle=((page.getRotation().angle%360)+360)%360,rotated=angle===90||angle===270,width=rotated?crop.height:crop.width,height=rotated?crop.width:crop.height,box=stampBox(width,height,settings),[x,y]=coordinates(page,box.x,box.y),rotate=lib.degrees(angle);
        if(image){const scale=Math.min(box.w/image.width,box.h/image.height),w=image.width*scale,h=image.height*scale,[ix,iy]=coordinates(page,box.x+(box.w-w)/2,box.y+(box.h-h)/2);page.drawImage(image,{x:ix,y:iy,width:w,height:h,rotate,opacity});}
        else{const lines=text.split('\n').slice(0,3),fontSize=Math.max(1,Math.min(box.h/(lines.length*1.5),...lines.map(line=>(box.w-10)/Math.max(.1,font.widthOfTextAtSize(line,1)))));if(settings.border!==false)page.drawRectangle({x,y,width:box.w,height:box.h,rotate,borderWidth:1.5,borderColor:rgb,borderOpacity:opacity});lines.forEach((line,i)=>{const tx=box.x+(box.w-font.widthOfTextAtSize(line,fontSize))/2,ty=box.y+box.h/2+(lines.length/2-i-.8)*fontSize*1.3,[lx,ly]=coordinates(page,tx,ty);page.drawText(line,{x:lx,y:ly,size:fontSize,font,color:rgb,opacity,rotate});});}
    }
    return indexes.length;
}
