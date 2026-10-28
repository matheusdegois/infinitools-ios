/* Preserve the original GIF scene renderer when a WebKit worker has no 2D OffscreenCanvas. */
import {visualGifFrame, visualGifSettings} from '/assets/gif-scene.mjs?v=4';
import {GIFEncoder, writeGifFrame, parseGif} from '/assets/gif-core.mjs?v=1';

let serial = 0;
const paints = new Map();

export function handlePaintReply(message) {
  if (message.type !== 'painted') return false;
  const job = paints.get(message.paintID);
  if (job) {
    paints.delete(message.paintID);
    clearTimeout(job.timer);
    message.error ? job.reject(new Error(message.error)) : job.resolve(message.rgba);
  }
  return true;
}

function workerCanvasAvailable() {
  try { return typeof OffscreenCanvas !== 'undefined' && !!new OffscreenCanvas(1, 1).getContext('2d'); }
  catch { return false; }
}

function paintOnMain(frame, info, scene, index) {
  return new Promise((resolve, reject) => {
    const paintID = ++serial;
    const timer = setTimeout(() => { paints.delete(paintID); reject(new Error('Tempo limite ao renderizar o quadro GIF.')); }, 30000);
    paints.set(paintID, {resolve, reject, timer});
    const rgba = frame.rgba.slice();
    self.postMessage({type: 'paint', paintID, rgba, info: {width: info.width, height: info.height}, scene, index}, [rgba.buffer]);
  });
}

export function paintScene(message) {
  // Canvas construction is explicit; no globals or browser feature detection are spoofed.
  class DOMCanvas {
    constructor(width, height) {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      return canvas;
    }
  }
  return visualGifFrame({rgba: message.rgba}, message.info, message.scene, message.index, DOMCanvas);
}

export async function encodeScene(frames, info, scene, onProgress, originalEncoder) {
  if (workerCanvasAvailable()) return originalEncoder(frames, info, scene, onProgress);
  const settings = visualGifSettings(info, scene), encoder = GIFEncoder();
  for (let i = 0; i < settings.selected.length; i++) {
    const index = settings.selected[i];
    const rgba = await paintOnMain(frames[index], info, scene, index);
    writeGifFrame(encoder, rgba, settings.width, settings.height, {delay: settings.delays[i], loop: settings.loop});
    onProgress(i + 1, settings.selected.length);
  }
  encoder.finish();
  const bytes = encoder.bytes(), check = parseGif(bytes, {limits: false});
  if (check.frames.length !== settings.selected.length || check.duration !== settings.duration || check.loop !== settings.loop) throw new Error('Falha na verificação do GIF.');
  return {bytes, summary: {width: settings.width, height: settings.height, frames: settings.selected.length, duration: settings.duration, loop: settings.loop}};
}
