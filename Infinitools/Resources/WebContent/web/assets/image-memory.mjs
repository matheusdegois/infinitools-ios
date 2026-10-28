import {defaults} from './image-core.mjs';

export function neutralAdjustments(settings) {
    const baseline=defaults();
    return Object.keys(baseline).every(key=>key==='curve'
        ? Array.isArray(settings?.curve)&&settings.curve.length===baseline.curve.length&&baseline.curve.every((value,index)=>settings.curve[index]===value)
        : settings?.[key]===baseline[key]);
}

function surfaces(state) {
    const result=[];
    if(state?.selection)result.push(state.selection);
    for(const layer of state?.layers||[])result.push(layer.source,layer.mask);
    return result.filter(Boolean);
}

// Estimate RGBA backing stores by identity: shared canvases cost only once.
// Current-image surfaces are excluded from the *extra* history budget.
export function historyBytes(current,history,future) {
    const seen=new Set(surfaces(current));let bytes=0;
    for(const state of [...history,...future])for(const surface of surfaces(state)){
        if(seen.has(surface))continue;seen.add(surface);
        bytes+=Math.max(0,surface.width||0)*Math.max(0,surface.height||0)*4;
    }
    return bytes;
}

export function trimHistory(current,history,future,budget,maxSteps=20) {
    const past=history.slice(-maxSteps),next=future.slice(-maxSteps);
    let bytes=historyBytes(current,past,next);
    // Preserve the nearest undo and redo even when one large edit alone
    // exceeds the estimate. No live canvas is cleared or resized here.
    while(bytes>budget&&(past.length>1||next.length>1)){
        if(past.length>1)past.shift();else next.shift();
        bytes=historyBytes(current,past,next);
    }
    return {history:past,future:next,bytes};
}

export function historyBudget(deviceMemory) {
    return (Number.isFinite(deviceMemory)&&deviceMemory<=4?64:192)*1024*1024;
}
