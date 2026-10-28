export function certificateIdentity(forge,pfxBytes,password) {
    let p12;
    try{p12=forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(binaryString(pfxBytes)),false,password);}catch{throw new Error('Não foi possível abrir o certificado. Confira o arquivo P12/PFX e sua senha.');}
    const keyBags=[...(p12.getBags({bagType:forge.pki.oids.pkcs8ShroudedKeyBag})[forge.pki.oids.pkcs8ShroudedKeyBag]||[]),...(p12.getBags({bagType:forge.pki.oids.keyBag})[forge.pki.oids.keyBag]||[])],certBags=p12.getBags({bagType:forge.pki.oids.certBag})[forge.pki.oids.certBag]||[],key=keyBags.find(b=>b.key)?.key;
    if(!key?.n)throw new Error('Use um certificado RSA que contenha a chave privada.');
    const certificate=certBags.find(b=>b.cert?.publicKey?.n?.equals(key.n))?.cert;
    if(!certificate)throw new Error('Nenhum certificado corresponde à chave privada.');
    const now=new Date();if(now<certificate.validity.notBefore||now>certificate.validity.notAfter)throw new Error('O certificado está fora do período de validade.');
    return{key,certificate,chain:certBags.map(b=>b.cert).filter(Boolean)};
}
function binaryString(bytes){let value='';for(let at=0;at<bytes.length;at+=8192)value+=String.fromCharCode(...bytes.subarray(at,at+8192));return value;}
export async function signPdf(pdfBytes,pfxBytes,password,lib,forge,{reason='',name=''}={}) {
    const {key,certificate,chain}=certificateIdentity(forge,pfxBytes,password),doc=await lib.PDFDocument.load(pdfBytes);
    for(const field of doc.getForm().getFields())if(field instanceof lib.PDFSignature){const existing=field.acroField.dict.lookup(lib.PDFName.of('V'));if(existing&&existing!==lib.PDFNull)throw new Error('Este PDF já está assinado. Use o modo avançado para preservar as assinaturas anteriores.');}
    const context=doc.context,signature=context.register(context.obj({Type:'Sig',Filter:'Adobe.PPKLite',SubFilter:'adbe.pkcs7.detached',ByteRange:[0,lib.PDFName.of('**********'),lib.PDFName.of('**********'),lib.PDFName.of('**********')],Contents:lib.PDFHexString.of('0'.repeat(32768)),Reason:lib.PDFString.of(reason),Name:lib.PDFString.of(name||certificate.subject.getField('CN')?.value||'Assinante'),M:lib.PDFString.fromDate(new Date())}));
    const widget=context.register(context.obj({Type:'Annot',Subtype:'Widget',FT:'Sig',Rect:[0,0,0,0],T:lib.PDFString.of('AssinaturaDigital_'+Date.now()),V:signature,F:4,P:doc.getPage(0).ref}));
    doc.getPage(0).node.addAnnot(widget);doc.getForm().acroForm.addField(widget);doc.getForm().acroForm.dict.set(lib.PDFName.of('SigFlags'),lib.PDFNumber.of(3));
    const bytes=await doc.save({useObjectStreams:false}),text=binaryString(bytes),rangeMatch=/\/ByteRange\s*\[\s*0\s*\/\*{10}\s*\/\*{10}\s*\/\*{10}\s*\]/.exec(text);
    if(!rangeMatch)throw new Error('Não foi possível reservar o intervalo de assinatura.');
    const signatureStart=text.indexOf('/Contents <'+'0'.repeat(64),rangeMatch.index),start=signatureStart+'/Contents '.length,end=text.indexOf('>',start)+1;
    if(signatureStart<0||end<=start)throw new Error('Reserva de assinatura inválida.');
    const range=`/ByteRange [0 ${start} ${end} ${bytes.length-end}]`;
    if(range.length>rangeMatch[0].length)throw new Error('Intervalo de assinatura muito grande.');
    bytes.set(new TextEncoder().encode(range.padEnd(rangeMatch[0].length)),rangeMatch.index);
    const content=new Uint8Array(start+bytes.length-end);content.set(bytes.subarray(0,start));content.set(bytes.subarray(end),start);
    const p7=forge.pkcs7.createSignedData();p7.content=forge.util.createBuffer(binaryString(content));chain.forEach(cert=>p7.addCertificate(cert));
    p7.addSigner({key,certificate,digestAlgorithm:forge.pki.oids.sha256,authenticatedAttributes:[{type:forge.pki.oids.contentType,value:forge.pki.oids.data},{type:forge.pki.oids.messageDigest},{type:forge.pki.oids.signingTime,value:new Date()}]});p7.sign({detached:true});
    const hex=forge.util.bytesToHex(forge.asn1.toDer(p7.toAsn1()).getBytes());if(hex.length>32768)throw new Error('A cadeia de certificados excede o espaço reservado.');
    bytes.set(new TextEncoder().encode(hex.padEnd(32768,'0')),start+1);
    return bytes;
}
