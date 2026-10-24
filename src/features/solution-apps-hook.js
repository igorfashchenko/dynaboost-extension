/* DynaBoost - page-world helper for My shortcuts, on make.powerapps.com.
 *
 * Inside a solution the portal lists what the solution holds from its API
 * (msdyn_solutioncomponentsummaries, on the environment's Dataverse). This
 * looks at those answers as they arrive and keeps, in this page's memory,
 * only the apps among them - each one's id, name, kind (model-driven or
 * canvas), solution and the Dataverse address it came from - and, from the
 * Power Apps API's app lists, the address an app opens at. Nothing else of
 * the answers, and no sign-in. The content script (solution-pins.js) gets
 * them through window.postMessage, on every change and when it asks.
 */
(function () {
  if (window.__dynaboostSolutionAppsHook) return;
  window.__dynaboostSolutionAppsHook = true;

  const SUMMARIES = /\/api\/data\/v[0-9.]+\/msdyn_solutioncomponentsummaries/i;
  const APP_LISTS = /\/providers\/Microsoft\.PowerApps\/(?:scopes\/[^/]+\/)?apps/i;
  const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const MODEL = 80; // solution component types
  const CANVAS = 300;
  const MAX = 500;
  const apps = new Map(); // sol|id -> { sol, id, name, type, host }
  const opens = new Map(); // app id -> the address it opens at

  const text = (v) => (typeof v === 'string' ? v.trim() : '');
  const kind = (u) => {
    try {
      const p = new URL(String(u), location.href);
      return SUMMARIES.test(p.pathname) ? 'summaries' : APP_LISTS.test(p.pathname) ? 'apps' : '';
    } catch (e) {
      return '';
    }
  };

  function post() {
    window.postMessage(
      { source: 'dynaboost-solution-apps', apps: Array.from(apps.values()), opens: Array.from(opens.entries()) },
      location.origin
    );
  }

  function read(url, data) {
    const items = data && Array.isArray(data.value) ? data.value : null;
    if (!items) return;
    const what = kind(url);
    let changed = false;
    if (what === 'summaries') {
      // The solution, when the rows do not carry it: the query's own filter.
      let decoded = String(url);
      try {
        decoded = decodeURIComponent(decoded);
      } catch (e) {
        /* as it is */
      }
      const inQuery = (decoded.match(/msdyn_solutionid\s+eq\s+'?\{?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) || [])[1] || '';
      // The portal may ask Dataverse at org.api.crm4.dynamics.com; apps open at org.crm4.dynamics.com.
      const host = new URL(String(url), location.href).hostname.toLowerCase().replace(/\.api\.(crm[0-9]*\.dynamics\.com)$/, '.$1');
      for (const r of items) {
        const type = Number(r && r.msdyn_componenttype);
        const id = text(r && r.msdyn_objectid).toLowerCase();
        const sol = (text(r && r.msdyn_solutionid) || inQuery).toLowerCase();
        if ((type !== MODEL && type !== CANVAS) || !GUID.test(id) || apps.size >= MAX) continue;
        apps.set(sol + '|' + id, {
          sol: sol,
          id: id,
          name: (text(r.msdyn_displayname) || text(r.msdyn_name)).slice(0, 200),
          type: type === MODEL ? 'model' : 'canvas',
          host: host
        });
        changed = true;
      }
    } else if (what === 'apps') {
      for (const a of items) {
        const id = text(a && a.name).toLowerCase();
        const uri = text(a && a.properties && a.properties.appOpenUri);
        if (!GUID.test(id) || !/^https:\/\//i.test(uri) || opens.size >= MAX) continue;
        opens.set(id, uri.slice(0, 600));
        changed = true;
      }
    }
    if (changed) post();
  }

  // The page's own request is started a moment later, from a native function
  // rather than from here: one the page's CSP blocks is then not put on
  // DynaBoost's list of errors - Chrome files an error under the extension
  // whose code is on its stack. The answer is the same promise as before.
  const unblamed = (fetch, args) => Promise.resolve().then(Function.prototype.apply.bind(fetch, window, Array.from(args)));

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input) {
      const p = unblamed(origFetch, arguments);
      try {
        const url = input && typeof input === 'object' && 'url' in input ? input.url : input;
        if (kind(url)) {
          p.then(
            (res) => res && res.ok && res.clone().json().then((d) => read(url, d), () => {}),
            () => {}
          );
        }
      } catch (e) {
        /* never in the portal's way */
      }
      return p;
    };
  }

  // Only open is wrapped, not send - see env-list-hook.js.
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      if (kind(url) && !this.__dbAppsListening) {
        this.__dbAppsListening = true;
        this.addEventListener('load', () => {
          try {
            if (this.status >= 200 && this.status < 300) read(url, JSON.parse(this.responseText));
          } catch (e) {
            /* not JSON */
          }
        });
      }
    } catch (e) {
      /* ignore */
    }
    return origOpen.apply(this, arguments);
  };

  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.source === 'dynaboost-solution-apps-ask') post();
  });
})();
