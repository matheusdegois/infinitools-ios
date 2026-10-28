export function validateLottie(data){
 if(!data||typeof data!=='object'||!Array.isArray(data.layers)||typeof data.v!=='string')throw Error('Selecione um JSON de animação Lottie.');
 for(const key of ['w','h','fr','ip','op'])if(!Number.isFinite(data[key]))throw Error('A animação possui dimensões ou duração inválidas.');
 if(data.w<1||data.h<1||data.w>2048||data.h>2048||data.w*data.h>4000000||data.fr<1||data.fr>120||data.op<=data.ip||(data.op-data.ip)/data.fr>120||data.op-data.ip>10000)throw Error('Limites: 2048 px, 4 megapixels, 120 fps e 2 minutos.');
 let nodes=0,containers=0;const stack=[[data,0]];
 while(stack.length){const [value,depth]=stack.pop();if(++nodes>500000||depth>64)throw Error('Esta animação é complexa demais para o visualizador.');if(!value||typeof value!=='object')continue;
  if(++containers>100000)throw Error('Esta animação possui estruturas demais para o visualizador.');
  if(typeof value.x==='string')throw Error('Animações com expressões não são aceitas nesta versão.');
  if(value.ty===2||value.ty===5||value.ty===6||value.ty===13||value.p&&typeof value.p==='string'||value.fPath)throw Error('Use uma animação vetorial sem imagens, texto, áudio ou recursos externos.');
  for(const [key,child] of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(key))throw Error('Estrutura inválida.');stack.push([child,depth+1]);}
 }
 if(data.fonts?.list?.length)throw Error('Fontes externas não são aceitas nesta versão.');
 return data;
}
