/* DynaBoost - page-world hook for Export run. Wraps fetch and XMLHttpRequest
 * and forwards every run detail response to the content script
 * (postMessage). It only listens: no request is added, no token is read. The
 * feature keeps the newest poll per run.
 */
(function () {
  if (window.__dynaboostRunHook) return;
  window.__dynaboostRunHook = true;

  // .../runs/{runName}?api-version=1 - not the runs list, which ends in /runs.
  const RUN_RE = /\/runs\/[^/?#]+(?:[?#]|$)/i;

  function forward(url, text) {
    if (!url || !RUN_RE.test(url)) return;
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return;
    }
    if (!data || !data.properties || !data.properties.trigger) return;
    try {
      window.postMessage({ source: 'dynaboost-flow-run', run: data }, window.location.origin);
    } catch (e) {
      /* payload not cloneable - ignore */
    }
  }

  // The page's own request is started a moment later, from a native function
  // rather than from here: one the page's CSP blocks is then not put on
  // DynaBoost's list of errors - Chrome files an error under the extension
  // whose code is on its stack. The answer is the same promise as before.
  const unblamed = (fetch, args) => Promise.resolve().then(Function.prototype.apply.bind(fetch, window, Array.from(args)));

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (...args) {
      const p = unblamed(origFetch, args);
      try {
        const req = args[0];
        const url = typeof req === 'string' ? req : req && req.url;
        if (url && RUN_RE.test(url)) {
          p.then((res) => {
            res.clone().text().then((t) => forward(url, t)).catch(() => {});
          }).catch(() => {});
        }
      } catch (e) {
        /* ignore */
      }
      return p;
    };
  }

  // Only open is wrapped, not send - see env-list-hook.js: a wrapped send
  // puts DynaBoost on the stack of every request the page makes.
  const origOpen = XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__dbUrl = url;
    try {
      if (url && RUN_RE.test(url) && !this.__dbListening) {
        this.__dbListening = true;
        this.addEventListener('load', () => {
          try {
            if (this.__dbUrl && RUN_RE.test(this.__dbUrl)) forward(this.__dbUrl, this.responseText);
          } catch (e) {
            /* ignore */
          }
        });
      }
    } catch (e) {
      /* ignore */
    }
    return origOpen.apply(this, arguments);
  };
})();
