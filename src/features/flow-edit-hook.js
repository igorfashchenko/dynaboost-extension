/* DynaBoost - page-world helper for Edit flow, on make.powerautomate.com.
 *
 * Keeps the address and Authorization header of the portal's latest call to
 * the Power Platform API (*.api.powerplatform.com), the Flow API
 * (*.api.flow.microsoft.com) and the environment's Dataverse
 * (*.dynamics.com/api/data/ - the designer reads drafts there), in this
 * page's memory only. Asked by the content script (window.postMessage), it
 * makes one of these fixed calls for the flow in the URL and answers with
 * the result only:
 *   get     - name, state, definition, connection references (published)
 *   save    - PATCH of definition and connection references
 *   check   - checkFlowErrors and checkFlowWarnings
 *   draft   - the flow's unpublished draft in Dataverse, if it has one
 *   publish - publishes that draft, as Publish in the designer does
 *   ready   - which of the APIs it has seen
 *   repetitions - for Export run: each iteration of the given actions of a
 *             run of this flow (Apply to each, Do until) - read only
 * The header never leaves the page.
 *
 * A flow made new in the designer keeps its address (.../flows/new/...)
 * after it is saved. The id the save gives it - a PATCH or PUT of
 * .../flows/{id}, or the answer to the POST that created it - is passed to
 * the content script (dynaboost-flow-saved), so Edit flow knows the flow.
 *
 * Solution flows have drafts: saved in the designer, kept in Dataverse, not
 * seen by the APIs that get and save use - those see the published flow
 * only, and a flow never published is "Entity 'workflow' ... Does Not
 * Exist". The designer reads the draft with MSCRM.IncludeUnpublished and
 * publishes it with PublishComponent; so does this.
 */
(function () {
  if (window.__dynaboostFlowEditHook) return;
  window.__dynaboostFlowEditHook = true;

  const PP = /(^|\.)api\.powerplatform\.com$/i;
  const FLOW = /(^|\.)api\.flow\.microsoft\.com$/i;
  const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ENV = /^[\w-]{1,80}$/;

  const DV = /\.dynamics\.com$/i;
  const pp = new Map(); // host -> { base, auth, at }
  let flow = null; // { base, auth, at }
  let dv = null; // { base, auth, at } - the environment's Dataverse

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
    else if (DV.test(u.hostname) && /^\/api\/data\//i.test(u.pathname)) dv = seen;
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

  // Saves of a flow to the Flow API or the Power Platform API: the flow's id.
  const SAVED_ONE = /\/flows\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?(?:[?#]|$)/i;
  const CREATED = /\/flows\/?(?:[?#]|$)/i;
  const apiHost = (url) => {
    try {
      const h = new URL(url, location.href).hostname;
      return FLOW.test(h) || PP.test(h);
    } catch (e) {
      return false;
    }
  };
  function saved(id) {
    if (GUID.test(id || '')) window.postMessage({ source: 'dynaboost-flow-saved', flow: id.toLowerCase() }, location.origin);
  }
  // method, url: a request; text: the answer to a create.
  function watchSave(method, url, text) {
    if (!url || !apiHost(url)) return;
    const m = String(method || 'GET').toUpperCase();
    const one = SAVED_ONE.exec(new URL(url, location.href).pathname);
    if (one && (m === 'PATCH' || m === 'PUT')) return saved(one[1]);
    if (m === 'POST' && text !== undefined && CREATED.test(new URL(url, location.href).pathname)) {
      try {
        saved(JSON.parse(text).name);
      } catch (e) {
        /* not JSON */
      }
    }
  }

  // The page's own request is started a moment later, from a native function
  // rather than from here: one the page's CSP blocks is then not put on
  // DynaBoost's list of errors - Chrome files an error under the extension
  // whose code is on its stack. The answer is the same promise as before.
  const unblamed = (fetch, args) => Promise.resolve().then(Function.prototype.apply.bind(fetch, window, Array.from(args)));

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      let url;
      let method;
      try {
        url = typeof input === 'string' ? input : input && input.url;
        method = (init && init.method) || (input && typeof input !== 'string' && input.method) || 'GET';
        const auth = headerOf(init && init.headers) || (input && typeof input !== 'string' ? headerOf(input.headers) : null);
        note(url, auth);
        watchSave(method, url);
      } catch (e) {
        /* never in the portal's way */
      }
      const p = unblamed(origFetch, arguments);
      try {
        if (String(method).toUpperCase() === 'POST' && apiHost(url) && CREATED.test(new URL(url, location.href).pathname)) {
          p.then((res) => (res.ok ? res.clone().text().then((t) => watchSave('POST', url, t)) : null)).catch(() => {});
        }
      } catch (e) {
        /* ignore */
      }
      return p;
    };
  }

  const origOpen = XMLHttpRequest.prototype.open;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__dbFlowUrl = url;
    try {
      watchSave(method, url);
      if (String(method).toUpperCase() === 'POST' && apiHost(url) && CREATED.test(new URL(url, location.href).pathname) && !this.__dbFlowSaveListening) {
        this.__dbFlowSaveListening = true;
        this.addEventListener('load', () => {
          try {
            if (this.status >= 200 && this.status < 300) watchSave('POST', this.__dbFlowUrl, this.responseText);
          } catch (e) {
            /* ignore */
          }
        });
      }
    } catch (e) {
      /* never in the portal's way */
    }
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

  async function call(api, method, path, body, extra) {
    const res = await origFetch(api.base + path, {
      method: method,
      headers: Object.assign({ Authorization: api.auth, Accept: 'application/json', 'Content-Type': 'application/json' }, extra || {}),
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

  // A flow's definition as Dataverse keeps it: clientdata, a JSON string.
  function fromClientdata(row) {
    let c = null;
    try {
      c = JSON.parse((row && row.clientdata) || 'null');
    } catch (e) {
      /* not JSON */
    }
    const p = (c && c.properties) || {};
    return { definition: p.definition || null, connectionReferences: p.connectionReferences || {} };
  }

  const ROW = '?$select=name,clientdata,statecode,modifiedon,componentstate';

  /* The draft, if the flow has one: what the designer shows. available:
   * false when this page has not called Dataverse (no sign-in to reuse). */
  async function draftOf(id) {
    if (!dv) return { available: false };
    const path = 'api/data/v9.2/workflows(' + id + ')' + ROW;
    const latest = await call(dv, 'GET', path, null, { 'MSCRM.IncludeUnpublished': 'true' });
    let published = null;
    try {
      published = await call(dv, 'GET', path);
    } catch (e) {
      if (e.status !== 404 && e.status !== 400) throw e;
    }
    const d = fromClientdata(latest);
    // A draft: an unpublished row (componentstate 1) - even one whose
    // content matches the published flow, which Dataverse still guards.
    const same = !!published && published.clientdata === latest.clientdata && latest.componentstate !== 1;
    return {
      available: true,
      published: !!published,
      hasDraft: !same,
      name: latest.name || '',
      on: latest.statecode === 1,
      modified: latest.modifiedon || '',
      definition: d.definition,
      connectionReferences: d.connectionReferences
    };
  }

  // As Publish in the designer: the draft becomes the flow. on: whether it
  // is turned on after - the caller keeps it as it was.
  function publish(id, on) {
    if (!dv) throw Object.assign(new Error('not ready'), { code: 'no-dv' });
    return call(dv, 'POST', 'api/data/v9.2/PublishComponent?ActivateFlowOnPublish=' + (on ? 'true' : 'false'), { Target: '/workflows(' + id + ')' });
  }

  // The designer's checks: the Flow API, else the Power Platform API (which
  // also checks a flow that was never published).
  async function check(env, id, definition) {
    const body = { properties: { definition: definition } };
    const both = (api, base, version) =>
      Promise.all([
        call(api, 'POST', base + '/checkFlowErrors?api-version=' + version, body),
        call(api, 'POST', base + '/checkFlowWarnings?api-version=' + version, body)
      ]);
    const p = ppFor(env);
    if (!flow && !p) throw Object.assign(new Error('not ready'), { code: 'no-check' });
    let got;
    if (flow) {
      try {
        got = await both(flow, legacyPath(env, id), '2016-11-01');
      } catch (e) {
        if (!p) throw e;
      }
    }
    if (!got) got = await both(p, 'powerautomate/flows/' + id, '1');
    return { errors: list(got[0]), warnings: list(got[1]) };
  }

  /* Every iteration of an action inside a loop: its status, error, times and
   * the links to its inputs and outputs - the same answer the run view gets
   * when you page through a loop. The Flow API first, the Power Platform API
   * otherwise; an action that cannot be read says why, the others still come. */
  const RUN = /^[\w.-]{1,120}$/;
  const MAX_PAGES = 100;

  async function repetitionsOf(env, id, run, name) {
    const path = '/runs/' + encodeURIComponent(run) + '/actions/' + encodeURIComponent(name) + '/repetitions';
    const tries = [];
    if (flow) tries.push([flow, legacyPath(env, id) + path + '?api-version=2016-11-01']);
    const p = ppFor(env);
    if (p) tries.push([p, 'powerautomate/flows/' + id + path + '?api-version=1']);
    if (!tries.length) throw Object.assign(new Error('not ready'), { code: 'no-auth' });
    let last;
    for (const [api, first] of tries) {
      try {
        const out = [];
        let more = false;
        let page = await call(api, 'GET', first);
        for (let n = 1; ; n++) {
          out.push.apply(out, list(page));
          const next = page && page.nextLink;
          if (!next) break;
          const u = new URL(next);
          // Only further pages of the same answer, from the same host - and
          // not without end: more says there were pages left.
          if (n >= MAX_PAGES || u.protocol + '//' + u.host + '/' !== api.base) {
            more = true;
            break;
          }
          page = await call(api, 'GET', u.pathname.slice(1) + u.search);
        }
        const items = out.map((r) => {
          const q = (r && r.properties) || {};
          return {
            indexes: (q.repetitionIndexes || []).map((x) => ({ scope: x.scopeName, index: x.itemIndex })),
            status: q.status,
            code: q.code,
            error: q.error,
            startTime: q.startTime,
            endTime: q.endTime,
            retries: q.retryHistory,
            inputs: q.inputs,
            outputs: q.outputs,
            inputsLink: q.inputsLink,
            outputsLink: q.outputsLink
          };
        });
        return { items: items, more: more };
      } catch (e) {
        last = e;
      }
    }
    throw last;
  }

  async function repetitions(env, id, run, names) {
    if (!RUN.test(run || '')) throw new Error('No run on this page.');
    const todo = (Array.isArray(names) ? names : []).filter((n) => typeof n === 'string' && n && n.length <= 200).slice(0, 60);
    const out = {};
    for (let i = 0; i < todo.length; i += 4) {
      await Promise.all(
        todo.slice(i, i + 4).map(async (name) => {
          try {
            out[name] = Object.assign({ ok: true }, await repetitionsOf(env, id, run, name));
          } catch (e) {
            out[name] = { ok: false, error: String((e && e.message) || e), code: e && e.code, status: e && e.status };
          }
        })
      );
    }
    return out;
  }

  async function handle(d) {
    if (d.op === 'ready') return { pp: pp.size > 0, flow: !!flow, dv: !!dv };
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
    if (d.op === 'check') return check(d.env, d.flow, d.body && d.body.definition);
    if (d.op === 'draft') return draftOf(d.flow);
    if (d.op === 'repetitions') return repetitions(d.env, d.flow, d.body && d.body.run, d.body && d.body.actions);
    if (d.op === 'publish') {
      await publish(d.flow, !!(d.body && d.body.on));
      return { ok: true };
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
