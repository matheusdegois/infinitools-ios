import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const script = fs.readFileSync(new URL('../web-adapter/transport.js', import.meta.url), 'utf8');
function setup({origin = 'http://127.0.0.1:18763', frame = false, native = true, reject = false} = {}) {
  const calls = [];
  const window = {fetch: async (...args) => { calls.push(['fetch', ...args]); return 'ok'; }, open: (...args) => { calls.push(['open', ...args]); return null; }};
  window.top = frame ? {} : window;
  if (native) window.webkit = {messageHandlers: {infinitools: {postMessage: async raw => {
    calls.push(['native', raw]); if (reject) throw Error('rejected'); return {requestId: JSON.parse(raw).requestId, transferId: 'a'};
  }}}};
  class XHR { open(...args) { calls.push(['xhr', ...args]); } }
  const context = vm.createContext({window, location: {origin, href: origin + '/tool?tool=merge'}, URL, Request, XMLHttpRequest: XHR, console});
  vm.runInContext(script, context);
  return {window, calls, context, XHR};
}
test('no capability in a subframe', () => { assert.equal(setup({frame:true}).window.InfinitoolsNative, undefined); });
test('no capability on a foreign or different loopback origin', () => {
  for (const origin of ['https://example.org','http://localhost:18763','http://127.0.0.1:1111']) assert.equal(setup({origin}).window.InfinitoolsNative, undefined);
});
test('no capability without WK message handler', () => { assert.equal(setup({native:false}).window.InfinitoolsNative, undefined); });
test('native reply keeps request correlation', async () => {
  const {window} = setup();
  const response = new Promise(resolve => { window.InfinitoolsNative.onmessage = e => resolve(JSON.parse(e.data)); });
  window.InfinitoolsNative.postMessage('{"type":"start","requestId":"41"}');
  assert.deepEqual(await response, {requestId:'41',transferId:'a'});
});
test('native rejection becomes correlated error', async () => {
  const {window} = setup({reject:true});
  const response = new Promise(resolve => { window.InfinitoolsNative.onmessage = e => resolve(JSON.parse(e.data)); });
  window.InfinitoolsNative.postMessage('{"type":"chunk","requestId":"42"}');
  const reply = await response; assert.equal(reply.requestId,'42'); assert.match(reply.error,/rejected/);
});
test('malformed message is not posted to native', () => {
  const {window,calls} = setup(); window.InfinitoolsNative.postMessage('bad'); assert.equal(calls.length,0);
});
test('site fetch retains path, query, method, body and CSRF header', async () => {
  const {window,calls} = setup();
  const options = {method:'POST',body:'binary-body',headers:{'X-CSRF-Token':'synthetic'}};
  await window.fetch('https://www.infinitools.com.br/api/pdfa.php?a=1',options);
  assert.equal(calls[0][1],'http://127.0.0.1:18763/api/pdfa.php?a=1'); assert.equal(calls[0][2],options);
});
test('Request fetch retains its body and headers', async () => {
  const {window,calls} = setup();
  const request = new Request('https://www.infinitools.com.br/api/pdfa.php',{method:'POST',body:'abc',headers:{'X-CSRF-Token':'synthetic'}});
  await window.fetch(request);
  const forwarded = calls[0][1]; assert.equal(forwarded.url,'http://127.0.0.1:18763/api/pdfa.php');
  assert.equal(await forwarded.text(),'abc'); assert.equal(forwarded.headers.get('X-CSRF-Token'),'synthetic');
});
test('external domains are never sent to the backend proxy', async () => {
  const {window,calls} = setup(); await window.fetch('https://example.org/a'); assert.equal(calls[0][1],'https://example.org/a');
});
test('XHR preserves arguments while mapping the site origin', () => {
  const {XHR,calls} = setup(); new XHR().open('POST','https://www.infinitools.com.br/api/html-pdf.php',true);
  assert.deepEqual(calls[0],['xhr','POST','http://127.0.0.1:18763/api/html-pdf.php',true]);
});
test('blob popup is saved through the export bridge', () => {
  const {window,calls} = setup(); window.infinitoolsExportUrl = (...args)=>calls.push(['export',...args]);
  window.open('blob:http://127.0.0.1:18763/uuid'); assert.equal(calls[0][0],'export');
});
test('double script injection is idempotent', () => {
  const {window,context} = setup(); const native=window.InfinitoolsNative; vm.runInContext(script,context); assert.equal(window.InfinitoolsNative,native);
});
