/* Form as JSON - the logic behind a form: Scripts, Business rules, Automations.
 *
 * Loaded before form-dump.js, which calls DynaBoost.formLogic. Everything here
 * is read-only and goes to the same Web API the form tile already uses.
 *
 * Scripts. The form definition (systemforms.formxml) lists its JavaScript
 * libraries in load order (<formLibraries>) and every registered handler
 * (<event> > <Handlers>): OnLoad, OnSave, OnChange of a column, TabStateChange
 * - with the function, the library, whether it is enabled and gets the
 * execution context. Handlers attached from code (addOnChange in an OnLoad)
 * are not in the definition, so the libraries are read and the plain cases -
 * getAttribute("x").addOnChange(fn), entity.addOnSave(fn) and the like - are
 * listed as found in code; anything built more indirectly is missed. HTML and
 * other web resources placed on the form as controls are listed too. Code
 * opens in a window over the tab, scrolled to the function.
 *
 * Business rules. workflow rows with category 2 for the table: name, state,
 * scope (this form, all forms, entity) and the columns each one reads or sets,
 * taken from its definition.
 *
 * Automations. What runs on the table, in the order it comes into play:
 * plug-in steps registered on it (message, stage, sync or async, the class,
 * the columns an update step filters on), classic workflows (on create,
 * update of which columns, delete, on demand, real-time or background),
 * Power Automate cloud flows whose Dataverse trigger watches it; actions and
 * Custom APIs bound to it (what an API takes, returns and which plug-in runs
 * it); business process flows. Cloud flows keep the table only inside their
 * definition, so they are looked through after the tab is up.
 *
 * Edit in... lists the component's solutions first. Picking an unmanaged one
 * opens the editor in that solution's context - the business rule, workflow
 * or web resource editor; "Solution" beside it opens the solution itself. A
 * cloud flow the other way round, as in Power Automate: the solution opens
 * on a click, and "Edit" beside it opens the flow in the new designer, in
 * that solution. The Default Solution asks before it opens, since a change made
 * there travels with none of your solutions; managed ones cannot be edited
 * and say so.
 */
(function () {
  const API = '/api/data/v9.2/';
  const MAKER = 'https://make.powerapps.com';
  const FLOW_PORTAL = 'https://make.powerautomate.com';

  const COMPONENT = { workflow: 29, webresource: 61 };

  // Plug-in step pipeline stages and the Custom API parameter types.
  const STAGE = { 10: 'Pre-validation', 20: 'Pre-operation', 30: 'Main operation', 40: 'Post-operation' };
  const MESSAGE_ORDER = { create: 0, update: 1, delete: 2, assign: 3, setstate: 4, setstatedynamicentity: 4, retrieve: 5, retrievemultiple: 6 };
  const API_TYPE = ['Boolean', 'DateTime', 'Decimal', 'Entity', 'EntityCollection', 'EntityReference', 'Float', 'Integer', 'Money', 'Picklist', 'String', 'StringArray', 'Guid'];
  const BINDING = { 0: 'Global', 1: 'Entity', 2: 'EntityCollection' };

  const EVENT_LABEL = {
    onload: 'OnLoad',
    onsave: 'OnSave',
    onchange: 'OnChange',
    tabstatechange: 'TabStateChange',
    onreadystatecomplete: 'OnReadyStateComplete',
    onrecordselect: 'OnRecordSelect',
    onpostsave: 'OnPostSave'
  };
  const EVENT_ORDER = { onload: 0, onsave: 1, onpostsave: 2, onchange: 3, tabstatechange: 4 };

  // Dataverse trigger: "When a row is added, modified or deleted".
  const MESSAGES = {
    1: 'Row added',
    2: 'Row deleted',
    3: 'Row modified',
    4: 'Row added or modified',
    5: 'Row added or deleted',
    6: 'Row modified or deleted',
    7: 'Row added, modified or deleted'
  };
  // The retired Common Data Service connector's triggers.
  const LEGACY = {
    GetOnNewItems: 'Record created (legacy connector)',
    GetOnUpdatedItems: 'Record updated (legacy connector)',
    GetOnDeletedItems: 'Record deleted (legacy connector)'
  };
  const SCOPES = { 1: 'User', 2: 'Business unit', 3: 'Parent: child business units', 4: 'Organization' };

  function clean(g) {
    return String(g || '').replace(/[{}]/g, '').toLowerCase();
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many || one + 's');
  }

  async function getJson(pathOrUrl, prefer) {
    const headers = { Accept: 'application/json', 'OData-Version': '4.0' };
    if (prefer) headers.Prefer = prefer;
    const url = /^https?:/.test(pathOrUrl) ? pathOrUrl : API + pathOrUrl;
    const res = await fetch(url, { credentials: 'same-origin', headers: headers });
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = (body.error && body.error.message) || '';
      } catch (e) {
        /* no JSON body */
      }
      throw new Error('HTTP ' + res.status + (detail ? ': ' + detail : ''));
    }
    return res.json();
  }

  // Every page of a query, following @odata.nextLink.
  async function getAll(path, max) {
    const out = [];
    let next = path;
    while (next && out.length < max) {
      const r = await getJson(next, 'odata.maxpagesize=50');
      out.push.apply(out, r.value || []);
      next = r['@odata.nextLink'] || null;
    }
    return out;
  }

  // ---------- scripts (from the form definition) ----------

  function readScripts(formxml, fieldLabel) {
    const xml = new DOMParser().parseFromString(formxml || '<form/>', 'text/xml');
    const libraries = Array.from(xml.querySelectorAll('formLibraries > Library')).map((l) => ({
      name: l.getAttribute('name'),
      id: clean(l.getAttribute('libraryUniqueId'))
    }));
    const handlers = [];
    for (const ev of xml.querySelectorAll('event')) {
      const raw = ev.getAttribute('name') || '';
      const attr = ev.getAttribute('attribute');
      // Where the event lives: a column, a control, a tab, or the form.
      let target;
      if (attr) target = { kind: 'field', name: attr, label: fieldLabel(attr) };
      else {
        const control = ev.closest('control');
        const tab = ev.closest('tab');
        if (control) target = { kind: 'control', name: control.getAttribute('id') || control.getAttribute('datafieldname') };
        else if (tab) target = { kind: 'tab', name: tab.getAttribute('name') };
        else target = { kind: 'form', name: 'form' };
      }
      // <InternalHandlers> are Dynamics' own; only <Handlers> are yours.
      for (const h of ev.querySelectorAll(':scope > Handlers > Handler')) {
        handlers.push({
          event: EVENT_LABEL[raw.toLowerCase()] || raw,
          target: target,
          function: h.getAttribute('functionName'),
          library: h.getAttribute('libraryName'),
          enabled: h.getAttribute('enabled') !== 'false',
          passContext: h.getAttribute('passExecutionContext') === 'true',
          parameters: h.getAttribute('parameters') || ''
        });
      }
    }
    return { libraries: libraries, handlers: handlers };
  }

  // Library code by lower-cased name, for the scan below and the viewer.
  const codeCache = new Map();

  function decode(base64) {
    const bin = atob(base64 || '');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  async function loadCode(names) {
    const unique = Array.from(new Set(names.filter(Boolean)));
    if (!unique.length) return;
    const filter = unique.map((n) => "name eq '" + n.replace(/'/g, "''") + "'").join(' or ');
    try {
      const r = await getJson('webresourceset?$select=name,content&$filter=' + encodeURIComponent(filter));
      for (const w of r.value || []) codeCache.set(w.name.toLowerCase(), decode(w.content));
    } catch (e) {
      /* no code - the registered handlers still show */
    }
  }

  const FN = '([A-Za-z_$][\\w$.]*|\\()';
  const NAME = '\\(\\s*["\']([A-Za-z0-9_]+)["\']\\s*\\)\\s*\\.\\s*';
  const ATTACH = [
    { re: new RegExp('getAttribute' + NAME + 'addOnChange\\(\\s*' + FN, 'g'), event: 'OnChange', kind: 'field' },
    { re: new RegExp('getTab' + NAME + 'addTabStateChange\\(\\s*' + FN, 'g'), event: 'TabStateChange', kind: 'tab' },
    { re: new RegExp('getControl' + NAME + 'addPreSearch\\(\\s*' + FN, 'g'), event: 'PreSearch', kind: 'control' },
    { re: new RegExp('\\bentity\\s*\\.\\s*addOnSave\\(\\s*' + FN, 'g'), event: 'OnSave', kind: 'form' },
    { re: new RegExp('\\bentity\\s*\\.\\s*addOnPostSave\\(\\s*' + FN, 'g'), event: 'OnPostSave', kind: 'form' },
    { re: new RegExp('\\bdata\\s*\\.\\s*addOnLoad\\(\\s*' + FN, 'g'), event: 'OnDataLoad', kind: 'form' }
  ];

  // Handlers a library attaches itself, in the plain forms listed above.
  function attachedInCode(library, text, fieldLabel) {
    const out = [];
    text.split(/\r?\n/).forEach((line, i) => {
      for (const a of ATTACH) {
        a.re.lastIndex = 0;
        let m;
        while ((m = a.re.exec(line))) {
          const name = a.kind === 'form' ? 'form' : m[1];
          const fn = a.kind === 'form' ? m[1] : m[2];
          out.push({
            event: a.event,
            target: a.kind === 'field' ? { kind: 'field', name: name.toLowerCase(), label: fieldLabel(name.toLowerCase()) } : { kind: a.kind, name: name },
            function: fn === '(' || fn === 'function' || fn === 'async' ? '(inline function)' : fn,
            library: library,
            line: i + 1
          });
        }
      }
    });
    return out;
  }

  async function loadWebResources(names) {
    const unique = Array.from(new Set(names.filter(Boolean)));
    if (!unique.length) return {};
    const filter = unique.map((n) => "name eq '" + n.replace(/'/g, "''") + "'").join(' or ');
    try {
      const r = await getJson('webresourceset?$select=webresourceid,name,displayname,modifiedon&$filter=' + encodeURIComponent(filter));
      const map = {};
      for (const w of r.value || []) map[w.name.toLowerCase()] = { id: w.webresourceid, displayName: w.displayname, modifiedOn: w.modifiedon };
      return map;
    } catch (e) {
      return {};
    }
  }

  // ---------- business rules ----------

  // Columns a rule reads, sets, shows, hides, locks or requires, from its
  // XAML: GetEntityProperty / SetEntityProperty carry Attribute="x", the
  // form steps (visibility, lock, required, message) carry ControlId="x".
  function ruleFields(xaml) {
    const out = new Set();
    const re = /\b(?:Attribute|AttributeName|ControlId)="([A-Za-z0-9_]+)"/g;
    let m;
    while ((m = re.exec(xaml || ''))) out.add(m[1].toLowerCase().replace(/^header_(process_)?/, ''));
    return Array.from(out);
  }

  async function loadRules(entity, formId, formNames, fieldLabel) {
    // No $select: the columns holding the scope differ between versions, and
    // one unknown column in $select fails the whole query.
    const rows = await getAll("workflows?$filter=category eq 2 and type eq 1 and primaryentity eq '" + entity + "'", 500);
    return rows
      .map((w) => {
        const fid = clean(w.processtriggerformid || w._processtriggerformid_value);
        let scope;
        if (fid) scope = fid === clean(formId) ? 'This form' : 'Form: ' + (formNames[fid] || fid);
        else if (Number(w.processtriggerscope) === 2) scope = 'Entity';
        else scope = 'All forms';
        return {
          id: w.workflowid,
          name: w.name,
          active: w.statecode === 1,
          scope: scope,
          appliesHere: !fid || fid === clean(formId),
          description: w.description || '',
          modifiedOn: w.modifiedon,
          fields: ruleFields(w.xaml).map((f) => ({ name: f, label: fieldLabel(f) }))
        };
      })
      .sort((a, b) => b.appliesHere - a.appliesHere || b.active - a.active || a.name.localeCompare(b.name));
  }

  // ---------- automations ----------

  const KIND = { 0: 'Classic workflow', 3: 'Action', 4: 'Business process flow' };

  async function loadWorkflows(entity) {
    const rows = await getAll(
      'workflows?$select=workflowid,name,category,statecode,mode,ondemand,triggeroncreate,triggerondelete,triggeronupdateattributelist,modifiedon' +
        "&$filter=type eq 1 and primaryentity eq '" + entity + "' and (category eq 0 or category eq 3 or category eq 4)",
      500
    );
    return rows
      .map((w) => {
        const on = [];
        if (w.triggeroncreate) on.push('Create');
        if (w.triggeronupdateattributelist) on.push('Update of ' + w.triggeronupdateattributelist.split(',').join(', '));
        if (w.triggerondelete) on.push('Delete');
        if (w.ondemand) on.push('On demand');
        return {
          id: w.workflowid,
          name: w.name,
          kind: KIND[w.category] || 'Process',
          active: w.statecode === 1,
          mode: w.category === 0 ? (w.mode === 1 ? 'Real-time' : 'Background') : '',
          triggers: on,
          updateColumns: String(w.triggeronupdateattributelist || '')
            .split(',')
            .map((c) => c.trim().toLowerCase())
            .filter(Boolean),
          modifiedOn: w.modifiedon
        };
      })
      .sort((a, b) => a.kind.localeCompare(b.kind) || b.active - a.active || a.name.localeCompare(b.name));
  }

  /* Plug-in steps registered on the table - what the platform runs in the
   * save pipeline itself. Microsoft's own core steps (customization level 0)
   * and hidden ones are left out. */
  async function loadSteps(entity) {
    const select =
      'sdkmessageprocessingsteps?$select=sdkmessageprocessingstepid,name,description,stage,mode,rank,statecode,filteringattributes,ishidden,ismanaged,modifiedon' +
      '&$expand=sdkmessageid($select=name),plugintypeid($select=typename,assemblyname)';
    let rows;
    try {
      rows = await getAll(select + "&$filter=customizationlevel eq 1 and sdkmessagefilterid/primaryobjecttypecode eq '" + entity + "'", 1000);
    } catch (e) {
      // No filter through the lookup: find the table's message filters first.
      const filters = await getAll("sdkmessagefilters?$select=sdkmessagefilterid&$filter=primaryobjecttypecode eq '" + entity + "'", 500);
      rows = [];
      for (let i = 0; i < filters.length; i += 20) {
        const ids = filters.slice(i, i + 20).map((f) => '_sdkmessagefilterid_value eq ' + f.sdkmessagefilterid).join(' or ');
        rows.push.apply(rows, await getAll(select + '&$filter=customizationlevel eq 1 and (' + ids + ')', 1000));
      }
    }
    return rows
      .filter((r) => !(r.ishidden && r.ishidden.Value))
      .map((r) => {
        const type = (r.plugintypeid && r.plugintypeid.typename) || '';
        const message = (r.sdkmessageid && r.sdkmessageid.name) || '';
        return {
          id: r.sdkmessageprocessingstepid,
          name: r.name,
          description: r.description || '',
          message: message,
          stage: STAGE[r.stage] || String(r.stage),
          mode: r.mode === 1 ? 'Async' : 'Sync',
          rank: r.rank,
          active: r.statecode === 0,
          managed: !!r.ismanaged,
          type: type,
          assembly: (r.plugintypeid && r.plugintypeid.assemblyname) || '',
          // A service endpoint or webhook runs through this plug-in type.
          endpoint: /ServiceBusPlugin$/.test(type),
          columns: String(r.filteringattributes || '')
            .split(',')
            .map((c) => c.trim().toLowerCase())
            .filter(Boolean),
          modifiedOn: r.modifiedon
        };
      })
      .sort(
        (a, b) =>
          (MESSAGE_ORDER[a.message.toLowerCase()] ?? 9) - (MESSAGE_ORDER[b.message.toLowerCase()] ?? 9) ||
          a.message.localeCompare(b.message) ||
          parseInt(a.stage, 10) - parseInt(b.stage, 10) ||
          (a.rank || 0) - (b.rank || 0) ||
          a.type.localeCompare(b.type)
      );
  }

  // Custom APIs bound to the table, with what they take, return and run.
  async function loadCustomApis(entity) {
    const base =
      'customapis?$select=customapiid,uniquename,displayname,description,bindingtype,isfunction,isprivate,statecode,ismanaged,modifiedon' +
      "&$filter=boundentitylogicalname eq '" + entity + "'" +
      '&$expand=CustomAPIRequestParameters($select=uniquename,type,isoptional),CustomAPIResponseProperties($select=uniquename,type)';
    let rows;
    try {
      rows = await getAll(base + ',PluginTypeId($select=typename,assemblyname)', 500);
    } catch (e) {
      // Without the plug-in, rather than without the list.
      rows = await getAll(base, 500);
    }
    const param = (p) => ({ name: p.uniquename, type: API_TYPE[p.type] || String(p.type), optional: !!p.isoptional });
    return rows
      .map((r) => ({
        id: r.customapiid,
        name: r.uniquename,
        displayName: r.displayname && r.displayname !== r.uniquename ? r.displayname : '',
        description: r.description && r.description !== r.displayname ? r.description : '',
        kind: r.isfunction ? 'Function' : 'Action',
        binding: BINDING[r.bindingtype] || '',
        private: !!r.isprivate,
        active: r.statecode === 0,
        managed: !!r.ismanaged,
        parameters: (r.CustomAPIRequestParameters || []).map(param).sort((a, b) => a.optional - b.optional || a.name.localeCompare(b.name)),
        returns: (r.CustomAPIResponseProperties || []).map(param).sort((a, b) => a.name.localeCompare(b.name)),
        plugin: (r.PluginTypeId && r.PluginTypeId.typename) || '',
        modifiedOn: r.modifiedon
      }))
      .sort((a, b) => b.active - a.active || a.name.localeCompare(b.name));
  }

  // The trigger inside a cloud flow's definition, if it watches this table.
  function flowTrigger(clientdata, entity, entitySet) {
    let def;
    try {
      def = JSON.parse(clientdata);
    } catch (e) {
      return null;
    }
    const triggers = (def && def.properties && def.properties.definition && def.properties.definition.triggers) || {};
    for (const key of Object.keys(triggers)) {
      const t = triggers[key] || {};
      const inputs = t.inputs || {};
      const p = inputs.parameters || {};
      const ent = p['subscriptionRequest/entityname'] || p.entityName || p.entityname || p.table;
      if (!ent) continue;
      const e = String(ent).toLowerCase();
      if (e !== entity && e !== String(entitySet || '').toLowerCase()) continue;
      const msg = p['subscriptionRequest/message'];
      return {
        name: key,
        when: MESSAGES[msg] || LEGACY[inputs.host && inputs.host.operationId] || (inputs.host && inputs.host.operationId) || key,
        columns: String(p['subscriptionRequest/filteringattributes'] || '').split(',').filter(Boolean).join(', '),
        filter: p['subscriptionRequest/filterexpression'] || '',
        scope: SCOPES[p['subscriptionRequest/scope']] || ''
      };
    }
    return null;
  }

  // One look per table and page: switching forms in the tab does not scan again.
  const flowsCache = new Map();

  function flowsFor(entity, entitySet) {
    if (!flowsCache.has(entity)) {
      const p = loadFlows(entity, entitySet).catch((e) => {
        flowsCache.delete(entity);
        return { error: e.message };
      });
      flowsCache.set(entity, p);
    }
    return flowsCache.get(entity);
  }

  async function loadFlows(entity, entitySet) {
    const base = 'workflows?$filter=category eq 5 and type eq 1';
    let rows;
    try {
      // Narrow on the server when it can search the definition; the exact
      // check is done on the parsed trigger below either way.
      rows = await getAll(base + " and contains(clientdata,'" + entity + "')", 2000);
    } catch (e) {
      rows = await getAll(base, 3000);
    }
    return rows
      .map((w) => {
        const trigger = flowTrigger(w.clientdata, entity, entitySet);
        return trigger ? { id: w.workflowid, name: w.name, active: w.statecode === 1, trigger: trigger, modifiedOn: w.modifiedon } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.active - a.active || a.name.localeCompare(b.name));
  }

  // ---------- environment and solutions ----------

  async function environmentId(fromPage) {
    if (fromPage) return fromPage;
    try {
      const r = await getJson("RetrieveCurrentOrganization(AccessType=@p)?@p=Microsoft.Dynamics.CRM.EndpointAccessType'Default'");
      return (r.Detail && r.Detail.EnvironmentId) || null;
    } catch (e) {
      return null;
    }
  }

  function isDefaultSolution(s) {
    return s.uniquename === 'Default' || /default solution/i.test(s.friendlyname || '');
  }

  // componentType null: any type - the object id alone is unique enough.
  async function solutionsOf(objectId, componentType) {
    const r = await getJson(
      'solutioncomponents?$select=componenttype&$filter=objectid eq ' + clean(objectId) + (componentType == null ? '' : ' and componenttype eq ' + componentType) +
        '&$expand=solutionid($select=solutionid,friendlyname,uniquename,ismanaged,isvisible)'
    );
    const seen = new Set();
    const rank = (s) => (s.managed ? 2 : s.isDefault ? 1 : 0);
    return (r.value || [])
      .map((c) => c.solutionid)
      .filter((s) => s && s.isvisible !== false && !seen.has(s.solutionid) && seen.add(s.solutionid))
      .map((s) => ({ id: s.solutionid, name: s.friendlyname, unique: s.uniquename, managed: !!s.ismanaged, isDefault: isDefaultSolution(s) }))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }

  // ---------- load everything for a form ----------

  /* ctx is the page context (envId from Xrm when there is one), dump the
   * built form, form the systemform row, forms every main form of the table,
   * webResourceControls [{name, label, where}] from the form's controls. */
  async function load(ctx, dump, form, forms, webResourceControls, fieldLabel) {
    const scripts = readScripts(form.formxml, fieldLabel);
    scripts.onForm = webResourceControls;
    const formNames = {};
    for (const f of forms) formNames[clean(f.formid)] = f.name;
    const entity = dump.entity.logicalName;
    const failed = (e) => ({ error: e.message });
    const [webResources, , rules, workflows, steps, customApis, envId] = await Promise.all([
      loadWebResources(scripts.libraries.map((l) => l.name).concat(webResourceControls.map((w) => w.name))),
      loadCode(scripts.libraries.map((l) => l.name)),
      loadRules(entity, form.formid, formNames, fieldLabel).catch(failed),
      loadWorkflows(entity).catch(failed),
      loadSteps(entity).catch(failed),
      loadCustomApis(entity).catch(failed),
      environmentId(ctx.envId)
    ]);
    for (const x of scripts.libraries.concat(webResourceControls)) x.webResource = webResources[String(x.name).toLowerCase()] || null;
    scripts.attachedInCode = [];
    for (const l of scripts.libraries) {
      const text = codeCache.get(String(l.name).toLowerCase());
      if (text) scripts.attachedInCode.push.apply(scripts.attachedInCode, attachedInCode(l.name, text, fieldLabel));
    }
    return {
      environmentId: envId,
      scripts: scripts,
      businessRules: rules,
      // Cloud flows arrive later - null until wire() has looked.
      automations: { pluginSteps: steps, workflows: workflows, flows: null, customApis: customApis },
      // The custom command bar buttons - null until form-commands.js has read the ribbon.
      commands: null
    };
  }

  // One icon per kind of logic - the same in the column marks, the Logic
  // strip and the view headings, so the strip reads as the legend.
  const ICONS = {
    js: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4.5l-3 15"/>',
    rule: '<path d="M12 2.8l9.2 9.2-9.2 9.2L2.8 12z"/><path d="M8.3 12.2l2.5 2.5 4.9-4.9"/>',
    wf: '<rect x="3" y="3.5" width="8" height="6" rx="1.5"/><rect x="13" y="14.5" width="8" height="6" rx="1.5"/><path d="M7 9.5v8h6"/>',
    flow: '<path d="M4.5 5.5l6.5 6.5-6.5 6.5M12.5 5.5l6.5 6.5-6.5 6.5"/>',
    cmd: '<rect x="2.5" y="6.5" width="19" height="11" rx="2"/><path d="M9 6.5v11M15 6.5v11"/>',
    plug: '<path d="M9 2.5v5M15 2.5v5"/><path d="M6 7.5h12v3.5a6 6 0 0 1-12 0z"/><path d="M12 17v4.5"/>',
    act: '<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z"/>',
    api: '<path d="M7.5 4.5C5 4.5 5 6 5 8.5S4 12 3 12c1 0 2 .5 2 3.5s0 3.5 2.5 3.5M16.5 4.5C19 4.5 19 6 19 8.5s1 3.5 2 3.5c-1 0-2 .5-2 3.5s0 3.5-2.5 3.5"/><circle cx="12" cy="12" r="1.3"/>',
    bpf: '<path d="M3 6h7l3 6-3 6H3l3-6zM13.5 6H18l3 6-3 6h-4.5l3-6z"/>'
  };
  const KIND_NAME = { js: 'OnChange script', rule: 'Business rule', plug: 'Plug-in step', wf: 'Classic workflow', flow: 'Power Automate flow' };

  function icon(kind) {
    return (
      '<span class="lg-i lg-i-' + kind + '" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
      ICONS[kind] + '</svg></span>'
    );
  }

  /* Per column, everything that fires on it: OnChange scripts (registered or
   * attached in code), business rules on this form, plug-in steps on its
   * update, classic workflows that run on its update, cloud flows that
   * filter on it. */
  function marks(logic) {
    const out = Object.create(null);
    const at = (f) => out[f] || (out[f] = { js: [], rule: [], plug: [], wf: [], flow: [] });
    const scripts = logic.scripts.handlers.concat((logic.scripts.attachedInCode || []).map((h) => Object.assign({ fromCode: true, enabled: true }, h)));
    for (const h of scripts) {
      if (h.target.kind === 'field' && h.event === 'OnChange') {
        at(h.target.name).js.push({ fn: h.function, library: h.library, enabled: h.enabled, fromCode: !!h.fromCode, line: h.line || 0 });
      }
    }
    if (Array.isArray(logic.businessRules)) {
      for (const r of logic.businessRules) if (r.appliesHere) for (const f of r.fields) at(f.name).rule.push({ id: r.id, name: r.name, active: r.active });
    }
    if (Array.isArray(logic.automations.pluginSteps)) {
      for (const st of logic.automations.pluginSteps) {
        if (st.message.toLowerCase() !== 'update') continue;
        const name = st.endpoint ? 'Service endpoint' : shortType(st.type);
        for (const f of st.columns) at(f).plug.push({ id: st.id, name: name, type: st.type, stage: st.stage, mode: st.mode, active: st.active });
      }
    }
    if (Array.isArray(logic.automations.workflows)) {
      for (const w of logic.automations.workflows) for (const f of w.updateColumns || []) at(f).wf.push({ id: w.id, name: w.name, active: w.active, mode: w.mode });
    }
    if (Array.isArray(logic.automations.flows)) {
      for (const fl of logic.automations.flows) {
        for (const f of fl.trigger.columns.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean)) {
          at(f).flow.push({ id: fl.id, name: fl.name, active: fl.active, when: fl.trigger.when });
        }
      }
    }
    return out;
  }

  const KINDS = ['js', 'rule', 'plug', 'wf', 'flow'];

  function markHtml(m, field, label) {
    const kinds = m ? KINDS.filter((k) => m[k].length) : [];
    if (!kinds.length) return '';
    return (
      '<span class="lg-mark" tabindex="0" role="button" data-mark="' + esc(field) + '" data-label="' + esc(label || '') + '" aria-label="' + esc('Logic on this column: ' + kinds.map((k) => KIND_NAME[k]).join(', ')) + '">' +
      kinds.map(icon).join('') + '</span>'
    );
  }

  // Words the filter box can find a column by.
  function markSearch(m) {
    if (!m) return '';
    const w = [];
    if (m.js.length) w.push('onchange script js', m.js.map((x) => x.fn).join(' '));
    if (m.rule.length) w.push('business rule', m.rule.map((x) => x.name).join(' '));
    if (m.plug && m.plug.length) w.push('plug-in plugin step', m.plug.map((x) => x.type).join(' '));
    if (m.wf.length) w.push('classic workflow', m.wf.map((x) => x.name).join(' '));
    if (m.flow.length) w.push('power automate cloud flow', m.flow.map((x) => x.name).join(' '));
    return w.join(' ').toLowerCase();
  }

  // MyPlugins.Lead.OnUpdate -> OnUpdate; the full name goes in the title.
  function shortType(t) {
    return String(t || '').split(/[.+]/).pop() || String(t || '');
  }

  // The card under a column's mark: one line per thing, each opens it.
  function popHtml(m, field, label) {
    const item = (kind, attrs, title, sub, on) =>
      '<button type="button" class="lg-pop-i' + (on ? '' : ' off') + '"' + attrs + '>' + icon(kind) +
      '<span><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></span></button>';
    const lines = [];
    for (const x of m.js) {
      const named = x.fn && x.fn !== '(inline function)';
      lines.push(
        item('js', ' data-code="' + esc(x.library) + '"' + (named ? ' data-fn="' + esc(x.fn) + '"' : '') + (x.line ? ' data-line="' + x.line + '"' : ''), x.fn,
          'OnChange' + (x.fromCode ? ', attached in code' : '') + (x.enabled ? '' : ', disabled') + ' · ' + String(x.library).split('/').pop(), x.enabled)
      );
    }
    for (const x of m.rule) lines.push(item('rule', ' data-to="v6|rule:' + esc(x.id) + '"', x.name, 'Business rule' + (x.active ? '' : ', inactive'), x.active));
    for (const x of m.plug || []) {
      lines.push(item('plug', ' data-to="v7|step:' + esc(x.id) + '"', x.name, (x.name === 'Service endpoint' ? 'Service endpoint' : 'Plug-in') + ', on update, ' + x.stage.toLowerCase() + ', ' + x.mode.toLowerCase() + (x.active ? '' : ', disabled'), x.active));
    }
    for (const x of m.wf) lines.push(item('wf', ' data-to="v7|wf:' + esc(x.id) + '"', x.name, 'Classic workflow, ' + String(x.mode).toLowerCase() + ', runs when it changes' + (x.active ? '' : ', inactive'), x.active));
    for (const x of m.flow) lines.push(item('flow', ' data-to="v7|flow:' + esc(x.id) + '"', x.name, 'Power Automate, ' + String(x.when).toLowerCase() + (x.active ? '' : ', inactive'), x.active));
    return '<div class="lg-pop-h">' + esc(label || field) + '<code>' + esc(field) + '</code></div>' + lines.join('') + '<div class="lg-pop-f">Click to open</div>';
  }

  // Redraws the marks in place - cloud flows arrive after the views are up.
  function updateMarks(doc, logic) {
    const all = marks(logic);
    doc.querySelectorAll('#v-form .row[data-field], #v-fields .row[data-field]').forEach((row) => {
      const slot = row.querySelector('.lg-slot');
      if (!slot) return;
      const f = row.getAttribute('data-field');
      const old = slot.querySelector('.lg-mark');
      const html = markHtml(all[f], f, old ? old.getAttribute('data-label') : slot.getAttribute('data-label'));
      slot.innerHTML = html;
      row.classList.toggle('lg-has', !!html);
      row.setAttribute('data-m', markSearch(all[f]));
    });
  }

  // ---------- views ----------

  function counts(logic) {
    const rules = Array.isArray(logic.businessRules) ? logic.businessRules.filter((r) => r.appliesHere).length : 0;
    const n = (x) => (Array.isArray(x) ? x.length : 0);
    const a = logic.automations;
    const wf = n(a.workflows) + n(a.pluginSteps) + n(a.customApis);
    const flows = a.flows;
    return {
      libraries: logic.scripts.libraries.length,
      handlers: logic.scripts.handlers.length,
      inCode: (logic.scripts.attachedInCode || []).length,
      rules: rules,
      automations: wf + (Array.isArray(flows) ? flows.length : 0),
      flowsPending: flows === null,
      commands: DynaBoost.formCommands ? DynaBoost.formCommands.customCount(logic.commands) : 0
    };
  }

  function summaryHtml(logic) {
    const c = counts(logic);
    return (
      '<div class="lg-sum"><span class="lg-sum-h">Logic</span>' +
      '<a href="#" data-view="v5" aria-pressed="false">' + icon('js') + 'Scripts <span class="n">' + plural(c.libraries, 'library', 'libraries') + ' · ' + plural(c.handlers, 'handler') + (c.inCode ? ' + ' + c.inCode + ' in code' : '') + '</span></a>' +
      '<a href="#" data-view="v6" aria-pressed="false">' + icon('rule') + 'Business rules <span class="n">' + c.rules + '</span></a>' +
      '<a href="#" data-view="v7" aria-pressed="false">' + icon('plug') + icon('wf') + icon('flow') + 'Automations <span class="n">' + c.automations + (c.flowsPending ? ' + flows…' : '') + '</span></a>' +
      '<a href="#" data-view="v8" aria-pressed="false">' + icon('cmd') + 'Commands <span class="n">' + (c.commands === null ? '…' : c.commands + ' custom') + '</span></a>' +
      '</div>'
    );
  }

  function day(d) {
    return d ? String(d).slice(0, 10) : '';
  }

  function state(active) {
    return '<span class="lg-state ' + (active ? 'on' : 'off') + '">' + (active ? 'Active' : 'Inactive') + '</span>';
  }

  function codeBtn(name, fn, line) {
    return (
      '<button type="button" class="mini" data-code="' + esc(name) + '"' + (fn ? ' data-fn="' + esc(fn) + '"' : '') + (line ? ' data-line="' + line + '"' : '') + '>View code</button>'
    );
  }

  function editBtn(kind, id, name) {
    return '<button type="button" class="mini" data-edit="' + esc(kind + '|' + id + '|' + name) + '">Edit in…</button>';
  }

  function whereHtml(t) {
    if (t.kind === 'field') return '<a href="#" class="lg-goto" data-field="' + esc(t.name) + '">' + esc(t.label || t.name) + '</a> <code>' + esc(t.name) + '</code>';
    if (t.kind === 'form') return 'Form';
    return esc(t.kind) + ' <code>' + esc(t.name) + '</code>';
  }

  function scriptsHtml(logic) {
    const s = logic.scripts;
    const onForm = s.onForm || [];
    if (!s.libraries.length && !s.handlers.length && !onForm.length) return '<p class="lg-empty">No JavaScript and no web resource is registered on this form.</p>';

    // Libraries in load order; a handler whose library is missing from the
    // list still gets a card, so nothing registered goes unseen.
    const byLib = new Map();
    s.libraries.forEach((l, i) => byLib.set(l.name, { lib: l, order: i + 1, handlers: [] }));
    const inCode = (s.attachedInCode || []).map((h) => Object.assign({ fromCode: true, enabled: true }, h));
    for (const h of s.handlers.concat(inCode)) {
      if (!byLib.has(h.library)) byLib.set(h.library, { lib: { name: h.library, webResource: null, missing: true }, order: 0, handlers: [] });
      byLib.get(h.library).handlers.push(h);
    }

    const cards = Array.from(byLib.values()).map(({ lib, order, handlers }) => {
      handlers.sort(
        (a, b) =>
          (a.fromCode ? 1 : 0) - (b.fromCode ? 1 : 0) ||
          (EVENT_ORDER[a.event.toLowerCase()] ?? 9) - (EVENT_ORDER[b.event.toLowerCase()] ?? 9) ||
          String(a.target.label || a.target.name).localeCompare(String(b.target.label || b.target.name))
      );
      const rows = handlers
        .map(
          (h) =>
            '<tr' + (h.fromCode ? ' class="code"' : h.enabled ? '' : ' class="off"') + '>' +
            '<td><span class="lg-ev">' + esc(h.event) + '</span>' +
            (h.fromCode ? '<div class="lg-dim lg-incode" title="Not registered on the form - the library attaches it itself">in code, line ' + h.line + '</div>' : '') + '</td>' +
            '<td>' + whereHtml(h.target) + '</td>' +
            '<td><code class="lg-fn">' + esc(h.function) + '</code>' +
            (h.passContext ? ' <span class="lg-dim" title="Receives the execution context">ctx</span>' : '') +
            (h.parameters ? ' <span class="lg-dim" title="Parameters">(' + esc(h.parameters) + ')</span>' : '') +
            (h.enabled ? '' : ' <span class="lg-state off">disabled</span>') + '</td>' +
            '<td class="lg-act">' + codeBtn(lib.name, h.function === '(inline function)' ? '' : h.function, h.fromCode ? h.line : 0) + '</td>' +
            '</tr>'
        )
        .join('');
      const wr = lib.webResource;
      const search = [lib.name, wr && wr.displayName]
        .concat(handlers.map((h) => h.event + ' ' + h.function + ' ' + h.target.name + ' ' + (h.target.label || '')))
        .join(' ')
        .toLowerCase();
      return (
        '<div class="lg-card" data-s="' + esc(search) + '">' +
        '<h3>' + (order ? '<span class="lg-dim" title="Load order">#' + order + '</span>' : '') +
        '<span class="lg-lib">' + esc(lib.name) + '</span>' +
        (wr && wr.displayName && wr.displayName !== lib.name ? '<span class="lg-dim">' + esc(wr.displayName) + '</span>' : '') +
        (lib.missing ? '<span class="lg-state off" title="A handler points at it, but the form does not load it">not in the form libraries</span>' : '') +
        '<span class="lg-tools">' + codeBtn(lib.name) + (wr ? editBtn('webresource', wr.id, lib.name) : '') + '</span></h3>' +
        (rows
          ? '<table class="lg-t"><colgroup><col style="width:150px"><col style="width:30%"><col><col style="width:104px"></colgroup>' +
            '<thead><tr><th>Event</th><th>On</th><th>Function</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
          : '<p class="lg-note">Loaded by the form with no handler of its own - its functions are called from the other libraries.</p>') +
        (wr && wr.modifiedOn ? '<div class="lg-dim lg-foot">modified ' + esc(day(wr.modifiedOn)) + '</div>' : '') +
        '</div>'
      );
    });

    const shown = onForm.length
      ? '<h2 class="lg-h">Web resources on the form</h2>' +
        onForm
          .map((w) => {
            const wr = w.webResource;
            return (
              '<div class="lg-card" data-s="' + esc((w.name + ' ' + w.label + ' ' + w.where).toLowerCase()) + '"><h3>' +
              '<span class="lg-lib">' + esc(w.name) + '</span><span class="lg-scope">' + esc(w.label) + ' · ' + esc(w.where) + '</span>' +
              '<span class="lg-tools">' + codeBtn(w.name) + (wr ? editBtn('webresource', wr.id, w.name) : '') + '</span></h3></div>'
            );
          })
          .join('')
      : '';

    return (
      (cards.length
        ? '<p class="lg-note">Libraries in the order the form loads them, with the handlers registered on the form. Handlers a library attaches itself are listed as “in code” when written plainly - getAttribute("x").addOnChange(fn); anything built more indirectly is not found, and the OnLoad functions are where to look for it.</p>' +
          cards.join('')
        : '') + shown
    );
  }

  function rulesHtml(logic) {
    const list = logic.businessRules;
    if (!Array.isArray(list)) return '<p class="lg-empty">Business rules could not be read. ' + esc(list && list.error) + '</p>';
    if (!list.length) return '<p class="lg-empty">No business rules on this table.</p>';
    const other = list.filter((r) => !r.appliesHere).length;
    return (
      (other ? '<p class="lg-note">Rules scoped to another form are listed last, dimmed.</p>' : '') +
      list
        .map(
          (r) =>
            '<div class="lg-card' + (r.appliesHere ? '' : ' lg-other') + '" data-item="rule:' + esc(r.id) + '" data-s="' + esc((r.name + ' ' + r.fields.map((f) => f.name + ' ' + (f.label || '')).join(' ')).toLowerCase()) + '">' +
            '<h3>' + esc(r.name) + state(r.active) + '<span class="lg-scope">' + esc(r.scope) + '</span>' +
            '<span class="lg-tools">' + editBtn('rule', r.id, r.name) + '</span></h3>' +
            (r.description ? '<p class="lg-note">' + esc(r.description) + '</p>' : '') +
            (r.fields.length
              ? '<div class="lg-fields">' +
                r.fields.map((f) => '<a href="#" class="lg-goto lg-chip" data-field="' + esc(f.name) + '" title="' + esc(f.name) + '">' + esc(f.label || f.name) + '</a>').join('') +
                '</div>'
              : '') +
            '<div class="lg-dim lg-foot">modified ' + esc(day(r.modifiedOn)) + '</div>' +
            '</div>'
        )
        .join('')
    );
  }

  /* Automations, in the order they come into play: in the save pipeline
   * (plug-in steps, classic workflows, cloud flows), called on demand
   * (actions, Custom APIs), guiding the user (business process flows).
   * One card per kind, one row per item: its name opens it, Edit in... picks
   * the solution; the line of kinds on top shows one kind at a time. */
  const AUTO = [
    { k: 'plug', name: 'Plug-in steps', chip: 'Plug-ins', group: 'On save' },
    { k: 'wf', name: 'Classic workflows', chip: 'Workflows', group: 'On save' },
    { k: 'flow', name: 'Cloud flows', chip: 'Flows', group: 'On save' },
    { k: 'act', name: 'Actions', chip: 'Actions', group: 'On demand' },
    { k: 'api', name: 'Custom APIs', chip: 'Custom APIs', group: 'On demand' },
    { k: 'bpf', name: 'Business process flows', chip: 'Process flows', group: 'Guided' }
  ];

  function row(o) {
    return (
      '<div class="lg-r' + (o.on ? '' : ' off') + '" data-item="' + esc(o.item) + '" data-s="' + esc(o.search.toLowerCase()) + '">' +
      '<span class="lg-dot" title="' + esc((o.on ? 'Active' : 'Inactive') + (o.modified ? ' · modified ' + day(o.modified) : '')) + '"></span>' +
      '<div class="lg-r-main">' + o.name + (o.sub ? '<div class="lg-r-sub">' + o.sub + '</div>' : '') + '</div>' +
      '<div class="lg-r-meta">' + (o.meta || '') + '</div>' +
      '<div class="lg-r-tools">' + (o.tools || '') + '</div></div>'
    );
  }

  const opener = (kind, id, text, cls) => '<a href="#" class="lg-r-name' + (cls ? ' ' + cls : '') + '" data-open="' + esc(kind + '|' + id) + '">' + esc(text) + '</a>';
  const typed = (list) => list.map((p) => '<code>' + esc(p.name) + '</code> ' + esc(p.type) + (p.optional ? '?' : '')).join(', ');
  const columnChips = (cols) => cols.map((c) => '<a href="#" class="lg-goto" data-field="' + esc(c) + '">' + esc(c) + '</a>').join(', ');

  const ROWS = {
    plug: (x) =>
      row({
        item: 'step:' + x.id,
        on: x.active,
        modified: x.modifiedOn,
        search: [x.message, x.stage, x.mode, x.type, x.assembly, x.name, x.columns.join(' ')].join(' '),
        name: x.endpoint
          ? '<span class="lg-r-name">Service endpoint</span>'
          : '<span class="lg-r-name" title="' + esc(x.type) + '">' + esc(shortType(x.type)) + '</span>',
        sub: esc(x.endpoint ? x.name : x.description || x.assembly),
        meta:
          '<b>' + esc(x.message) + '</b> · ' + esc(x.stage) + ' · ' + esc(x.mode) + (x.rank ? ' · #' + x.rank : '') +
          (x.columns.length ? '<div class="lg-r-sub">on ' + columnChips(x.columns) + '</div>' : ''),
        tools: editBtn('step', x.id, shortType(x.type) || x.name)
      }),
    wf: (x) =>
      row({
        item: 'wf:' + x.id,
        on: x.active,
        modified: x.modifiedOn,
        search: x.name + ' ' + x.triggers.join(' '),
        name: opener('process', x.id, x.name),
        sub: x.triggers.length ? (x.triggers[0] === 'On demand' ? '' : 'Runs on ') + esc(x.triggers.join(' · ')) : '',
        meta: esc(x.mode),
        tools: editBtn('workflow', x.id, x.name)
      }),
    flow: (x) =>
      row({
        item: 'flow:' + x.id,
        on: x.active,
        modified: x.modifiedOn,
        search: [x.name, x.trigger.when, x.trigger.columns, x.trigger.filter].join(' '),
        name: '<a href="#" class="lg-r-name" data-flow="' + esc(x.id) + '">' + esc(x.name) + '</a>',
        sub:
          (x.trigger.columns ? 'on ' + columnChips(x.trigger.columns.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean)) : '') +
          (x.trigger.filter ? (x.trigger.columns ? ' · ' : '') + '<code>' + esc(x.trigger.filter) + '</code>' : ''),
        meta: esc(x.trigger.when) + (x.trigger.scope ? ' · ' + esc(x.trigger.scope) : ''),
        tools: editBtn('flow', x.id, x.name)
      }),
    act: (x) =>
      row({ item: 'wf:' + x.id, on: x.active, modified: x.modifiedOn, search: x.name, name: opener('process', x.id, x.name), meta: 'On demand', tools: editBtn('workflow', x.id, x.name) }),
    api: (x) =>
      row({
        item: 'api:' + x.id,
        on: x.active,
        modified: x.modifiedOn,
        search: [x.name, x.displayName, x.description, x.plugin, x.parameters.map((p) => p.name).join(' '), x.returns.map((p) => p.name).join(' ')].join(' '),
        name: opener('customapi', x.id, x.name, 'lg-mono') + (x.displayName ? ' <span class="lg-dim">' + esc(x.displayName) + '</span>' : ''),
        sub:
          [
            x.description ? esc(x.description) : '',
            x.parameters.length ? '<span class="lg-k">in</span>' + typed(x.parameters) : '',
            x.returns.length ? '<span class="lg-k">out</span>' + typed(x.returns) : '',
            x.plugin ? '<span class="lg-k">runs</span><span title="' + esc(x.plugin) + '">' + esc(shortType(x.plugin)) + '</span>' : ''
          ]
            .filter(Boolean)
            .join('<br>'),
        meta: esc(x.kind) + ' · ' + esc(x.binding) + (x.private ? ' · private' : ''),
        tools: editBtn('customapi', x.id, x.name)
      }),
    bpf: (x) =>
      row({ item: 'wf:' + x.id, on: x.active, modified: x.modifiedOn, search: x.name, name: opener('process', x.id, x.name), tools: editBtn('workflow', x.id, x.name) })
  };

  function automationsHtml(logic) {
    const a = logic.automations;
    const wfs = (kind) => (Array.isArray(a.workflows) ? a.workflows.filter((w) => w.kind === kind) : a.workflows);
    const lists = {
      plug: a.pluginSteps,
      wf: wfs('Classic workflow'),
      flow: a.flows,
      act: wfs('Action'),
      api: a.customApis,
      bpf: wfs('Business process flow')
    };

    const chips = [];
    const sections = [];
    let group = '';
    let total = 0;
    for (const kind of AUTO) {
      const list = lists[kind.k];
      const pending = list === null || list === undefined;
      const failed = !pending && !Array.isArray(list);
      if (!pending && !failed && !list.length) continue;
      if (Array.isArray(list)) total += list.length;
      if (kind.group !== group) {
        group = kind.group;
        chips.push('<span class="lg-af-g">' + esc(group) + '</span>');
      }
      chips.push(
        '<a href="#" data-af="' + kind.k + '" aria-pressed="false">' + esc(kind.chip) + ' <span class="n">' + (pending ? '…' : failed ? '!' : list.length) + '</span></a>'
      );
      const body = pending
        ? '<p class="lg-note lg-r-wait">Looking through the environment’s cloud flows for a Dataverse trigger on this table…</p>'
        : failed
        ? '<p class="lg-note lg-r-wait">Could not be read. ' + esc(list.error) + '</p>'
        : list.map(ROWS[kind.k]).join('');
      sections.push(
        '<section class="lg-sec" data-k="' + kind.k + '"><h2 class="lg-h">' + icon(kind.k) + esc(kind.name) +
          (Array.isArray(list) ? ' <span class="lg-dim">' + list.length + '</span>' : '') + '</h2><div class="lg-rows">' + body + '</div></section>'
      );
    }
    if (!sections.length) return '<p class="lg-empty">Nothing runs on this table: no plug-in step, workflow, cloud flow, action, Custom API or business process flow.</p>';
    return (
      '<div class="lg-auto"><div class="lg-af"><a href="#" data-af="" aria-pressed="true">All <span class="n">' + total + '</span></a>' + chips.join('') + '</div>' +
      sections.join('') + '</div>'
    );
  }

  // Shows one kind of automation, or all ('') - kept across redraws.
  function showAutomations(doc, k) {
    doc.__dbAuto = k || '';
    const box = doc.querySelector('.lg-auto');
    if (!box) return;
    if (doc.__dbAuto) box.setAttribute('data-show', doc.__dbAuto);
    else box.removeAttribute('data-show');
    box.querySelectorAll('[data-af]').forEach((c) => c.setAttribute('aria-pressed', String(c.getAttribute('data-af') === doc.__dbAuto)));
  }

  const CSS =
    '.lg-sum{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px;font-size:12.5px}' +
    '.lg-sum-h{margin-right:2px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dbc-fg-97a5c6)}' +
    '.lg-sum a{padding:3px 11px;border:1px solid var(--dbc-bd-e8d5a8);border-radius:12px;background:var(--dbc-bg-fffaf0);color:var(--dbc-fg-10224e);text-decoration:none}' +
    '.lg-sum a .n{color:var(--dbc-fg-9a6a12)}' +
    '.lg-sum a:hover{border-color:var(--dbc-bd-e3b04b);background:var(--dbc-bg-fff3dc)}' +
    '.lg-sum a[aria-pressed="true"]{background:var(--dbc-bg-10224e);border-color:var(--dbc-bd-10224e);color:var(--dbc-fg-fff)}.lg-sum a[aria-pressed="true"] .n{color:var(--dbc-fg-f3d58f)}' +
    '.lg-dim{color:var(--dbc-fg-97a5c6);font-weight:400}' +
    '.lg-note{margin:0 0 12px;font-size:12.5px;color:var(--dbc-fg-56637f)}' +
    '.lg-empty{margin:0 0 12px;padding:14px 16px;color:var(--dbc-fg-56637f);background:var(--dbc-bg-fff);border:1px dashed var(--dbc-bd-c6d0e4);border-radius:8px}' +
    '.lg-h{margin:18px 0 10px}.lg-h:first-child{margin-top:6px}' +
    '.lg-card{margin:0 0 12px;padding:10px 14px 12px;background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-left:3px solid var(--dbc-bd-e3b04b);border-radius:8px}' +
    '.lg-card.lg-other{border-left-color:var(--dbc-bd-c6d0e4);opacity:.75}' +
    '.lg-card h3{margin:0;font-size:13.5px;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
    '.lg-card h3+*{margin-top:8px}' +
    '.lg-lib{font:600 13px ui-monospace,Consolas,monospace}' +
    '.lg-tools{margin-left:auto;display:flex;gap:6px}.lg-tools .mini{margin-left:0;font-weight:400}' +
    '.lg-state{padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600}' +
    '.lg-state.on{background:var(--dbc-bg-e4f4e8);color:var(--dbc-fg-1c6b32)}.lg-state.off{background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f)}' +
    '.lg-scope{font-size:12px;font-weight:400;color:var(--dbc-fg-56637f)}' +
    '.lg-t{width:100%;border-collapse:collapse;font-size:12.5px;table-layout:fixed}' +
    '.lg-t td{overflow-wrap:anywhere}.lg-incode{font-size:11px;margin-top:2px}' +
    '.lg-t tr.code .lg-ev{background:var(--dbc-bg-f1f3f8);color:var(--dbc-fg-56637f)}' +
    '.lg-t th{text-align:left;font-weight:600;color:var(--dbc-fg-56637f);padding:4px 8px 4px 0}' +
    '.lg-t td{padding:5px 8px 5px 0;border-top:1px solid var(--dbc-bd-edf1f8);vertical-align:top}' +
    '.lg-t tr.off td{color:var(--dbc-fg-97a5c6)}.lg-t tr.off .lg-fn{color:var(--dbc-fg-97a5c6);text-decoration:line-through}' +
    '.lg-t .lg-act{text-align:right;white-space:nowrap}' +
    '.lg-ev{display:inline-block;padding:0 7px;border-radius:9px;background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-1e4fb8);font-size:11.5px;white-space:nowrap}' +
    '.lg-fn{color:var(--dbc-fg-10224e)}' +
    '.lg-goto{color:var(--dbc-fg-10224e);text-decoration:none;border-bottom:1px dotted var(--dbc-bd-e3b04b)}.lg-goto:hover{color:var(--dbc-fg-1e6bff)}' +
    '.lg-fields{display:flex;flex-wrap:wrap;gap:6px}' +
    '.lg-chip{padding:1px 8px;border:1px solid var(--dbc-bd-e8d5a8);border-radius:10px;background:var(--dbc-bg-fffaf0);font-size:12px}' +
    '.lg-kv{font-size:12.5px;margin:2px 0}.lg-kv span{display:inline-block;min-width:96px;color:var(--dbc-fg-56637f)}' +
    '.lg-foot{margin-top:6px;font-size:11.5px}' +
    '.lg-i{display:inline-flex;flex:none}.lg-i svg{width:13px;height:13px}' +
    '.lg-i-js{color:var(--dbc-fg-b7791f)}.lg-i-rule{color:var(--dbc-fg-7c3aed)}.lg-i-wf{color:var(--dbc-fg-0f766e)}.lg-i-flow{color:var(--dbc-fg-1e6bff)}.lg-i-cmd{color:var(--dbc-fg-c2410c)}' +
    '.lg-sum a{display:inline-flex;align-items:center;gap:5px}.lg-sum a .lg-i svg{width:12px;height:12px}' +
    '.lg-sum a[aria-pressed="true"] .lg-i{color:var(--dbc-fg-f3d58f)}' +
    '.lg-h{display:flex;align-items:center;gap:8px}.lg-h .lg-i svg{width:16px;height:16px}' +
    '.lg-mark{display:inline-flex;align-items:center;gap:5px;margin-left:8px;padding:3px 7px;border:1px solid var(--dbc-bd-e8d5a8);border-radius:10px;background:var(--dbc-bg-fff);cursor:pointer;vertical-align:-3px;outline:none}' +
    '.lg-mark .lg-i svg{width:14px;height:14px}' +
    '.lg-mark:hover,.lg-mark:focus-visible,.lg-mark.open{border-color:var(--dbc-bd-e3b04b);background:var(--dbc-bg-fff8e8);box-shadow:0 0 0 2px var(--dbc-bd-fdf1d6)}' +
    '.lg-pop{position:fixed;z-index:9;width:max-content;min-width:250px;max-width:min(460px,calc(100vw - 16px));padding:6px 0;background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px;box-shadow:0 10px 30px rgba(6,14,34,.18);font-size:12.5px;color:var(--dbc-fg-10224e)}' +
    '.lg-pop-h{padding:3px 12px 7px;margin-bottom:3px;font-weight:600;border-bottom:1px solid var(--dbc-bd-edf1f8)}.lg-pop-h code{margin-left:8px;font-weight:400}' +
    '.lg-pop-i{display:flex;align-items:flex-start;gap:9px;width:100%;padding:5px 12px;border:0;border-radius:0;background:none;text-align:left;font:inherit;color:var(--dbc-fg-10224e);cursor:pointer}' +
    '.lg-pop-i:hover{background:var(--dbc-bg-fffaf0);color:var(--dbc-fg-10224e)}.lg-pop-i .lg-i{margin-top:2px}' +
    '.lg-pop-i b{display:block;font-weight:600;overflow-wrap:anywhere}.lg-pop-i small{display:block;margin-top:1px;color:var(--dbc-fg-56637f);font-size:11.5px}' +
    '.lg-pop-i.off b{color:var(--dbc-fg-97a5c6);font-weight:400}' +
    '.lg-pop-f{padding:6px 12px 1px;margin-top:3px;border-top:1px solid var(--dbc-bd-edf1f8);color:var(--dbc-fg-97a5c6);font-size:11px}' +
    '.lg-card{transition:box-shadow .6s}.lg-card.lg-flash{box-shadow:0 0 0 3px var(--dbc-bd-f3d58f)}' +
    '.row.lg-has{box-shadow:inset 3px 0 0 var(--dbc-bd-e3b04b)}' +
    '.row{transition:background .6s}.row.lg-flash{background:var(--dbc-bg-fff3dc) !important}' +
    '.lg-modal{position:fixed;inset:0;background:rgba(6,14,34,.45);display:flex;align-items:center;justify-content:center;z-index:10}' +
    '.lg-box{width:480px;max-width:calc(100% - 32px);max-height:80%;overflow:auto;background:var(--dbc-bg-fff);border-radius:10px;padding:18px 20px;box-shadow:0 12px 40px rgba(6,14,34,.3)}' +
    '.lg-box h3{margin:0 0 6px;font-size:15px}' +
    '.lg-sol-row{display:flex;gap:6px;margin:6px 0 0}' +
    '.lg-sol{flex:1;min-width:0;display:flex;align-items:center;gap:8px;padding:9px 12px;text-align:left}' +
    '.lg-sol-alt{flex:none;padding:0 12px;font-size:12px;color:var(--dbc-fg-56637f)}' +
    '.lg-sol-alt:hover{border-color:var(--dbc-bd-e3b04b);background:var(--dbc-bg-fffaf0);color:var(--dbc-fg-10224e)}' +
    '.lg-sol:hover:enabled{border-color:var(--dbc-bd-e3b04b);background:var(--dbc-bg-fffaf0);color:var(--dbc-fg-10224e)}' +
    '.lg-sol:disabled{opacity:.55;cursor:default}' +
    '.lg-sol small{margin-left:auto;color:var(--dbc-fg-56637f);font-size:12px}' +
    '.lg-warn{margin:10px 0 0;padding:10px 12px;border-radius:8px;background:var(--dbc-bg-fff7e6);color:var(--dbc-fg-7a5410);font-size:13px}' +
    '.lg-row{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}' +
    // the code window
    '.lg-box.lg-codebox{width:min(1180px,calc(100% - 48px));max-width:none;height:86vh;max-height:none;padding:0;display:flex;flex-direction:column;overflow:hidden}' +
    '.lg-code-head{flex:none;display:flex;align-items:center;gap:10px;padding:12px 12px 0 20px}' +
    '.lg-code-head h3{margin:0;flex:1;min-width:0;font:600 15px ui-monospace,Consolas,monospace;overflow-wrap:anywhere}' +
    // The cross is drawn, not typed: a × glyph sits a little off centre in
    // most fonts. The character stays in the button for screen readers.
    '.lg-x{flex:none;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dbc-fg-56637f);font-size:0;line-height:0}' +
    '.lg-x::before{content:"";width:14px;height:14px;background:currentColor;' +
    '-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 14 14%27%3E%3Cpath d=%27M2 2l10 10M12 2 2 12%27 stroke=%27black%27 stroke-width=%271.8%27 stroke-linecap=%27round%27/%3E%3C/svg%3E") center/contain no-repeat;' +
    'mask:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 14 14%27%3E%3Cpath d=%27M2 2l10 10M12 2 2 12%27 stroke=%27black%27 stroke-width=%271.8%27 stroke-linecap=%27round%27/%3E%3C/svg%3E") center/contain no-repeat}' +
    '.lg-x:hover{background:var(--dbc-bg-fff3dc);color:var(--dbc-fg-9a6a12)}' +
    '.lg-code-crumbs{flex:none;padding:4px 20px 12px;font-size:13px;color:var(--dbc-fg-56637f);border-bottom:2px solid var(--dbc-bd-e3b04b)}' +
    '.lg-code-crumbs a{color:var(--dbc-fg-1e6bff);text-decoration:none}.lg-code-crumbs a:hover{text-decoration:underline}' +
    '.lg-code-wait{margin:12px 20px 20px}' +
    '.lg-code{position:relative;flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:6px 0 10px;background:var(--dbc-bg-fff);font:12.5px/1.55 ui-monospace,Consolas,monospace;color:var(--dbc-fg-10224e)}' +
    '.lg-code .l{display:flex;white-space:pre-wrap;word-break:break-all}' +
    '.lg-code .n{flex:none;width:56px;padding-right:10px;text-align:right;color:var(--dbc-fg-97a5c6);user-select:none;border-right:1px solid var(--dbc-bd-edf1f8)}' +
    '.lg-code .c{padding:0 14px;min-width:0}' +
    '.lg-code .l.def{background:var(--dbc-bg-fff3dc)}.lg-code .l.def .n{color:var(--dbc-fg-9a6a12);font-weight:600}' +
    '.lg-code .l.at{background:var(--dbc-bg-e9f1ff)}.lg-code .l.at .n{color:var(--dbc-fg-1e4fb8);font-weight:600}' +
    '.lg-code mark{background:var(--dbc-bg-ffe1a1);color:inherit;border-radius:2px}' +
    // Automations: the line of kinds, one card per kind, one row per item.
    // Spacing on 5 / 8 / 13 / 21, name and description at 1.618 : 1.
    '.lg-i-plug{color:var(--dbc-fg-be185d)}.lg-i-act{color:var(--dbc-fg-0369a1)}.lg-i-api{color:var(--dbc-fg-4d7c0f)}.lg-i-bpf{color:var(--dbc-fg-475569)}' +
    '.lg-af{display:flex;flex-wrap:wrap;align-items:baseline;gap:5px 13px;margin:0 0 5px;padding:0 0 8px;border-bottom:1px solid var(--dbc-bd-dde3f0);font-size:12.5px}' +
    '.lg-af a{padding:2px 0;border-bottom:2px solid transparent;color:var(--dbc-fg-56637f);text-decoration:none}.lg-af a .n{color:var(--dbc-fg-97a5c6)}' +
    '.lg-af a:hover{color:var(--dbc-fg-10224e)}.lg-af a[aria-pressed="true"]{color:var(--dbc-fg-10224e);font-weight:600;border-bottom-color:var(--dbc-bd-e3b04b)}' +
    '.lg-af-g{margin-left:8px;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dbc-fg-97a5c6)}' +
    '.lg-auto[data-show] .lg-sec{display:none}' +
    ['plug', 'wf', 'flow', 'act', 'api', 'bpf'].map((k) => '.lg-auto[data-show="' + k + '"] .lg-sec[data-k="' + k + '"]{display:block}').join('') +
    '.lg-sec .lg-h{margin:21px 0 8px}.lg-h .lg-dim{font-size:13px}' +
    '.lg-rows{background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-left:3px solid var(--dbc-bd-e3b04b);border-radius:8px;overflow:hidden}' +
    '.lg-r{display:grid;grid-template-columns:8px minmax(0,1.618fr) minmax(0,1fr) auto;column-gap:13px;align-items:start;padding:8px 13px;border-top:1px solid var(--dbc-bd-edf1f8);transition:background .6s}' +
    '.lg-r:first-child{border-top:0}.lg-r:hover{background:var(--dbc-bg-fafbfe)}.lg-r.lg-flash{background:var(--dbc-bg-fff3dc)}' +
    '.lg-dot{width:8px;height:8px;margin-top:6px;border-radius:50%;background:var(--dbc-bg-2e9d5b)}.lg-r.off .lg-dot{background:var(--dbc-bg-c6d0e4)}' +
    '.lg-r-name{font-size:13.5px;font-weight:600;color:var(--dbc-fg-10224e);text-decoration:none;overflow-wrap:anywhere}a.lg-r-name:hover{color:var(--dbc-fg-1e6bff)}' +
    '.lg-mono{font:600 12.5px ui-monospace,Consolas,monospace}' +
    '.lg-r.off .lg-r-name{color:var(--dbc-fg-97a5c6);font-weight:400}' +
    '.lg-r-sub{margin-top:2px;font-size:12px;line-height:1.5;color:var(--dbc-fg-56637f);overflow-wrap:anywhere}.lg-r-sub code{font-size:11.5px}' +
    '.lg-r-main>.lg-dim{font-size:12px}.lg-k{display:inline-block;min-width:34px;color:var(--dbc-fg-97a5c6)}' +
    '.lg-r-meta{padding-top:1px;font-size:12.5px;color:var(--dbc-fg-56637f)}.lg-r-meta b{font-weight:600;color:var(--dbc-fg-10224e)}' +
    // Edit in... shows on the row under the pointer (or in focus), not on every row.
    '.lg-r-tools{display:flex;gap:5px;opacity:0;transition:opacity .12s}.lg-r:hover .lg-r-tools,.lg-r:focus-within .lg-r-tools{opacity:1}.lg-r-tools .mini{margin-left:0}' +
    '.lg-r-wait{margin:0;padding:8px 13px}';

  // ---------- behaviour in the tab ----------

  function modal(tab, html, boxClass) {
    const doc = tab.document;
    const wrap = doc.createElement('div');
    wrap.className = 'lg-modal';
    wrap.innerHTML = '<div class="lg-box' + (boxClass ? ' ' + boxClass : '') + '">' + html + '</div>';
    doc.body.appendChild(wrap);
    const box = wrap.firstChild;
    const onKey = (e) => {
      const open = doc.querySelectorAll('.lg-modal');
      if (e.key === 'Escape' && open[open.length - 1] === wrap) close();
    };
    const close = () => {
      wrap.remove();
      doc.removeEventListener('keydown', onKey);
    };
    doc.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.closest('[data-close]')) close();
    });
    return { box: box, close: close };
  }

  function solutionUrl(envId, solutionId) {
    return MAKER + '/environments/' + envId + '/solutions/' + clean(solutionId);
  }

  /* The editor itself, in the chosen solution. Business rules, classic
   * workflows, actions and business process flows all open through the
   * process editor page (appSolutionId sets the solution), which hands each
   * to its own designer. A web resource opens in the maker portal: the
   * solution's web resources list, where makerSide() below selects it and
   * opens its Edit panel - the panel has no address of its own. A modern
   * command opens the command designer on its table, app and bar (extra:
   * entity, appId, location). A cloud flow opens in Power Automate's new
   * designer, in the solution: .../solutions/{solution}/flows/{workflowid}?v3=true. */
  function editorUrl(kind, id, solutionId, envId, extra) {
    if (kind === 'webresource') return envId ? solutionUrl(envId, solutionId) + '/objects/web%20resources' : null;
    if (kind === 'flow') return envId ? FLOW_PORTAL + '/environments/' + envId + '/solutions/' + clean(solutionId) + '/flows/' + clean(id) + '?v3=true' : null;
    if (kind === 'command') {
      return envId && extra && extra.appId
        ? MAKER + '/e/' + envId + '/s/' + clean(solutionId) + '/n/' + extra.entity + '/a/' + clean(extra.appId) + '/l/' + (extra.location || 0) + '/command'
        : null;
    }
    const sol = 'appSolutionId=%7B' + clean(solutionId) + '%7D';
    const obj = 'id=%7B' + clean(id) + '%7D';
    if (kind === 'rule' || kind === 'workflow') return location.origin + '/sfa/workflow/edit.aspx?' + sol + '&' + obj;
    return null;
  }

  /* Where a name in Automations goes: a process opens in the classic process
   * editor (as the record's own page would), a Custom API as its record in
   * the app the page is in. */
  function openUrl(kind, id) {
    if (kind === 'process') return location.origin + '/sfa/workflow/edit.aspx?id=%7B' + clean(id) + '%7D';
    if (kind === 'customapi') {
      const appid = new URLSearchParams(location.search).get('appid');
      return location.origin + '/main.aspx?' + (appid ? 'appid=' + encodeURIComponent(appid) + '&' : '') + 'forceUCI=1&pagetype=entityrecord&etn=customapi&id=' + clean(id);
    }
    return null;
  }

  const WHAT = { webresource: 'web resource', rule: 'business rule', flow: 'cloud flow', workflow: 'process', command: 'command', step: 'plug-in step', customapi: 'Custom API' };
  const DEFAULT_SOLUTION = { id: 'fd140aaf-4df4-11dd-bd17-0019b9312238', name: 'Default Solution', unique: 'Default', managed: false, isDefault: true, stand: true };

  async function editIn(tab, logic, kind, id, name, extra) {
    const title = '<h3>Edit “' + esc(name) + '”</h3>';
    const m = modal(tab, title + '<p class="lg-note">Finding the solutions it is in…</p>');
    const envId = logic.environmentId;
    const hasEditor = !!editorUrl(kind, id, id, envId, extra);
    if (!hasEditor && !envId) {
      m.box.innerHTML = title + '<p class="lg-warn">The environment id could not be read, so the maker portal cannot be opened from here.</p><div class="lg-row"><button data-close>Close</button></div>';
      return;
    }
    let sols;
    let error = '';
    try {
      sols = await solutionsOf(id, kind === 'webresource' ? COMPONENT.webresource : kind === 'rule' || kind === 'workflow' || kind === 'flow' ? COMPONENT.workflow : null);
    } catch (e) {
      sols = [];
      error = e.message;
    }
    // The designer still opens when no solution lists the command - in the
    // Default Solution, behind its warning.
    if (!sols.length && kind === 'command' && hasEditor) sols = [DEFAULT_SOLUTION];
    const what = WHAT[kind] || 'component';
    const flags = (s) => (s.isDefault ? ' data-default="1"' : '');
    // A flow as in Power Automate: the row is the solution, Edit is the flow.
    const flowWay = kind === 'flow' && hasEditor;
    const main = flowWay ? 'solution' : hasEditor ? 'editor' : 'solution';
    const list = sols
      .map(
        (s) =>
          '<div class="lg-sol-row">' +
          '<button type="button" class="lg-sol" data-sol="' + esc(s.id) + '" data-go="' + main + '"' + flags(s) +
          (s.managed
            ? ' disabled title="Managed - cannot be edited here"'
            : main === 'editor'
            ? ' title="Open the editor in this solution"'
            : ' title="Open this solution in the maker portal"') +
          '>' +
          '<b>' + esc(s.name) + '</b><small>' + (s.isDefault ? '⚠ default · unmanaged' : s.managed ? 'managed' : 'unmanaged') + '</small></button>' +
          (hasEditor && envId && !s.managed
            ? flowWay
              ? '<button type="button" class="lg-sol-alt" data-sol="' + esc(s.id) + '" data-go="editor"' + flags(s) + ' title="Edit the flow in the new designer, in this solution">Edit ↗</button>'
              : '<button type="button" class="lg-sol-alt" data-sol="' + esc(s.id) + '" data-go="solution"' + flags(s) + ' title="Open the solution in the maker portal instead">Solution ↗</button>'
            : '') +
          '</div>'
      )
      .join('');
    const own = sols.filter((s) => !s.managed && !s.isDefault).length;
    m.box.innerHTML =
      title +
      (sols.length && sols[0].stand
        ? '<p class="lg-note">No solution lists this ' + esc(what) + '. The designer can still open it in the Default Solution.</p>' + list
        : sols.length
        ? '<p class="lg-note">This ' + esc(what) + ' is in ' + plural(sols.length, 'solution') + '. ' +
          (flowWay
            ? 'Click a solution to open it, or Edit to open the flow in the new designer in that solution.'
            : hasEditor
            ? 'Pick the one to edit it in - the editor opens in that solution.'
            : 'Open it in the solution it ships with.') +
          (own ? '' : ' None of them is an unmanaged solution of your own.') + '</p>' + list
        : '<p class="lg-warn">No solution lists this ' + esc(what) + '.' + (error ? ' ' + esc(error) : '') + '</p>') +
      '<div class="lg-row"><button data-close>Cancel</button></div>';

    m.box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sol]');
      if (!b || b.disabled) return;
      const toEditor = b.getAttribute('data-go') === 'editor';
      const sol = b.getAttribute('data-sol');
      const url = toEditor ? editorUrl(kind, id, sol, envId, extra) : solutionUrl(envId, sol);
      const go = () => {
        // The maker portal tab picks this up and opens the web resource's panel.
        if (toEditor && kind === 'webresource') {
          const wr = logic.scripts.libraries
            .concat(logic.scripts.onForm || [])
            .map((x) => x.webResource)
            .find((w) => w && clean(w.id) === clean(id));
          chrome.storage.local.set({
            [OPEN_KEY]: { kind: kind, name: name, display: (wr && wr.displayName) || '', id: clean(id), solution: clean(sol), at: Date.now() }
          });
        }
        // The designer tab picks the command, so its formula is in view.
        if (toEditor && kind === 'command') {
          chrome.storage.local.set({ [OPEN_KEY]: { kind: kind, label: name, app: clean(extra.appId), at: Date.now() } });
        }
        tab.open(url, '_blank', 'noopener');
        m.close();
      };
      if (!b.hasAttribute('data-default')) {
        go();
        return;
      }
      const solName = b.closest('.lg-sol-row').querySelector('b').textContent;
      m.box.innerHTML =
        '<h3>Edit in the Default Solution?</h3>' +
        '<p class="lg-warn">“' + esc(name) + '” would be edited in the <b>' + esc(solName) + '</b>. ' +
        'A change made there belongs to none of your solutions: it is not exported with them and will not reach test or production.</p>' +
        (own ? '<p class="lg-note" style="margin-top:10px">It is also in ' + plural(own, 'unmanaged solution') + ' of your own - cancel and pick that one instead.</p>' : '') +
        '<div class="lg-row"><button data-close>Cancel</button><button class="primary" data-go-default>' +
        (toEditor ? 'Edit in the Default Solution' : 'Open the Default Solution') + '</button></div>';
      m.box.querySelector('[data-go-default]').addEventListener('click', go);
    });
  }

  // Where a function is defined: "MyLib.Account.onLoad" is found as onLoad in
  // "onLoad: function", "onLoad = (ctx) =>", "function onLoad(", "onLoad(ctx) {".
  function definitionRe(short) {
    const n = short.replace(/\$/g, '\\$');
    return new RegExp(
      '(^|[^\\w$])' + n + '\\s*[:=]\\s*(async\\s*)?(function\\b|\\(|[A-Za-z_$][\\w$]*\\s*=>)' +
        '|function\\s*\\*?\\s*' + n + '\\s*\\(' +
        '|^\\s*(static\\s+)?(async\\s+)?' + n + '\\s*\\([^)]*\\)\\s*\\{'
    );
  }

  /* The code of a web resource in a window over the tab, scrolled to the
   * function. Esc, the cross or a click beside it closes it. */
  async function viewCode(tab, name, fn, line) {
    const head =
      '<div class="lg-code-head"><h3>' + esc(name) + '</h3>' +
      '<button type="button" class="lg-x" data-close title="Close (Esc)" aria-label="Close">\u00d7</button></div>';
    const m = modal(tab, head + '<p class="lg-note lg-code-wait">Reading\u2026</p>', 'lg-codebox');
    let text = codeCache.get(name.toLowerCase());
    if (text === undefined) {
      try {
        const r = await getJson("webresourceset?$select=content,name&$filter=name eq '" + encodeURIComponent(name.replace(/'/g, "''")) + "'");
        if (!r.value || !r.value.length) throw new Error('No web resource with this name.');
        text = decode(r.value[0].content);
        codeCache.set(name.toLowerCase(), text);
      } catch (e) {
        m.box.innerHTML = head + '<p class="lg-warn lg-code-wait">Could not read ' + esc(name) + '. ' + esc(e.message) + '</p>';
        return;
      }
    }
    const short = fn ? String(fn).split('.').pop() : '';
    const defRe = short ? definitionRe(short) : null;
    const lines = text.split(/\r?\n/);
    const coloured = DynaBoost.code.lines(text, 'js', short ? (t) => t.split(esc(short)).join('<mark>' + esc(short) + '</mark>') : null);
    let first = -1;
    const body = lines
      .map((l, i) => {
        const isDef = !!defRe && defRe.test(l);
        if (isDef && first < 0) first = i;
        const at = i + 1 === Number(line);
        const h = coloured[i];
        return '<div class="l' + (isDef ? ' def' : '') + (at ? ' at' : '') + '" data-l="' + (i + 1) + '"><span class="n">' + (i + 1) + '</span><span class="c">' + (h || ' ') + '</span></div>';
      })
      .join('');
    const jump = (n, text) => '<a href="#" data-goline="' + n + '">' + text + '</a>';
    const attachLine = line ? ' \u00b7 ' + jump(line, 'attached on line ' + line) : '';
    const where = short
      ? 'function <b>' + esc(fn) + '</b> \u00b7 ' +
        (first >= 0 ? jump(first + 1, 'defined on line ' + (first + 1)) : 'no definition found by name - every use is marked') + attachLine + ' \u00b7 '
      : line
      ? 'inline function' + attachLine + ' \u00b7 '
      : '';
    m.box.innerHTML =
      head +
      '<div class="lg-code-crumbs">' + where + plural(lines.length, 'line') + ' \u00b7 read-only \u00b7 ' +
      '<a href="' + esc(location.origin + '/WebResources/' + name) + '" target="_blank" rel="noopener">raw file</a></div>' +
      '<div class="lg-code">' + body + '</div>';

    const pane = m.box.querySelector('.lg-code');
    const goLine = (n) => {
      const el = pane.querySelector('[data-l="' + n + '"]');
      if (el) pane.scrollTop = el.offsetTop - pane.clientHeight / 2 + el.offsetHeight / 2;
    };
    m.box.addEventListener('click', (e) => {
      const a = e.target.closest('[data-goline]');
      if (!a) return;
      e.preventDefault();
      goLine(a.getAttribute('data-goline'));
    });
    goLine(first >= 0 ? first + 1 : Number(line) || 0);
  }

  // From a script or a rule to the column: the Form view when the form has
  // it, otherwise the Fields view - with whatever filter was hiding it off.
  function gotoField(tab, field, showView) {
    const doc = tab.document;
    const q = doc.getElementById('q');
    if (q && q.value) {
      q.value = '';
      q.dispatchEvent(new tab.Event('input'));
    }
    let row = doc.querySelector('#v-form .row[data-field="' + field + '"]');
    let view = 'v1';
    if (!row) {
      row = doc.querySelector('#v-fields .row[data-field="' + field + '"]');
      view = 'v2';
    }
    if (!row) return;
    const set = (id, on) => {
      const box = doc.getElementById(id);
      if (box && box.checked !== on) {
        box.checked = on;
        doc.body.classList.toggle(id, on);
      }
    };
    if (row.hasAttribute('data-off')) set('whole-entity', true);
    if (row.hasAttribute('data-empty')) set('hide-empty', false);
    showView(view);
    row.scrollIntoView({ block: 'center' });
    row.classList.add('lg-flash');
    setTimeout(() => row.classList.remove('lg-flash'), 1400);
  }

  /* Clicks in the tab for the logic views, and the cloud flow scan. refresh()
   * is called once the flows are in, to redraw the counts and the JSON. */
  function wire(tab, dump, showView, refresh) {
    const doc = tab.document;
    const logic = dump.logic;
    let pop = null;
    let showTimer = 0;
    let hideTimer = 0;
    const hidePop = () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      if (!pop) return;
      if (pop.__for) pop.__for.classList.remove('open');
      pop.remove();
      pop = null;
    };
    const showPop = (mk) => {
      hidePop();
      const field = mk.getAttribute('data-mark');
      const m = marks(logic)[field];
      if (!m) return;
      pop = doc.createElement('div');
      pop.className = 'lg-pop';
      pop.innerHTML = popHtml(m, field, mk.getAttribute('data-label'));
      pop.__for = mk;
      mk.classList.add('open');
      doc.body.appendChild(pop);
      const r = mk.getBoundingClientRect();
      const w = pop.offsetWidth;
      const h = pop.offsetHeight;
      pop.style.left = Math.max(8, Math.min(r.left - 6, tab.innerWidth - w - 8)) + 'px';
      pop.style.top = (r.bottom + 6 + h > tab.innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
    };
    const jumpTo = (view, item) => {
      showView(view);
      if (view === 'v7') showAutomations(doc, '');
      const el = doc.querySelector('#content [data-item="' + item + '"]');
      if (!el) return;
      el.scrollIntoView({ block: 'center' });
      el.classList.add('lg-flash');
      setTimeout(() => el.classList.remove('lg-flash'), 1400);
    };
    doc.addEventListener('mouseover', (e) => {
      if (e.target.closest('.lg-pop')) return clearTimeout(hideTimer);
      const mk = e.target.closest('.lg-mark');
      if (!mk) return;
      clearTimeout(hideTimer);
      if (pop && pop.__for === mk) return;
      clearTimeout(showTimer);
      showTimer = setTimeout(() => showPop(mk), 120);
    });
    doc.addEventListener('mouseout', (e) => {
      const from = e.target.closest('.lg-mark, .lg-pop');
      if (!from) return;
      const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('.lg-mark, .lg-pop') : null;
      if (to === from) return;
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hidePop, 200);
    });
    doc.addEventListener('scroll', hidePop, true);
    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hidePop();
      const mk = e.target.closest && e.target.closest('.lg-mark');
      if (mk && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        showPop(mk);
      }
    });

    doc.addEventListener('click', (e) => {
      const mk = e.target.closest('.lg-mark');
      if (mk) {
        if (pop && pop.__for === mk) hidePop();
        else showPop(mk);
        return;
      }
      if (pop && e.target.closest('.lg-pop')) {
        const to = e.target.closest('[data-to]');
        if (to) {
          const [view, item] = to.getAttribute('data-to').split('|');
          hidePop();
          jumpTo(view, item);
          return;
        }
        if (!e.target.closest('[data-code]')) return;
        setTimeout(hidePop, 0);
      } else if (pop) {
        hidePop();
      }
      const go = e.target.closest('.lg-goto');
      if (go) {
        e.preventDefault();
        gotoField(tab, go.getAttribute('data-field'), showView);
        return;
      }
      const code = e.target.closest('[data-code]');
      if (code) {
        viewCode(tab, code.getAttribute('data-code'), code.getAttribute('data-fn'), code.getAttribute('data-line'));
        return;
      }
      const ed = e.target.closest('[data-edit]');
      if (ed) {
        const parts = ed.getAttribute('data-edit').split('|');
        const extra = ed.hasAttribute('data-app') ? { entity: ed.getAttribute('data-entity'), appId: ed.getAttribute('data-app'), location: ed.getAttribute('data-loc') } : null;
        editIn(tab, logic, parts[0], parts[1], parts.slice(2).join('|'), extra);
        return;
      }
      const af = e.target.closest('[data-af]');
      if (af) {
        e.preventDefault();
        showAutomations(doc, af.getAttribute('data-af'));
        return;
      }
      const open = e.target.closest('[data-open]');
      if (open) {
        e.preventDefault();
        const [kind, id] = open.getAttribute('data-open').split('|');
        const url = openUrl(kind, id);
        if (url) tab.open(url, '_blank', 'noopener');
        return;
      }
      const flow = e.target.closest('[data-flow]');
      if (flow) e.preventDefault();
      if (flow && logic.environmentId) {
        tab.open(FLOW_PORTAL + '/environments/' + logic.environmentId + '/flows/' + clean(flow.getAttribute('data-flow')) + '/details', '_blank', 'noopener');
      }
    });

    if (DynaBoost.formCommands) DynaBoost.formCommands.wire(tab, dump, refresh);

    if (logic.automations.flows !== null) return;
    // The form picker redraws the tab for another form; an answer that
    // arrives after that belongs to a page that is gone.
    const gen = (tab.__dbLogicGen = (tab.__dbLogicGen || 0) + 1);
    flowsFor(dump.entity.logicalName, dump.entity.entitySetName).then((flows) => {
      logic.automations.flows = flows;
      if (tab.closed || tab.__dbLogicGen !== gen) return;
      const view = doc.getElementById('v-automations');
      if (view) view.innerHTML = automationsHtml(logic);
      showAutomations(doc, doc.__dbAuto);
      updateMarks(doc, logic);
      refresh();
    });
  }

  // ---------- in the maker portal: the web resource's Edit panel ----------

  /* Edit in... for a web resource leaves a note here and opens the
   * solution's web resources list. In that tab this finds the row by the web
   * resource's name - scrolling the list, which only draws what is in view -
   * selects it and presses Edit, which opens the same panel a click would.
   * The note is dropped when done, and ignored when older than two minutes
   * or meant for another solution. */
  const OPEN_KEY = 'dynaboost.makerOpen';
  const EDIT_WORDS = ['edit', 'edytuj', 'bearbeiten', 'modifier', 'editar', 'modifica', 'bewerken', 'redigera', 'rediger', 'muokkaa', 'upravit', 'szerkesztés', 'düzenle'];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();

  function makerToast() {
    let layer = document.getElementById('dynaboost-toast');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'dynaboost-toast';
      document.body.appendChild(layer);
    }
    const card = document.createElement('div');
    card.className = 'db-toast';
    card.innerHTML =
      '<div class="db-toast-row"><span class="db-toast-mark"></span><div class="db-toast-text"><div class="db-toast-title"></div><div class="db-toast-sub"></div></div>' +
      '<button type="button" class="db-toast-close" aria-label="Close">✕</button></div>';
    layer.appendChild(card);
    card.querySelector('.db-toast-close').addEventListener('click', () => card.remove());
    return {
      set(title, sub, tone) {
        card.classList.toggle('db-toast-error', tone === 'error');
        card.querySelector('.db-toast-mark').textContent = tone === 'error' ? '!' : tone === 'busy' ? '…' : '✓';
        card.querySelector('.db-toast-title').textContent = title;
        card.querySelector('.db-toast-sub').textContent = sub || '';
      },
      closeIn(ms) {
        setTimeout(() => {
          card.classList.add('db-toast-out');
          setTimeout(() => card.remove(), 200);
        }, ms);
      }
    };
  }

  // A list row one of whose cells reads exactly the web resource's name.
  function findRow(name) {
    const want = norm(name);
    for (const row of document.querySelectorAll('[role="row"]')) {
      for (const cell of row.querySelectorAll('[role="gridcell"], [role="rowheader"], [role="cell"]')) {
        if (norm(cell.textContent) === want) return row;
      }
    }
    return null;
  }

  function listScroller() {
    const row = document.querySelector('[role="row"] [role="gridcell"]');
    for (let el = row && row.parentElement; el && el !== document.body; el = el.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 4) return el;
    }
    return null;
  }

  async function locateRow(name) {
    // The list first has to arrive.
    for (let i = 0; i < 90 && !document.querySelector('[role="row"] [role="gridcell"]'); i++) await sleep(500);
    await sleep(600);
    let row = findRow(name);
    const sc = listScroller();
    if (row || !sc) return row;
    // Only the rows in view are drawn: walk down the list, then give up.
    sc.scrollTop = 0;
    for (let i = 0; i < 400; i++) {
      await sleep(160);
      if ((row = findRow(name))) return row;
      const before = sc.scrollTop;
      sc.scrollTop += Math.max(120, sc.clientHeight * 0.8);
      if (sc.scrollTop === before) {
        await sleep(900); // more rows may be loading at the bottom
        if ((row = findRow(name))) return row;
        sc.scrollTop += sc.clientHeight;
        if (sc.scrollTop === before) return null;
      }
    }
    return null;
  }

  function press(el) {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const init = { bubbles: true, cancelable: true, view: window, button: 0 };
      el.dispatchEvent(/^pointer/.test(type) && window.PointerEvent ? new PointerEvent(type, Object.assign({ pointerType: 'mouse', isPrimary: true }, init)) : new MouseEvent(type, init));
    }
  }

  /* The display name in the row is a link that opens the Edit panel, the
   * same as the command. Prefer the one reading the display name, then any
   * link, then any focusable text - never the check or the row's ... menu. */
  function nameLink(row, display) {
    const skip = (el) => el.closest('[data-selection-toggle], [role="checkbox"]') || el.hasAttribute('aria-haspopup') || !norm(el.textContent);
    const pick = (sel, test) => Array.from(row.querySelectorAll(sel)).find((el) => !skip(el) && (!test || test(el)));
    const want = norm(display);
    return (
      (want && pick('a, [role="link"], button, [role="button"], [data-is-focusable="true"], span', (el) => norm(el.textContent) === want && !el.querySelector('a, [role="link"], button'))) ||
      pick('a, [role="link"]') ||
      pick('button, [role="button"]') ||
      null
    );
  }

  function editCommand() {
    const usable = (b) => b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && !b.closest('#dynaboost-root, #dynaboost-toast, [role="row"]');
    for (const i of document.querySelectorAll('[data-icon-name="Edit"]')) {
      const b = i.closest('button, [role="menuitem"]');
      if (usable(b)) return b;
    }
    for (const b of document.querySelectorAll('button, [role="menuitem"]')) {
      if (usable(b) && (EDIT_WORDS.includes(norm(b.textContent)) || EDIT_WORDS.includes(norm(b.getAttribute('aria-label'))))) return b;
    }
    return null;
  }

  // Something panel-like came up: a dialog or side panel, or the panel's
  // Code box - the list itself has no text area.
  const panels = () =>
    document.querySelectorAll('[role="dialog"], [role="complementary"], .ms-Panel, [class*="Panel-main"], [class*="Drawer"], textarea').length;

  async function panelAfter(action) {
    const before = panels();
    action();
    for (let i = 0; i < 20; i++) {
      await sleep(250);
      if (panels() > before) return true;
    }
    return false;
  }

  // Quiet when it works; a toast only says what to do by hand when it does not.
  async function openWebResource(job) {
    const row = await locateRow(job.name);
    if (!row) {
      makerToast().set('Could not find ' + job.name, 'It is not in this list. Search for it and open it by hand.', 'error');
      return;
    }
    row.scrollIntoView({ block: 'center' });
    await sleep(300);
    // The list redraws its rows as it scrolls: look the row up again each time.
    const current = () => findRow(job.name) || row;
    // The name link first - it opens the panel in one step.
    const link = nameLink(current(), job.display);
    if (link && (await panelAfter(() => press(link)))) return;
    // Then the long way: select the row, press Edit.
    const r = current();
    const selected = r.getAttribute('aria-selected') === 'true' || r.classList.contains('is-selected');
    if (!selected) press(r.querySelector('[data-selection-toggle="true"], [role="checkbox"]') || r.querySelector('[role="gridcell"]') || r);
    await sleep(400);
    const edit = editCommand();
    if (edit && (await panelAfter(() => press(edit)))) return;
    makerToast().set('Selected ' + job.name, 'Click its name or Edit in the command bar to open it.', 'error');
  }

  /* The command designer lists the bar's commands; picking one puts its
   * OnSelect in the formula bar. Find the command by its label - in the
   * Commands list first, the bar preview second - and pick it. The designer
   * takes a while to come up. */
  async function openCommand(job) {
    const want = norm(job.label);
    const seen = (el) => el.getClientRects().length > 0;
    const ITEM = '[role="treeitem"], [role="listitem"], [role="option"], [role="menuitem"], li, button, [role="button"]';
    const find = () => {
      const hits = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (norm(n.nodeValue) !== want) continue;
        const el = n.parentElement;
        if (el && seen(el) && !el.closest('#dynaboost-root, #dynaboost-toast, input, textarea')) hits.push(el);
      }
      return hits.find((el) => el.closest('[role="treeitem"], [role="listitem"], [role="option"], li')) || hits[0] || null;
    };
    let el = null;
    for (let i = 0; i < 120 && !(el = find()); i++) await sleep(500);
    if (!el) {
      makerToast().set('Could not find ' + job.label, 'Pick it in the Commands list to see its formula.', 'error');
      return;
    }
    const target = el.closest(ITEM) || el;
    target.scrollIntoView({ block: 'center' });
    await sleep(300);
    press(target);
  }

  function makerSide() {
    if (location.hostname !== 'make.powerapps.com') return;
    chrome.storage.local.get(OPEN_KEY, async (d) => {
      const job = d && d[OPEN_KEY];
      if (!job || Date.now() - job.at > 120000) return;
      const path = location.pathname.toLowerCase();
      const mine =
        (job.kind === 'webresource' && path.indexOf('/solutions/' + job.solution) >= 0) ||
        (job.kind === 'command' && /\/command\/?$/.test(path) && path.indexOf('/a/' + job.app) >= 0);
      if (!mine) return;
      chrome.storage.local.remove(OPEN_KEY);
      while (!document.body) await sleep(100);
      if (job.kind === 'webresource') openWebResource(job);
      else openCommand(job);
    });
  }

  makerSide();

  DynaBoost.formLogic = {
    load: load,
    // Starts the cloud flow scan early; wire() picks the answer up from the cache.
    prefetch: (entity, entitySet) => {
      flowsFor(entity, entitySet);
    },
    updateMarks: updateMarks,
    modal: modal,
    icon: icon,
    marks: marks,
    markHtml: markHtml,
    markSearch: markSearch,
    summaryHtml: summaryHtml,
    scriptsHtml: scriptsHtml,
    rulesHtml: rulesHtml,
    automationsHtml: automationsHtml,
    css: CSS,
    wire: wire
  };
})();
