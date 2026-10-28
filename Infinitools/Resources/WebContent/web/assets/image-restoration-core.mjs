export function restorationProfile(name,width,height){
  const small=Math.max(width,height)<900;
  const presets={
    auto:{denoise:small,deblock:false,details:small,color:true,scale:small?2:1,ai:false},
    old:{denoise:true,deblock:false,details:true,color:true,scale:1,ai:false},
    jpeg:{denoise:false,deblock:true,details:true,color:false,scale:1,ai:false},
    pixel:{denoise:false,deblock:true,details:true,color:false,scale:2,ai:false},
    anime:{denoise:false,deblock:true,details:true,color:false,scale:2,ai:false},
  };
  return presets[name]||null;
}
export function outputDimensions(width,height,scale){
  const factor=Number(scale);
  if(!Number.isInteger(factor)||![1,2,4].includes(factor))throw Error('Ampliação inválida.');
  if(width<1||height<1||width>6000||height>6000)throw Error('Imagem fora do tamanho permitido.');
  if(width*height*factor*factor>16_000_000)throw Error('A saída excederia 16 milhões de pixels. Reduza a ampliação.');
  return {width:width*factor,height:height*factor};
}
