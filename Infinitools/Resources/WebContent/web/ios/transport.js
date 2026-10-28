/* iOS transport. Only the top-level, fixed loopback origin receives native capabilities. */
(() => {
  'use strict';
  if (window.top !== window || location.origin !== 'http://127.0.0.1:18763' || window.__infinitoolsIOSTransport) return;
  const handler = window.webkit?.messageHandlers?.infinitools;
  if (!handler) return;
  window.__infinitoolsIOSTransport = true;
  const native = {
    onmessage: null,
    postMessage(raw) {
      let request;
      try { request = JSON.parse(raw); } catch { return; }
      handler.postMessage(raw).then(response => {
        native.onmessage?.({data: JSON.stringify(response)});
      }, error => {
        native.onmessage?.({data: JSON.stringify({requestId: request.requestId, error: String(error)})});
      });
    }
  };
  Object.defineProperty(window, 'InfinitoolsNative', {value: native, configurable: false, writable: false});
  const localize = value => {
    const url = new URL(value, location.href);
    return url.origin === 'https://www.infinitools.com.br' ? location.origin + url.pathname + url.search + url.hash : url.href;
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, options) => {
    if (input instanceof Request) {
      const url = localize(input.url);
      return originalFetch(url === input.url ? input : new Request(url, input), options);
    }
    return originalFetch(localize(String(input)), options);
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) { return open.call(this, method, localize(String(url)), ...rest); };
  const originalWindowOpen = window.open.bind(window);
  window.open = function(url, ...rest) {
    if (url && /^(blob:|data:)/.test(String(url)) && window.infinitoolsExportUrl) {
      window.infinitoolsExportUrl(String(url), 'resultado.pdf'); return null;
    }
    return originalWindowOpen(url ? localize(String(url)) : url, ...rest);
  };
})();
