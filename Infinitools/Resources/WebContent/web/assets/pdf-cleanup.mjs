import * as mupdf from './vendor/mupdf/package/dist/mupdf.js';

const commentTypes=new Set(['Text','FreeText','Line','Square','Circle','Polygon','PolyLine','Highlight','Underline','Squiggly','StrikeOut','Stamp','Caret','Ink','Popup','Redact']);
const actionTypes=new Set(['GoTo','GoToR','GoToE','Launch','Thread','URI','Sound','Movie','Hide','Named','SubmitForm','ResetForm','ImportData','JavaScript','SetOCGState','Rendition','Trans','GoTo3DView']);

// Walk direct dictionaries as well as indirect objects, including unreachable
// revisions/objects which may otherwise survive a partial rewrite.
function dictionaries(doc,visit){
 const seen=new Set();let nodes=0;
 function walk(object,depth=0){
  let id=null;
  if(depth>100||++nodes>500000)throw new Error('Estrutura PDF complexa demais para limpeza segura.');
  if(object.isIndirect()){id=object.asIndirect();if(seen.has(id))return;seen.add(id);object=object.resolve();}
  if(object.isDictionary()||object.isStream()){
   visit(object,id);const children=[];object.forEach(value=>children.push(value));children.forEach(child=>walk(child,depth+1));
  }else if(object.isArray())for(let i=0;i<object.length;i++)walk(object.get(i),depth+1);
 }
 walk(doc.getTrailer());for(let i=1;i<doc.countObjects();i++)walk(doc.newIndirect(i));
}

export function cleanupPdf(bytes,settings={}){
 const selected={comments:!!settings.comments,actions:!!settings.actions,javascript:!!settings.javascript,attachments:!!settings.attachments,privateData:!!settings.privateData};
 if(!Object.values(selected).some(Boolean))throw new Error('Selecione pelo menos uma categoria para remover.');
 const doc=new mupdf.PDFDocument(bytes);
 const report={version:1,selected,removed:{comments:0,actions:0,javascript:0,attachments:0,privateData:0},scope:'Limpeza estrutural de categorias conhecidas. Não rasura texto, imagens, valores de formulário ou dados pessoais visíveis nas páginas. Não certifica anonimização.',warnings:[],pages:0};
 try{
  if(doc.needsPassword()&&!doc.authenticatePassword(settings.openPassword||''))throw new Error('Senha necessária ou incorreta para abrir este PDF.');
  const root=doc.getTrailer().get('Root');
  if(!root.get('AcroForm','XFA').isNull())throw new Error('PDF com XFA: requer uma etapa própria de conversão para AcroForm ou PDF estático. A limpeza não foi aplicada.');
  // Also detect invisible signatures not associated with a page widget.
  dictionaries(doc,object=>{if(object.get('FT').asName()==='Sig'&&!object.get('V').isNull()||object.get('Type').asName()==='Sig'&&!object.get('ByteRange').isNull())throw new Error('PDF assinado: a limpeza invalidaria assinaturas existentes. Use uma cópia sem assinatura.');});
  const drop=(object,key,category)=>{if(!object.get(key).isNull()){object.delete(key);report.removed[category]++;}};
  report.pages=doc.countPages();
  const removedCommentIds=new Set();
  for(let i=0;i<doc.countPages();i++){
   const page=doc.loadPage(i);
   try{for(const annotation of page.getAnnotations()){
    const type=annotation.getType();
    if(selected.comments&&commentTypes.has(type)){const object=annotation.getObject();if(object.isIndirect())removedCommentIds.add(object.asIndirect());page.deleteAnnotation(annotation);report.removed.comments++;if(type==='Redact')report.warnings.push('Anotação de rasura pendente removida; o conteúdo da página não foi rasurado.');}
    else if(selected.attachments&&type==='FileAttachment'){page.deleteAnnotation(annotation);report.removed.attachments++;}
   }}finally{page.destroy();}
  }
  if(selected.privateData){
   const info=doc.getTrailer().get('Info');
   if(!info.isNull()){if(info.isIndirect())doc.deleteObject(info.asIndirect());doc.getTrailer().delete('Info');report.removed.privateData++;}
   if(doc.getTrailer().get('Encrypt').isNull())drop(doc.getTrailer(),'ID','privateData');
   else report.warnings.push('Identificador necessário à criptografia mantido.');
  }
  dictionaries(doc,(object,id)=>{
   const subtype=object.get('Subtype').asName(),type=object.get('Type').asName(),action=object.get('S').asName();
   if(selected.comments&&commentTypes.has(subtype)){
    if(!removedCommentIds.has(id))report.removed.comments++;
    // Replies, popups or private structures may retain a reference after the
    // page annotation is detached. Clear the object too, before garbage collection.
    const keys=[];object.forEach((value,key)=>keys.push(key));keys.forEach(key=>object.delete(key));
   }
   if(selected.comments)for(const key of ['IRT','Popup'])drop(object,key,'comments');
   if((selected.actions&&(actionTypes.has(action)||type==='Action'))||(selected.javascript&&action==='JavaScript')){
    if(action==='JavaScript')report.removed.javascript++;
    if(selected.actions)report.removed.actions++;
    const keys=[];object.forEach((value,key)=>keys.push(key));keys.forEach(key=>object.delete(key));
   }
   if(selected.actions){for(const key of ['A','AA','OpenAction'])drop(object,key,'actions');}
   if(selected.javascript){drop(object,'JS','javascript');drop(object,'JavaScript','javascript');}
   if(selected.attachments){for(const key of ['EmbeddedFiles','AF','EF'])drop(object,key,'attachments');}
   if(selected.privateData){
    for(const key of ['Metadata','PieceInfo','LastModified','SpiderInfo'])drop(object,key,'privateData');
    if(type==='Annot'||commentTypes.has(subtype)||['Link','FileAttachment'].includes(subtype))for(const key of ['NM','M',...(subtype==='Widget'?[]:['T','Subj'])])drop(object,key,'privateData');
    if(type==='Filespec')drop(object,'Desc','privateData');
   }
  });
  const buffer=doc.saveToBuffer({garbage:'deduplicate',compress:'yes',encrypt:'keep'});
  let output;try{output=buffer.asUint8Array().slice();}finally{buffer.destroy();}
  report.warnings=[...new Set(report.warnings)];report.inputBytes=bytes.length;report.outputBytes=output.length;
  report.countMeaning='Contagem de anotações, dicionários de ação e entradas removidas; referências múltiplas não equivalem a arquivos únicos.';
  return{bytes:output,report};
 }finally{doc.destroy();mupdf.emptyStore();}
}
