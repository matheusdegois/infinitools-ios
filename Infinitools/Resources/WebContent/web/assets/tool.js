import {editableGeometry,reconstructTables} from './pdf-geometry.mjs?v=1';
import {StampPreview} from './stamp-preview.mjs?v=1';
import {applyStamps,stampModels} from './pdf-stamps.mjs?v=1';
import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs';
import {VisualPdfWorkspace} from './visual-tools.js?v=10';
import {applyFormFields} from './pdf-form-fields.mjs?v=1';
import {decodeImageFile,encodeCanvas} from './image-formats.mjs?v=3';
import {pdfEngine} from './pdf-engine.mjs?v=3';
import {layoutHtml,wordFromLayout,pptFromLayout,layoutMarkdown,tableRows} from './pdf-conversions.mjs?v=3';
import {ocrWords,ocrLayout,layoutLines} from './pdf-layout.mjs?v=2';

pdfjsLib.GlobalWorkerOptions.workerSrc = './assets/vendor/pdfjs/pdf.worker.min.mjs';

const slug=document.body.dataset.tool;
const input=document.getElementById('fileInput');
const dropZone=document.getElementById('dropZone');
const fileList=document.getElementById('fileList');
const options=document.getElementById('toolOptions');
const processBtn=document.getElementById('processBtn');
const processing=document.getElementById('processing');
const processingTitle=document.getElementById('processingTitle');
const processingText=document.getElementById('processingText');
const progressBar=document.getElementById('progressBar');
const resultCard=document.getElementById('resultCard');
const resultText=document.getElementById('resultText');
const downloadBtn=document.getElementById('downloadBtn');
const workCard=document.querySelector('.work-card');
const visualHost=document.createElement('div');
visualHost.className='visual-host';visualHost.hidden=true;workCard.append(visualHost);
let files=[];
let downloadUrl=null;
let reportUrl=null;
let visualWorkspace=null;
let stampPreview=null;
const stampImageCache=new WeakMap();
const visualModes=new Set(['edit','crop','forms']);
const loadedScripts=new Map();

const contrastOption='<label><input type="checkbox" id="enhanceContrast" checked> Reforçar contraste dos textos cinza</label><p class="tool-note">Escurece textos cinza para facilitar a leitura. Mantém textos coloridos e brancos. Desmarque para preservar os tons originais do PDF.</p>';
const optionTemplates={
    'pdf-powerpoint': contrastOption,
    'pdf-word': contrastOption+'<label><input type="checkbox" id="reuseFonts"> Tenho permissão da licença para reutilizar fontes incorporadas</label><p class="tool-note">Recupera fontes TrueType completas com incorporação permitida. Fontes restritas, subconjuntos e formatos incompatíveis serão substituídos.</p>',
    'pdf-html': '<label><input type="checkbox" id="reuseFonts"> Tenho permissão da licença para reutilizar fontes incorporadas</label><p class="tool-note">Recupera fontes TrueType completas que permitem incorporação. Subconjuntos e fontes sem mapeamento Unicode confiável não são reutilizados. Fontes restritas ou incompatíveis serão substituídas.</p>', 
    stamps: fieldSelect('stampModel','Modelo',[['approved','Aprovado'],['received','Recebido'],['confidential','Confidencial'],['date','Data'],['custom','Texto personalizado'],['image','Imagem personalizada']])+area('stampLabel','Texto do carimbo','APROVADO')+field('stampDate','Data','','','date')+fileField('stampImage','Imagem personalizada','image/*')+fieldSelect('stampPosition','Posição',[['bottom-right','Inferior direita'],['bottom-left','Inferior esquerda'],['bottom-center','Inferior central'],['center','Centro'],['top-left','Superior esquerda'],['top-center','Superior central'],['top-right','Superior direita'],['custom','Personalizada']])+inline(field('stampX','Horizontal (%)','50','','number'),field('stampY','Vertical (%)','50','','number'))+inline(field('stampWidth','Largura (%)','35','','number'),field('stampHeight','Altura (%)','12','','number'))+inline(field('stampOpacity','Opacidade (%)','70','5 a 100.','number'),field('stampColor','Cor','#16834b','','color'))+field('stampPages','Páginas','','Vazio aplica em todas. Ex.: 1, 3-5.')+'<label class="check-option"><input id="stampBorder" type="checkbox" checked> Contorno do carimbo</label>',
    'header-footer': field('headerText','Cabeçalho','')+field('footerText','Rodapé','')+field('stampText','Carimbo de texto','')+field('fontSize','Tamanho do texto','12','','number'),
    'digital-sign': '<div class="certificate-help"><strong>Como funciona</strong><p>Selecione o PDF, escolha seu certificado e informe a senha. A assinatura é feita neste navegador; o certificado e a senha não são enviados ao servidor.</p><p><strong>Aceito:</strong> certificado em arquivo .pfx ou .p12, com chave privada RSA e senha, como um A1 compatível. Até 5 MB.</p><p><strong>A3 em token ou cartão e certificados em nuvem não são compatíveis.</strong> Esta ferramenta não acessa dispositivos ou provedores de assinatura.</p><p>Use um PDF sem assinaturas anteriores. A assinatura não inclui carimbo de tempo nem validação de confiança ou revogação. Confira o resultado em um leitor PDF.</p></div><div class="certificate-picker"><label class="certificate-label" for="certificateFile">Certificado digital</label><input class="certificate-input" id="certificateFile" type="file" accept=".p12,.pfx" aria-describedby="certificateFileName certificateFileHint"><label class="certificate-button" for="certificateFile">Selecionar certificado</label><span id="certificateFileName" role="status">Nenhum certificado selecionado</span><small id="certificateFileHint">PFX ou P12 · até 5 MB · protegido por senha</small></div>'+field('certificatePassword','Senha do certificado','','A senha é usada somente para abrir o certificado neste navegador.','password')+field('signReason','Motivo da assinatura (opcional)',''),
    split: fieldSelect('splitMode','Modo de divisão',[['each','Cada página em um PDF'],['ranges','Intervalos separados']])+field('ranges','Intervalos','1-3; 4-6','Use ponto e vírgula entre arquivos.','text','ranges-field'),
    extract: pageField('Páginas para extrair','Ex.: 1, 3, 5-8'),
    remove: pageField('Páginas para remover','Ex.: 2, 4-6'),
    reorder: pageField('Nova ordem','Ex.: 3, 1, 2, 4-8'),
    organize: pageField('Sequência final','Repita números para duplicar: 1, 1, 3-5'),
    copy: field('pages','Páginas (opcional)','Ex.: 1-3','Vazio copia o documento completo.')+field('copies','Quantidade de cópias','2','De 1 a 20.','number'),
    'pages-per-sheet': fieldSelect('pagesPerSheet','Páginas por folha',[['2','2 páginas'],['4','4 páginas'],['6','6 páginas'],['9','9 páginas']])+fieldSelect('sheetFormat','Formato da folha',[['a4-landscape','A4 paisagem'],['a4-portrait','A4 retrato'],['letter-landscape','Carta paisagem'],['letter-portrait','Carta retrato']]),
    compress: fieldSelect('compressionMode','Modo',[['structural','Otimizar preservando texto, vetores e campos'],['raster','Transformar páginas em imagens (perde texto selecionável)']])+fieldSelect('quality','Qualidade no modo imagem',[['0.55','Compressão máxima'],['0.72','Equilibrada'],['0.88','Alta qualidade']]),
    rasterize: fieldSelect('quality','Qualidade das páginas',[['0.72','Arquivo menor'],['0.88','Equilibrada'],['0.95','Alta qualidade']]),
    ocr: ocrFields(),
    'pdf-word-ocr': ocrFields(),
    'pdf-excel-ocr': ocrFields(),
    'web-pdf': field('url','URL pública (opcional)','https://exemplo.com','Use uma URL ou cole HTML abaixo.','url')+area('html','HTML','<h1>Meu documento</h1>'),
    'text-pdf': area('sourceText','Texto do documento','Digite ou cole o conteúdo que deseja converter.'),
    'markdown-pdf': area('sourceText','Conteúdo Markdown','# Meu documento\n\nEscreva o conteúdo aqui.'),
    'pdf-jpg': fieldSelect('imageOutput','Formato das páginas',[['jpg','JPG'],['jpeg','JPEG'],['png','PNG'],['webp','WebP'],['pdf','PDF de uma página'],['gif','GIF']])+fieldSelect('imageScale','Resolução',[['1.5','Compacta'],['2','Alta qualidade'],['3','Muito alta']]),
    'pdf-png': fieldSelect('imageOutput','Formato das páginas',[['png','PNG'],['jpeg','JPEG'],['jpg','JPG'],['webp','WebP'],['pdf','PDF de uma página'],['gif','GIF']])+fieldSelect('imageScale','Resolução',[['1.5','Compacta'],['2','Alta qualidade'],['3','Muito alta']]),
    'pdf-svg': fieldSelect('imageScale','Resolução interna',[['1.5','Compacta'],['2','Alta qualidade'],['3','Muito alta']]),
    edit: field('editText','Texto a adicionar ou editar','Novo texto','Selecione uma caixa para alterar o conteúdo em tempo real.')+field('signatureText','Texto da assinatura','Assinatura','Usado pela ferramenta Assinatura.')+inline(field('fontSize','Tamanho','18','','number'),field('color','Cor','#000000','A amostra mostra a cor atual.','color'))+fileField('overlayImage','Imagem para posicionar','image/png,image/jpeg'),
    'page-numbers': inline(field('startNumber','Primeiro número','1','','number'),field('fontSize','Tamanho','12','','number'))+fieldSelect('position','Posição',[['bottom-center','Rodapé central'],['bottom-left','Rodapé à esquerda'],['bottom-right','Rodapé à direita'],['top-center','Topo central'],['top-left','Topo à esquerda'],['top-right','Topo à direita']]),
    watermark: fieldSelect('watermarkType','Tipo de marca-d’água',[['text','Texto'],['image','Imagem']])+`<div class="watermark-text-fields">${field('watermark','Texto da marca-d’água','INFINITOOLS')}${field('fontSize','Tamanho do texto','46','','number')}</div><div class="watermark-image-fields" hidden>${fileField('watermarkImage','Imagem da marca-d’água','image/png,image/jpeg')}${field('watermarkImageSize','Largura da imagem (%)','30','Percentual da largura da página, de 5% a 95%.','number')}</div>`+field('opacity','Opacidade','0.18','Entre 0.05 e 1.','number')+fieldSelect('position','Posição (opcional)',[['center','Centro (padrão)'],['top-left','Topo à esquerda'],['top-center','Topo central'],['top-right','Topo à direita'],['bottom-left','Rodapé à esquerda'],['bottom-center','Rodapé central'],['bottom-right','Rodapé à direita']]),
    rotate: fieldSelect('degrees','Rotação',[['90','90° à direita'],['180','180°'],['270','90° à esquerda']])+field('pages','Páginas (opcional)','Ex.: 1, 3-5','Vazio gira todas.'),
    crop: inline(field('horizontal','Margem horizontal (pt)','20','','number'),field('vertical','Margem vertical (pt)','20','','number')),
    forms: fieldSelect('fieldType','Criar campo',[['text','Campo de texto'],['checkbox','Caixa de seleção'],['radio','Botão de opção'],['dropdown','Lista suspensa'],['list','Lista múltipla'],['signature','Campo de assinatura']])+fieldSelect('fieldPicker','Selecionar campo existente',[['','Selecione um campo']])+field('fieldName','Nome do campo / grupo','campo','Selecione um campo para renomear. Novos radios com o mesmo nome pertencem ao mesmo grupo.')+field('fieldExportValue','Valor da opção de radio','Opção 1','Cada botão do grupo deve ter um valor diferente.')+area('fieldCurrentValue','Valor atual','')+area('fieldDefaultValue','Valor padrão','')+'<p>Nas listas múltiplas, informe um valor por linha. As opções existentes são preservadas.</p><label class="check-option"><input id="fieldRequired" type="checkbox"> Obrigatório</label><label class="check-option"><input id="fieldReadOnly" type="checkbox"> Somente leitura</label><label class="check-option"><input id="fieldMultiselect" type="checkbox"> Permitir múltiplos valores na lista</label>'+field('fieldMaxLength','Tamanho máximo de texto','0','0 = sem limite.','number')+fieldSelect('fieldFont','Fonte',[['Helvetica','Helvetica'],['Courier','Courier'],['TimesRoman','Times']])+field('fieldFontSize','Tamanho da fonte','12','4 a 150. A fonte original é mantida até alterar a aparência.','number')+field('fieldTextColor','Cor do texto','#000000','','color')+field('fieldBorderColor','Cor da borda','#000000','','color')+field('fieldBackgroundColor','Cor de fundo','#ffffff','','color')+field('fieldBorderWidth','Espessura da borda','1','0 = sem borda.','number')+'<p>Os widgets do mesmo campo compartilham nome, valor e propriedades. Um campo vazio de assinatura não constitui assinatura digital. XFA requer conversão própria; PDFs já assinados não serão alterados.</p>',
    overlay: field('opacity','Opacidade da sobreposição','1','Entre 0.05 e 1.','number')+fieldSelect('overlayMode','Aplicação',[['repeat','Repetir a última página da sobreposição'],['matching','Sobrepor somente páginas correspondentes']]),
    'resize-page': fieldSelect('pageFormat','Novo tamanho',[['a4','A4'],['a3','A3'],['letter','Carta'],['legal','Ofício'],['custom','Personalizado']])+fieldSelect('orientation','Orientação',[['portrait','Retrato'],['landscape','Paisagem']])+inline(field('customWidth','Largura personalizada (pt)','595','','number'),field('customHeight','Altura personalizada (pt)','842','','number'))+fieldSelect('fitMode','Ajuste do conteúdo',[['contain','Conter sem cortar'],['cover','Preencher e cortar excedentes'],['stretch','Esticar até as bordas']]),
    metadata: field('metaTitle','Título','','','text')+field('metaAuthor','Autor','','','text')+field('metaSubject','Assunto','','','text')+field('metaKeywords','Palavras-chave','pdf, documento','Separe por vírgulas.'),
    'compare-pdf': fieldSelect('compareTolerance','Sensibilidade',[['18','Alta — detecta pequenas alterações'],['36','Equilibrada'],['64','Baixa — ignora pequenas variações']]),
    'viewer-preferences': fieldSelect('pageLayout','Layout das páginas',[['SinglePage','Página única'],['OneColumn','Uma coluna'],['TwoColumnLeft','Duas colunas — ímpares à esquerda'],['TwoColumnRight','Duas colunas — ímpares à direita'],['TwoPageLeft','Duas páginas — ímpares à esquerda'],['TwoPageRight','Duas páginas — ímpares à direita']])+fieldSelect('pageMode','Painel inicial',[['UseNone','Sem painel'],['UseOutlines','Marcadores'],['UseThumbs','Miniaturas'],['FullScreen','Tela cheia']])+fieldSelect('readingDirection','Direção de leitura',[['L2R','Esquerda para direita'],['R2L','Direita para esquerda']])+fieldSelect('duplex','Impressão frente e verso',[['Simplex','Desativada'],['DuplexFlipLongEdge','Virar na borda longa'],['DuplexFlipShortEdge','Virar na borda curta']])+fieldSelect('printScaling','Escala de impressão',[['AppDefault','Padrão do leitor'],['None','Sem escala automática']])+`<div class="check-grid"><label class="check-option"><input id="displayTitle" type="checkbox" checked> Exibir título</label><label class="check-option"><input id="fitWindow" type="checkbox"> Ajustar janela</label><label class="check-option"><input id="centerWindow" type="checkbox"> Centralizar janela</label><label class="check-option"><input id="hideToolbar" type="checkbox"> Ocultar ferramentas</label><label class="check-option"><input id="hideMenubar" type="checkbox"> Ocultar menu</label><label class="check-option"><input id="hideWindowUI" type="checkbox"> Ocultar interface</label></div>`,
    protect: field('password','Senha de abertura','','Use pelo menos 4 caracteres.','password')+field('ownerPassword','Senha de administração','','Diferente da senha de abertura para aplicar restrições.','password')+`<div class="check-grid">${[['print','Permitir impressão'],['edit','Permitir edição'],['copy','Permitir cópia'],['annotate','Permitir comentários'],['form','Permitir preenchimento'],['assemble','Permitir reorganização'],['print-hq','Permitir impressão de alta qualidade']].map(([key,label])=>`<label class="check-option"><input type="checkbox" data-permission="${key}" checked>${label}</label>`).join('')}</div>`,
    unlock: field('password','Senha atual do PDF','','A senha é usada apenas no navegador.','password'),
    'remove-metadata': '<label class="check-option"><input type="checkbox" id="removePrivateData" checked> Metadados e dados privados conhecidos</label><label class="check-option"><input type="checkbox" id="removeComments"> Comentários e anotações de revisão</label><label class="check-option"><input type="checkbox" id="removeActions"> Todas as ações (inclui navegação e envio de formulários)</label><label class="check-option"><input type="checkbox" id="removeJavascript"> JavaScript</label><label class="check-option"><input type="checkbox" id="removeAttachments"> Anexos e arquivos associados</label><p>Preserva páginas e campos interativos. Apagar metadados não elimina dados pessoais escritos nas páginas ou nos valores dos campos. Rasuras pendentes removidas não são aplicadas. PDFs XFA precisam de conversão própria; documentos assinados são recusados.</p>',
};
options.innerHTML=optionTemplates[slug] || '<div class="field"><span>Configuração automática</span><small>Selecione o arquivo e clique em processar.</small></div>';
if(slug==='digital-sign'){
    const input=document.getElementById('certificateFile'),name=document.getElementById('certificateFileName');
    input.addEventListener('change',()=>{name.textContent=input.files[0]?.name||'Nenhum certificado selecionado';});
}
if(['forms','remove-metadata'].includes(slug)){
    const invalidate=()=>{resultCard.hidden=true;revokeDownload();};options.addEventListener('input',invalidate);options.addEventListener('change',invalidate);visualHost.addEventListener('input',invalidate);visualHost.addEventListener('change',invalidate);visualHost.addEventListener('pointerdown',invalidate);
}
if(slug==='stamps'){
    const model=document.getElementById('stampModel'),date=document.getElementById('stampDate'),label=document.getElementById('stampLabel');
    const today=new Date();date.value=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
    stampPreview=new StampPreview({host:workCard,options,pdfjs:pdfjsLib,loadLibrary:pdfLib,getSettings:readStampSettings});
    const invalidateStampResult=()=>{resultCard.hidden=true;};options.addEventListener('input',invalidateStampResult);options.addEventListener('change',invalidateStampResult);
    const sync=()=>{const selected=stampModels[model.value];label.value=model.value==='date'?date.value.split('-').reverse().join('/'):selected.text;document.getElementById('stampColor').value=selected.color;label.closest('.field').hidden=model.value==='image';date.closest('.field').hidden=model.value!=='date';document.getElementById('stampImage').closest('.field').hidden=model.value!=='image';};model.addEventListener('change',sync);date.addEventListener('change',sync);sync();
}
if(slug==='split') {
    const rangesField=document.querySelector('.ranges-field');
    rangesField.hidden=true;
    document.getElementById('splitMode')?.addEventListener('change',e=>rangesField.hidden=e.target.value!=='ranges');
}
if(slug==='watermark'){
    const type=document.getElementById('watermarkType'),textFields=options.querySelector('.watermark-text-fields'),imageFields=options.querySelector('.watermark-image-fields'),sync=()=>{const image=type.value==='image';textFields.hidden=image;imageFields.hidden=!image};type.addEventListener('change',sync);sync();
}
if(['web-pdf','text-pdf','markdown-pdf'].includes(slug)) dropZone.querySelector('strong').textContent='Selecionar arquivo (opcional)';

input.addEventListener('change',()=>addFiles([...input.files]));
['dragenter','dragover'].forEach(type=>dropZone.addEventListener(type,e=>{e.preventDefault();dropZone.classList.add('dragover')}));
['dragleave','drop'].forEach(type=>dropZone.addEventListener(type,e=>{e.preventDefault();dropZone.classList.remove('dragover')}));
dropZone.addEventListener('drop',e=>addFiles([...e.dataTransfer.files]));
processBtn.addEventListener('click',run);
window.addEventListener('beforeunload',revokeDownload);

function field(id,label,placeholder='',help='',type='text',className='') {const preset=(type==='number'||type==='color')&&placeholder!==''?`value="${escapeHtml(placeholder)}"`:'';return `<div class="field ${className}"><label for="${id}">${label}</label><input id="${id}" type="${type}" placeholder="${escapeHtml(placeholder)}" ${preset} ${type==='number'?'step="any"':''}>${help?`<small>${help}</small>`:''}</div>`}
function fileField(id,label,accept){return `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="file" accept="${accept}"></div>`}
function area(id,label,placeholder=''){return `<div class="field"><label for="${id}">${label}</label><textarea id="${id}" placeholder="${escapeHtml(placeholder)}"></textarea></div>`}
function fieldSelect(id,label,items){return `<div class="field"><label for="${id}">${label}</label><select id="${id}">${items.map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></div>`}
function pageField(label,placeholder){return field('pages',label,placeholder,'Use números e intervalos separados por vírgula.')}
function inline(a,b){return `<div class="inline-fields">${a}${b}</div>`}
function ocrFields(){return fieldSelect('language','Idioma do texto',[['por','Português'],['eng','Inglês'],['por+eng','Português + Inglês'],['spa','Espanhol'],['fra','Francês'],['deu','Alemão'],['ita','Italiano']])}
function escapeHtml(value){return String(value).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function value(id,fallback=''){const el=document.getElementById(id);return el&&el.value!==''?el.value:fallback}
function checked(id){return Boolean(document.getElementById(id)?.checked)}

async function addFiles(newFiles){
    if(!input.multiple) files=newFiles.slice(0,1); else files=[...files,...newFiles].slice(0,100);
    renderFiles(); resultCard.hidden=true;
    if(visualModes.has(slug))await loadVisualWorkspace();
}
function renderFiles(){

    stampPreview?.loadFile(files[0]||null);
    fileList.innerHTML=files.map((file,i)=>`<div class="file-row"><span class="mini-file">${escapeHtml((file.name.split('.').pop()||'FILE').slice(0,5).toUpperCase())}</span><span><strong>${escapeHtml(file.name)}</strong><small>${formatBytes(file.size)}</small></span><button type="button" data-remove="${i}" aria-label="Remover">×</button></div>`).join('');
    fileList.querySelectorAll('[data-remove]').forEach(btn=>btn.addEventListener('click',async()=>{files.splice(Number(btn.dataset.remove),1);renderFiles();if(visualModes.has(slug))await loadVisualWorkspace()}));
}

async function loadVisualWorkspace(){
    visualWorkspace?.destroy();visualWorkspace=null;
    if(!files[0])return;
    processBtn.disabled=true;showProgress('Abrindo o PDF...','Preparando a visualização interativa.',15);
    try{visualWorkspace=new VisualPdfWorkspace(slug,visualHost,options);await visualWorkspace.load(files[0]);hideProgress();visualHost.scrollIntoView({behavior:'smooth',block:'start'})}
    catch(error){console.error(error);hideProgress();files=[];renderFiles();visualWorkspace?.destroy();alert(error.message||'Não foi possível abrir este PDF para edição visual.')}
    finally{processBtn.disabled=false}
}

async function run(){
    if(!files.length && !['web-pdf','text-pdf','markdown-pdf'].includes(slug)){alert('Selecione pelo menos um arquivo.');return}
    processBtn.disabled=true;resultCard.hidden=true;showProgress('Processando...','Preparando os arquivos.',3);
    try{
        let result;
        switch(slug){
            case'stamps':result=await stampPdf();break;
            case'header-footer':result=await addHeaderFooter();break;
            case'digital-sign':result=await digitalSignPdf();break;
            case'merge':result=await mergePdfs();break;
            case'split':result=await splitPdf();break;
            case'extract':result=await selectPages('extract');break;
            case'remove':result=await selectPages('remove');break;
            case'reorder':case'organize':result=await selectPages('order');break;
            case'copy':result=await copyPdf();break;
            case'pages-per-sheet':result=await pagesPerSheet();break;
            case'scan':case'image-pdf':case'jpg-pdf':case'png-pdf':case'webp-pdf':case'svg-pdf':result=await imagesToPdf();break;
            case'compress':result=value('compressionMode')==='raster'?await rasterOperation({quality:Number(value('quality','.72')),scale:1.25,suffix:'_comprimido'}):await structuralOperation('compress');break;
            case'repair':result=await repairPdf();break;
            case'ocr':result=await ocrToSearchablePdf();break;
            case'flatten':result=await flattenPdf();break;
            case'rasterize':result=await rasterOperation({quality:Number(value('quality','.88')),scale:2,suffix:'_rasterizado'});break;
            case'office-pdf':case'word-pdf':case'powerpoint-pdf':case'excel-pdf':result=await officeToPdf();break;
            case'web-pdf':result=await webToPdf();break;
            case'text-pdf':result=await textToPdf(false);break;
            case'markdown-pdf':result=await textToPdf(true);break;
            case'rtf-pdf':result=await rtfToPdf();break;
            case'epub-pdf':result=await epubToPdf();break;
            case'pdf-word':result=await pdfToWord(false);break;
            case'pdf-word-ocr':result=await pdfToWord(true);break;
            case'pdf-powerpoint':result=await pdfToPowerPoint();break;
            case'pdf-excel':result=await pdfToExcel(false);break;
            case'pdf-excel-ocr':result=await pdfToExcel(true);break;
            case'pdf-jpg':result=await pdfToJpg();break;
            case'pdf-png':result=await pdfToPng();break;
            case'pdf-svg':result=await pdfToSvg();break;
            case'pdf-text':result=await pdfToText();break;
            case'pdf-html':result=await pdfToHtml();break;
            case'pdf-rtf':result=await pdfToRtf();break;
            case'pdf-epub':result=await pdfToEpub();break;
            case'pdf-pdfa':result=await validatedPdfa();break;
            case'pdf-markdown':result=await pdfToMarkdown();break;
            case'edit':result=await editPdf();break;
            case'page-numbers':result=await addPageNumbers();break;
            case'watermark':result=await addWatermark();break;
            case'rotate':result=await rotatePdf();break;
            case'crop':result=await cropPdf();break;
            case'forms':result=await addFormField();break;
            case'overlay':result=await overlayPdfs();break;
            case'resize-page':result=await resizePages();break;
            case'metadata':result=await editMetadata();break;
            case'remove-metadata':result=await cleanPdfSelected();break;
            case'compare-pdf':result=await comparePdfs();break;
            case'viewer-preferences':result=await setViewerPreferences();break;
            case'protect':result=await structuralOperation('protect',{password:value('password'),ownerPassword:value('ownerPassword'),permissions:Object.fromEntries([...options.querySelectorAll('[data-permission]')].map(el=>[el.dataset.permission,el.checked]))});break;
            case'unlock':result=await structuralOperation('unlock',{openPassword:value('password')});break;
            default:throw new Error('Ferramenta ainda não configurada.');
        }
        if(!result)throw new Error('Nenhum resultado foi gerado.');
        presentResult(result.blob,result.name,result.message);
        if(result.report)presentCleanupReport(result.report);
        if(result.signatureReport)presentSignatureReport(result.signatureReport);
    }catch(error){console.error(error);hideProgress();alert(error?.message||'Não foi possível processar o arquivo.')}finally{processBtn.disabled=false}
}

async function loadScript(path,globalName){
    if(globalName&&window[globalName])return window[globalName];
    if(!loadedScripts.has(path)) loadedScripts.set(path,new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=path;s.onload=resolve;s.onerror=()=>reject(new Error(`Falha ao carregar ${path}`));document.head.appendChild(s)}));
    await loadedScripts.get(path);return globalName?window[globalName]:true;
}
async function pdfLib(){await loadScript('assets/vendor/pdf-lib.min.js','PDFLib');return window.PDFLib}
async function structuralOperation(operation,settings={}){
    setProgress(20,'Processando a estrutura do PDF no navegador...');
    const bytes=await pdfEngine(files[0],operation,settings),suffix={compress:'_otimizado',protect:'_protegido',unlock:'_desbloqueado','remove-metadata':'_sem_metadados'}[operation];
    const message=operation==='compress'?`PDF otimizado preservando conteúdo. ${bytes.length<files[0].size?'O tamanho foi reduzido.':'O arquivo já estava otimizado; não houve redução de tamanho.'}`:'PDF processado sem transformar as páginas em imagens.';
    return {blob:new Blob([bytes],{type:'application/pdf'}),name:baseName(files[0].name)+suffix+'.pdf',message};
}
async function cleanPdfSelected(){
    const {bytes,report}=await pdfEngine(files[0],'cleanup',{privateData:checked('removePrivateData'),comments:checked('removeComments'),actions:checked('removeActions'),javascript:checked('removeJavascript'),attachments:checked('removeAttachments')});
    // PDF.js is an independent reader from the MuPDF writer. Check every page
    // and annotation without executing document JavaScript or external actions.
    const reader=await pdfjsLib.getDocument({data:bytes.slice(),isEvalSupported:false}).promise;
    try{
        if(reader.numPages!==report.pages)throw new Error('Falha de verificação: quantidade de páginas alterada.');
        const commentTypes=['Text','FreeText','Line','Square','Circle','Polygon','PolyLine','Highlight','Underline','Squiggly','StrikeOut','Stamp','Caret','Ink','Popup','Redact'];
        for(let i=1;i<=reader.numPages;i++){const page=await reader.getPage(i);await page.getTextContent();const annotations=await page.getAnnotations();if(report.selected.comments&&annotations.some(a=>commentTypes.includes(a.subtype)))throw new Error('Falha de verificação: comentário ainda presente.');if(report.selected.attachments&&annotations.some(a=>a.subtype==='FileAttachment'))throw new Error('Falha de verificação: anotação de anexo ainda presente.');if((report.selected.javascript||report.selected.actions)&&await page.getJSActions())throw new Error('Falha de verificação: JavaScript de página ainda presente.');}
        if(report.selected.attachments&&await reader.getAttachments())throw new Error('Falha de verificação: anexos ainda presentes.');
        if(report.selected.privateData){const metadata=await reader.getMetadata();if(metadata.metadata||['Author','Title','Subject','Keywords','Creator','Producer','CreationDate','ModDate'].some(key=>metadata.info?.[key]))throw new Error('Falha de verificação: metadados descritivos ainda presentes.');}
        if((report.selected.javascript||report.selected.actions)&&await reader.getJSActions())throw new Error('Falha de verificação: JavaScript de documento ainda presente.');
        const fields=await reader.getFieldObjects();if(report.selected.javascript||report.selected.actions)for(const widgets of Object.values(fields||{}))if(widgets.some(w=>w.actions&&Object.values(w.actions).some(a=>a?.length)))throw new Error('Falha de verificação: JavaScript de campo ainda presente.');
        report.verification={reader:'PDF.js',pages:reader.numPages,status:'Páginas, texto, anotações e campos reabertos. Categorias selecionadas verificadas pelas APIs disponíveis no leitor. Não certifica anonimização.'};
    }finally{await reader.destroy();}
    return{blob:new Blob([bytes],{type:'application/pdf'}),name:baseName(files[0].name)+'_limpo.pdf',message:'Limpeza seletiva concluída e PDF reaberto com PDF.js. Consulte o relatório.',report};
}
function presentCleanupReport(report){
    const details=document.createElement('details');details.id='cleanupReport';const summary=document.createElement('summary');summary.textContent='Relatório de limpeza';const pre=document.createElement('pre');pre.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';pre.textContent=JSON.stringify(report,null,2);const link=document.createElement('a');link.id='cleanupReportDownload';link.textContent='Baixar relatório JSON';link.className='btn btn-secondary';reportUrl=URL.createObjectURL(new Blob([pre.textContent],{type:'application/json'}));link.href=reportUrl;link.download=baseName(files[0].name)+'_relatorio_limpeza.json';details.append(summary,pre,link);resultCard.append(details);
}
function presentSignatureReport(report){
    const details=document.createElement('details');details.id='signatureReport';const title=document.createElement('summary');title.textContent='Relatório de integridade, confiança e revogação';const pre=document.createElement('pre');pre.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';pre.textContent=JSON.stringify(report,null,2);const link=document.createElement('a');link.textContent='Baixar relatório JSON';link.className='btn btn-secondary';reportUrl=URL.createObjectURL(new Blob([pre.textContent],{type:'application/json'}));link.href=reportUrl;link.download='validacao-assinaturas.json';details.append(title,pre,link);resultCard.append(details);
}
async function digitalSignPdf(){

    const certificate=document.getElementById('certificateFile')?.files?.[0];if(!certificate||certificate.size>5*1024*1024)throw new Error('Selecione um certificado P12/PFX de até 5 MB.');
    await loadScript('assets/vendor/forge/package/dist/forge.min.js','forge');const {signPdf}=await import('./pdf-signature.mjs?v=2'),lib=await pdfLib();
    setProgress(35,'Assinando com o certificado local...');const bytes=await signPdf(new Uint8Array(await files[0].arrayBuffer()),new Uint8Array(await certificate.arrayBuffer()),value('certificatePassword'),lib,forge,{reason:value('signReason')});
    document.getElementById('certificatePassword').value='';
    return{blob:new Blob([bytes],{type:'application/pdf'}),name:baseName(files[0].name)+'_assinado.pdf',message:'Assinatura criptográfica criada. Confira a integridade e a confiança do certificado em um leitor PDF.'};
}
async function validatedPdfa(){
    const status=await fetch('api/pdfa.php');const capability=await status.json();if(!capability.available)throw new Error('A conversão para PDF/A validado ainda não está disponível neste servidor.');
    setProgress(30,'Gerando e validando PDF/A-2b no servidor...');const form=new FormData();form.append('file',files[0]);const response=await fetch('api/pdfa.php',{method:'POST',body:form});
    if(!response.ok){const error=await response.json();throw new Error(error.message||'Falha ao validar PDF/A.');}if(response.headers.get('X-PDFA-Validated')!=='veraPDF')throw new Error('O servidor não confirmou a validação PDF/A.');
    return{blob:await response.blob(),name:baseName(files[0].name)+'_pdfa2b.pdf',message:'PDF/A-2b gerado e aprovado pelo veraPDF. A conversão pode alterar assinaturas e recursos interativos.'};
}
async function readStampSettings(){
    let imageBytes;
    if(value('stampModel')==='image'){
        const file=document.getElementById('stampImage').files[0];if(!file)throw new Error('Selecione a imagem do carimbo.');
        if(!stampImageCache.has(file))stampImageCache.set(file,(async()=>{const image=await decodeImageFile(file);try{return new Uint8Array(await(await encodeCanvas(image,'png')).blob.arrayBuffer());}finally{image.width=image.height=1;}})());
        imageBytes=await stampImageCache.get(file);
    }
    return {model:value('stampModel'),text:value('stampLabel'),color:value('stampColor'),position:value('stampPosition'),widthPercent:num('stampWidth',35),heightPercent:num('stampHeight',12),x:num('stampX',50),y:num('stampY',50),opacity:num('stampOpacity',70)/100,pages:value('stampPages'),border:document.getElementById('stampBorder').checked,imageBytes};
}
async function stampPdf(){
    const lib=await pdfLib(),doc=await openPdfLib(files[0]),count=await applyStamps(doc,lib,await readStampSettings());
    return savePdf(doc,baseName(files[0].name)+'_carimbado.pdf','Carimbo aplicado em '+count+' página(s).');
}
async function addHeaderFooter(){
    const lib=await pdfLib(),doc=await openPdfLib(files[0]),font=await doc.embedFont(lib.StandardFonts.Helvetica),size=clamp(num('fontSize',12),6,72),header=safePdfText(value('headerText')),footer=safePdfText(value('footerText')),stamp=safePdfText(value('stampText'));
    if(!header&&!footer&&!stamp)throw new Error('Informe um cabeçalho, rodapé ou carimbo.');
    for(const page of doc.getPages()){if(header)page.drawText(header,{x:28,y:page.getHeight()-size-20,size,font,maxWidth:page.getWidth()-56});if(footer)page.drawText(footer,{x:28,y:20,size,font,maxWidth:page.getWidth()-56});if(stamp)page.drawText(stamp,{x:Math.max(20,(page.getWidth()-font.widthOfTextAtSize(stamp,size))/2),y:page.getHeight()/2,size,font,color:lib.rgb(.75,.1,.1),opacity:.6,maxWidth:page.getWidth()-40});}
    return savePdf(doc,baseName(files[0].name)+'_cabecalho_rodape.pdf','Cabeçalho, rodapé e carimbo aplicados às páginas.');
}
async function jszip(){await loadScript('assets/vendor/jszip.min.js','JSZip');return window.JSZip}
async function openPdfLib(file){const lib=await pdfLib();return lib.PDFDocument.load(await file.arrayBuffer(),{ignoreEncryption:true,updateMetadata:false})}
async function savePdf(doc,name,message){const bytes=await doc.save({useObjectStreams:true,addDefaultPage:false});return{blob:new Blob([bytes],{type:'application/pdf'}),name,message}}

async function mergePdfs(){
    if(files.length<2)throw new Error('Selecione pelo menos dois PDFs.');
    const {PDFDocument}=await pdfLib(),out=await PDFDocument.create();
    for(let i=0;i<files.length;i++){setProgress(10+(i/files.length)*75,`Adicionando ${files[i].name}...`);const src=await openPdfLib(files[i]);const pages=await out.copyPages(src,src.getPageIndices());pages.forEach(p=>out.addPage(p))}
    return savePdf(out,'documentos_unidos.pdf','Os PDFs foram unidos na ordem apresentada.');
}
async function splitPdf(){
    const {PDFDocument}=await pdfLib(),Zip=await jszip(),src=await openPdfLib(files[0]),total=src.getPageCount(),zip=new Zip();
    let groups=[];
    if(value('splitMode','each')==='each')groups=Array.from({length:total},(_,i)=>[i]);
    else groups=value('ranges').split(';').map(s=>parsePages(s,total,false)).filter(a=>a.length);
    if(!groups.length)throw new Error('Informe ao menos um intervalo válido.');
    for(let i=0;i<groups.length;i++){setProgress(10+(i/groups.length)*80,`Criando parte ${i+1} de ${groups.length}...`);const part=await PDFDocument.create();(await part.copyPages(src,groups[i])).forEach(p=>part.addPage(p));zip.file(`parte-${String(i+1).padStart(2,'0')}.pdf`,await part.save())}
    return{blob:await zip.generateAsync({type:'blob'}),'name':baseName(files[0].name)+'_dividido.zip',message:`${groups.length} arquivos PDF foram criados.`};
}
async function selectPages(mode){
    const src=await openPdfLib(files[0]),total=src.getPageCount();let indexes;
    if(mode==='remove'){const removed=new Set(parsePages(value('pages'),total,false));indexes=src.getPageIndices().filter(i=>!removed.has(i));if(!indexes.length)throw new Error('Não é possível remover todas as páginas.')}
    else indexes=parsePages(value('pages'),total,mode==='order');
    if(!indexes.length)throw new Error('Informe páginas válidas.');
    const {PDFDocument}=await pdfLib(),out=await PDFDocument.create();(await out.copyPages(src,indexes)).forEach(p=>out.addPage(p));
    const suffix=mode==='remove'?'_paginas_removidas':mode==='order'?'_organizado':'_paginas_extraidas';return savePdf(out,baseName(files[0].name)+suffix+'.pdf','O novo documento foi criado.');
}
async function copyPdf(){
    const src=await openPdfLib(files[0]),total=src.getPageCount(),selection=value('pages')?parsePages(value('pages'),total,true):src.getPageIndices(),copies=Math.max(1,Math.min(20,parseInt(value('copies','2'),10)||2));
    const {PDFDocument}=await pdfLib(),out=await PDFDocument.create();
    for(let c=0;c<copies;c++){(await out.copyPages(src,selection)).forEach(p=>out.addPage(p));setProgress(15+(c/copies)*75,`Criando cópia ${c+1} de ${copies}...`)}
    return savePdf(out,baseName(files[0].name)+'_copiado.pdf',`${copies} cópias foram adicionadas.`);
}
async function pagesPerSheet(){
    const lib=await pdfLib(),src=await openPdfLib(files[0]),out=await lib.PDFDocument.create(),count=Number(value('pagesPerSheet','4')),format=value('sheetFormat','a4-landscape');
    ensurePageContent(src);
    let [sheetW,sheetH]=format.startsWith('letter')?[612,792]:[595.28,841.89];
    if(format.endsWith('landscape'))[sheetW,sheetH]=[sheetH,sheetW];
    let cols=2,rows=2;if(count===2){cols=sheetW>sheetH?2:1;rows=sheetW>sheetH?1:2}else if(count===6){cols=sheetW>sheetH?3:2;rows=sheetW>sheetH?2:3}else if(count===9){cols=3;rows=3}
    const embedded=[];for(const page of src.getPages())embedded.push(await out.embedPage(page));
    const margin=18,gap=10,cellW=(sheetW-margin*2-gap*(cols-1))/cols,cellH=(sheetH-margin*2-gap*(rows-1))/rows;
    for(let start=0;start<embedded.length;start+=count){const sheet=out.addPage([sheetW,sheetH]);for(let slot=0;slot<count&&start+slot<embedded.length;slot++){const item=embedded[start+slot],scale=Math.min(cellW/item.width,cellH/item.height),w=item.width*scale,h=item.height*scale,col=slot%cols,row=Math.floor(slot/cols),x=margin+col*(cellW+gap)+(cellW-w)/2,y=sheetH-margin-(row+1)*cellH-row*gap+(cellH-h)/2;sheet.drawPage(item,{x,y,width:w,height:h})}setProgress(15+Math.min(75,((start+count)/embedded.length)*75),'Montando as folhas...')}
    return savePdf(out,baseName(files[0].name)+`_${count}_por_folha.pdf`,`${count} páginas foram organizadas por folha.`);
}
async function imagesToPdf(){
    const {PDFDocument}=await pdfLib(),out=await PDFDocument.create();
    for(let i=0;i<files.length;i++){const file=files[i],bytes=await file.arrayBuffer();let img;if(file.type==='image/png')img=await out.embedPng(bytes);else if(file.type==='image/jpeg'||/\.jpe?g$/i.test(file.name))img=await out.embedJpg(bytes);else{const converted=await imageFileToJpeg(file,.95);img=await out.embedJpg(await converted.arrayBuffer())}const maxW=595,maxH=842,scale=Math.min(maxW/img.width,maxH/img.height,1),w=img.width*scale,h=img.height*scale,page=out.addPage([Math.max(w,200),Math.max(h,200)]);page.drawImage(img,{x:(page.getWidth()-w)/2,y:(page.getHeight()-h)/2,width:w,height:h});setProgress(10+((i+1)/files.length)*75,`Adicionando imagem ${i+1}...`)}
    return savePdf(out,'imagens_convertidas.pdf','As imagens foram convertidas em PDF.');
}
async function repairPdf(){const doc=await openPdfLib(files[0]);doc.setProducer('infinitools');return savePdf(doc,baseName(files[0].name)+'_reparado.pdf','A estrutura do PDF foi regravada.');}
async function flattenPdf(){const doc=await openPdfLib(files[0]),form=doc.getForm(),total=form.getFields().length;if(total)form.flatten();return savePdf(doc,baseName(files[0].name)+'_achatado.pdf',total?`${total} campo(s) foram fixados no documento.`:'O PDF foi regravado; nenhum campo interativo foi encontrado.');}

async function rasterOperation(opts){
    const rendered=await renderPdf(files[0],{scale:opts.scale||1.5,quality:opts.quality||.9,password:opts.openPassword||''});
    const form=new FormData(),metadata={pages:[]};rendered.forEach((p,i)=>{form.append('pages[]',p.blob,`pagina-${i+1}.jpg`);metadata.pages.push({widthPt:p.widthPt,heightPt:p.heightPt})});form.append('metadata',JSON.stringify(metadata));form.append('originalName',files[0].name);form.append('suffix',opts.suffix||'_processado');if(opts.pdfa)form.append('pdfa','1');if(opts.password)form.append('password',opts.password);
    setProgress(88,'Montando o PDF final...');const response=await fetch('api/raster-pdf.php',{method:'POST',body:form});const blob=await responseBlob(response);return{blob,name:filenameFromResponse(response,baseName(files[0].name)+(opts.suffix||'_processado')+'.pdf'),message:'O PDF final foi criado com sucesso.'};
}

async function officeToPdf(){
    const file=files[0],ext=file.name.split('.').pop().toLowerCase();let html='';
    if(ext==='docx'){await loadScript('assets/vendor/mammoth.browser.min.js','mammoth');setProgress(30,'Lendo o documento Word...');const result=await mammoth.convertToHtml({arrayBuffer:await file.arrayBuffer()});html=result.value}
    else if(ext==='xlsx'||ext==='xls'){await loadScript('assets/vendor/xlsx.full.min.js','XLSX');setProgress(30,'Lendo a planilha...');const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});html=wb.SheetNames.map(n=>`<h1>${escapeHtml(n)}</h1>${XLSX.utils.sheet_to_html(wb.Sheets[n])}<div class="page-break"></div>`).join('')}
    else if(ext==='pptx')return powerPointToPdf(file);else throw new Error('Formato Office não suportado. Use DOCX, XLSX, XLS ou PPTX.');
    return postHtml(html,baseName(file.name));
}
async function powerPointToPdf(file){
    await jszip();
    await loadScript('assets/vendor/pptx-preview.umd.js','pptxPreview');
    await loadScript('assets/vendor/html2canvas.min.js','html2canvas');
    if(!window.pptxPreview?.init||!window.html2canvas)throw new Error('O renderizador visual do PowerPoint não pôde ser carregado.');
    const shell=document.createElement('div');shell.className='pptx-render-shell';document.body.append(shell);
    try{
        setProgress(16,'Interpretando slides, imagens e estilos...');
        const viewer=window.pptxPreview.init(shell,{width:960,height:540});
        await viewer.preview(await file.arrayBuffer());
        if(document.fonts?.ready)await document.fonts.ready;
        await new Promise(resolve=>setTimeout(resolve,350));
        const slides=[...shell.querySelectorAll('.pptx-preview-slide-wrapper')];
        if(!slides.length)throw new Error('Nenhum slide foi encontrado neste PowerPoint.');
        const rendered=[];
        for(let i=0;i<slides.length;i++){
            setProgress(25+(i/slides.length)*58,`Renderizando slide ${i+1} de ${slides.length}...`);
            const canvas=await window.html2canvas(slides[i],{backgroundColor:'#ffffff',scale:1.55,useCORS:true,logging:false,width:slides[i].offsetWidth,height:slides[i].offsetHeight});
            rendered.push({blob:await canvasBlob(canvas,'image/jpeg',.94),widthPt:720,heightPt:405});canvas.width=1;canvas.height=1;
        }
        viewer.destroy?.();
        return postRenderedPages(rendered,file.name,'_convertido','Os slides foram convertidos preservando a aparência visual.');
    }catch(error){console.error(error);throw new Error(`Não foi possível renderizar o PowerPoint: ${error?.message||'arquivo incompatível'}`)}
    finally{shell.remove()}
}
async function pptxToHtml(file){
    const Zip=await jszip(),zip=await Zip.loadAsync(await file.arrayBuffer()),slideNames=Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(naturalSort),parts=[];
    for(let i=0;i<slideNames.length;i++){const xml=await zip.file(slideNames[i]).async('text'),doc=new DOMParser().parseFromString(xml,'application/xml'),texts=[...doc.getElementsByTagNameNS('*','t')].map(n=>n.textContent.trim()).filter(Boolean);parts.push(`<section><h1>Slide ${i+1}</h1>${texts.map(t=>`<p>${escapeHtml(t)}</p>`).join('')}</section><div class="page-break"></div>`);setProgress(15+((i+1)/slideNames.length)*50,`Lendo slide ${i+1}...`)}
    return parts.join('');
}
async function postRenderedPages(rendered,originalName,suffix,message){
    const form=new FormData(),metadata={pages:[]};
    rendered.forEach((p,i)=>{form.append('pages[]',p.blob,`pagina-${i+1}.jpg`);metadata.pages.push({widthPt:p.widthPt,heightPt:p.heightPt})});
    form.append('metadata',JSON.stringify(metadata));form.append('originalName',originalName);form.append('suffix',suffix);
    setProgress(89,'Montando o PDF final...');const response=await fetch('api/raster-pdf.php',{method:'POST',body:form});const blob=await responseBlob(response);
    return{blob,name:filenameFromResponse(response,baseName(originalName)+suffix+'.pdf'),message};
}
async function webToPdf(){let html=value('html'),url=value('url');if(files[0]&&!html&&!url)html=await files[0].text();if(!html&&!url)throw new Error('Cole um HTML, informe uma URL ou selecione um arquivo HTML.');return postHtml(html,'pagina_web',url)}
async function textToPdf(markdown){let text=value('sourceText');if(!text&&files[0])text=await files[0].text();if(!text.trim())throw new Error(markdown?'Digite ou envie um conteúdo Markdown.':'Digite ou envie algum texto.');const title=files[0]?baseName(files[0].name):(markdown?'documento_markdown':'documento_texto'),html=markdown?markdownToHtml(text):`<h1>${escapeHtml(title.replace(/[_-]+/g,' '))}</h1>${text.split(/\n{2,}/).map(p=>`<p>${escapeHtml(p).replace(/\n/g,'<br>')}</p>`).join('')}`;return postHtml(html,title)}
async function rtfToPdf(){const source=await files[0].text(),text=rtfPlainText(source);if(!text.trim())throw new Error('Nenhum texto legível foi encontrado no RTF.');const html=`<h1>${escapeHtml(baseName(files[0].name))}</h1>${text.split(/\n{2,}/).map(p=>`<p>${escapeHtml(p).replace(/\n/g,'<br>')}</p>`).join('')}`;return postHtml(html,baseName(files[0].name))}
function rtfPlainText(source){return String(source).replace(/\\u(-?\d+)\??/g,(_,n)=>String.fromCharCode(Number(n)<0?Number(n)+65536:Number(n))).replace(/\\'([0-9a-f]{2})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16))).replace(/\\par[d]?\b/g,'\n').replace(/\\tab\b/g,'\t').replace(/\\[a-z]+-?\d* ?/gi,'').replace(/[{}]/g,'').replace(/\\([\\{}])/g,'$1').replace(/\n{3,}/g,'\n\n').trim()}
async function epubToPdf(){const Zip=await jszip(),zip=await Zip.loadAsync(await files[0].arrayBuffer()),chapters=Object.keys(zip.files).filter(name=>/\.(xhtml?|html?)$/i.test(name)&&!/nav\.(xhtml?|html?)$/i.test(name)).sort(naturalSort);if(!chapters.length)throw new Error('O EPUB não contém capítulos HTML legíveis.');const html=[];for(let i=0;i<chapters.length;i++){const source=await zip.file(chapters[i]).async('text'),doc=new DOMParser().parseFromString(source,'text/html'),title=doc.querySelector('title,h1,h2')?.textContent?.trim()||`Capítulo ${i+1}`,text=doc.body?.textContent?.replace(/\s+/g,' ').trim()||'';html.push(`<h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p><div class="page-break"></div>`);setProgress(12+((i+1)/chapters.length)*58,`Lendo capítulo ${i+1}...`)}return postHtml(html.join(''),baseName(files[0].name))}
function markdownToHtml(source){const escaped=escapeHtml(source).replace(/\r/g,''),lines=escaped.split('\n'),parts=[];let list=false;for(let line of lines){if(/^[-*]\s+/.test(line)){if(!list){parts.push('<ul>');list=true}parts.push(`<li>${markdownInline(line.replace(/^[-*]\s+/,''))}</li>`);continue}if(list){parts.push('</ul>');list=false}const heading=line.match(/^(#{1,6})\s+(.+)/);if(heading)parts.push(`<h${heading[1].length}>${markdownInline(heading[2])}</h${heading[1].length}>`);else if(/^---+$/.test(line.trim()))parts.push('<hr>');else if(line.trim())parts.push(`<p>${markdownInline(line)}</p>`)}if(list)parts.push('</ul>');return parts.join('')}
function markdownInline(text){return text.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/__(.+?)__/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*([^*]+)\*/g,'<em>$1</em>')}
async function postHtml(html,title,url=''){
    setProgress(75,'Enviando conteúdo para o gerador PDF...');const form=new FormData();form.append('html',html);form.append('title',title);if(url)form.append('url',url);const response=await fetch('api/html-pdf.php',{method:'POST',body:form});const blob=await responseBlob(response);return{blob,name:filenameFromResponse(response,title+'_convertido.pdf'),message:'O conteúdo foi convertido em PDF.'};
}

async function extractPdfText(file){
    const pdf=await openPdfJs(file),pages=[];
    for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),content=await page.getTextContent(),rows=new Map();content.items.forEach(item=>{const y=Math.round(item.transform?.[5]||0);if(!rows.has(y))rows.set(y,[]);rows.get(y).push({x:item.transform?.[4]||0,text:item.str})});const lines=[...rows.entries()].sort((a,b)=>b[0]-a[0]).map(([,items])=>items.sort((a,b)=>a.x-b.x).map(x=>x.text).join(' ').trim()).filter(Boolean);pages.push(lines.join('\n'));setProgress(10+(i/pdf.numPages)*75,`Extraindo texto da página ${i}...`)}return pages;
}
async function pdfToWord(useOcr){
    await loadScript('assets/vendor/docx.umd.js','docx');
    if(!useOcr){const pages=await pdfEngine(files[0],'layout',{reuseFonts:!!document.getElementById('reuseFonts')?.checked});return{blob:await wordFromLayout(pages,docx,{enhanceContrast:!!document.getElementById('enhanceContrast')?.checked}),name:baseName(files[0].name)+'.docx',message:'Texto e imagens foram posicionados em páginas editáveis. Fontes e gráficos complexos podem variar; revise o resultado.'};}
    const recognized=await ocrDocument(files[0],true),pages=ocrLayout(recognized);
    for(const [index,source] of recognized.entries()){
        const image=await createImageBitmap(source.blob),canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);ctx.fillStyle='#ffffff';for(const word of source.words){const b=word.bbox;ctx.fillRect(b.x0-1,b.y0-1,b.x1-b.x0+2,b.y1-b.y0+2);}pages[index].backgroundPng=canvas.toDataURL('image/png');image.close();canvas.width=canvas.height=1;
    }
    return{blob:await wordFromLayout(pages,docx),name:baseName(files[0].name)+'_ocr.docx',message:'Texto OCR reconstruído nas posições reconhecidas. Revise palavras, fontes e leitura: OCR não recupera o conteúdo com garantia.'};
}
async function pdfToPowerPoint(){
    await loadScript('assets/vendor/pptxgen.bundle.js');const Ctor=window.PptxGenJS||window.pptxgen;
    const pages=await pdfEngine(files[0],'layout'),pptx=pptFromLayout(pages,Ctor,{enhanceContrast:!!document.getElementById('enhanceContrast')?.checked});
    return{blob:await pptx.write({outputType:'blob'}),name:baseName(files[0].name)+'.pptx',message:'Slides com estilos, rotação e linhas e retângulos editáveis. Gráficos complexos permanecem no fundo SVG; fontes e sobreposições podem variar.'};
}
async function pdfToExcel(useOcr){
    await loadScript('assets/vendor/xlsx.full.min.js','XLSX');const wb=XLSX.utils.book_new();let pages;
    if(useOcr)pages=ocrLayout(await ocrDocument(files[0]));else pages=await pdfEngine(files[0],'layout');
    for(const [index,page] of pages.entries()){
        const lines=layoutLines(page),geometry=editableGeometry(page.backgroundSvg),reconstructed=reconstructTables(lines,geometry.shapes);
        const add=(rows,name,merges=[])=>{const sheet=XLSX.utils.aoa_to_sheet(rows.length?rows:[['']]);sheet['!cols']=(rows[0]||[]).map(()=>({wch:22}));if(merges.length)sheet['!merges']=merges;XLSX.utils.book_append_sheet(wb,sheet,name);};
        for(const [i,table] of reconstructed.tables.entries())add(table.rows,`P${index+1} Tabela ${i+1}`,table.merges);
        if(reconstructed.remaining.length||!reconstructed.tables.length)add(tableRows(reconstructed.remaining.map(line=>({x:line.bbox.x,y:line.bbox.y,text:line.text}))),`Página ${index+1}`);
    }

    return{blob:new Blob([XLSX.write(wb,{bookType:'xlsx',type:'array'})],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),name:baseName(files[0].name)+(useOcr?'_ocr':'')+'.xlsx',message:'Linhas e colunas inferidas pelas posições do texto. Confira células mescladas e tabelas complexas.'};
}
async function pdfToJpg(){return pdfToImages('jpg')}
async function pdfToPng(){return pdfToImages('png')}
async function pdfToImages(fallback){const Zip=await jszip(),zip=new Zip(),pdf=await openPdfJs(files[0]),scale=clamp(num('imageScale',2),1,3),format=value('imageOutput',fallback);for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),viewport=page.getViewport({scale}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const context=canvas.getContext('2d',{alpha:true});if(['jpeg','jpg','pdf'].includes(format)){context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height)}await page.render({canvasContext:context,viewport,background:['jpeg','jpg','pdf'].includes(format)?'#fff':undefined}).promise;const result=await encodeCanvas(canvas,format,.92);zip.file(`pagina-${String(i).padStart(3,'0')}.${result.extension}`,result.blob);setProgress(10+(i/pdf.numPages)*75,`Convertendo página ${i}...`);canvas.width=1;canvas.height=1}return{blob:await zip.generateAsync({type:'blob'}),name:baseName(files[0].name)+`_${format}.zip`,message:`As páginas em ${format.toUpperCase()} foram reunidas em um ZIP.`}}
async function pdfToSvg(){
    const Zip=await jszip(),zip=new Zip(),pages=await pdfEngine(files[0],'svg');pages.forEach((svg,i)=>zip.file('pagina-'+String(i+1).padStart(3,'0')+'.svg',svg));
    return{blob:await zip.generateAsync({type:'blob'}),name:baseName(files[0].name)+'_svg.zip',message:'Páginas SVG com caminhos vetoriais. Imagens originalmente rasterizadas continuam imagens.'};
}
async function pdfToText(){const pages=await extractPdfText(files[0]),text=pages.map((page,i)=>`PÁGINA ${i+1}\n${page}`).join('\n\n');return{blob:new Blob([text],{type:'text/plain;charset=utf-8'}),name:baseName(files[0].name)+'.txt',message:'O texto selecionável foi extraído.'}}
async function pdfToHtml(){const pages=await pdfEngine(files[0],'layout',{reuseFonts:!!document.getElementById('reuseFonts')?.checked});return{blob:new Blob([layoutHtml(pages,baseName(files[0].name))],{type:'text/html;charset=utf-8'}),name:baseName(files[0].name)+'.html',message:'Texto e imagens exportados com posições e estilos do PDF.'};}
async function pdfToRtf(){const pages=await extractPdfText(files[0]),plain=pages.map((page,i)=>`PÁGINA ${i+1}\n${page}`).join('\n\n'),encoded=plain.replace(/[\\{}]/g,'\\$&').replace(/[^\x20-\x7e\n]/g,char=>`\\u${char.charCodeAt(0)}?`).replace(/\n/g,'\\par\n'),rtf=`{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\fs22 ${encoded}}`;return{blob:new Blob([rtf],{type:'application/rtf'}),name:baseName(files[0].name)+'.rtf',message:'O texto foi exportado para RTF.'}}
async function pdfToEpub(){const Zip=await jszip(),zip=new Zip(),pages=await extractPdfText(files[0]),title=baseName(files[0].name),content=pages.map((page,i)=>`<section><h1>Página ${i+1}</h1>${page.split('\n').filter(Boolean).map(line=>`<p>${escapeHtml(line)}</p>`).join('')}</section>`).join('<hr/>'),id=crypto.randomUUID?.()||String(Date.now());zip.file('mimetype','application/epub+zip',{compression:'STORE'});zip.file('META-INF/container.xml','<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');zip.file('OEBPS/content.xhtml',`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR"><head><title>${escapeHtml(title)}</title></head><body>${content}</body></html>`);zip.file('OEBPS/nav.xhtml',`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Índice</title></head><body><nav epub:type="toc"><ol><li><a href="content.xhtml">${escapeHtml(title)}</a></li></ol></nav></body></html>`);zip.file('OEBPS/content.opf',`<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">${id}</dc:identifier><dc:title>${escapeHtml(title)}</dc:title><dc:language>pt-BR</dc:language></metadata><manifest><item id="content" href="content.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="content"/></spine></package>`);return{blob:await zip.generateAsync({type:'blob',mimeType:'application/epub+zip'}),name:title+'.epub',message:'O livro EPUB foi criado com o texto extraído.'}}
async function pdfToMarkdown(){const pages=await pdfEngine(files[0],'layout');return{blob:new Blob([layoutMarkdown(pages)],{type:'text/markdown;charset=utf-8'}),name:baseName(files[0].name)+'.md',message:'Texto exportado com títulos e estilos inferidos. Markdown não preserva coordenadas ou layout gráfico.'};}
async function editPdf(){
    const lib=await pdfLib(),items=visualWorkspace?.getState().items||[],edits=[];
    for(const item of items.filter(item=>item.originalRect)){
        if(!item.deleted&&['x','y','w','h','text','dataUrl','size','color'].every(key=>item[key]===item.originalState[key]))continue;
        const bounds=item.pageBounds,width=bounds[2]-bounds[0],height=bounds[3]-bounds[1];
        edits.push({page:item.page,kind:item.originalKind,runs:item.runs,rotation:item.rotation||0,rect:item.originalRect,replacementRect:[bounds[0]+item.x*width,bounds[1]+item.y*height,bounds[0]+(item.x+item.w)*width,bounds[1]+(item.y+item.h)*height],text:!item.deleted&&item.type==='text'?item.text:'',dataUrl:!item.deleted&&item.type==='image'?item.dataUrl:null,size:item.size,color:(item.color||'#000000').match(/[a-f0-9]{2}/gi).map(value=>parseInt(value,16)/255)});
    }
    const originalBytes=edits.length?await pdfEngine(files[0],'edit-original',{edits}):new Uint8Array(await files[0].arrayBuffer()),doc=await lib.PDFDocument.load(originalBytes),font=await doc.embedFont(lib.StandardFonts.Helvetica),signatureFont=await doc.embedFont(lib.StandardFonts.HelveticaOblique);
    if(!items.length)throw new Error('Adicione texto, desenho, forma, cobertura ou imagem diretamente sobre o PDF.');
    for(const item of items){
        if(item.originalRect)continue;
        const page=doc.getPage(item.page),pw=page.getWidth(),ph=page.getHeight(),x=item.x*pw,y=ph-(item.y+(item.h||0))*ph,w=Math.max(1,(item.w||0)*pw),h=Math.max(1,(item.h||0)*ph),color=hexColor(lib,item.color||'#ff5a0a');
        if(item.type==='text')page.drawText(safePdfText(item.text),{x,y:ph-item.y*ph-item.size,size:item.size,font:item.subtype==='signature'?signatureFont:font,color,maxWidth:Math.max(20,w)});
        else if(item.type==='rect')page.drawRectangle({x,y,width:w,height:h,color,opacity:.14,borderColor:color,borderWidth:1.4});
        else if(item.type==='highlight')page.drawRectangle({x,y,width:w,height:h,color,opacity:.3});
        else if(item.type==='ellipse')page.drawEllipse({x:x+w/2,y:y+h/2,xScale:w/2,yScale:h/2,color,opacity:.12,borderColor:color,borderWidth:1.4});
        else if(item.type==='whiteout')page.drawRectangle({x,y,width:w,height:h,color:lib.rgb(1,1,1),borderColor:lib.rgb(.86,.86,.86),borderWidth:.5});
        else if(['draw','line'].includes(item.type)&&item.points?.length>1)for(let i=1;i<item.points.length;i++)page.drawLine({start:{x:item.points[i-1].x*pw,y:ph-item.points[i-1].y*ph},end:{x:item.points[i].x*pw,y:ph-item.points[i].y*ph},thickness:Math.max(1,item.size/3),color,lineCap:lib.LineCapStyle.Round});
        else if(item.type==='check'){page.drawLine({start:{x:x+w*.08,y:y+h*.45},end:{x:x+w*.36,y:y+h*.12},thickness:Math.max(1,item.size/3),color,lineCap:lib.LineCapStyle.Round});page.drawLine({start:{x:x+w*.36,y:y+h*.12},end:{x:x+w*.92,y:y+h*.88},thickness:Math.max(1,item.size/3),color,lineCap:lib.LineCapStyle.Round})}
        else if(item.type==='image'&&item.dataUrl){const bytes=dataUrlBytes(item.dataUrl),img=item.dataUrl.startsWith('data:image/png')?await doc.embedPng(bytes):await doc.embedJpg(bytes);page.drawImage(img,{x,y,width:w,height:h})}
    }
    return savePdf(doc,baseName(files[0].name)+'_editado.pdf','As alterações visuais foram aplicadas ao PDF.');
}
async function addPageNumbers(){const lib=await pdfLib(),doc=await openPdfLib(files[0]),font=await doc.embedFont(lib.StandardFonts.Helvetica),start=parseInt(value('startNumber','1'),10)||1,size=clamp(num('fontSize',12),6,72),pos=value('position','bottom-center');doc.getPages().forEach((page,i)=>{const text=String(start+i),tw=font.widthOfTextAtSize(text,size),top=pos.startsWith('top'),right=pos.endsWith('right'),left=pos.endsWith('left'),x=right?page.getWidth()-tw-28:left?28:(page.getWidth()-tw)/2,y=top?page.getHeight()-size-22:22;page.drawText(text,{x,y,size,font,color:lib.rgb(.2,.22,.25)})});return savePdf(doc,baseName(files[0].name)+'_numerado.pdf','A numeração foi aplicada.');}
async function addWatermark(){
    const lib=await pdfLib(),doc=await openPdfLib(files[0]),type=value('watermarkType','text'),opacity=clamp(num('opacity',.18),.05,1),pos=value('position','center'),pad=30;
    if(type==='image'){
        const file=document.getElementById('watermarkImage')?.files?.[0];if(!file)throw new Error('Selecione uma imagem PNG ou JPEG para usar como marca-d’água.');if(!/^image\/(png|jpeg)$/i.test(file.type)&&!/\.(png|jpe?g)$/i.test(file.name))throw new Error('A marca-d’água deve ser uma imagem PNG ou JPEG.');
        const bytes=new Uint8Array(await file.arrayBuffer()),isPng=file.type==='image/png'||/\.png$/i.test(file.name),image=isPng?await doc.embedPng(bytes):await doc.embedJpg(bytes),percent=clamp(num('watermarkImageSize',30),5,95)/100;
        doc.getPages().forEach(page=>{let width=page.getWidth()*percent,height=width*(image.height/image.width);const maxHeight=page.getHeight()-pad*2;if(height>maxHeight){height=maxHeight;width=height*(image.width/image.height)}const point=watermarkPosition(page.getWidth(),page.getHeight(),width,height,pos,pad);page.drawImage(image,{...point,width,height,opacity})});
    }else{
        const font=await doc.embedFont(lib.StandardFonts.HelveticaBold),text=safePdfText(value('watermark','INFINITOOLS')),size=clamp(num('fontSize',46),10,180);if(!text)throw new Error('Digite o texto da marca-d’água.');
        doc.getPages().forEach(page=>{const width=font.widthOfTextAtSize(text,size),height=size,point=watermarkPosition(page.getWidth(),page.getHeight(),width,height,pos,pad);page.drawText(text,{x:point.x,y:point.y,size,font,color:lib.rgb(.75,.25,.05),opacity,rotate:lib.degrees(0)})});
    }
    return savePdf(doc,baseName(files[0].name)+'_marca_dagua.pdf',`A marca-d’água de ${type==='image'?'imagem':'texto'} foi aplicada na posição escolhida.`);
}
function watermarkPosition(pageWidth,pageHeight,width,height,position,padding){const top=position.startsWith('top'),bottom=position.startsWith('bottom'),left=position.endsWith('left'),right=position.endsWith('right'),x=left?padding:right?pageWidth-width-padding:(pageWidth-width)/2,y=top?pageHeight-height-padding:bottom?padding:(pageHeight-height)/2;return{x:Math.max(padding,Math.min(x,pageWidth-width-padding)),y:Math.max(padding,Math.min(y,pageHeight-height-padding))}}
async function rotatePdf(){const lib=await pdfLib(),doc=await openPdfLib(files[0]),deg=parseInt(value('degrees','90'),10),selected=value('pages')?new Set(parsePages(value('pages'),doc.getPageCount(),false)):new Set(doc.getPageIndices());doc.getPages().forEach((p,i)=>{if(selected.has(i)){const current=p.getRotation().angle||0;p.setRotation(lib.degrees((current+deg)%360))}});return savePdf(doc,baseName(files[0].name)+'_rodado.pdf','A rotação foi aplicada.');}
async function cropPdf(){const doc=await openPdfLib(files[0]),crop=visualWorkspace?.getState().crop;doc.getPages().forEach(p=>{const w=p.getWidth(),h=p.getHeight(),left=crop?crop.left*w:Math.max(0,num('horizontal',20)),right=crop?crop.right*w:Math.max(0,num('horizontal',20)),top=crop?crop.top*h:Math.max(0,num('vertical',20)),bottom=crop?crop.bottom*h:Math.max(0,num('vertical',20));if(left+right>=w||top+bottom>=h)throw new Error('As margens são maiores que a página.');p.setCropBox(left,bottom,w-left-right,h-top-bottom)});return savePdf(doc,baseName(files[0].name)+'_recortado.pdf','O recorte visual foi aplicado proporcionalmente a todas as páginas.');}
async function addFormField(){
    const lib=await pdfLib(),doc=await openPdfLib(files[0]);
    await applyFormFields(doc,lib,visualWorkspace?.getState()||{},visualWorkspace?.pages||[]);
    return savePdf(doc,baseName(files[0].name)+'_formulario.pdf','Campos, valores padrão, grupos e aparências salvos no formulário interativo.');
}
async function overlayPdfs(){
    if(files.length!==2)throw new Error('Selecione exatamente dois PDFs: primeiro a base e depois a sobreposição.');
    const lib=await pdfLib(),base=await openPdfLib(files[0]),probe=await lib.PDFDocument.load(await files[1].arrayBuffer(),{ignoreEncryption:true}),overlayTotal=probe.getPageCount(),mode=value('overlayMode','repeat'),opacity=clamp(num('opacity',1),.05,1);ensurePageContent(probe);const overlayBytes=await probe.save(),indexes=Array.from({length:overlayTotal},(_,i)=>i),embedded=await base.embedPdf(overlayBytes,indexes);
    base.getPages().forEach((page,i)=>{if(mode==='matching'&&i>=embedded.length)return;const layer=embedded[Math.min(i,embedded.length-1)],scale=Math.min(page.getWidth()/layer.width,page.getHeight()/layer.height),w=layer.width*scale,h=layer.height*scale;page.drawPage(layer,{x:(page.getWidth()-w)/2,y:(page.getHeight()-h)/2,width:w,height:h,opacity})});
    return savePdf(base,baseName(files[0].name)+'_sobreposto.pdf','Os PDFs foram sobrepostos página por página.');
}
async function resizePages(){
    const lib=await pdfLib(),src=await openPdfLib(files[0]),out=await lib.PDFDocument.create(),format=value('pageFormat','a4'),orientation=value('orientation','portrait'),sizes={a4:[595.28,841.89],a3:[841.89,1190.55],letter:[612,792],legal:[612,1008]};ensurePageContent(src);let [targetW,targetH]=format==='custom'?[clamp(num('customWidth',595),72,4000),clamp(num('customHeight',842),72,4000)]:sizes[format];if(orientation==='landscape'&&targetH>targetW||orientation==='portrait'&&targetW>targetH)[targetW,targetH]=[targetH,targetW];
    const mode=value('fitMode','contain'),embedded=[];for(const page of src.getPages())embedded.push(await out.embedPage(page));for(let i=0;i<embedded.length;i++){const item=embedded[i],page=out.addPage([targetW,targetH]);let w=targetW,h=targetH;if(mode!=='stretch'){const scale=(mode==='cover'?Math.max:Math.min)(targetW/item.width,targetH/item.height);w=item.width*scale;h=item.height*scale}page.drawPage(item,{x:(targetW-w)/2,y:(targetH-h)/2,width:w,height:h});setProgress(12+((i+1)/embedded.length)*75,`Ajustando página ${i+1}...`)}return savePdf(out,baseName(files[0].name)+'_redimensionado.pdf','O tamanho das páginas foi alterado.');
}
async function editMetadata(){const doc=await openPdfLib(files[0]);doc.setTitle(value('metaTitle'));doc.setAuthor(value('metaAuthor'));doc.setSubject(value('metaSubject'));doc.setKeywords(value('metaKeywords').split(',').map(x=>x.trim()).filter(Boolean));doc.setProducer('infinitools');doc.setModificationDate(new Date());return savePdf(doc,baseName(files[0].name)+'_informacoes.pdf','As informações do documento foram atualizadas.');}
async function removeMetadata(){const doc=await openPdfLib(files[0]);doc.setTitle('');doc.setAuthor('');doc.setSubject('');doc.setKeywords([]);doc.setCreator('');doc.setProducer('');return savePdf(doc,baseName(files[0].name)+'_sem_metadados.pdf','Os metadados descritivos foram removidos.');}
async function comparePdfs(){
    if(files.length!==2)throw new Error('Selecione exatamente dois arquivos PDF.');
    const Zip=await jszip(),zip=new Zip(),left=await openPdfJs(files[0]),right=await openPdfJs(files[1]),total=Math.max(left.numPages,right.numPages),tolerance=clamp(num('compareTolerance',36),1,255),report=[];
    for(let index=0;index<total;index++){
        const a=await comparisonCanvas(left,index),b=await comparisonCanvas(right,index),width=Math.max(a.width,b.width),height=Math.max(a.height,b.height),ca=document.createElement('canvas'),cb=document.createElement('canvas');ca.width=cb.width=width;ca.height=cb.height=height;
        for(const [canvas,source] of [[ca,a],[cb,b]]){const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(source,0,0)}
        const da=ca.getContext('2d').getImageData(0,0,width,height),db=cb.getContext('2d').getImageData(0,0,width,height),out=document.createElement('canvas');out.width=width;out.height=height;const ctx=out.getContext('2d'),result=ctx.createImageData(width,height);let changed=0;
        for(let p=0;p<da.data.length;p+=4){const delta=Math.max(Math.abs(da.data[p]-db.data[p]),Math.abs(da.data[p+1]-db.data[p+1]),Math.abs(da.data[p+2]-db.data[p+2]));if(delta>tolerance){result.data[p]=235;result.data[p+1]=45;result.data[p+2]=65;changed++}else{const gray=Math.round((da.data[p]+da.data[p+1]+da.data[p+2])/3);result.data[p]=result.data[p+1]=result.data[p+2]=Math.round(235+gray*.08)}result.data[p+3]=255}
        ctx.putImageData(result,0,0);zip.file(`pagina-${String(index+1).padStart(3,'0')}-diferencas.png`,await canvasBlob(out,'image/png'));report.push(`Página ${index+1}: ${(changed/(width*height)*100).toFixed(2)}% dos pixels com diferenças`);[a,b,ca,cb,out].forEach(canvas=>{canvas.width=1;canvas.height=1});setProgress(8+((index+1)/total)*80,`Comparando página ${index+1} de ${total}...`)
    }
    zip.file('relatorio.txt',[`Comparação visual: ${files[0].name} × ${files[1].name}`,`Sensibilidade: ${tolerance}`,'',...report].join('\n'));return{blob:await zip.generateAsync({type:'blob'}),name:'comparacao_de_pdfs.zip',message:`${total} página(s) comparada(s). Vermelho indica diferenças visuais.`}
}
async function comparisonCanvas(pdf,index){if(index>=pdf.numPages){const canvas=document.createElement('canvas');canvas.width=900;canvas.height=1200;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);return canvas}const page=await pdf.getPage(index+1),viewport=page.getViewport({scale:1.35}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'#fff'}).promise;return canvas}
async function setViewerPreferences(){const lib=await pdfLib(),doc=await openPdfLib(files[0]),catalog=doc.catalog,preferences=catalog.getOrCreateViewerPreferences();catalog.set(lib.PDFName.of('PageLayout'),lib.PDFName.of(value('pageLayout','SinglePage')));catalog.set(lib.PDFName.of('PageMode'),lib.PDFName.of(value('pageMode','UseNone')));preferences.setReadingDirection(lib.ReadingDirection[value('readingDirection','L2R')]);preferences.setDuplex(lib.Duplex[value('duplex','Simplex')]);preferences.setPrintScaling(lib.PrintScaling[value('printScaling','AppDefault')]);preferences.setDisplayDocTitle(checked('displayTitle'));preferences.setFitWindow(checked('fitWindow'));preferences.setCenterWindow(checked('centerWindow'));preferences.setHideToolbar(checked('hideToolbar'));preferences.setHideMenubar(checked('hideMenubar'));preferences.setHideWindowUI(checked('hideWindowUI'));return savePdf(doc,baseName(files[0].name)+'_preferencias.pdf','As preferências do visualizador foram gravadas no PDF.');}

async function ocrToSearchablePdf(){
    const lib=await pdfLib(),items=await ocrDocument(files[0],true),out=await lib.PDFDocument.create(),font=await out.embedFont(lib.StandardFonts.Helvetica);
    for(let i=0;i<items.length;i++){
        const item=items[i],page=out.addPage([item.widthPt,item.heightPt]),img=await out.embedJpg(await item.blob.arrayBuffer());page.drawImage(img,{x:0,y:0,width:item.widthPt,height:item.heightPt});
        const sx=item.widthPt/item.pixelWidth,sy=item.heightPt/item.pixelHeight;
        for(const word of item.words){
            const text=safePdfText(word.text);if(!text||!word.bbox)continue;
            const box=word.bbox,width=(box.x1-box.x0)*sx,height=(box.y1-box.y0)*sy,size=Math.max(1,Math.min(height*.85,width/Math.max(.1,font.widthOfTextAtSize(text,1))));
            page.drawText(text,{x:box.x0*sx,y:item.heightPt-box.y1*sy+height*.15,size,font,opacity:0});
        }
    }
    return savePdf(out,baseName(files[0].name)+'_ocr.pdf','PDF pesquisável com texto posicionado sobre as palavras reconhecidas.');
}
async function ocrDocument(file,keepImages=false){
    await loadScript('assets/vendor/tesseract/tesseract.min.js','Tesseract');const lang=value('language','por'),worker=await Tesseract.createWorker(lang,1,{workerPath:'assets/vendor/tesseract/worker.min.js',corePath:'assets/vendor/tesseract/tesseract-core-simd-lstm.wasm.js',langPath:'assets/vendor/tessdata',logger:m=>{if(m.progress)setProgress(10+m.progress*75,`${ocrStatus(m.status)} ${Math.round(m.progress*100)}%`)}});const rendered=await renderPdf(file,{scale:1.8,quality:.94,quiet:true}),result=[];
    try{await worker.setParameters({tessedit_pageseg_mode:'11'});for(let i=0;i<rendered.length;i++){setProgress(10+(i/rendered.length)*70,`Reconhecendo página ${i+1} de ${rendered.length}...`);const data=await worker.recognize(rendered[i].blob,{}, {text:true,blocks:true});result.push({text:data.data.text||'',words:ocrWords(data.data),width:rendered[i].widthPt,height:rendered[i].heightPt,pixelWidth:rendered[i].pixelWidth,pixelHeight:rendered[i].pixelHeight,...(keepImages?rendered[i]:{})})}}finally{await worker.terminate()}return result;
}

async function renderPdf(file,{scale=1.7,quality=.9,password='',quiet=false}={}){const pdf=await openPdfJs(file,password),out=[];for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),base=page.getViewport({scale:1}),viewport=page.getViewport({scale}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);await page.render({canvasContext:ctx,viewport,background:'#fff'}).promise;out.push({blob:await canvasBlob(canvas,'image/jpeg',quality),widthPt:base.width,heightPt:base.height,pixelWidth:canvas.width,pixelHeight:canvas.height});if(!quiet)setProgress(5+(i/pdf.numPages)*78,`Preparando página ${i} de ${pdf.numPages}...`);canvas.width=1;canvas.height=1}return out}
async function openPdfJs(file,password=''){try{return await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer()),password}).promise}catch(e){if(e?.name==='PasswordException')throw new Error(password?'Senha incorreta ou PDF não suportado.':'Este PDF exige uma senha.');throw e}}
async function imageFileToJpeg(file,quality){const img=await decodeImageFile(file),canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0);img.width=img.height=1;return canvasBlob(canvas,'image/jpeg',quality)}
function canvasBlob(canvas,type,quality){return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Falha ao gerar imagem.')),type,quality))}

function parsePages(spec,total,duplicates=false){const result=[];String(spec||'').split(',').map(s=>s.trim()).filter(Boolean).forEach(token=>{const m=token.match(/^(\d+)\s*-\s*(\d+)$/);if(m){const a=Number(m[1]),b=Number(m[2]),step=a<=b?1:-1;for(let n=a;step>0?n<=b:n>=b;n+=step)if(n>=1&&n<=total&&(duplicates||!result.includes(n-1)))result.push(n-1)}else{const n=Number(token);if(Number.isInteger(n)&&n>=1&&n<=total&&(duplicates||!result.includes(n-1)))result.push(n-1)}});return result}
function pageAt(doc,n){const i=Math.max(0,Math.min(doc.getPageCount()-1,(parseInt(n,10)||1)-1));return doc.getPage(i)}
function num(id,fallback){const n=Number(value(id,String(fallback)));return Number.isFinite(n)?n:fallback}
function clamp(n,min,max){return Math.min(max,Math.max(min,n))}
function safePdfText(s){return String(s).replace(/[^\u0020-\u00ff]/g,' ').replace(/\s+/g,' ').trim()}
function safePdfFieldText(s){return String(s).replace(/[^\u000a\u0020-\u00ff]/g,' ').replace(/\r/g,'').trim()}
function dataUrlBytes(dataUrl){const base64=String(dataUrl).split(',')[1]||'',binary=atob(base64),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes}
function hexColor(lib,hex){const m=String(hex).match(/^#([0-9a-f]{6})$/i);if(!m)return lib.rgb(0,0,0);return lib.rgb(parseInt(m[1].slice(0,2),16)/255,parseInt(m[1].slice(2,4),16)/255,parseInt(m[1].slice(4,6),16)/255)}
function ensurePageContent(doc){doc.getPages().forEach(page=>page.drawRectangle({x:0,y:0,width:.01,height:.01,opacity:0}))}
function baseName(name){return name.replace(/\.[^.]+$/,'')||'documento'}
function naturalSort(a,b){return a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'})}
function formatBytes(bytes){if(bytes<1024)return`${bytes} B`;if(bytes<1048576)return`${(bytes/1024).toFixed(1)} KB`;return`${(bytes/1048576).toFixed(1)} MB`}
function ocrStatus(status){const map={'loading tesseract core':'Carregando OCR','initializing tesseract':'Iniciando OCR','loading language traineddata':'Carregando idioma','initializing api':'Preparando idioma','recognizing text':'Reconhecendo texto'};return map[status]||'Processando OCR'}
async function responseBlob(response){const type=response.headers.get('content-type')||'';if(!response.ok||type.includes('application/json')){let message='Falha no processamento do servidor.';try{const data=await response.json();if(data.message)message=data.message}catch{}throw new Error(message)}return response.blob()}
function filenameFromResponse(response,fallback){const cd=response.headers.get('content-disposition')||'',m=cd.match(/filename="([^"]+)"/i);return m?m[1]:fallback}
function presentResult(blob,name,message){revokeDownload();downloadUrl=URL.createObjectURL(blob);downloadBtn.href=downloadUrl;downloadBtn.download=name;resultText.textContent=`${message||'Concluído'} • ${formatBytes(blob.size)}`;hideProgress();resultCard.hidden=false;resultCard.scrollIntoView({behavior:'smooth',block:'center'})}
function revokeDownload(){document.getElementById('cleanupReport')?.remove();document.getElementById('signatureReport')?.remove();if(reportUrl){URL.revokeObjectURL(reportUrl);reportUrl=null;}if(downloadUrl){URL.revokeObjectURL(downloadUrl);downloadUrl=null}downloadBtn?.removeAttribute('href')}
function showProgress(title,text,progress){processingTitle.textContent=title;processingText.textContent=text;progressBar.style.width=`${progress}%`;processing.hidden=false}
function setProgress(progress,text){progressBar.style.width=`${clamp(progress,0,100)}%`;if(text)processingText.textContent=text}
function hideProgress(){processing.hidden=true}

