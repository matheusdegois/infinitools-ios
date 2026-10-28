// Convert only un-clipped, axis-aligned rectangles and straight lines.
// Everything else stays in the original SVG background.
export function editableGeometry(svg=''){
 const xml=new DOMParser().parseFromString(svg,'image/svg+xml'),root=xml.documentElement,shapes=[];
 for(const node of [...root.children]){
  if(node.localName!=='path'||node.hasAttribute('clip-path')||node.hasAttribute('opacity'))continue;
  const matrix=(node.getAttribute('transform')||'matrix(1,0,0,1,0,0)').match(/^matrix\(([^)]+)\)$/);if(!matrix)continue;
  const m=matrix[1].split(/[ ,]+/).map(Number);if(m.length!==6||m[1]!==0||m[2]!==0)continue;
  const tokens=(node.getAttribute('d')||'').match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/g)||[];let x=0,y=0,points=[],valid=true,closed=false;
  for(let i=0;i<tokens.length;){const command=tokens[i++];if(command==='M'||command==='L'){x=Number(tokens[i++]);y=Number(tokens[i++]);}else if(command==='H')x=Number(tokens[i++]);else if(command==='V')y=Number(tokens[i++]);else if(command==='Z'){closed=true;continue;}else{valid=false;break;}points.push([x*m[0]+m[4],y*m[3]+m[5]]);}
  if(!valid||points.some(p=>!p.every(Number.isFinite)))continue;
  const line=!closed&&points.length===2,rect=closed&&points.length===4&&points.every((p,i)=>p[0]===points[(i+1)%4][0]||p[1]===points[(i+1)%4][1]);if(!line&&!rect)continue;
  const fill=node.getAttribute('fill')||'#000000',stroke=node.getAttribute('stroke')||'none';if(!/^(none|#[0-9a-f]{6})$/i.test(fill)||! /^(none|#[0-9a-f]{6})$/i.test(stroke))continue;
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);shapes.push({type:line?'line':'rect',x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys),points,fill,stroke,width:Number(node.getAttribute('stroke-width')||1)*Math.abs(m[0])});node.remove();
 }
 return {shapes,svg:new XMLSerializer().serializeToString(root)};
}

export function reconstructTables(lines,shapes=[]){
 const horizontal=shapes.filter(s=>s.type==='line'&&s.h<.5&&s.w>30),vertical=shapes.filter(s=>s.type==='line'&&s.w<.5&&s.h>15);
 const unique=values=>[...new Set(values.map(v=>Math.round(v)))].sort((a,b)=>a-b),tables=[],used=new Set();
 // Connected horizontal rules define independent tables, not the whole page.
 const groups=[];for(const rule of horizontal){let group=groups.find(g=>Math.abs(g[0].x-rule.x)<3&&Math.abs(g[0].w-rule.w)<3);if(!group){group=[];groups.push(group);}group.push(rule);}
 for(const group of groups){if(group.length<3)continue;const ys=unique(group.map(s=>s.y)),left=group[0].x,right=left+group[0].w,vs=vertical.filter(s=>s.x>=left-2&&s.x<=right+2&&s.y<=ys.at(-1)&&s.y+s.h>=ys[0]),xs=unique([left,right,...vs.map(s=>s.x)]);if(xs.length<3)continue;
  const rows=[],merges=[];
  for(let r=0;r<ys.length-1;r++){const values=Array(xs.length-1).fill(''),mid=(ys[r]+ys[r+1])/2;for(let c=0;c<values.length;c++){const nextBoundary=xs.findIndex((x,i)=>i>c&&(i===xs.length-1||vs.some(s=>Math.abs(s.x-x)<2&&s.y<=mid&&s.y+s.h>=mid))),end=nextBoundary<0?xs.length-1:nextBoundary;if(end>c+1)merges.push({s:{r,c},e:{r,c:end-1}});for(const [i,line] of lines.entries()){const b=line.bbox,cx=b.x+b.w/2,cy=b.y+b.h/2;if(cy>ys[r]&&cy<ys[r+1]&&cx>=xs[c]&&cx<xs[end]){values[c]+=(values[c]?' ':'')+line.text;used.add(i);}}c=end-1;}rows.push(values);}
  if(rows.some(row=>row.some(Boolean)))tables.push({rows,merges,xs,ys});
 }
 return {tables,remaining:lines.filter((_,i)=>!used.has(i))};
}
