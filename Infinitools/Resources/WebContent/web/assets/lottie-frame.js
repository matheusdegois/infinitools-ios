let animation=null,token=0,background='transparent',lastUpdate=0;
const send=(type,extra={})=>parent.postMessage({type,token,...extra},'*');
addEventListener('message',async event=>{
 if(event.source!==parent)return;const m=event.data;
 if(m.type==='load'){
  animation?.destroy();token=m.token;const current=token;
  try{animation=lottie.loadAnimation({container:document.querySelector('#animation'),renderer:'canvas',loop:true,autoplay:false,animationData:m.data,rendererSettings:{clearCanvas:true,dpr:1,preserveAspectRatio:'xMidYMid meet'}});
   animation.addEventListener('DOMLoaded',()=>{if(current!==token)return;send('ready',{frames:animation.totalFrames});if(m.play)animation.play();});
   animation.addEventListener('enterFrame',()=>{if(performance.now()-lastUpdate>80){lastUpdate=performance.now();send('frame',{frame:animation.currentFrame});}});
   animation.addEventListener('data_failed',()=>send('error'));
  }catch{send('error');}return;
 }
 if(!animation||m.token!==token)return;
 if(m.type==='play')animation.play();if(m.type==='pause')animation.pause();if(m.type==='seek')animation.goToAndStop(m.frame,true);if(m.type==='speed')animation.setSpeed(m.value);
 if(m.type==='background'){background=m.value;document.body.style.background=background;}
 if(m.type==='png'){
  const source=document.querySelector('#animation canvas');if(!source)return;const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;const ctx=canvas.getContext('2d');if(background!=='transparent'){ctx.fillStyle=background;ctx.fillRect(0,0,canvas.width,canvas.height);}ctx.drawImage(source,0,0);const current=token;
  canvas.toBlob(async blob=>{if(!blob||current!==token)return;const bytes=await blob.arrayBuffer();parent.postMessage({type:'png',token:current,bytes},'*',[bytes]);canvas.width=canvas.height=1;},'image/png');
 }
});
