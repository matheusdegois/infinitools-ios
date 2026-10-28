import {clamp} from './image-core.mjs';

export function colorRegion(data,w,h,x,y,tolerance=30,contiguous=true,limit=null){
    const result=new Uint8Array(w*h),sx=clamp(Math.floor(x),0,w-1),sy=clamp(Math.floor(y),0,h-1),seed=sy*w+sx,base=seed*4;
    const matches=i=>{if(limit&&!limit[i])return false;const p=i*4;return Math.max(Math.abs(data[p]-data[base]),Math.abs(data[p+1]-data[base+1]),Math.abs(data[p+2]-data[base+2]),Math.abs(data[p+3]-data[base+3]))<=tolerance};
    if(!contiguous){for(let i=0;i<result.length;i++)if(matches(i))result[i]=255;return result}
    const visited=new Uint8Array(w*h),queue=new Int32Array(w*h);let start=0,end=0;queue[end++]=seed;visited[seed]=1;
    while(start<end){const i=queue[start++];if(!matches(i))continue;result[i]=255;const px=i%w,py=Math.floor(i/w);for(const j of [px?i-1:-1,px<w-1?i+1:-1,py?i-w:-1,py<h-1?i+w:-1])if(j>=0&&!visited[j]){visited[j]=1;queue[end++]=j}}
    return result;
}

export function combineMasks(a,b,operation='replace'){
    if(!a||operation==='replace')return new Uint8Array(b);const out=new Uint8Array(b.length);
    for(let i=0;i<out.length;i++)out[i]=operation==='add'?Math.max(a[i],b[i]):operation==='subtract'?Math.max(0,a[i]-b[i]):Math.min(a[i],b[i]);return out;
}

export function edgeMap(data,w,h){
    const gray=new Float32Array(w*h),edges=new Float32Array(w*h);for(let i=0;i<gray.length;i++)gray[i]=.2126*data[i*4]+.7152*data[i*4+1]+.0722*data[i*4+2];
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x,gx=-gray[i-w-1]+gray[i-w+1]-2*gray[i-1]+2*gray[i+1]-gray[i+w-1]+gray[i+w+1],gy=-gray[i-w-1]-2*gray[i-w]-gray[i-w+1]+gray[i+w-1]+2*gray[i+w]+gray[i+w+1];edges[i]=Math.min(1,Math.hypot(gx,gy)/500)}return edges;
}

// Nearby edge attraction for interactive tracing; it does not infer semantic objects.
export function snapToEdge(edges,w,h,p,radius=12){
    let best={x:clamp(p.x,0,w-1),y:clamp(p.y,0,h-1)},score=0;
    for(let y=Math.max(1,Math.floor(p.y-radius));y<Math.min(h-1,p.y+radius);y++)for(let x=Math.max(1,Math.floor(p.x-radius));x<Math.min(w-1,p.x+radius);x++){const distance=Math.hypot(x-p.x,y-p.y);if(distance>radius)continue;const value=edges[y*w+x]-.55*distance/radius;if(value>score){score=value;best={x,y}}}return best;
}

export function sliceRects(w,h,columns,rows){
    const cols=clamp(Math.round(columns),1,Math.min(w,10)),rs=clamp(Math.round(rows),1,Math.min(h,10)),out=[];
    for(let y=0;y<rs;y++)for(let x=0;x<cols;x++){const left=Math.floor(x*w/cols),top=Math.floor(y*h/rs);out.push({x:left,y:top,w:Math.floor((x+1)*w/cols)-left,h:Math.floor((y+1)*h/rs)-top,row:y+1,column:x+1})}return out;
}

export function reorderLayers(layers,sourceId,targetId,before){
    if(sourceId===targetId)return layers;const topFirst=[...layers].reverse(),source=topFirst.find(l=>l.id===sourceId);if(!source||!topFirst.some(l=>l.id===targetId))return layers;
    const rest=topFirst.filter(l=>l.id!==sourceId),i=rest.findIndex(l=>l.id===targetId);rest.splice(i+(before?0:1),0,source);return rest.reverse();
}

function solve(matrix){
    const n=matrix.length;
    for(let col=0;col<n;col++){let pivot=col;for(let row=col+1;row<n;row++)if(Math.abs(matrix[row][col])>Math.abs(matrix[pivot][col]))pivot=row;
        if(Math.abs(matrix[pivot][col])<1e-9)throw new Error('Os quatro cantos precisam formar uma área válida.');
        [matrix[col],matrix[pivot]]=[matrix[pivot],matrix[col]];const factor=matrix[col][col];for(let k=col;k<=n;k++)matrix[col][k]/=factor;
        for(let row=0;row<n;row++)if(row!==col){const f=matrix[row][col];for(let k=col;k<=n;k++)matrix[row][k]-=f*matrix[col][k]}}
    return matrix.map(row=>row[n]);
}
export function perspectiveMatrix(points){
    const coordinates=[[0,0],[1,0],[1,1],[0,1]],matrix=[];
    for(let i=0;i<4;i++){const[u,v]=coordinates[i],{x,y}=points[i];matrix.push([u,v,1,0,0,0,-u*x,-v*x,x],[0,0,0,u,v,1,-u*y,-v*y,y])}return solve(matrix);
}
export function validQuad(points){
    if(points.length!==4)return false;let sign=0,area=0;for(let i=0;i<4;i++){const a=points[i],b=points[(i+1)%4],c=points[(i+2)%4],cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);if(Math.abs(cross)<1||sign&&Math.sign(cross)!==sign)return false;sign=Math.sign(cross);area+=a.x*b.y-b.x*a.y}return Math.abs(area)>8;
}
export function warpPerspective(data,w,h,points,outW,outH){
    if(!validQuad(points))throw new Error('Mantenha os quatro cantos sem cruzar as bordas.');const m=perspectiveMatrix(points),out=new Uint8ClampedArray(outW*outH*4);
    for(let y=0;y<outH;y++)for(let x=0;x<outW;x++){const u=(x+.5)/outW,v=(y+.5)/outH,d=m[6]*u+m[7]*v+1,sx=clamp((m[0]*u+m[1]*v+m[2])/d-.5,0,w-1),sy=clamp((m[3]*u+m[4]*v+m[5])/d-.5,0,h-1),x0=Math.floor(sx),y0=Math.floor(sy),fx=sx-x0,fy=sy-y0;
        const ns=[[x0,y0,(1-fx)*(1-fy)],[Math.min(w-1,x0+1),y0,fx*(1-fy)],[x0,Math.min(h-1,y0+1),(1-fx)*fy],[Math.min(w-1,x0+1),Math.min(h-1,y0+1),fx*fy]];let alpha=0,rr=0,gg=0,bb=0;
        for(const[nx,ny,weight]of ns){const i=(ny*w+nx)*4,a=data[i+3]*weight;alpha+=a;rr+=data[i]*a;gg+=data[i+1]*a;bb+=data[i+2]*a}const j=(y*outW+x)*4;out[j]=alpha?rr/alpha:0;out[j+1]=alpha?gg/alpha:0;out[j+2]=alpha?bb/alpha:0;out[j+3]=alpha}
    return out;
}

export function localFilter(data,w,h,kind){
    const out=new Uint8ClampedArray(data);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;for(let c=0;c<3;c++){let sum=0,weight=0;for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++){const j=(clamp(y+yy,0,h-1)*w+clamp(x+xx,0,w-1))*4,a=data[j+3]/255;sum+=data[j+c]*a;weight+=a}const avg=weight?sum/weight:data[i+c];out[i+c]=kind==='sharpen'?data[i+c]+(data[i+c]-avg)*1.5:avg}}return out;
}
