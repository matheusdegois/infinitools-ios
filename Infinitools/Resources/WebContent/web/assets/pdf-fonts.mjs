// Technical embedding flags do not grant a license. Call only after the user
// explicitly confirms reuse rights. CFF/Type1 and restricted fonts are skipped.
export function recoverTrueTypeFonts(doc,reuseAllowed=false){
 if(!reuseAllowed)return [];
 const result=[];let total=0;
 for(let i=1;i<doc.countObjects();i++){
  const object=doc.newIndirect(i).resolve();if(!object.isDictionary()||object.get('Type').asName()!=='FontDescriptor')continue;
  const originalName=object.get('FontName').asName();if(/^[A-Z]{6}\+/.test(originalName))continue;
  const stream=object.get('FontFile2');if(!stream.isStream())continue;const buffer=stream.readStream();
  try{const bytes=buffer.asUint8Array();if(bytes.length>5000000||total+bytes.length>20000000||bytes.length<12)continue;const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(view.getUint32(0)!==0x00010000)continue;let flags=null,unicode=false;
   for(let table=0;table<view.getUint16(4);table++){const at=12+table*16;if(at+16>bytes.length)break;if(String.fromCharCode(...bytes.subarray(at,at+4))==='OS/2'){const offset=view.getUint32(at+8);if(offset+10<=bytes.length)flags=view.getUint16(offset+8);}if(String.fromCharCode(...bytes.subarray(at,at+4))==='cmap'){const offset=view.getUint32(at+8);if(offset+4<=bytes.length)for(let j=0;j<view.getUint16(offset+2);j++){const entry=offset+4+j*8;if(entry+8>bytes.length)break;const platform=view.getUint16(entry),encoding=view.getUint16(entry+2);if(platform===0||(platform===3&&(encoding===1||encoding===10)))unicode=true;}}}
   if(flags!==0||!unicode)continue;let binary='';for(let at=0;at<bytes.length;at+=8192)binary+=String.fromCharCode(...bytes.subarray(at,at+8192));const name=object.get('FontName').asName().replace(/^[A-Z]{6}\+/,'');if(!/^[a-z0-9 _-]+$/i.test(name))continue;
   result.push({name,data:'data:font/ttf;base64,'+btoa(binary)});total+=bytes.length;
  }finally{buffer.destroy();}
 }
 return result;
}
