/* DynaBoost - page-world helper for Edit flow, on make.powerautomate.com.
 *
 * Keeps the address and Authorization header of the portal's latest call to
 * the Power Platform API (*.api.powerplatform.com) and the Flow API
 * (*.api.flow.microsoft.com), in this page's memory only. Asked by the
 * content script (window.postMessage), it makes one of four fixed calls for
 * the flow in the URL and answers with the result only:
 *   get   - name, state, definition, connection references
 *   save  - PATCH of definition and connection references
 *   check - checkFlowErrors and checkFlowWarnings
 *   ready - which of the two APIs it has seen
 * The header never leaves the page.
 */
(function () {
  if (window.__dynaboostFlowEditHook) return;
  window.__dynaboostFlowEditHook = true;

  const PP = /(^|\.)api\.powerplatform\.com$/i;
  const FLOW = /(^|\.)api\.flow\.microsoft\.com$/i;
  const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ENV = /^[\w-]{1,80}$/;

  const pp = new Map(); // host -> { base, auth, at }
  let flow = null; // { base, auth, at }

  function note(url, auth) {
    if (!url || !auth || !/^Bearer\s/i.test(auth)) return;
    let u;
    try {
      u = new URL(url, location.href);
    } catch (e) {
      return;
    }
    const seen = { base: u.protocol + '//' + u.host + '/', auth: auth, at: Date.now() };
    if (PP.test(u.hostname)) pp.set(u.hostname.toLowerCase(), seen);
    else if (FLOW.test(u.hostname)) flow = seen;
  }

  function headerOf(headers) {
    if (!headers) return null;
    try {
      if (typeof headers.get === 'function') return headers.get('authorization');
      if (Array.isArray(headers)) {
        const h = headers.find((x) => String(x[0]).toLowerCase() === 'authorization');
        return h ? h[1] : null;
      }
      for (const k of Object.keys(headers)) if (k.toLowerCase() === 'authorization') return headers[k];
    } catch (e) {
      /* unreadable headers */
    }
    return null;
  }

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      try {
        const url = typeof input === 'string' ? input : input && input.url;
        const auth = headerOf(init && init.headers) || (input && typeof input !== 'string' ? headerOf(input.headers) : null);
        note(url, auth);
      } catch (e) {
        /* never in the portal's way */
      }
      return origFetch.apply(this, arguments);
    };
  }

  const origOpen = XMLHttpRequest.prototype.open;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__dbFlowUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      if (String(name).toLowerCase() === 'authorization') note(this.__dbFlowUrl, value);
    } catch (e) {
      /* ignore */
    }
    return origSetHeader.apply(this, arguments);
  };

  // The Power Platform host carries the environment in its name:
  // default1234...ab.cd.environment.api.powerplatform.com for Default-1234...abcd.
  function ppFor(env) {
    const key = String(env).toLowerCase().replace(/-/g, '');
    let best = null;
    for (const [host, seen] of pp) {
      if (host.replace(/\./g, '').indexOf(key) === 0) return seen;
      if (!best || seen.at > best.at) best = seen;
    }
    return best;
  }

  async function call(api, method, path, body) {
    const res = await origFetch(api.base + path, {
      method: method,
      headers: { Authorization: api.auth, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      /* not JSON */
    }
    if (!res.ok) {
      const msg = (data && data.error && (data.error.message || data.error.code)) || 'HTTP ' + res.status;
      const err = new Error(res.status === 401 ? 'The sign-in of this page has expired. Reload the flow page and try again.' : msg);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const legacyPath = (env, id) => 'providers/Microsoft.ProcessSimple/environments/' + encodeURIComponent(env) + '/flows/' + id;

  // Read and save go to the Power Platform API when the page has used it, the
  // Flow API otherwise - the same one for both, so a save lands where the read
  // came from.
  async function readOrWrite(env, id, method, body, via) {
    const p = via !== 'flow' ? ppFor(env) : null;
    if (via === 'pp' && !p) throw Object.assign(new Error('not ready'), { code: 'no-auth' });
    if (p) {
      try {
        return { via: 'pp', flow: await call(p, method, 'powerautomate/flows/' + id + '?api-version=1', body) };
      } catch (e) {
        if (via === 'pp' || !flow || (e.status && e.status !== 404 && e.status !== 403)) throw e;
      }
    }
    if (!flow) throw Object.assign(new Error('not ready'), { code: 'no-auth' });
    return { via: 'flow', flow: await call(flow, method, legacyPath(env, id) + '?api-version=2016-11-01', body) };
  }

  const list = (r) => (Array.isArray(r) ? r : r && Array.isArray(r.value) ? r.value : []);

  async function handle(d) {
    if (d.op === 'ready') return { pp: pp.size > 0, flow: !!flow };
    if (!GUID.test(d.flow || '') || !ENV.test(d.env || '')) throw new Error('No flow on this page.');
    if (d.op === 'get') return readOrWrite(d.env, d.flow, 'GET', null, null);
    if (d.op === 'save') {
      const b = d.body || {};
      return readOrWrite(
        d.env,
        d.flow,
        'PATCH',
        { properties: { displayName: b.displayName, environment: b.environment, definition: b.definition, connectionReferences: b.connectionReferences } },
        d.via
      );
    }
    if (d.op === 'check') {
      if (!flow) throw Object.assign(new Error('not ready'), { code: 'no-check' });
      const body = { properties: { definition: d.body && d.body.definition } };
      const base = legacyPath(d.env, d.flow);
      const [errors, warnings] = await Promise.all([
        call(flow, 'POST', base + '/checkFlowErrors?api-version=2016-11-01', body),
        call(flow, 'POST', base + '/checkFlowWarnings?api-version=2016-11-01', body)
      ]);
      return { errors: list(errors), warnings: list(warnings) };
    }
    throw new Error('Unknown request.');
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== 'dynaboost-flow-edit' || !d.id) return;
    handle(d).then(
      (data) => window.postMessage({ source: 'dynaboost-flow-edit-reply', id: d.id, ok: true, data: data }, location.origin),
      (err) =>
        window.postMessage(
          { source: 'dynaboost-flow-edit-reply', id: d.id, ok: false, error: String((err && err.message) || err), code: err && err.code, status: err && err.status },
          location.origin
        )
    );
  });
})();
