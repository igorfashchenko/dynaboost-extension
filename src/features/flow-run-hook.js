/* DynaBoost - page-context hook for flow runs.
 *
 * Runs in the page's own world (not the content script sandbox) so it can wrap
 * window.fetch and XMLHttpRequest. It only listens: every response whose URL
 * looks like a single run detail is parsed and forwarded to the content script
 * via postMessage. Nothing is sent anywhere else, no request is added, and no
 * token is ever read.
 *
 * We forward every poll, including the ones taken while the run is still
 * Running (those carry few or no actions). The feature keeps the newest one
 * per run, so the final, complete poll wins.
 */
(function () {
  if (window.__dynaboostRunHook) return;
  window.__dynaboostRunHook = true;

  // .../runs/08584126666916719145527246181CU26?api-version=1
  // The runs *list* ends in /runs, so requiring a segment after it keeps the
  // list out - it carries no actions anyway.
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

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (...args) {
      const p = origFetch.apply(this, args);
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

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__dbUrl = url;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    try {
      if (this.__dbUrl && RUN_RE.test(this.__dbUrl)) {
        this.addEventListener('load', () => {
          try {
            forward(this.__dbUrl, this.responseText);
          } catch (e) {
            /* ignore */
          }
        });
      }
    } catch (e) {
      /* ignore */
    }
    return origSend.apply(this, arguments);
  };
})();
