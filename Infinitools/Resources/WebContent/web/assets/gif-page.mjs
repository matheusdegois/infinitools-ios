export const GIF_PAGE_REVISION='20261014-scope5';
const root=document.getElementById('gifWorkspace');
try {
 const module=await import('./gif-ui.mjs?v=5');
 if(module.GIF_UI_REVISION!==GIF_PAGE_REVISION)throw new Error('GIF UI revision mismatch.');
 new module.GifEditorUI(root);
 root.dataset.gifRevision=GIF_PAGE_REVISION;
} catch(error) {
 console.error('GIF editor files must be updated together.',error);
 root.replaceChildren();root.dataset.gifLoadError='true';root.setAttribute('role','alert');
 root.textContent='Não foi possível carregar a versão atual do editor. Recarregue a página; se continuar, aguarde a atualização do site.';
}
