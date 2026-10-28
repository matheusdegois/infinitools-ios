export function tilePlan(width,height,tile=256,overlap=32){
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>1024||height>1024)throw new Error('A ampliação com IA aceita até 1024 × 1024 pixels.');
    const positions=size=>{const result=[0];while(result.at(-1)+tile<size){const next=Math.min(result.at(-1)+tile-overlap,size-tile);if(next<=result.at(-1))break;result.push(next);}return result;};
    const xs=positions(width),ys=positions(height),result=[];
    ys.forEach((y,row)=>xs.forEach((x,col)=>{const left=col===0?0:Math.floor((xs[col-1]+tile+x)/2),right=col===xs.length-1?width:Math.floor((x+tile+xs[col+1])/2),top=row===0?0:Math.floor((ys[row-1]+tile+y)/2),bottom=row===ys.length-1?height:Math.floor((y+tile+ys[row+1])/2);result.push({x,y,width:Math.min(tile,width-x),height:Math.min(tile,height-y),left,top,right,bottom});}));return result;
}
export async function tiledUpscale(source,upscale,{cancelled=()=>false,onProgress=()=>{}}={}){
    const tiles=tilePlan(source.width,source.height),output=document.createElement('canvas');output.width=source.width*2;output.height=source.height*2;const ctx=output.getContext('2d');
    for(const [index,tile] of tiles.entries()){
        if(cancelled())throw new Error('Processamento cancelado.');onProgress(index+1,tiles.length);
        const input=document.createElement('canvas');input.width=tile.width;input.height=tile.height;input.getContext('2d').drawImage(source,tile.x,tile.y,tile.width,tile.height,0,0,tile.width,tile.height);
        const enlarged=await upscale(input);if(enlarged.width!==tile.width*2||enlarged.height!==tile.height*2)throw new Error('O modelo retornou uma ampliação diferente de 2×.');
        ctx.drawImage(enlarged,(tile.left-tile.x)*2,(tile.top-tile.y)*2,(tile.right-tile.left)*2,(tile.bottom-tile.top)*2,tile.left*2,tile.top*2,(tile.right-tile.left)*2,(tile.bottom-tile.top)*2);input.width=input.height=enlarged.width=enlarged.height=1;
    }
    return output;
}
