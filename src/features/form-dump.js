/* Feature: Form as JSON. Opens a tab with the open form: every tab, section
 * and control (hidden ones too) in form order, with the record's saved values,
 * choice options and lookup targets. Views: Form, Fields, Choices, JSON; the
 * Logic strip (form-logic.js) adds Scripts, Business rules and Automations.
 *
 * Sources: the Xrm snapshot from form-dump-hook.js (form, record, runtime
 * visibility, the business process flow), systemforms.formxml, the record from the Web API with
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
  const SRC = 'dynaboost-form-ctx-2'; // the helper's channel and version (form-dump-hook.js)
  const ANNOTATE = 'odata.include-annotations="*"';
  const FMT = '@OData.Community.Display.V1.FormattedValue';
  const LOOKUP_ENTITY = '@Microsoft.Dynamics.CRM.lookuplogicalname';

  // Download JSON: a floppy with braces in it.
  const FLOPPY =
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3.5 3.5h10l3 3v10h-13z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
    '<path d="M6.5 3.5v4h6v-4" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
    '<path d="M8.3 10.6c-.7 0-1 .3-1 1v.7c0 .5-.3.8-.7 1 .4.2.7.5.7 1v.7c0 .7.3 1 1 1M11.7 10.6c.7 0 1 .3 1 1v.7c0 .5.3.8.7 1-.4.2-.7.5-.7 1v.7c0 .7-.3 1-1 1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

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
  // The helper puts this on the page when it is in (form-dump-hook.js).
  const hookIn = () => document.documentElement.getAttribute('data-dynaboost-form-hook') === '2';

  function pageContext(timeout) {
    // A helper put in only now first has to load and start - on a busy page
    // that can take more than a moment; one that is in answers at once.
    if (!hookIn()) timeout = Math.max(timeout, 8000);
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
        if (!d || d.source !== SRC) return;
        if (d.type === 'ready') return ask(); // the hook has just come in
        if (d.type !== 'response' || d.nonce !== nonce) return;
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
    const pg = DynaBoost.page();
    const etn = pg.etn;
    if (!etn) return null;
    return {
      entity: etn,
      id: clean(pg.id),
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
      attributes: {},
      fromAddress: true // the page did not answer
    };
  }

  /* The page's answer, waiting a little for the business process: Dynamics
   * puts the process bar on the form after the form itself, so right after a
   * record opens the form can have its process controls (header_process_...)
   * and no process yet. */
  async function formContextWithProcess(onWait) {
    let ctx = await pageContext(1500);
    const hasBar = (c) => !!c && Object.keys(c.controls || {}).some((k) => /^header_process_/.test(k));
    for (let i = 0; ctx && !ctx.process && hasBar(ctx) && i < 6; i++) {
      if (onWait) onWait();
      await new Promise((r) => setTimeout(r, 700));
      ctx = (await pageContext(1500)) || ctx;
    }
    if (ctx && !ctx.process && hasBar(ctx)) ctx.processNotLoaded = true;
    return ctx;
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

  /* The table's definition - its set name is what the record read needs, so
   * it is asked for on its own, first; kept per page, as the rest. */
  const defCache = new Map(); // entity -> promise of the definition
  function loadDef(etn) {
    if (!defCache.has(etn)) {
      const p = getJson("EntityDefinitions(LogicalName='" + etn + "')?$select=EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute,DisplayName,LogicalName");
      p.catch(() => defCache.delete(etn));
      defCache.set(etn, p);
    }
    return defCache.get(etn);
  }

  async function loadMeta(etn, lcid) {
    if (metaCache.has(etn)) return metaCache.get(etn);
    const base = "EntityDefinitions(LogicalName='" + etn + "')";

    // All at once - none of these needs another's answer.
    const choices = Promise.allSettled(
      CHOICE_CASTS.map(([cast]) => getJson(base + '/Attributes/' + cast + '?$select=LogicalName&$expand=OptionSet'))
    );
    const [def, attrs, lookups] = await Promise.all([
      loadDef(etn),
      getJson(base + '/Attributes?$select=LogicalName,SchemaName,AttributeType,AttributeTypeName,DisplayName,RequiredLevel,IsPrimaryId,IsPrimaryName,IsCustomAttribute,AttributeOf'),
      getJson(base + '/Attributes/Microsoft.Dynamics.CRM.LookupAttributeMetadata?$select=LogicalName,Targets')
    ]);

    const attr = Object.create(null);
    for (const a of attrs.value) attr[a.LogicalName] = a;
    for (const l of lookups.value) if (attr[l.LogicalName]) attr[l.LogicalName].Targets = l.Targets;

    const results = await choices;

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
    const pageEtn = DynaBoost.page().etn;
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

    /* The business process flow (from Xrm - it is not in formxml): its
     * stages in order, each a section of its steps. A column of this table
     * in a stage counts as on the form - the form shows it in the process
     * bar; a step on another table (a later stage) or with no column is
     * listed by its name. */
    function parseProcess() {
      const p = ctx.process;
      if (!p || !Array.isArray(p.stages) || !p.stages.length) return null;
      return {
        id: p.id || null,
        name: p.name || null,
        status: p.status || null,
        stages: p.stages.map((st, j) => {
          const here = !st.entity || st.entity === ctx.entity;
          const controls = (st.steps || []).map((sp) => {
            const field = sp.attribute || null;
            const base = { kind: 'step', id: field ? 'header_process_' + field : null, label: sp.name || field || '', required: !!sp.required };
            if (!field || !here || !meta.attr[field]) {
              if (field) base.field = field;
              if (!here) base.entity = st.entity;
              return base;
            }
            base.kind = 'field';
            const rt = ctx.controls['header_process_' + field];
            if (rt && rt.disabled === true) base.disabled = true;
            onForm.add(field);
            if (!where[field]) where[field] = [];
            where[field].push({ process: p.name, stage: st.name, n: j + 1 });
            return Object.assign(base, describeField(field, meta, record, ctx));
          });
          const out = { n: j + 1, name: st.id || st.name, label: st.name, entity: st.entity || null, active: !!st.active, controls: controls };
          // A stage of a branch this record does not take, as its values are now.
          if (Array.isArray(p.activePath) && p.activePath.length && st.id && p.activePath.indexOf(st.id) < 0) out.offPath = true;
          return out;
        })
      };
    }
    const process = parseProcess();

    const headerEl = xml.querySelector('form > header');
    const footerEl = xml.querySelector('form > footer');

    const dump = {
      about: ABOUT,
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
      layout: null,
      header: headerEl ? container(headerEl, { name: 'header', label: 'Header' }) : [],
      process: process,
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

    /* A column both on the form and in the business process says so on each
     * side, so the JSON alone tells every place a field is. */
    if (process) {
      const stagesOf = Object.create(null);
      for (const st of process.stages) {
        for (const c of st.controls) {
          if (c.kind !== 'field') continue;
          (stagesOf[c.field] = stagesOf[c.field] || []).push(c.required ? { stage: st.label, n: st.n, required: true } : { stage: st.label, n: st.n });
        }
      }
      eachControl(dump, (c, sec, place) => {
        if (c.kind !== 'field') return;
        if (place === PROCESS_PLACE) {
          const at = (where[c.field] || []).filter((w) => w.tab).map((w) => ({ tab: w.tabLabel, section: w.sectionLabel }));
          if (at.length) c.alsoOnForm = at;
        } else if (stagesOf[c.field]) {
          c.alsoInProcess = stagesOf[c.field];
        }
      });
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

  // The views a form's subgrids show, by id - read from its formxml, so they
  // can be asked for while the record is still on its way.
  function viewIdsIn(formxml) {
    const ids = new Set();
    for (const m of String(formxml || '').matchAll(/<ViewId>\s*\{?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}?\s*<\/ViewId>/gi)) ids.add(clean(m[1]));
    return ids;
  }

  // { ids, byId }, or null when savedqueries cannot be read (no rights).
  async function viewNames(ids) {
    const byId = {};
    if (!ids.size) return { ids: ids, byId: byId };
    try {
      const f = Array.from(ids).map((v) => 'savedqueryid eq ' + v).join(' or ');
      const r = await getJson('savedqueries?$select=savedqueryid,name,returnedtypecode&$filter=' + f);
      for (const v of r.value) byId[v.savedqueryid] = { id: v.savedqueryid, name: v.name, entity: v.returnedtypecode };
    } catch (e) {
      return null;
    }
    return { ids: ids, byId: byId };
  }

  async function resolveViews(dump, viewIds, early) {
    if (!viewIds.size) return;
    // What was read early; a view it did not ask for is asked for now.
    const got = early ? await early.catch(() => undefined) : undefined;
    if (got === null) return; // no rights to savedqueries - the ViewId stays in parameters
    const byId = Object.assign({}, got && got.byId);
    const rest = new Set(Array.from(viewIds).filter((v) => !(got && got.ids.has(v))));
    if (rest.size) {
      const more = await viewNames(rest);
      if (more) Object.assign(byId, more.byId);
    }
    eachControl(dump, (c) => {
      if (c.kind === 'subgrid' && c.parameters && c.parameters.ViewId) {
        const v = byId[clean(c.parameters.ViewId)];
        if (v) c.view = v;
      }
    });
  }

  /* The business process flow's definition (form-bpf.js): its row's XAML,
   * one request, kept per page. Never a rejection - the form does not wait
   * on it to fail. */
  const bpfCache = new Map();
  function loadBpf(id) {
    const key = clean(id);
    if (!bpfCache.has(key)) {
      const p = getJson('workflows(' + key + ')?$select=name,uniquename,xaml,statecode,ismanaged,modifiedon')
        .then((row) => ({ row: row, def: DynaBoost.formBpf.read(row.xaml) }))
        .catch((e) => {
          bpfCache.delete(key);
          return { error: String((e && e.message) || e).split('\n')[0] };
        });
      bpfCache.set(key, p);
    }
    return bpfCache.get(key);
  }

  /* The definition as the JSON gives it: each branch after its stage, its
   * rules in order in words, where it goes otherwise - stages by their
   * number on the bar ("3. Approval"), as everywhere else in the JSON. */
  function definitionOf(got, dump, meta, lcid) {
    if (!got) return null;
    if (got.error) return { error: 'The process definition was not read: ' + got.error };
    const FB = DynaBoost.formBpf;
    const here = dump.entity.logicalName;
    const cond = FB.words(got.def, {
      label: (t, c) => (t === here && meta.attr[c] ? label(meta.attr[c].DisplayName, lcid) : null),
      option: (t, c, v) => {
        const o = t === here && meta.options[c] ? meta.options[c].options.find((x) => String(x.value) === String(v) || (x.value === 1 && v === 'true') || (x.value === 0 && v === 'false')) : null;
        return o ? o.label : null;
      }
    });
    const bar = dump.process.stages;
    const stageText = (id) => {
      if (!id) return null;
      const st = bar.find((x) => clean(x.name) === id);
      if (st) return st.n + '. ' + (st.label || st.name);
      const x = got.def.byId[id];
      return x ? x.stage : id;
    };
    const out = {
      from: 'the process row (workflows, its XAML)',
      branches: got.def.branches.map((b) => {
        const o = { after: stageText(b.after) || b.afterName || null, rules: b.rules.map((r) => Object.assign(r.name ? { name: r.name } : {}, { if: cond(r.cond), then: stageText(r.to) })) };
        if (b.otherwise) o.otherwise = stageText(b.otherwise);
        return o;
      })
    };
    // Each stage without a branch: the one after it (the process ends after the last).
    const branched = new Set(got.def.branches.map((b) => b.after));
    const next = got.def.stages.filter((st) => st.id && !branched.has(st.id)).map((st) => (stageText(st.id) || st.stage) + ' → ' + (st.next ? stageText(st.next) : 'end'));
    if (next.length) out.next = next;
    // Steps that run something - a workflow, an action - by stage.
    const runs = [];
    for (const st of got.def.stages) {
      for (const sp of st.steps) {
        const what = sp.workflowId || sp.workflowName || sp.actionId || sp.actionName || sp.processId;
        if (what) runs.push({ stage: stageText(st.id) || st.stage, step: sp.step, runs: sp.workflowName || sp.actionName || what });
      }
    }
    if (runs.length) out.stepsThatRun = runs;
    if (got.def.unread.length) out.notUnderstood = got.def.unread;
    if (got.row && got.row.modifiedon) out.modifiedOn = got.row.modifiedon;
    return out;
  }

  // A branch in one line: "after 1. Qualify: if … → 3. Approval; otherwise → 4. Close".
  function branchLine(b) {
    const parts = b.rules.map((r, i) => (i ? 'else if ' : 'if ') + r.if + ' → ' + (r.then || '?'));
    if (b.otherwise) parts.push('otherwise → ' + b.otherwise);
    return (b.after ? 'after ' + b.after + ': ' : '') + parts.join('; ');
  }

  const PROCESS_PLACE = { name: 'process', label: 'Process' };

  // The first key of the JSON: what it holds, for whoever it is passed to.
  const ABOUT =
    'Form as JSON (DynaBoost). "layout" is the form at a glance, in the order it shows: header, business process (its stages), ' +
    'tabs > sections, footer - each item with only what sets it apart (required, hidden, read-only). ' +
    'Below it the same in full - header, process, tabs, footer - every control with its column metadata and the record\'s value. ' +
    '"alsoInProcess" / "alsoOnForm" mark a column that is both on the form and in a stage of the business process (stages by number, "1. Identify"; ' +
    'tab › section); a process item without "alsoOnForm" is only in the process. ' +
    'The process\'s "branches" (layout) and "definition" say where it goes after a stage and on what condition; "notOnPath" marks a stage this record does not reach as its values are now. ' +
    '"columnsNotOnForm": the record\'s other columns; "choices": the option sets; "logic": what runs on the form, when it was read.';

  /* The form at a glance, in the order it shows: the header, the business
   * process and its stages, the tabs and their sections, the footer - each
   * item by name and label with only what sets it apart. The details are
   * below it, in header / process / tabs / footer. */
  function layoutOf(dump) {
    const item = (c) => {
      const o = {};
      if (c.kind === 'field') {
        o.field = c.field;
        o.label = c.label || c.displayName || c.field;
        o.type = typeText(c);
      } else if (c.kind === 'step') {
        o.step = c.label;
        if (c.field) o.field = c.field;
        if (c.entity) o.table = c.entity;
      } else {
        o[c.kind] = c.id;
        if (c.label) o.label = c.label;
        const p = c.parameters || {};
        if (c.kind === 'subgrid' && p.TargetEntityType) o.table = p.TargetEntityType;
        if (c.view) o.view = c.view.name;
        if (c.basedOn) o.basedOn = c.basedOn;
      }
      if (c.required || c.requiredLevel === 'ApplicationRequired' || c.requiredLevel === 'SystemRequired') o.required = true;
      if (c.visibility) o.visibility = c.visibility;
      if (c.disabled) o.readOnly = true;
      // A stage by its number too: a process can have two stages of one name.
      if (c.alsoInProcess) o.alsoInProcess = c.alsoInProcess.map((st) => st.n + '. ' + st.stage);
      // › between tab and section: their labels can have a / of their own.
      if (c.alsoOnForm) o.alsoOnForm = c.alsoOnForm.map((w) => w.tab + ' › ' + w.section);
      return o;
    };
    const items = (sections) => [].concat(...sections.map((s) => s.controls.map(item)));
    const box = (x, key) => {
      const o = { [key]: x.label || x.name, name: x.name };
      if (x.visibility) o.visibility = x.visibility;
      return o;
    };
    const p = dump.process;
    return {
      header: items(dump.header),
      process: p
        ? {
            name: p.name,
            stages: p.stages.map((st) => {
              const o = { n: st.n, stage: st.label || st.name };
              if (st.active) o.active = true;
              if (st.offPath) o.notOnPath = true;
              if (st.entity && st.entity !== dump.entity.logicalName) o.table = st.entity;
              o.items = st.controls.map(item);
              return o;
            }),
            ...(p.definition && p.definition.branches && p.definition.branches.length ? { branches: p.definition.branches.map(branchLine) } : {})
          }
        : null,
      tabs: dump.tabs.map((t) => {
        const o = box(t, 'tab');
        if (!t.expanded) o.collapsed = true;
        o.sections = t.sections.map((s) => Object.assign(box(s, 'section'), { items: s.controls.map(item) }));
        return o;
      }),
      footer: items(dump.footer)
    };
  }

  /* JSON as people read it: a short object or list on one line, a longer one
   * broken up - the same data as JSON.stringify(x, null, 2), far fewer
   * lines. A try on one line gives up as soon as it is too long. */
  const JSON_WIDTH = 120;
  function prettyJson(value) {
    const entries = (x) =>
      Array.isArray(x) ? x.map((v) => [null, v]) : Object.keys(x).filter((k) => x[k] !== undefined && typeof x[k] !== 'function').map((k) => [k, x[k]]);
    const leaf = (x) => {
      const t = JSON.stringify(x);
      return t === undefined ? 'null' : t;
    };
    // One line, or null when it would be longer than room.
    const flat = (x, room) => {
      if (x === null || typeof x !== 'object') return leaf(x);
      const es = entries(x);
      const arr = Array.isArray(x);
      if (!es.length) return arr ? '[]' : '{}';
      const parts = [];
      let len = 4;
      for (const [k, v] of es) {
        const head = k === null ? '' : JSON.stringify(k) + ': ';
        const t = flat(v, room - len - head.length);
        if (t === null) return null;
        len += head.length + t.length + 2;
        if (len > room) return null;
        parts.push(head + t);
      }
      return arr ? '[' + parts.join(', ') + ']' : '{ ' + parts.join(', ') + ' }';
    };
    const walk = (x, ind, used) => {
      if (x === null || typeof x !== 'object') return leaf(x);
      const one = flat(x, JSON_WIDTH - ind.length - used);
      if (one !== null) return one;
      const arr = Array.isArray(x);
      const es = entries(x);
      if (!es.length) return arr ? '[]' : '{}';
      const inner = ind + '  ';
      const lines = es.map(([k, v]) => {
        const head = k === null ? '' : JSON.stringify(k) + ': ';
        return inner + head + walk(v, inner, head.length);
      });
      return (arr ? '[' : '{') + '\n' + lines.join(',\n') + '\n' + ind + (arr ? ']' : '}');
    };
    return walk(value, '', 0);
  }

  function eachControl(dump, fn) {
    const groups = [['header', dump.header], ['process', dump.process ? dump.process.stages : []], ['tabs', dump.tabs], ['footer', dump.footer]];
    for (const [kind, list] of groups) {
      for (const node of list) {
        const sections = kind === 'tabs' ? node.sections : [node];
        for (const s of sections) for (const c of s.controls) fn(c, s, kind === 'tabs' ? node : kind === 'process' ? PROCESS_PLACE : null);
      }
    }
  }

  /* The reads side by side: the metadata, the forms (and the views their
   * subgrids show), and the record as soon as the table's set name is known -
   * the same requests as one after another, about half the waiting. */
  async function collect(ctx, steps) {
    // Each read ticks its step in the tab when it is in (see stepsIn).
    const track = (key, p, text) => {
      if (!steps) return p;
      steps.busy(key);
      p.then(
        (v) => {
          try {
            steps.ok(key, text(v));
          } catch (e) {
            steps.ok(key);
          }
        },
        (e) => steps.bad(key, String((e && e.message) || e).split('\n')[0])
      );
      return p;
    };
    const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
    const formsP = track('forms', loadForms(ctx.entity), (f) => plural(f.length, 'main form', 'main forms') + ' - this one: ' + pickForm(f, ctx.formId).name);
    const viewsP = formsP.then((forms) => viewNames(viewIdsIn(pickForm(forms, ctx.formId).formxml)));
    if (steps) {
      steps.busy('views');
      viewsP.then(
        (v) => (v === null ? steps.wait('views', 'Not readable with your rights - their ids stay') : steps.ok('views', v.ids.size ? plural(v.ids.size, 'view', 'views') : 'No subgrid on this form')),
        () => steps.wait('views', 'Not read - the forms were not read')
      );
    }
    const recordP = ctx.id
      ? track('record', loadDef(ctx.entity).then((def) => getJson(def.EntitySetName + '(' + ctx.id + ')', ANNOTATE)), (r) => plural(Object.keys(r || {}).filter((k) => k.indexOf('@') < 0).length, 'value', 'values'))
      : Promise.resolve(null);
    if (!ctx.id && steps) steps.wait('record', 'A new record - nothing saved yet');
    // The process's definition - its branches and their conditions - read alongside.
    const bpfP = ctx.process && ctx.process.id ? loadBpf(ctx.process.id) : Promise.resolve(null);
    const metaP = track('meta', loadMeta(ctx.entity, ctx.lcid || 1033), (m) => plural(Object.keys(m.attr).length, 'column', 'columns') + ', ' + Object.keys(m.options).length + ' with choices');
    // A failure is met by the await below that needs it; none goes unheard.
    for (const p of [formsP, viewsP, recordP, metaP]) p.catch(() => {});
    const meta = await metaP;
    const [forms, record] = await Promise.all([formsP, recordP]);
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
    await resolveViews(dump, viewIds, viewsP);
    if (dump.process) dump.process.definition = definitionOf(await bpfP, dump, meta, ctx.lcid || 1033);
    dump.layout = layoutOf(dump);
    return { dump: dump, logic: logic };
  }

  /* Scripts, business rules, automations - a promise, never a rejection: a
   * failure costs the logic views, never the form. What the tab reads later
   * in the background (cloud flows, the ribbon) is started here too, so it
   * is on its way while the form is drawn. */
  function loadLogic(ctx, meta, dump, form, forms, noCommands) {
    dump.logic = null;
    const FL = DynaBoost.formLogic;
    FL.prefetch(dump.entity.logicalName, dump.entity.entitySetName);
    if (DynaBoost.formCommands && !noCommands) DynaBoost.formCommands.prefetch(dump.entity.logicalName);
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

  /* A field's value in two parts: its first line - the value - and what
   * opens under it (a lookup's id, the options), so Edit can stand on the
   * first line, next to the value. */
  function valueParts(c) {
    if (c.lookup !== undefined) {
      if (!c.lookup) return { head: '<span class="nil">empty</span>', rest: '' };
      return {
        head:
          (c.lookup.url
            ? '<a class="lk" href="' + esc(c.lookup.url) + '" target="_blank" rel="noopener">' + esc(c.lookup.name || c.lookup.id) + '</a>'
            : '<span class="lk-dead">' + esc(c.lookup.name || c.lookup.id) + '</span>') +
          ' <code class="ent">' + esc(c.lookup.entity || '?') + '</code>' +
          (c.lookup.entity ? '<button type="button" class="mini" data-dump="' + esc(c.lookup.entity) + '|' + esc(c.lookup.id) + '">Open as JSON</button>' : ''),
        rest: '<div class="sub"><code>' + esc(c.lookup.id) + '</code>' + (c.lookup.note ? ' — ' + esc(c.lookup.note) : '') + '</div>'
      };
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
      return { head: head + '<button type="button" class="mini" data-opts>' + c.choice.options.length + ' options</button>', rest: '<table class="opts" hidden>' + rows + '</table>' };
    }
    if (c.value === undefined) return { head: '<span class="nil">–</span>', rest: '' };
    if (isEmpty(c.value)) return { head: '<span class="nil">empty</span>', rest: '' };
    if (!isEmpty(c.formatted) && String(c.formatted) !== String(c.value)) {
      return { head: esc(c.formatted), rest: '<div class="sub"><code>' + esc(c.value) + '</code></div>' };
    }
    return { head: '<span class="txt">' + esc(c.value) + '</span>', rest: '' };
  }

  function valueHtml(c) {
    const v = valueParts(c);
    return v.head + v.rest;
  }

  function badges(c) {
    const b = [];
    if (c.visibility) b.push('<span class="bd">' + esc(c.visibility) + '</span>');
    if (c.disabled) b.push('<span class="bd">read-only</span>');
    if (c.required || c.requiredLevel === 'ApplicationRequired' || c.requiredLevel === 'SystemRequired') b.push('<span class="bd req">required</span>');
    if (c.unsavedChanges) b.push('<span class="bd warn">unsaved</span>');
    return b.join('');
  }

  function typeText(c) {
    if (c.kind === 'step') return c.entity ? 'on ' + c.entity : 'step';
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

  // Per column: the stages of the business process it is in, set by wire().
  let IN_PROCESS = Object.create(null);

  // A saved record's fields get Edit (form-field-edit.js); set by wire().
  let EDIT = null; // { primary } or null

  function editHtml(c) {
    if (!EDIT || c.kind !== 'field' || !c.field || c.field === EDIT.primary || !DynaBoost.fieldEdit) return '';
    return '<button type="button" class="mini fe-edit" data-field-edit="' + esc(c.field) + '" title="Change the saved value in a window of its own">Edit</button>';
  }

  // A field's value cell: Edit right after the value, on its first line -
  // what opens under the value (the options, a lookup's id) never moves it.
  function valueCell(c) {
    const edit = editHtml(c);
    if (!edit) return valueHtml(c);
    const v = valueParts(c);
    return '<div class="val-h"><div class="val-v">' + v.head + '</div>' + edit + '</div>' + v.rest;
  }

  function processIndex(dump) {
    const out = Object.create(null);
    if (!dump.process) return out;
    dump.process.stages.forEach((s, j) => {
      for (const c of s.controls) if (c.kind === 'field') (out[c.field] = out[c.field] || []).push({ j: j, stage: s.label || s.name, required: !!c.required });
    });
    return out;
  }

  /* The process icon on a column of the form that is also in the business
   * process; a click opens its stage in the process bar. */
  function bpfTag(c, dump) {
    const at = c.field ? IN_PROCESS[c.field] : null;
    if (!at) return '';
    const title = 'In the business process' + (dump.process.name ? ' ' + dump.process.name : '') + ': ' + at.map((x) => x.stage + (x.required ? ' (required)' : '')).join(', ') + ' - click to open the stage';
    return '<span class="bpf-tag" role="button" tabindex="0" data-bpf="' + at[0].j + '" title="' + esc(title) + '">' + DynaBoost.formLogic.icon('bpf') + '</span>';
  }

  function markOf(c) {
    return c.field ? MARKS[c.field] || null : null;
  }

  // Where a column's logic icons go; redrawn in place when cloud flows arrive.
  function markSlot(mk, field, label) {
    return '<span class="lg-slot" data-label="' + esc(label || '') + '">' + DynaBoost.formLogic.markHtml(mk, field, label) + '</span>';
  }

  function rowHtml(c, tag, off) {
    const mk = markOf(c);
    const search = [c.label, c.field, c.id, c.displayName, c.formatted, c.value, c.kind].filter((x) => x != null).join(' ').toLowerCase();
    const empty = c.kind === 'field' && (c.value === undefined || isEmpty(c.value)) && !c.lookup;
    const hidden = !!c.visibility && c.visibility !== 'shown by script';
    return (
      '<div class="row' + (hidden ? ' hid' : '') + (mk ? ' lg-has' : '') + '"' +
      (c.field ? ' data-field="' + esc(c.field) + '" data-m="' + esc(DynaBoost.formLogic.markSearch(mk)) + '"' : '') +
      ' data-s="' + esc(search) + '"' + (empty ? ' data-empty="1"' : '') + (off ? ' data-off="1"' : '') + '>' +
      '<div class="lbl">' + esc(c.label || c.displayName || c.id) + badges(c) + (tag || '') + (c.field ? markSlot(mk, c.field, c.label || c.displayName) : '') + '<div class="sub"><code>' + esc(c.field || c.id || '') + '</code></div></div>' +
      '<div class="typ">' + esc(typeText(c)) + '</div>' +
      '<div class="val">' + (c.kind === 'field' ? valueCell(c) : otherHtml(c)) + '</div>' +
      '</div>'
    );
  }

  function sectionHtml(s, anchor, dump) {
    const hidden = !!s.visibility && s.visibility !== 'shown by script';
    return (
      '<div class="sec' + (hidden ? ' hid' : '') + '" id="' + esc(anchor) + '">' +
      '<h3>' + esc(s.label || s.name) + (s.visibility ? '<span class="bd">' + esc(s.visibility) + '</span>' : '') + '<code>' + esc(s.name) + '</code></h3>' +
      (s.controls.length ? s.controls.map((c) => rowHtml(c, dump ? bpfTag(c, dump) : '')).join('') : '<div class="row"><div class="lbl nil">no controls</div></div>') +
      '</div>'
    );
  }

  function tabHtml(t, i, dump) {
    const hidden = !!t.visibility && t.visibility !== 'shown by script';
    return (
      '<section class="tab' + (hidden ? ' hid' : '') + '" id="t' + i + '">' +
      '<h2>' + esc(t.label || t.name) + (t.visibility ? '<span class="bd">' + esc(t.visibility) + '</span>' : '') + '<code>' + esc(t.name) + '</code></h2>' +
      t.sections.map((s, j) => sectionHtml(s, 't' + i + 's' + j, dump)).join('') +
      '</section>'
    );
  }

  /* The business process flow as a bar, as the form shows it: the stages in
   * order, the active one marked. A click on a stage opens its fields under
   * the bar, in place; the same stage, or the bar's name, closes them. While
   * the filter has words, every stage with a match is open. */
  function processHtml(dump) {
    const p = dump.process;
    const other = (s) => s.entity && s.entity !== dump.entity.logicalName;
    const path = p.stages
      .map(
        (s, j) =>
          '<button type="button" class="bpf-st' + (s.active ? ' act' : '') + (s.offPath ? ' off' : '') + '" data-bpf="' + j + '" aria-pressed="false"' +
          (s.active ? ' title="The record\'s active stage"' : s.offPath ? ' title="On a branch this record does not take, as its values are now"' : '') + '>' +
          '<span class="bpf-n">' + (j + 1) + '</span>' + esc(s.label || s.name) +
          (other(s) ? '<code>' + esc(s.entity) + '</code>' : '') + (s.active ? '<span class="bpf-act">active</span>' : '') +
          '<span class="bpf-c">' + s.controls.length + '</span></button>'
      )
      .join('<span class="bpf-sep">›</span>');
    const stages = p.stages
      .map(
        (s, j) =>
          '<div class="sec bpf" data-stage="' + j + '">' +
          '<h3><span class="bpf-n' + (s.active ? ' act' : '') + '">' + (j + 1) + '</span>' + esc(s.label || s.name) + (s.active ? '<span class="bd stage">active stage</span>' : '') + (other(s) ? '<code>' + esc(s.entity) + '</code>' : '') + '</h3>' +
          (s.controls.length ? s.controls.map((c) => rowHtml(c)).join('') : '<div class="row"><div class="lbl nil">no steps</div></div>') +
          '</div>'
      )
      .join('');
    return (
      '<section class="bpf-card" id="bpf">' +
      '<div class="bpf-bar"><button type="button" class="bpf-toggle" data-bpf-toggle aria-expanded="false" title="Show or hide the fields of a stage">' +
      DynaBoost.formLogic.icon('bpf') + '<b>Business process</b>' + (p.name ? '<span class="bpf-name">' + esc(p.name) + '</span>' : '') +
      (p.status && p.status !== 'active' ? '<span class="bd">' + esc(p.status) + '</span>' : '') + '<span class="bpf-chev" aria-hidden="true"></span></button>' +
      '<div class="bpf-path">' + path + '</div><span class="bpf-tools" data-bpf-tools></span></div>' +
      rulesHtml(p.definition) +
      '<div class="bpf-others" data-bpf-others></div>' +
      '<div class="bpf-body">' + stages + '</div></section>'
    );
  }

  /* The bar's tools, once the logic is read: Edit in... for the record's
   * process (it opens the designer in a solution), and the table's other process
   * flows under "n other processes" - Automations no longer lists them. A
   * record with no process still gets a slim bar when the table has some. */
  function processTools(doc, dump, logic, ctx) {
    const wfs = logic && logic.automations && Array.isArray(logic.automations.workflows) ? logic.automations.workflows : [];
    const all = wfs.filter((w) => w.kind === 'Business process flow');
    const cur = dump.process ? clean(dump.process.id) : '';
    const others = all.filter((w) => clean(w.id) !== cur);
    // No process from the page: none on the record - or not said, so not known.
    const unknown = !dump.process && ctx && (ctx.fromAddress || ctx.processNotLoaded);
    // The table has process flows but the page named none: perhaps not on
    // the form yet - asked again for a while before "none on this record".
    if (all.length && !dump.process && !unknown && !doc.getElementById('bpf')) waitForProcess(doc.defaultView, dump, ctx, true);
    let card = doc.getElementById('bpf');
    if (!card) {
      if (!all.length && !unknown) return;
      const why = !unknown
        ? 'none on this record'
        : ctx.fromAddress
        ? 'not read - the page did not answer in time'
        : 'not read - not loaded in the page yet';
      const view = doc.getElementById('v-form');
      view.insertAdjacentHTML(
        'afterbegin',
        '<section class="bpf-card" id="bpf"><div class="bpf-bar"><span class="bpf-toggle">' + DynaBoost.formLogic.icon('bpf') + '<b>Business process</b><span class="bpf-name">' + why + '</span>' +
          (unknown ? '<button type="button" class="mini" data-bpf-reread title="Ask the page again and draw the form anew">Read again</button>' : '') +
          '</span><span class="bpf-tools" data-bpf-tools></span></div><div class="bpf-others" data-bpf-others></div></section>'
      );
      card = doc.getElementById('bpf');
    }
    const more = others.length
      ? '<button type="button" class="mini" data-bpf-more aria-expanded="false">' + others.length + (cur ? ' other' : '') + (others.length === 1 ? ' process' : ' processes') + (cur ? '' : ' on this table') + '</button>'
      : '';
    card.querySelector('[data-bpf-tools]').innerHTML =
      (cur ? '<button type="button" class="mini" data-edit="' + esc('workflow|' + cur + '|' + (dump.process.name || '')) + '">Edit in…</button>' : '') + more;
    card.querySelector('[data-bpf-others]').innerHTML = others
      .map(
        (w) =>
          '<div class="bpf-other">' + DynaBoost.formLogic.icon('bpf') + '<a href="#" data-open="' + esc('process|' + w.id) + '">' + esc(w.name) + '</a>' +
          '<span class="bd">' + (w.active ? 'on' : 'off') + '</span>' +
          '<button type="button" class="mini" data-edit="' + esc('workflow|' + w.id + '|' + w.name) + '">Edit in…</button></div>'
      )
      .join('');
  }

  /* The page has the process bar but not its process yet - on a large table
   * Dynamics can take a while. The tab says so where the bar goes, with the
   * golden squares and the seconds, and keeps asking the page; once the
   * process is there the form is drawn again with it - in the same view, at
   * the same place - with no Read again and no reload. After PROCESS_WAIT it
   * stops asking and offers Read again. */
  const PROCESS_WAIT = 90000;
  /* The same when the page said nothing of a process - not even its bar - on
   * a table that has process flows: the bar may simply not be on the form
   * yet. Then it asks for PROCESS_CHECK and, with no process by then, says
   * "none on this record". */
  const PROCESS_CHECK = 20000;
  function waitForProcess(tab, dump, ctx, check) {
    const doc = tab.document;
    const view = doc.getElementById('v-form');
    if (!view || doc.getElementById('bpf')) return;
    const limit = check ? PROCESS_CHECK : PROCESS_WAIT;
    view.insertAdjacentHTML(
      'afterbegin',
      '<section class="bpf-card bpf-waiting" id="bpf"><div class="bpf-bar"><span class="bpf-toggle">' + DynaBoost.status.html('busy') +
        '<b>Business process</b><span class="bpf-name">' + (check ? 'checking with the page' : 'waiting for the page to load it') + '<span id="bpf-wait"></span></span></span>' +
        '<span class="bpf-tools" data-bpf-tools></span></div><div class="bpf-others" data-bpf-others></div></section>'
    );
    const gen = tab.__dbFormGen;
    const mine = () => !tab.closed && tab.__dbFormGen === gen;
    const t0 = Date.now();
    const clock = setInterval(() => {
      const w = mine() && doc.getElementById('bpf-wait');
      if (!w) return clearInterval(clock);
      w.textContent = ' · ' + Math.round((Date.now() - t0) / 1000) + ' s';
    }, 1000);
    const giveUp = () => {
      clearInterval(clock);
      const card = doc.getElementById('bpf');
      if (!card) return;
      card.classList.remove('bpf-waiting');
      card.querySelector('.bpf-toggle').innerHTML = check
        ? DynaBoost.formLogic.icon('bpf') + '<b>Business process</b><span class="bpf-name">none on this record</span>'
        : DynaBoost.formLogic.icon('bpf') + '<b>Business process</b><span class="bpf-name">not loaded in the page after ' + PROCESS_WAIT / 1000 + ' s</span>' +
          '<button type="button" class="mini" data-bpf-reread title="Ask the page again and draw the form anew">Read again</button>';
    };
    const ask = async () => {
      if (!mine()) return clearInterval(clock);
      const c = await pageContext(1500);
      if (!mine()) return clearInterval(clock);
      // The same record still open in the page, now with its process.
      if (c && c.entity === ctx.entity && (!ctx.id || !c.id || clean(c.id) === clean(ctx.id)) && c.process) {
        clearInterval(clock);
        // The same view and place once it is drawn again.
        const scroller = doc.getElementById('content');
        const back = { view: (doc.body.className.match(/\bview-(\w+)/) || [])[1], top: scroller ? scroller.scrollTop : 0 };
        fillTab(tab, Object.assign({}, c, { formId: dump.form.id, back: back }));
        return;
      }
      if (Date.now() - t0 >= limit) return giveUp();
      setTimeout(ask, 1500);
    };
    setTimeout(ask, 1500);
  }

  // Under the bar: where the process branches, on what - from its definition.
  function rulesHtml(def) {
    if (!def) return '';
    if (def.error) return '<div class="bpf-rules"><span class="bpf-why">' + esc(def.error) + '</span></div>';
    // The next stage as on the bar - its number in a circle, its name - a click opens it.
    const to = (t) => {
      if (!t) return '<span class="bpf-arrow">→</span><span class="bpf-why">where it goes is not read yet</span>';
      const m = String(t).match(/^(\d+)\. (.*)$/);
      const chip = m
        ? '<button type="button" class="bpf-go" data-bpf-go="' + (Number(m[1]) - 1) + '" title="Open this stage"><span class="bpf-n">' + m[1] + '</span>' + esc(m[2]) + '</button>'
        : '<span class="bpf-go">' + esc(t) + '</span>';
      return '<span class="bpf-arrow">→</span>' + chip;
    };
    const lines = (def.branches || []).map(
      (b) =>
        '<div class="bpf-rule"><span class="bpf-fork">⑂</span><div>' +
        (b.after ? '<b>After ' + esc(b.after) + '</b>' : '<b>A branch</b>') +
        b.rules.map((r, i) => '<div class="bpf-if">' + (i ? 'else if ' : 'if ') + esc(r.if) + ' ' + to(r.then) + '</div>').join('') +
        (b.otherwise ? '<div class="bpf-if">otherwise ' + to(b.otherwise) + '</div>' : '') +
        '</div></div>'
    );
    if (def.notUnderstood) lines.push('<div class="bpf-rule bpf-why">Parts of the definition not read yet: ' + esc(def.notUnderstood.join(', ')) + '</div>');
    return lines.length ? '<div class="bpf-rules">' + lines.join('') + '</div>' : '';
  }

  function formViewHtml(dump) {
    const parts = [];
    // The process bar first, as on the form; the header under it.
    if (dump.process) parts.push(processHtml(dump));
    if (dump.header.length) parts.push('<section class="tab" id="hdr"><h2>Header</h2>' + dump.header.map((s, j) => sectionHtml(s, 'hdrs' + j, dump)).join('') + '</section>');
    parts.push(dump.tabs.map((t, i) => tabHtml(t, i, dump)).join(''));
    if (dump.footer.length) parts.push('<section class="tab" id="ftr"><h2>Footer</h2>' + dump.footer.map((s, j) => sectionHtml(s, 'ftrs' + j, dump)).join('') + '</section>');
    // The entity's other columns, behind the "whole entity" switch.
    if (dump.columnsNotOnForm.length) {
      parts.push(
        '<section class="tab" id="off" data-off="1"><h2>Not on this form</h2><div class="sec" id="offs">' +
          dump.columnsNotOnForm.map((c) => rowHtml(Object.assign({ kind: 'field' }, c), '', true)).join('') +
          '</div></section>'
      );
    }
    return parts.join('');
  }

  function navHtml(dump) {
    const items = [];
    if (dump.process) items.push('<a href="#bpf">Business process<span class="n">' + dump.process.stages.reduce((a, s) => a + s.controls.length, 0) + '</span></a>');
    if (dump.header.length) items.push('<a href="#hdr">Header</a>');
    dump.tabs.forEach((t, i) => {
      const n = t.sections.reduce((a, s) => a + s.controls.length, 0);
      items.push('<a href="#t' + i + '"' + (t.visibility ? ' class="hid"' : '') + '>' + esc(t.label || t.name) + '<span class="n">' + n + '</span></a>');
      t.sections.forEach((s, j) => {
        items.push('<a class="s' + (s.visibility ? ' hid' : '') + '" href="#t' + i + 's' + j + '">' + esc(s.label || s.name) + '<span class="n">' + s.controls.length + '</span></a>');
      });
    });
    if (dump.footer.length) items.push('<a href="#ftr">Footer</a>');
    if (dump.columnsNotOnForm.length) items.push('<a href="#off" data-off="1">Not on this form<span class="n">' + dump.columnsNotOnForm.length + '</span></a>');
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
          '<div class="lbl"><code>' + esc(c.field) + '</code>' + badges(c) + bpfTag(c, dump) + markSlot(mk, c.field, c.displayName) + '<div class="sub">' + esc(c.displayName || '') + '</div></div>' +
          '<div class="typ">' + esc(typeText(c)) + '</div>' +
          '<div class="val">' + valueCell(c) + '</div>' +
          '<div class="whr">' + (where ? where.map(esc).join('<br>') : '<span class="nil">not on form</span>') + '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  // The JSON, coloured, in blocks of 200 lines (see #json .jc).
  function jsonHtml(text) {
    const lines = DynaBoost.code.html(text, 'json').split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i += 200) out.push('<div class="jc">' + lines.slice(i, i + 200).join('\n') + '</div>');
    return out.join('');
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
          '<div class="card" data-field="' + esc(field) + '" data-s="' + esc(search) + '"' + (ch.onForm ? '' : ' data-off="1"') + '>' +
          '<h3>' + esc(ch.displayName || field) + '<code>' + esc(field) + '</code><span class="kind">' + esc(ch.kind) + '</span></h3>' +
          '<div class="picked">' + picked + (ch.onForm ? '' : ' <span class="bd">not on form</span>') + '</div>' +
          '<table class="opts open">' + rows + '</table>' +
          '</div>'
        );
      })
      .join('');
  }

  // The tab's look - shared with Compare with... and Compare records
  // (env-compare.js), so the three read alike.
  const PAGE_CSS =
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
    'button.icon{width:36px;height:36px;padding:0;display:inline-flex;align-items:center;justify-content:center}button.icon svg{width:19px;height:19px}' +
    'button.db-ok{border-color:var(--dbc-bd-1c6b32);color:var(--dbc-fg-1c6b32);background:var(--dbc-bg-e4f4e8)}' +
    'button.db-bad{border-color:var(--dbc-bd-a11a1a);color:var(--dbc-fg-a11a1a);background:var(--dbc-bg-fde8e8)}' +
    // A switch of views: hairlines between the buttons, the open one in
    // the blue tint with a blue line under it - no filled navy.
    '.seg{display:inline-flex;box-sizing:border-box;height:36px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;overflow:hidden;background:var(--dbc-bg-fff)}' +
    '.seg button{height:34px;border:0;border-radius:0;padding:0 14px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e)}' +
    '.seg button+button{border-left:1px solid var(--dbc-bd-dde3f0)}' +
    '.seg button:hover{background:var(--dbc-bg-f5f7fc);color:var(--dbc-fg-1e6bff)}' +
    '.seg button[aria-pressed="true"]{background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-1e6bff);box-shadow:inset 0 -2px 0 var(--dbc-bd-1e6bff)}' +
    '.bar input[type=search]{margin-left:auto;padding:0 11px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;font:inherit;min-width:220px}' +
    '.bar select{padding:0 9px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;font:inherit;background:var(--dbc-bg-fff);max-width:260px}' +
    // One height for everything in the bar; the selected one changes colour,
    // never its size - nothing next to it moves.
    '.bar>button,.bar select,.bar input[type=search]{box-sizing:border-box;height:36px}.bar>button{padding-top:0;padding-bottom:0}' +
    'input[type=checkbox]{width:14px;height:14px;margin:0;accent-color:var(--dbc-bd-1e6bff);cursor:pointer}' +
    '.bar select:hover{border-color:var(--dbc-bd-1e6bff)}' +
    '.bar label{font-size:13px;color:var(--dbc-fg-56637f);display:flex;align-items:center;gap:6px;cursor:pointer}' +
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
    // The columns and the filter: for the Form, Fields and Choices views only.
    'body.view-scripts .flt,body.view-rules .flt,body.view-automations .flt,body.view-commands .flt,body.view-json .fbtn,body.view-json .fchips{opacity:.4;pointer-events:none}' +
    '.flt{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:0 0 12px;position:relative}' +
    '.flt .seg{height:32px}.flt .seg button{height:30px;padding:0 11px;font-size:13px}' +
    '.flt .seg button:disabled{opacity:.45;cursor:default;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e)}' +
    '.flt .c{margin-left:6px;padding:0 6px;border-radius:8px;background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f);font-size:11px;font-weight:600}' +
    '.flt .seg button[aria-pressed="true"] .c{background:var(--dbc-bg-fff);color:var(--dbc-fg-1e6bff)}' +
    '.fbtn{display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;height:32px;padding:0 11px;font-size:13px}' +
    '.fbtn svg{width:14px;height:14px}' +
    '.fbtn.on,.fbtn[aria-expanded="true"]{border-color:var(--dbc-bd-1e6bff);background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-1e6bff)}' +
    '.fbadge{padding:0 6px;border-radius:8px;background:var(--dbc-bg-1e6bff);color:var(--dbc-fg-fff);font-size:11px;font-weight:700;line-height:16px}' +
    '.fchips{display:contents}' +
    '.fchip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 6px 0 10px;border:1px solid var(--dbc-bd-e3b04b);border-radius:13px;background:var(--dbc-bg-fffaf0);color:var(--dbc-fg-10224e);font-size:12.5px}' +
    '.fchip:hover{border-color:var(--dbc-bd-9a6a12);color:var(--dbc-fg-10224e)}' +
    '.fchip i{font-style:normal;color:var(--dbc-fg-9a6a12);font-size:14px;line-height:1}' +
    '.fclear{border:0;background:none;padding:0 4px;color:var(--dbc-fg-1e6bff);font-size:12.5px}.fclear:hover{text-decoration:underline}' +
    '.fres{margin-left:auto;color:var(--dbc-fg-56637f);font-size:12.5px}' +
    '.fpop{position:fixed;z-index:30;width:400px;max-width:calc(100vw - 24px);padding:6px 14px 12px;border:1px solid var(--dbc-bd-dde3f0);border-radius:10px;background:var(--dbc-bg-fff);box-shadow:0 12px 32px rgba(10,23,56,.18)}' +
    '.fpop h4{margin:10px 0 6px;color:var(--dbc-fg-56637f);font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase}' +
    '.fopts{display:flex;flex-wrap:wrap;gap:6px}' +
    '.fopt{display:inline-flex;align-items:center;height:28px;padding:0 10px;border-radius:14px;font-size:12.5px}' +
    '.fopt .c{margin-left:6px;padding:0 6px;border-radius:8px;background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f);font-size:11px;font-weight:600}' +
    '.fopt[aria-pressed="true"]{border-color:var(--dbc-bd-1e6bff);background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-1e6bff)}.fopt[aria-pressed="true"] .c{background:var(--dbc-bg-fff);color:var(--dbc-fg-1e6bff)}' +
    '.fopt:disabled{opacity:.45;cursor:default}' +
    '.ffoot{display:flex;align-items:center;justify-content:space-between;margin-top:12px;padding-top:10px;border-top:1px solid var(--dbc-bd-dde3f0);color:var(--dbc-fg-56637f);font-size:12.5px}' +
    'body:not(.view-form) nav{display:none}' +
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
    // The business process bar: the stages as buttons - the open one in the
    // blue tint, as the open view; the record's active stage in the gold.
    // Open, the bar is tinted and its stage hangs under it.
    '.bpf-card{margin:0 0 22px;padding:10px 12px;background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px}' +
    '.bpf-card.open{background:var(--dbc-bg-f5f8ff);border-color:var(--dbc-bd-b9cdf5);box-shadow:0 2px 8px rgba(30,107,255,.08)}' +
    // Two rows: the name and the tools, then the stages.
    '.bpf-bar{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px 14px}' +
    '.bpf-bar>.bpf-toggle{grid-row:1;grid-column:1;justify-self:start}.bpf-bar>.bpf-tools{grid-row:1;grid-column:2}.bpf-bar>.bpf-path{grid-row:2;grid-column:1/-1}' +
    '.bpf-toggle{display:inline-flex;align-items:center;gap:8px;padding:5px 8px;border:0;background:none;color:var(--dbc-fg-10224e);font-size:13.5px}' +
    '.bpf-toggle:hover{background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-10224e)}.bpf-toggle b{font-weight:600}' +
    '.bpf-toggle .lg-i svg,.bpf-tag .lg-i svg{width:15px;height:15px}' +
    '.bpf-name{color:var(--dbc-fg-56637f)}' +
    '.bpf-waiting .bpf-toggle .db-st{flex:none}' +
    '.bpf-chev{width:7px;height:7px;margin:0 3px 0 0;border:solid var(--dbc-bd-56637f);border-width:0 1.6px 1.6px 0;transform:rotate(-45deg);transition:transform 120ms}' +
    '.bpf-card.open .bpf-chev{transform:rotate(45deg);margin:0 2px 3px 1px}' +
    '.bpf-path{display:flex;flex-wrap:wrap;align-items:center;gap:6px}' +
    '.bpf-st{display:inline-flex;align-items:center;gap:7px;padding:4px 10px 4px 5px;border:1px solid var(--dbc-bd-dde3f0);border-radius:16px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);font-size:13px}' +
    '.bpf-st:hover{border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-10224e)}.bpf-st code{font-size:11.5px}' +
    '.bpf-st[aria-pressed="true"]{border-color:var(--dbc-bd-1e6bff);background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-1e6bff);box-shadow:0 0 0 1px var(--dbc-bd-1e6bff)}' +
    '.bpf-st.hit{border-color:var(--dbc-bd-1e6bff);border-style:dashed}' +
    '.bpf-act{color:var(--dbc-fg-9a6a12);font-size:11px;font-weight:600}' +
    '.bpf-c{color:var(--dbc-fg-97a5c6);font-size:11.5px;font-weight:400}' +
    '.bpf-sep{color:var(--dbc-fg-97a5c6)}' +
    '.bpf-n{display:inline-flex;align-items:center;justify-content:center;flex:none;width:20px;height:20px;border-radius:50%;background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f);font-size:11.5px;font-weight:600}' +
    '.bpf-st.act .bpf-n,.bpf-n.act{background:var(--dbc-bg-e3b04b);color:var(--dbc-fg-3a2a05)}' +
    '.bpf-st.off{border-style:dashed;color:var(--dbc-fg-56637f)}.bpf-st.off .bpf-n{background:transparent;box-shadow:inset 0 0 0 1px var(--dbc-bd-c6d0e4)}' +
    '.bpf-rules{margin-top:9px;padding-top:7px;border-top:1px solid var(--dbc-bd-dde3f0);font-size:13px;color:var(--dbc-fg-10224e)}' +
    '.bpf-rule{display:flex;gap:8px;padding:2px 2px}.bpf-rule+.bpf-rule{margin-top:8px}.bpf-fork{flex:none;color:var(--dbc-fg-9a6a12);font-weight:600}' +
    '.bpf-rule b{font-weight:600}.bpf-if{display:flex;align-items:center;flex-wrap:wrap;gap:4px 6px;padding:2px 0 0 12px;line-height:1.5}' +
    '.bpf-arrow{color:var(--dbc-fg-9a6a12);font-weight:700}' +
    '.bpf-go{display:inline-flex;align-items:center;gap:6px;padding:1px 9px 1px 3px;border:1px solid var(--dbc-bd-e3b04b);border-radius:12px;background:var(--dbc-bg-fffaf0);color:var(--dbc-fg-10224e);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap}' +
    '.bpf-go:hover{background:var(--dbc-bg-fff3dc);border-color:var(--dbc-bd-9a6a12);color:var(--dbc-fg-10224e)}' +
    '.bpf-go .bpf-n{width:17px;height:17px;font-size:10.5px;background:var(--dbc-bg-fff3dc);color:var(--dbc-fg-9a6a12)}' +
    '.bpf-why{color:var(--dbc-fg-56637f);font-style:italic}' +
    '.bpf-tools{display:flex;align-items:center;gap:6px}' +
    '.bpf-tools .mini{margin-left:0}' +
    '.bpf-others{display:none;margin-top:10px;padding:6px 0 0;border-top:1px solid var(--dbc-bd-dde3f0);font-size:13px}' +
    '.bpf-card.others .bpf-others{display:block}' +
    '.bpf-other{display:flex;align-items:center;gap:8px;padding:4px 2px}' +
    '.bpf-other a{color:var(--dbc-fg-10224e);font-weight:600;text-decoration:none}.bpf-other a:hover{color:var(--dbc-fg-1e6bff);text-decoration:underline}' +
    '.bpf-body{display:none;margin-top:10px}.bpf-card.open .bpf-body,.bpf-card.searching .bpf-body{display:block}' +
    '.bpf-body .sec{margin-bottom:10px}.bpf-body .sec:last-child{margin-bottom:0}' +
    '.bpf-card:not(.searching) .sec.bpf:not(.sel){display:none}' +
    '.sec.bpf h3 .bpf-n{margin-right:8px;vertical-align:1px}' +
    '.bd.stage{background:var(--dbc-bg-fff3dc);color:var(--dbc-fg-9a6a12);box-shadow:inset 0 0 0 1px var(--dbc-bd-e3b04b);font-weight:600}' +
    '.bpf-tag{display:inline-flex;align-items:center;margin-left:8px;padding:3px 6px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:10px;background:var(--dbc-bg-fff);cursor:pointer;vertical-align:-3px}' +
    '.bpf-tag:hover,.bpf-tag:focus-visible{border-color:var(--dbc-bd-1e6bff);outline:none}' +
    '.row.bpf-flash{animation:bpf-flash 1.4s ease-out}' +
    '@keyframes bpf-flash{0%,30%{background:var(--dbc-bg-e9f1ff)}100%{background:transparent}}' +
    '.mini{margin-left:8px;padding:2px 8px;font-size:11.5px;border-radius:10px;color:var(--dbc-fg-56637f)}' +
    '.mini.db-ok,.mini.db-bad{padding:2px 8px}' +
    // Edit on a field: shown on the row under the pointer, or reached with Tab.
    '.val-h{display:flex;align-items:flex-start;gap:8px}.val-v{flex:0 1 auto;min-width:0}' +
    '.fe-edit{flex:none;margin:1px 0 0;opacity:0;transition:opacity 120ms}.row:hover .fe-edit,.fe-edit:focus-visible{opacity:1}' +
    'table.opts{margin-top:6px;border-collapse:collapse;font-size:12.5px}' +
    'table.opts td{padding:3px 10px 3px 0;border-top:1px solid var(--dbc-bd-edf1f8);vertical-align:top}' +
    'table.opts tr.on td{font-weight:600;color:var(--dbc-fg-10224e)}table.opts tr.on td:first-child::before{content:"● ";color:var(--dbc-fg-e3b04b)}' +
    'table.opts .st{color:var(--dbc-fg-97a5c6)}' +
    '.card{margin:0 0 12px;padding:10px 14px 12px;background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px}' +
    '.card h3{margin:0;font-size:13.5px}.card .kind{float:right;font-size:11.5px;color:var(--dbc-fg-97a5c6);font-weight:400}' +
    '.card .picked{margin:4px 0 2px;font-size:13px}' +
    '#json{margin:0;padding:14px 18px;background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px;font:12.5px/1.45 ui-monospace,Consolas,monospace;white-space:pre;overflow:auto;color:var(--dbc-fg-10224e)}' +
    // The JSON in blocks of 200 lines: the browser lays out only the ones in view.
    '#json .jc{content-visibility:auto;contain-intrinsic-block-size:auto 3625px}' +
    '.status{margin-left:8px;font-size:12.5px;color:var(--dbc-fg-56637f)}' +
    '@media (prefers-reduced-motion:no-preference){[data-opts]{transition:color 120ms}}';

  /* A column's type as the filter offers it - a few groups people look for,
   * the rest as Other. */
  const TYPE_GROUPS = ['Text', 'Number', 'Date', 'Yes/No', 'Choice', 'Lookup', 'Other'];
  function typeGroup(c) {
    const t = String(c.type || '').replace(/Type$/, '');
    if (/^(Lookup|Customer|Owner)$/.test(t) || c.targets) return 'Lookup';
    if (t === 'Boolean' || (c.choice && c.choice.kind === 'boolean')) return 'Yes/No';
    if (/Picklist$|^State$|^Status$/.test(t) || c.choice) return 'Choice';
    if (/^(String|Memo)$/.test(t)) return 'Text';
    if (/^(Integer|BigInt|Decimal|Double|Money)$/.test(t)) return 'Number';
    if (t === 'DateTime') return 'Date';
    return 'Other';
  }

  const FUNNEL =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h16l-6.2 7.4V18l-3.6 1.8v-7.4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';

  function pageHtml(dump) {
    const title = (dump.record && dump.record.name) || dump.entity.displayName || dump.entity.logicalName;
    const fieldCount = Object.keys(dump.choices).length;
    return (
      '<!doctype html><meta charset="utf-8"><title>' + esc(title) + ' — form</title>' +
      '<style>' +
      PAGE_CSS +
      DynaBoost.status.css +
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
      '<button class="primary" id="copy-shown" title="What is shown: the fields the filter leaves, as a table - in the JSON view the JSON">Copy</button>' +
      '<button id="copy-json" title="The whole form as JSON">Copy all</button>' +
      '<button class="icon" id="dl-json" title="Download the whole form as a .json file" aria-label="Download JSON">' + FLOPPY + '</button>' +
      '<span class="seg" role="group" aria-label="View">' +
      '<button id="v1" data-view="v1" aria-pressed="true">Form</button>' +
      '<button id="v2" data-view="v2" aria-pressed="false">Fields</button>' +
      '<button id="v3" data-view="v3" aria-pressed="false">Choices (' + fieldCount + ')</button>' +
      '<button id="v4" data-view="v4" aria-pressed="false">JSON</button></span>' +
      (dump.availableForms && dump.availableForms.length > 1
        ? '<select id="form-pick" title="Show a different main form">' +
          dump.availableForms
            .map((f) => '<option value="' + esc(f.id) + '"' + (f.current ? ' selected' : '') + '>' + esc(f.name) + ' (' + f.controls + ')</option>')
            .join('') +
          '</select>'
        : '') +
      '<input type="search" id="q" placeholder="Filter by name, label or value" title="/ puts the cursor here">' +
      '<span class="status" id="status"></span>' +
      '</div>' +
      // Which columns, and the filter: on the Form, Fields and Choices views.
      '<div class="flt" id="flt">' +
      '<span class="seg" role="group" aria-label="Columns">' +
      '<button data-where="on" aria-pressed="true" title="The columns this form shows">On form<span class="c" data-wc="on"></span></button>' +
      '<button data-where="off" aria-pressed="false" title="The table\u2019s columns this form does not show">Not on form<span class="c" data-wc="off"></span></button>' +
      '<button data-where="all" aria-pressed="false" title="Every column of the table">All columns<span class="c" data-wc="all"></span></button></span>' +
      '<button class="fbtn" id="fbtn" aria-expanded="false" aria-haspopup="true">' + FUNNEL + 'Filter<span class="fbadge" id="fbadge" hidden></span></button>' +
      '<span class="fchips" id="fchips"></span>' +
      '<span class="fres" id="fres"></span>' +
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

  // A value as one line of text, as the row shows it.
  function valueText(c) {
    if (c.lookup !== undefined) return c.lookup ? (c.lookup.name || c.lookup.id) + (c.lookup.entity ? ' (' + c.lookup.entity + ')' : '') : '';
    if (c.choice) {
      const sel = c.choice.selected;
      return sel === null || sel === undefined ? '' : (Array.isArray(sel) ? sel : [sel]).map((x) => x.label + ' (' + x.value + ')').join(', ');
    }
    if (c.value === undefined || isEmpty(c.value)) return '';
    const v = typeof c.value === 'object' ? JSON.stringify(c.value) : String(c.value);
    return !isEmpty(c.formatted) && String(c.formatted) !== v ? String(c.formatted) + ' (' + v + ')' : v;
  }
  const cellText = (t) => String(t == null ? '' : t).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

  /* What the open view shows, as text for the clipboard: Form and Fields -
   * the rows left by the filter and the words typed, each column once, as a
   * Markdown table (label, logical name, type, value, where it is); Choices -
   * the fields left, each with its options; a logic view - its text as it
   * stands. The JSON view's Copy gives the JSON (the caller). */
  function shownText(doc, dump) {
    const view = (/\bview-(\w+)/.exec(doc.body.className) || [])[1] || 'form';
    const box = doc.getElementById('v-' + view);
    if (!box) return '';
    const shown = (el) => {
      for (let n = el; n && n !== box; n = n.parentElement) if (n.style.display === 'none') return false;
      return true;
    };
    if (view === 'form' || view === 'fields') {
      const byField = new Map();
      const where = new Map();
      const put = (c, place) => {
        if (!c.field) return;
        if (!byField.has(c.field)) byField.set(c.field, c);
        if (place) where.set(c.field, (where.get(c.field) || []).concat(place));
      };
      for (const s of dump.header) for (const c of s.controls) put(c, 'Header');
      for (const t of dump.tabs) for (const s of t.sections) for (const c of s.controls) put(c, (t.label || t.name) + ' › ' + (s.label || s.name));
      for (const s of dump.footer) for (const c of s.controls) put(c, 'Footer');
      if (dump.process) for (const st of dump.process.stages) for (const c of st.controls) put(c, 'Process: ' + (st.label || st.name));
      for (const c of dump.columnsNotOnForm || []) put(c, '');
      const rows = [];
      const seen = new Set();
      box.querySelectorAll('.row[data-field]').forEach((el) => {
        const f = el.getAttribute('data-field');
        const c = byField.get(f);
        if (!c || seen.has(f) || !shown(el)) return;
        seen.add(f);
        rows.push('| ' + [c.displayName || c.label || f, f, typeText(c), valueText(c), (where.get(f) || []).join('; ') || 'not on form'].map(cellText).join(' | ') + ' |');
      });
      if (!rows.length) return '';
      return '**' + dump.entity.displayName + '** · form ' + dump.form.name + ' · ' + rows.length + ' column' + (rows.length === 1 ? '' : 's') + '\n\n| Column | Logical name | Type | Value | Where |\n|---|---|---|---|---|\n' + rows.join('\n');
    }
    if (view === 'choices') {
      const parts = [];
      box.querySelectorAll('.card[data-field]').forEach((el) => {
        const f = el.getAttribute('data-field');
        const ch = dump.choices[f];
        if (!ch || !shown(el)) return;
        const sel = ch.selected;
        const on = (o) => !!sel && (Array.isArray(sel) ? sel.some((x) => x.value === o.value) : sel.value === o.value);
        parts.push('**' + cellText(ch.displayName || f) + '** `' + f + '`\n' + ch.options.map((o) => '- ' + (on(o) ? '✓ ' : '') + cellText(o.label) + ' (' + o.value + ')' + (o.state !== undefined ? ' · state ' + o.state : '')).join('\n'));
      });
      return parts.join('\n\n');
    }
    return box.innerText.replace(/\n{3,}/g, '\n\n').trim();
  }

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
    const toJson = () => prettyJson(dump);
    /* The JSON view follows On form / Not on form / All columns: the form
     * without the record's other columns; only those (with their choices);
     * all of it. Copy all and the download always give all of it. */
    const jsonFor = (w) => {
      if (w === 'all') return toJson();
      if (w === 'on') return prettyJson(Object.assign({}, dump, { columnsNotOnForm: undefined }));
      const off = new Set(dump.columnsNotOnForm.map((c) => c.field));
      const choices = {};
      for (const f of Object.keys(dump.choices)) if (off.has(f)) choices[f] = dump.choices[f];
      return prettyJson({ about: ABOUT, generatedAt: dump.generatedAt, environment: dump.environment, entity: dump.entity, record: dump.record, form: dump.form, columnsNotOnForm: dump.columnsNotOnForm, choices: choices });
    };
    const json = toJson();
    const safeName = ((dump.record && dump.record.name) || dump.entity.logicalName).replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 60);

    MARKS = Object.create(null);
    IN_PROCESS = processIndex(dump);
    EDIT = dump.record && dump.record.id ? { primary: dump.entity.primaryId } : null;
    get('nav').innerHTML = navHtml(dump);
    get('v-form').innerHTML = formViewHtml(dump);
    get('v-fields').innerHTML = fieldsViewHtml(dump);
    get('v-choices').innerHTML = choicesViewHtml(dump);

    /* The JSON is drawn when its view is opened, and again only when it
     * changed - not each time the logic, the flows or the commands arrive
     * behind it. A large JSON drawn at once held the tab for seconds. */
    let jsonDrawn = false;
    const drawJson = () => {
      get('json').innerHTML = jsonHtml(jsonFor(where));
      jsonDrawn = true;
    };
    const jsonChanged = () => {
      jsonDrawn = false;
      if (current === 'v4') drawJson();
    };

    let current = 'v1';
    const showView = (id) => {
      if (!VIEWS[id]) return;
      if (id !== current) get('content').scrollTop = 0;
      current = id;
      if (id === 'v4' && !jsonDrawn) drawJson();
      doc.body.className = (doc.body.className.replace(/\bview-\w+/g, '') + ' view-' + VIEWS[id]).trim().replace(/\s+/g, ' ');
      doc.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === id)));
    };

    get('status').textContent = (json.length / 1024).toFixed(0) + ' KB of JSON';

    get('copy-json').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const ok = await copyInto(tab, toJson());
      flash(btn, ok ? 'Copied' : 'Copy failed — use the JSON view', ok);
    });
    // Copy: what the view shows - the fields the filter leaves as a table, the
    // choices with their options, the JSON, a logic view's text.
    get('copy-shown').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const text = /\bview-json\b/.test(doc.body.className) ? jsonFor(where) : shownText(doc, dump);
      if (!text) return flash(btn, 'Nothing shown', false);
      const ok = await copyInto(tab, text);
      flash(btn, ok ? 'Copied' : 'Copy failed — use the JSON view', ok);
    });
    get('dl-json').addEventListener('click', () => download(tab, toJson(), dump.entity.logicalName + '_' + safeName + '.json'));

    /* Which columns, and the filter. Every column once, with what it is: its
     * type, custom or system, required, hidden, read-only, a value or empty -
     * and whether this form shows it. Within a group any picked option will
     * do; across groups all must. An option's count is the columns it leaves,
     * the other groups as picked. The filter, the columns and the words typed
     * are one pass (apply), run by the search box's input event - so the
     * process bar, which listens to it too, follows. */
    const meta = metaCache.get(dump.entity.logicalName);
    const isRequired = (c) => !!c.required || c.requiredLevel === 'ApplicationRequired' || c.requiredLevel === 'SystemRequired';
    const facts = new Map(); // field -> { type, custom, required, hidden, readonly, empty, off }
    const note = (c, off) => {
      if (!c.field) return;
      const hidden = !!c.visibility && c.visibility !== 'shown by script';
      const was = facts.get(c.field);
      if (was) {
        was.hidden = was.hidden && hidden; // hidden only where every place hides it
        was.readonly = was.readonly || !!c.disabled;
        was.required = was.required || isRequired(c);
        return;
      }
      const a = meta && meta.attr[c.field];
      facts.set(c.field, {
        type: typeGroup(c),
        custom: !!(a && a.IsCustomAttribute),
        required: isRequired(c),
        hidden: hidden,
        readonly: !!c.disabled,
        empty: (c.value === undefined || isEmpty(c.value)) && !c.lookup,
        off: off
      });
    };
    eachControl(dump, (c) => c.kind === 'field' && note(c, false));
    dump.columnsNotOnForm.forEach((c) => note(c, true));
    Object.keys(dump.choices).forEach((f) => {
      const ch = dump.choices[f];
      if (!facts.has(f)) note({ field: f, type: ch.kind === 'boolean' ? 'BooleanType' : 'PicklistType', choice: ch, value: ch.selected ? 1 : null, requiredLevel: meta && meta.attr[f] && meta.attr[f].RequiredLevel ? meta.attr[f].RequiredLevel.Value : null }, !ch.onForm);
    });

    let where = 'on';
    const picked = { type: new Set(), made: new Set(), state: new Set() };
    const GROUPS = [
      { key: 'type', title: 'Type', options: TYPE_GROUPS.map((t) => [t, t]), test: (f, v) => f.type === v },
      { key: 'made', title: 'Made by', options: [['custom', 'Custom'], ['system', 'System']], test: (f, v) => (v === 'custom') === f.custom },
      { key: 'state', title: 'State', options: [['required', 'Required'], ['hidden', 'Hidden'], ['readonly', 'Read-only'], ['value', 'Has a value'], ['empty', 'Empty']], test: (f, v) => (v === 'value' ? !f.empty : !!f[v]) }
    ];
    const inWhere = (f, w) => (w === 'on' ? !f.off : w === 'off' ? f.off : true);
    const passes = (f, skip) => GROUPS.every((g) => g.key === skip || !picked[g.key].size || Array.from(picked[g.key]).some((v) => g.test(f, v)));
    const filtering = () => GROUPS.some((g) => picked[g.key].size > 0);
    const words = () => get('q').value.trim().toLowerCase();
    const narrowing = () => !!words() || filtering() || where === 'off';
    const run = () => get('q').dispatchEvent(new tab.Event('input'));

    // The columns the words typed find, in any view.
    function textHits(q) {
      if (!q) return null;
      const hit = new Set();
      doc.querySelectorAll('#v-form [data-field][data-s], #v-fields [data-field][data-s], #v-choices [data-field][data-s]').forEach((el) => {
        if ((el.getAttribute('data-s') + ' ' + (el.getAttribute('data-m') || '')).indexOf(q) >= 0) hit.add(el.getAttribute('data-field'));
      });
      return hit;
    }
    function count(hits, fn) {
      let n = 0;
      for (const [field, f] of facts) if ((!hits || hits.has(field)) && fn(f)) n++;
      return n;
    }
    const resultText = (hits) => {
      const n = count(hits, (f) => inWhere(f, where) && passes(f));
      const all = count(null, (f) => inWhere(f, where));
      return filtering() || hits ? n + ' of ' + all + ' columns' : all + ' column' + (all === 1 ? '' : 's');
    };
    const offAny = Array.from(facts.values()).some((f) => f.off);
    const offTitle = dump.record ? 'Every column of the table is on this form' : 'No record - only the form\u2019s own columns are known';

    function apply() {
      const q = words();
      const hits = textHits(q);
      const narrow = narrowing();
      doc.body.classList.toggle('whole-entity', where !== 'on');
      doc.querySelectorAll('[data-s]').forEach((el) => {
        let show = !q || (el.getAttribute('data-s') + ' ' + (el.getAttribute('data-m') || '')).indexOf(q) >= 0;
        if (show && el.closest('#v-form, #v-fields, #v-choices')) {
          const f = facts.get(el.getAttribute('data-field') || '');
          // Not a column (a subgrid, a web resource): there while no column filter is on.
          show = f ? inWhere(f, where) && passes(f) : !filtering() && where !== 'off';
        }
        el.style.display = show ? '' : 'none';
      });
      // A section, then a tab, with nothing left to show gets out of the way.
      const visible = (box) => Array.from(box.querySelectorAll('.row')).some((r) => r.style.display !== 'none');
      doc.querySelectorAll('#v-form .sec').forEach((sec) => (sec.style.display = narrow && !visible(sec) ? 'none' : ''));
      doc.querySelectorAll('#v-form section.tab').forEach((t) => (t.style.display = narrow && !visible(t) ? 'none' : ''));
      doc.querySelectorAll('#v-automations .lg-sec').forEach((sec) => {
        const any = Array.from(sec.querySelectorAll('.lg-r')).some((r) => r.style.display !== 'none');
        sec.style.display = q && !any ? 'none' : '';
      });
      // The list on the left follows - once the process bar has had its say.
      tab.setTimeout(() => {
        doc.querySelectorAll('#nav a[href^="#"]').forEach((a) => {
          const el = doc.getElementById(a.getAttribute('href').slice(1));
          a.style.display = el && el.style.display === 'none' ? 'none' : '';
        });
      }, 0);
      // The counts, the button, the picked ones as chips.
      for (const w of ['on', 'off', 'all']) {
        const b = doc.querySelector('[data-where="' + w + '"]');
        b.querySelector('.c').textContent = count(hits, (f) => inWhere(f, w) && passes(f));
        b.setAttribute('aria-pressed', String(w === where));
      }
      const offBtn = doc.querySelector('[data-where="off"]');
      offBtn.disabled = !offAny;
      if (!offAny) offBtn.title = offTitle;
      const n = GROUPS.reduce((a, g) => a + picked[g.key].size, 0);
      get('fbadge').hidden = !n;
      get('fbadge').textContent = n;
      get('fbtn').classList.toggle('on', n > 0);
      get('fchips').innerHTML =
        GROUPS.map((g) => g.options.filter(([v]) => picked[g.key].has(v)).map(([v, label]) => '<button class="fchip" data-un="' + g.key + '|' + esc(v) + '" title="Remove this filter">' + esc(label) + '<i>\u00d7</i></button>').join('')).join('') +
        (n ? '<button class="fclear" data-fclear>Clear all</button>' : '');
      get('fres').textContent = resultText(hits);
      drawPop(hits);
    }

    // The filter's window: the groups, each option with its count.
    let pop = null;
    function drawPop(hits) {
      if (!pop) return;
      pop.innerHTML =
        GROUPS.map((g) => {
          const opts = g.options
            .map(([v, label]) => {
              const on = picked[g.key].has(v);
              // A type the table has no column of is not offered at all.
              if (g.key === 'type' && !on && !count(null, (f) => g.test(f, v))) return '';
              const c = count(hits, (f) => inWhere(f, where) && passes(f, g.key) && g.test(f, v));
              return '<button class="fopt" data-opt="' + g.key + '|' + esc(v) + '" aria-pressed="' + on + '"' + (!c && !on ? ' disabled' : '') + '>' + esc(label) + '<span class="c">' + c + '</span></button>';
            })
            .join('');
          return '<h4>' + g.title + '</h4><div class="fopts">' + opts + '</div>';
        }).join('') +
        '<div class="ffoot"><button class="fclear" data-fclear' + (filtering() ? '' : ' hidden') + '>Clear all</button><span>' + esc(resultText(hits)) + '</span></div>';
    }
    function openPop() {
      pop = doc.createElement('div');
      pop.className = 'fpop';
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', 'Filter the columns');
      doc.body.appendChild(pop);
      const r = get('fbtn').getBoundingClientRect();
      pop.style.top = Math.round(r.bottom + 6) + 'px';
      pop.style.left = Math.round(Math.max(12, Math.min(r.left, tab.innerWidth - pop.offsetWidth - 12))) + 'px';
      get('fbtn').setAttribute('aria-expanded', 'true');
      drawPop(textHits(words()));
    }
    function closePop() {
      if (!pop) return;
      pop.remove();
      pop = null;
      get('fbtn').setAttribute('aria-expanded', 'false');
    }
    doc.addEventListener('click', (e) => {
      const t = e.target;
      if (pop && !t.closest('.fpop, #fbtn')) closePop();
      const w = t.closest('[data-where]');
      if (w && !w.disabled) {
        where = w.getAttribute('data-where');
        jsonChanged();
        return run();
      }
      if (t.closest('#fbtn')) return pop ? closePop() : openPop();
      const opt = t.closest('[data-opt], [data-un]');
      if (opt) {
        const [key, v] = (opt.getAttribute('data-opt') || opt.getAttribute('data-un')).split('|');
        if (picked[key].has(v)) picked[key].delete(v);
        else picked[key].add(v);
        return run();
      }
      if (t.closest('[data-fclear]')) {
        GROUPS.forEach((g) => picked[g.key].clear());
        return run();
      }
    });
    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && pop) closePop();
      // "/" puts the cursor in the filter, as on many sites.
      if (e.key === '/' && !e.ctrlKey && !e.altKey && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') && !(e.target && e.target.isContentEditable)) {
        e.preventDefault();
        get('q').focus();
        get('q').select();
      }
    });
    // From a script or a rule to its column (form-logic.js): what hides it, off.
    tab.__dbReveal = (row) => {
      const off = row.hasAttribute('data-off') && where === 'on';
      if (row.style.display !== 'none' && !off) return;
      GROUPS.forEach((g) => picked[g.key].clear());
      if (off || where === 'off') where = 'all';
      run();
    };

    const picker = get('form-pick');
    if (picker) {
      picker.addEventListener('change', (e) => {
        const chosen = e.target.value;
        get('status').textContent = 'Loading form\u2026';
        picker.disabled = true;
        fillTab(tab, Object.assign({}, ctx, { formId: chosen }));
      });
    }

    get('q').addEventListener('input', apply);
    apply();

    // The process bar: one stage open at a time, or none.
    const card = get('bpf');
    const activeStage = dump.process ? dump.process.stages.findIndex((s) => s.active) : -1;
    let stageOpen = -1;
    function pickStage(j) {
      if (!card) return;
      stageOpen = j;
      card.classList.toggle('open', j >= 0);
      card.querySelector('[data-bpf-toggle]').setAttribute('aria-expanded', String(j >= 0));
      card.querySelectorAll('.bpf-st').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-bpf')) === j)));
      card.querySelectorAll('.sec.bpf').forEach((sec) => sec.classList.toggle('sel', Number(sec.getAttribute('data-stage')) === j));
    }
    // From a column's process icon: its stage, open, the column flashed.
    function showStage(j, field) {
      if (!card) return;
      showView('v1');
      if (get('q').value) {
        get('q').value = '';
        get('q').dispatchEvent(new tab.Event('input'));
      }
      pickStage(j);
      card.scrollIntoView({ block: 'start' });
      const row = field && card.querySelector('.sec.bpf[data-stage="' + j + '"] .row[data-field="' + field + '"]');
      if (row) {
        row.classList.remove('bpf-flash');
        void row.offsetWidth;
        row.classList.add('bpf-flash');
      }
    }
    if (card) {
      // While the filter has words, every stage with a match is shown, its
      // button marked; no match at all, no bar.
      get('q').addEventListener('input', () => {
        const q = narrowing();
        card.classList.toggle('searching', !!q);
        let any = false;
        card.querySelectorAll('.sec.bpf').forEach((sec) => {
          const hit = !!q && sec.style.display !== 'none';
          if (hit) any = true;
          const pill = card.querySelector('.bpf-st[data-bpf="' + sec.getAttribute('data-stage') + '"]');
          if (pill) pill.classList.toggle('hit', hit);
        });
        card.style.display = q && !any ? 'none' : '';
      });
    }
    doc.addEventListener('keydown', (e) => {
      const tag = (e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('.bpf-tag');
      if (!tag) return;
      e.preventDefault();
      tag.click();
    });

    // A field of the form or, failing that, of the entity's other columns.
    function controlOf(field) {
      let hit = null;
      eachControl(dump, (c) => {
        if (!hit && c.kind === 'field' && c.field === field) hit = c;
      });
      return hit || dump.columnsNotOnForm.find((c) => c.field === field) || null;
    }

    /* A value saved in the Edit window: in the dump (every place the field
     * is - the JSON too), in its rows and in Choices, the rows flashed. */
    function fieldSaved(field, rec) {
      if (tab.closed) return;
      const meta = metaCache.get(dump.entity.logicalName);
      if (!meta) return;
      const fresh = describeField(field, meta, rec, Object.assign({}, ctx, { attributes: {} }));
      const put = (c) => {
        for (const k of ['value', 'formatted', 'lookup', 'choice', 'note']) {
          if (k in fresh) c[k] = fresh[k];
          else delete c[k];
        }
        delete c.unsavedChanges;
      };
      eachControl(dump, (c) => {
        if (c.kind === 'field' && c.field === field) put(c);
      });
      dump.columnsNotOnForm.forEach((c) => c.field === field && put(c));
      if (dump.choices[field] && fresh.choice) dump.choices[field].selected = fresh.choice.selected;
      const empty = (fresh.value === undefined || isEmpty(fresh.value)) && !fresh.lookup;
      if (facts.has(field)) facts.get(field).empty = empty;
      doc.querySelectorAll('.row[data-field="' + field + '"]').forEach((row) => {
        const cell = row.querySelector('.val');
        if (cell) cell.innerHTML = valueCell(Object.assign({}, fresh, { kind: 'field', field: field }));
        if (empty) row.setAttribute('data-empty', '1');
        else row.removeAttribute('data-empty');
        row.classList.remove('bpf-flash');
        void row.offsetWidth;
        row.classList.add('bpf-flash');
        // Once: a view shown again later does not play it again.
        row.addEventListener('animationend', () => row.classList.remove('bpf-flash'), { once: true });
      });
      if (dump.choices[field]) get('v-choices').innerHTML = choicesViewHtml(dump);
      jsonChanged();
      run();
    }

    doc.addEventListener('click', (e) => {
      const view = e.target.closest('[data-view]');
      if (view) {
        e.preventDefault();
        showView(view.getAttribute('data-view'));
        return;
      }
      // The page did not say its process: ask it again, draw the tab anew.
      const reread = e.target.closest('[data-bpf-reread]');
      if (reread) {
        reread.disabled = true;
        reread.textContent = 'Reading…';
        formContextWithProcess().then((c) => {
          if (tab.closed) return;
          if (!c || !c.entity) {
            reread.disabled = false;
            reread.textContent = 'The page did not answer - reload it (F5)';
            return;
          }
          get('status').textContent = 'Loading form\u2026';
          fillTab(tab, Object.assign({}, c, { formId: dump.form.id }));
        });
        return;
      }
      const go = e.target.closest('[data-bpf-go]');
      if (go) {
        pickStage(Number(go.getAttribute('data-bpf-go')));
        return;
      }
      const more = e.target.closest('[data-bpf-more]');
      if (more) {
        const box = more.closest('.bpf-card');
        more.setAttribute('aria-expanded', String(box.classList.toggle('others')));
        return;
      }
      if (e.target.closest('[data-bpf-toggle]')) {
        pickStage(stageOpen >= 0 ? -1 : Math.max(activeStage, 0));
        return;
      }
      const st = e.target.closest('.bpf-st');
      if (st) {
        const j = Number(st.getAttribute('data-bpf'));
        pickStage(stageOpen === j ? -1 : j);
        return;
      }
      const tag = e.target.closest('.bpf-tag');
      if (tag) {
        const row = tag.closest('[data-field]');
        showStage(Number(tag.getAttribute('data-bpf')), row ? row.getAttribute('data-field') : null);
        return;
      }
      const edit = e.target.closest('[data-field-edit]');
      if (edit && dump.record) {
        let field = edit.getAttribute('data-field-edit');
        // Status is changed with its reason: Edit on it opens Status Reason.
        if (field === 'statecode' && controlOf('statuscode')) field = 'statuscode';
        const c = controlOf(field);
        if (!c) return;
        DynaBoost.fieldEdit.open(tab, {
          entity: dump.entity.logicalName,
          setName: dump.entity.entitySetName,
          id: dump.record.id,
          recordName: dump.record.name,
          field: field,
          displayName: c.displayName || c.label,
          onForm: !dump.columnsNotOnForm.some((x) => x.field === field),
          choice: c.choice || null,
          states: dump.choices.statecode ? dump.choices.statecode.options : null,
          onSaved: (rec) => {
            fieldSaved(field, rec);
            if (field === 'statuscode' && 'statecode' in rec) fieldSaved('statecode', rec);
          }
        });
        return;
      }
      const opts = e.target.closest('[data-opts]');
      if (opts) {
        const table = opts.closest('.val') ? opts.closest('.val').querySelector('table.opts') : opts.nextElementSibling;
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
      jsonChanged();
      if (get('q').value) get('q').dispatchEvent(new tab.Event('input'));
    };

    // The form picker redraws the tab for another form: logic that lands
    // after that belongs to a page that is gone.
    const gen = (tab.__dbFormGen = (tab.__dbFormGen || 0) + 1);
    // Drawn again once the page's process came: the view and place as they were.
    if (ctx.back) {
      const id = Object.keys(VIEWS).find((k) => VIEWS[k] === ctx.back.view);
      if (id) showView(id);
      get('content').scrollTop = ctx.back.top || 0;
      delete ctx.back;
    }
    if (ctx.processNotLoaded && !dump.process) waitForProcess(tab, dump, ctx);
    Promise.resolve(logicPromise).then((lg) => {
      if (tab.closed || tab.__dbFormGen !== gen) return;
      dump.logic = lg || null;
      if (!lg || lg.error) {
        get('lg-sum').innerHTML = '<div class="lg-sum"><span class="lg-sum-h">Logic</span><span class="lg-dim">could not be read: ' + esc(lg && lg.error) + '</span></div>';
        jsonChanged();
        return;
      }
      logic = lg;
      processTools(doc, dump, logic, ctx);
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

  // ---------- while it reads ----------

  /* The steps of a read, in the tab while it reads: what is being read, each
   * ticked with what it found or crossed with why not - side by side, so they
   * tick in any order. The page's own answer comes first: it says whether
   * the form, its hidden parts and the business process were seen. */
  const STEP_NAMES = {
    page: 'The form on the page',
    meta: 'The table\u2019s columns and choices',
    forms: 'The table\u2019s forms',
    record: 'The record\u2019s values',
    views: 'The subgrids\u2019 views'
  };
  const LOADING_CSS =
    'body{margin:0;font:14px/1.5 "Segoe UI",system-ui,sans-serif;color:var(--dbc-fg-10224e);background:var(--dbc-bg-f5f7fc)}' +
    '.ld{max-width:720px;padding:24px 26px}' +
    '.ld h2{margin:0 0 10px;font-size:16px;font-weight:600}' +
    '.ld-step{display:flex;gap:10px;align-items:flex-start;padding:5px 0;font-size:13.5px}' +
    // One slot for every icon, so the names line up and the squares keep clear of them.
    '.ld-i{flex:none;display:flex;justify-content:center;width:30px;padding-top:1px}' +
    '.ld-i .db-st.db-st-busy{margin:1px 0}' +
    '.ld-step .sub{margin-top:1px;font-size:12.5px;color:var(--dbc-fg-56637f)}' +
    '.ld-step.wait>div>.t{color:var(--dbc-fg-56637f)}.ld-step.bad>div>.t{color:var(--dbc-fg-a11a1a)}' +
    '.ld-why{margin:12px 0 0 30px;font-size:13px;color:var(--dbc-fg-a11a1a)}';

  /* Opened within the click, before any await, or it is blocked as a pop-up. */
  function openBlankTab(what, keys) {
    const tab = window.open('', '_blank');
    if (!tab) {
      window.alert('The tab was blocked. Allow pop-ups for this site and try again.');
      return null;
    }
    tab.document.write(
      '<!doctype html><meta charset="utf-8"><title>Reading\u2026</title>' +
        '<style>' + DynaBoost.status.css + LOADING_CSS + '</style>' +
        '<body><div class="ld" role="status"><h2>Reading ' + esc(what) + '\u2026</h2>' +
        keys
          .map((k, i) => '<div class="ld-step ' + (i ? 'wait' : 'busy') + '" data-k="' + k + '"><span class="ld-i">' + DynaBoost.status.html(i ? 'wait' : 'busy') + '</span><div><div class="t">' + esc(STEP_NAMES[k]) + '</div><div class="sub"></div></div></div>')
          .join('') +
        '</div>'
    );
    DynaBoost.themeTab(tab);
    return tab;
  }

  // The steps in that tab: busy, ok (with what was found), bad (why), wait.
  function stepsIn(tab) {
    const set = (key, kind, sub) => {
      if (tab.closed) return;
      const row = tab.document.querySelector('.ld-step[data-k="' + key + '"]');
      if (!row) return; // the result is drawn already
      row.className = 'ld-step ' + kind;
      row.querySelector('.ld-i').innerHTML = DynaBoost.status.html(kind);
      if (sub !== undefined) row.querySelector('.sub').textContent = sub;
    };
    return {
      busy: (key) => set(key, 'busy'),
      ok: (key, sub) => set(key, 'ok', sub || ''),
      bad: (key, sub) => set(key, 'bad', sub || ''),
      wait: (key, sub) => set(key, 'wait', sub || ''),
      // The read stopped: said in the tab, the steps show where.
      failed(message) {
        if (tab.closed) return;
        const doc = tab.document;
        const box = doc.querySelector('.ld');
        if (!box) return;
        doc.title = 'Not read';
        box.querySelector('h2').textContent = 'The form was not read';
        doc.querySelectorAll('.ld-step.busy').forEach((row) => {
          row.className = 'ld-step wait';
          row.querySelector('.ld-i').innerHTML = DynaBoost.status.html('wait');
        });
        const why = doc.createElement('div');
        why.className = 'ld-why';
        why.textContent = message;
        box.appendChild(why);
      }
    };
  }

  // What the page said about the form - and whether it said it at all.
  function pageText(ctx) {
    const p = ctx.process;
    const stage = p && Array.isArray(p.stages) ? p.stages.find((s) => s.active) : null;
    return [
      ctx.entity,
      ctx.formName ? 'form ' + ctx.formName : '',
      p ? 'business process ' + (p.name || '') + (stage ? ', stage ' + stage.name : '') : ctx.processNotLoaded ? 'the business process is not loaded in the page yet' : 'no business process on this record'
    ]
      .filter(Boolean)
      .join(' \u00b7 ');
  }

  async function fillTab(tab, ctx, steps) {
    let got;
    try {
      got = await collect(ctx, steps);
    } catch (e) {
      if (tab.closed) return false;
      if (steps) {
        steps.failed('Could not read the form: ' + e.message);
        return false;
      }
      tab.close();
      window.alert('Could not read the form.\n\n' + e.message);
      return false;
    }
    if (tab.closed) return false;

    const dump = got.dump;
    tab.document.open();
    tab.document.write(pageHtml(dump));
    tab.document.close();
    DynaBoost.themeTab(tab);
    wire(tab, dump, Object.assign({}, ctx, { formId: dump.form.id }), got.logic);
    return true;
  }

  function openDump(ctx) {
    const tab = openBlankTab(ctx.entity + ' ' + ctx.id, ['meta', 'forms', 'record', 'views']);
    if (tab) fillTab(tab, ctx, stepsIn(tab));
  }

  async function run() {
    const tab = openBlankTab('the form', ['page', 'meta', 'forms', 'record', 'views']);
    if (!tab) return;
    const steps = stepsIn(tab);

    let ctx = await formContextWithProcess(() => steps.busy('page'));
    if (ctx && ctx.entity) steps[ctx.processNotLoaded ? 'wait' : 'ok']('page', pageText(ctx));
    else {
      ctx = urlContext();
      if (ctx) steps.wait('page', 'The page did not answer - read from its address only: hidden parts, unsaved changes and the business process are not known. Reload the page (F5) and try again.');
    }
    if (!ctx) {
      tab.close();
      window.alert('Open a record form first. This tile reads the form you are looking at.');
      return;
    }
    if (!ctx.clientUrl) ctx.clientUrl = location.origin;
    if (await fillTab(tab, ctx, steps)) DynaBoost.saved('form-dump');
  }

  /* For Compare with... and Compare records (env-compare.js) - run in this
   * tab and, the same code, in the other environment's tab. Plain data only,
   * so it can travel between tabs:
   *   { op: 'form', entity, formId?, formName?, lcid? }
   *     -> { dump, logic, columns } with the logic's cloud flows in,
   *        { missing: 'table' }, or { pick: [forms], reason } when the form
   *        is not there by name (or twice)
   *   { op: 'record', entity, id, lcid? }
   *     -> { columns, record, primaryName }, or { missing: 'table' | 'record' } */
  function columnsOf(meta, lcid) {
    const out = {};
    for (const f of Object.keys(meta.attr)) {
      const a = meta.attr[f];
      out[f] = {
        displayName: label(a.DisplayName, lcid),
        type: (a.AttributeTypeName && a.AttributeTypeName.Value) || a.AttributeType || null,
        requiredLevel: a.RequiredLevel ? a.RequiredLevel.Value : null,
        custom: !!a.IsCustomAttribute,
        of: a.AttributeOf || null,
        primary: !!a.IsPrimaryId,
        targets: a.Targets || null
      };
      if (meta.options[f]) out[f].options = meta.options[f].options.map((o) => o.value + ' ' + o.label);
    }
    return out;
  }

  const plain = (x) => JSON.parse(JSON.stringify(x));
  const notFound = (e) => /^HTTP 404\b/.test(e.message) || /could not find|does not exist|0x80040217/i.test(e.message);

  async function readForCompare(req) {
    const lcid = req.lcid || 1033;
    let meta;
    try {
      meta = await loadMeta(req.entity, lcid);
    } catch (e) {
      if (notFound(e)) return { missing: 'table' };
      throw e;
    }
    if (req.op === 'record') {
      let record;
      try {
        record = await getJson(meta.def.EntitySetName + '(' + clean(req.id) + ')', ANNOTATE);
      } catch (e) {
        if (notFound(e)) return { missing: 'record', columns: columnsOf(meta, lcid) };
        throw e;
      }
      return plain({ columns: columnsOf(meta, lcid), record: record, primaryName: meta.def.PrimaryNameAttribute, displayName: label(meta.def.DisplayName, lcid) });
    }
    let forms;
    try {
      forms = await loadForms(req.entity);
    } catch (e) {
      forms = [];
    }
    const listed = forms.map((f) => ({ id: clean(f.formid), name: f.name, controls: f.controlCount }));
    let form = req.formId ? forms.find((f) => clean(f.formid) === clean(req.formId)) : null;
    if (!form) {
      const named = forms.filter((f) => String(f.name).trim().toLowerCase() === String(req.formName || '').trim().toLowerCase());
      if (named.length !== 1) return { pick: listed, reason: named.length ? 'many' : 'none', columns: columnsOf(meta, lcid) };
      form = named[0];
    }
    const ctx = { entity: req.entity, id: null, recordName: null, formId: clean(form.formid), formName: form.name, clientUrl: location.origin, lcid: lcid, envId: null, unsaved: false, tabs: {}, sections: {}, controls: {}, attributes: {} };
    const { dump, viewIds } = buildDump(ctx, meta, form, null);
    await resolveViews(dump, viewIds);
    dump.layout = layoutOf(dump);
    const logic = await loadLogic(ctx, meta, dump, form, forms, true);
    if (logic && !logic.error) {
      try {
        logic.automations.flows = await DynaBoost.formLogic.flows(dump.entity.logicalName, dump.entity.entitySetName);
      } catch (e) {
        logic.automations.flows = { error: e.message };
      }
    }
    return plain({ dump: dump, logic: logic, columns: columnsOf(meta, lcid), forms: listed });
  }

  DynaBoost.formDump = { read: readForCompare, label: label, css: PAGE_CSS, typeText: typeText, badges: badges, esc: esc, context: pageContext };

  // Which form is open, for the other record tiles (Edit form): the Xrm
  // snapshot when the page has one, else what the URL says.
  DynaBoost.formContext = (timeout) => pageContext(timeout || 1500).then((c) => c || urlContext());

  DynaBoost.register({
    id: 'form-dump',
    name: 'Form as JSON',
    group: 'Records',
    hosts: ['dynamics.com'],
    // A record form - not a list, a dashboard or the classic designer.
    when: () => DynaBoost.page().type === 'entityrecord',
    type: 'action',
    hint: 'The whole form as JSON, hidden fields too',
    icon: ICON,
    onRun: run
  });
})();
