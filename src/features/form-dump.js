/* Feature: Form as JSON. Opens a tab with the open form: every tab, section
 * and control (hidden ones too) in form order, with the record's saved values,
 * choice options and lookup targets. Views: Form, Fields, Choices, JSON; the
 * Logic strip (form-logic.js) adds Scripts, Business rules and Automations.
 *
 * Sources: the Xrm snapshot from form-dump-hook.js (form, record, runtime
 * visibility), systemforms.formxml, the record from the Web API with
 * formatted values, and EntityDefinitions. Values are the saved ones;
 * unsaved changes are flagged.
 */
(function () {
  if (DynaBoost.off) return;
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="3" y="3" width="18" height="18" rx="2" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M3 8h18M8 8v13" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M12.5 12c-1 0-1.5.5-1.5 1.5v1c0 .8-.4 1.2-1 1.5.6.3 1 .7 1 1.5v1c0 1 .5 1.5 1.5 1.5M16.5 12c1 0 1.5.5 1.5 1.5v1c0 .8.4 1.2 1 1.5-.6.3-1 .7-1 1.5v1c0 1-.5 1.5-1.5 1.5" stroke="#E3B04B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  const API = '/api/data/v9.2/';
  const SRC = 'dynaboost-form-ctx';
  const ANNOTATE = 'odata.include-annotations="*"';
  const FMT = '@OData.Community.Display.V1.FormattedValue';
  const LOOKUP_ENTITY = '@Microsoft.Dynamics.CRM.lookuplogicalname';

  // Controls that are not plain fields. Everything else - including Yes/No
  // checkboxes, whose classid we deliberately do not list - falls through to
  // 'field', and its type comes from the attribute metadata.
  const CONTROL_CLASSID = {
    '{E7A81278-8635-4D9E-8D4D-59480B391C5B}': 'subgrid',
    '{5C5600E0-1D6E-4205-A272-BE80DA87FD42}': 'quickview',
    '{9FDF5F91-88B1-47F4-AD53-C11EFEDF4E4E}': 'webresource',
    '{82407400-B209-4B45-8D9B-1B76E4FE45CE}': 'iframe',
    '{06375649-C143-495E-A496-C962E5B4488E}': 'notes'
  };

  const CHOICE_CASTS = [
    ['Microsoft.Dynamics.CRM.PicklistAttributeMetadata', 'choice'],
    ['Microsoft.Dynamics.CRM.MultiSelectPicklistAttributeMetadata', 'multichoice'],
    ['Microsoft.Dynamics.CRM.StatusAttributeMetadata', 'status'],
    ['Microsoft.Dynamics.CRM.StateAttributeMetadata', 'state'],
    ['Microsoft.Dynamics.CRM.BooleanAttributeMetadata', 'boolean']
  ];

  function clean(g) {
    return String(g || '').replace(/[{}]/g, '').toLowerCase();
  }

  // ---------- page context ----------

  function injectHook() {
    if (document.querySelector('script[data-db-form-hook]')) return;
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('src/features/form-dump-hook.js');
    s.setAttribute('data-db-form-hook', '1');
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  }

  /* Asks the hook for the Xrm snapshot. Resolves null when the page has no
   * Xrm to report (classic pages, a list view) - the URL fallback covers the
   * record then, and the runtime layer is simply absent. */
  function pageContext(timeout) {
    return new Promise((resolve) => {
      const nonce = Math.random().toString(36).slice(2);
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        resolve(v);
      };
      const onMsg = (e) => {
        if (e.source !== window) return;
        const d = e.data;
        if (!d || d.source !== SRC || d.type !== 'response' || d.nonce !== nonce) return;
        finish(d.ctx || null);
      };
      const timer = setTimeout(() => finish(null), timeout);
      window.addEventListener('message', onMsg);
      injectHook();
      const ask = () => window.postMessage({ source: SRC, type: 'request', nonce: nonce }, location.origin);
      ask();
      setTimeout(ask, 150);
      setTimeout(ask, 600);
    });
  }

  function urlContext() {
    const p = new URLSearchParams(location.search);
    const etn = p.get('etn');
    if (!etn) return null;
    return {
      entity: etn,
      id: clean(p.get('id')),
      recordName: null,
      formId: clean(p.get('formid')),
      formName: null,
      clientUrl: location.origin,
      lcid: null,
      envId: null,
      unsaved: false,
      tabs: {},
      sections: {},
      controls: {},
      attributes: {}
    };
  }

  // ---------- Web API ----------

  async function getJson(path, prefer) {
    const headers = { Accept: 'application/json', 'OData-Version': '4.0' };
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(API + path, { credentials: 'same-origin', headers: headers });
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = (body.error && body.error.message) || '';
      } catch (e) {
        /* no JSON body */
      }
      throw new Error('HTTP ' + res.status + (detail ? ': ' + detail : '') + '\n' + path);
    }
    return res.json();
  }

  function label(dn, lcid) {
    if (!dn) return null;
    const list = dn.LocalizedLabels || [];
    const hit = list.find((x) => x.LanguageCode === lcid) || (dn.UserLocalizedLabel ? dn.UserLocalizedLabel : list[0]);
    return hit ? hit.Label : null;
  }

  const metaCache = new Map(); // entity -> { def, attr, options }

  async function loadMeta(etn, lcid) {
    if (metaCache.has(etn)) return metaCache.get(etn);
    const base = "EntityDefinitions(LogicalName='" + etn + "')";

    const [def, attrs, lookups] = await Promise.all([
      getJson(base + '?$select=EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute,DisplayName,LogicalName'),
      getJson(base + '/Attributes?$select=LogicalName,SchemaName,AttributeType,AttributeTypeName,DisplayName,RequiredLevel,IsPrimaryId,IsPrimaryName'),
      getJson(base + '/Attributes/Microsoft.Dynamics.CRM.LookupAttributeMetadata?$select=LogicalName,Targets')
    ]);

    const attr = Object.create(null);
    for (const a of attrs.value) attr[a.LogicalName] = a;
    for (const l of lookups.value) if (attr[l.LogicalName]) attr[l.LogicalName].Targets = l.Targets;

    const results = await Promise.allSettled(
      CHOICE_CASTS.map(([cast]) => getJson(base + '/Attributes/' + cast + '?$select=LogicalName&$expand=OptionSet'))
    );

    const options = Object.create(null);
    results.forEach((r, i) => {
      if (r.status !== 'fulfilled') return;
      const kind = CHOICE_CASTS[i][1];
      for (const a of r.value.value) {
        const os = a.OptionSet;
        if (!os) continue;
        let list = [];
        if (kind === 'boolean') {
          list = [os.FalseOption, os.TrueOption].filter(Boolean).map((o) => ({ value: o.Value, label: label(o.Label, lcid) }));
        } else if (os.Options && os.Options.length) {
          list = os.Options.map((o) => {
            const out = { value: o.Value, label: label(o.Label, lcid) };
            if (o.State !== undefined && o.State !== null) out.state = o.State;
            return out;
          });
        }
        if (list.length) options[a.LogicalName] = { kind: kind, options: list };
      }
    });

    const meta = { def: def, attr: attr, options: options };
    metaCache.set(etn, meta);
    return meta;
  }

  const formsCache = new Map();

  /* Every active main form of the entity, ranked by size. isdefault is set on
   * several out-of-the-box forms and Dynamics picks by security role and app
   * order, which are not visible here - so the biggest form is the best guess,
   * and the tab lets you switch. */
  async function loadForms(etn) {
    if (formsCache.has(etn)) return formsCache.get(etn);
    const r = await getJson(
      'systemforms?$select=formid,name,type,formxml,isdefault,formactivationstate' +
        "&$filter=objecttypecode eq '" + etn + "' and type eq 2"
    );
    const forms = (r.value || [])
      .filter((f) => f.formactivationstate !== 0 && f.formxml)
      .map((f) => {
        f.controlCount = (f.formxml.match(/<control\s/g) || []).length;
        return f;
      })
      .sort((a, b) => b.controlCount - a.controlCount || (b.isdefault ? 1 : 0) - (a.isdefault ? 1 : 0));
    if (!forms.length) throw new Error('No active main form found for ' + etn);
    formsCache.set(etn, forms);
    return forms;
  }

  function pickForm(forms, formId) {
    if (formId) {
      const hit = forms.find((f) => clean(f.formid) === clean(formId));
      if (hit) return hit;
    }
    return forms[0];
  }

  // ---------- building the dump ----------

  function xmlLabel(el, lcid) {
    const labels = Array.from(el.querySelectorAll(':scope > labels > label'));
    const hit = labels.find((l) => Number(l.getAttribute('languagecode')) === lcid) || labels[0];
    return hit ? hit.getAttribute('description') : null;
  }

  /* An appid only on links to the entity the page shows: a lookup's target
   * (contact, systemuser...) is often not in the app, and Dynamics then quietly
   * opens something else. */
  function recordUrl(clientUrl, etn, id) {
    const q = new URLSearchParams(location.search);
    const pageEtn = (q.get('etn') || '').toLowerCase();
    const appid = etn && String(etn).toLowerCase() === pageEtn ? q.get('appid') : null;
    return clientUrl + '/main.aspx?' + (appid ? 'appid=' + appid + '&' : '') + 'pagetype=entityrecord&etn=' + etn + '&id=' + clean(id);
  }

  function describeField(field, meta, record, ctx) {
    const m = meta.attr[field] || {};
    const out = {
      field: field,
      schemaName: m.SchemaName || null,
      displayName: label(m.DisplayName, ctx.lcid),
      type: (m.AttributeTypeName && m.AttributeTypeName.Value) || m.AttributeType || null,
      requiredLevel: m.RequiredLevel ? m.RequiredLevel.Value : null
    };
    if (m.Targets) out.targets = m.Targets;

    const lookupKey = '_' + field + '_value';
    // A lookup is a lookup because the metadata says so. Going by the
    // presence of _field_value alone also catches columns like stageid,
    // which is a plain unique identifier the API happens to expand.
    const lookupType = m.AttributeType === 'Lookup' || m.AttributeType === 'Owner' || m.AttributeType === 'Customer' || !!m.Targets;
    const isLookup = !!record && lookupKey in record && lookupType;
    const raw = record ? (isLookup ? record[lookupKey] : record[field]) : undefined;
    const formatted = record ? (record[(isLookup ? lookupKey : field) + FMT] !== undefined ? record[(isLookup ? lookupKey : field) + FMT] : null) : null;

    if (record) {
      out.value = raw === undefined ? null : raw;
      out.formatted = formatted;
      if (raw === undefined && !(field in record) && !isLookup) out.note = 'not in API response (null, or hidden by field security)';
    }

    const os = meta.options[field];
    if (os) {
      const byValue = (v) => os.options.find((o) => o.value === Number(v)) || { value: Number(v), label: formatted };
      let selected = null;
      if (raw !== null && raw !== undefined && raw !== '') {
        if (os.kind === 'multichoice') selected = String(raw).split(',').map((v) => byValue(v.trim()));
        else if (os.kind === 'boolean') selected = byValue(raw === true ? 1 : raw === false ? 0 : raw);
        else selected = byValue(raw);
      }
      out.choice = { kind: os.kind, selected: selected, options: os.options };
    }

    if (isLookup) {
      const id = record[lookupKey];
      const targets = m.Targets || [];
      // The annotation names the entity this particular value points at. For
      // a polymorphic lookup (Customer, Owner, Regarding) it is the only
      // reliable source - Targets lists what the column accepts, not what it
      // holds, so falling back to Targets[0] would send a contact to account.
      const annotated = record[lookupKey + LOOKUP_ENTITY] || null;
      const target = annotated || (targets.length === 1 ? targets[0] : null);
      if (id) {
        out.lookup = { id: id, name: formatted, entity: target, url: target ? recordUrl(ctx.clientUrl, target, id) : null };
        if (!target) out.lookup.note = 'target entity unknown (' + (targets.join(', ') || 'no targets in metadata') + ') - no link built';
      } else {
        out.lookup = null;
      }
    }

    const rt = ctx.attributes && ctx.attributes[field];
    if (rt && rt.unsaved) out.unsavedChanges = true;
    return out;
  }

  // 'hidden' (form says so, runtime agrees), 'hidden by script', 'shown by
  // script', or null when the thing is simply visible.
  function visibility(inXml, atRuntime) {
    if (atRuntime === null || atRuntime === undefined) return inXml ? null : 'hidden';
    if (!inXml && !atRuntime) return 'hidden';
    if (!inXml && atRuntime) return 'shown by script';
    if (inXml && !atRuntime) return 'hidden by script';
    return null;
  }

  function buildDump(ctx, meta, form, record) {
    const lcid = ctx.lcid || 1033;
    const xml = new DOMParser().parseFromString(form.formxml, 'text/xml');
    if (xml.querySelector('parsererror')) throw new Error('The form definition could not be parsed.');

    const onForm = new Set();
    const where = Object.create(null);
    const viewIds = new Set();

    function parseCell(cell, tab, sec) {
      const control = cell.querySelector(':scope > control');
      if (!control) return null; // spacer
      const field = control.getAttribute('datafieldname');
      const classid = (control.getAttribute('classid') || '').toUpperCase();
      // A known classid wins over the column binding: a quick view control
      // carries the datafieldname of the lookup it sits on, and a subgrid can
      // too. Only a control with no known classid is a plain field.
      const kind = CONTROL_CLASSID[classid] || (field ? 'field' : 'other');
      const id = control.getAttribute('id') || field;
      const rt = ctx.controls[id] || (field ? ctx.controls[field] : null);
      const inXml = cell.getAttribute('visible') !== 'false';

      const base = {
        kind: kind,
        id: id,
        label: xmlLabel(cell, lcid),
        visible: inXml,
        visibility: visibility(inXml, rt ? rt.visible : null),
        disabled: control.getAttribute('disabled') === 'true' || (rt && rt.disabled === true) || false
      };
      if (!base.visibility) delete base.visibility;

      if (kind !== 'field' && kind !== 'other') {
        const params = {};
        for (const p of control.querySelectorAll(':scope > parameters > *')) params[p.nodeName] = (p.textContent || '').trim();
        if (kind === 'subgrid') {
          if (params.ViewId) viewIds.add(clean(params.ViewId));
          if (rt && rt.subgrid) base.runtime = rt.subgrid;
        }
        if (field) base.basedOn = field; // quick view: the lookup it follows
        base.parameters = params;
        return base;
      }
      if (!field) {
        base.classid = classid;
        return base;
      }
      onForm.add(field);
      if (!where[field]) where[field] = [];
      where[field].push({ tab: tab.name, tabLabel: tab.label, section: sec.name, sectionLabel: sec.label });
      return Object.assign(base, describeField(field, meta, record, ctx));
    }

    function parseSection(sec, tab) {
      const name = sec.getAttribute('name');
      const inXml = sec.getAttribute('visible') !== 'false';
      const rt = ctx.sections[tab.name + '/' + name];
      const info = { name: name, label: xmlLabel(sec, lcid) || (rt && rt.label) || name };
      const out = {
        name: name,
        label: info.label,
        visible: inXml,
        visibility: visibility(inXml, rt ? rt.visible : null),
        // columns="11" is a layout code: one digit per column, so its length
        // is the column count ("1" = 1, "11" = 2, "111" = 3).
        columns: String(sec.getAttribute('columns') || '1').length,
        controls: Array.from(sec.querySelectorAll(':scope > rows > row > cell'))
          .map((c) => parseCell(c, tab, info))
          .filter(Boolean)
      };
      if (!out.visibility) delete out.visibility;
      return out;
    }

    // Tabs hold columns > sections. The header and footer hold rows directly
    // on older forms and sections on newer ones - accept both.
    function container(el, tab) {
      const sections = Array.from(el.querySelectorAll(':scope > columns > column > sections > section'));
      if (sections.length) return sections.map((s) => parseSection(s, tab)).filter((s) => s.controls.length);
      const cells = Array.from(el.querySelectorAll(':scope > rows > row > cell'));
      const controls = cells.map((c) => parseCell(c, tab, tab)).filter(Boolean);
      if (!controls.length) return [];
      return [{ name: tab.name, label: tab.label, visible: true, columns: 1, controls: controls }];
    }

    const tabs = Array.from(xml.querySelectorAll('form > tabs > tab')).map((t) => {
      const name = t.getAttribute('name');
      const inXml = t.getAttribute('visible') !== 'false';
      const rt = ctx.tabs[name];
      const info = { name: name, label: xmlLabel(t, lcid) || (rt && rt.label) || name };
      const out = {
        name: name,
        label: info.label,
        visible: inXml,
        visibility: visibility(inXml, rt ? rt.visible : null),
        expanded: rt && rt.state ? rt.state === 'expanded' : t.getAttribute('expanded') !== 'false',
        sections: container(t, info)
      };
      if (!out.visibility) delete out.visibility;
      return out;
    });

    const headerEl = xml.querySelector('form > header');
    const footerEl = xml.querySelector('form > footer');

    const dump = {
      generatedAt: new Date().toISOString(),
      environment: ctx.clientUrl,
      entity: {
        logicalName: meta.def.LogicalName,
        displayName: label(meta.def.DisplayName, lcid),
        entitySetName: meta.def.EntitySetName,
        primaryId: meta.def.PrimaryIdAttribute,
        primaryName: meta.def.PrimaryNameAttribute
      },
      record: ctx.id
        ? {
            id: ctx.id,
            name: ctx.recordName || (record && meta.def.PrimaryNameAttribute ? record[meta.def.PrimaryNameAttribute] : null) || null,
            url: recordUrl(ctx.clientUrl, meta.def.LogicalName, ctx.id),
            apiUrl: ctx.clientUrl + API + meta.def.EntitySetName + '(' + ctx.id + ')',
            unsavedChanges: !!ctx.unsaved
          }
        : null,
      form: { id: form.formid, name: form.name, type: form.type },
      header: headerEl ? container(headerEl, { name: 'header', label: 'Header' }) : [],
      tabs: tabs,
      footer: footerEl ? container(footerEl, { name: 'footer', label: 'Footer' }) : [],
      columnsNotOnForm: [],
      choices: {}
    };

    if (record) {
      const seen = new Set();
      dump.columnsNotOnForm = Object.keys(record)
        .filter((k) => k.indexOf('@') < 0)
        .map((k) => (k.startsWith('_') && k.endsWith('_value') ? k.slice(1, -6) : k))
        .filter((f) => !seen.has(f) && seen.add(f) && !onForm.has(f) && meta.attr[f])
        .sort()
        .map((f) => describeField(f, meta, record, ctx));
    }

    // Choices in form order first (onForm is a Set, so it keeps insertion
    // order), then whatever else the entity has, alphabetically.
    const choiceOrder = Array.from(onForm)
      .filter((f) => meta.options[f])
      .concat(Object.keys(meta.options).filter((f) => !onForm.has(f)).sort());
    for (const field of choiceOrder) {
      const d = describeField(field, meta, record, ctx);
      dump.choices[field] = {
        displayName: d.displayName,
        kind: d.choice.kind,
        selected: d.choice.selected,
        onForm: where[field] || null,
        options: d.choice.options
      };
    }

    return { dump: dump, viewIds: viewIds };
  }

  async function resolveViews(dump, viewIds) {
    if (!viewIds.size) return;
    let byId = {};
    try {
      const f = Array.from(viewIds).map((v) => 'savedqueryid eq ' + v).join(' or ');
      const r = await getJson('savedqueries?$select=savedqueryid,name,returnedtypecode&$filter=' + f);
      for (const v of r.value) byId[v.savedqueryid] = { id: v.savedqueryid, name: v.name, entity: v.returnedtypecode };
    } catch (e) {
      return; // no rights to savedqueries - the ViewId stays in parameters
    }
    eachControl(dump, (c) => {
      if (c.kind === 'subgrid' && c.parameters && c.parameters.ViewId) {
        const v = byId[clean(c.parameters.ViewId)];
        if (v) c.view = v;
      }
    });
  }

  function eachControl(dump, fn) {
    const groups = [['header', dump.header], ['tabs', dump.tabs], ['footer', dump.footer]];
    for (const [kind, list] of groups) {
      for (const node of list) {
        const sections = kind === 'tabs' ? node.sections : [node];
        for (const s of sections) for (const c of s.controls) fn(c, s, kind === 'tabs' ? node : null);
      }
    }
  }

  async function collect(ctx) {
    const meta = await loadMeta(ctx.entity, ctx.lcid || 1033);
    const [forms, record] = await Promise.all([
      loadForms(ctx.entity),
      ctx.id ? getJson(meta.def.EntitySetName + '(' + ctx.id + ')', ANNOTATE) : Promise.resolve(null)
    ]);
    const form = pickForm(forms, ctx.formId);
    const { dump, viewIds } = buildDump(ctx, meta, form, record);
    dump.availableForms = forms.map((f) => ({
      id: f.formid,
      name: f.name,
      controls: f.controlCount,
      isDefault: !!f.isdefault,
      current: f.formid === form.formid
    }));
    // The logic starts now and runs alongside the views; the tab does not
    // wait for it (see wire).
    const logic = loadLogic(ctx, meta, dump, form, forms);
    await resolveViews(dump, viewIds);
    return { dump: dump, logic: logic };
  }

  /* Scripts, business rules, automations - a promise, never a rejection: a
   * failure costs the logic views, never the form. What the tab reads later
   * in the background (cloud flows, the ribbon) is started here too, so it
   * is on its way while the form is drawn. */
  function loadLogic(ctx, meta, dump, form, forms) {
    dump.logic = null;
    const FL = DynaBoost.formLogic;
    FL.prefetch(dump.entity.logicalName, dump.entity.entitySetName);
    if (DynaBoost.formCommands) DynaBoost.formCommands.prefetch(dump.entity.logicalName);
    const lcid = ctx.lcid || 1033;
    const fieldLabel = (f) => (meta.attr[f] ? label(meta.attr[f].DisplayName, lcid) : null);
    const webResourceControls = [];
    eachControl(dump, (c, s, t) => {
      const url = c.kind === 'webresource' && c.parameters && c.parameters.Url;
      if (url) webResourceControls.push({ name: url.replace(/^\$webresource:/i, ''), label: c.label || c.id, where: (t ? (t.label || t.name) + ' \u203a ' : '') + (s.label || s.name) });
    });
    return Promise.resolve()
      .then(() => FL.load(ctx, dump, form, forms, webResourceControls, fieldLabel))
      .catch((e) => ({ error: e.message }));
  }

  // ---------- the tab ----------

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function isEmpty(v) {
    return v === null || v === undefined || v === '';
  }

  function valueHtml(c) {
    if (c.lookup !== undefined) {
      if (!c.lookup) return '<span class="nil">empty</span>';
      return (
        (c.lookup.url
          ? '<a class="lk" href="' + esc(c.lookup.url) + '" target="_blank" rel="noopener">' + esc(c.lookup.name || c.lookup.id) + '</a>'
          : '<span class="lk-dead">' + esc(c.lookup.name || c.lookup.id) + '</span>') +
        ' <code class="ent">' + esc(c.lookup.entity || '?') + '</code>' +
        (c.lookup.entity ? '<button type="button" class="mini" data-dump="' + esc(c.lookup.entity) + '|' + esc(c.lookup.id) + '">Open as JSON</button>' : '') +
        '<div class="sub"><code>' + esc(c.lookup.id) + '</code>' + (c.lookup.note ? ' — ' + esc(c.lookup.note) : '') + '</div>'
      );
    }
    if (c.choice) {
      const sel = c.choice.selected;
      let head;
      if (sel === null) head = '<span class="nil">empty</span>';
      else if (Array.isArray(sel)) head = sel.map((s) => esc(s.label) + ' <code class="num">' + esc(s.value) + '</code>').join(', ');
      else head = esc(sel.label) + ' <code class="num">' + esc(sel.value) + '</code>';
      const rows = c.choice.options
        .map((o) => {
          const on = sel && (Array.isArray(sel) ? sel.some((s) => s.value === o.value) : sel.value === o.value);
          return '<tr' + (on ? ' class="on"' : '') + '><td>' + esc(o.label) + '</td><td><code class="num">' + esc(o.value) + '</code></td>' + (o.state !== undefined ? '<td class="st">state ' + esc(o.state) + '</td>' : '') + '</tr>';
        })
        .join('');
      return head + '<button type="button" class="mini" data-opts>' + c.choice.options.length + ' options</button><table class="opts" hidden>' + rows + '</table>';
    }
    if (c.value === undefined) return '<span class="nil">–</span>';
    if (isEmpty(c.value)) return '<span class="nil">empty</span>';
    if (!isEmpty(c.formatted) && String(c.formatted) !== String(c.value)) {
      return esc(c.formatted) + '<div class="sub"><code>' + esc(c.value) + '</code></div>';
    }
    return '<span class="txt">' + esc(c.value) + '</span>';
  }

  function badges(c) {
    const b = [];
    if (c.visibility) b.push('<span class="bd">' + esc(c.visibility) + '</span>');
    if (c.disabled) b.push('<span class="bd">read-only</span>');
    if (c.requiredLevel === 'ApplicationRequired' || c.requiredLevel === 'SystemRequired') b.push('<span class="bd req">required</span>');
    if (c.unsavedChanges) b.push('<span class="bd warn">unsaved</span>');
    return b.join('');
  }

  function typeText(c) {
    if (c.kind === 'field') {
      if (c.type === 'LookupType' && c.targets) return 'Lookup → ' + c.targets.join(', ');
      return String(c.type || '').replace(/Type$/, '');
    }
    return c.kind;
  }

  function otherHtml(c) {
    const p = c.parameters || {};
    if (c.kind === 'subgrid') {
      const view = c.view ? c.view.name : p.ViewId || '';
      return (
        '<div>' + esc(p.TargetEntityType || (c.runtime && c.runtime.entity) || '') + '</div>' +
        '<div class="sub">relationship <code>' + esc(p.RelationshipName || '') + '</code></div>' +
        '<div class="sub">view ' + esc(view) + '</div>'
      );
    }
    const keys = Object.keys(p);
    if (!keys.length) return '<span class="nil">–</span>';
    return keys.map((k) => '<div class="sub"><code>' + esc(k) + '</code> ' + esc(String(p[k]).slice(0, 160)) + '</div>').join('');
  }

  // Per column: OnChange handlers and business rules, set by wire() before
  // the views are drawn.
  let MARKS = Object.create(null);

  function markOf(c) {
    return c.field ? MARKS[c.field] || null : null;
  }

  // Where a column's logic icons go; redrawn in place when cloud flows arrive.
  function markSlot(mk, field, label) {
    return '<span class="lg-slot" data-label="' + esc(label || '') + '">' + DynaBoost.formLogic.markHtml(mk, field, label) + '</span>';
  }

  function rowHtml(c) {
    const mk = markOf(c);
    const search = [c.label, c.field, c.id, c.displayName, c.formatted, c.value, c.kind].filter((x) => x != null).join(' ').toLowerCase();
    const empty = c.kind === 'field' && (c.value === undefined || isEmpty(c.value)) && !c.lookup;
    const hidden = !!c.visibility && c.visibility !== 'shown by script';
    return (
      '<div class="row' + (hidden ? ' hid' : '') + (mk ? ' lg-has' : '') + '"' +
      (c.field ? ' data-field="' + esc(c.field) + '" data-m="' + esc(DynaBoost.formLogic.markSearch(mk)) + '"' : '') +
      ' data-s="' + esc(search) + '"' + (empty ? ' data-empty="1"' : '') + '>' +
      '<div class="lbl">' + esc(c.label || c.displayName || c.id) + badges(c) + (c.field ? markSlot(mk, c.field, c.label || c.displayName) : '') + '<div class="sub"><code>' + esc(c.field || c.id) + '</code></div></div>' +
      '<div class="typ">' + esc(typeText(c)) + '</div>' +
      '<div class="val">' + (c.kind === 'field' ? valueHtml(c) : otherHtml(c)) + '</div>' +
      '</div>'
    );
  }

  function sectionHtml(s, anchor) {
    const hidden = !!s.visibility && s.visibility !== 'shown by script';
    return (
      '<div class="sec' + (hidden ? ' hid' : '') + '" id="' + esc(anchor) + '">' +
      '<h3>' + esc(s.label || s.name) + (s.visibility ? '<span class="bd">' + esc(s.visibility) + '</span>' : '') + '<code>' + esc(s.name) + '</code></h3>' +
      (s.controls.length ? s.controls.map(rowHtml).join('') : '<div class="row"><div class="lbl nil">no controls</div></div>') +
      '</div>'
    );
  }

  function tabHtml(t, i) {
    const hidden = !!t.visibility && t.visibility !== 'shown by script';
    return (
      '<section class="tab' + (hidden ? ' hid' : '') + '" id="t' + i + '">' +
      '<h2>' + esc(t.label || t.name) + (t.visibility ? '<span class="bd">' + esc(t.visibility) + '</span>' : '') + '<code>' + esc(t.name) + '</code></h2>' +
      t.sections.map((s, j) => sectionHtml(s, 't' + i + 's' + j)).join('') +
      '</section>'
    );
  }

  function formViewHtml(dump) {
    const parts = [];
    if (dump.header.length) parts.push('<section class="tab" id="hdr"><h2>Header</h2>' + dump.header.map((s, j) => sectionHtml(s, 'hdrs' + j)).join('') + '</section>');
    parts.push(dump.tabs.map(tabHtml).join(''));
    if (dump.footer.length) parts.push('<section class="tab" id="ftr"><h2>Footer</h2>' + dump.footer.map((s, j) => sectionHtml(s, 'ftrs' + j)).join('') + '</section>');
    return parts.join('');
  }

  function navHtml(dump) {
    const items = [];
    if (dump.header.length) items.push('<a href="#hdr">Header</a>');
    dump.tabs.forEach((t, i) => {
      const n = t.sections.reduce((a, s) => a + s.controls.length, 0);
      items.push('<a href="#t' + i + '"' + (t.visibility ? ' class="hid"' : '') + '>' + esc(t.label || t.name) + '<span class="n">' + n + '</span></a>');
      t.sections.forEach((s, j) => {
        items.push('<a class="s' + (s.visibility ? ' hid' : '') + '" href="#t' + i + 's' + j + '">' + esc(s.label || s.name) + '<span class="n">' + s.controls.length + '</span></a>');
      });
    });
    if (dump.footer.length) items.push('<a href="#ftr">Footer</a>');
    return items.join('');
  }

  /* Form first: every column the form shows, in the order the form shows it,
   * each listed once (a column placed twice - header and body, say - gets
   * both places in the last column). Columns the entity has but the form
   * does not are appended, alphabetically, and stay behind the "whole entity"
   * switch. */
  function fieldsViewHtml(dump) {
    const seen = new Map();
    const all = [];
    eachControl(dump, (c, s, t) => {
      if (c.kind !== 'field') return;
      const place = (t ? t.label || t.name : s.label || s.name) + ' › ' + (s.label || s.name);
      if (seen.has(c.field)) {
        seen.get(c.field).where.push(place);
        return;
      }
      const item = { c: c, where: [place], off: false };
      seen.set(c.field, item);
      all.push(item);
    });
    for (const c of dump.columnsNotOnForm) all.push({ c: c, where: null, off: true });
    return all
      .map(({ c, where, off }) => {
        const mk = markOf(c);
        const search = [c.field, c.displayName, c.formatted, c.value].concat(where || []).filter((x) => x != null).join(' ').toLowerCase();
        const empty = (c.value === undefined || isEmpty(c.value)) && !c.lookup;
        return (
          '<div class="row f' + (mk ? ' lg-has' : '') + '" data-field="' + esc(c.field) + '" data-m="' + esc(DynaBoost.formLogic.markSearch(mk)) + '" data-s="' + esc(search) + '"' +
          (empty ? ' data-empty="1"' : '') + (off ? ' data-off="1"' : '') + '>' +
          '<div class="lbl"><code>' + esc(c.field) + '</code>' + badges(c) + markSlot(mk, c.field, c.displayName) + '<div class="sub">' + esc(c.displayName || '') + '</div></div>' +
          '<div class="typ">' + esc(typeText(c)) + '</div>' +
          '<div class="val">' + valueHtml(c) + '</div>' +
          '<div class="whr">' + (where ? where.map(esc).join('<br>') : '<span class="nil">not on form</span>') + '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function choicesViewHtml(dump) {
    return Object.keys(dump.choices)
      .map((field) => {
        const ch = dump.choices[field];
        const sel = ch.selected;
        const rows = ch.options
          .map((o) => {
            const on = sel && (Array.isArray(sel) ? sel.some((s) => s.value === o.value) : sel.value === o.value);
            return '<tr' + (on ? ' class="on"' : '') + '><td>' + esc(o.label) + '</td><td><code class="num">' + esc(o.value) + '</code></td>' + (o.state !== undefined ? '<td class="st">state ' + esc(o.state) + '</td>' : '') + '</tr>';
          })
          .join('');
        const search = [field, ch.displayName].concat(ch.options.map((o) => o.label + ' ' + o.value)).join(' ').toLowerCase();
        const picked = sel === null ? '<span class="nil">nothing picked</span>' : Array.isArray(sel) ? sel.map((s) => esc(s.label)).join(', ') : esc(sel.label) + ' <code class="num">' + esc(sel.value) + '</code>';
        return (
          '<div class="card" data-s="' + esc(search) + '"' + (ch.onForm ? '' : ' data-off="1"') + '>' +
          '<h3>' + esc(ch.displayName || field) + '<code>' + esc(field) + '</code><span class="kind">' + esc(ch.kind) + '</span></h3>' +
          '<div class="picked">' + picked + (ch.onForm ? '' : ' <span class="bd">not on form</span>') + '</div>' +
          '<table class="opts open">' + rows + '</table>' +
          '</div>'
        );
      })
      .join('');
  }

  function pageHtml(dump) {
    const title = (dump.record && dump.record.name) || dump.entity.displayName || dump.entity.logicalName;
    const fieldCount = Object.keys(dump.choices).length;
    return (
      '<!doctype html><meta charset="utf-8"><title>' + esc(title) + ' — form</title>' +
      '<style>' +
      'html,body{height:100%}' +
      'body{margin:0;display:flex;flex-direction:column;font:14px/1.45 "Segoe UI",system-ui,sans-serif;color:var(--dbc-fg-10224e);background:var(--dbc-bg-f5f7fc)}' +
      'code{font:12.5px ui-monospace,Consolas,monospace;color:var(--dbc-fg-56637f)}' +
      'header{flex:none;padding:16px 22px 0;background:var(--dbc-bg-fff);border-bottom:2px solid var(--dbc-bd-e3b04b);position:relative;overflow:hidden}' +
      'h1{margin:0;font-size:20px;font-weight:600}' +
      '.crumbs{margin-top:3px;font-size:13px;color:var(--dbc-fg-56637f)}.crumbs code{color:var(--dbc-fg-56637f)}' +
      '.crumbs a{color:var(--dbc-fg-1e6bff);text-decoration:none}.crumbs a:hover{text-decoration:underline}' +
      '.bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px;padding-bottom:12px;position:relative}' +
      'button{padding:7px 13px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);font:inherit;cursor:pointer}' +
      'button:hover{border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-1e6bff)}' +
      'button.primary{background:var(--dbc-bg-1e6bff);border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-fff);font-weight:600}' +
      'button.primary:hover{background:var(--dbc-bg-155ee0);color:var(--dbc-fg-fff)}' +
      'button.db-ok{border-color:var(--dbc-bd-1c6b32);color:var(--dbc-fg-1c6b32);background:var(--dbc-bg-e4f4e8)}' +
      'button.db-bad{border-color:var(--dbc-bd-a11a1a);color:var(--dbc-fg-a11a1a);background:var(--dbc-bg-fde8e8)}' +
      '.seg{display:inline-flex;border:1px solid var(--dbc-bd-10224e);border-radius:6px;overflow:hidden}' +
      '.seg button{border:0;border-radius:0;padding:7px 14px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e)}' +
      '.seg button[aria-pressed="true"]{background:var(--dbc-bg-10224e);color:var(--dbc-fg-fff)}' +
      '.bar input[type=search]{margin-left:auto;padding:7px 11px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;font:inherit;min-width:220px}' +
      '.bar select{padding:7px 9px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;font:inherit;background:var(--dbc-bg-fff);max-width:260px}' +
      '.bar select:hover{border-color:var(--dbc-bd-1e6bff)}' +
      '.bar label{font-size:13px;color:var(--dbc-fg-56637f);display:flex;align-items:center;gap:5px}' +
      'main{flex:1;display:flex;min-height:0}' +
      'nav{flex:none;width:240px;overflow:auto;padding:14px 8px 24px 14px;border-right:1px solid var(--dbc-bd-dde3f0);background:var(--dbc-bg-fff)}' +
      'nav a{display:block;padding:5px 8px;border-radius:5px;color:var(--dbc-fg-10224e);text-decoration:none;font-size:13px}' +
      'nav a.s{padding-left:22px;color:var(--dbc-fg-56637f);font-size:12.5px}' +
      'nav a:hover{background:var(--dbc-bg-e9f1ff)}nav a.hid{opacity:.55}' +
      'nav .n{float:right;color:var(--dbc-fg-97a5c6);font-size:11.5px}' +
      '#content{flex:1;overflow:auto;padding:14px 22px 40px}' +
      '#v-form,#v-fields,#v-choices,#v-json,#v-scripts,#v-rules,#v-automations,#v-commands{display:none}' +
      'body.view-form #v-form,body.view-fields #v-fields,body.view-choices #v-choices,body.view-json #v-json,' +
      'body.view-scripts #v-scripts,body.view-rules #v-rules,body.view-automations #v-automations,body.view-commands #v-commands{display:block}' +
      'body.view-scripts .bar>label,body.view-rules .bar>label,body.view-automations .bar>label,body.view-commands .bar>label,body.view-json .bar>label{opacity:.4;pointer-events:none}' +
      'body:not(.view-form) nav{display:none}' +
      'body.hide-empty [data-empty="1"]{display:none}' +
      'body:not(.whole-entity) [data-off="1"]{display:none}' +
      '.tab{margin-bottom:26px}' +
      'h2{margin:6px 0 10px;padding-bottom:6px;font-size:16px;font-weight:600;border-bottom:1px solid var(--dbc-bd-dde3f0)}' +
      'h2 code,h3 code{margin-left:10px;font-weight:400}' +
      '.sec{margin:0 0 16px;background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px;overflow:hidden}' +
      '.sec h3{margin:0;padding:9px 14px;font-size:13.5px;font-weight:600;background:var(--dbc-bg-f5f7fc);border-bottom:1px solid var(--dbc-bd-dde3f0)}' +
      '.hid>h2,.hid>h3{color:var(--dbc-fg-56637f)}.sec.hid{border-style:dashed}' +
      '.row{display:grid;grid-template-columns:minmax(220px,1fr) 150px minmax(0,2fr);gap:0 14px;padding:8px 14px;border-top:1px solid var(--dbc-bd-edf1f8);align-items:start}' +
      '.row:first-of-type{border-top:0}.row.hid{border-left:3px dashed var(--dbc-bd-c6d0e4);color:var(--dbc-fg-56637f)}' +
      '.row.f{grid-template-columns:minmax(220px,1fr) 150px minmax(0,2fr) 200px;background:var(--dbc-bg-fff)}' +
      '#v-fields{background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px;overflow:hidden}' +
      '.lbl{font-weight:600}.sub{font-weight:400;font-size:12.5px;color:var(--dbc-fg-56637f);margin-top:1px}' +
      '.typ{font-size:12.5px;color:var(--dbc-fg-56637f);padding-top:2px}' +
      '.whr{font-size:12.5px;color:var(--dbc-fg-56637f)}' +
      '.val{min-width:0;overflow-wrap:anywhere}.txt{white-space:pre-wrap}' +
      '.nil{color:var(--dbc-fg-97a5c6)}' +
      '.num{color:var(--dbc-fg-1e6bff)}.ent{margin-left:6px}' +
      '.lk{color:var(--dbc-fg-10224e);font-weight:600;text-decoration:none;border-bottom:2px solid var(--dbc-bd-e3b04b)}.lk:hover{color:var(--dbc-fg-1e6bff)}' +
      '.lk-dead{font-weight:600;border-bottom:2px dotted var(--dbc-bd-c6d0e4)}' +
      '.bd{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:10px;background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f);font-size:11px;font-weight:400;vertical-align:1px}' +
      '.bd.req{background:var(--dbc-bg-fdf1d6);color:var(--dbc-fg-7a5410)}.bd.warn{background:var(--dbc-bg-fde8e8);color:var(--dbc-fg-a11a1a)}' +
      '.mini{margin-left:8px;padding:2px 8px;font-size:11.5px;border-radius:10px;color:var(--dbc-fg-56637f)}' +
      '.mini.db-ok,.mini.db-bad{padding:2px 8px}' +
      'table.opts{margin-top:6px;border-collapse:collapse;font-size:12.5px}' +
      'table.opts td{padding:3px 10px 3px 0;border-top:1px solid var(--dbc-bd-edf1f8);vertical-align:top}' +
      'table.opts tr.on td{font-weight:600;color:var(--dbc-fg-10224e)}table.opts tr.on td:first-child::before{content:"● ";color:var(--dbc-fg-e3b04b)}' +
      'table.opts .st{color:var(--dbc-fg-97a5c6)}' +
      '.card{margin:0 0 12px;padding:10px 14px 12px;background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px}' +
      '.card h3{margin:0;font-size:13.5px}.card .kind{float:right;font-size:11.5px;color:var(--dbc-fg-97a5c6);font-weight:400}' +
      '.card .picked{margin:4px 0 2px;font-size:13px}' +
      '#json{margin:0;padding:14px 18px;background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px;font:12.5px/1.45 ui-monospace,Consolas,monospace;white-space:pre;overflow:auto;color:var(--dbc-fg-10224e)}' +
      '.status{margin-left:8px;font-size:12.5px;color:var(--dbc-fg-56637f)}' +
      '@media (prefers-reduced-motion:no-preference){[data-opts]{transition:color 120ms}}' +
      DynaBoost.formLogic.css +
      (DynaBoost.formCommands ? DynaBoost.formCommands.css : '') +
      DynaBoost.code.css +
      DynaBoost.tabCss +
      '</style>' +
      '<body class="view-form">' +
      '<header>' +
      '<h1>' + esc(title) + '</h1>' +
      '<div class="crumbs">' +
      esc(dump.entity.displayName || '') + ' <code>' + esc(dump.entity.logicalName) + '</code>' +
      ' · form <b>' + esc(dump.form.name) + '</b>' +
      (dump.record ? ' · <a href="' + esc(dump.record.url) + '" target="_blank" rel="noopener">open record</a> · <a href="' + esc(dump.record.apiUrl) + '" target="_blank" rel="noopener">Web API</a>' : ' · no record (new form)') +
      (dump.record && dump.record.unsavedChanges ? ' <span class="bd warn">form has unsaved changes — values below are the saved ones</span>' : '') +
      '</div>' +
      '<div id="lg-sum"><div class="lg-sum"><span class="lg-sum-h">Logic</span><span class="lg-dim">reading scripts, rules and automations…</span></div></div>' +
      '<div class="bar">' +
      '<button class="primary" id="copy-json">Copy JSON</button>' +
      '<button id="dl-json">Download .json</button>' +
      '<span class="seg" role="group" aria-label="View">' +
      '<button id="v1" data-view="v1" aria-pressed="true">Form</button>' +
      '<button id="v2" data-view="v2" aria-pressed="false">Fields</button>' +
      '<button id="v3" data-view="v3" aria-pressed="false">Choices (' + fieldCount + ')</button>' +
      '<button id="v4" data-view="v4" aria-pressed="false">JSON</button></span>' +
      '<label><input type="checkbox" id="hide-empty"> hide empty</label>' +
      '<label title="Fields and choices the entity has but this form does not show"><input type="checkbox" id="whole-entity"> whole entity</label>' +
      (dump.availableForms && dump.availableForms.length > 1
        ? '<select id="form-pick" title="Show a different main form">' +
          dump.availableForms
            .map((f) => '<option value="' + esc(f.id) + '"' + (f.current ? ' selected' : '') + '>' + esc(f.name) + ' (' + f.controls + ')</option>')
            .join('') +
          '</select>'
        : '') +
      '<input type="search" id="q" placeholder="Filter by name, label or value">' +
      '<span class="status" id="status"></span>' +
      '</div></header>' +
      '<main><nav id="nav"></nav><div id="content">' +
      '<div id="v-form"></div><div id="v-fields"></div><div id="v-choices"></div><div id="v-json"><pre id="json"></pre></div>' +
      '<div id="v-scripts"></div><div id="v-rules"></div><div id="v-automations"></div><div id="v-commands"></div>' +
      '</div></main>'
    );
  }

  // ---------- wiring ----------

  const CHECK =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:14px;height:14px;vertical-align:-2px;margin-right:5px">' +
    '<path d="m5 13 4 4L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function flash(btn, text, ok) {
    if (btn.__dbTimer) clearTimeout(btn.__dbTimer);
    if (btn.__dbLabel == null) btn.__dbLabel = btn.textContent;
    btn.innerHTML = (ok ? CHECK : '') + text;
    btn.classList.remove('db-ok', 'db-bad');
    btn.classList.add(ok ? 'db-ok' : 'db-bad');
    btn.__dbTimer = setTimeout(() => {
      btn.textContent = btn.__dbLabel;
      btn.classList.remove('db-ok', 'db-bad');
    }, 2200);
  }

  async function copyInto(tab, text) {
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

  function download(tab, content, name) {
    const blob = new tab.Blob([content], { type: 'application/json' });
    const url = tab.URL.createObjectURL(blob);
    const a = tab.document.createElement('a');
    a.href = url;
    a.download = name;
    tab.document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => tab.URL.revokeObjectURL(url), 1000);
  }

  const VIEWS = { v1: 'form', v2: 'fields', v3: 'choices', v4: 'json', v5: 'scripts', v6: 'rules', v7: 'automations', v8: 'commands' };

  /* The form is drawn at once; the logic arrives as a promise and is put in
   * place when it lands - the Logic strip, the logic views and the marks on
   * the columns, all filled in without redrawing the form. */
  function wire(tab, dump, ctx, logicPromise) {
    const doc = tab.document;
    const get = (id) => doc.getElementById(id);
    const FL = DynaBoost.formLogic;
    let logic = null;
    // The JSON is taken when it is asked for: the logic and cloud flows join it later.
    const toJson = () => JSON.stringify(dump, null, 2);
    const json = toJson();
    const safeName = ((dump.record && dump.record.name) || dump.entity.logicalName).replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 60);

    MARKS = Object.create(null);
    get('nav').innerHTML = navHtml(dump);
    get('v-form').innerHTML = formViewHtml(dump);
    get('v-fields').innerHTML = fieldsViewHtml(dump);
    get('v-choices').innerHTML = choicesViewHtml(dump);
    get('json').innerHTML = DynaBoost.code.html(json, 'json');

    let current = 'v1';
    const showView = (id) => {
      if (!VIEWS[id]) return;
      if (id !== current) get('content').scrollTop = 0;
      current = id;
      doc.body.className = (doc.body.className.replace(/\bview-\w+/g, '') + ' view-' + VIEWS[id]).trim().replace(/\s+/g, ' ');
      doc.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === id)));
    };

    const onForm = doc.querySelectorAll('#v-fields .row:not([data-off])').length;
    const offForm = dump.columnsNotOnForm.length;
    get('status').textContent = onForm + ' fields on form · ' + offForm + ' more in entity · ' + (json.length / 1024).toFixed(0) + ' KB';

    get('copy-json').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const ok = await copyInto(tab, toJson());
      flash(btn, ok ? 'Copied' : 'Copy failed — use the JSON view', ok);
    });
    get('dl-json').addEventListener('click', () => download(tab, toJson(), dump.entity.logicalName + '_' + safeName + '.json'));

    get('hide-empty').addEventListener('change', (e) => doc.body.classList.toggle('hide-empty', e.target.checked));
    get('whole-entity').addEventListener('change', (e) => doc.body.classList.toggle('whole-entity', e.target.checked));

    const picker = get('form-pick');
    if (picker) {
      picker.addEventListener('change', (e) => {
        const chosen = e.target.value;
        get('status').textContent = 'Loading form\u2026';
        picker.disabled = true;
        fillTab(tab, Object.assign({}, ctx, { formId: chosen }));
      });
    }

    get('q').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      doc.querySelectorAll('[data-s]').forEach((el) => {
        const hay = el.getAttribute('data-s') + ' ' + (el.getAttribute('data-m') || '');
        el.style.display = !q || hay.indexOf(q) >= 0 ? '' : 'none';
      });
      // A section with nothing left to show gets out of the way.
      doc.querySelectorAll('#v-form .sec').forEach((sec) => {
        const any = Array.from(sec.querySelectorAll('.row')).some((r) => r.style.display !== 'none');
        sec.style.display = q && !any ? 'none' : '';
      });
      doc.querySelectorAll('#v-automations .lg-sec').forEach((sec) => {
        const any = Array.from(sec.querySelectorAll('.lg-r')).some((r) => r.style.display !== 'none');
        sec.style.display = q && !any ? 'none' : '';
      });
    });

    doc.addEventListener('click', (e) => {
      const view = e.target.closest('[data-view]');
      if (view) {
        e.preventDefault();
        showView(view.getAttribute('data-view'));
        return;
      }
      const opts = e.target.closest('[data-opts]');
      if (opts) {
        const table = opts.nextElementSibling;
        table.hidden = !table.hidden;
        return;
      }
      const dumpBtn = e.target.closest('[data-dump]');
      if (dumpBtn) {
        const [entity, id] = dumpBtn.getAttribute('data-dump').split('|');
        if (!entity || !id) return;
        flash(dumpBtn, 'Opening…', true);
        openDump({
          entity: entity,
          id: clean(id),
          recordName: null,
          formId: '',
          formName: null,
          clientUrl: dump.environment,
          lcid: null,
          envId: logic ? logic.environmentId : null,
          unsaved: false,
          tabs: {},
          sections: {},
          controls: {},
          attributes: {}
        });
      }
    });

    const refresh = () => {
      const sum = get('lg-sum');
      if (sum) sum.innerHTML = FL.summaryHtml(logic);
      showView(current);
      get('json').innerHTML = DynaBoost.code.html(toJson(), 'json');
      if (get('q').value) get('q').dispatchEvent(new tab.Event('input'));
    };

    // The form picker redraws the tab for another form: logic that lands
    // after that belongs to a page that is gone.
    const gen = (tab.__dbFormGen = (tab.__dbFormGen || 0) + 1);
    Promise.resolve(logicPromise).then((lg) => {
      if (tab.closed || tab.__dbFormGen !== gen) return;
      dump.logic = lg || null;
      if (!lg || lg.error) {
        get('lg-sum').innerHTML = '<div class="lg-sum"><span class="lg-sum-h">Logic</span><span class="lg-dim">could not be read: ' + esc(lg && lg.error) + '</span></div>';
        get('json').innerHTML = DynaBoost.code.html(toJson(), 'json');
        return;
      }
      logic = lg;
      MARKS = FL.marks(logic);
      FL.updateMarks(doc, logic);
      get('v-scripts').innerHTML = FL.scriptsHtml(logic);
      get('v-rules').innerHTML = FL.rulesHtml(logic);
      get('v-automations').innerHTML = FL.automationsHtml(logic);
      refresh();
      FL.wire(tab, dump, showView, refresh);
    });
  }

  // ---------- run ----------

  /* Opened within the click, before any await, or it is blocked as a pop-up. */
  function openBlankTab(what) {
    const tab = window.open('', '_blank');
    if (!tab) {
      window.alert('The tab was blocked. Allow pop-ups for this site and try again.');
      return null;
    }
    tab.document.write(
      '<!doctype html><meta charset="utf-8"><title>Reading\u2026</title>' +
        '<body style="font:14px/1.5 \'Segoe UI\',system-ui,sans-serif;padding:24px;color:var(--dbc-fg-10224e)">' +
        '<p>Reading ' + esc(what) + '\u2026</p>'
    );
    DynaBoost.themeTab(tab);
    return tab;
  }

  async function fillTab(tab, ctx) {
    let got;
    try {
      got = await collect(ctx);
    } catch (e) {
      if (!tab.closed) tab.close();
      window.alert('Could not read the form.\n\n' + e.message);
      return;
    }
    if (tab.closed) return;

    const dump = got.dump;
    tab.document.open();
    tab.document.write(pageHtml(dump));
    tab.document.close();
    DynaBoost.themeTab(tab);
    wire(tab, dump, Object.assign({}, ctx, { formId: dump.form.id }), got.logic);
  }

  function openDump(ctx) {
    const tab = openBlankTab(ctx.entity + ' ' + ctx.id);
    if (tab) fillTab(tab, ctx);
  }

  async function run() {
    const tab = openBlankTab('the form');
    if (!tab) return;

    let ctx = await pageContext(1500);
    if (!ctx || !ctx.entity) ctx = urlContext();
    if (!ctx) {
      tab.close();
      window.alert('Open a record form first. This tile reads the form you are looking at.');
      return;
    }
    if (!ctx.clientUrl) ctx.clientUrl = location.origin;
    await fillTab(tab, ctx);
  }

  // Which form is open, for the other record tiles (Edit form): the Xrm
  // snapshot when the page has one, else what the URL says.
  DynaBoost.formContext = (timeout) => pageContext(timeout || 1500).then((c) => c || urlContext());

  DynaBoost.register({
    id: 'form-dump',
    name: 'Form as JSON',
    group: 'Records',
    hosts: ['dynamics.com'],
    // A record form - not a list, a dashboard or the classic designer.
    when: () => {
      const q = new URLSearchParams(location.search);
      return q.get('pagetype') === 'entityrecord' || (!!q.get('etn') && !!q.get('id'));
    },
    type: 'action',
    hint: 'Every tab, section, field and choice on the form you are looking at — hidden ones too — with values, plus its scripts, business rules and automations',
    icon: ICON,
    onRun: run
  });
})();
