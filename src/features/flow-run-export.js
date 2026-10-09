/* Feature: Export run. Opens the run you are looking at in a read-only tab:
 * the trigger and every action with inputs, outputs, status, timing and
 * errors - and beside them the Dataverse records the run touched, each with
 * its table and a link to open it in Dynamics 365.
 *
 * The data is the portal's own .../runs/{runName}?api-version=1 response,
 * passed on by flow-run-hook.js - no API call of our own, no token. Large
 * payloads come as inputsLink / outputsLink (SAS URLs that expire) and are
 * fetched on the click - and so is a large body inside them, which comes as
 * a link of its own (bodyContentLink). Iterations of Apply to each are not
 * expanded (one request per item); loops are listed with a note.
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

  // ---------- collecting ----------

  function duration(a) {
    if (!a.startTime || !a.endTime) return '';
    const ms = new Date(a.endTime) - new Date(a.startTime);
    if (!isFinite(ms)) return '';
    return ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(2) + ' s';
  }

  async function fetchLink(link) {
    if (!link || !link.uri) return undefined;
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

    // Only the payloads the portal did not inline need a request.
    const jobs = [];
    for (const s of steps) {
      if (s.inputs === undefined && s.inputsLink) jobs.push([s, 'inputs', s.inputsLink]);
      if (s.outputs === undefined && s.outputsLink) jobs.push([s, 'outputs', s.outputsLink]);
    }

    let done = 0;
    const LIMIT = 6;
    for (let i = 0; i < jobs.length; i += LIMIT) {
      const slice = jobs.slice(i, i + LIMIT);
      await Promise.all(
        slice.map(async ([step, field, link]) => {
          step[field] = await fetchLink(link);
          done++;
          if (onProgress) onProgress(done, jobs.length);
        })
      );
    }

    // A large body inside them is one more link: fetched, and put where the
    // body belongs - the error a service sent back is often there.
    const inner = [];
    for (const s of steps) {
      contentLinks(s.inputs, inner, 0);
      contentLinks(s.outputs, inner, 0);
    }
    const total = jobs.length + inner.length;
    for (let i = 0; i < inner.length; i += LIMIT) {
      await Promise.all(
        inner.slice(i, i + LIMIT).map(async ([obj, key, base, link]) => {
          const got = await fetchLink(link);
          if (obj[base] === undefined) {
            delete obj[key];
            obj[base] = got;
          } else obj[key] = got;
          done++;
          if (onProgress) onProgress(done, total);
        })
      );
    }

    return steps;
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
    if (!out.length && typeof body === 'string' && body.trim() && !/^\[fetch failed|^\[not fetched/.test(body)) {
      add(body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 800));
    }
    return out;
  }

  // The steps a failure started in - each with what it said - and the ones
  // that failed because of them.
  function failureOf(steps) {
    const failed = steps.map((s, i) => ({ s: s, i: i })).filter((x) => FAILED.test(x.s.status || ''));
    if (!failed.length) return null;
    const roots = failed.filter((x) => !followed(x.s));
    const firsts = (roots.length ? roots : failed.slice(0, 1)).slice(0, 3);
    return {
      roots: firsts.map((x) => {
        const s = x.s;
        const o = s.outputs && typeof s.outputs === 'object' ? s.outputs : {};
        const inp = s.inputs && typeof s.inputs === 'object' ? s.inputs : {};
        return {
          i: x.i,
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
      }),
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
    }
    // An action's table and id came before the run showed its table name.
    for (const rec of found.values()) if (!rec.host) rec.host = host;
    return Array.from(found.values());
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
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  function fmt(v) {
    if (v === undefined) return '(none)';
    if (typeof v === 'string') return v;
    try {
      return JSON.stringify(v, null, 2);
    } catch (e) {
      return String(v);
    }
  }

  function failBox(f) {
    if (!f) return '';
    const plural = (n, one) => n + ' ' + one + (n === 1 ? '' : 's');
    const roots = f.roots
      .map((r) => {
        const meta = [r.kind, r.statusCode ? 'HTTP ' + r.statusCode : '', r.code, r.operation, r.retries ? 'retried ' + plural(r.retries, 'time') : '', r.loop ? 'in a loop, ' + r.loop + ' times' : '']
          .filter(Boolean)
          .map(esc)
          .join(' &middot; ');
        return (
          '<div class="fail-r"><a class="fail-s" href="#s-' + r.i + '" data-go="s-' + r.i + '" title="Go to this step">' + esc(String(r.step).replace(/_/g, ' ')) + '</a>' +
          '<span class="fail-m">' + meta + '</span>' +
          (r.message ? '<div class="fail-t">' + esc(r.message) + '</div>' : '') +
          r.details.map((d) => '<pre>' + esc(d) + '</pre>').join('') +
          '</div>'
        );
      })
      .join('');
    const after = [];
    if (f.followed.length) after.push('Failed because of it: ' + f.followed.map((n) => esc(String(n).replace(/_/g, ' '))).join(', ') + '.');
    if (f.skipped) after.push(plural(f.skipped, 'step') + ' skipped.');
    return (
      '<div class="fail"><div class="fail-h">Where it failed</div>' + roots +
      (after.length ? '<div class="fail-n">' + after.join(' ') + '</div>' : '') +
      '</div>'
    );
  }

  function buildHtml(run, steps, records) {
    records = records || [];
    const p = run.properties || {};
    const flowName =
      (p.flow && p.flow.properties && p.flow.properties.displayName) || 'Flow run';

    const failure = failureOf(steps);
    const rootAt = new Set(failure ? failure.roots.map((r) => r.i) : []);
    const rows = steps
      .map((s, i) => {
        const cls = 'st-' + String(s.status || '').toLowerCase();
        const err = s.error
          ? '<div class="err"><b>' + esc(s.error.code || 'Error') + '</b> ' +
            esc(s.error.message || '') + '</div>'
          : '';
        return (
          '<section id="s-' + i + '"' + (rootAt.has(i) ? ' class="root"' : '') + '>' +
          '<h2><span class="pill ' + cls + '">' + esc(s.status || '?') + '</span> ' +
          esc(s.name) + ' <span class="meta">' + esc(s.kind) +
          (duration(s) ? ' &middot; ' + duration(s) : '') +
          (s.code ? ' &middot; ' + esc(s.code) : '') +
          (s.loop ? ' &middot; in a loop, ' + esc(s.loop) + ' times' : '') +
          (Array.isArray(s.retries) && s.retries.length ? ' &middot; retried ' + s.retries.length + ' time' + (s.retries.length > 1 ? 's' : '') : '') +
          '</span></h2>' +
          err +
          '<h3>Inputs</h3><pre>' + DynaBoost.code.html(fmt(s.inputs), 'json') + '</pre>' +
          '<h3>Outputs</h3><pre>' + DynaBoost.code.html(fmt(s.outputs), 'json') + '</pre>' +
          '</section>'
        );
      })
      .join('');

    // The records the run touched, beside the steps: what each is, and a link.
    const recs = records.length
      ? records
          .map((r) => {
            const how = r.how.map((h) => esc(h.how) + ' <span class="step">' + esc(String(h.step).replace(/_/g, ' ')) + '</span>').join('<br>');
            const inner =
              '<span class="ent">' + esc(r.entity) + '</span>' +
              '<span class="nm">' + (r.name ? esc(r.name) : '<code>' + esc(r.id) + '</code>') + '</span>' +
              '<span class="how">' + how + '</span>';
            return r.host
              ? '<a class="rec" href="' + esc(recordUrl(r)) + '" target="_blank" rel="noopener noreferrer" title="Open this ' + esc(r.entity) + ' in Dynamics 365">' + inner + '<span class="go">\u2197</span></a>'
              : '<div class="rec" title="The environment\u2019s address is not known - open make.powerautomate.com\u2019s environment list once">' + inner + '</div>';
          })
          .join('')
      : '<div class="none">No Dataverse records in this run.</div>';
    const aside =
      '<aside><div class="rh"><b>Records</b><span class="cnt">' + records.length + '</span></div>' +
      (records.length ? '<div class="rsub">Every row this run read, created, changed or pointed at \u2013 click to open it in Dynamics 365.</div>' : '') +
      recs + '</aside>';

    const head =
      '<header><h1>' + esc(flowName) + '</h1>' +
      '<div class="crumbs">Run ' + esc(run.name) + ' &middot; ' + esc(p.status || '') +
      (p.startTime ? ' &middot; ' + esc(p.startTime) : '') +
      ' &middot; ' + steps.length + ' steps</div>' +
      // The run's own "An action failed" says nothing Where it failed does not.
      (p.error && !(failure && followed(p))
        ? '<div class="err"><b>' + esc(p.error.code || 'Error') + '</b> ' +
          esc(p.error.message || '') + '</div>'
        : '') +
      failBox(failure) +
      '<div class="actions"><button id="copy" class="primary">Copy everything</button>' +
      '<button id="json">Download JSON</button></div></header>';

    const payload = JSON.stringify(
      {
        flow: flowName,
        run: run.name,
        status: p.status,
        startTime: p.startTime,
        endTime: p.endTime,
        error: p.error,
        failure: failure
          ? {
              startedIn: failure.roots.map((r) => Object.assign({}, r, { i: undefined })),
              failedWithIt: failure.followed.length ? failure.followed : undefined,
              skippedAfter: failure.skipped || undefined
            }
          : undefined,
        records: records.map((r) => ({ table: r.entity, id: r.id, name: r.name || undefined, url: r.host ? recordUrl(r) : undefined, steps: r.how })),
        steps: steps.map((s) => ({
          name: s.name,
          kind: s.kind,
          status: s.status,
          code: s.code,
          startTime: s.startTime,
          endTime: s.endTime,
          error: s.error,
          retries: Array.isArray(s.retries) && s.retries.length ? s.retries : undefined,
          loop: s.loop || undefined,
          inputs: s.inputs,
          outputs: s.outputs
        }))
      },
      null,
      2
    );

    const html =
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
      'h1{margin:0 0 4px;font-size:20px}' +
      'h2{margin:0 0 6px;font-size:15px;font-weight:600}' +
      'h3{margin:12px 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--dbc-fg-56637f)}' +
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
      '.fail-t{margin:4px 0 0;font-size:13.5px}' +
      '.fail pre{margin:6px 0 0;background:var(--dbc-bg-fff);border-color:var(--dbc-bd-a11a1a);color:var(--dbc-fg-10224e);max-height:220px}' +
      '.fail-n{margin-top:8px;font-size:12.5px}' +
      'section.root{border-color:var(--dbc-bd-a11a1a);border-left-width:4px}' +
      '.err{margin:6px 0;padding:8px 10px;background:var(--dbc-bg-fde8e8);border-radius:6px;font-size:13px;color:var(--dbc-fg-7a1414)}' +
      '.actions{margin-top:12px;display:flex;gap:8px}' +
      'button.primary{background:var(--dbc-bg-1e6bff);border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-fff);font-weight:600}' +
      'button.primary:hover{background:var(--dbc-bg-155ee0);color:var(--dbc-fg-fff)}' +
      'button{padding:7px 13px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;background:var(--dbc-bg-fff);font:inherit;cursor:pointer}' +
      'button:hover{border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-1e6bff)}' +
      'button svg{width:14px;height:14px;vertical-align:-2px;margin-right:6px}' +
      'button.db-ok{border-color:var(--dbc-bd-1c6b32);color:var(--dbc-fg-1c6b32);background:var(--dbc-bg-e4f4e8)}' +
      'button.db-bad{border-color:var(--dbc-bd-a11a1a);color:var(--dbc-fg-a11a1a);background:var(--dbc-bg-fde8e8)}' +
      DynaBoost.code.css +
      DynaBoost.tabCss +
      '</style>' +
      head +
      '<div class="wrap"><main>' + rows + '</main>' + aside + '</div>';

    // The export tab inherits the portal's content security policy, which
    // blocks inline <script>. So the page ships without any script of its own
    // and the buttons get their handlers attached from here - see wire().
    return { html: html, payload: payload };
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

  function wire(tab, filename, payload) {
    const doc = tab.document;
    const copyBtn = doc.getElementById('copy');
    const jsonBtn = doc.getElementById('json');
    if (!copyBtn || !jsonBtn) return;

    // A record opened from the Records column: a use of its own, per click.
    for (const a of doc.querySelectorAll('a.rec')) a.addEventListener('click', () => DynaBoost.saved('flow-run-export', 'record'));

    // Where it failed: a click goes to the step.
    for (const a of doc.querySelectorAll('[data-go]')) {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const to = doc.getElementById(a.getAttribute('data-go'));
        if (to) to.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    copyBtn.addEventListener('click', async () => {
      const ok = await copyInto(tab, payload);
      flash(copyBtn, ok ? 'Copied' : 'Press Ctrl+A, Ctrl+C', ok);
    });

    jsonBtn.addEventListener('click', () => {
      try {
        const blob = new tab.Blob([payload], { type: 'application/json' });
        const url = tab.URL.createObjectURL(blob);
        const a = doc.createElement('a');
        a.href = url;
        a.download = filename;
        doc.body.appendChild(a);
        a.click();
        doc.body.removeChild(a);
        setTimeout(() => tab.URL.revokeObjectURL(url), 10000);
        flash(jsonBtn, 'Downloaded', true);
      } catch (e) {
        flash(jsonBtn, 'Download failed', false);
      }
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

  async function show(tab, data, steps) {
    const records = findRecords(steps);
    if (records.some((r) => !r.host)) {
      const host = await hostFor(data);
      if (host) for (const r of records) if (!r.host) r.host = host;
    }
    const apps = await lastApps();
    for (const r of records) if (r.host && apps[r.host]) r.app = apps[r.host];
    const built = buildHtml(data, steps, records);
    if (tab && !tab.closed) {
      tab.document.open();
      tab.document.write(built.html);
      tab.document.close();
      DynaBoost.themeTab(tab);
      wire(tab, String(data.name) + '.json', built.payload);
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
    const steps = await collect(data, (done, total) => {
      if (tab && !tab.closed) {
        const el = tab.document.getElementById('s');
        if (el) el.textContent = 'Fetching payloads… ' + done + ' / ' + total;
      }
    });
    await show(tab, data, steps);
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
    await show(tab, got.data, got.steps);
    if (tab && !tab.closed) DynaBoost.saved('flow-run-export');
  }

  function frameAnswer(op) {
    const data = pickRun();
    if (op === 'status') return data ? { name: data.name, status: (data.properties || {}).status } : {};
    if (op === 'collect') {
      if (!data) throw new Error('No run data captured yet.');
      return collect(data, () => {}).then((steps) => ({ data: data, steps: steps }));
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
