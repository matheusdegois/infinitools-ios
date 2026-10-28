// Pure pixel/geometry operations, shared by the UI, worker and automated tests.
export const clamp=(x,a=0,b=255)=>Math.max(a,Math.min(b,x));
export const defaults=()=>({exposure:0,brightness:0,contrast:0,highlights:0,shadows:0,temperature:0,saturation:0,vibrance:0,hue:0,sharpness:0,clarity:0,noise:0,curve:[0,64,128,192,255]});

export function toneTable(values){
    const xs=[0,64,128,192,255],v=values||xs,slopes=xs.slice(0,4).map((x,i)=>(v[i+1]-v[i])/(xs[i+1]-x));
    const m=[slopes[0],0,0,0,slopes[3]];
    for(let i=1;i<4;i++)m[i]=slopes[i-1]*slopes[i]<=0?0:2*slopes[i-1]*slopes[i]/(slopes[i-1]+slopes[i]);
    const out=new Uint8ClampedArray(256);
    for(let x=0;x<256;x++){let i=Math.min(3,Math.floor(x/64)),dx=xs[i+1]-xs[i],t=(x-xs[i])/dx,t2=t*t,t3=t2*t;out[x]=(2*t3-3*t2+1)*v[i]+(t3-2*t2+t)*dx*m[i]+(-2*t3+3*t2)*v[i+1]+(t3-t2)*dx*m[i+1]}
    return out;
}

function blur(data,w,h,r){
    const temp=new Float32Array(data.length),out=new Float32Array(data.length),n=2*r+1;
    for(let y=0;y<h;y++)for(let c=0;c<3;c++){let sum=0;for(let x=-r;x<=r;x++)sum+=data[(y*w+clamp(x,0,w-1))*4+c];for(let x=0;x<w;x++){temp[(y*w+x)*4+c]=sum/n;sum+=data[(y*w+clamp(x+r+1,0,w-1))*4+c]-data[(y*w+clamp(x-r,0,w-1))*4+c]}}
    for(let x=0;x<w;x++)for(let c=0;c<3;c++){let sum=0;for(let y=-r;y<=r;y++)sum+=temp[(clamp(y,0,h-1)*w+x)*4+c];for(let y=0;y<h;y++){out[(y*w+x)*4+c]=sum/n;sum+=temp[(clamp(y+r+1,0,h-1)*w+x)*4+c]-temp[(clamp(y-r,0,h-1)*w+x)*4+c]}}
    return out;
}

function denoise(data,w,h,amount){
    const src=new Uint8ClampedArray(data),strength=amount/100,threshold=12+strength*55;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;let total=0,rr=0,gg=0,bb=0;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){let j=(clamp(y+dy,0,h-1)*w+clamp(x+dx,0,w-1))*4;let diff=(Math.abs(src[j]-src[i])+Math.abs(src[j+1]-src[i+1])+Math.abs(src[j+2]-src[i+2]))/3;let weight=Math.exp(-diff*diff/(2*threshold*threshold))*(src[j+3]/255);total+=weight;rr+=src[j]*weight;gg+=src[j+1]*weight;bb+=src[j+2]*weight}
        if(total){data[i]=src[i]*(1-strength)+rr/total*strength;data[i+1]=src[i+1]*(1-strength)+gg/total*strength;data[i+2]=src[i+2]*(1-strength)+bb/total*strength}
    }
}

export function adjustPixels(source,w,h,settings={}){
    const a={...defaults(),...settings},data=new Uint8ClampedArray(source),table=toneTable(a.curve),ev=2**a.exposure,contrast=2**(a.contrast/65),angle=a.hue*Math.PI/180,cs=Math.cos(angle),sn=Math.sin(angle);
    for(let i=0;i<data.length;i+=4){if(!data[i+3])continue;let r=data[i]/255,g=data[i+1]/255,b=data[i+2]/255,l=.2126*r+.7152*g+.0722*b;
        const lum=a.shadows/180*(1-l)**2+a.highlights/180*l*l;
        r=((r*ev+a.brightness/150+lum-.5)*contrast+.5)+a.temperature/500;
        g=((g*ev+a.brightness/150+lum-.5)*contrast+.5);
        b=((b*ev+a.brightness/150+lum-.5)*contrast+.5)-a.temperature/500;
        l=.2126*r+.7152*g+.0722*b;let factor=Math.max(0,1+a.saturation/100+a.vibrance/100*(1-clamp(Math.max(r,g,b)-Math.min(r,g,b),0,1)));
        r=l+(r-l)*factor;g=l+(g-l)*factor;b=l+(b-l)*factor;
        if(a.hue){const yy=.299*r+.587*g+.114*b,ii=.596*r-.274*g-.322*b,qq=.211*r-.523*g+.312*b,ir=ii*cs-qq*sn,qr=ii*sn+qq*cs;r=yy+.956*ir+.621*qr;g=yy-.272*ir-.647*qr;b=yy-1.106*ir+1.703*qr}
        data[i]=table[Math.round(clamp(r*255))];data[i+1]=table[Math.round(clamp(g*255))];data[i+2]=table[Math.round(clamp(b*255))];
    }
    if(a.noise>0)denoise(data,w,h,a.noise);
    if(a.sharpness||a.clarity){const fine=a.sharpness?blur(data,w,h,1):null,broad=a.clarity?blur(data,w,h,6):null,source2=new Uint8ClampedArray(data);for(let i=0;i<data.length;i+=4)for(let c=0;c<3;c++)data[i+c]=source2[i+c]+(fine?(source2[i+c]-fine[i+c])*a.sharpness/55:0)+(broad?(source2[i+c]-broad[i+c])*a.clarity/90:0)}
    return data;
}

// Preenchimento da borda para o centro. A pequena expansão evita que sobras escuras
// da própria mancha contaminem a correção, algo especialmente visível em textos.
export function healPixels(source,w,h,mask,settings={}){
    const total=w*h,out=new Uint8ClampedArray(source),painted=new Uint8Array(total),target=new Uint8Array(total),padding=clamp(Math.round(settings.padding??2),0,5);
    for(let i=0;i<total;i++)painted[i]=mask[i]>8?1:0;
    if(!painted.some(Boolean))return out;
    if(!padding)target.set(painted);else for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(!painted[i])continue;for(let dy=-padding;dy<=padding;dy++){const yy=y+dy;if(yy<0||yy>=h)continue;const span=Math.floor(Math.sqrt(padding*padding-dy*dy));for(let dx=-span;dx<=span;dx++){const xx=x+dx;if(xx>=0&&xx<w)target[yy*w+xx]=1}}}
    const state=new Uint8Array(target),queue=new Int32Array(total);let head=0,tail=0;
    const visit=(i,callback)=>{const x=i%w,y=Math.floor(i/w);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const xx=x+dx,yy=y+dy;if(xx>=0&&xx<w&&yy>=0&&yy<h)callback(yy*w+xx,dx&&dy ? .7071 : 1)}};
    for(let i=0;i<total;i++)if(state[i]===1){let boundary=false;visit(i,j=>{if(state[j]===0)boundary=true});if(boundary){state[i]=2;queue[tail++]=i}}
    while(head<tail){const i=queue[head++],sum=[0,0,0],weights=[0];visit(i,(j,weight)=>{if(state[j]!==0)return;const alpha=out[j*4+3]/255,wgt=weight*alpha;if(!wgt)return;weights[0]+=wgt;for(let c=0;c<3;c++)sum[c]+=out[j*4+c]*wgt});if(!weights[0])continue;for(let c=0;c<3;c++)out[i*4+c]=sum[c]/weights[0];state[i]=0;visit(i,j=>{if(state[j]===1){state[j]=2;queue[tail++]=j}})}
    // Uma passagem curta suaviza faixas produzidas pelo avanço da borda sem
    // borrar pixels fora da área que o usuário marcou.
    const smooth=new Uint8ClampedArray(out);for(let i=0;i<total;i++)if(painted[i]){const sum=[out[i*4]*2,out[i*4+1]*2,out[i*4+2]*2],weight=[2];visit(i,(j,wgt)=>{if(!target[j])return;weight[0]+=wgt;for(let c=0;c<3;c++)sum[c]+=out[j*4+c]*wgt});for(let c=0;c<3;c++)smooth[i*4+c]=sum[c]/weight[0]}
    return smooth;
}

export function mergedLayout(w,h,iw,ih,direction,gap=0){
    gap=Math.max(0,Math.round(gap));let nw=w,nh=h,x=0,y=0,shiftX=0,shiftY=0;
    if(direction==='left'||direction==='right'){nh=Math.max(h,ih);nw=w+iw+gap;y=(nh-ih)/2;shiftY=(nh-h)/2;if(direction==='left'){shiftX=iw+gap}else x=w+gap}
    else{nw=Math.max(w,iw);nh=h+ih+gap;x=(nw-iw)/2;shiftX=(nw-w)/2;if(direction==='top')shiftY=ih+gap;else y=h+gap}
    return{width:Math.ceil(nw),height:Math.ceil(nh),x,y,shiftX,shiftY};
}

export function toLayerPoint(layer,p){
    const angle=-layer.angle*Math.PI/180,dx=p.x-(layer.x+layer.w/2),dy=p.y-(layer.y+layer.h/2),x=(dx*Math.cos(angle)-dy*Math.sin(angle))/(layer.flipX?-1:1)+layer.w/2,y=(dx*Math.sin(angle)+dy*Math.cos(angle))/(layer.flipY?-1:1)+layer.h/2;
    return{x:x/layer.w*layer.source.width,y:y/layer.h*layer.source.height};
}

export function normalizeModelInput(rgba){
    const pixels=rgba.length/4,input=new Float32Array(pixels*3),means=[.485,.456,.406],std=[.229,.224,.225];let max=1;
    for(let i=0;i<rgba.length;i+=4)max=Math.max(max,rgba[i],rgba[i+1],rgba[i+2]);
    for(let i=0;i<pixels;i++)for(let c=0;c<3;c++)input[c*pixels+i]=(rgba[i*4+c]/max-means[c])/std[c];
    return input;
}
