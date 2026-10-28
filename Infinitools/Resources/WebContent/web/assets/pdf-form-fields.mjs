const asText=value=>value?.decodeText?.()??'';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const values=value=>Array.isArray(value)?value:value==null||value===''?[]:[String(value)];
const fieldKey=item=>item.originalName||item.name;
function readValue(value,lib){if(value instanceof lib.PDFArray)return value.asArray().map(x=>asText(x));return value instanceof lib.PDFName?value.decodeText():asText(value);}
function hexColor(components,fallback){if(!components?.length)return fallback;const rgb=components.length===1?Array(3).fill(components[0]):components.length===3?components:null;if(!rgb)return fallback;return '#'+rgb.map(n=>Math.round(Math.max(0,Math.min(1,n))*255).toString(16).padStart(2,'0')).join('');}

export function assertEditableForm(doc,lib){
 const acro=doc.catalog.lookupMaybe(lib.PDFName.of('AcroForm'),lib.PDFDict);
 if(acro?.has(lib.PDFName.of('XFA')))throw new Error('Formulário XFA: requer uma etapa própria de conversão para AcroForm ou PDF estático. Não será removido nem convertido silenciosamente.');
 const names=new Set();for(const field of doc.getForm().getFields()){if(names.has(field.getName()))throw new Error('Campos canônicos distintos compartilham o mesmo nome; o formulário é ambíguo e exige reparo próprio antes da edição.');names.add(field.getName());const signature=field.acroField.getInheritableAttribute(lib.PDFName.of('V'));if(field instanceof lib.PDFSignature&&signature&&signature!==lib.PDFNull)throw new Error('PDF assinado: editar campos invalidaria a assinatura existente. Use uma cópia sem assinatura.');}
}

export function formMetadata(doc,lib){
 assertEditableForm(doc,lib);const result={};
 for(const field of doc.getForm().getFields()){
  const widgets=field.acroField.getWidgets();
  const da=widgets[0]?.getDefaultAppearance()||field.acroField.getDefaultAppearance()||'',fontSize=Number(da.match(/\S+\s+([\d.]+)\s+Tf/)?.[1])||12,mk=widgets[0]?.getAppearanceCharacteristics(),rgb=da.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/),gray=da.match(/([\d.]+)\s+g/);
  result[field.getName()]={name:field.getName(),required:field.isRequired(),readOnly:field.isReadOnly(),maxLength:field instanceof lib.PDFTextField?field.getMaxLength()||0:0,defaultValue:readValue(field.acroField.getInheritableAttribute(lib.PDFName.of('DV')),lib),multiselect:field instanceof lib.PDFOptionList||field instanceof lib.PDFDropdown?field.isMultiselect():false,signature:field instanceof lib.PDFSignature,fontSize,font:/Courier/.test(da)?'Courier':/Times/.test(da)?'TimesRoman':'Helvetica',textColor:hexColor(rgb?rgb.slice(1).map(Number):gray?[Number(gray[1])]:null,'#000000'),borderColor:hexColor(mk?.getBorderColor(),'#000000'),backgroundColor:hexColor(mk?.getBackgroundColor(),'#ffffff'),borderWidth:widgets[0]?.dict.lookupMaybe(lib.PDFName.of('BS'),lib.PDFDict)?.lookupMaybe(lib.PDFName.of('W'),lib.PDFNumber)?.asNumber()??1,
   widgets:widgets.map(widget=>({rect:widget.getRectangle()}))};
 }
 return result;
}

function color(lib,hex){if(!/^#[\da-f]{6}$/i.test(hex))throw new Error('Cor de campo inválida.');return lib.rgb(...[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255));}
function choiceValues(field,value){const options=field.acroField.getOptions();return values(value).map(v=>{const option=options.find(o=>asText(o.value)===v||asText(o.display)===v);if(!option)throw new Error(`Valor ausente das opções: ${field.getName()}`);return option.value;});}
function defaultValue(field,item,doc,lib){
 const dict=field.acroField.dict,key=lib.PDFName.of('DV');
 if(field instanceof lib.PDFSignature)return;
 if(field instanceof lib.PDFTextField)dict.set(key,lib.PDFHexString.fromText(String(item.defaultValue||'')));
 else if(field instanceof lib.PDFDropdown||field instanceof lib.PDFOptionList){const selected=choiceValues(field,item.defaultValue);if(!item.multiselect&&selected.length>1)throw new Error('Valor padrão múltiplo exige uma lista com múltipla seleção.');if(selected.length)dict.set(key,selected.length>1?doc.context.obj(selected):selected[0]);else dict.delete(key);}
 else{
  let selected=String(item.defaultValue||'Off');
  if(field instanceof lib.PDFRadioGroup&&selected!=='Off'){
   const options=field.getOptions(),index=options.indexOf(selected);if(index<0){if(!field.acroField.getWidgets().some(w=>w.getOnValue()?.decodeText()===selected))throw new Error(`Valor padrão de radio inválido: ${item.name}`);}else selected=field.acroField.getWidgets()[index].getOnValue()?.decodeText()||selected;
  }else if(field instanceof lib.PDFCheckBox&&selected!=='Off')selected=field.acroField.getWidgets()[0]?.getOnValue()?.decodeText()||'Yes';
  dict.set(key,lib.PDFName.of(selected));
 }
}

export async function applyFormFields(doc,lib,state,pages=[]){
 assertEditableForm(doc,lib);const form=doc.getForm(),items=state.items||[],groups=new Map();
 if(!items.length&&!(state.originalFieldNames||[]).length)throw new Error('Crie pelo menos um campo sobre o PDF.');
 for(const item of items){const key=fieldKey(item);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}
 // Names are logical fields: all widgets sharing a name must remain one field.
 const names=new Set(form.getFields().filter(f=>!(state.originalFieldNames||[]).includes(f.getName())).map(f=>f.getName()));
 for(const group of groups.values()){
  const name=String(group[0].name||'').trim();
  if(!name||/[\x00-\x1f]/.test(name)||name.length>200)throw new Error('Use um nome de campo entre 1 e 200 caracteres, sem controles.');
  if(names.has(name))throw new Error(`Nome de campo duplicado: ${name}. Para compartilhar widgets, use um único campo lógico.`);names.add(name);
  if(group.some(item=>item.type!==group[0].type))throw new Error(`Campos de tipos diferentes compartilham o nome ${name}.`);
 }
 for(const name of state.originalFieldNames||[])if(!groups.has(name))form.removeField(form.getField(name));
 // Rename through temporary leaf names to support swaps without collisions.
 const renames=[];
 for(const [key,group] of groups)if(group[0].originalName&&group[0].name!==key){
  const field=form.getField(key),parent=field.acroField.getParent()?.getFullyQualifiedName(),prefix=parent?parent+'.':'';
  if(prefix&&!group[0].name.startsWith(prefix)||group[0].name.slice(prefix.length).includes('.'))throw new Error('Ao renomear, mantenha o caminho do grupo e altere apenas o nome final.');
  renames.push({field,name:group[0].name.slice(prefix.length)});
 }
 renames.forEach(({field},i)=>field.acroField.setPartialName('__infinitools_rename_'+i));
 renames.forEach(({field,name})=>field.acroField.setPartialName(name));
 const fonts=new Map();
 for(const [key,group] of groups){
  const item=group[0],existing=!!item.originalName;
  let field=existing?form.getField(item.name):null;
  if(!field){
   field=item.type==='text'?form.createTextField(item.name):item.type==='checkbox'?form.createCheckBox(item.name):item.type==='radio'?form.createRadioGroup(item.name):item.type==='dropdown'?form.createDropdown(item.name):item.type==='list'?form.createOptionList(item.name):null;
   if(item.type==='signature'){
    const dict=doc.context.obj({FT:'Sig',T:lib.PDFHexString.fromText(item.name),Ff:0,Kids:[]}),ref=doc.context.register(dict);
    const acro=new lib.PDFAcroSignature(dict,ref);form.acroForm.addField(ref);field=new lib.PDFSignature(acro,ref,doc);
   }
   if(!field)throw new Error('Tipo de campo inválido.');
   if(field instanceof lib.PDFDropdown||field instanceof lib.PDFOptionList)field.addOptions((item.options||[{value:'Opção 1'},{value:'Opção 2'}]).map(o=>o.value));
  }
  const original=item.originalState||{};
  if(!existing||item.required!==original.required)item.required?field.enableRequired():field.disableRequired();
  if(!existing||item.readOnly!==original.readOnly)item.readOnly?field.enableReadOnly():field.disableReadOnly();
  if(field instanceof lib.PDFTextField){
   const max=Number(item.maxLength)||0;if(!Number.isInteger(max)||max<0||max>1000000)throw new Error('Tamanho máximo inválido.');
   if(max&&(String(item.value||'').length>max||String(item.defaultValue||'').length>max))throw new Error(`Valor maior que o tamanho máximo: ${item.name}`);
   // Remove the previous limit before updating a value and applying the new one.
   if(!existing||item.maxLength!==original.maxLength)field.removeMaxLength();
   if(!existing||!equal(item.value,original.value)){if(String(item.value||'').includes('\n'))field.enableMultiline();field.setText(String(item.value||''));}
   if(!existing||item.maxLength!==original.maxLength){if(max)field.setMaxLength(max);}
  }else if(field instanceof lib.PDFCheckBox){if(!existing||!equal(item.value,original.value))item.value&&item.value!=='Off'?field.check():field.uncheck();}
  else if(field instanceof lib.PDFRadioGroup){if(existing&& !equal(item.value,original.value)){if(!item.value||item.value==='Off')field.clear();else{const options=field.getOptions(),widgets=field.acroField.getWidgets(),index=widgets.findIndex(w=>w.getOnValue()?.decodeText()===item.value);field.select(options.includes(item.value)?item.value:options[index]);}}}
  else if(field instanceof lib.PDFDropdown||field instanceof lib.PDFOptionList){
   if(!existing||item.multiselect!==original.multiselect)item.multiselect?field.enableMultiselect():field.disableMultiselect();
   if(!existing||!equal(item.value,original.value)||item.multiselect!==original.multiselect){const selected=choiceValues(field,item.value);if(!item.multiselect&&selected.length>1)throw new Error('Reduza a seleção a um valor antes de desativar múltipla seleção.');field.acroField.setValues(selected);field.markAsDirty();}
  }
  for(const widgetItem of group){
   const page=doc.getPage(widgetItem.page),pw=page.getWidth(),ph=page.getHeight(),box={x:widgetItem.x*pw,y:ph-(widgetItem.y+widgetItem.h)*ph,width:Math.max(1,widgetItem.w*pw),height:Math.max(1,widgetItem.h*ph),borderColor:color(lib,widgetItem.borderColor||'#000000'),backgroundColor:color(lib,widgetItem.backgroundColor||'#ffffff'),textColor:color(lib,widgetItem.textColor||'#000000'),borderWidth:Number(widgetItem.borderWidth??1)};
   if(existing){
    const id=Number(String(widgetItem.originalId).match(/^\d+/)?.[0]),source=pages.find(p=>p.pageIndex===widgetItem.page);
    if(id&&source){const a=source.base.convertToPdfPoint(widgetItem.x*source.base.width,widgetItem.y*source.base.height),b=source.base.convertToPdfPoint((widgetItem.x+widgetItem.w)*source.base.width,(widgetItem.y+widgetItem.h)*source.base.height),dict=doc.context.lookup(lib.PDFRef.of(id));if(dict instanceof lib.PDFDict)dict.set(lib.PDFName.of('Rect'),doc.context.obj([Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])]));}
   }else if(field instanceof lib.PDFSignature){
    const appearance=doc.context.register(doc.context.flateStream('q 0.95 g 0 0 '+box.width+' '+box.height+' re f 0 G 1 w 0 0 '+box.width+' '+box.height+' re S Q',{Type:'XObject',Subtype:'Form',BBox:[0,0,box.width,box.height],Resources:{}}));
    const widget=doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Widget',Parent:field.ref,P:page.ref,Rect:[box.x,box.y,box.x+box.width,box.y+box.height],F:4,AP:{N:appearance}}));field.acroField.dict.lookup(lib.PDFName.of('Kids'),lib.PDFArray).push(widget);page.node.addAnnot(widget);
   }else if(field instanceof lib.PDFRadioGroup)field.addOptionToPage(widgetItem.exportValue||'Opção '+(group.indexOf(widgetItem)+1),page,box);
   else field.addToPage(page,box);
  }
  if(!existing&&field instanceof lib.PDFRadioGroup&&item.value&&item.value!=='Off')field.select(item.value);
  if(!existing||!equal(item.defaultValue,original.defaultValue))defaultValue(field,item,doc,lib);
  if(item.appearanceDirty||!existing){
   const fontName=['Helvetica','Courier','TimesRoman'].includes(item.font)?item.font:'Helvetica';if(!fonts.has(fontName))fonts.set(fontName,await doc.embedFont(lib.StandardFonts[fontName]));
   const font=fonts.get(fontName),size=Number(item.fontSize)||12;if(size<4||size>150)throw new Error('Tamanho da fonte: use 4 a 150.');const borderWidth=Number(item.borderWidth??1);if(!Number.isFinite(borderWidth)||borderWidth<0||borderWidth>20)throw new Error('Espessura da borda: use 0 a 20.');
   const rgb=color(lib,item.textColor||'#000000');field.acroField.setDefaultAppearance(`/${font.name} ${size} Tf ${rgb.red} ${rgb.green} ${rgb.blue} rg`);
   for(const widget of field.acroField.getWidgets()){
    const mk=widget.getOrCreateAppearanceCharacteristics(),border=color(lib,item.borderColor||'#000000'),background=color(lib,item.backgroundColor||'#ffffff');mk.setBorderColor([border.red,border.green,border.blue]);mk.setBackgroundColor([background.red,background.green,background.blue]);
    widget.dict.set(lib.PDFName.of('BS'),doc.context.obj({W:Number(item.borderWidth??1),S:'S'}));
    widget.setDefaultAppearance(field.acroField.getDefaultAppearance());
    if(field instanceof lib.PDFSignature){const rect=widget.getRectangle(),stream=`q ${background.red} ${background.green} ${background.blue} rg 0 0 ${rect.width} ${rect.height} re f ${border.red} ${border.green} ${border.blue} RG ${borderWidth} w 0 0 ${rect.width} ${rect.height} re S Q`;widget.setNormalAppearance(doc.context.register(doc.context.flateStream(stream,{Type:'XObject',Subtype:'Form',BBox:[0,0,rect.width,rect.height],Resources:{}})));}
   }
   if(!(field instanceof lib.PDFSignature)&&!(field instanceof lib.PDFDropdown)&&!(field instanceof lib.PDFOptionList))field.defaultUpdateAppearances(font);
  }
  // PDF-lib's public choice API uses display labels, while PDF.js imports the
  // canonical export values. Render labels without changing canonical /V or /I.
  if((field instanceof lib.PDFDropdown||field instanceof lib.PDFOptionList)&&(field.isDirty()||item.appearanceDirty||!existing)){
   const key=lib.PDFName.of('V'),canonical=field.acroField.dict.get(key),selected=field.acroField.getValues(),options=field.acroField.getOptions();
   const displayed=selected.map(v=>options.find(o=>asText(o.value)===asText(v))?.display||v);
   if(displayed.length)field.acroField.dict.set(key,displayed.length>1?doc.context.obj(displayed):displayed[0]);
   try{field.defaultUpdateAppearances(fonts.get(item.font)||await doc.embedFont(lib.StandardFonts.Helvetica));}finally{canonical?field.acroField.dict.set(key,canonical):field.acroField.dict.delete(key);}
  }
 }
 return doc;
}
