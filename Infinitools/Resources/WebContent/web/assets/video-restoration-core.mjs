export function videoFilters(settings){
  const filters=[];
  if(settings.deinterlace)filters.push('bwdif=mode=send_frame:parity=auto:deint=all');
  if(settings.denoise)filters.push('hqdn3d=3:3:4.5:4.5');
  if(settings.deblock)filters.push('deblock=filter=weak:block=8');
  if(settings.sharpen)filters.push('unsharp=5:5:0.45:5:5:0.0');
  const b=Number(settings.brightness),c=Number(settings.contrast),s=Number(settings.saturation);
  if(![b,c,s].every(n=>Number.isFinite(n)&&n>=-20&&n<=20))throw new Error('Ajustes de cor inválidos.');
  if(b||c||s)filters.push(`eq=brightness=${(b/100).toFixed(2)}:contrast=${(1+c/100).toFixed(2)}:saturation=${(1+s/100).toFixed(2)}`);
  if(!filters.length)throw new Error('Ative ao menos um ajuste de restauração.');
  return filters.join(',');
}
export function validateVideo({size,duration,width,height,fps=30}){
  if(!(size>0&&size<=256*1048576))throw new Error('Selecione um arquivo de até 256 MB.');
  if(!(duration>0&&duration<=300))throw new Error('Use um clipe de até 5 minutos.');
  if(!(width>0&&height>0&&width*height<=1920*1080&&Math.max(width,height)<=1920))throw new Error('Use um vídeo com até 1920 × 1080 pixels (ou orientação vertical equivalente).');
  if(!(fps>0&&fps<=120)||duration*width*height*fps>2_000_000_000)throw new Error('A combinação de duração, resolução e FPS excede o orçamento de processamento. Reduza o trecho ou a resolução.');
}
