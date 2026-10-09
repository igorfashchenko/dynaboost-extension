/* DynaBoost - page-world helper for Compare, on make.powerapps.com and
 * make.powerautomate.com.
 *
 * The portal reads the list of the user's environments from its API when it
 * starts (".../environments", as JSON: each one's displayName and, under
 * linkedEnvironmentMetadata, its Dataverse address). This looks at those
 * answers as they arrive and keeps, in this page's memory, only each
 * environment's name and Dataverse address - nothing else of the answer,
 * and no sign-in. The content script (env-compare.js) gets them through
 * window.postMessage: on every new list, and when it asks.
 */
(function () {
  if (window.__dynaboostEnvListHook) return;
  window.__dynaboostEnvListHook = true;

  const LIST = /\/environments\/?$/i; // the list, not one environment
  const CRM = /^https?:\/\/([a-z0-9-]+\.crm[0-9]*\.dynamics\.com)(?:[/:?#]|$)/i;
  const CRM_ANY = /https?:\/\/([a-z0-9-]+\.crm[0-9]*\.dynamics\.com)/i;
  const MAX = 1000;
  const found = new Map(); // host -> { id, name, host }

  function isList(url) {
    try {
      return LIST.test(new URL(String(url), location.href).pathname);
    } catch (e) {
      return false;
    }
  }

  const text = (v) => (typeof v === 'string' ? v.trim() : '');

  // One environment as the APIs give it: { name, id, properties: {
  // displayName, linkedEnvironmentMetadata: { instanceUrl } } } - or, from
  // newer APIs, displayName and the address on the object itself.
  function take(item) {
    if (!item || typeof item !== 'object') return;
    const p = item.properties && typeof item.properties === 'object' ? item.properties : {};
    const name = text(p.displayName) || text(item.displayName) || text(p.friendlyName) || text(item.friendlyName);
    if (!name) return;
    const meta = p.linkedEnvironmentMetadata || item.linkedEnvironmentMetadata || {};
    let m = String(meta.instanceUrl || '').match(CRM);
    if (!m) {
      let all = '';
      try {
        all = JSON.stringify(item);
      } catch (e) {
        return;
      }
      m = all.match(CRM_ANY);
    }
    if (!m || found.size >= MAX) return;
    const host = m[1].toLowerCase();
    found.set(host, { id: text(item.name) || text(item.id), name: name.slice(0, 200), host: host });
  }

  function post() {
    if (!found.size) return;
    window.postMessage({ source: 'dynaboost-env-list', list: Array.from(found.values()) }, location.origin);
  }

  function read(data) {
    const items = data && Array.isArray(data.value) ? data.value : Array.isArray(data) ? data : null;
    if (!items) return;
    items.forEach(take);
    post();
  }

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input) {
      const p = origFetch.apply(this, arguments);
      try {
        const url = input && typeof input === 'object' && 'url' in input ? input.url : input;
        if (isList(url)) {
          p.then(
            (res) => res && res.ok && res.clone().json().then(read, () => {}),
            () => {}
          );
        }
      } catch (e) {
        /* never in the portal's way */
      }
      return p;
    };
  }

  /* Only open is wrapped, not send: the list's answer is listened for from
   * there. A wrapped send is on the stack of every request the page makes,
   * so Chrome would put the portal's own blocked requests (its connectivity
   * checks against its CSP) on DynaBoost's list of errors. */
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__dbEnvList = isList(url);
    if (this.__dbEnvList && !this.__dbEnvListening) {
      this.__dbEnvListening = true;
      this.addEventListener('load', function () {
        try {
          if (!this.__dbEnvList || this.status < 200 || this.status >= 300) return;
          const t = this.responseType;
          if (t === 'json') read(this.response);
          else if (t === '' || t === 'text') read(JSON.parse(this.responseText));
        } catch (e) {
          /* not JSON */
        }
      });
    }
    return origOpen.apply(this, arguments);
  };

  // The content script starts later than this: it asks for what is here.
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.source === 'dynaboost-env-list-ask') post();
  });
})();
