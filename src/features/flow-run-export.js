/* Feature: Export run. Opens the run you are looking at in a read-only tab:
 * the trigger and every action with inputs, outputs, status, timing and
 * errors - and beside them the Dataverse records the run touched, each with
 * its table and a link to open it in Dynamics 365 - and the SharePoint
 * files it created, changed or read, with links to each file and its folder.
 *
 * The data is the portal's own .../runs/{runName}?api-version=1 response,
 * passed on by flow-run-hook.js. Large payloads come as inputsLink /
 * outputsLink (SAS URLs that expire) and are fetched on the click - and so
 * is a large body inside them, which comes as a link of its own
 * (bodyContentLink).
 *
 * Apply to each and Do until: every iteration of the actions inside, asked
 * of Power Automate through the page's own sign-in (flow-edit-hook.js,
 * "repetitions" - one request per action, not per item). A loop that ran
 * more than once gets its iterations in the tab: a strip of numbers, the
 * failed ones red and shown first, one iteration's actions under it, and
 * copies of one iteration or of the failed ones. A loop that ran once shows
 * its actions as they are, with nothing more.
 *
 * A failed run opens with Where it failed: the step the failure started in
 * (not the scopes that failed because of it), its code, its message and the
 * service's own words from the response body.
 */
(function () {
  if (DynaBoost.off) return;
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M6 3h8l4 4v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" stroke="#3D8BFF" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M8 9h6M8 12.5h6M8 16h3" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="m16 19.5 2 2 4-4.5" stroke="#E3B04B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  // Newest capture per run name. Later polls are more complete than earlier
  // ones (a run still Running carries few actions), so we simply overwrite.
  // The last one seen remembers the flow it was seen on: the portal moves
  // from flow to flow without loading the page again.
  const runs = new Map();
  let lastSeen = null;

  function flowIdFromUrl() {
    const m = location.pathname.match(/\/flows\/([^/?#]+)/i);
    return m ? m[1].toLowerCase() : null;
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== 'dynaboost-flow-run' || !d.run || !d.run.name) return;
    runs.set(d.run.name, d.run);
    lastSeen = { name: d.run.name, flow: flowIdFromUrl() };
  });

  function injectHook() {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('src/features/flow-run-hook.js');
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  }

  function runIdFromUrl() {
    const m = location.pathname.match(/\/runs\/([^/?#]+)/i);
    return m ? m[1] : null;
  }

  function pickRun() {
    const fromUrl = runIdFromUrl();
    if (fromUrl && runs.has(fromUrl)) return runs.get(fromUrl);
    if (fromUrl) return null;
    // No run in the address: the last run seen, if it was this flow's.
    return lastSeen && lastSeen.flow === flowIdFromUrl() ? runs.get(lastSeen.name) : null;
  }

  // The run's environment and flow, from its own id - the address as a fallback.
  function whereOf(run) {
    const id = String((run && run.id) || '');
    const e = /\/environments\/([^/]+)\//i.exec(id) || /\/environments\/([^/?#]+)/i.exec(location.pathname);
    const f = /\/flows\/([^/]+)\//i.exec(id) || /\/flows\/([^/?#]+)/i.exec(location.pathname);
    return { env: e ? decodeURIComponent(e[1]) : '', flow: f ? decodeURIComponent(f[1]).toLowerCase() : '' };
  }

  // Asks flow-edit-hook.js, in the page, with the page's sign-in.
  const waiting = new Map();
  let seq = 0;
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== 'dynaboost-flow-edit-reply' || !waiting.has(d.id)) return;
    const w = waiting.get(d.id);
    waiting.delete(d.id);
    clearTimeout(w.timer);
    if (d.ok) w.resolve(d.data);
    else w.reject(Object.assign(new Error(d.error), { code: d.code }));
  });

  function askHook(op, where, body) {
    return new Promise((resolve, reject) => {
      const id = 'dbre' + ++seq + '-' + Date.now();
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error('Power Automate did not answer.'));
      }, 60000);
      waiting.set(id, { resolve, reject, timer });
      window.postMessage({ source: 'dynaboost-flow-edit', id: id, op: op, env: where.env, flow: where.flow, body: body }, location.origin);
    });
  }

  // ---------- collecting ----------

  function duration(a) {
    if (!a.startTime || !a.endTime) return '';
    const ms = new Date(a.endTime) - new Date(a.startTime);
    if (!isFinite(ms)) return '';
    return ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(2) + ' s';
  }

  // How long, as one says it: 250 ms, 3.4 s, 4 min 12 s, 1 h 5 min.
  function took(ms) {
    if (!(ms >= 0)) return '';
    if (ms < 1000) return Math.round(ms) + ' ms';
    if (ms < 60000) return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + ' s';
    const s = Math.round(ms / 1000);
    if (s < 3600) return Math.floor(s / 60) + ' min' + (s % 60 ? ' ' + (s % 60) + ' s' : '');
    return Math.floor(s / 3600) + ' h' + (Math.round((s % 3600) / 60) ? ' ' + Math.round((s % 3600) / 60) + ' min' : '');
  }
  const spanOf = (a) => Date.parse(a.endTime) - Date.parse(a.startTime);
  // The connector a step uses, by the end of its apiId: '.../apis/office365'
  // in a run, '.../apis/shared_office365' in a definition.
  const connectorOf = (host) => {
    const h = host && typeof host === 'object' ? host : {};
    const c = h.connection;
    const m = /\/apis\/([^/]+)/i.exec(String(h.apiId || (c && typeof c === 'object' ? c.name : c) || ''));
    return String(m ? m[1] : h.connectionReferenceName || h.connectionName || '')
      .toLowerCase()
      .replace(/^shared_/, '')
      .replace(/[-_]\d+$/, '');
  };

  async function fetchLink(link) {
    if (link && link.secureData && !link.uri) return '[hidden - secured in the flow]';
    if (!link || typeof link.uri !== 'string' || !/^https:\/\//i.test(link.uri)) return undefined;
    // Guard against pulling something enormous into a tab.
    if (link.contentSize && link.contentSize > 2 * 1024 * 1024) {
      return '[not fetched - ' + link.contentSize + ' bytes]';
    }
    try {
      const res = await fetch(link.uri);
      if (!res.ok) return '[fetch failed - HTTP ' + res.status + ']';
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch (e) {
        return text;
      }
    } catch (e) {
      // Almost always an expired SAS signature.
      return '[fetch failed - link may have expired]';
    }
  }

  async function collect(run, onProgress) {
    const p = run.properties || {};
    const steps = [];

    const trigger = p.trigger || {};
    steps.push({
      name: trigger.name || 'Trigger',
      kind: 'Trigger',
      status: trigger.status,
      code: trigger.code,
      startTime: trigger.startTime,
      endTime: trigger.endTime,
      error: trigger.error,
      retries: trigger.retryHistory,
      inputs: trigger.inputs,
      outputs: trigger.outputs,
      inputsLink: trigger.inputsLink,
      outputsLink: trigger.outputsLink
    });

    const actions = p.actions || {};
    for (const key of Object.keys(actions)) {
      const a = actions[key];
      steps.push({
        name: key,
        kind: 'Action',
        status: a.status,
        code: a.code,
        startTime: a.startTime,
        endTime: a.endTime,
        error: a.error,
        retries: a.retryHistory,
        loop: a.repetitionCount || a.iterationCount,
        inputs: a.inputs,
        outputs: a.outputs,
        inputsLink: a.inputsLink,
        outputsLink: a.outputsLink
      });
    }

    steps.sort((x, y) => new Date(x.startTime || 0) - new Date(y.startTime || 0));

    // The loops' iterations; their actions' payloads up to a budget, the
    // failed iterations first - the rest when an iteration is opened.
    const loops = await loopsOf(run, steps);
    const inner = new Set(loops ? loops.inner : []);
    const early = [];
    if (loops) {
      const its = [];
      for (const l of loops.list) its.push.apply(its, l.iterations);
      its.sort((a, b) => (b.status === 'Failed') - (a.status === 'Failed'));
      let links = 0;
      for (const it of its) {
        const n = linksIn(it.actions);
        if (links && links + n > UPFRONT) break;
        links += n;
        early.push.apply(early, it.actions);
      }
    }
    await fill(steps.filter((s) => !inner.has(s.name)).concat(early), fetchHere, onProgress);
    return { steps: steps, loops: loops };
  }

  const UPFRONT = 150; // payload links fetched before the tab opens
  const PREFETCH = 400; // and after it, in the background, for the copies
  const LIMIT = 6;

  const linksIn = (acts) => acts.reduce((n, a) => n + (a.loaded ? 0 : (a.inputs === undefined && a.inputsLink ? 1 : 0) + (a.outputs === undefined && a.outputsLink ? 1 : 0)), 0);
  const fetchHere = (links) => Promise.all(links.map(fetchLink));

  /* What the portal did not inline - inputs, outputs, then a large body
   * inside them (bodyContentLink) - fetched for these steps, each step once.
   * fetchMany takes up to LIMIT links: fetched here, or by the frame. */
  async function fill(list, fetchMany, onProgress) {
    const todo = list.filter((s) => !s.loaded);
    const jobs = [];
    for (const s of todo) {
      if (s.inputs === undefined && s.inputsLink) jobs.push([s, 'inputs', s.inputsLink]);
      if (s.outputs === undefined && s.outputsLink) jobs.push([s, 'outputs', s.outputsLink]);
    }
    let done = 0;
    for (let i = 0; i < jobs.length; i += LIMIT) {
      const slice = jobs.slice(i, i + LIMIT);
      const got = await fetchMany(slice.map((x) => x[2]));
      slice.forEach((x, k) => (x[0][x[1]] = got[k]));
      done += slice.length;
      if (onProgress) onProgress(done, jobs.length);
    }

    // A large body inside them is one more link: fetched, and put where the
    // body belongs - the error a service sent back is often there.
    const inner = [];
    for (const s of todo) {
      contentLinks(s.inputs, inner, 0);
      contentLinks(s.outputs, inner, 0);
    }
    const total = jobs.length + inner.length;
    for (let i = 0; i < inner.length; i += LIMIT) {
      const slice = inner.slice(i, i + LIMIT);
      const got = await fetchMany(slice.map((x) => x[3]));
      slice.forEach(([obj, key, base], k) => {
        if (obj[base] === undefined) {
          delete obj[key];
          obj[base] = got[k];
        } else obj[key] = got[k];
      });
      done += slice.length;
      if (onProgress) onProgress(done, total);
    }
    for (const s of todo) s.loaded = true;
  }

  // ---------- loops ----------

  /* Every iteration of the actions inside Apply to each and Do until, by
   * loop and iteration (nested loops: the innermost, its number "2 › 3").
   * An action whose iterations could not be read stays a step of the run,
   * as before; error says why. A loop not read to its end (Power Automate
   * had more pages than the hook reads) keeps how many times it ran - total
   * - and says it is partial. */
  async function loopsOf(run, steps) {
    const names = steps.filter((s) => s.kind === 'Action' && s.loop).map((s) => s.name);
    const ran = new Map(steps.filter((s) => s.kind === 'Action' && s.loop).map((s) => [s.name, Number(s.loop) || 0]));
    if (!names.length) return null;
    let got;
    try {
      got = await askHook('repetitions', whereOf(run), { run: run.name, actions: names });
    } catch (e) {
      return { list: [], inner: [], error: e.code === 'no-auth' ? 'reload the run page and try again' : e.message };
    }
    const byName = new Map();
    const at = new Map();
    const inner = [];
    let error = '';
    for (const name of names) {
      const r = got && got[name];
      if (!r || !r.ok || !Array.isArray(r.items) || !r.items.length) {
        if (r && !r.ok && !error) error = r.code === 'no-auth' ? 'reload the run page and try again' : r.error;
        continue;
      }
      inner.push(name);
      for (const x of r.items) {
        if (!x.indexes || !x.indexes.length) continue;
        const loopName = x.indexes[x.indexes.length - 1].scope;
        let loop = byName.get(loopName);
        if (!loop) byName.set(loopName, (loop = { name: loopName, iterations: [], ran: 0, cut: false }));
        loop.ran = Math.max(loop.ran, ran.get(name) || 0);
        if (r.more) loop.cut = true;
        if (x.indexes.length > 1) loop.outer = x.indexes[x.indexes.length - 2].scope;
        const key = x.indexes.map((y) => y.index).join('.');
        let it = at.get(loopName + '|' + key);
        if (!it) {
          it = { key: key, label: x.indexes.map((y) => y.index + 1).join(' \u203a '), path: x.indexes.map((y) => y.index), actions: [] };
          at.set(loopName + '|' + key, it);
          loop.iterations.push(it);
        }
        it.actions.push({
          name: name,
          kind: 'Action',
          status: x.status,
          code: x.code,
          error: x.error,
          startTime: x.startTime,
          endTime: x.endTime,
          retries: x.retries,
          inputs: x.inputs,
          outputs: x.outputs,
          inputsLink: x.inputsLink,
          outputsLink: x.outputsLink
        });
      }
    }
    const byTime = (a, b) => new Date(a.startTime || 0) - new Date(b.startTime || 0);
    const byPath = (a, b) => {
      for (let i = 0; i < Math.max(a.path.length, b.path.length); i++) if ((a.path[i] || 0) !== (b.path[i] || 0)) return (a.path[i] || 0) - (b.path[i] || 0);
      return 0;
    };
    for (const loop of byName.values()) {
      loop.total = Math.max(loop.ran, loop.iterations.length);
      loop.partial = loop.cut || loop.total > loop.iterations.length;
      loop.iterations.sort(byPath);
      for (const it of loop.iterations) {
        it.actions.sort(byTime);
        it.status = iterStatus(it.actions);
        it.startTime = it.actions[0].startTime;
        it.endTime = it.actions.reduce((m, a) => (a.endTime && (!m || a.endTime > m) ? a.endTime : m), '');
      }
    }
    return { list: Array.from(byName.values()), inner: inner, error: inner.length < names.length ? error : '' };
  }

  function iterStatus(acts) {
    if (acts.some((a) => FAILED.test(a.status || ''))) return 'Failed';
    if (acts.some((a) => /^(Running|Waiting)$/i.test(a.status || ''))) return 'Running';
    if (acts.every((a) => /^Skipped$/i.test(a.status || ''))) return 'Skipped';
    return 'Succeeded';
  }

  // bodyContentLink, $contentLink ...: [the object, the key, where the
  // content goes, the link] - up to 20 a run.
  function contentLinks(v, out, depth) {
    if (!v || typeof v !== 'object' || depth > 6 || out.length >= 20) return out;
    for (const k of Object.keys(v)) {
      const x = v[k];
      const m = /^\$?(.*)contentlink$/i.exec(k);
      if (m && x && typeof x.uri === 'string' && /^https:\/\//i.test(x.uri)) out.push([v, k, m[1] || 'body', x]);
      else contentLinks(x, out, depth + 1);
    }
    return out;
  }

  // ---------- where it failed ----------

  const FAILED = /^(Failed|TimedOut|Faulted|Aborted)$/i;
  // A scope, condition or loop fails when a step inside it fails: it is not
  // where the failure started.
  const followed = (s) => !!s.error && (/^ActionFailed$/i.test(s.error.code || '') || /No dependent actions succeeded/i.test(s.error.message || ''));

  /* The service's own words, from the response body: every message an error
   * carries (error.message, Message, error_description, OData's
   * message.value ...), or the body itself when it is plain text. */
  function detailsOf(s) {
    const out = [];
    const known = String((s.error && s.error.message) || '').trim();
    const add = (t) => {
      t = String(t == null ? '' : t).trim();
      if (!t || t === known || out.includes(t) || out.length >= 6) return;
      out.push(t.length > 1500 ? t.slice(0, 1500) + '\u2026' : t);
    };
    const MSG = /^(message|errormessage|error_description|exceptionmessage|detail|details|reason)$/i;
    const walk = (v, depth) => {
      if (v == null || depth > 6) return;
      if (typeof v === 'string') {
        const t = v.trim();
        if (/^[[{]/.test(t)) {
          try {
            return walk(JSON.parse(t), depth + 1);
          } catch (e) {
            /* not JSON */
          }
        }
        return;
      }
      if (Array.isArray(v)) return v.slice(0, 10).forEach((x) => walk(x, depth + 1));
      if (typeof v !== 'object') return;
      for (const k of Object.keys(v)) {
        const x = v[k];
        if (MSG.test(k) && typeof x === 'string') add(x);
        else if (MSG.test(k) && x && typeof x.value === 'string') add(x.value);
        else if (/^error$/i.test(k) && typeof x === 'string') add(x);
        else walk(x, depth + 1);
      }
    };
    const o = s.outputs;
    const body = o && typeof o === 'object' && !Array.isArray(o) ? (o.body !== undefined ? o.body : o) : o;
    walk(body, 0);
    if (!out.length && typeof body === 'string' && body.trim() && !/^\[(fetch failed|not fetched|hidden)/.test(body)) {
      add(body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 800));
    }
    return out;
  }

  function rootOf(s) {
    const o = s.outputs && typeof s.outputs === 'object' ? s.outputs : {};
    const inp = s.inputs && typeof s.inputs === 'object' ? s.inputs : {};
    return {
      step: s.name,
      kind: s.kind,
      status: s.status,
      code: (s.error && s.error.code) || s.code || undefined,
      statusCode: o.statusCode || undefined,
      message: (s.error && s.error.message) || undefined,
      details: detailsOf(s),
      operation: (inp.host && inp.host.operationId) || inp.method || undefined,
      retries: Array.isArray(s.retries) && s.retries.length ? s.retries.length : undefined,
      loop: s.loop || undefined
    };
  }

  /* The steps a failure started in - each with what it said - and the ones
   * that failed because of them. Inside a loop: the action, once, with the
   * iterations it failed in (what it said: in the first of them). */
  function failureOf(steps, loops) {
    const failed = steps.map((s, i) => ({ s: s, i: i })).filter((x) => FAILED.test(x.s.status || ''));
    const inLoops = [];
    (loops ? loops.list : []).forEach((l, li) => {
      const by = new Map();
      for (const it of l.iterations) {
        for (const a of it.actions) {
          if (!FAILED.test(a.status || '') || followed(a)) continue;
          if (!by.has(a.name)) by.set(a.name, { a: a, items: [] });
          by.get(a.name).items.push({ key: it.key, label: it.label });
        }
      }
      for (const r of by.values()) {
        inLoops.push({
          at: r.a.startTime,
          root: Object.assign(rootOf(r.a), { inLoop: l.name, li: li, iterations: r.items }, l.partial ? { partial: true, read: l.iterations.length } : {})
        });
      }
    });
    if (!failed.length && !inLoops.length) return null;
    const roots = failed.filter((x) => !followed(x.s));
    const firsts = (roots.length || inLoops.length ? roots : failed.slice(0, 1)).map((x) => ({ at: x.s.startTime, root: Object.assign({ i: x.i }, rootOf(x.s)) }));
    const all = firsts.concat(inLoops).sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
    return {
      roots: all.slice(0, 4).map((x) => x.root),
      followed: failed.filter((x) => followed(x.s)).map((x) => x.s.name),
      skipped: steps.filter((s) => /^Skipped$/i.test(s.status || '')).length
    };
  }

  // ---------- the records a run touched ----------

  /* Every Dataverse record the run read, created, changed or pointed at,
   * found in the trigger's and the actions' inputs and outputs: a row (with
   * @odata.id, or its type and key), a lookup on one (_x_value with its
   * table), and the table and id an action was given. Each once, with the
   * steps that touched it; a link opens it in Dynamics 365. */
  const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ODATA_ID = /^https:\/\/([a-z0-9-]+\.crm[0-9]*\.dynamics\.com)\/api\/data\/v[0-9.]+\/([a-z0-9_]+)\(([0-9a-f-]{36})\)/i;
  // Who made or owns a row - on every row, never what a flow is about.
  const SYSTEM_LOOKUPS = /^_(createdby|modifiedby|createdonbehalfby|modifiedonbehalfby|owninguser|owningteam|owningbusinessunit|ownerid|transactioncurrencyid|organizationid|stageid|processid|slainvokedid|slaid|msdyn_[a-z]*sla[a-z]*)_value$/i;
  const NAME_KEYS = ['fullname', 'name', 'subject', 'title', 'topic', 'ticketnumber', 'domainname'];
  const ROLE_OF = {
    CreateRecord: 'Created',
    UpdateRecord: 'Updated',
    UpdateOnlyRecord: 'Updated',
    UpsertRecord: 'Updated',
    DeleteRecord: 'Deleted',
    GetItem: 'Read',
    GetRecord: 'Read',
    ListRecords: 'Listed',
    ListRecordsWithOrganization: 'Listed',
    GetItemWithOrganization: 'Read',
    CreateRecordWithOrganization: 'Created',
    UpdateRecordWithOrganization: 'Updated',
    DeleteRecordWithOrganization: 'Deleted'
  };
  const MAX_RECORDS = 200;
  const MAX_PER_LIST = 25;

  // An entity set name to a table name: what the run itself showed first,
  // else the plural taken off.
  function singular(set, known) {
    const k = String(set || '').toLowerCase();
    if (known[k]) return known[k];
    if (/ies$/.test(k)) return k.slice(0, -3) + 'y';
    if (/(sses|xes|ches|shes)$/.test(k)) return k.slice(0, -2);
    return k.replace(/s$/, '');
  }

  function nameOf(row) {
    for (const k of NAME_KEYS) if (typeof row[k] === 'string' && row[k].trim()) return row[k].trim();
    for (const k of Object.keys(row)) {
      if (/^[a-z0-9]+_name$/i.test(k) && typeof row[k] === 'string' && row[k].trim()) return row[k].trim();
    }
    return '';
  }

  function findRecords(steps) {
    const found = new Map(); // table:id -> record
    const known = Object.create(null); // entity set -> table, as seen
    let host = '';

    const add = (r, step, role) => {
      if (!r.id || !GUID_RE.test(r.id) || !r.entity) return;
      const key = r.entity + ':' + r.id.toLowerCase();
      let rec = found.get(key);
      if (!rec) {
        if (found.size >= MAX_RECORDS) return;
        rec = { entity: r.entity, id: r.id.toLowerCase(), name: '', host: '', how: [] };
        found.set(key, rec);
      }
      if (!rec.name && r.name) rec.name = r.name;
      if (!rec.host && r.host) rec.host = r.host;
      const how = role + (r.via ? ' · ' + r.via : '');
      if (!rec.how.some((h) => h.step === step && h.how === how)) rec.how.push({ step: step, how: how });
    };

    // One row of a table, from what it carries about itself.
    function rowOf(o) {
      let entity = '';
      let id = '';
      let rowHost = '';
      const odata = String(o['@odata.id'] || o['@odata.editLink'] || '');
      const m = ODATA_ID.exec(odata);
      if (m) {
        rowHost = m[1].toLowerCase();
        id = m[3];
      }
      const type = /^#Microsoft\.Dynamics\.CRM\.([a-z0-9_]+)$/i.exec(String(o['@odata.type'] || ''));
      if (type) entity = type[1].toLowerCase();
      const ctx = /\$metadata#([a-z0-9_]+)(?:\/\$entity|\(|$)/i.exec(String(o['@odata.context'] || ''));
      const set = (m && m[2]) || (ctx && ctx[1]) || '';
      if (!entity) {
        // The key named after its table: contactid on a contact.
        const keys = Object.keys(o).filter((k) => /^[a-z0-9_]+id$/i.test(k) && GUID_RE.test(String(o[k])));
        const guess = set ? singular(set, known) : '';
        const own = keys.find((k) => k.slice(0, -2) === guess) || keys.find((k) => id && String(o[k]).toLowerCase() === id.toLowerCase()) || (o.ItemInternalId && keys.find((k) => String(o[k]).toLowerCase() === String(o.ItemInternalId).toLowerCase()));
        if (own) entity = own.slice(0, -2).toLowerCase();
        else if (guess) entity = guess;
      }
      if (!id && entity && GUID_RE.test(String(o[entity + 'id'] || ''))) id = String(o[entity + 'id']);
      if (set && entity) known[set.toLowerCase()] = entity;
      if (rowHost && !host) host = rowHost;
      return entity && id ? { entity: entity, id: id, name: nameOf(o), host: rowHost } : null;
    }

    // The lookups on a row: the records it points at.
    function lookupsOf(o, step) {
      for (const k of Object.keys(o)) {
        const m = /^_([a-z0-9_]+)_value$/i.exec(k);
        if (!m || SYSTEM_LOOKUPS.test(k) || !GUID_RE.test(String(o[k] || ''))) continue;
        const table = o[k + '@Microsoft.Dynamics.CRM.lookuplogicalname'] || (o['_' + m[1] + '_type'] ? singular(o['_' + m[1] + '_type'], known) : '');
        if (!table) continue;
        add({ entity: String(table).toLowerCase(), id: String(o[k]), name: String(o[k + '@OData.Community.Display.V1.FormattedValue'] || ''), via: m[1] }, step, 'Related');
      }
    }

    function walk(v, step, role, depth, listed) {
      if (!v || typeof v !== 'object' || depth > 7) return;
      if (Array.isArray(v)) {
        v.slice(0, MAX_PER_LIST).forEach((x) => walk(x, step, listed ? 'Listed' : role, depth + 1, false));
        return;
      }
      const row = rowOf(v);
      if (row) {
        add(row, step, role);
        lookupsOf(v, step);
      }
      for (const k of Object.keys(v)) {
        if (k.charAt(0) === '@' || k === 'headers') continue;
        // A lookup an action set: "item/parentcustomerid_account@odata.bind": "accounts(...)".
        const bind = /@odata\.bind$/i.test(k) && /([a-z0-9_]+)\(([0-9a-f-]{36})\)/i.exec(String(v[k] || ''));
        if (bind) {
          add({ entity: singular(bind[1], known), id: bind[2], via: k.replace(/^item\//i, '').replace(/@odata\.bind$/i, '') }, step, 'Related');
          continue;
        }
        walk(v[k], step, row ? 'Related' : role, depth + 1, k === 'value');
      }
    }

    // First what the run says of its tables (leads is lead), then the records.
    const learn = (v, depth) => {
      if (!v || typeof v !== 'object' || depth > 7) return;
      if (Array.isArray(v)) return v.slice(0, MAX_PER_LIST).forEach((x) => learn(x, depth + 1));
      rowOf(v);
      for (const k of Object.keys(v)) if (k.charAt(0) !== '@') learn(v[k], depth + 1);
    };
    for (const s of steps) learn(s.outputs, 0);

    for (const s of steps) {
      const inputs = s.inputs && typeof s.inputs === 'object' ? s.inputs : {};
      const op = (inputs.host && inputs.host.operationId) || '';
      const role = s.kind === 'Trigger' ? 'Trigger' : ROLE_OF[op] || 'Seen';
      // The table and id an action was given (Get, Update, Delete a row).
      const par = inputs.parameters || {};
      const set = par.entityName || par.entitySetName || '';
      const rid = par.recordId || par.id || '';
      if (set && GUID_RE.test(String(rid))) add({ entity: singular(set, known), id: String(rid) }, s.name, role);
      walk(s.outputs, s.name, role, 0, false);
      walk(inputs.parameters, s.name, role, 0, false);
      // The columns a create or an update set: its item/... parameters.
      const cols = Object.keys(par)
        .filter((k) => /^item\//i.test(k))
        .map((k) => k.slice(5).replace(/@odata\.bind$/i, ''));
      if (cols.length && /^(Created|Updated)$/.test(role)) {
        for (const rec of found.values()) for (const h of rec.how) if (h.step === s.name && h.how === role) h.cols = cols;
      }
    }
    // An action's table and id came before the run showed its table name.
    for (const rec of found.values()) if (!rec.host) rec.host = host;
    return Array.from(found.values());
  }

  // ---------- the files a run touched ----------

  /* Every file the run created, changed, copied, moved, read or listed in
   * SharePoint - its name, its folder, the steps that touched it, a link to
   * the file and one to its folder - and in OneDrive, without links (the run
   * does not carry its address). A file in a Dynamics 365 document folder
   * (library = table, folder = <name>_<id without dashes>) names the record
   * it belongs to. */
  const FILE_ROLE = {
    CreateFile: 'Created',
    UpdateFile: 'Updated',
    DeleteFile: 'Deleted',
    CopyFile: 'Copied',
    CopyFileAsync: 'Copied',
    CopyDriveFile: 'Copied',
    MoveFile: 'Moved',
    MoveFileAsync: 'Moved',
    GetFileContent: 'Read',
    GetFileContentByPath: 'Read',
    GetFileMetadata: 'Read',
    GetFileMetadataByPath: 'Read',
    GetFileItem: 'Read',
    GetFileItems: 'Listed',
    ListFolder: 'Listed',
    ListRootFolder: 'Listed'
  };
  const MAX_FILES = 100;
  const OFFICE_EXT = /\.(docx?|docm|xlsx?|xlsm|xlsb|pptx?|pptm)$/i;
  const SAFE_URL = /^https:\/\/[a-z0-9.-]+(\/[^\s"'<>]*)?$/i;
  const encPath = (p) => p.split('/').map((x) => encodeURIComponent(x)).join('/');

  // A file id the connector was given - "%252fShared%2bDocuments%252fa.docx" - as its path.
  function idPath(id) {
    let s = String(id || '');
    for (let n = 0; n < 3 && /%[0-9a-f]{2}/i.test(s); n++) {
      try {
        s = decodeURIComponent(s.replace(/\+/g, ' '));
      } catch (e) {
        return '';
      }
    }
    return s.charAt(0) === '/' && s.length > 1 ? s : '';
  }

  const sizeText = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

  // The record whose document folder holds the file: the deepest
  // <table>/<name>_<32 hex> on its path.
  function docRecordOf(path) {
    const seg = path.split('/');
    let rec = null;
    for (let i = 2; i < seg.length - 1; i++) {
      const m = /^(.*)_([0-9a-f]{32})$/i.exec(seg[i]);
      if (!m || !/^[a-z][a-z0-9_]*$/.test(seg[i - 1])) continue;
      const h = m[2].toLowerCase();
      rec = { entity: seg[i - 1], id: [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-'), name: m[1] };
    }
    return rec;
  }

  function findFiles(steps) {
    const found = new Map();

    const add = (f, step, role) => {
      const path = f.path ? '/' + f.path.replace(/^\/+/, '') : '';
      const name = f.name || (path ? path.split('/').pop() : '');
      if (!name || /_\.000$/.test(name)) return; // a list item, not a file
      const key = (f.site || f.service).toLowerCase().replace(/\/+$/, '') + '|' + (path || name).toLowerCase();
      let file = found.get(key);
      if (!file) {
        if (found.size >= MAX_FILES) return;
        file = { service: f.service, site: '', path: '', name: name, size: 0, link: '', how: [] };
        found.set(key, file);
      }
      if (!file.site && f.site && SAFE_URL.test(f.site)) file.site = f.site.replace(/\/+$/, '');
      if (!file.path && path) file.path = path;
      if (!file.size && f.size > 0) file.size = f.size;
      if (!file.link && f.link && SAFE_URL.test(f.link)) file.link = f.link;
      if (role === 'Deleted') file.deleted = true;
      if (!file.how.some((h) => h.step === step && h.how === role)) file.how.push({ step: step, how: role });
    };

    // A file's metadata as the connectors give it - CreateFile, Get file
    // metadata, List folder - and SharePoint's file properties ({Link}).
    function walk(v, step, role, base, depth) {
      if (!v || typeof v !== 'object' || depth > 6) return;
      if (Array.isArray(v)) return v.slice(0, MAX_PER_LIST).forEach((x) => walk(x, step, role === 'Trigger' ? role : 'Listed', base, depth + 1));
      if (typeof v['{Link}'] === 'string' && v['{IsFolder}'] !== true && (v['{FilenameWithExtension}'] || v['{FullPath}'])) {
        add({ service: 'SharePoint', site: base.site, path: v['{FullPath}'] || '', name: v['{FilenameWithExtension}'] || '', link: v['{Link}'] }, step, role);
      } else if (typeof v.Path === 'string' && v.Path.charAt(0) === '/' && typeof v.Name === 'string' && v.IsFolder !== true && ('ItemId' in v || 'Id' in v || 'MediaType' in v)) {
        add({ service: base.service, site: base.site, path: v.Path, name: v.Name, size: Number(v.Size) || 0 }, step, role);
      }
      for (const k of Object.keys(v)) if (k !== '$content' && k !== 'headers') walk(v[k], step, role, base, depth + 1);
    }

    for (const s of steps) {
      const inputs = s.inputs && typeof s.inputs === 'object' ? s.inputs : {};
      const host = inputs.host || {};
      const op = host.operationId || '';
      const conn = connectorOf(host);
      const service = conn === 'sharepointonline' ? 'SharePoint' : /^onedrive/.test(conn) ? 'OneDrive' : '';
      const role = s.kind === 'Trigger' ? 'Trigger' : FILE_ROLE[op] || 'Seen';
      const par = inputs.parameters && typeof inputs.parameters === 'object' ? inputs.parameters : {};
      const out = s.outputs && typeof s.outputs === 'object' ? s.outputs : {};
      const body = out.body;
      // The file's content in the answer: its size, when nothing else says it.
      const content = body && typeof body === 'object' && typeof body.$content === 'string' ? body.$content : typeof body === 'string' ? body : '';
      const size = content ? (body && body.$content ? Math.floor((content.length * 3) / 4) : content.length) : 0;
      if (service && FILE_ROLE[op]) {
        const site = typeof par.dataset === 'string' ? par.dataset : '';
        // What the action was given: a path, a folder and a name, an id.
        const given = op === 'CreateFile' && par.name ? String(par.folderPath || '').replace(/\/+$/, '') + '/' + par.name : par.path || idPath(par.id) || idPath(par.sourceFileId) || idPath(par.file);
        if (given && !/^(Copied|Moved|Listed)$/.test(role)) add({ service: service, site: site, path: String(given), size: role === 'Read' ? size : 0 }, s.name, role);
        // Copy / move: where it went, in the answer, on the destination site.
        walk(body, s.name, role, { service: service, site: typeof par.destinationDataset === 'string' ? par.destinationDataset : site }, 0);
      } else {
        walk(body, s.name, role, { service: service || 'SharePoint', site: typeof par.dataset === 'string' ? par.dataset : '' }, 0);
      }
    }

    const files = Array.from(found.values());
    for (const f of files) {
      if (f.service === 'SharePoint' && f.site && f.path) {
        if (!f.link && !f.deleted) f.link = f.site + encPath(f.path) + (OFFICE_EXT.test(f.name) ? '?web=1' : '');
        const dir = f.path.slice(0, f.path.lastIndexOf('/'));
        if (dir) f.folderLink = f.site + encPath(dir);
      }
      if (f.deleted) f.link = '';
      f.record = f.path ? docRecordOf(f.path) : null;
    }
    return files;
  }

  // ---------- what else the run did ----------

  /* The emails the run sent, the approvals it asked for, the child flows it
   * ran, the HTTP calls it made and what its variables ended with - read
   * from the steps' inputs and outputs, as the records are: a step's kind
   * from the flow's definition when the run carries it, else by its shape. */
  const MAX_SHOWN = 25;
  const objOf = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  // A parameter by the last part of its name: emailMessage/To is To.
  const param = (par, re) => {
    for (const k of Object.keys(par)) if (re.test(k.split('/').pop())) return par[k];
    return undefined;
  };
  // A header of the outputs, whatever its case.
  const header = (out, name) => {
    const h = objOf(out.headers);
    for (const k of Object.keys(h)) if (k.toLowerCase() === name) return String(h[k]);
    return '';
  };
  const people = (v) =>
    (Array.isArray(v) ? v : String(v == null ? '' : v).split(/[;,]/))
      .map((x) => (x && typeof x === 'object' ? x.emailAddress || x.address || x.Address || x.email || '' : x))
      .map((x) => String(x && typeof x === 'object' ? x.address || '' : x).trim())
      .filter(Boolean);
  const b64Size = (t) => (typeof t === 'string' ? Math.floor((t.replace(/=+$/, '').length * 3) / 4) : 0);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // Each step's type and kind in the definition, scopes and branches included.
  function typesOf(run) {
    const p = (run && run.properties) || {};
    const def = p.flow && p.flow.properties && p.flow.properties.definition;
    const types = new Map();
    const walk = (acts, d) => {
      if (!acts || typeof acts !== 'object' || d > 30) return;
      for (const k of Object.keys(acts)) {
        const a = objOf(acts[k]);
        const v = /Variable$/.test(a.type || '') ? String(objOf(a.inputs).name || '').toLowerCase() : '';
        if (a.type) types.set(k, { type: String(a.type), kind: String(a.kind || ''), variable: v });
        walk(a.actions, d + 1);
        walk(a.else && a.else.actions, d + 1);
        walk(a.default && a.default.actions, d + 1);
        for (const c of Object.values(objOf(a.cases))) walk(objOf(c).actions, d + 1);
      }
    };
    if (def) {
      walk(def.triggers, 0);
      walk(def.actions, 0);
    }
    return types;
  }

  const MAIL_API = /^(office365|outlook|sendmail|smtp|gmail|sendgrid|acsemail|flowpush)$/;
  // An email sent: Send, Reply, Forward, from a shared mailbox, a draft;
  // of the notifications only the email.
  const isMail = (conn, op) => MAIL_API.test(conn) && /^(send|reply|forward|sharedmailboxsend)/i.test(op) && !/http/i.test(op) && (conn !== 'flowpush' || /email/i.test(op));
  // Where a connector's "Send an HTTP request" sends a relative address.
  const GRAPH_API = /^(office365users|office365|office365groups|office365groupsmail|teams)$/;

  function findDone(steps, types) {
    const done = { emails: [], approvals: [], children: [], calls: [], variables: [] };
    const vars = new Map(); // by the name in lower case - Power Automate's own way
    const setVar = (name, value, type, s, how) => {
      const key = name.toLowerCase();
      const v = vars.get(key) || { name: name, type: '', value: undefined, changes: 0, loops: new Set() };
      v.value = value;
      if (type) v.type = type;
      v.step = s.name;
      v.at = s.at;
      v.time = Date.parse(s.startTime) || 0;
      v.how = how;
      v.changes++;
      if (s.at && s.at.li !== undefined) v.loops.add(s.at.li);
      vars.set(key, v);
    };
    const ordered = steps.slice().sort((a, b) => (Date.parse(a.startTime) || 0) - (Date.parse(b.startTime) || 0));
    for (const s of ordered) {
      if (s.kind !== 'Action') continue;
      const type = (types.get(s.key || s.name) || {}).type || '';
      const inputs = objOf(s.inputs);
      const outputs = objOf(s.outputs);
      const host = objOf(inputs.host);
      const op = String(host.operationId || '');
      const conn = connectorOf(host);
      const par = objOf(inputs.parameters);
      const body = objOf(outputs.body);
      const base = { step: s.name, at: s.at, status: s.status };

      if (isMail(conn, op)) {
        const att = param(par, /^attachments$/i);
        const files = (Array.isArray(att) ? att : [])
          .filter((a) => a && typeof a === 'object')
          .map((a) => {
            const c = a.ContentBytes || a.contentBytes || a.ContentData || a.content;
            return { name: String(a.Name || a.name || a.FileName || 'attachment'), size: b64Size(c && typeof c === 'object' ? c.$content : c) };
          });
        // The Mail connector: one file, its name and its content apart.
        const one = param(par, /^filenames$/i);
        if (!files.length && typeof one === 'string' && one) files.push({ name: one, size: b64Size(param(par, /^files$/i)) });
        done.emails.push(
          Object.assign(base, {
            kind: /^reply/i.test(op) ? 'reply' : /^forward/i.test(op) ? 'forward' : /draft/i.test(op) ? 'draft' : 'email',
            subject: String(param(par, /^(subject|notificationsubject)$/i) || ''),
            to: conn === 'flowpush' ? ['the flow’s owner'] : people(param(par, /^(to|torecipients)$/i)),
            cc: people(param(par, /^cc$/i)),
            bcc: people(param(par, /^bcc$/i)),
            from: String(param(par, /^(from|mailboxaddress|sender)$/i) || ''),
            attachments: files,
            // Send email with options, Send approval email: the button pressed.
            answer: String(body.SelectedOption || '')
          })
        );
        continue;
      }

      // An approval: started, created, waited for - one approval, by its id.
      if (conn === 'approvals') {
        const id = String(body.name || param(par, /^approval(name|id)$/i) || '');
        let a = id ? done.approvals.find((x) => x.id === id) : null;
        if (!a) done.approvals.push((a = Object.assign(base, { id: id, title: '', assigned: [], outcome: '', responses: [] })));
        a.title = a.title || String(body.title || param(par, /^title$/i) || '');
        if (!a.assigned.length) a.assigned = people(param(par, /^assignedto$/i));
        // Today's answer lists the responses; the old one had one responder.
        const said = Array.isArray(body.responses) ? body.responses : body.responder ? [{ responder: body.responder, approverResponse: body.response, comments: body.comments, responseDate: body.responseDate }] : [];
        if (said.length) {
          a.responses = said.filter(Boolean).map((r) => {
            const who = objOf(r.responder);
            return { who: String(who.displayName || who.email || who.userPrincipalName || ''), said: String(r.approverResponse || r.response || ''), comments: String(r.comments || ''), when: r.responseDate || '' };
          });
        }
        if (body.outcome || body.response) a.outcome = String(body.outcome || body.response);
        if (a.outcome || s.status !== 'Succeeded') a.status = s.status;
        continue;
      }

      // A child flow: its run is named in the headers of the answer.
      if (type === 'Workflow' || (!type && !host.apiId && !host.operationId && !host.connection && (host.workflowReferenceName || host.workflow))) {
        if (s.status !== 'Skipped') done.children.push(Object.assign(base, { flow: header(outputs, 'x-ms-workflow-name'), run: header(outputs, 'x-ms-workflow-run-id'), ms: spanOf(s) }));
        continue;
      }

      // Compose gives back what it was given - not a call, not a variable.
      if (type === 'Compose' || (!type && !inputs.host && s.outputs !== undefined && same(s.inputs, s.outputs))) continue;

      // An HTTP call: the HTTP action, or a connector's "Send an HTTP request".
      let method = '';
      let uri = '';
      if (type === 'Http' || (!type && typeof inputs.method === 'string' && typeof inputs.uri === 'string' && !inputs.host)) {
        method = String(inputs.method || '');
        uri = String(inputs.uri || '');
      } else if (op && /http/i.test(op)) {
        method = String(param(par, /^method$/i) || '');
        uri = String(param(par, /^(uri|url)$/i) || '');
        if (uri && !/^https?:/i.test(uri)) {
          const site = typeof par.dataset === 'string' ? par.dataset.replace(/\/+$/, '') : '';
          const from = site || (GRAPH_API.test(conn) ? 'https://graph.microsoft.com' : conn === 'visualstudioteamservices' && par.account ? 'https://dev.azure.com/' + encodeURIComponent(par.account) : '');
          if (from) uri = from + '/' + uri.replace(/^\/+/, '');
        }
      }
      if (method && uri) {
        done.calls.push(Object.assign(base, { method: method.toUpperCase(), uri: uri, code: outputs.statusCode, ms: spanOf(s) }));
        continue;
      }

      // A variable - only from a step that did its work.
      if (inputs.host || s.status !== 'Succeeded') continue;
      const keys = Object.keys(inputs);
      if (type === 'InitializeVariable' || (!type && keys.length === 1 && Array.isArray(inputs.variables) && inputs.variables.length && inputs.variables.every((v) => v && typeof v.name === 'string' && typeof v.type === 'string'))) {
        for (const v of inputs.variables || []) if (v && typeof v.name === 'string') setVar(v.name, v.value, String(v.type || ''), s, 'Initialized');
        continue;
      }
      if (typeof inputs.name !== 'string' || !keys.every((k) => k === 'name' || k === 'value')) continue;
      const known = vars.get(inputs.name.toLowerCase());
      if ('value' in body && (!type || /^(Set|Increment|Decrement)Variable$/.test(type))) {
        // Set, Increment, Decrement: the answer has the value after it.
        const was = known && known.value;
        const how = /^Increment/.test(type) ? 'Incremented' : /^Decrement/.test(type) ? 'Decremented' : type || same(body.value, inputs.value) || typeof was !== 'number' ? 'Set' : body.value > was ? 'Incremented' : 'Decremented';
        setVar(inputs.name, body.value, '', s, how);
      } else if (/^AppendTo/.test(type) || (!type && !s.outputsLink && s.outputs === undefined)) {
        // Append: only the piece is in the step - added to what came before.
        if (!known) continue;
        const add = inputs.value;
        const t = known.type.toLowerCase();
        if (t === 'array' || Array.isArray(known.value)) setVar(inputs.name, (Array.isArray(known.value) ? known.value : []).concat([add]), '', s, 'Appended to');
        else if (t === 'string' || typeof known.value === 'string')
          setVar(inputs.name, (known.value || '') + (add == null ? '' : typeof add === 'object' ? JSON.stringify(add) : String(add)), '', s, 'Appended to');
      }
    }
    done.variables = Array.from(vars.values());
    return done;
  }

  /* Who or what started the run, from its trigger: a person (a button,
   * Power Apps, a selected item), a parent flow, a schedule, a change to a
   * row, an event in another service, an HTTP request - and whether it was
   * a test from the designer or a resubmitted run. */
  const CONNECTOR_NAMES = {
    sharepointonline: 'SharePoint',
    office365: 'Outlook',
    outlook: 'Outlook.com',
    onedriveforbusiness: 'OneDrive',
    onedrive: 'OneDrive',
    teams: 'Teams',
    microsoftforms: 'Forms',
    approvals: 'Approvals',
    excelonlinebusiness: 'Excel',
    planner: 'Planner',
    visualstudioteamservices: 'Azure DevOps',
    commondataserviceforapps: 'Dataverse'
  };
  function fromBase64(v) {
    try {
      return decodeURIComponent(escape(atob(String(v))));
    } catch (e) {
      return '';
    }
  }

  function startedOf(top, run) {
    const t = top.find((s) => s.kind === 'Trigger');
    if (!t) return null;
    const p = (run && run.properties) || {};
    const def = typesOf(run).get(t.name) || {};
    const inputs = objOf(t.inputs);
    const outputs = objOf(t.outputs);
    const body = objOf(outputs.body);
    const host = inputs.host ? objOf(inputs.host) : null;
    const conn = host ? connectorOf(host) : '';
    const hd = (n) => header(outputs, n);
    // The encoded headers keep a name's accents.
    const st = {
      how: '',
      who: fromBase64(hd('x-ms-user-name-encoded')) || hd('x-ms-user-name'),
      mail: fromBase64(hd('x-ms-user-email-encoded')) || hd('x-ms-user-email')
    };
    const caller = hd('x-ms-workflow-name');
    const name = CONNECTOR_NAMES[conn] || conn;
    if (def.type === 'Recurrence' || /^recurrence$/i.test(t.name) || (p.trigger && p.trigger.scheduledTime && !host && t.inputs === undefined && !t.inputsLink)) st.how = 'on a schedule';
    else if (caller && hd('x-ms-workflow-run-id')) {
      // A flow names itself by its GUID - a Logic App by a name.
      st.how = GUID_RE.test(caller) ? 'by a parent flow' : 'by a Logic App';
      if (GUID_RE.test(caller)) st.parent = { flow: caller, run: hd('x-ms-workflow-run-id') };
    } else if (/^PowerApp/i.test(def.kind) || /\/apps\//i.test(hd('x-ms-client-app-id')) || /^PowerApps\//i.test(hd('x-ms-user-agent'))) st.how = 'from Power Apps';
    else if (/^(Skills|VirtualAgent)$/i.test(def.kind)) st.how = 'from Copilot Studio';
    else if (/^commondataservice/.test(conn)) {
      const msg = String(body.SdkMessage || '').toLowerCase();
      const table = String(param(objOf(inputs.parameters), /^entityname$/i) || (/#Microsoft\.Dynamics\.CRM\.([a-z0-9_]+)/i.exec(String(body['@odata.type'] || '')) || [])[1] || '');
      const row = table ? table + ' row' : 'row';
      st.how = 'by ' + (msg === 'create' ? 'a new ' + row : msg === 'delete' ? 'a deleted ' + row : (msg === 'update' ? 'a change to ' : '') + (/^[aeiou]/i.test(row) ? 'an ' : 'a ') + row);
      if (!st.who) st.who = String(body['_modifiedby_value@OData.Community.Display.V1.FormattedValue'] || '');
    } else if (st.who || st.mail || def.kind === 'Button') st.how = 'manually' + (host && name ? ' from ' + name : ''); // a button, or a selected item
    else if (host && name) {
      st.how = 'from ' + name;
      // Who made the change in SharePoint; who sent the email.
      const ed = objOf(body.Editor || body.Author);
      if (ed.DisplayName || ed.Email) Object.assign(st, { who: String(ed.DisplayName || ''), mail: String(ed.Email || '') });
      else if (typeof body.from === 'string' && /^(office365|outlook)$/.test(conn)) Object.assign(st, { how: 'by an email', of: 'from', mail: body.from });
    } else if (def.kind === 'Http' || hd('user-agent') || outputs.queries) st.how = 'by an HTTP request';
    // A test from the designer; a run started again from an earlier one.
    const words = [].concat((p.correlation && p.correlation.clientKeywords) || [], hd('x-ms-client-keywords')).join(',').split(',');
    if (words.some((w) => w.trim() === 'testFlow')) st.test = true;
    const from = p.trigger && p.trigger.sourceHistoryName;
    const flow = (/\/flows\/([^/]+)\/runs\//i.exec(String((run && run.id) || '')) || [])[1];
    if (from && from !== run.name && flow) st.again = { flow: flow, run: String(from) };
    return st.how || st.who || st.test || st.again ? st : null;
  }

  // The environment's Dynamics 365 address, when the run's rows did not say.
  function hostFor(run) {
    const m = /\/environments\/([^/]+)\//i.exec(String((run && run.id) || '')) || /\/environments\/([^/]+)/i.exec(location.pathname);
    const env = m ? decodeURIComponent(m[1]).toLowerCase() : '';
    return new Promise((resolve) => {
      if (!env) return resolve('');
      try {
        chrome.storage.local.get('dynaboost.environments', (d) => {
          const list = ((d && d['dynaboost.environments']) || {}).list || [];
          const hit = list.find((e) => e && e.host && String(e.id || '').toLowerCase() === env);
          resolve(hit ? hit.host : '');
        });
      } catch (e) {
        resolve('');
      }
    });
  }

  // In the app you last worked in there (core.js keeps it), else Dynamics' own choice.
  const recordUrl = (r) =>
    'https://' + r.host + '/main.aspx?' + (r.app ? 'appid=' + r.app + '&' : '') + 'pagetype=entityrecord&etn=' + encodeURIComponent(r.entity) + '&id=' + r.id;

  function lastApps() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get('dynaboost.lastApp', (d) => resolve((d && d['dynaboost.lastApp']) || {}));
      } catch (e) {
        resolve({});
      }
    });
  }

  // ---------- rendering ----------

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /* A file's content - base64 in $content, or the bytes of a .docx or .pdf
   * read as text - says nothing in the tab or a copy and can be megabytes:
   * its type and size stand in its place. */
  const BINARY = /[\u0000-\u0008\u000e-\u001f\ufffd]/g;
  const isBinary = (t) => t.length > 1000 && (/^(PK\u0003\u0004|%PDF-)/.test(t) || (t.slice(0, 2000).match(BINARY) || []).length > 20);
  function slim(v, depth) {
    if (typeof v === 'string') return isBinary(v) ? '[file content left out - ' + sizeText(v.length) + ']' : v;
    if (!v || typeof v !== 'object' || depth > 12) return v;
    if (Array.isArray(v)) return v.map((x) => slim(x, depth + 1));
    if (typeof v.$content === 'string' && v.$content.length > 1000) {
      return Object.assign({}, v, { $content: '[file content left out - ' + sizeText(Math.floor((v.$content.length * 3) / 4)) + ']' });
    }
    const o = {};
    for (const k of Object.keys(v)) o[k] = slim(v[k], depth + 1);
    return o;
  }

  function fmt(v) {
    if (v === undefined) return '(none)';
    v = slim(v, 0);
    if (typeof v === 'string') return v;
    try {
      return JSON.stringify(v, null, 2);
    } catch (e) {
      return String(v);
    }
  }

  const nice = (n) => esc(String(n).replace(/_/g, ' '));
  const plural = (n, one) => n + ' ' + one + (n === 1 ? '' : 's');
  const isBad = (it) => it.status === 'Failed';
  const pill = (status) => '<span class="pill st-' + String(status || '').toLowerCase() + '">' + esc(status || '?') + '</span>';
  const retried = (s) => (Array.isArray(s.retries) && s.retries.length ? 'retried ' + plural(s.retries.length, 'time') : '');

  function failBox(f) {
    if (!f) return '';
    const roots = f.roots
      .map((r) => {
        const meta = [r.kind, r.statusCode ? 'HTTP ' + r.statusCode : '', r.code, r.operation, r.retries ? 'retried ' + plural(r.retries, 'time') : '', r.loop ? 'in a loop, ' + r.loop + ' times' : '']
          .filter(Boolean)
          .map(esc)
          .join(' &middot; ');
        const inLoop = r.inLoop !== undefined;
        const go = inLoop
          ? 'href="#" data-li="' + r.li + '" data-it="' + esc(r.iterations[0].key) + '" title="Go to this iteration"'
          : 'href="#s-' + r.i + '" data-go="s-' + r.i + '" title="Go to this step"';
        const its = inLoop
          ? '<div class="fail-it">in ' + nice(r.inLoop) + ', iteration' + (r.iterations.length > 1 ? 's ' : ' ') +
            r.iterations
              .slice(0, 12)
              .map((x) => '<a href="#" data-li="' + r.li + '" data-it="' + esc(x.key) + '" title="Go to iteration ' + esc(x.label) + '">' + esc(x.label) + '</a>')
              .join(', ') +
            (r.iterations.length > 12 ? ' and ' + (r.iterations.length - 12) + ' more' : '') +
            (r.partial ? ' \u2013 of the first ' + r.read + ' read' : '') +
            '</div>'
          : '';
        return (
          '<div class="fail-r"><a class="fail-s" ' + go + '>' + nice(r.step) + '</a>' +
          '<span class="fail-m">' + meta + '</span>' +
          its +
          (r.message ? '<div class="fail-t">' + esc(r.message) + '</div>' : '') +
          r.details.map((d) => '<pre>' + esc(d) + '</pre>').join('') +
          '</div>'
        );
      })
      .join('');
    const after = [];
    if (f.followed.length) after.push('Failed because of it: ' + f.followed.map(nice).join(', ') + '.');
    if (f.skipped) after.push(plural(f.skipped, 'step') + ' skipped.');
    return (
      '<div class="fail"><div class="fail-h">Where it failed</div>' + roots +
      (after.length ? '<div class="fail-n">' + after.join(' ') + '</div>' : '') +
      '</div>'
    );
  }

  // ---------- a loop's iterations ----------

  function actHtml(a, root) {
    const meta = [duration(a), a.code ? esc(a.code) : '', retried(a)].filter(Boolean).join(' &middot; ');
    return (
      '<div class="act' + (root ? ' root' : '') + '"><h4>' + pill(a.status) + ' ' + esc(a.name) + (meta ? ' <span class="meta">' + meta + '</span>' : '') + '</h4>' +
      (a.error ? '<div class="err"><b>' + esc(a.error.code || 'Error') + '</b> ' + esc(a.error.message || '') + '</div>' : '') +
      '<h3>Inputs</h3><pre>' + DynaBoost.code.html(fmt(a.inputs), 'json') + '</pre>' +
      '<h3>Outputs</h3><pre>' + DynaBoost.code.html(fmt(a.outputs), 'json') + '</pre>' +
      '</div>'
    );
  }

  function iterActsHtml(it) {
    if (it.actions.some((a) => !a.loaded)) return '<div class="lp-wait">' + DynaBoost.status.html('busy') + '<span>Reading this iteration…</span></div>';
    return it.actions.map((a) => actHtml(a, FAILED.test(a.status || '') && !followed(a))).join('');
  }

  /* A loop that ran more than once: how many times and how many failed, the
   * strip of iteration numbers (the failed ones only, while Failed is on),
   * then the iteration picked - its actions, a step back and on, a copy. A
   * loop that ran once: its actions, nothing more. */
  function loopHtml(l, li, st) {
    const total = l.iterations.length;
    if (total === 1) return '<div class="lp-acts">' + iterActsHtml(l.iterations[0]) + '</div>';
    const bad = l.iterations.filter(isBad);
    const shown = st.filter === 'failed' ? bad : l.iterations;
    const cur = l.iterations.find((it) => it.key === st.cur) || shown[0];
    const pos = shown.indexOf(cur);
    const all = l.total || total;
    const chip = (it) =>
      '<button class="chip st-' + it.status.toLowerCase() + '" data-li="' + li + '" data-it="' + esc(it.key) + '" aria-pressed="' + (it === cur) + '" title="Iteration ' + esc(it.label) + ' – ' + esc(it.status) + '">' + esc(it.label) + '</button>';
    return (
      '<div class="lp-bar"><span class="lp-sum"><b>' + (l.partial ? total + ' of ' + all : total) + ' iterations</b>' + (bad.length ? '<span class="lp-bad">' + bad.length + ' failed</span>' : '') + '</span>' +
      (bad.length && bad.length < total
        ? '<span class="seg" role="group" aria-label="Show"><button data-f="failed" aria-pressed="' + (st.filter === 'failed') + '">Failed</button>' +
          '<button data-f="all" aria-pressed="' + (st.filter === 'all') + '">All</button></span>'
        : '') +
      '<span class="lp-sp"></span>' +
      (bad.length ? '<button class="lp-cf" title="Every failed iteration of this loop, all its actions">Copy failed iterations</button>' : '') +
      '</div>' +
      (l.partial
        ? '<div class="lp-cut">Power Automate gave the first ' + total + ' of the ' + all + ' iterations \u2013 one after them, failed or not, is not listed here; the run in Power Automate shows them all.</div>'
        : '') +
      '<div class="lp-chips">' + shown.map(chip).join('') + '</div>' +
      '<div class="lp-cur"><div class="lp-ch">' +
      '<button class="lp-nav" data-step="-1" title="Previous iteration (←)"' + (pos <= 0 ? ' disabled' : '') + '>‹</button>' +
      '<button class="lp-nav" data-step="1" title="Next iteration (→)"' + (pos < 0 || pos >= shown.length - 1 ? ' disabled' : '') + '>›</button>' +
      '<b>Iteration ' + esc(cur.label) + '</b><span class="lp-of">of ' + all + '</span>' + pill(cur.status) +
      (duration(cur) ? '<span class="meta">' + duration(cur) + '</span>' : '') +
      '<span class="lp-sp"></span><button class="lp-ci" title="This iteration, all its actions">Copy iteration</button></div>' +
      '<div class="lp-acts">' + iterActsHtml(cur) + '</div></div>'
    );
  }

  // ---------- the tab ----------

  function stepJson(s) {
    return {
      name: s.name,
      kind: s.kind,
      status: s.status,
      code: s.code,
      startTime: s.startTime,
      endTime: s.endTime,
      error: s.error,
      retries: Array.isArray(s.retries) && s.retries.length ? s.retries : undefined,
      loop: s.loop || undefined,
      inputs: slim(s.inputs, 0),
      outputs: slim(s.outputs, 0)
    };
  }

  function iterJson(it) {
    return {
      iteration: it.label,
      status: it.status,
      startTime: it.startTime,
      endTime: it.endTime,
      actions: it.actions.map((a) => (a.loaded ? stepJson(a) : Object.assign(stepJson(a), { inputs: undefined, outputs: undefined, payloads: 'not fetched' })))
    };
  }

  // The steps, and the iterations' actions as far as read.
  function stepsOf(ctx) {
    const list = ctx.top.map((s, i) => Object.assign({}, s, { key: s.name, at: { i: i } }));
    ctx.L.forEach((l, li) => {
      for (const it of l.iterations) for (const a of it.actions) if (a.loaded) list.push(Object.assign({}, a, { key: a.name, name: a.name + ' #' + it.label, at: { li: li, it: it.key } }));
    });
    return list;
  }

  // A link to a step, or to the iteration it ran in.
  const goTo = (at) =>
    !at ? '' : at.li !== undefined ? 'href="#" data-li="' + at.li + '" data-it="' + esc(at.it) + '"' : 'href="#s-' + at.i + '" data-go="s-' + at.i + '"';

  /* The steps the run spent its time on: the 5 longest, a loop as a whole.
   * A scope, condition or switch is left out when a step inside it is
   * there - it only adds up what is inside it. */
  function slowestOf(top) {
    const timed = top
      .map((s, i) => ({ name: s.name, ms: spanOf(s), from: Date.parse(s.startTime), at: { i: i }, s: s }))
      .filter((x) => x.s.kind === 'Action' && x.ms > 0);
    const holder = (x) =>
      !x.s.loop && x.s.outputs === undefined && !x.s.outputsLink && timed.some((y) => y !== x && y.from >= x.from && y.from + y.ms <= x.from + x.ms);
    const list = timed.filter((x) => !holder(x)).sort((a, b) => b.ms - a.ms).slice(0, 5);
    return list.length > 1 ? list : [];
  }

  // Every file the run touched, and every row: its steps', its iterations',
  // and the records whose document folders hold the files.
  function touchedOf(ctx) {
    const list = stepsOf(ctx);
    const files = findFiles(list);
    const records = findRecords(list);
    for (const f of files) {
      if (!f.record) continue;
      const r = f.record;
      let rec = records.find((x) => x.entity === r.entity && x.id === r.id);
      if (!rec) records.push((rec = { entity: r.entity, id: r.id, name: r.name, host: '', how: [] }));
      const how = 'Document folder · ' + f.name;
      if (!rec.how.some((h) => h.how === how)) rec.how.push({ step: f.how[0].step, how: how });
    }
    for (const r of records) {
      if (!r.host) r.host = ctx.host;
      if (r.host && ctx.apps[r.host]) r.app = ctx.apps[r.host];
    }
    const types = typesOf(ctx.run);
    const done = findDone(list, types);
    /* A variable a loop not read to the end may have changed: its value so
     * far - unless it changed again after the loop. Which loop changes which
     * variable the definition says; without it, any such loop may. */
    const outer = (l) => {
      for (let i = 0; l && l.outer && i < 20; i++) l = ctx.L.find((x) => x.name === l.outer) || null;
      return l;
    };
    const unread = ctx.L.map((l) => {
      if (!l.partial && !l.iterations.some((it) => it.actions.some((a) => !a.loaded))) return null;
      const top = ctx.top.find((s) => s.name === (outer(l) || l).name) || {};
      const left = new Set();
      for (const it of l.iterations) for (const a of it.actions) if (!a.loaded) left.add((types.get(a.name) || {}).variable);
      return { end: Date.parse(top.endTime) || Infinity, changes: (name) => !types.size || l.partial || left.has(name) };
    });
    for (const v of done.variables) v.partial = unread.some((u, li) => u && !(v.time > u.end) && (v.loops.has(li) || u.changes(v.name.toLowerCase())));
    return Object.assign({ records: records, files: files, slowest: slowestOf(ctx.top), env: envOf(ctx.run) }, done);
  }

  // The environment a run is in, from its id - for a link to another run.
  const envOf = (run) => {
    const m = /\/environments\/([^/]+)\//i.exec(String((run && run.id) || '')) || /\/environments\/([^/]+)/i.exec(location.pathname);
    return m ? decodeURIComponent(m[1]) : '';
  };
  const runUrl = (env, flow, run) =>
    env && flow && run ? 'https://make.powerautomate.com/environments/' + encodeURIComponent(env) + '/flows/' + encodeURIComponent(flow) + '/runs/' + encodeURIComponent(run) : '';

  // Where a file is: its site, then its folders.
  function placeOf(f) {
    const dir = f.path ? f.path.split('/').slice(1, -1) : [];
    let site = f.service;
    if (f.site) {
      const m = /^https:\/\/([^/]+)(?:\/(?:sites|teams)\/([^/]+))?/i.exec(f.site);
      if (m) site = m[2] ? decodeURIComponent(m[2]) : m[1];
    }
    return [site].concat(dir).join(' › ');
  }

  function fileHtml(f) {
    const ext = /\.([a-z0-9]{1,5})$/i.exec(f.name);
    const how = f.how.map((h) => esc(h.how) + ' <span class="step">' + nice(h.step) + '</span>').join('<br>');
    const name = f.link
      ? '<a class="fn" href="' + esc(f.link) + '" target="_blank" rel="noopener noreferrer" title="Open this file in ' + esc(f.service) + '">' + esc(f.name) + '<span class="fgo">↗</span></a>'
      : '<span class="nm" title="' + (f.deleted ? 'The run deleted this file' : f.service === 'OneDrive' ? 'The run does not carry the OneDrive’s address' : 'The run does not carry the file’s site') + '">' + esc(f.name) + '</span>';
    const place = esc(placeOf(f));
    const fold = f.folderLink
      ? '<a class="fold" href="' + esc(f.folderLink) + '" target="_blank" rel="noopener noreferrer" title="Open its folder in SharePoint">' + place + '</a>'
      : '<span class="fold">' + place + '</span>';
    return (
      '<div class="rec file"><span class="ent">' + esc(ext ? ext[1].toUpperCase() : 'file') + '</span>' + name + fold +
      '<span class="how">' + how + (f.size ? '<br>' + sizeText(f.size) : '') + '</span></div>'
    );
  }

  // One part of the column: its heading and count, then its items - the
  // first MAX_SHOWN of them, the copies have the rest.
  function part(title, list, item, sub) {
    if (!list.length) return '';
    return (
      '<div class="rh"><b>' + title + '</b><span class="cnt">' + list.length + '</span></div>' +
      (sub ? '<div class="rsub">' + sub + '</div>' : '') +
      list.slice(0, MAX_SHOWN).map(item).join('') +
      (list.length > MAX_SHOWN ? '<div class="none">and ' + (list.length - MAX_SHOWN) + ' more – in Copy everything</div>' : '')
    );
  }

  const stepLink = (x) => (x.at ? '<a class="step" ' + goTo(x.at) + ' title="Go to this step">' + nice(x.step) + '</a>' : '<span class="step">' + nice(x.step) + '</span>');
  // The badge says what it is - red, and why, when its step failed.
  const badge = (x, kind) => (FAILED.test(x.status || '') ? '<span class="ent bad">' + esc(x.status) + '</span>' : '<span class="ent">' + kind + '</span>');
  const line = (label, xs) => (xs.length ? '<span class="who"><b>' + label + '</b> ' + esc(xs.join(', ')) + '</span>' : '');
  // A value as one short line: text as it is, the rest as JSON.
  const short = (v) => {
    const t = v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
    return t.length > 80 ? t.slice(0, 79) + '…' : t;
  };

  function recordHtml(r) {
    const how = r.how
      .map((h) => '<span class="hw">' + esc(h.how) + ' <span class="step">' + nice(h.step) + '</span>' + (h.cols ? '<span class="cols">' + esc(h.cols.slice(0, 8).join(', ')) + (h.cols.length > 8 ? ' +' + (h.cols.length - 8) : '') + '</span>' : '') + '</span>')
      .join('');
    const inner =
      '<span class="ent">' + esc(r.entity) + '</span>' +
      '<span class="nm">' + (r.name ? esc(r.name) : '<code>' + esc(r.id) + '</code>') + '</span>' +
      '<span class="how">' + how + '</span>';
    return r.host
      ? '<a class="rec" href="' + esc(recordUrl(r)) + '" target="_blank" rel="noopener noreferrer" title="Open this ' + esc(r.entity) + ' in Dynamics 365">' + inner + '<span class="go">↗</span></a>'
      : '<div class="rec" title="The environment’s address is not known - open make.powerautomate.com’s environment list once">' + inner + '</div>';
  }

  function emailHtml(m) {
    const att = m.attachments.map((a) => '<span class="att">' + esc(a.name) + (a.size ? ' <i>' + sizeText(a.size) + '</i>' : '') + '</span>').join('');
    return (
      '<div class="rec card">' + badge(m, m.kind) + '<span class="nm">' + (m.subject ? esc(m.subject) : '<i class="dim">no subject</i>') + '</span>' +
      '<span class="how">' + line('To', m.to) + line('Cc', m.cc) + line('Bcc', m.bcc) + line('From', m.from ? [m.from] : []) + line('Answer', m.answer ? [m.answer] : []) +
      (att ? '<span class="atts">' + att + '</span>' : '') +
      'Sent ' + stepLink(m) + '</span></div>'
    );
  }

  const WAITING = /^(Running|Waiting)$/i;
  function approvalHtml(a) {
    const out = a.outcome
      ? '<span class="ent ' + (/^approve/i.test(a.outcome) ? 'good' : /^reject/i.test(a.outcome) ? 'bad' : '') + '">' + esc(a.outcome) + '</span>'
      : badge(a, WAITING.test(a.status || '') ? 'waiting' : 'asked');
    const said = a.responses
      .map((r) => '<span class="who"><b>' + esc(r.who || 'Someone') + '</b> ' + esc(r.said) + (r.comments ? ' – “' + esc(short(r.comments)) + '”' : '') + '</span>')
      .join('');
    return (
      '<div class="rec card">' + out + '<span class="nm">' + (a.title ? esc(a.title) : '<i class="dim">no title</i>') + '</span>' +
      '<span class="how">' + (said || line(WAITING.test(a.status || '') ? 'Waiting for' : 'Asked', a.assigned)) + 'Asked in ' + stepLink(a) + '</span></div>'
    );
  }

  function childHtml(c, env) {
    const url = runUrl(env, c.flow, c.run);
    const inner =
      badge(c, 'flow') + '<span class="nm">' + nice(c.step) + '</span>' +
      '<span class="how">' + ([c.ms > 0 ? took(c.ms) : '', c.run ? 'run …' + esc(c.run.slice(-8)) : ''].filter(Boolean).join(' · ') || 'Ran in ' + stepLink(c)) + '</span>';
    return url
      ? '<a class="rec run" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" title="Open this run of the child flow">' + inner + '<span class="go">↗</span></a>'
      : '<div class="rec" title="Its answer does not name the child’s run">' + inner + '</div>';
  }

  function callHtml(c) {
    const shown = c.uri.replace(SECRET_PARAM, '$1…');
    const ok = c.code >= 200 && c.code < 400 && !FAILED.test(c.status || '');
    return (
      '<a class="ln" ' + goTo(c.at) + ' title="' + esc(shown + ' – ' + c.step.replace(/_/g, ' ')) + '"><span class="mth">' + esc(c.method) + '</span>' +
      '<span class="k">' + esc(shown.replace(/^https?:\/\//i, '').replace(/[?#].*$/, '')) + '</span>' +
      (c.code ? '<span class="pill ' + (ok ? 'st-succeeded' : 'st-failed') + '">' + esc(c.code) + '</span>' : FAILED.test(c.status || '') ? '<span class="pill st-failed">' + esc(c.status) + '</span>' : '') +
      '</a>'
    );
  }

  function variableHtml(v) {
    const val = v.value === undefined ? '(none)' : short(v.value);
    const tip = v.how + ' in ' + v.step.replace(/_/g, ' ') + (v.changes > 1 ? ' – changed ' + plural(v.changes, 'time') : '') + (v.partial ? ' – so far: its loop is not read to the end' : '');
    return (
      '<a class="ln var" ' + goTo(v.at) + ' title="' + esc(tip) + '">' +
      '<span class="vn">' + esc(v.name) + '</span><span class="k vv">' + esc(val) + '</span>' + (v.partial ? '<span class="v dim">so far</span>' : '') + '</a>'
    );
  }

  function slowHtml(x, i, all) {
    return (
      '<a class="ln slow" ' + goTo(x.at) + ' title="Go to this step"><span class="k">' + nice(x.name) + (x.s.loop ? ' <i class="dim">' + esc(x.s.loop) + '×</i>' : '') + '</span>' +
      '<span class="v">' + took(x.ms) + '</span><span class="bar"><i style="width:' + Math.max(2, Math.round((x.ms / all[0].ms) * 100)) + '%"></i></span></a>'
    );
  }

  function asideHtml(t) {
    // What the run touched and did, beside the steps: each with a link.
    const html =
      part('Records', t.records, recordHtml, 'Every row this run read, created, changed or pointed at – click to open it in Dynamics 365.') +
      part('Files', t.files, fileHtml, 'Every file this run created, changed, copied or read – the name opens the file, the line under it its folder.') +
      part('Emails', t.emails, emailHtml) +
      part('Approvals', t.approvals, approvalHtml) +
      part('Child flows', t.children, (c) => childHtml(c, t.env)) +
      part('HTTP calls', t.calls, callHtml) +
      part('Variables', t.variables, variableHtml) +
      part('Slowest steps', t.slowest, slowHtml);
    return '<aside>' + (html || '<div class="rh"><b>Records</b><span class="cnt">0</span></div><div class="none">No Dataverse records or files in this run.</div>') + '</aside>';
  }

  const flowNameOf = (run) => {
    const p = run.properties || {};
    return (p.flow && p.flow.properties && p.flow.properties.displayName) || 'Flow run';
  };

  function startedHtml(st, env) {
    if (!st) return '';
    const link = (x, text) => {
      const url = x ? runUrl(env, x.flow, x.run) : '';
      return url ? ' – <a class="step run" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + text + ' ↗</a>' : '';
    };
    return (
      '<div class="started">Started' + (st.how ? ' ' + esc(st.how) : '') +
      (st.who || st.mail ? ' ' + (st.of || 'by') + ' <b>' + esc(st.who || st.mail) + '</b>' + (st.who && st.mail ? ' <span class="dim">' + esc(st.mail) + '</span>' : '') : '') +
      link(st.parent, 'open its run') +
      (st.test ? ' <span class="dim">· a test from the designer</span>' : '') +
      (st.again ? link(st.again, st.test ? 'with the data of an earlier run' : 'resubmitted from an earlier run') : '') +
      '</div>'
    );
  }

  function startedJson(st, env) {
    if (!st) return undefined;
    const url = (x) => (x && runUrl(env, x.flow, x.run)) || undefined;
    return { how: st.how || undefined, who: st.who || undefined, mail: st.mail || undefined, test: st.test || undefined, parentRun: url(st.parent), resubmittedFrom: url(st.again) };
  }

  // The run as JSON - what Copy everything and Download give.
  function payloadOf(ctx) {
    const p = ctx.run.properties || {};
    const failure = failureOf(ctx.top, ctx.loops);
    const partial = ctx.L.reduce((n, l) => n + l.iterations.filter((it) => it.actions.some((a) => !a.loaded)).length, 0);
    const touched = touchedOf(ctx);
    return {
      flow: flowNameOf(ctx.run),
      run: ctx.run.name,
      status: p.status,
      startTime: p.startTime,
      endTime: p.endTime,
      took: took(spanOf(p)) || undefined,
      startedBy: startedJson(startedOf(ctx.top, ctx.run), touched.env),
      error: p.error,
      failure: failure
        ? {
            startedIn: failure.roots.map((r) =>
              Object.assign({}, r, { i: undefined, li: undefined, partial: undefined, read: undefined, iterations: r.iterations ? r.iterations.map((x) => x.label) : undefined })
            ),
            failedWithIt: failure.followed.length ? failure.followed : undefined,
            skippedAfter: failure.skipped || undefined
          }
        : undefined,
      records: touched.records.map((r) => ({ table: r.entity, id: r.id, name: r.name || undefined, url: r.host ? recordUrl(r) : undefined, steps: r.how })),
      files: touched.files.length
        ? touched.files.map((f) => ({
            name: f.name,
            in: f.service,
            site: f.site || undefined,
            path: f.path || undefined,
            size: f.size ? sizeText(f.size) : undefined,
            url: f.link || undefined,
            folder: f.folderLink || undefined,
            steps: f.how
          }))
        : undefined,
      emails: touched.emails.length
        ? touched.emails.map((m) => ({
            kind: m.kind === 'email' ? undefined : m.kind,
            subject: m.subject,
            to: m.to,
            cc: m.cc.length ? m.cc : undefined,
            bcc: m.bcc.length ? m.bcc : undefined,
            from: m.from || undefined,
            attachments: m.attachments.length ? m.attachments.map((a) => a.name + (a.size ? ' (' + sizeText(a.size) + ')' : '')) : undefined,
            answer: m.answer || undefined,
            step: m.step,
            status: m.status
          }))
        : undefined,
      approvals: touched.approvals.length ? touched.approvals.map((a) => ({ title: a.title, outcome: a.outcome || undefined, assignedTo: a.assigned.length ? a.assigned : undefined, responses: a.responses.length ? a.responses : undefined, step: a.step })) : undefined,
      childFlows: touched.children.length ? touched.children.map((c) => ({ step: c.step, status: c.status, run: c.run || undefined, url: runUrl(touched.env, c.flow, c.run) || undefined })) : undefined,
      httpCalls: touched.calls.length ? touched.calls.map((c) => ({ method: c.method, uri: c.uri, statusCode: c.code, step: c.step })) : undefined,
      variables: touched.variables.length
        ? touched.variables.map((v) => ({ name: v.name, type: v.type || undefined, value: slim(v.value, 0), lastSetIn: v.step, note: v.partial ? 'so far - its loop is not read to the end' : undefined }))
        : undefined,
      slowestSteps: touched.slowest.length ? touched.slowest.map((x) => ({ step: x.name, took: took(x.ms) })) : undefined,
      steps: ctx.top.map(stepJson),
      loops: ctx.L.length
        ? ctx.L.map((l) => ({
            loop: l.name,
            iterations: l.total || l.iterations.length,
            read: l.partial ? l.iterations.length : undefined,
            readNote: l.partial ? 'Power Automate gave the first ' + l.iterations.length + ' iterations - the rest, failed or not, are not in this export.' : undefined,
            failed: l.iterations.some(isBad) ? l.iterations.filter(isBad).map((it) => it.label) : undefined,
            items: l.iterations.map(iterJson)
          }))
        : undefined,
      note: partial ? 'Inputs and outputs of ' + plural(partial, 'iteration') + ' not included (a large loop) - open one in the tab and use Copy iteration.' : undefined
    };
  }

  /* Copy without personal data: what Copy everything gives, with the people
   * in it - names, emails, phone numbers, addresses - and the keys,
   * passwords and signatures replaced, so it can go into a ticket. Each
   * person and each email keeps one number all through (<person 1>,
   * <email 2>), so the run still reads. Only what it recognises - the note
   * at the top says so. */
  const PERSON_KEY = /^(fullname|firstname|lastname|givenname|surname|mailnickname|middlename|nickname|yomifullname|yomifirstname|yomilastname|requestor|responder|respondername|who|username|x-ms-user-name|x-ms-user-name-encoded)$/i;
  const PERSON_LOOKUP = /^_(createdby|modifiedby|createdonbehalfby|modifiedonbehalfby|owninguser|ownerid|[a-z0-9_]*(user|contact|lead)[a-z0-9_]*)_value@OData\.Community\.Display\.V1\.FormattedValue$/i;
  const PERSON_TABLE = /^(contact|systemuser|lead)$/i;
  const PRIVATE_KEY = /e-?mail|phone|mobile|fax|address|street|postal|zip|birth|iban|password|passwd|secret|token|api-?key|(^|[-_])key$|authorization|cookie|signature|^sig$|forwarded|client-ip|coordinates|latitude|longitude/i;
  const EMAIL = /[a-z0-9._%+#-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
  const SECRET_PARAM = /((?:^|[?&])([a-z_-]*(key|secret|token)|sig|signature|code|password)=)[^&#\s"]+/gim;
  const BEARER = /\b(Bearer|Basic)\s+[a-z0-9._~+/=-]{8,}/gi;
  const JWT = /\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]*/gi;

  function anonymised(payload) {
    const people = new Map();
    const mails = new Map();
    const last = (k) => String(k || '').split('/').pop();
    const person = (n) => {
      n = String(n).trim();
      if (n.length >= 3 && !EMAIL.test(n) && !people.has(n)) people.set(n, '<person ' + (people.size + 1) + '>');
      EMAIL.lastIndex = 0;
    };
    const find = (v, k, d) => {
      if (v == null || d > 40) return;
      if (typeof v === 'string') {
        if (PERSON_KEY.test(last(k)) || PERSON_LOOKUP.test(k)) person(v);
        return;
      }
      if (typeof v !== 'object') return;
      if (Array.isArray(v)) return v.forEach((x) => find(x, k, d + 1));
      if (typeof v.table === 'string' && PERSON_TABLE.test(v.table) && v.name) person(v.name);
      // Someone as Microsoft 365 gives them: a name beside an email.
      if (typeof v.displayName === 'string' && (v.email || v.mail || v.userPrincipalName || v.userIdentityType || v.Email || v.Address)) person(v.displayName);
      if (typeof v.DisplayName === 'string' && (v.Email || v.Address || v.EmailAddress || v.Mail || v.UserPrincipalName)) person(v.DisplayName);
      if (typeof v.name === 'string' && typeof v.address === 'string' && v.address.includes('@')) person(v.name);
      for (const key of Object.keys(v)) find(v[key], key, d + 1);
    };
    find(payload, '', 0);
    const names = Array.from(people.keys()).sort((a, b) => b.length - a.length);
    // Whole words only: Ann is not replaced in Annual.
    const nameRe = names.length ? new RegExp('(?<![\\p{L}\\p{N}])(?:' + names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![\\p{L}\\p{N}])', 'gu') : null;
    const text = (t) => {
      t = t
        .replace(EMAIL, (m) => {
          const k = m.toLowerCase();
          if (!mails.has(k)) mails.set(k, '<email ' + (mails.size + 1) + '>');
          return mails.get(k);
        })
        .replace(SECRET_PARAM, '$1<removed>')
        .replace(BEARER, '$1 <removed>')
        .replace(JWT, '<removed>');
      return nameRe ? t.replace(nameRe, (m) => people.get(m)) : t;
    };
    const clean = (v, k, d) => {
      if (v == null || d > 40) return v;
      if (Array.isArray(v)) return v.map((x) => clean(x, k, d + 1));
      if (typeof v === 'object') {
        const o = {};
        for (const key of Object.keys(v)) o[key] = clean(v[key], key, d + 1);
        return o;
      }
      const key = last(k);
      if (typeof v === 'string' && (PERSON_KEY.test(key) || PERSON_LOOKUP.test(k))) return people.get(v.trim()) || text(v);
      if (PRIVATE_KEY.test(key) && v !== '' && typeof v !== 'boolean') {
        const t = typeof v === 'string' ? text(v) : '';
        return t && /^(<email \d+>[;,\s]*)+$/.test(t) ? t : '<removed>';
      }
      return typeof v === 'string' ? text(v) : v;
    };
    return Object.assign(
      { anonymised: 'People’s names, emails, phone numbers and addresses, keys, passwords and signatures are replaced as far as recognised - read it before you share it.' },
      clean(payload, '', 0)
    );
  }

  // The export tab inherits the portal's content security policy, which
  // blocks inline <script>. So the page ships without any script of its own
  // and everything in it is driven from here - see wire().
  function buildHtml(ctx) {
    const run = ctx.run;
    const p = run.properties || {};
    const flowName = flowNameOf(run);
    const L = ctx.L;

    const failure = failureOf(ctx.top, ctx.loops);
    const rootAt = new Set(failure ? failure.roots.filter((r) => r.i !== undefined).map((r) => r.i) : []);
    const loopAt = new Map(L.map((l, li) => [l.name, li]));
    const panel = (li) => '<div class="loop" data-li="' + li + '" tabindex="-1">' + loopHtml(L[li], li, ctx.state[li]) + '</div>';
    // A loop inside a loop: a section of its own after the one it is in.
    const nested = (name) =>
      L.map((l, li) =>
        l.outer === name ? '<section class="nest"><h2>' + esc(l.name) + ' <span class="meta">in ' + nice(name) + '</span></h2>' + panel(li) + '</section>' + nested(l.name) : ''
      ).join('');
    const placed = new Set();
    const rows = ctx.top
      .map((s, i) => {
        const cls = 'st-' + String(s.status || '').toLowerCase();
        const err = s.error
          ? '<div class="err"><b>' + esc(s.error.code || 'Error') + '</b> ' +
            esc(s.error.message || '') + '</div>'
          : '';
        const li = loopAt.get(s.name);
        if (li !== undefined) placed.add(s.name);
        return (
          '<section id="s-' + i + '"' + (rootAt.has(i) ? ' class="root"' : '') + '>' +
          '<h2><span class="pill ' + cls + '">' + esc(s.status || '?') + '</span> ' +
          esc(s.name) + ' <span class="meta">' + esc(s.kind) +
          (duration(s) ? ' &middot; ' + duration(s) : '') +
          (s.code ? ' &middot; ' + esc(s.code) : '') +
          (s.loop ? ' &middot; in a loop, ' + esc(s.loop) + ' times' : '') +
          (retried(s) ? ' &middot; ' + retried(s) : '') +
          '</span></h2>' +
          err +
          (li !== undefined ? panel(li) : '') +
          '<h3>Inputs</h3><pre>' + DynaBoost.code.html(fmt(s.inputs), 'json') + '</pre>' +
          '<h3>Outputs</h3><pre>' + DynaBoost.code.html(fmt(s.outputs), 'json') + '</pre>' +
          '</section>' +
          (li !== undefined ? nested(s.name) : '')
        );
      })
      .join('');
    // Loops whose own step is not in the run's list: at the end.
    const rest = L.map((l, li) =>
      !placed.has(l.name) && !(l.outer && loopAt.has(l.outer)) ? '<section class="nest"><h2>' + esc(l.name) + '</h2>' + panel(li) + '</section>' + nested(l.name) : ''
    ).join('');

    const head =
      '<header><h1>' + esc(flowName) + '</h1>' +
      '<div class="crumbs">Run ' + esc(run.name) + ' &middot; ' + esc(p.status || '') +
      (p.startTime ? ' &middot; ' + esc(p.startTime) : '') +
      (took(spanOf(p)) ? ' &middot; took ' + took(spanOf(p)) : '') +
      ' &middot; ' + ctx.top.length + ' steps' +
      (L.length ? ' &middot; ' + plural(L.length, 'loop') : '') + '</div>' +
      startedHtml(startedOf(ctx.top, run), envOf(run)) +
      // The run's own "An action failed" says nothing Where it failed does not.
      (p.error && !(failure && followed(p))
        ? '<div class="err"><b>' + esc(p.error.code || 'Error') + '</b> ' +
          esc(p.error.message || '') + '</div>'
        : '') +
      failBox(failure) +
      (ctx.loops && ctx.loops.error
        ? '<div class="note">Loop iterations could not be read (' + esc(ctx.loops.error) + ') – a loop’s actions are shown once, as the run reports them.</div>'
        : '') +
      '<div class="actions"><button id="copy" class="primary">Copy everything</button>' +
      '<button id="anon" title="Everything, with people’s names, emails, phone numbers and addresses, keys, passwords and signatures replaced – to paste into a ticket">Copy without personal data</button>' +
      '<button id="json">Download JSON</button></div></header>';

    return (
      '<!doctype html><meta charset="utf-8"><title>' + esc(flowName) + ' - run export</title>' +
      '<style>' +
      'body{margin:0;font:14px/1.5 "Segoe UI",system-ui,sans-serif;color:var(--dbc-fg-10224e);background:var(--dbc-bg-f5f7fc)}' +
      'header{padding:16px 22px 12px}' +
      'main{padding:20px 0;min-width:0}' +
      '.wrap{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:18px;padding:0 22px}' +
      '@media (max-width:900px){.wrap{grid-template-columns:1fr}aside{position:static;max-height:none}}' +
      'aside{position:sticky;top:12px;align-self:start;margin-top:20px;max-height:calc(100vh - 24px);overflow:auto;padding:12px 12px 8px;background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px}' +
      '.rh{display:flex;align-items:center;gap:8px;margin:0 2px 2px;font-size:15px}' +
      '.cnt{padding:0 7px;border-radius:9px;background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f);font-size:12px;font-weight:600}' +
      '.rsub{margin:0 2px 8px;font-size:12px;color:var(--dbc-fg-56637f)}' +
      '.rec{position:relative;display:block;margin:0 0 6px;padding:8px 26px 8px 10px;border:1px solid var(--dbc-bd-dde3f0);border-radius:7px;color:inherit;text-decoration:none}' +
      'a.rec:hover{border-color:var(--dbc-bd-1e6bff);background:var(--dbc-bg-f5f7fc)}' +
      '.ent{display:inline-block;margin-right:6px;padding:0 7px;border-radius:9px;background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-1e6bff);font-size:11.5px;font-weight:600;vertical-align:1px}' +
      '.nm{font-weight:600;word-break:break-word}.nm code{font:12px ui-monospace,Consolas,monospace;font-weight:400;color:var(--dbc-fg-56637f)}' +
      '.how{display:block;margin-top:3px;font-size:12px;color:var(--dbc-fg-56637f)}.how .step{color:var(--dbc-fg-10224e)}' +
      '.go{position:absolute;top:8px;right:9px;color:var(--dbc-fg-1e6bff);font-size:13px}' +
      '.none{margin:6px 2px 8px;font-size:13px;color:var(--dbc-fg-56637f)}' +
      'aside .rh~.rh{margin-top:16px}' +
      '.started{margin-top:2px;font-size:13px;color:var(--dbc-fg-56637f)}.started b{color:var(--dbc-fg-10224e);font-weight:600}.started .dim{margin-left:2px}' +
      '.card{padding-right:10px}.hw{display:block}' +
      '.ent.good{background:var(--dbc-bg-e4f4e8);color:var(--dbc-fg-1c6b32)}.ent.bad{background:var(--dbc-bg-fde8e8);color:var(--dbc-fg-a11a1a)}' +
      '.how .who{display:block;margin-bottom:2px;color:var(--dbc-fg-10224e);word-break:break-word}.how .who b{margin-right:3px;color:var(--dbc-fg-56637f);font-weight:600}' +
      '.cols{display:block;margin:1px 0 3px;font:11.5px ui-monospace,Consolas,monospace;color:var(--dbc-fg-56637f);word-break:break-word}' +
      'a.step{color:var(--dbc-fg-10224e);text-decoration:none}a.step:hover{color:var(--dbc-fg-1e6bff);text-decoration:underline}' +
      '.atts{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0}.att{padding:1px 7px;border:1px solid var(--dbc-bd-dde3f0);border-radius:5px;font-size:11.5px;color:var(--dbc-fg-10224e)}.att i{font-style:normal;color:var(--dbc-fg-56637f)}' +
      '.dim{font-style:normal;font-weight:400;color:var(--dbc-fg-56637f)}' +
      '.ln{display:flex;align-items:center;flex-wrap:wrap;gap:3px 8px;margin:0 0 2px;padding:5px 7px;border-radius:6px;color:inherit;text-decoration:none;font-size:12.5px}' +
      'a.ln:hover{background:var(--dbc-bg-f5f7fc)}' +
      '.ln .k{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ln .v{color:var(--dbc-fg-56637f);font-variant-numeric:tabular-nums}' +
      '.ln .pill{padding:0 6px;font-size:11px}' +
      '.mth{min-width:34px;font:600 11px ui-monospace,Consolas,monospace;color:var(--dbc-fg-1e6bff)}' +
      '.vn{font:600 12px ui-monospace,Consolas,monospace;color:var(--dbc-fg-10224e)}.vv{text-align:right;font:12px ui-monospace,Consolas,monospace;color:var(--dbc-fg-56637f)}' +
      '.bar{flex-basis:100%;height:4px;border-radius:2px;background:var(--dbc-bg-eef2f9)}.bar i{display:block;height:100%;border-radius:2px;background:var(--dbc-bg-e3b04b)}' +
      '.file{padding-right:10px}.file .ent{background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f)}' +
      '.fn{font-weight:600;color:inherit;text-decoration:none;word-break:break-word}.fn:hover{color:var(--dbc-fg-1e6bff);text-decoration:underline}' +
      '.fgo{margin-left:5px;color:var(--dbc-fg-1e6bff);font-size:12px;font-weight:400}' +
      '.fold{display:block;margin-top:3px;font-size:12px;color:var(--dbc-fg-56637f);text-decoration:none;word-break:break-all}a.fold:hover{color:var(--dbc-fg-1e6bff);text-decoration:underline}' +
      'h1{margin:0 0 4px;font-size:20px}' +
      'h2{margin:0 0 6px;font-size:15px;font-weight:600}' +
      'h3{margin:12px 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--dbc-fg-56637f)}' +
      'h4{margin:0 0 4px;font-size:14px;font-weight:600}' +
      '.meta{font-size:12.5px;color:var(--dbc-fg-56637f);font-weight:400}' +
      'section{margin:0 0 14px;padding:14px 16px;background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px}' +
      'pre{margin:0;padding:10px;background:var(--dbc-bg-f5f7fc);border:1px solid var(--dbc-bd-dde3f0);border-radius:6px;' +
      'font:12.5px ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto}' +
      '.pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600;background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f)}' +
      '.st-succeeded{background:var(--dbc-bg-e4f4e8);color:var(--dbc-fg-1c6b32)}.st-failed{background:var(--dbc-bg-fde8e8);color:var(--dbc-fg-a11a1a)}' +
      '.st-skipped{background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f)}.st-running{background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-1e6bff)}' +
      '.fail{margin:12px 0 2px;padding:12px 14px;background:var(--dbc-bg-fde8e8);border:1px solid var(--dbc-bd-a11a1a);border-left-width:4px;border-radius:8px;color:var(--dbc-fg-7a1414);max-width:1100px}' +
      '.fail-h{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--dbc-fg-a11a1a);margin-bottom:6px}' +
      '.fail-r+.fail-r{margin-top:10px;padding-top:10px;border-top:1px solid var(--dbc-bd-a11a1a)}' +
      '.fail-s{font-size:15px;font-weight:700;color:var(--dbc-fg-a11a1a);text-decoration:none;cursor:pointer}.fail-s:hover{text-decoration:underline}' +
      '.fail-m{font-size:12.5px;color:var(--dbc-fg-7a1414);margin-left:6px}' +
      '.fail-it{margin:2px 0 0;font-size:13px}.fail-it a{color:var(--dbc-fg-a11a1a);font-weight:700}' +
      '.fail-t{margin:4px 0 0;font-size:13.5px}' +
      '.fail pre{margin:6px 0 0;background:var(--dbc-bg-fff);border-color:var(--dbc-bd-a11a1a);color:var(--dbc-fg-10224e);max-height:220px}' +
      '.fail-n{margin-top:8px;font-size:12.5px}' +
      '.note{margin:10px 0 0;font-size:12.5px;color:var(--dbc-fg-56637f)}' +
      'section.root{border-color:var(--dbc-bd-a11a1a);border-left-width:4px}' +
      '.err{margin:6px 0;padding:8px 10px;background:var(--dbc-bg-fde8e8);border-radius:6px;font-size:13px;color:var(--dbc-fg-7a1414)}' +
      '.actions{margin-top:12px;display:flex;gap:8px}' +
      // A loop: the strip of iterations, the one picked under it.
      '.loop{margin:10px 0 4px;padding:12px;background:var(--dbc-bg-f5f7fc);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px;outline:none}' +
      '.loop:focus-visible{border-color:var(--dbc-bd-1e6bff)}' +
      '.lp-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}' +
      '.lp-sum b{font-size:13.5px}' +
      '.lp-bad{margin-left:8px;padding:1px 8px;border-radius:10px;background:var(--dbc-bg-fde8e8);color:var(--dbc-fg-a11a1a);font-size:12px;font-weight:600}' +
      '.lp-sp{flex:1}' +
      '.lp-cut{margin:-2px 0 8px;font-size:12.5px;color:var(--dbc-fg-7a1414)}' +
      '.seg{display:inline-flex;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;overflow:hidden}' +
      '.seg button{padding:4px 12px;border:0;border-radius:0;font-size:12.5px}.seg button+button{border-left:1px solid var(--dbc-bd-c6d0e4)}' +
      '.seg button[aria-pressed="true"]{background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-1e6bff);font-weight:600}' +
      '.lp-chips{position:relative;display:flex;flex-wrap:wrap;gap:5px;max-height:106px;overflow:auto;padding:2px}' +
      '.chip{min-width:34px;padding:3px 7px;border:1px solid transparent;border-radius:6px;font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums}' +
      '.chip:hover{border-color:var(--dbc-bd-1e6bff)}' +
      '.chip[aria-pressed="true"]{border-color:var(--dbc-bd-1e6bff);box-shadow:0 0 0 1px var(--dbc-bd-1e6bff)}' +
      '.lp-cur{margin-top:10px;padding-top:10px;border-top:1px solid var(--dbc-bd-dde3f0)}' +
      '.lp-ch{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}' +
      '.lp-ch b{font-size:14px}.lp-of{font-size:12.5px;color:var(--dbc-fg-56637f)}' +
      '.lp-nav{padding:1px 10px;font-size:17px;line-height:1.3}' +
      '.lp-ci,.lp-cf{padding:5px 11px;font-size:12.5px}' +
      '.act{margin:0 0 10px;padding:10px 12px;background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:7px}' +
      '.act:last-child{margin-bottom:0}.act.root{border-color:var(--dbc-bd-a11a1a);border-left-width:4px}' +
      '.lp-wait{display:flex;align-items:center;gap:10px;padding:8px 2px;font-size:13px;color:var(--dbc-fg-56637f)}' +
      'button.primary{background:var(--dbc-bg-1e6bff);border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-fff);font-weight:600}' +
      'button.primary:hover{background:var(--dbc-bg-155ee0);color:var(--dbc-fg-fff)}' +
      'button{padding:7px 13px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);font:inherit;cursor:pointer}' +
      'button:hover{border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-1e6bff)}' +
      'button:disabled{opacity:.45;cursor:default;border-color:var(--dbc-bd-c6d0e4);color:var(--dbc-fg-10224e)}' +
      'button svg{width:14px;height:14px;vertical-align:-2px;margin-right:6px}' +
      'button.db-ok{border-color:var(--dbc-bd-1c6b32);color:var(--dbc-fg-1c6b32);background:var(--dbc-bg-e4f4e8)}' +
      'button.db-bad{border-color:var(--dbc-bd-a11a1a);color:var(--dbc-fg-a11a1a);background:var(--dbc-bg-fde8e8)}' +
      DynaBoost.code.css +
      DynaBoost.status.css +
      DynaBoost.tabCss +
      '</style>' +
      head +
      '<div class="wrap"><main>' + rows + rest + '</main>' + asideHtml(touchedOf(ctx)) + '</div>'
    );
  }

  // ---------- wiring the export tab ----------

  const CHECK =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="m5 13 4 4L19 7" stroke="currentColor" stroke-width="2.4" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const CROSS =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" ' +
    'stroke-linecap="round"/></svg>';

  function flash(btn, text, ok) {
    if (btn.__dbTimer) clearTimeout(btn.__dbTimer);
    if (btn.__dbLabel == null) btn.__dbLabel = btn.textContent;
    btn.innerHTML = (ok ? CHECK : CROSS) + text;
    btn.classList.remove('db-ok', 'db-bad');
    btn.classList.add(ok ? 'db-ok' : 'db-bad');
    btn.__dbTimer = setTimeout(() => {
      btn.textContent = btn.__dbLabel;
      btn.classList.remove('db-ok', 'db-bad');
    }, 2200);
  }

  async function copyInto(tab, text) {
    // The export tab has focus, so its clipboard API is the one allowed to
    // write; ours would be rejected as "document not focused".
    try {
      await tab.navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const doc = tab.document;
        const ta = doc.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        doc.body.appendChild(ta);
        ta.select();
        const ok = doc.execCommand('copy');
        doc.body.removeChild(ta);
        return ok;
      } catch (e2) {
        return false;
      }
    }
  }

  function wire(tab, ctx) {
    const doc = tab.document;
    const L = ctx.L;
    const copyBtn = doc.getElementById('copy');
    const jsonBtn = doc.getElementById('json');
    if (!copyBtn || !jsonBtn) return;
    const boxOf = (li) => doc.querySelector('.loop[data-li="' + li + '"]');
    const current = (li) => L[li].iterations.find((x) => x.key === ctx.state[li].cur) || L[li].iterations[0];
    const head = () => ({ flow: flowNameOf(ctx.run), run: ctx.run.name, status: (ctx.run.properties || {}).status });

    // The Records column again, as more iterations are read - not at every one.
    let recTimer = 0;
    const refreshRecords = () => {
      if (recTimer) return;
      recTimer = setTimeout(() => {
        recTimer = 0;
        const aside = doc.querySelector('aside');
        if (!aside || tab.closed) return;
        const top = aside.scrollTop;
        aside.outerHTML = asideHtml(touchedOf(ctx));
        doc.querySelector('aside').scrollTop = top;
      }, 300);
    };

    // An action's payloads, fetched once however many ask for them.
    const ensure = (acts) => {
      const fresh = acts.filter((a) => !a.loaded && !a.pending);
      if (fresh.length) {
        const p = fill(fresh, ctx.fetchMany).catch((e) => {
          for (const a of fresh) {
            if (a.loaded) continue;
            a.loaded = true;
            if (a.inputs === undefined && a.inputsLink) a.inputs = '[fetch failed - ' + e.message + ']';
            if (a.outputs === undefined && a.outputsLink) a.outputs = '[fetch failed - ' + e.message + ']';
          }
        });
        for (const a of fresh) a.pending = p;
      }
      return Promise.all(acts.map((a) => a.pending)).then(refreshRecords);
    };

    const paint = (li, focus) => {
      const box = boxOf(li);
      if (!box) return;
      box.innerHTML = loopHtml(L[li], li, ctx.state[li]);
      if (focus) box.focus({ preventScroll: true });
      // The picked number in sight in a long strip.
      const chips = box.querySelector('.lp-chips');
      const on = box.querySelector('.chip[aria-pressed="true"]');
      if (chips && on && (on.offsetTop < chips.scrollTop || on.offsetTop + on.offsetHeight > chips.scrollTop + chips.clientHeight)) chips.scrollTop = on.offsetTop - 4;
      const it = current(li);
      if (it.actions.some((a) => !a.loaded)) {
        ensure(it.actions).then(() => {
          if (!tab.closed && current(li) === it) paint(li, false);
        });
      }
    };

    const shownOf = (li) => (ctx.state[li].filter === 'failed' ? L[li].iterations.filter(isBad) : L[li].iterations);

    const select = (li, key, scroll) => {
      const it = L[li].iterations.find((x) => x.key === key);
      if (!it) return;
      ctx.state[li].cur = key;
      if (ctx.state[li].filter === 'failed' && !isBad(it)) ctx.state[li].filter = 'all';
      paint(li, true);
      const box = boxOf(li);
      if (scroll && box) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const move = (li, d) => {
      const shown = shownOf(li);
      const to = shown[shown.findIndex((x) => x.key === ctx.state[li].cur) + d];
      if (to) {
        ctx.state[li].cur = to.key;
        paint(li, true);
      }
    };

    const setFilter = (li, f) => {
      const st = ctx.state[li];
      st.filter = f;
      if (f === 'failed' && !isBad(current(li))) st.cur = L[li].iterations.find(isBad).key;
      paint(li, true);
    };

    // Copy iteration / Copy failed iterations: read what is missing, then copy.
    const copyLoop = async (li, which, btn) => {
      const its = which === 'one' ? [current(li)] : L[li].iterations.filter(isBad);
      const acts = [].concat.apply([], its.map((it) => it.actions));
      if (acts.some((a) => !a.loaded)) {
        btn.disabled = true;
        btn.textContent = 'Reading…';
        await ensure(acts);
        btn = boxOf(li).querySelector(which === 'one' ? '.lp-ci' : '.lp-cf') || btn;
        btn.disabled = false;
      }
      const body = which === 'one' ? { loop: L[li].name, iteration: iterJson(its[0]) } : { loop: L[li].name, failedIterations: its.map(iterJson) };
      const ok = await copyInto(tab, JSON.stringify(Object.assign(head(), body), null, 2));
      flash(btn, ok ? 'Copied' : 'Copy failed – click again', ok);
      if (ok) DynaBoost.saved('flow-run-export', 'iteration');
    };

    doc.addEventListener('click', (e) => {
      const t = e.target && e.target.closest ? e.target.closest('a.rec,a.run,a.fn,a.fold,[data-go],[data-it],[data-f],.lp-nav,.lp-ci,.lp-cf') : null;
      if (!t) return;
      // A record opened from the Records column: a use of its own, per click.
      if (t.matches('a.run')) return DynaBoost.saved('flow-run-export', 'child');
      if (t.matches('a.rec')) return DynaBoost.saved('flow-run-export', 'record');
      // A file or its folder opened from the Files list: the same, per click.
      if (t.matches('a.fn,a.fold')) return DynaBoost.saved('flow-run-export', 'file');
      e.preventDefault();
      if (t.hasAttribute('data-go')) {
        const to = doc.getElementById(t.getAttribute('data-go'));
        if (to) to.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const box = t.closest('.loop');
      const li = Number(t.getAttribute('data-li') || (box && box.getAttribute('data-li')));
      if (!L[li] || t.disabled) return;
      if (t.hasAttribute('data-it')) select(li, t.getAttribute('data-it'), !box);
      else if (t.hasAttribute('data-f')) setFilter(li, t.getAttribute('data-f'));
      else if (t.classList.contains('lp-nav')) move(li, Number(t.getAttribute('data-step')));
      else copyLoop(li, t.classList.contains('lp-ci') ? 'one' : 'failed', t);
    });

    // ← and → step through the iterations of the loop in focus - or of the
    // only loop there is.
    const strips = L.map((l, li) => li).filter((li) => L[li].iterations.length > 1);
    doc.addEventListener('keydown', (e) => {
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) return;
      const box = e.target && e.target.closest ? e.target.closest('.loop') : null;
      const li = box ? Number(box.getAttribute('data-li')) : strips.length === 1 ? strips[0] : -1;
      if (!L[li] || L[li].iterations.length < 2) return;
      e.preventDefault();
      move(li, e.key === 'ArrowLeft' ? -1 : 1);
    });

    // The iterations not read yet, in the background - the failed ones
    // first - so the copies are ready; up to PREFETCH links.
    const prefetch = async () => {
      const its = [];
      for (const l of L) its.push.apply(its, l.iterations);
      its.sort((a, b) => isBad(b) - isBad(a));
      let links = 0;
      let group = [];
      for (const it of its) {
        if (!it.actions.some((a) => !a.loaded)) continue;
        const n = linksIn(it.actions);
        if (links + n > PREFETCH) break;
        links += n;
        group = group.concat(it.actions);
        if (linksIn(group) >= LIMIT * 3) {
          await ensure(group);
          group = [];
          if (tab.closed) return;
        }
      }
      if (group.length) await ensure(group);
    };
    const ready = prefetch().catch(() => {});

    // Copy everything / Download: once the background reading is done.
    const whole = async (btn, then) => {
      btn.disabled = true;
      const label = btn.__dbLabel || btn.textContent;
      if (L.length) btn.textContent = 'Reading iterations…';
      await ready;
      btn.disabled = false;
      btn.textContent = label;
      then(JSON.stringify(payloadOf(ctx), null, 2));
    };

    copyBtn.addEventListener('click', () =>
      whole(copyBtn, async (text) => {
        const ok = await copyInto(tab, text);
        flash(copyBtn, ok ? 'Copied' : 'Copy failed – click again', ok);
      })
    );

    const anonBtn = doc.getElementById('anon');
    if (anonBtn) {
      anonBtn.addEventListener('click', () =>
        whole(anonBtn, async (text) => {
          const ok = await copyInto(tab, JSON.stringify(anonymised(JSON.parse(text)), null, 2));
          flash(anonBtn, ok ? 'Copied' : 'Copy failed – click again', ok);
          if (ok) DynaBoost.saved('flow-run-export', 'anonymised');
        })
      );
    }

    jsonBtn.addEventListener('click', () =>
      whole(jsonBtn, (text) => {
        try {
          const blob = new tab.Blob([text], { type: 'application/json' });
          const url = tab.URL.createObjectURL(blob);
          const a = doc.createElement('a');
          a.href = url;
          a.download = String(ctx.run.name) + '.json';
          doc.body.appendChild(a);
          a.click();
          doc.body.removeChild(a);
          setTimeout(() => tab.URL.revokeObjectURL(url), 10000);
          flash(jsonBtn, 'Downloaded', true);
        } catch (e) {
          flash(jsonBtn, 'Download failed', false);
        }
      })
    );

    // The iterations picked at the start that are not read yet.
    L.forEach((l, li) => {
      if (current(li).actions.some((a) => !a.loaded)) paint(li, false);
    });
  }

  // ---------- run ----------

  const NO_RUN =
    'No run data captured yet.\n\n' +
    'Open a flow run and press F5 — DynaBoost reads the response the ' +
    'portal fetches, so it has to be loaded with the page.';
  const STILL_RUNNING = 'This run is still in progress, so most actions are missing.\n\n' + 'Export what there is anyway?';

  function openTab() {
    const tab = window.open('', '_blank');
    if (tab) {
      tab.document.write(
        '<!doctype html><meta charset="utf-8"><title>Exporting…</title>' +
          '<body style="font:14px/1.5 \'Segoe UI\',system-ui,sans-serif;padding:24px;color:var(--dbc-fg-10224e)">' +
          '<p id="s">Collecting run data…</p>'
      );
      DynaBoost.themeTab(tab);
    }
    return tab;
  }

  /* got: the steps and loops collect() gave; fetchMany: how the tab gets a
   * payload later - here, or from the frame that has the run. */
  async function show(tab, data, got, fetchMany) {
    const loops = got.loops || null;
    const inner = new Set(loops ? loops.inner : []);
    const L = loops ? loops.list : [];
    const ctx = {
      run: data,
      top: got.steps.filter((s) => !inner.has(s.name)),
      loops: loops,
      L: L,
      fetchMany: fetchMany,
      // Each loop opens on its first failed iteration, Failed on while some passed.
      state: L.map((l) => {
        const bad = l.iterations.filter(isBad);
        return { filter: bad.length && bad.length < l.iterations.length ? 'failed' : 'all', cur: (bad[0] || l.iterations[0]).key };
      }),
      host: await hostFor(data),
      apps: await lastApps()
    };
    if (tab && !tab.closed) {
      tab.document.open();
      tab.document.write(buildHtml(ctx));
      tab.document.close();
      DynaBoost.themeTab(tab);
      wire(tab, ctx);
    } else {
      window.alert('The export tab was blocked. Allow pop-ups for this site and try again.');
    }
  }

  async function run() {
    const data = pickRun();
    if (!data) {
      window.alert(NO_RUN);
      return;
    }
    if ((data.properties || {}).status === 'Running' && !window.confirm(STILL_RUNNING)) return;

    const tab = openTab();
    const got = await collect(data, (done, total) => {
      if (tab && !tab.closed) {
        const el = tab.document.getElementById('s');
        if (el) el.textContent = 'Fetching payloads… ' + done + ' / ' + total;
      }
    });
    await show(tab, data, got, fetchHere);
    if (tab && !tab.closed) DynaBoost.saved('flow-run-export');
  }

  /* In make.powerapps.com the run is in a frame from make.powerautomate.com:
   * the frame has the run and fetches its payloads (frameAnswer), this page
   * opens the tab - a frame may not open one on a click made outside it. */
  async function frameRun(ask) {
    let found;
    try {
      found = await ask('status');
    } catch (e) {
      window.alert('Could not reach the flow.\n\n' + e.message);
      return;
    }
    if (!found || !found.name) {
      window.alert(NO_RUN);
      return;
    }
    if (found.status === 'Running' && !window.confirm(STILL_RUNNING)) return;

    const tab = openTab();
    let got;
    try {
      got = await ask('collect');
    } catch (e) {
      if (tab && !tab.closed) tab.close();
      window.alert('Could not read the run.\n\n' + e.message);
      return;
    }
    await show(tab, got.data, got, (links) => ask('links', links));
    if (tab && !tab.closed) DynaBoost.saved('flow-run-export');
  }

  function frameAnswer(op, payload) {
    if (op === 'links') return Promise.all((Array.isArray(payload) ? payload : []).slice(0, LIMIT).map(fetchLink));
    const data = pickRun();
    if (op === 'status') return data ? { name: data.name, status: (data.properties || {}).status } : {};
    if (op === 'collect') {
      if (!data) throw new Error('No run data captured yet.');
      return collect(data, () => {}).then((got) => ({ data: data, steps: got.steps, loops: got.loops }));
    }
    throw new Error('Unknown request.');
  }

  // The hook only goes in where there is something to capture; the tile itself
  // is registered everywhere and the panel hides it off-site (see core.js).
  if (/make\.powerautomate\.com$/i.test(location.hostname)) injectHook();

  DynaBoost.register({
    id: 'flow-run-export',
    name: 'Export run',
    group: 'Power Automate flows',
    hosts: ['make.powerautomate.com'],
    when: () => /\/flows\//i.test(location.pathname),
    inFrames: true,
    type: 'action',
    hint: 'Every input and output of the run in one tab',
    icon: ICON,
    onRun: run,
    frameRun: frameRun,
    frameAnswer: frameAnswer
  });
})();
