/* Feature: Plugin traces (model-driven apps) - why a save failed, in a tab.
 *
 * The environment's plug-in trace log (plugintracelog) read with the Web API
 * and put together by execution: every entry with the same CorrelationId is
 * one save (or one message) with the plug-in steps it ran, in order, each
 * with its stage, mode, depth and how long it took. An execution with an
 * exception is red, with the exception's message on top in plain words; an
 * entry without one whose trace says "inner exception" or "an error
 * occurred" is an error too (the plug-in caught it and wrote it down).
 *
 * Views: Executions (the list, and the one picked: its steps, each step's
 * exception and trace, the system jobs with the same CorrelationId), By
 * plugin (runs, errors, average and slowest per step, counted by Dataverse)
 * and JSON. Copy takes what the view shows, Copy all the whole JSON - with
 * every listed execution's traces, read when asked for.
 *
 * Filters, all applied by Dataverse: the time window, the table, the plug-in
 * (its class), a solution (its plug-in steps and the types of its plug-in
 * assemblies), only errors, and text in the trace or the exception - a GUID
 * there finds its execution, whatever the window. The list reads 100 entries
 * at a time without the trace text; the text is read for the execution
 * opened. Nothing is read in the background.
 *
 * The header says whether the environment keeps traces (Off, Exceptions,
 * All) and changes it - the organization's plugintracelogsetting, with your
 * own rights (a System Administrator's), after a question.
 *
 * Based on the plug-in diagnosis queries for SQL 4 CDS shared under the MIT
 * licence (Latest exceptions, Latest traces, Trace search, Debug, Async jobs,
 * Noisy plugins) - the same questions, answered without SQL 4 CDS.
 */
(function () {
  if (DynaBoost.off) return;
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M4 5.5h9M4 10h6M4 14.5h5" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="M16 9.5v-1a2 2 0 0 1 4 0v1" stroke="#E3B04B" stroke-width="1.5" stroke-linecap="round"/>' +
    '<rect x="14" y="9.5" width="8" height="9" rx="4" stroke="#E3B04B" stroke-width="1.5"/>' +
    '<path d="M18 12.5v3M12.5 13h1.5M12.5 17h1.7M22 13h.01" stroke="#E3B04B" stroke-width="1.4" stroke-linecap="round"/>' +
    '</svg>';
  const FLOPPY =
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3.5 3.5h10l3 3v10h-13z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
    '<path d="M6.5 3.5v4h6v-4" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
    '<path d="M8.3 10.6c-.7 0-1 .3-1 1v.7c0 .5-.3.8-.7 1 .4.2.7.5.7 1v.7c0 .7.3 1 1 1M11.7 10.6c.7 0 1 .3 1 1v.7c0 .5.3.8.7 1-.4.2-.7.5-.7 1v.7c0 .7-.3 1-1 1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 13 4 4L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const REFRESH = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M15.5 8A6 6 0 1 0 16 11.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M16 4v4h-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const GUID = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;
  const clean = (id) => String(id || '').replace(/[{}]/g, '').toLowerCase();
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
  const odq = (s) => String(s).replace(/'/g, "''");
  const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const WINDOWS = [[15, 'Last 15 min'], [60, 'Last hour'], [240, 'Last 4 hours'], [1440, 'Last 24 hours'], [0, 'All kept']];
  const PAGE = 100; // entries a read; Load more reads the next 100
  const MAX_SCOPE = 300; // steps and types of a solution in one filter
  const SLOW = 2000; // ms - a step slower than this is gold
  const LIST = 'plugintracelogid,createdon,correlationid,requestid,typename,messagename,primaryentity,mode,depth,operationtype,performanceexecutionduration,performanceexecutionstarttime,pluginstepid,exceptiondetails';
  const FULL = LIST + ',messageblock';
  // What the plug-in trace's own text says when a plug-in caught an error and wrote it down.
  const PHRASES = ['inner exception:', 'an error occurred', 'an error occured'];
  const STAGE = { 10: 'Pre-validation', 20: 'Pre-operation', 30: 'Main operation', 40: 'Post-operation', 45: 'Post-operation', 50: 'Post-operation' };
  const LOG = { 0: 'Off', 1: 'Exceptions', 2: 'All' };

  const api = (path, opts) => DynaBoost.webApi(path, opts);
  async function getAll(path, max) {
    let out = [];
    let next = path;
    while (next && out.length < max) {
      const r = await api(next, { prefer: 'odata.include-annotations="*",odata.maxpagesize=' + Math.min(500, max) });
      out = out.concat(r.value || []);
      next = r['@odata.nextLink'] || null;
    }
    return out.slice(0, max);
  }
  const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

  // ---------- an entry, read ----------

  const hasEx = (r) => !!String(r.exceptiondetails || '').trim();
  function traceError(text) {
    const low = String(text || '').toLowerCase();
    for (const p of PHRASES) {
      const at = low.indexOf(p);
      if (at >= 0) return at;
    }
    return -1;
  }
  // The exception in one sentence: its Message line, else the fault's <Message>, else its first line.
  function why(r) {
    if (hasEx(r)) {
      const t = String(r.exceptiondetails);
      const m = t.match(/^\s*Message:\s*(.+)$/m) || t.match(/<Message>([^<]+)<\/Message>/);
      const line = m ? m[1] : t.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !/^unhandled exception:?$/i.test(l)) || t;
      // "System.ServiceModel.FaultException`1[...OrganizationServiceFault]: the message" - the message.
      const typed = line.match(/^\s*[\w.`]*(?:Exception|Fault)[\w`]*(?:\[[^\]]*\])*\]?\s*:\s*(.+)$/);
      return (typed ? typed[1] : line).trim().slice(0, 400);
    }
    const at = traceError(r.messageblock);
    if (at < 0) return '';
    const t = String(r.messageblock);
    const start = t.lastIndexOf('\n', at) + 1;
    const end = t.indexOf('\n', at);
    return t.slice(start, end < 0 ? undefined : end).trim().slice(0, 400);
  }
  const errorKind = (r) => (hasEx(r) ? 'exception' : r.messageblock != null && traceError(r.messageblock) >= 0 ? 'trace' : '');
  const shortType = (t) => String(t || '').split(',')[0].split('.').pop() || '(unknown)';
  const modeText = (r) => (r.mode === 1 ? 'Async' : 'Sync');
  const ms = (n) => (n == null ? '' : n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + ' s' : n + ' ms');
  const startOf = (r) => new Date(r.performanceexecutionstarttime || r.createdon);
  const pad = (n) => String(n).padStart(2, '0');
  function when(d) {
    const today = new Date();
    const t = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    return d.toDateString() === today.toDateString() ? t : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + t;
  }
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  const byRun = (a, b) => startOf(a) - startOf(b) || new Date(a.createdon) - new Date(b.createdon) || (a.depth || 0) - (b.depth || 0);

  /* Entries of one CorrelationId as one execution: what started it (the
   * first entry at the lowest depth), whether anything failed and why, the
   * slowest step. */
  function execution(id, rows) {
    rows = rows.slice().sort(byRun);
    const top = rows.reduce((a, r) => ((r.depth || 1) < (a.depth || 1) ? r : a), rows[0]);
    const bad = rows.find((r) => errorKind(r));
    const slowest = rows.reduce((m, r) => Math.max(m, r.performanceexecutionduration || 0), 0);
    const types = Array.from(new Set(rows.map((r) => shortType(r.typename))));
    return {
      id: id,
      rows: rows,
      start: startOf(rows[0]),
      last: rows.reduce((m, r) => Math.max(m, new Date(r.createdon).getTime()), 0),
      message: top.messagename || '',
      table: top.primaryentity || '',
      mode: modeText(top),
      error: bad ? errorKind(bad) : '',
      why: bad ? why(bad) : '',
      plugin: bad ? bad.typename : top.typename,
      slowest: slowest,
      types: types
    };
  }
  function executions(rows) {
    const map = new Map();
    for (const r of rows) {
      const k = clean(r.correlationid) || clean(r.plugintracelogid);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    return Array.from(map, ([k, list]) => execution(k, list)).sort((a, b) => b.last - a.last);
  }

  // ---------- filters: one list, written as OData and as FetchXML ----------

  /* A filter is a list of conditions, all to hold:
   *   { op: 'ge' | 'eq' | 'like', a, v }, { op: 'in', a, vs },
   *   { op: 'notnull', a }, { op: 'or', c: [conditions] } */
  function conditions(f, scope) {
    const out = [];
    const text = String(f.text || '').trim();
    const id = GUID.test(text) ? clean(text) : '';
    // A GUID is one execution (or one request, one step): the window does not apply.
    if (f.minutes && !id) out.push({ op: 'ge', a: 'createdon', v: new Date(Date.now() - f.minutes * 60000).toISOString().replace(/\.\d+Z$/, 'Z') });
    if (f.table) out.push({ op: 'eq', a: 'primaryentity', v: f.table });
    if (f.type) out.push({ op: 'eq', a: 'typename', v: f.type });
    if (scope && scope.c) out.push(scope.c);
    if (f.errors) out.push({ op: 'or', c: [{ op: 'notnull', a: 'exceptiondetails' }].concat(PHRASES.map((p) => ({ op: 'like', a: 'messageblock', v: p }))) });
    if (id) out.push({ op: 'or', c: ['correlationid', 'requestid', 'pluginstepid', 'plugintracelogid'].map((a) => ({ op: 'eq', a: a, v: id, guid: true })) });
    else if (text) out.push({ op: 'or', c: ['messageblock', 'exceptiondetails', 'typename'].map((a) => ({ op: 'like', a: a, v: text })) });
    return out;
  }
  function odata(list) {
    const one = (c) => {
      if (c.op === 'ge') return c.a + ' ge ' + c.v;
      if (c.op === 'eq') return c.a + ' eq ' + (c.guid ? c.v : "'" + odq(c.v) + "'");
      if (c.op === 'like') return 'contains(' + c.a + ",'" + odq(c.v) + "')";
      if (c.op === 'notnull') return c.a + ' ne null';
      if (c.op === 'in') return 'Microsoft.Dynamics.CRM.In(PropertyName=\'' + c.a + "',PropertyValues=[" + c.vs.map((v) => "'" + odq(v) + "'").join(',') + '])';
      if (c.op === 'or') return '(' + c.c.map(one).join(' or ') + ')';
      return '';
    };
    return list.map(one).join(' and ');
  }
  // In a LIKE, % _ and [ are wildcards: each is put in brackets to mean itself.
  const likeText = (s) => String(s).replace(/[%_[]/g, (c) => '[' + c + ']');
  function fetchFilter(list, type) {
    const one = (c) => {
      if (c.op === 'or') return fetchFilter(c.c, 'or');
      if (c.op === 'notnull') return '<condition attribute="' + c.a + '" operator="not-null"/>';
      if (c.op === 'like') return '<condition attribute="' + c.a + '" operator="like" value="%' + xml(likeText(c.v)) + '%"/>';
      if (c.op === 'in') return '<condition attribute="' + c.a + '" operator="in">' + c.vs.map((v) => '<value>' + xml(v) + '</value>').join('') + '</condition>';
      return '<condition attribute="' + c.a + '" operator="' + c.op + '" value="' + xml(c.v) + '"/>';
    };
    return list.length ? '<filter type="' + (type || 'and') + '">' + list.map(one).join('') + '</filter>' : '';
  }

  // ---------- reads ----------

  async function readList(f, scope) {
    const filter = odata(conditions(f, scope));
    return api('plugintracelogs?$select=' + (f.errors ? FULL : LIST) + (filter ? '&$filter=' + encodeURIComponent(filter) : '') + '&$orderby=createdon desc', {
      prefer: 'odata.include-annotations="*",odata.maxpagesize=' + PAGE
    });
  }

  // Every entry of these executions, with the trace text.
  async function readFull(ids) {
    const out = new Map(ids.map((id) => [id, []]));
    for (const part of chunks(ids, 20)) {
      const filter = part.length === 1 ? 'correlationid eq ' + part[0] : odata([{ op: 'in', a: 'correlationid', vs: part }]);
      const rows = await getAll('plugintracelogs?$select=' + FULL + '&$filter=' + encodeURIComponent(filter) + '&$orderby=createdon asc', 2000);
      for (const r of rows) {
        const k = clean(r.correlationid);
        if (out.has(k)) out.get(k).push(r);
      }
    }
    return out;
  }

  async function readSteps(ids) {
    const out = new Map();
    for (const part of chunks(ids.filter(Boolean), 40)) {
      const filter = odata([{ op: 'in', a: 'sdkmessageprocessingstepid', vs: part }]);
      try {
        const rows = await getAll('sdkmessageprocessingsteps?$select=sdkmessageprocessingstepid,name,stage&$filter=' + encodeURIComponent(filter), 200);
        for (const s of rows) out.set(clean(s.sdkmessageprocessingstepid), s);
      } catch (e) {
        /* the steps are a nicety - the names stay the classes' */
      }
    }
    return out;
  }

  async function readJobs(id) {
    try {
      const r = await api(
        'asyncoperations?$select=asyncoperationid,name,operationtype,statecode,statuscode,retrycount,startedon,completedon,errorcode,friendlymessage,message&$filter=correlationid eq ' + id + '&$orderby=createdon desc&$top=20'
      );
      return r.value || [];
    } catch (e) {
      return [];
    }
  }

  async function readLogging() {
    try {
      const r = await api('organizations?$select=organizationid,plugintracelogsetting');
      const o = (r.value || [])[0];
      return o ? { id: clean(o.organizationid), level: o.plugintracelogsetting } : null;
    } catch (e) {
      return null;
    }
  }

  async function readSolutions() {
    const r = await getAll('solutions?$select=solutionid,friendlyname,uniquename,ismanaged&$filter=isvisible eq true&$orderby=friendlyname asc', 2000);
    return r
      .filter((s) => s.uniquename !== 'Default' && s.uniquename !== 'Active' && s.uniquename !== 'Basic')
      .map((s) => ({ id: clean(s.solutionid), name: s.friendlyname || s.uniquename, unique: s.uniquename, managed: !!s.ismanaged }));
  }

  /* A solution as a filter: its plug-in steps (component 92), and the types
   * of its plug-in assemblies (91) - a solution may hold either. */
  async function solutionScope(id) {
    const comps = await getAll('solutioncomponents?$select=objectid,componenttype&$filter=_solutionid_value eq ' + id + ' and (componenttype eq 91 or componenttype eq 92)', 5000);
    const steps = comps.filter((c) => c.componenttype === 92).map((c) => clean(c.objectid));
    const assemblies = comps.filter((c) => c.componenttype === 91).map((c) => clean(c.objectid));
    let types = [];
    for (const part of chunks(assemblies, 20)) {
      const rows = await getAll('plugintypes?$select=typename&$filter=' + encodeURIComponent(odata([{ op: 'in', a: 'pluginassemblyid', vs: part }])), 2000);
      types = types.concat(rows.map((t) => t.typename).filter(Boolean));
    }
    types = Array.from(new Set(types));
    if (!steps.length && !types.length) return { empty: true, steps: 0, types: 0 };
    const capped = steps.length + types.length > MAX_SCOPE;
    const s = steps.slice(0, MAX_SCOPE);
    const t = types.slice(0, Math.max(0, MAX_SCOPE - s.length));
    const or = [];
    if (s.length) or.push({ op: 'in', a: 'pluginstepid', vs: s });
    if (t.length) or.push({ op: 'in', a: 'typename', vs: t });
    return { c: or.length === 1 ? or[0] : { op: 'or', c: or }, steps: steps.length, types: types.length, capped: capped };
  }

  /* The tables and plug-ins to pick from: every one with a trace in the
   * window (counted by Dataverse, not only the entries read so far), and
   * every table and plug-in with a step registered - with nothing in this
   * time, (0). */
  async function readFacets(f, scope) {
    const list = conditions({ minutes: f.minutes }, scope);
    const agg = (attr) =>
      api('plugintracelogs?fetchXml=' + encodeURIComponent('<fetch aggregate="true"><entity name="plugintracelog"><attribute name="' + attr + '" groupby="true" alias="k"/><attribute name="plugintracelogid" aggregate="count" alias="n"/>' + fetchFilter(list) + '</entity></fetch>'))
        .then((r) => new Map((r.value || []).filter((x) => x.k && x.k !== 'none').map((x) => [x.k, x.n || 0])), () => null);
    const steps = scope
      ? Promise.resolve(null)
      : getAll('sdkmessageprocessingsteps?$select=sdkmessageprocessingstepid&$filter=customizationlevel eq 1&$expand=sdkmessagefilterid($select=primaryobjecttypecode),plugintypeid($select=typename)', 5000).then(
          (rows) => ({
            tbl: new Set(rows.map((r) => r.sdkmessagefilterid && r.sdkmessagefilterid.primaryobjecttypecode).filter((t) => t && t !== 'none')),
            type: new Set(rows.map((r) => r.plugintypeid && r.plugintypeid.typename).filter(Boolean))
          }),
          () => null
        );
    const [tbl, type, reg] = await Promise.all([agg('primaryentity'), agg('typename'), steps]);
    return { tbl: tbl, type: type, regTbl: reg ? reg.tbl : new Set(), regType: reg ? reg.type : new Set() };
  }

  /* By plugin: runs, average and slowest per class, message, table and mode,
   * counted by Dataverse; then the errors the same way. */
  async function readByPlugin(f, scope) {
    const list = conditions(Object.assign({}, f, { errors: false }), scope);
    const head =
      '<fetch aggregate="true"><entity name="plugintracelog">' +
      '<attribute name="typename" groupby="true" alias="t"/><attribute name="messagename" groupby="true" alias="m"/>' +
      '<attribute name="primaryentity" groupby="true" alias="e"/><attribute name="mode" groupby="true" alias="mo"/>' +
      '<attribute name="plugintracelogid" aggregate="count" alias="n"/>';
    const all = head + '<attribute name="performanceexecutionduration" aggregate="avg" alias="avg"/><attribute name="performanceexecutionduration" aggregate="max" alias="max"/>' + fetchFilter(list) + '</entity></fetch>';
    const errs = head + fetchFilter(conditions(Object.assign({}, f, { errors: true }), scope)) + '</entity></fetch>';
    const [a, b] = await Promise.all([api('plugintracelogs?fetchXml=' + encodeURIComponent(all)), api('plugintracelogs?fetchXml=' + encodeURIComponent(errs))]);
    const key = (r) => [r.t, r.m, r.e, r.mo].join('|');
    const errors = new Map((b.value || []).map((r) => [key(r), r.n]));
    return (a.value || [])
      .map((r) => ({ type: r.t || '', message: r.m || '', table: r.e || '', mode: r.mo === 1 ? 'Async' : 'Sync', runs: r.n || 0, errors: errors.get(key(r)) || 0, avg: Math.round(Number(r.avg) || 0), max: Number(r.max) || 0 }))
      .sort((x, y) => y.errors - x.errors || y.runs - x.runs || x.type.localeCompare(y.type));
  }

  // ---------- the tab ----------

  const CSS =
    '[hidden]{display:none!important}' +
    'html,body{min-height:100%}' +
    'body{margin:0;font:14px/1.45 "Segoe UI",system-ui,sans-serif;color:var(--dbc-fg-10224e);background:var(--dbc-bg-f5f7fc)}' +
    'code{font:12.5px ui-monospace,Consolas,monospace;color:var(--dbc-fg-56637f)}' +
    'header{padding:16px 22px 0;background:var(--dbc-bg-fff);border-bottom:2px solid var(--dbc-bd-e3b04b);position:relative}' +
    'h1{margin:0;font-size:20px;font-weight:600}' +
    '.crumbs{margin-top:3px;font-size:13px;color:var(--dbc-fg-56637f);display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px}' +
    '.bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px;padding-bottom:10px}' +
    '.flt{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-bottom:12px}' +
    'button{padding:7px 13px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);font:inherit;cursor:pointer;transition:background-color .15s,border-color .15s,color .15s}' +
    'button:hover{border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-1e6bff)}' +
    'button:disabled{opacity:.5;cursor:default}' +
    'button.primary{background:var(--dbc-bg-1e6bff);border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-fff);font-weight:600}' +
    'button.primary:hover{background:var(--dbc-bg-155ee0);color:var(--dbc-fg-fff)}' +
    'button.icon{width:36px;height:36px;padding:0;display:inline-flex;align-items:center;justify-content:center}button.icon svg{width:19px;height:19px}' +
    'button svg{width:14px;height:14px;vertical-align:-2px;margin-right:6px}button.icon svg{margin:0}' +
    'button.db-ok,button.db-ok:hover{border-color:var(--dbc-bd-1c6b32);color:var(--dbc-fg-1c6b32);background:var(--dbc-bg-e4f4e8)}' +
    'button.db-bad,button.db-bad:hover{border-color:var(--dbc-bd-a11a1a);color:var(--dbc-fg-a11a1a);background:var(--dbc-bg-fde8e8)}' +
    '.seg{display:inline-flex;box-sizing:border-box;height:36px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;overflow:hidden;background:var(--dbc-bg-fff)}' +
    '.seg button{height:34px;border:0;border-radius:0;padding:0 14px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e)}' +
    '.seg button+button{border-left:1px solid var(--dbc-bd-dde3f0)}' +
    '.seg button:hover{background:var(--dbc-bg-f5f7fc);color:var(--dbc-fg-1e6bff)}' +
    '.seg button[aria-pressed="true"]{background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-1e6bff);box-shadow:inset 0 -2px 0 var(--dbc-bd-1e6bff)}' +
    '.bar>button,.flt>button,.flt select,.flt input[type=search]{box-sizing:border-box;height:34px}.bar>button,.flt>button{padding-top:0;padding-bottom:0}' +
    '.flt select,.crumbs select{padding:0 9px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;font:inherit;font-size:13.5px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);max-width:240px}' +
    '.crumbs select{height:26px;font-size:12.5px;padding:0 6px}' +
    '.flt select:hover,.crumbs select:hover{border-color:var(--dbc-bd-1e6bff)}' +
    // The table and plug-in pickers: a button as the selects look, a card with a search under it.
    '.pick{position:relative;display:inline-flex}' +
    '.pick-b{box-sizing:border-box;height:34px;max-width:280px;padding:0 30px 0 11px;font-size:13.5px;text-align:left;position:relative;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.pick-b span{display:block;overflow:hidden;text-overflow:ellipsis}' +
    '.pick-b::after{content:"";position:absolute;right:12px;top:50%;width:6px;height:6px;margin-top:-5px;border:solid var(--dbc-bd-56637f);border-width:0 1.6px 1.6px 0;transform:rotate(45deg)}' +
    '.pick-b.on{border-color:var(--dbc-bd-1e6bff);background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-1e6bff)}' +
    '.pick-pop{position:fixed;z-index:40;width:360px;max-width:calc(100vw - 40px);padding:8px;background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:10px;box-shadow:0 12px 32px rgba(10,23,56,.18)}' +
    '.pick-pop input{box-sizing:border-box;width:100%;height:32px;padding:0 10px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);font:inherit;font-size:13px}' +
    '.pick-pop .pl{max-height:340px;overflow:auto;margin-top:6px}' +
    '.pick-pop .pg{padding:8px 8px 4px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dbc-fg-8a94ad)}' +
    '.pick-pop .po{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 8px;border-radius:6px;font-size:13px;cursor:pointer}' +
    '.pick-pop .po:hover,.pick-pop .po.act{background:var(--dbc-bg-f5f7fc)}' +
    '.pick-pop .po.cur{background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-1e6bff);font-weight:600}' +
    '.pick-pop .pn{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.pick-pop .pn code{margin-left:6px;font-size:11.5px;color:var(--dbc-fg-8a94ad);font-weight:400}' +
    '.pick-pop .pc{flex:none;padding:0 7px;border-radius:9px;background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f);font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}' +
    '.pick-pop .pc.zero{background:transparent;color:var(--dbc-fg-97a5c6)}' +
    '.pick-pop .pe{padding:10px 8px;color:var(--dbc-fg-56637f);font-size:13px}' +
    '.flt select.on{border-color:var(--dbc-bd-1e6bff);background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-1e6bff)}' +
    '.flt input[type=search]{flex:1 1 220px;min-width:200px;padding:0 11px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;font:inherit;font-size:13.5px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e)}' +
    'select:focus,input:focus{outline:none;border-color:var(--dbc-bd-1e6bff)}' +
    '.chk{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 11px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;background:var(--dbc-bg-fff);font-size:13.5px;cursor:pointer;user-select:none}' +
    '.chk:hover{border-color:var(--dbc-bd-1e6bff)}.chk.on{border-color:var(--dbc-bd-a11a1a);background:var(--dbc-bg-fde8e8);color:var(--dbc-fg-a11a1a)}' +
    'input[type=checkbox]{width:14px;height:14px;margin:0;accent-color:var(--dbc-bd-1e6bff);cursor:pointer}' +
    '.pill{display:inline-flex;align-items:center;gap:5px;padding:1px 9px;border-radius:10px;font-size:12px;font-weight:600;background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f)}' +
    '.pill.ok{background:var(--dbc-bg-e4f4e8);color:var(--dbc-fg-1c6b32)}.pill.warn{background:var(--dbc-bg-fdf1d6);color:var(--dbc-fg-7a5410)}.pill.bad{background:var(--dbc-bg-fde8e8);color:var(--dbc-fg-a11a1a)}' +
    'main{padding:14px 22px 40px}' +
    '.wait{display:flex;align-items:center;gap:14px;padding:18px 4px;color:var(--dbc-fg-56637f)}' +
    '.pv{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;margin:0 0 12px;padding:8px 14px;border:1px solid var(--dbc-bd-b9cdf5);border-radius:8px;background:var(--dbc-bg-eef4ff);color:var(--dbc-fg-10224e);font-size:13px;max-width:1100px}' +
    '.pv b{color:var(--dbc-fg-1e6bff);font-size:11px;letter-spacing:.08em}.pv a{color:var(--dbc-fg-1e6bff);font-weight:600;text-decoration:none}.pv a:hover{text-decoration:underline}' +
    '.note{margin:0 0 12px;padding:10px 14px;border-radius:8px;background:var(--dbc-bg-fdf1d6);color:var(--dbc-fg-7a5410);font-size:13px;max-width:1100px}' +
    '.note b{color:var(--dbc-fg-7a5410)}.note.err{background:var(--dbc-bg-fde8e8);color:var(--dbc-fg-a11a1a)}.note.err b{color:var(--dbc-fg-a11a1a)}' +
    '.note button{margin-left:8px;padding:3px 10px;font-size:12.5px}' +
    '.sum{display:flex;flex-wrap:wrap;gap:4px 18px;margin:0 0 10px;font-size:13px;color:var(--dbc-fg-56637f)}' +
    '.sum b{color:var(--dbc-fg-10224e);font-variant-numeric:tabular-nums}.sum .bad b{color:var(--dbc-fg-a11a1a)}' +
    '#v-exec,#v-plug,#v-json{display:none}body.view-exec #v-exec,body.view-plug #v-plug,body.view-json #v-json{display:block}' +
    '.panes{display:grid;grid-template-columns:minmax(330px,5fr) minmax(0,7fr);gap:14px;align-items:start}' +
    '@media (max-width:900px){.panes{grid-template-columns:1fr}}' +
    '.list{background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px;overflow:hidden}' +
    '.ex{display:grid;grid-template-columns:22px 64px minmax(0,1fr) auto;gap:10px;align-items:center;padding:9px 12px;border-top:1px solid var(--dbc-bd-edf1f8);cursor:pointer}' +
    '.ex:first-child{border-top:0}.ex:hover{background:var(--dbc-bg-f5f7fc)}' +
    '.ex.sel{background:var(--dbc-bg-e9f1ff);box-shadow:inset 3px 0 0 var(--dbc-bd-1e6bff)}' +
    '.ex:focus-visible{outline:2px solid var(--dbc-bd-1e6bff);outline-offset:-2px}' +
    '.ex .tm{font-size:12.5px;color:var(--dbc-fg-56637f);font-variant-numeric:tabular-nums}' +
    '.ex .what{min-width:0}' +
    '.ex .what b{display:block;font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.ex .what span{display:block;font-size:12px;color:var(--dbc-fg-56637f);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.ex.bad .what span{color:var(--dbc-fg-a11a1a)}' +
    '.ex .dur{font-size:12px;color:var(--dbc-fg-56637f);font-variant-numeric:tabular-nums;text-align:right}.ex .dur.slow{color:var(--dbc-fg-9a6a12);font-weight:600}' +
    '.more{display:block;width:100%;margin-top:8px}' +
    '.empty{padding:16px;color:var(--dbc-fg-56637f)}.empty.fail{display:flex;gap:8px;align-items:flex-start;color:var(--dbc-fg-a11a1a)}' +
    '.detail{position:sticky;top:12px;max-height:calc(100vh - 24px);overflow:auto;background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px;padding:14px 16px}' +
    '.detail h2{margin:0;font-size:16px;font-weight:600}' +
    '.meta{margin-top:2px;font-size:12.5px;color:var(--dbc-fg-56637f)}' +
    '.why{margin:12px 0 0;padding:10px 12px;border-radius:8px;background:var(--dbc-bg-fde8e8);color:var(--dbc-fg-a11a1a)}' +
    '.why b{display:block;margin-bottom:2px}.why .t{color:var(--dbc-fg-10224e);overflow-wrap:anywhere}.why .w{margin-top:4px;font-size:12.5px;color:var(--dbc-fg-56637f);overflow-wrap:anywhere}' +
    '.fine{margin:12px 0 0;padding:10px 12px;border-radius:8px;background:var(--dbc-bg-e4f4e8);color:var(--dbc-fg-1c6b32)}' +
    '.acts{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 0}.acts button{padding:5px 11px;font-size:12.5px}' +
    '.lbl{margin:16px 0 6px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dbc-fg-8a94ad)}' +
    '.st{display:grid;grid-template-columns:22px minmax(0,1fr) 140px;gap:8px;align-items:center;padding:6px 8px;border-radius:6px;cursor:pointer}' +
    '.st:hover,.st.open{background:var(--dbc-bg-f5f7fc)}.st:focus-visible{outline:2px solid var(--dbc-bd-1e6bff);outline-offset:-2px}' +
    '.st .nm{min-width:0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.st .nm small{font-size:12px;color:var(--dbc-fg-56637f)}.st .arr{color:var(--dbc-fg-8a94ad)}' +
    '.bars{display:flex;align-items:center;gap:8px}.bars .ms{width:52px;flex:none;text-align:right;font-size:12px;color:var(--dbc-fg-56637f);font-variant-numeric:tabular-nums}' +
    '.bar-t{flex:1;height:8px;border-radius:4px;background:var(--dbc-bg-eef2f9);position:relative;overflow:hidden}' +
    '.bar-t i{position:absolute;left:0;top:0;bottom:0;border-radius:4px;background:var(--dbc-bg-1e6bff)}' +
    '.bar-t i.bad{background:var(--dbc-bg-c42b1c)}.bar-t i.slow{background:var(--dbc-bg-e3b04b)}' +
    '.body{margin:2px 0 10px 30px}' +
    '.body h4{margin:8px 0 4px;font-size:12px;font-weight:600;color:var(--dbc-fg-56637f);display:flex;align-items:center;gap:8px}' +
    '.body h4 button{padding:1px 8px;font-size:11.5px;border-radius:10px;color:var(--dbc-fg-56637f)}' +
    '.body .info{font-size:12.5px;color:var(--dbc-fg-56637f)}' +
    'pre.tx{margin:0;padding:8px 10px;background:var(--dbc-bg-f5f7fc);border:1px solid var(--dbc-bd-dde3f0);border-radius:6px;font:12px/1.45 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word;color:var(--dbc-fg-10224e);max-height:320px;overflow:auto}' +
    'pre.tx .hl{background:var(--dbc-bg-fde8e8);color:var(--dbc-fg-a11a1a);border-radius:3px}' +
    'pre.tx.ex-t{border-color:var(--dbc-bd-f3c1c1)}' +
    '.jobs{margin-top:4px;font-size:13px}' +
    '.job{padding:6px 8px;border-top:1px solid var(--dbc-bd-edf1f8)}.job:first-child{border-top:0}' +
    '.job a{color:var(--dbc-fg-10224e);font-weight:600;text-decoration:none;border-bottom:2px solid var(--dbc-bd-e3b04b)}.job a:hover{color:var(--dbc-fg-1e6bff)}' +
    '.job .w{color:var(--dbc-fg-56637f);font-size:12.5px}.job .bad{color:var(--dbc-fg-a11a1a)}' +
    '.tbl{background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px;overflow-x:auto}' +
    '.tbl table{width:100%;border-collapse:collapse;font-size:13px}' +
    '.tbl th,.tbl td{padding:8px 12px;border-top:1px solid var(--dbc-bd-edf1f8);text-align:left;white-space:nowrap}' +
    '.tbl th{border-top:0;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dbc-fg-8a94ad);background:var(--dbc-bg-f5f7fc)}' +
    '.tbl td.n,.tbl th.n{text-align:right;font-variant-numeric:tabular-nums}' +
    '.tbl td.bad{color:var(--dbc-fg-a11a1a);font-weight:600}.tbl td.slow{color:var(--dbc-fg-9a6a12);font-weight:600}' +
    '.tbl tbody tr{cursor:pointer}.tbl tbody tr:hover{background:var(--dbc-bg-f5f7fc)}' +
    '.tbl td code{color:var(--dbc-fg-56637f)}' +
    '.cap{margin-top:8px;font-size:12.5px;color:var(--dbc-fg-8a94ad)}' +
    '#json{margin:0;padding:14px 18px;background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px;font:12.5px/1.45 ui-monospace,Consolas,monospace;white-space:pre;overflow:auto;color:var(--dbc-fg-10224e)}' +
    '#json .jc{content-visibility:auto;contain-intrinsic-block-size:auto 3625px}' +
    '.status{font-size:12.5px;color:var(--dbc-fg-56637f)}';

  function shell(host) {
    return (
      '<!doctype html><html' + (DynaBoost.isDark() ? ' class="db-dark"' : '') + '><head><meta charset="utf-8"><title>Plugin traces · ' + esc(host.split('.')[0]) + '</title>' +
      '<style>' + CSS + DynaBoost.status.css + DynaBoost.code.css + DynaBoost.tabCss + '</style></head>' +
      '<body class="view-exec"><header>' +
      '<h1>Plugin traces</h1>' +
      '<div class="crumbs"><span>' + esc(host) + '</span><span>·</span><span>Plug-in trace log</span>' +
      '<select id="log" title="What this environment keeps in the plug-in trace log" disabled><option>…</option></select><span id="log-pill"></span></div>' +
      '<div class="bar">' +
      '<button class="primary" id="copy" title="What is shown: the executions or the plug-ins as a table - in the JSON view the JSON">Copy</button>' +
      '<button id="copy-all" title="Every listed execution as JSON, with its traces">Copy all</button>' +
      '<button class="icon" id="dl" title="Download every listed execution as a .json file" aria-label="Download JSON">' + FLOPPY + '</button>' +
      '<span class="seg" role="group" aria-label="View">' +
      '<button data-view="exec" aria-pressed="true">Executions</button>' +
      '<button data-view="plug" aria-pressed="false">By plugin</button>' +
      '<button data-view="json" aria-pressed="false">JSON</button></span>' +
      '<span class="status" id="status"></span></div>' +
      '<div class="flt">' +
      '<select id="win" title="How far back">' + WINDOWS.map((w) => '<option value="' + w[0] + '"' + (w[0] === 60 ? ' selected' : '') + '>' + w[1] + '</option>').join('') + '</select>' +
      '<span class="pick" id="tbl-p"><button type="button" class="pick-b" id="tbl" title="Only the plug-ins of one table" aria-haspopup="listbox"><span>All tables</span></button></span>' +
      '<span class="pick" id="type-p"><button type="button" class="pick-b" id="type" title="Only one plug-in (its class)" aria-haspopup="listbox"><span>All plug-ins</span></button></span>' +
      '<span class="pick" id="sol-p"><button type="button" class="pick-b" id="sol" title="Only the plug-ins of one solution - its steps and the types of its assemblies" aria-haspopup="listbox"><span>All solutions</span></button></span>' +
      '<label class="chk" id="err-l" title="Executions with an exception, or an error written in the trace"><input type="checkbox" id="err"> Only errors</label>' +
      '<input type="search" id="q" placeholder="Text in the trace or the exception – or a CorrelationId" title="/ puts the cursor here; a GUID finds its execution, whatever the time" autocomplete="off">' +
      '<button class="icon" id="refresh" title="Read again - the list, and the tables and plug-ins to pick from" aria-label="Read again">' + REFRESH + '</button>' +
      '</div></header>' +
      // A preview: who it is for, and the way to say what works and what is missing.
      '<main><div class="pv"><b>PREVIEW</b><span>Made at the request of fellow developers, for developers – tell us what works and what is missing:</span>' +
      '<a id="pv-bug" target="_blank" rel="noopener noreferrer">Report a bug</a><span>·</span><a id="pv-idea" target="_blank" rel="noopener noreferrer">Suggest an idea</a></div>' +
      '<div id="note" class="note" hidden></div><div class="sum" id="sum"></div>' +
      '<section id="v-exec"><div class="panes"><div><div class="list" id="list"><div class="wait">' + DynaBoost.status.html('busy') + '<span>Reading the plug-in trace log…</span></div></div>' +
      '<button class="more" id="more" hidden>Load 100 more</button></div><div class="detail" id="detail" hidden></div></div></section>' +
      '<section id="v-plug"><div class="tbl" id="plug"></div><div class="cap">Counted by Dataverse over the window and the filters. A click on a row lists its executions.</div></section>' +
      '<section id="v-json"><pre id="json"></pre></section>' +
      '</main></body></html>'
    );
  }

  function flash(btn, text, ok) {
    if (btn.__dbLabel == null) btn.__dbLabel = btn.innerHTML;
    clearTimeout(btn.__dbTimer);
    btn.innerHTML = (ok ? CHECK : '') + esc(text);
    btn.classList.remove('db-ok', 'db-bad');
    btn.classList.add(ok ? 'db-ok' : 'db-bad');
    btn.__dbTimer = setTimeout(() => {
      btn.innerHTML = btn.__dbLabel;
      btn.classList.remove('db-ok', 'db-bad');
    }, 2200);
  }
  async function copyInto(tab, text) {
    try {
      await tab.navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const ta = tab.document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        tab.document.body.appendChild(ta);
        ta.select();
        const ok = tab.document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e2) {
        return false;
      }
    }
  }
  function download(tab, text, name) {
    const url = tab.URL.createObjectURL(new tab.Blob([text], { type: 'application/json' }));
    const a = tab.document.createElement('a');
    a.href = url;
    a.download = name;
    tab.document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => tab.URL.revokeObjectURL(url), 1000);
  }

  // The trace with the lines that tell of an error marked; in an exception, its message.
  function traceHtml(text, exception) {
    const mark = exception ? /^\s*(Message:|<Message>)/ : /exception|error|fail|fault/i;
    return String(text || '')
      .split(/\r?\n/)
      .map((l) => (mark.test(l) ? '<span class="hl">' + esc(l) + '</span>' : esc(l)))
      .join('\n');
  }

  // A read that failed: the red status icon and the reason, as in our other tabs.
  const failHtml = (text) => '<div class="empty fail">' + DynaBoost.status.html('bad') + '<span>' + esc(text) + '</span></div>';
  const failedText = (e) =>
    e && e.status === 403
      ? 'Your security role cannot read the plug-in trace log (it needs Read on Plug-in Trace Log - a System Administrator or System Customizer has it).'
      : 'The plug-in trace log could not be read: ' + ((e && e.message) || e);

  /* Builds the tab in a window already written with shell(): reads, draws,
   * and answers every click. o: { host, table } - the table the page was on. */
  function run(tab, o) {
    const doc = tab.document;
    const $ = (id) => doc.getElementById(id);
    const S = {
      f: { minutes: 60, table: o.table || '', type: '', sol: '', errors: false, text: '' },
      scope: null,
      rows: [],
      next: null,
      list: [],
      sel: '',
      open: new Map(), // execution id -> { rows, steps, jobs }
      openStep: -1,
      plug: null,
      plugKey: '',
      log: null,
      view: 'exec',
      counted: false,
      read: 0
    };

    const note = (html, err) => {
      const n = $('note');
      n.className = 'note' + (err ? ' err' : '');
      n.innerHTML = html;
      n.hidden = !html;
    };
    const status = (t) => ($('status').textContent = t || '');
    // A solution's steps and plug-in types, read once a pick; a pick changed meanwhile keeps its own.
    const scopes = new Map();
    async function ensureScope() {
      const sol = S.f.sol;
      if (!sol || S.scope) return;
      if (!scopes.has(sol))
        scopes.set(
          sol,
          solutionScope(sol).catch((e) => {
            scopes.delete(sol);
            throw e;
          })
        );
      const sc = await scopes.get(sol);
      if (S.f.sol === sol) S.scope = sc;
    }
    // The tab runs on the script of the page it was opened from: once that page is closed or reloaded, it says so instead of going quiet.
    const gone = () => {
      if (tab.closed) return;
      doc.querySelectorAll('button, input, select, textarea').forEach((x) => {
        x.disabled = true;
      });
      note(DynaBoost.status.html('bad') + ' The Dynamics 365 page this tab was opened from was closed or reloaded - this tab no longer reads. Open Plugin traces again.', true);
    };
    window.addEventListener('pagehide', gone);
    tab.addEventListener('pagehide', () => window.removeEventListener('pagehide', gone));

    // ---- logging ----
    function drawLog() {
      const sel = $('log');
      const pill = $('log-pill');
      if (!S.log) {
        sel.hidden = true;
        pill.innerHTML = '<span class="pill">unknown</span>';
        return;
      }
      sel.hidden = false;
      sel.disabled = false;
      sel.innerHTML = [0, 1, 2].map((v) => '<option value="' + v + '"' + (v === S.log.level ? ' selected' : '') + '>' + LOG[v] + '</option>').join('');
      const l = S.log.level;
      pill.innerHTML =
        l === 2 ? '<span class="pill ok">every run is kept</span>' : l === 1 ? '<span class="pill warn">only runs that failed are kept</span>' : '<span class="pill bad">nothing is kept</span>';
    }
    $('log').onchange = async (e) => {
      const v = Number(e.target.value);
      const before = S.log.level;
      const text =
        v === 0
          ? 'Turn the plug-in trace log off for the whole environment? Plug-ins stop writing traces - for everyone.'
          : v === 2
            ? 'Keep every plug-in run in the trace log - for the whole environment? It costs storage and a little time on every save; Dataverse deletes traces after 24 hours by default. Set it back when you are done.'
            : 'Keep only the plug-in runs that failed - for the whole environment?';
      if (!tab.confirm(text)) {
        e.target.value = String(before);
        return;
      }
      e.target.disabled = true;
      try {
        await api('organizations(' + S.log.id + ')', { method: 'PATCH', body: { plugintracelogsetting: v } });
        S.log.level = v;
        note('');
        drawLog();
      } catch (err) {
        e.target.value = String(before);
        e.target.disabled = false;
        note(err && err.status === 403 ? '<b>Not changed.</b> Only a System Administrator can change the plug-in trace log setting.' : '<b>Not changed:</b> ' + esc((err && err.message) || err), true);
      }
    };

    // ---- the filters ----
    const selects = { tbl: new Set(), type: new Set() };
    let facets = null; // readFacets(): counts in the window, and what has steps registered
    /* A table's display name, for the table picker: the tables read once, the
     * first time it opens (EntityDefinitions, the names only). */
    let tableNames = null;
    function readTableNames() {
      if (!tableNames)
        tableNames = getAll('EntityDefinitions?$select=LogicalName,DisplayName', 5000).then(
          (rows) => new Map(rows.map((r) => [r.LogicalName, (r.DisplayName && r.DisplayName.UserLocalizedLabel && r.DisplayName.UserLocalizedLabel.Label) || ''])),
          () => new Map()
        );
      return tableNames;
    }
    /* The table and plug-in pickers, in DynaBoost's look: a search at the top
     * (display or logical name - the class or its short name for a plug-in),
     * the ones with traces in the time by how many, then those with steps
     * registered and nothing in that time. ↑ ↓ Enter, Esc closes. */
    const pickers = {};
    function picker(id, all, onPick) {
      const box = $(id + '-p');
      const btn = $(id);
      const title0 = btn.title;
      const P = { groups: [], current: '', label: all, names: new Map(), total: '' };
      let pop = null;
      let active = -1;
      const fold = (t) => String(t || '').toLowerCase();
      function shown() {
        const q = pop ? fold(pop.querySelector('input').value.trim()) : '';
        const hit = (it) => !q || fold(it.v).indexOf(q) >= 0 || fold(it.name).indexOf(q) >= 0 || fold(it.sub).indexOf(q) >= 0 || fold(P.names.get(it.v)).indexOf(q) >= 0;
        return P.groups.map((g) => ({ title: g.title, items: g.items.filter(hit) })).filter((g) => g.items.length);
      }
      function draw() {
        if (!pop) return;
        const groups = shown();
        const rows = [{ v: '', name: P.label }].concat(...groups.map((g) => g.items));
        active = Math.min(Math.max(active, 0), rows.length - 1);
        let i = 0;
        const row = (it) => {
          const k = i++;
          const label = it.v ? P.names.get(it.v) || it.name : it.name;
          const sub = it.sub != null ? it.sub : it.v;
          return (
            '<div class="po' + (it.v === P.current ? ' cur' : '') + (k === active ? ' act' : '') + '" role="option" data-k="' + k + '" data-v="' + esc(it.v) + '">' +
            '<span class="pn">' + esc(label) + (sub && label !== sub ? ' <code>' + esc(sub) + '</code>' : '') + '</span>' +
            (it.n == null ? '' : '<span class="pc' + (it.n ? '' : ' zero') + '">' + it.n + '</span>') + '</div>'
          );
        };
        pop.querySelector('.pl').innerHTML =
          row(rows[0]) + groups.map((g) => (g.title ? '<div class="pg">' + esc(g.title) + '</div>' : '') + g.items.map(row).join('')).join('') +
          (rows.length === 1 && pop.querySelector('input').value.trim() ? '<div class="pe">Nothing matches.</div>' : '');
        pop.__rows = rows;
        const a = pop.querySelector('.po.act');
        if (a) a.scrollIntoView({ block: 'nearest' });
      }
      function close() {
        if (!pop) return;
        pop.remove();
        pop = null;
        btn.setAttribute('aria-expanded', 'false');
        doc.removeEventListener('mousedown', outside, true);
      }
      const outside = (e) => {
        if (!box.contains(e.target) && !(pop && pop.contains(e.target))) close();
      };
      function choose(v) {
        close();
        if (v === P.current) return;
        onPick(v);
      }
      function open() {
        if (pop) return close();
        Object.values(pickers).forEach((p) => p.close());
        pop = doc.createElement('div');
        pop.className = 'pick-pop';
        pop.setAttribute('role', 'listbox');
        pop.innerHTML = '<input type="search" placeholder="' + (id === 'type' ? 'Class or its short name' : id === 'sol' ? 'Display or unique name' : 'Display or logical name') + '" autocomplete="off" spellcheck="false"><div class="pl"></div>';
        // Over the page, under the button - the header clips what hangs out of it.
        const r = btn.getBoundingClientRect();
        pop.style.left = Math.max(8, Math.min(r.left, tab.innerWidth - 372)) + 'px';
        pop.style.top = r.bottom + 4 + 'px';
        doc.body.appendChild(pop);
        btn.setAttribute('aria-expanded', 'true');
        const input = pop.querySelector('input');
        active = 0;
        draw();
        input.focus();
        input.oninput = () => {
          active = 0;
          draw();
        };
        input.onkeydown = (e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            active += e.key === 'ArrowDown' ? 1 : -1;
            draw();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const r = pop.__rows[active];
            if (r) choose(r.v);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
            btn.focus();
          }
        };
        pop.querySelector('.pl').addEventListener('mousedown', (e) => {
          const o = e.target.closest('.po');
          if (!o) return;
          e.preventDefault();
          choose(o.dataset.v);
        });
        doc.addEventListener('mousedown', outside, true);
        if (id === 'tbl')
          readTableNames().then((names) => {
            P.names = names;
            draw();
            set(P);
          });
      }
      function set(model) {
        Object.assign(P, model);
        const label = P.current ? (P.names.get(P.current) || P.currentName || P.current) + (P.currentN == null ? '' : ' (' + P.currentN + ')') : P.label + P.total;
        btn.firstChild.textContent = label;
        btn.title = P.current ? P.currentSub || P.current : title0;
        btn.classList.toggle('on', !!P.current);
        draw();
      }
      btn.onclick = open;
      return (pickers[id] = { set: set, close: close });
    }
    function fillSelect(id, values, label, current) {
      const counts = facets && (id === 'type' ? facets.type : facets.tbl);
      const reg = facets ? (id === 'type' ? facets.regType : facets.regTbl) : new Set();
      // With traces in the window: by how many, then by name; the ones read but not counted with them.
      const traced = new Map(counts || []);
      for (const v of values) if (v && !traced.has(v)) traced.set(v, counts ? traced.get(v) : null);
      if (current && !traced.has(current) && !reg.has(current)) traced.set(current, counts ? 0 : null);
      const first = Array.from(traced).sort((a, b) => (b[1] || 0) - (a[1] || 0) || a[0].localeCompare(b[0]));
      const quiet = Array.from(reg).filter((v) => !traced.has(v)).sort((a, b) => a.localeCompare(b));
      const win = (WINDOWS.find((w) => w[0] === S.f.minutes) || WINDOWS[1])[1].toLowerCase();
      const item = (v, n) => ({ v: v, name: id === 'type' ? shortType(v) : v, n: n });
      const cur = current ? first.find((x) => x[0] === current) : null;
      pickers[id].set({
        current: current || '',
        currentName: current ? (id === 'type' ? shortType(current) : current) : '',
        currentN: cur ? cur[1] : current && reg.has(current) ? 0 : null,
        total: facets ? ' (' + traced.size + (quiet.length ? ' + ' + quiet.length : '') + ')' : '',
        groups: [
          { title: quiet.length ? 'With traces – ' + win : '', items: first.map((x) => item(x[0], x[1])) },
          { title: 'With plug-in steps, nothing in this time', items: quiet.map((v) => item(v, 0)) }
        ]
      });
    }
    picker('tbl', 'All tables', (v) => {
      S.f.table = v;
      fillSelect('tbl', selects.tbl, 'All tables', S.f.table);
      refilter();
    });
    picker('type', 'All plug-ins', (v) => {
      S.f.type = v;
      fillSelect('type', selects.type, 'All plug-ins', S.f.type);
      refilter();
    });
    let facetsFor = '';
    async function loadFacets(force) {
      const key = S.f.minutes + '|' + S.f.sol;
      if (!force && key === facetsFor) return;
      facetsFor = key;
      try {
        await ensureScope();
        const got = S.scope && S.scope.empty ? { tbl: new Map(), type: new Map(), regTbl: new Set(), regType: new Set() } : await readFacets(S.f, S.scope);
        if (facetsFor !== key || tab.closed) return;
        facets = got;
      } catch (e) {
        facets = null;
      }
      fillSelect('tbl', selects.tbl, 'All tables', S.f.table);
      fillSelect('type', selects.type, 'All plug-ins', S.f.type);
    }
    function learn(rows) {
      let grew = false;
      for (const r of rows) {
        if (r.primaryentity && r.primaryentity !== 'none' && !selects.tbl.has(r.primaryentity)) grew = selects.tbl.add(r.primaryentity);
        if (r.typename && !selects.type.has(r.typename)) grew = selects.type.add(r.typename);
      }
      if (grew) {
        fillSelect('tbl', selects.tbl, 'All tables', S.f.table);
        fillSelect('type', selects.type, 'All plug-ins', S.f.type);
      }
    }
    fillSelect('tbl', selects.tbl, 'All tables', S.f.table);

    let solutions = [];
    const solName = () => (solutions.find((x) => x.id === S.f.sol) || {}).name || '';
    function fillSolutions() {
      const item = (x) => ({ v: x.id, name: x.name, sub: x.unique });
      pickers.sol.set({
        current: S.f.sol,
        currentName: solName(),
        currentSub: (solutions.find((x) => x.id === S.f.sol) || {}).unique || '',
        total: solutions.length ? ' (' + solutions.length + ')' : '',
        groups: [
          { title: 'Unmanaged', items: solutions.filter((x) => !x.managed).map(item) },
          { title: 'Managed', items: solutions.filter((x) => x.managed).map(item) }
        ]
      });
    }
    picker('sol', 'All solutions', (v) => {
      S.f.sol = v;
      S.scope = null;
      fillSolutions();
      refilter();
      loadFacets();
    });
    async function loadSolutions() {
      try {
        solutions = await readSolutions();
        fillSolutions();
      } catch (e) {
        $('sol').title = 'The solutions could not be read: ' + ((e && e.message) || e);
        $('sol').disabled = true;
      }
    }

    const filtersText = () =>
      [
        S.f.minutes ? WINDOWS.find((w) => w[0] === S.f.minutes)[1].toLowerCase() : 'all that is kept',
        S.f.table ? 'table ' + S.f.table : '',
        S.f.type ? 'plug-in ' + S.f.type : '',
        S.f.sol ? 'solution ' + solName() : '',
        S.f.errors ? 'only errors' : '',
        S.f.text ? 'text "' + S.f.text + '"' : ''
      ]
        .filter(Boolean)
        .join(' · ');

    // ---- the list ----
    async function load(more) {
      const mine = ++S.read;
      if (!more) {
        S.rows = [];
        S.next = null;
        $('list').innerHTML = '<div class="wait">' + DynaBoost.status.html('busy') + '<span>Reading the plug-in trace log…</span></div>';
        $('more').hidden = true;
        $('sum').innerHTML = '';
        S.plug = null;
        if (S.view === 'plug') loadPlug();
        if (S.view === 'json') $('json').innerHTML = '<span class="status">Reading the traces…</span>';
      } else {
        $('more').disabled = true;
        $('more').textContent = 'Reading…';
      }
      try {
        await ensureScope();
        if (mine !== S.read) return;
        if (S.scope && S.scope.empty) {
          drawList();
          if (S.view === 'json') showJson();
          return;
        }
        const r = more ? await api(S.next, { prefer: 'odata.include-annotations="*",odata.maxpagesize=' + PAGE }) : await readList(S.f, S.scope);
        if (mine !== S.read || tab.closed) return;
        S.rows = S.rows.concat(r.value || []);
        S.next = r['@odata.nextLink'] || null;
        learn(r.value || []);
        drawList();
        if (S.view === 'json') showJson();
        if (!S.counted) {
          S.counted = true;
          DynaBoost.saved('plugin-traces');
        }
      } catch (e) {
        if (mine !== S.read || tab.closed) return;
        $('list').innerHTML = failHtml(failedText(e));
        if (S.view === 'json') $('json').innerHTML = failHtml(failedText(e));
        $('more').hidden = true;
      } finally {
        $('more').disabled = false;
        $('more').textContent = 'Load ' + PAGE + ' more';
      }
    }

    const rowHtml = (x) =>
      '<div class="ex' + (x.error ? ' bad' : '') + (x.id === S.sel ? ' sel' : '') + '" tabindex="0" data-x="' + esc(x.id) + '">' +
      DynaBoost.status.html(x.error ? 'bad' : 'ok') +
      '<span class="tm" title="' + esc(iso(x.start)) + '">' + esc(when(x.start)) + '</span>' +
      '<span class="what"><b>' + esc(x.message || '(no message)') + (x.table && x.table !== 'none' ? ' · ' + esc(x.table) : '') + '</b>' +
      '<span>' + (x.why ? esc(x.why) : esc(plural(x.rows.length, 'step') + ' · ' + x.types.slice(0, 3).join(', ') + (x.types.length > 3 ? '…' : '') + ' · ' + x.mode)) + '</span></span>' +
      '<span class="dur' + (x.slowest > SLOW ? ' slow' : '') + '" title="The slowest step">' + esc(ms(x.slowest)) + '</span></div>';

    function drawSum() {
      const bad = S.list.filter((x) => x.error).length;
      const slow = S.list.reduce((m, x) => Math.max(m, x.slowest), 0);
      $('sum').innerHTML = S.list.length
        ? '<span><b>' + S.list.length + '</b> execution' + (S.list.length === 1 ? '' : 's') + (S.next ? ' (so far)' : '') + '</span>' +
          '<span class="bad"><b>' + bad + '</b> with an error</span>' +
          '<span>slowest step <b>' + ms(slow) + '</b></span><span>' + esc(filtersText()) + '</span>'
        : '';
    }
    function drawList() {
      S.loaded = true;
      S.list = executions(S.rows).map((x) => {
        // An execution opened since: what its whole trace says.
        const d = S.open.get(x.id);
        return d && d.rows && d.rows.length ? execution(x.id, d.rows) : x;
      });
      drawSum();
      const scopeNote =
        S.scope && S.scope.empty
          ? '<b>This solution has no plug-in steps or assemblies</b> - pick another, or All solutions.'
          : S.scope && S.scope.capped
            ? 'This solution has ' + plural(S.scope.steps, 'step') + ' and ' + plural(S.scope.types, 'plug-in type') + ': only the first ' + MAX_SCOPE + ' are looked for.'
            : '';
      const off =
        S.log && S.log.level === 0
          ? '<b>The plug-in trace log is off</b> in this environment: plug-ins write no traces now. Set it to Exceptions or All above (a System Administrator can), then try what failed again.'
          : '';
      note(scopeNote || (off && !S.list.length ? off : ''));
      $('more').hidden = !S.next;
      if (!S.list.length) {
        $('list').innerHTML =
          '<div class="empty">' +
          (S.scope && S.scope.empty
            ? 'Nothing to look for.'
            : 'No plug-in trace found: ' + esc(filtersText()) + '.' +
              (S.log && S.log.level === 1 && !S.f.errors ? ' Only runs that failed are kept here.' : '') +
              (S.f.minutes && S.f.minutes < 1440 ? ' Try a longer time.' : '')) +
          '</div>';
        $('detail').hidden = true;
        return;
      }
      $('list').innerHTML = S.list.map(rowHtml).join('');
      if (!S.list.some((x) => x.id === S.sel)) pick((S.list.find((x) => x.error) || S.list[0]).id);
      else drawDetail();
    }

    // ---- one execution ----
    async function pick(id) {
      S.sel = id;
      S.openStep = -1;
      S.stepClicked = false;
      doc.querySelectorAll('.ex').forEach((el) => el.classList.toggle('sel', el.dataset.x === id));
      drawDetail();
      if (S.open.has(id)) return;
      try {
        const read = (await readFull([id])).get(id) || [];
        const listed = S.list.find((x) => x.id === id);
        const full = read.length ? read : listed ? listed.rows.slice() : [];
        if (!full.length) throw new Error('This execution is no longer in the plug-in trace log.');
        const [steps, jobs] = await Promise.all([readSteps(Array.from(new Set(full.map((r) => clean(r.pluginstepid))))), readJobs(id)]);
        S.open.set(id, { rows: full.sort(byRun), steps: steps, jobs: jobs });
        // The whole trace may tell of an error the list did not read: the row says so too.
        const at = S.list.findIndex((x) => x.id === id);
        if (at >= 0 && full.length) {
          const ex = execution(id, full);
          if (ex.error !== S.list[at].error) {
            S.list[at] = ex;
            const el = doc.querySelector('.ex[data-x="' + id + '"]');
            if (el) el.outerHTML = rowHtml(ex);
            drawSum();
          }
        }
      } catch (e) {
        S.open.set(id, { failed: failedText(e) });
      }
      if (S.sel !== id || tab.closed) return;
      // Nothing clicked meanwhile: the failing step, now that its trace is read, opens.
      if (!S.stepClicked) S.openStep = -1;
      drawDetail();
    }

    function stepName(r, d) {
      const s = d && d.steps && d.steps.get(clean(r.pluginstepid));
      return s && s.name ? s.name : '';
    }

    function drawDetail() {
      const pane = $('detail');
      const x = S.list.find((e) => e.id === S.sel);
      if (!x) {
        pane.hidden = true;
        return;
      }
      pane.hidden = false;
      const d = S.open.get(x.id);
      const ex = d && d.rows && d.rows.length ? execution(x.id, d.rows) : x;
      const rows = ex.rows;
      const max = rows.reduce((m, r) => Math.max(m, r.performanceexecutionduration || 0), 1);
      const bad = rows.find((r) => errorKind(r));
      if (S.openStep === -1) S.openStep = bad ? rows.indexOf(bad) : -2;
      const head =
        '<h2>' + esc(ex.message || '(no message)') + (ex.table && ex.table !== 'none' ? ' · ' + esc(ex.table) : '') + '</h2>' +
        '<div class="meta">' + esc(iso(ex.start)) + ' · ' + plural(rows.length, 'step') + ' · ' + esc(ex.mode) + ' · CorrelationId <code>' + esc(x.id) + '</code></div>';
      const verdict = ex.error
        ? '<div class="why"><b>' + (ex.error === 'trace' ? 'An error written in the trace' : 'Why it failed') + '</b><div class="t">' + esc(ex.why || 'The exception has no message.') + '</div>' +
          '<div class="w">' + esc(bad ? bad.typename : ex.plugin) + (ex.error === 'trace' ? ' · the plug-in caught it, so the save may not have shown an error' : '') + '</div></div>'
        : d && d.rows
          ? '<div class="fine">Finished without an error' + (ex.slowest > SLOW ? ' – but a step took ' + esc(ms(ex.slowest)) : '') + '.</div>'
          : '';
      const acts =
        '<div class="acts"><button class="primary" data-act="ticket" title="When, the table, the plug-in, the error, every step and the traces - as Markdown, for a ticket or a developer">Copy for ticket</button>' +
        '<button data-act="corr">Copy CorrelationId</button>' +
        '<button data-act="only" title="Find this execution only, whatever the time">Only this execution</button></div>';
      let body;
      if (!d) body = '<div class="wait">' + DynaBoost.status.html('busy') + '<span>Reading its traces…</span></div>';
      else if (d.failed) body = '<div class="note err">' + DynaBoost.status.html('bad') + ' ' + esc(d.failed) + '</div>';
      else {
        body =
          '<div class="lbl">What ran, in order</div>' +
          rows
            .map((r, k) => {
              const kind = errorKind(r);
              const dur = r.performanceexecutionduration || 0;
              const name = stepName(r, d);
              const stage = d.steps.get(clean(r.pluginstepid));
              const open = k === S.openStep;
              return (
                '<div class="st' + (open ? ' open' : '') + '" tabindex="0" data-k="' + k + '" style="padding-left:' + (8 + Math.max(0, (r.depth || 1) - 1) * 18) + 'px">' +
                DynaBoost.status.html(kind ? 'bad' : 'ok') +
                '<span class="nm" title="' + esc(r.typename + (name ? ' – ' + name : '')) + '">' + ((r.depth || 1) > 1 ? '<span class="arr">↳ </span>' : '') + esc(shortType(r.typename)) +
                ' <small>· ' + esc([r.messagename, r.primaryentity && r.primaryentity !== 'none' ? r.primaryentity : '', stage ? STAGE[stage.stage] || 'stage ' + stage.stage : '', modeText(r), (r.depth || 1) > 1 ? 'depth ' + r.depth : '', r.operationtype === 2 ? 'workflow activity' : ''].filter(Boolean).join(' · ')) + '</small></span>' +
                '<span class="bars"><span class="bar-t"><i class="' + (kind ? 'bad' : dur > SLOW ? 'slow' : '') + '" style="width:' + Math.max(3, (dur / max) * 100).toFixed(1) + '%"></i></span><span class="ms">' + esc(ms(dur)) + '</span></span>' +
                '</div>' +
                (open
                  ? '<div class="body">' +
                    '<div class="info">' + esc(r.typename) + (name ? ' · step <b>' + esc(name) + '</b>' : '') + ' · started ' + esc(iso(startOf(r))) + '</div>' +
                    (hasEx(r) ? '<h4>Exception <button data-copy="ex" data-k="' + k + '">Copy</button></h4><pre class="tx ex-t">' + traceHtml(r.exceptiondetails, true) + '</pre>' : '') +
                    '<h4>Trace <button data-copy="tr" data-k="' + k + '">Copy</button></h4>' +
                    (String(r.messageblock || '').trim() ? '<pre class="tx">' + traceHtml(r.messageblock) + '</pre>' : '<div class="info">The plug-in wrote nothing to the trace.</div>') +
                    '</div>'
                  : '')
              );
            })
            .join('') +
          (d.jobs.length
            ? '<div class="lbl">System jobs with the same CorrelationId</div><div class="jobs">' +
              d.jobs
                .map(
                  (j) =>
                    '<div class="job"><a href="https://' + esc(o.host) + '/main.aspx?pagetype=entityrecord&etn=asyncoperation&id=' + esc(j.asyncoperationid) + '" target="_blank" rel="noopener">' + esc(j.name || 'System job') + '</a> ' +
                    '<span class="w">· ' + esc(j['statuscode@OData.Community.Display.V1.FormattedValue'] || j.statuscode) + (j.retrycount ? ' · ' + plural(j.retrycount, 'retry', 'retries') : '') + (j.completedon ? ' · ' + esc(iso(new Date(j.completedon))) : '') + '</span>' +
                    (j.friendlymessage || j.message ? '<div class="w bad">' + esc(String(j.friendlymessage || j.message).slice(0, 400)) + '</div>' : '') + '</div>'
                )
                .join('') +
              '</div>'
            : '');
      }
      pane.innerHTML = head + verdict + acts + body;
    }

    // ---- by plugin ----
    async function loadPlug() {
      const key = JSON.stringify([S.f, S.scope && S.scope.c]);
      if (S.plug && S.plugKey === key) return drawPlug();
      S.plugKey = key;
      S.plug = null;
      $('plug').innerHTML = '<div class="wait">' + DynaBoost.status.html('busy') + '<span>Counting…</span></div>';
      try {
        await ensureScope();
        const list = S.scope && S.scope.empty ? [] : await readByPlugin(S.f, S.scope);
        if (S.plugKey !== key || tab.closed) return;
        S.plug = list;
        learn(list.map((p) => ({ primaryentity: p.table, typename: p.type })));
        drawPlug();
      } catch (e) {
        if (S.plugKey !== key) return;
        $('plug').innerHTML = failHtml(/aggregate|50000|limit/i.test((e && e.message) || '') ? 'Too many traces in this window to count them - pick a shorter time or a table.' : failedText(e));
      }
    }
    function drawPlug() {
      if (!S.plug) return;
      if (!S.plug.length) {
        $('plug').innerHTML = '<div class="empty">No plug-in trace found: ' + esc(filtersText()) + '.</div>';
        return;
      }
      $('plug').innerHTML =
        '<table><thead><tr><th>Plug-in</th><th>Message</th><th>Table</th><th>Mode</th><th class="n">Runs</th><th class="n">Errors</th><th class="n">Average</th><th class="n">Slowest</th></tr></thead><tbody>' +
        S.plug
          .map(
            (p, i) =>
              '<tr data-p="' + i + '"><td title="' + esc(p.type) + '"><b>' + esc(shortType(p.type)) + '</b> <code>' + esc(p.type) + '</code></td><td>' + esc(p.message) + '</td><td>' + esc(p.table === 'none' ? '' : p.table) + '</td><td>' + p.mode + '</td>' +
              '<td class="n">' + p.runs + '</td><td class="n' + (p.errors ? ' bad' : '') + '">' + p.errors + '</td><td class="n' + (p.avg > SLOW ? ' slow' : '') + '">' + ms(p.avg) + '</td><td class="n' + (p.max > SLOW ? ' slow' : '') + '">' + ms(p.max) + '</td></tr>'
          )
          .join('') +
        '</tbody></table>';
    }

    // ---- JSON ----
    const DESCRIPTION =
      'Plugin traces (DynaBoost). Each execution is one CorrelationId - one save or message - with the plug-in steps it ran, in order: ' +
      'the class, message, table, mode, depth (2 = run by another plug-in), how long it took, its exception and its trace. ' +
      '"error" is "exception" when the step threw one, "trace" when its own trace says an error occurred.';
    function jsonOf(full) {
      return {
        _: DESCRIPTION,
        environment: o.host,
        read: iso(new Date()),
        filters: filtersText(),
        logging: S.log ? LOG[S.log.level] : 'unknown',
        executions: S.list.map((x) => {
          const d = [full.get(x.id), (S.open.get(x.id) || {}).rows].find((r) => r && r.length) || x.rows;
          const ex = execution(x.id, d);
          const steps = (S.open.get(x.id) || {}).steps;
          return {
            correlationId: x.id,
            start: iso(ex.start),
            message: ex.message,
            table: ex.table === 'none' ? '' : ex.table,
            mode: ex.mode,
            error: ex.error || null,
            why: ex.why || null,
            slowestMs: ex.slowest,
            steps: ex.rows.map((r) => {
              const s = steps && steps.get(clean(r.pluginstepid));
              return {
                plugin: r.typename,
                step: s ? s.name : undefined,
                stage: s ? STAGE[s.stage] || s.stage : undefined,
                message: r.messagename,
                table: r.primaryentity === 'none' ? '' : r.primaryentity,
                mode: modeText(r),
                depth: r.depth,
                start: iso(startOf(r)),
                durationMs: r.performanceexecutionduration,
                error: errorKind(r) || null,
                exception: hasEx(r) ? r.exceptiondetails : undefined,
                trace: r.messageblock != null ? r.messageblock : undefined,
                stepId: clean(r.pluginstepid) || undefined,
                requestId: clean(r.requestid) || undefined
              };
            })
          };
        })
      };
    }
    // Every listed execution with its traces - read once, when asked for.
    let full = new Map();
    async function withTraces() {
      const ids = S.list.map((x) => x.id);
      const want = ids.filter((id) => !(full.get(id) || []).length && !((S.open.get(id) || {}).rows || []).length);
      if (want.length) {
        status('Reading the traces of ' + plural(want.length, 'execution') + '…');
        const got = await readFull(want);
        got.forEach((v, k) => full.set(k, v));
        status('');
      }
      return jsonOf(full);
    }
    const jsonText = (j) => JSON.stringify(j, null, 2);
    function jsonHtml(text) {
      const lines = DynaBoost.code.html(text, 'json').split('\n');
      const out = [];
      for (let i = 0; i < lines.length; i += 200) out.push('<div class="jc">' + lines.slice(i, i + 200).join('\n') + '</div>');
      return out.join('');
    }
    async function showJson() {
      const pre = $('json');
      const mine = (S.jsonRead = (S.jsonRead || 0) + 1);
      pre.innerHTML = '<span class="status">Reading the traces…</span>';
      try {
        const text = jsonText(await withTraces());
        if (S.view === 'json' && mine === S.jsonRead) {
          pre.innerHTML = jsonHtml(text);
          status((text.length / 1024).toFixed(0) + ' KB of JSON');
        }
      } catch (e) {
        if (mine === S.jsonRead) pre.innerHTML = failHtml(failedText(e));
      }
    }

    // ---- views, copy ----
    function setView(v) {
      S.view = v;
      doc.body.className = 'view-' + v;
      doc.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
      status('');
      if (v === 'plug') loadPlug();
      if (v === 'json') showJson();
    }

    const md = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    function listMarkdown() {
      return [
        '# Plugin traces - ' + o.host,
        '',
        plural(S.list.length, 'execution') + ' · ' + filtersText() + ' · read ' + iso(new Date()),
        '',
        '| When | Message | Table | Plug-ins | Result | Slowest | CorrelationId |',
        '| --- | --- | --- | --- | --- | --- | --- |'
      ]
        .concat(S.list.map((x) => '| ' + iso(x.start) + ' | ' + md(x.message) + ' | ' + md(x.table === 'none' ? '' : x.table) + ' | ' + md(x.types.join(', ')) + ' | ' + md(x.error ? 'Error: ' + x.why : 'OK') + ' | ' + ms(x.slowest) + ' | ' + x.id + ' |'))
        .join('\n');
    }
    function plugMarkdown() {
      return ['# Plugin traces by plug-in - ' + o.host, '', filtersText(), '', '| Plug-in | Message | Table | Mode | Runs | Errors | Average | Slowest |', '| --- | --- | --- | --- | --- | --- | --- | --- |']
        .concat((S.plug || []).map((p) => '| ' + md(p.type) + ' | ' + md(p.message) + ' | ' + md(p.table === 'none' ? '' : p.table) + ' | ' + p.mode + ' | ' + p.runs + ' | ' + p.errors + ' | ' + ms(p.avg) + ' | ' + ms(p.max) + ' |'))
        .join('\n');
    }
    function ticket(x, d) {
      const ex = execution(x.id, d.rows || x.rows);
      const steps = d.steps || new Map();
      const out = [
        '## Plug-in ' + (ex.error ? 'error' : 'run') + ' - ' + (ex.message || '?') + (ex.table && ex.table !== 'none' ? ' of ' + ex.table : '') + ' (' + iso(ex.start) + ')',
        '',
        '- Environment: ' + o.host,
        ex.error ? '- Error: ' + (ex.why || '(no message)') : '- Result: no error',
        ex.error ? '- Plug-in: ' + ex.plugin : '',
        '- CorrelationId: ' + x.id,
        '',
        '| # | Plug-in | Step | Stage | Mode | Depth | Time | Result |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |'
      ].filter((l, i) => l || i === 1 || i === 6);
      ex.rows.forEach((r, k) => {
        const s = steps.get(clean(r.pluginstepid));
        out.push('| ' + (k + 1) + ' | ' + md(r.typename) + ' | ' + md(s ? s.name : '') + ' | ' + md(s ? STAGE[s.stage] || s.stage : '') + ' | ' + modeText(r) + ' | ' + (r.depth || 1) + ' | ' + ms(r.performanceexecutionduration) + ' | ' + (errorKind(r) ? 'Error' : 'OK') + ' |');
      });
      ex.rows.forEach((r, k) => {
        if (!hasEx(r) && !String(r.messageblock || '').trim()) return;
        out.push('', '### ' + (k + 1) + '. ' + shortType(r.typename));
        if (hasEx(r)) out.push('', 'Exception:', '```', String(r.exceptiondetails).trim(), '```');
        if (String(r.messageblock || '').trim()) out.push('', 'Trace:', '```', String(r.messageblock).trim(), '```');
      });
      return out.join('\n');
    }

    async function copyView(btn) {
      let text;
      if (S.view === 'json') {
        try {
          text = jsonText(await withTraces());
        } catch (e) {
          return flash(btn, 'Not read', false);
        }
      }
      else if (S.view === 'plug') text = S.plug && S.plug.length ? plugMarkdown() : '';
      else text = S.list.length ? listMarkdown() : '';
      if (!text) return flash(btn, 'Nothing to copy', false);
      const ok = await copyInto(tab, text);
      flash(btn, ok ? 'Copied' : 'Copy failed', ok);
    }
    $('copy').onclick = (e) => copyView(e.currentTarget);
    $('copy-all').onclick = async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const ok = await copyInto(tab, jsonText(await withTraces()));
        btn.disabled = false;
        flash(btn, ok ? 'Copied' : 'Copy failed', ok);
      } catch (err) {
        btn.disabled = false;
        flash(btn, 'Not read', false);
      }
    };
    $('dl').onclick = async (e) => {
      const btn = e.currentTarget;
      try {
        download(tab, jsonText(await withTraces()), 'plugin-traces-' + o.host.split('.')[0] + '-' + iso(new Date()).replace(/[: ]/g, '-') + '.json');
      } catch (err) {
        flash(btn, '!', false);
      }
    };

    // ---- clicks and keys ----
    doc.addEventListener('click', async (e) => {
      const view = e.target.closest('[data-view]');
      if (view) return setView(view.dataset.view);
      const row = e.target.closest('.ex');
      if (row) return pick(row.dataset.x);
      const copy = e.target.closest('[data-copy]');
      if (copy) {
        const d = S.open.get(S.sel);
        const r = d && d.rows && d.rows[Number(copy.dataset.k)];
        if (!r) return;
        const ok = await copyInto(tab, String(copy.dataset.copy === 'ex' ? r.exceptiondetails : r.messageblock || ''));
        return flash(copy, ok ? 'Copied' : 'Copy failed', ok);
      }
      const st = e.target.closest('.st');
      if (st) {
        const k = Number(st.dataset.k);
        S.openStep = S.openStep === k ? -2 : k;
        S.stepClicked = true;
        return drawDetail();
      }
      const act = e.target.closest('[data-act]');
      if (act) {
        const x = S.list.find((v) => v.id === S.sel);
        if (!x) return;
        if (act.dataset.act === 'corr') {
          const ok = await copyInto(tab, x.id);
          return flash(act, ok ? 'Copied' : 'Copy failed', ok);
        }
        if (act.dataset.act === 'only') {
          $('q').value = x.id;
          S.f.text = x.id;
          return load(false);
        }
        if (act.dataset.act === 'ticket') {
          const d = S.open.get(x.id) || {};
          const ok = await copyInto(tab, ticket(x, d));
          return flash(act, ok ? 'Copied' : 'Copy failed', ok);
        }
      }
      const tr = e.target.closest('tr[data-p]');
      if (tr && S.plug) {
        const p = S.plug[Number(tr.dataset.p)];
        S.f.type = p.type;
        S.f.table = p.table === 'none' ? '' : p.table;
        fillSelect('type', selects.type, 'All plug-ins', S.f.type);
        fillSelect('tbl', selects.tbl, 'All tables', S.f.table);
        setView('exec');
        return load(false);
      }
    });
    doc.addEventListener('keydown', (e) => {
      if (e.key === '/' && doc.activeElement !== $('q') && !/^(INPUT|SELECT|TEXTAREA)$/.test(doc.activeElement.tagName)) {
        e.preventDefault();
        $('q').focus();
        return;
      }
      const el = doc.activeElement;
      if (e.key === 'Enter' && el && (el.classList.contains('ex') || el.classList.contains('st'))) el.click();
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && el && el.classList.contains('ex')) {
        e.preventDefault();
        const next = e.key === 'ArrowDown' ? el.nextElementSibling : el.previousElementSibling;
        if (next && next.classList.contains('ex')) {
          next.focus();
          next.click();
        }
      }
    });

    const refilter = () => load(false);
    $('win').onchange = (e) => {
      S.f.minutes = Number(e.target.value);
      refilter();
      loadFacets();
    };
    $('err').onchange = (e) => {
      S.f.errors = e.target.checked;
      $('err-l').classList.toggle('on', S.f.errors);
      refilter();
    };
    let typing = 0;
    $('q').oninput = (e) => {
      clearTimeout(typing);
      typing = setTimeout(() => {
        const t = e.target.value.trim();
        if (t === S.f.text) return;
        S.f.text = t;
        refilter();
      }, 450);
    };
    $('q').onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      clearTimeout(typing);
      S.f.text = e.target.value.trim();
      refilter();
    };
    // Read again: the list, the execution open, and the tables and plug-ins to pick from.
    $('refresh').onclick = () => {
      S.open.clear();
      scopes.clear();
      S.scope = null;
      full = new Map();
      S.plug = null;
      refilter();
      loadFacets(true);
    };
    $('more').onclick = () => load(true);

    readLogging().then((l) => {
      S.log = l;
      if (!tab.closed) {
        drawLog();
        if (S.loaded) drawList();
      }
    });
    loadSolutions();
    loadFacets();
    return load(false);
  }

  function open() {
    const host = location.hostname;
    const pg = DynaBoost.page();
    // The tab opens on the click - after an await it would be a pop-up.
    const tab = window.open('', '_blank');
    if (!tab) {
      DynaBoost.toast('Plugin traces', 'The tab was blocked. Allow pop-ups for this site and try again.', true);
      return;
    }
    tab.document.write(shell(host));
    tab.document.close();
    DynaBoost.themeTab(tab);
    // Its bug and idea links name the tool, so the form opens on Plugin traces.
    const about = { section: 'Plugins', tool: 'Plugin traces' };
    const d = tab.document;
    for (const [sel, kind] of [['.db-fb-bug, #pv-bug', 'bug'], ['.db-fb-idea, #pv-idea', 'idea']]) d.querySelectorAll(sel).forEach((a) => (a.href = DynaBoost.feedbackUrl(kind, about)));
    run(tab, { host: host, table: pg.etn || '' }).catch((e) => DynaBoost.tabError(tab, 'Plugin traces', (e && e.message) || String(e), location.href, 'Plugins'));
  }

  DynaBoost.register({
    id: 'plugin-traces',
    name: 'Plugin traces',
    group: 'Plugins',
    hosts: ['dynamics.com'],
    when: () => /\.dynamics\.com$/i.test(location.hostname),
    type: 'action',
    preview: true,
    hint: 'Why a save failed: the plug-in trace log by execution, with the error on top',
    icon: ICON,
    onRun: open
  });
})();
