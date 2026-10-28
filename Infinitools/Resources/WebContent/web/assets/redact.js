import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = './assets/vendor/pdfjs/pdf.worker.min.mjs';

const pdfFileInput = document.getElementById('pdfFile');
const uploadCard = document.getElementById('uploadCard');
const fileInfo = document.getElementById('fileInfo');
const editor = document.getElementById('editor');
const pagesContainer = document.getElementById('pagesContainer');
const documentName = document.getElementById('documentName');
const pageCount = document.getElementById('pageCount');
const undoBtn = document.getElementById('undoBtn');
const clearBtn = document.getElementById('clearBtn');
const changeFileBtn = document.getElementById('changeFileBtn');
const finishBtn = document.getElementById('finishBtn');
const selectionSummary = document.getElementById('selectionSummary');
const redactionColorInput = document.getElementById('redactionColor');
const redactionColorValue = document.getElementById('redactionColorValue');
const resetRedactionColorBtn = document.getElementById('resetRedactionColor');
const resultCard = document.getElementById('resultCard');
const downloadBtn = document.getElementById('downloadBtn');
const editAgainBtn = document.getElementById('editAgainBtn');
const processing = document.getElementById('processing');
const processingTitle = document.getElementById('processingTitle');
const processingText = document.getElementById('processingText');
const progressBar = document.getElementById('progressBar');

let currentFile = null;
let pdfDocument = null;
let pdfBytes = null;
let pageStates = [];
let actionHistory = [];
let downloadObjectUrl = null;
let redactionColor = '#000000';

const PREVIEW_MAX_WIDTH = 980;
const FINAL_RENDER_SCALE = 2.5; // ~180 DPI para páginas PDF usuais
const MIN_SELECTION_PX = 5;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

pdfFileInput.addEventListener('change', async () => {
    const file = pdfFileInput.files?.[0];
    if (!file) return;

    await loadPdf(file);
});

changeFileBtn.addEventListener('click', resetApplication);
editAgainBtn.addEventListener('click', () => {
    resultCard.hidden = true;
    editor.hidden = false;
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
undoBtn.addEventListener('click', undoLastRedaction);
clearBtn.addEventListener('click', clearAllRedactions);
finishBtn.addEventListener('click', finalizePdf);
redactionColorInput.addEventListener('input', () => setRedactionColor(redactionColorInput.value));
resetRedactionColorBtn.addEventListener('click', () => setRedactionColor('#000000'));
setRedactionColor('#000000');

async function loadPdf(file) {
    if (file.size > MAX_FILE_BYTES) {
        alert('O PDF selecionado excede 50 MB.');
        pdfFileInput.value = '';
        return;
    }

    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        alert('Selecione um arquivo PDF válido.');
        pdfFileInput.value = '';
        return;
    }

    revokeDownloadUrl();
    showProcessing('Abrindo PDF...', 'Lendo o documento diretamente no navegador.', 5);

    try {
        currentFile = file;
        pdfBytes = new Uint8Array(await file.arrayBuffer());
        pdfDocument = await pdfjsLib.getDocument({ data: pdfBytes }).promise;

        pageStates = [];
        actionHistory = [];
        pagesContainer.innerHTML = '';

        documentName.textContent = file.name;
        pageCount.textContent = `${pdfDocument.numPages} página${pdfDocument.numPages === 1 ? '' : 's'}`;
        fileInfo.textContent = `${file.name} • ${formatBytes(file.size)}`;
        fileInfo.hidden = false;

        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber++) {
            setProgress(
                5 + Math.round((pageNumber / pdfDocument.numPages) * 75),
                `Renderizando página ${pageNumber} de ${pdfDocument.numPages}...`
            );
            await createPreviewPage(pageNumber);
        }

        uploadCard.hidden = true;
        resultCard.hidden = true;
        editor.hidden = false;
        updateSelectionSummary();
        hideProcessing();
        editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
        console.error(error);
        hideProcessing();
        resetApplication();
        alert('Não foi possível abrir este PDF. Ele pode estar corrompido, protegido por senha ou em um formato não suportado pelo navegador.');
    }
}

async function createPreviewPage(pageNumber) {
    const page = await pdfDocument.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });

    const availableWidth = Math.max(320, Math.min(PREVIEW_MAX_WIDTH, window.innerWidth - 48));
    const previewScale = Math.min(1.7, availableWidth / baseViewport.width);
    const viewport = page.getViewport({ scale: previewScale });
    const outputScale = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

    const pageCard = document.createElement('article');
    pageCard.className = 'page-card';

    const pageHeader = document.createElement('div');
    pageHeader.className = 'page-header';
    pageHeader.innerHTML = `<strong>Página ${pageNumber}</strong><span>Arraste para rasurar</span>`;

    const stage = document.createElement('div');
    stage.className = 'page-stage';
    stage.style.width = `${viewport.width}px`;
    stage.style.height = `${viewport.height}px`;

    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-canvas';
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    const context = canvas.getContext('2d', { alpha: false });
    context.save();
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();

    await page.render({
        canvasContext: context,
        viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null,
        background: '#ffffff'
    }).promise;

    stage.appendChild(canvas);
    pageCard.appendChild(pageHeader);
    pageCard.appendChild(stage);
    pagesContainer.appendChild(pageCard);

    const state = {
        pageNumber,
        page,
        baseViewport,
        stage,
        canvas,
        redactions: []
    };

    pageStates.push(state);
    enableSelection(state);
}

function enableSelection(state) {
    const stage = state.stage;
    let start = null;
    let draft = null;
    let pointerId = null;

    stage.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        if (event.target.closest?.('.remove-redaction')) return;

        event.preventDefault();
        pointerId = event.pointerId;
        stage.setPointerCapture(pointerId);

        const point = getStagePoint(stage, event.clientX, event.clientY);
        start = point;

        draft = document.createElement('div');
        draft.className = 'redaction-box redaction-draft';
        stage.appendChild(draft);
        positionBox(draft, point.x, point.y, 0, 0, stage);
    });

    stage.addEventListener('pointermove', (event) => {
        if (!start || !draft || event.pointerId !== pointerId) return;

        const current = getStagePoint(stage, event.clientX, event.clientY);
        const rect = normalizeRect(start.x, start.y, current.x, current.y);
        positionBox(draft, rect.x, rect.y, rect.w, rect.h, stage);
    });

    const finishPointer = (event) => {
        if (!start || !draft || event.pointerId !== pointerId) return;

        const current = getStagePoint(stage, event.clientX, event.clientY);
        const rect = normalizeRect(start.x, start.y, current.x, current.y);

        draft.remove();
        draft = null;
        start = null;

        if (stage.hasPointerCapture(pointerId)) {
            stage.releasePointerCapture(pointerId);
        }
        pointerId = null;

        if (rect.w < MIN_SELECTION_PX || rect.h < MIN_SELECTION_PX) {
            return;
        }

        addRedaction(state, rect);
    };

    stage.addEventListener('pointerup', finishPointer);
    stage.addEventListener('pointercancel', () => {
        draft?.remove();
        draft = null;
        start = null;
        pointerId = null;
    });
}

function addRedaction(state, rectPx) {
    const stageRect = state.stage.getBoundingClientRect();
    const redaction = {
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        x: rectPx.x / stageRect.width,
        y: rectPx.y / stageRect.height,
        w: rectPx.w / stageRect.width,
        h: rectPx.h / stageRect.height,
        element: null
    };

    const element = document.createElement('div');
    element.className = 'redaction-box';
    element.dataset.redactionId = redaction.id;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-redaction';
    remove.setAttribute('aria-label', 'Remover rasura');
    remove.textContent = '×';
    remove.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        removeRedaction(state, redaction.id, true);
    });

    element.appendChild(remove);
    state.stage.appendChild(element);
    redaction.element = element;
    state.redactions.push(redaction);
    actionHistory.push({ pageNumber: state.pageNumber, id: redaction.id });

    renderRedactionElement(state, redaction);
    updateSelectionSummary();
}

function removeRedaction(state, id, removeFromHistory = false) {
    const index = state.redactions.findIndex(item => item.id === id);
    if (index === -1) return;

    state.redactions[index].element?.remove();
    state.redactions.splice(index, 1);

    if (removeFromHistory) {
        actionHistory = actionHistory.filter(action => action.id !== id);
    }

    updateSelectionSummary();
}

function undoLastRedaction() {
    while (actionHistory.length > 0) {
        const action = actionHistory.pop();
        const state = pageStates.find(page => page.pageNumber === action.pageNumber);
        if (!state) continue;

        const exists = state.redactions.some(redaction => redaction.id === action.id);
        if (!exists) continue;

        removeRedaction(state, action.id, false);
        break;
    }

    updateSelectionSummary();
}

function clearAllRedactions() {
    if (getRedactionCount() === 0) return;

    if (!confirm('Remover todas as áreas de rasura selecionadas?')) return;

    pageStates.forEach(state => {
        state.redactions.forEach(redaction => redaction.element?.remove());
        state.redactions = [];
    });
    actionHistory = [];
    updateSelectionSummary();
}

function renderRedactionElement(state, redaction) {
    const stageRect = state.stage.getBoundingClientRect();
    positionBox(
        redaction.element,
        redaction.x * stageRect.width,
        redaction.y * stageRect.height,
        redaction.w * stageRect.width,
        redaction.h * stageRect.height,
        state.stage
    );
}

function setRedactionColor(color) {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;

    redactionColor = color.toLowerCase();
    redactionColorInput.value = redactionColor;
    redactionColorValue.textContent = redactionColor.toUpperCase();
    editor.style.setProperty('--redaction-color', redactionColor);
}

function updateSelectionSummary() {
    const count = getRedactionCount();
    const pagesWithRedactions = pageStates.filter(page => page.redactions.length > 0).length;

    if (count === 0) {
        selectionSummary.textContent = 'Nenhuma rasura selecionada.';
    } else {
        selectionSummary.textContent = `${count} área${count === 1 ? '' : 's'} de rasura em ${pagesWithRedactions} página${pagesWithRedactions === 1 ? '' : 's'}.`;
    }

    undoBtn.disabled = count === 0;
    clearBtn.disabled = count === 0;
}

async function finalizePdf() {
    if (!pdfDocument || !currentFile) return;

    const redactionCount = getRedactionCount();
    if (redactionCount === 0) {
        const continueWithoutRedaction = confirm(
            'Nenhuma área foi selecionada. Deseja gerar uma cópia rasterizada mesmo assim?'
        );
        if (!continueWithoutRedaction) return;
    }

    finishBtn.disabled = true;
    showProcessing('Aplicando rasuras...', 'Preparando a página 1.', 2);

    try {
        const formData = new FormData();
        const metadata = { pages: [] };

        for (let index = 0; index < pageStates.length; index++) {
            const state = pageStates[index];
            const pageNumber = index + 1;

            setProgress(
                Math.round(((index + 0.2) / pageStates.length) * 75),
                `Aplicando rasuras na página ${pageNumber} de ${pageStates.length}...`
            );

            const rendered = await renderFinalPage(state);
            formData.append('pages[]', rendered.blob, `pagina-${pageNumber}.jpg`);
            metadata.pages.push({
                pageNumber,
                widthPt: state.baseViewport.width,
                heightPt: state.baseViewport.height
            });
        }

        formData.append('metadata', JSON.stringify(metadata));
        formData.append('originalName', currentFile.name);

        setProgress(80, 'Montando o novo PDF com mPDF...');

        formData.append('suffix', '_rasurado');

        const response = await fetch('api/raster-pdf.php', {
            method: 'POST',
            body: formData,
            cache: 'no-store'
        });

        const contentType = response.headers.get('content-type') || '';
        if (!response.ok || !contentType.includes('application/pdf')) {
            let message = 'Não foi possível gerar o PDF final.';
            try {
                const errorData = await response.json();
                if (errorData?.message) message = errorData.message;
            } catch (_) {
                // Mantém a mensagem padrão.
            }
            throw new Error(message);
        }

        setProgress(95, 'Recebendo o arquivo final...');
        const pdfBlob = await response.blob();
        revokeDownloadUrl();
        downloadObjectUrl = URL.createObjectURL(pdfBlob);

        downloadBtn.href = downloadObjectUrl;
        downloadBtn.download = buildOutputName(currentFile.name);

        editor.hidden = true;
        resultCard.hidden = false;
        setProgress(100, 'Concluído.');
        hideProcessing();
        resultCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
        console.error(error);
        hideProcessing();
        alert(error.message || 'Erro ao processar o documento.');
    } finally {
        finishBtn.disabled = false;
    }
}

async function renderFinalPage(state) {
    const viewport = state.page.getViewport({ scale: FINAL_RENDER_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    await state.page.render({
        canvasContext: context,
        viewport,
        background: '#ffffff'
    }).promise;

    // As coordenadas são normalizadas (0..1), então independem do tamanho da prévia.
    context.save();
    context.fillStyle = redactionColor;

    for (const redaction of state.redactions) {
        const x = Math.max(0, redaction.x * canvas.width);
        const y = Math.max(0, redaction.y * canvas.height);
        const w = Math.min(canvas.width - x, redaction.w * canvas.width);
        const h = Math.min(canvas.height - y, redaction.h * canvas.height);
        context.fillRect(x, y, w, h);
    }

    context.restore();

    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.95);
    canvas.width = 1;
    canvas.height = 1;

    return { blob };
}

function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (!blob) {
                reject(new Error('Falha ao preparar uma das páginas.'));
                return;
            }
            resolve(blob);
        }, type, quality);
    });
}

function getStagePoint(stage, clientX, clientY) {
    const rect = stage.getBoundingClientRect();
    return {
        x: Math.min(Math.max(clientX - rect.left, 0), rect.width),
        y: Math.min(Math.max(clientY - rect.top, 0), rect.height)
    };
}

function normalizeRect(x1, y1, x2, y2) {
    return {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        w: Math.abs(x2 - x1),
        h: Math.abs(y2 - y1)
    };
}

function positionBox(element, x, y, w, h, stage) {
    const rect = stage.getBoundingClientRect();
    element.style.left = `${(x / rect.width) * 100}%`;
    element.style.top = `${(y / rect.height) * 100}%`;
    element.style.width = `${(w / rect.width) * 100}%`;
    element.style.height = `${(h / rect.height) * 100}%`;
}

function getRedactionCount() {
    return pageStates.reduce((sum, page) => sum + page.redactions.length, 0);
}

function buildOutputName(originalName) {
    const withoutExtension = originalName.replace(/\.pdf$/i, '') || 'documento';
    return `${withoutExtension}_rasurado.pdf`;
}

function resetApplication() {
    revokeDownloadUrl();
    currentFile = null;
    pdfDocument = null;
    pdfBytes = null;
    pageStates = [];
    actionHistory = [];
    setRedactionColor('#000000');

    pdfFileInput.value = '';
    pagesContainer.innerHTML = '';
    fileInfo.hidden = true;
    editor.hidden = true;
    resultCard.hidden = true;
    uploadCard.hidden = false;
    hideProcessing();
    updateSelectionSummary();
    uploadCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showProcessing(title, text, progress) {
    processingTitle.textContent = title;
    processingText.textContent = text;
    progressBar.style.width = `${progress}%`;
    processing.hidden = false;
}

function setProgress(progress, text) {
    progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
    if (text) processingText.textContent = text;
}

function hideProcessing() {
    processing.hidden = true;
}

function revokeDownloadUrl() {
    if (downloadObjectUrl) {
        URL.revokeObjectURL(downloadObjectUrl);
        downloadObjectUrl = null;
    }
    downloadBtn.removeAttribute('href');
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

window.addEventListener('beforeunload', revokeDownloadUrl);
