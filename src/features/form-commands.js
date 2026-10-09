/* Form as JSON - Commands: the buttons of the table's command bars (form,
 * main grid, subgrid) in order, custom ones in gold. A click shows the
 * command, its actions and its display and enable rules in words, with the
 * code of any JavaScript one click away.
 *
 * Classic buttons come from RetrieveEntityRibbon (a zip holding one XML,
 * inflated in the browser). Commands from the command designer are appaction
 * rows; their Power Fx is in the app's command component library (a canvas
 * package, also a zip), read when a command is opened. Read-only.
 */
(function () {
  const API = '/api/data/v9.2/';
  const FMT = '@OData.Community.Display.V1.FormattedValue';

  const LOCATIONS = [
    { key: 'form', label: 'Form', tab: 'Mscrm.Form.{e}.MainTab' },
    { key: 'grid', label: 'Main grid', tab: 'Mscrm.HomepageGrid.{e}.MainTab' },
    { key: 'subgrid', label: 'Subgrid', tab: 'Mscrm.SubGrid.{e}.MainTab' },
    // Unified Interface gives the associated view the subgrid's classic
    // buttons; its modern commands are its own.
    { key: 'assoc', label: 'Associated view', same: 'subgrid' }
  ];
  const MODERN_LOCATION = { 0: 'form', 1: 'grid', 2: 'subgrid', 3: 'assoc' };
  const MODERN_WHERE = { 0: 'Form', 1: 'Main grid', 2: 'Subgrid', 3: 'Associated view' };

  // Ids Microsoft ships with; anything else was added by someone.
  const MICROSOFT = /^(mscrm|msdyn|msdynce|msdyncrm|microsoft|msft|mspp|msfp|adx)[._]/i;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /* Give up on a request after this long. The ribbon gets longer: a big
   * table's takes Dynamics minutes to build, and cutting it off means
   * starting again from nothing. */
  const TIMEOUT = 120000;
  const RIBBON_TIMEOUT = 300000;

  async function getJson(path, prefer, timeout) {
    const headers = { Accept: 'application/json', 'OData-Version': '4.0' };
    if (prefer) headers.Prefer = prefer;
    const ctl = new AbortController();
    const limit = timeout || TIMEOUT;
    const timer = setTimeout(() => ctl.abort(), limit);
    try {
      const res = await fetch(API + path, { credentials: 'same-origin', headers: headers, signal: ctl.signal });
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
      return await res.json();
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Dynamics did not answer within ' + Math.round(limit / 60000) + ' minutes.');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- the ribbon ----------

  function base64Bytes(base64) {
    const bin = atob(base64 || '');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  const isZip = (bytes) => bytes.length > 22 && bytes[0] === 0x50 && bytes[1] === 0x4b;

  /* A zip's entries, from its central directory. The ribbon comes as one and
   * so does a canvas app package (.msapp). */
  function zipEntries(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        end = i;
        break;
      }
    }
    if (end < 0) throw new Error('The package could not be opened.');
    const entries = [];
    let p = dv.getUint32(end + 16, true);
    for (let n = dv.getUint16(end + 10, true); n > 0 && dv.getUint32(p, true) === 0x02014b50; n--) {
      const nameLen = dv.getUint16(p + 28, true);
      const local = dv.getUint32(p + 42, true);
      entries.push({
        method: dv.getUint16(p + 10, true),
        size: dv.getUint32(p + 20, true),
        start: local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true),
        name: new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen))
      });
      p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    }
    return entries;
  }

  // One entry as text: inflated (method 8) or as stored (method 0).
  async function entryText(bytes, e) {
    const data = bytes.subarray(e.start, e.start + e.size);
    if (e.method === 0) return new TextDecoder('utf-8').decode(data);
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  }

  async function unzipXml(base64) {
    const bytes = base64Bytes(base64);
    if (!isZip(bytes)) return new TextDecoder('utf-8').decode(bytes); // not zipped
    const entries = zipEntries(bytes);
    const e = entries.find((x) => /ribbon.*\.xml$/i.test(x.name)) || entries.find((x) => /\.xml$/i.test(x.name) && !/content_types/i.test(x.name));
    if (!e) throw new Error('The ribbon package holds no XML.');
    return entryText(bytes, e);
  }

  const seq = (el) => Number(el.getAttribute('Sequence')) || 0;
  const bySeq = (list) => list.map((el, i) => [el, i]).sort((a, b) => seq(a[0]) - seq(b[0]) || a[1] - b[1]).map((x) => x[0]);

  function attrsOf(el) {
    const a = {};
    for (const at of el.attributes) a[at.name] = at.value;
    return a;
  }

  function resolveText(v, model) {
    if (!v) return '';
    if (/^\$LocLabels:/i.test(v)) return model.labels.get(v.slice(11)) || '';
    if (/^\$Resources/i.test(v)) return '';
    return v;
  }

  // "Mscrm.Form.account.SaveAndClose" reads as "Save And Close" when the
  // label is a resource string the page cannot look up.
  const NOISE = /^(mscrm|form|homepagegrid|subgrid|maintab|button|btn|command|flyout|menu|menusection|controls|\d+)$/i;
  function nameFromId(id, entity) {
    const parts = String(id).split('.').filter((s) => s && !NOISE.test(s) && s.toLowerCase() !== entity);
    return (parts.pop() || String(id)).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  }

  function readButton(el, group, model) {
    const id = el.getAttribute('Id');
    if (!id || /^(Separator|Label)$/.test(el.tagName)) return null;
    const b = {
      el: el,
      id: id,
      type: el.tagName,
      group: group || '',
      label: resolveText(el.getAttribute('LabelText') || el.getAttribute('Alt') || el.getAttribute('ToolTipTitle'), model) || nameFromId(id, model.entity),
      tooltip: resolveText(el.getAttribute('ToolTipDescription'), model),
      sequence: seq(el),
      command: el.getAttribute('Command') || '',
      modernImage: el.getAttribute('ModernImage') || '',
      image: el.getAttribute('Image16by16') || el.getAttribute('Image32by32') || '',
      alias: el.getAttribute('TemplateAlias') || '',
      custom: !MICROSOFT.test(id),
      populate: el.getAttribute('PopulateDynamically') === 'true' ? el.getAttribute('PopulateQueryCommand') || 'at runtime' : '',
      children: []
    };
    for (const sec of el.querySelectorAll(':scope > Menu > MenuSection')) {
      for (const c of bySeq(Array.from(sec.querySelectorAll(':scope > Controls > *')))) {
        const k = readButton(c, sec.getAttribute('Id'), model);
        if (k) b.children.push(k);
      }
    }
    const cmd = model.commands.get(b.command);
    const refs = cmd ? Array.from(cmd.querySelectorAll(':scope > EnableRules > EnableRule, :scope > DisplayRules > DisplayRule')).map((r) => r.getAttribute('Id')) : [];
    b.customized = !b.custom && ((b.command && !MICROSOFT.test(b.command)) || refs.some((r) => !MICROSOFT.test(r || '')));
    b.scope = scopeOf(cmd, model);
    return b;
  }

  // 'classic' when a display rule keeps the button to the old web client,
  // 'outlook' when to Outlook - Unified Interface never shows those.
  function scopeOf(cmd, model) {
    if (!cmd) return '';
    for (const ref of cmd.querySelectorAll(':scope > DisplayRules > DisplayRule')) {
      const def = model.displayRules.get(ref.getAttribute('Id'));
      if (!def) continue;
      for (const r of def.querySelectorAll(':scope > CommandClientTypeRule')) {
        const inv = r.getAttribute('InvertResult') === 'true';
        const t = r.getAttribute('Type');
        if ((t === 'Legacy' && !inv) || (t === 'Refresh' && inv)) return 'classic';
      }
      for (const r of def.querySelectorAll(':scope > CrmClientTypeRule')) {
        if (r.getAttribute('Type') === 'Outlook' && r.getAttribute('InvertResult') !== 'true') return 'outlook';
      }
    }
    return '';
  }

  function parseRibbon(text, entity) {
    const doc = new DOMParser().parseFromString(String(text).replace(/^﻿/, ''), 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('The ribbon definition could not be parsed.');
    const byId = (sel) => {
      const m = new Map();
      for (const el of doc.querySelectorAll(sel)) m.set(el.getAttribute('Id'), el);
      return m;
    };
    const model = {
      entity: entity,
      commands: byId('CommandDefinitions > CommandDefinition'),
      displayRules: byId('RuleDefinitions > DisplayRules > DisplayRule'),
      enableRules: byId('RuleDefinitions > EnableRules > EnableRule'),
      labels: new Map(),
      locations: {}
    };
    for (const l of doc.querySelectorAll('LocLabel')) {
      const t = l.querySelector('Title');
      if (t) model.labels.set(l.getAttribute('Id'), t.getAttribute('description'));
    }
    const tabs = Array.from(doc.querySelectorAll('Tab'));
    for (const loc of LOCATIONS) {
      if (loc.same) {
        model.locations[loc.key] = model.locations[loc.same];
        continue;
      }
      const want = loc.tab.replace('{e}', entity).toLowerCase();
      const tab = tabs.find((t) => String(t.getAttribute('Id')).toLowerCase() === want);
      const out = [];
      if (tab) {
        for (const g of bySeq(Array.from(tab.querySelectorAll(':scope > Groups > Group')))) {
          for (const c of bySeq(Array.from(g.querySelectorAll(':scope > Controls > *')))) {
            const b = readButton(c, g.getAttribute('Id'), model);
            if (b) out.push(b);
          }
        }
      }
      model.locations[loc.key] = out;
    }
    return model;
  }

  // ---------- commands and rules, in words ----------

  function library(v) {
    v = v || '';
    return /^\$webresource:/i.test(v) ? { name: v.replace(/^\$webresource:/i, ''), web: true } : { name: v, web: false };
  }

  function params(el) {
    return Array.from(el.children)
      .filter((c) => /Parameter$/.test(c.tagName))
      .map((c) => {
        const v = c.getAttribute('Value') != null ? c.getAttribute('Value') : c.textContent;
        return c.tagName === 'StringParameter' ? "'" + v + "'" : v;
      });
  }

  function plainAttrs(a) {
    return Object.keys(a)
      .filter((k) => k !== 'InvertResult' && k !== 'Default')
      .map((k) => k + '=' + a[k])
      .join(' ');
  }

  const CLIENT = { Refresh: 'Unified Interface', Legacy: 'the classic web client' };
  const RULE_TEXT = {
    FormStateRule: (a) => 'Form is ' + a.State,
    SelectionCountRule: (a) => 'Rows selected: ' + (a.Minimum || '0') + (a.Maximum ? '–' + a.Maximum : ' or more'),
    EntityPrivilegeRule: (a) => 'User has ' + a.PrivilegeType + (a.PrivilegeDepth ? ' (' + a.PrivilegeDepth + ')' : '') + ' on ' + (a.EntityName || 'this table'),
    RecordPrivilegeRule: (a) => 'User can ' + a.PrivilegeType + ' the record',
    MiscellaneousPrivilegeRule: (a) => 'User has the privilege ' + a.PrivilegeName,
    ValueRule: (a) => 'Column ' + a.Field + ' is ' + (a.Value == null || a.Value === '' ? 'empty' : a.Value),
    OptionSetRule: (a) => 'Choice ' + (a.OptionSet || a.Field) + ' is ' + a.Value,
    CustomRule: () => 'JavaScript returns true:',
    CommandClientTypeRule: (a) => 'Client is ' + (CLIENT[a.Type] || a.Type),
    CrmClientTypeRule: (a) => 'Client type is ' + a.Type,
    FormEntityContextRule: (a) => 'On a form of ' + a.EntityName,
    EntityPropertyRule: (a) => 'Table property ' + a.PropertyName + ' is ' + a.PropertyValue,
    OrganizationSettingRule: (a) => 'Org setting ' + a.Setting + ' is on',
    FeatureControlRule: (a) => 'Feature ' + (a.FeatureControlBit || a.FeatureName) + ' is on',
    PageRule: (a) => 'Page is ' + a.Address,
    SkuRule: (a) => 'Edition is ' + a.Sku,
    RelationshipTypeRule: (a) => 'Relationship type is ' + a.RelationshipType,
    ReferencingAttributeRequiredRule: () => 'The referencing column is required',
    OutlookItemTrackingRule: (a) => 'Outlook item is ' + (a.TrackedInCrm === 'true' ? '' : 'not ') + 'tracked',
    HideForTabletExperienceRule: () => 'Not on tablets',
    DeviceTypeRule: (a) => 'Device is ' + a.Type,
    CrmOfflineAccessStateRule: (a) => 'Offline state is ' + a.State,
    CrmOutlookClientTypeRule: (a) => 'Outlook client is ' + a.Type
  };

  function step(el) {
    if (el.tagName === 'OrRule') {
      return { kind: 'or', alts: Array.from(el.querySelectorAll(':scope > Or')).map((or) => Array.from(or.children).map(step)) };
    }
    const a = attrsOf(el);
    const f = RULE_TEXT[el.tagName];
    const s = { kind: el.tagName, text: f ? f(a) : el.tagName + (plainAttrs(a) ? ': ' + plainAttrs(a) : ''), invert: a.InvertResult === 'true' };
    if (el.tagName === 'CustomRule') {
      s.lib = library(a.Library);
      s.fn = a.FunctionName;
      s.params = params(el);
    }
    return s;
  }

  function stepText(s) {
    if (s.kind === 'or') return 'Any of: ' + s.alts.map((alt) => alt.map(stepText).join(' and ')).join(' | ');
    return (s.invert ? 'NOT ' : '') + s.text + (s.fn ? ' ' + s.fn + '(' + (s.params || []).join(', ') + ') in ' + s.lib.name : '');
  }

  function actionsOf(cmd) {
    return Array.from(cmd.querySelectorAll(':scope > Actions > *')).map((el) => {
      if (el.tagName === 'JavaScriptFunction') return { kind: 'js', lib: library(el.getAttribute('Library')), fn: el.getAttribute('FunctionName'), params: params(el) };
      if (el.tagName === 'Url') return { kind: 'url', text: el.getAttribute('Address') };
      return { kind: el.tagName, text: plainAttrs(attrsOf(el)) };
    });
  }

  function rulesOf(cmd, kind, model) {
    const map = kind === 'display' ? model.displayRules : model.enableRules;
    const refs = cmd.querySelectorAll(kind === 'display' ? ':scope > DisplayRules > DisplayRule' : ':scope > EnableRules > EnableRule');
    return Array.from(refs).map((ref) => {
      const id = ref.getAttribute('Id');
      const def = map.get(id);
      return { id: id, custom: !MICROSOFT.test(id || ''), el: def || null, steps: def ? Array.from(def.children).map(step) : [] };
    });
  }

  const isCustomish = (b) => b.custom || b.customized || b.children.some(isCustomish);

  // ---------- modern commands (command designer) ----------

  /* Where a command keeps its Power Fx: the designer writes the formulas into
   * the app's command component library (a canvas app) and the appaction row
   * points at it - library, component, function - for the click and for the
   * visibility. Read by name pattern, since the exact column names vary. */
  function libraryRef(a, prefix) {
    const out = { id: '', name: '', component: '', fn: '' };
    for (const k of Object.keys(a)) {
      if (k.indexOf('@') >= 0 || a[k] == null || a[k] === '') continue;
      const n = k.replace(/^_/, '').replace(/_value$/, '').toLowerCase();
      if (n.indexOf(prefix) !== 0 || /javascript/.test(n)) continue;
      if (/componentlibraryid$/.test(n)) {
        out.id = a[k];
        out.name = a[k + FMT] || '';
      } else if (/componentname$/.test(n)) out.component = a[k];
      else if (/functionname$/.test(n)) out.fn = a[k];
    }
    // A library alone says nothing: the component or function names the formula.
    return out.component || out.fn ? out : null;
  }

  async function loadModern(entity) {
    try {
      const r = await getJson("appactions?$filter=contextvalue eq '" + entity + "'", 'odata.include-annotations="*"');
      return (r.value || [])
        .map((a) => ({
          id: a.appactionid,
          label: a.buttonlabeltext || a.name || a.uniquename,
          unique: a.uniquename || '',
          name: a.name || '',
          where: MODERN_WHERE[a.location] || a['location' + FMT] || String(a.location),
          location: a.location,
          loc: MODERN_LOCATION[a.location] || null,
          app: a['_appmoduleid_value' + FMT] || '',
          appId: a._appmoduleid_value || '',
          scope: a['context' + FMT] || '',
          sequence: a.sequence != null ? a.sequence : a.buttonsequencepriority,
          hidden: !!a.hidden,
          icon: a.fonticon || a['_iconwebresourceid_value' + FMT] || '',
          tooltipTitle: a.buttontooltiptitle || '',
          tooltip: a.buttontooltipdescription || '',
          accessibility: a.buttonaccessibilitytext || '',
          modified: [String(a.modifiedon || '').slice(0, 10), a['_modifiedby_value' + FMT]].filter(Boolean).join(' by '),
          actionType: a['onclickeventtype' + FMT] || '',
          visibilityType: a['visibilitytype' + FMT] || '',
          action: a.onclickeventformula
            ? { kind: 'formula', text: a.onclickeventformula }
            : a.onclickeventjavascriptfunctionname
            ? { kind: 'js', fn: a.onclickeventjavascriptfunctionname, lib: { name: a['_onclickeventjavascriptwebresourceid_value' + FMT] || '', web: true }, params: a.onclickeventjavascriptparameters || '' }
            : null,
          actionLib: libraryRef(a, 'onclickevent'),
          visible: a.visibilityformula ? { kind: 'formula', text: a.visibilityformula } : null,
          visibleLib: libraryRef(a, 'visibility'),
          custom: !MICROSOFT.test(a.uniquename || ''),
          raw: a
        }))
        .sort((x, y) => (x.sequence || 0) - (y.sequence || 0));
    } catch (e) {
      return { error: e.message };
    }
  }

  // ---------- the command component library ----------

  // Every formula in a canvas package: classic JSON controls carry Rules
  // (Property + InvariantScript), newer .pa.yaml sources carry "Prop: =...".
  function jsonRules(node, owner, out, file) {
    if (Array.isArray(node)) {
      for (const x of node) jsonRules(x, owner, out, file);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const name = typeof node.Name === 'string' ? node.Name : owner;
    if (Array.isArray(node.Rules)) {
      for (const r of node.Rules) if (r && r.Property && typeof r.InvariantScript === 'string') out.push({ control: name, property: r.Property, script: r.InvariantScript, file: file });
    }
    for (const k of Object.keys(node)) if (k !== 'Rules' && node[k] && typeof node[k] === 'object') jsonRules(node[k], name, out, file);
  }

  const YAML_GROUPS = /^(Properties|CustomProperties|Children|Controls|ComponentDefinitions|Screens|Parameters)$/;

  function yamlRules(text, out, file) {
    const lines = String(text).split(/\r?\n/);
    const path = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*)(?:- )?([^\s:#][^:#]*?):\s*(.*)$/);
      if (!m) continue;
      const indent = m[1].length;
      while (path.length && path[path.length - 1].indent >= indent) path.pop();
      const key = m[2].trim();
      let value = m[3];
      if (/^[|>]-?$/.test(value)) {
        // A block: the lines indented deeper than the key.
        const body = [];
        while (i + 1 < lines.length && (!lines[i + 1].trim() || lines[i + 1].match(/^\s*/)[0].length > indent)) body.push(lines[++i]);
        const cut = Math.min.apply(null, body.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length).concat([1e9]));
        value = body.map((l) => l.slice(cut)).join('\n').trim();
      }
      if (/^=/.test(value)) {
        const names = path.map((p) => p.key).filter((k) => !YAML_GROUPS.test(k));
        const property = key === 'Default' ? names.pop() : key;
        out.push({ control: names.pop() || file.replace(/^.*\//, ''), property: property, script: value.slice(1).trim(), file: file });
      }
      path.push({ indent: indent, key: key });
    }
  }

  async function postJson(name, body) {
    const res = await fetch(API + name, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'OData-Version': '4.0', 'OData-MaxVersion': '4.0' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      let detail = '';
      try {
        const b = await res.json();
        detail = (b.error && b.error.message) || '';
      } catch (e) {
        /* no JSON body */
      }
      throw new Error('HTTP ' + res.status + (detail ? ': ' + detail : ''));
    }
    return res.json();
  }

  /* A file column the way Dataverse hands files out: a download is opened
   * (InitializeFileBlocksDownload) and read in blocks (DownloadBlock). Only
   * reads - nothing on the library changes. */
  async function downloadFile(entitySet, key, id, column) {
    const init = await postJson('InitializeFileBlocksDownload', {
      Target: { [key]: id, '@odata.type': 'Microsoft.Dynamics.CRM.' + entitySet.replace(/s$/, '') },
      FileAttributeName: column
    });
    const size = Number(init.FileSizeInBytes) || 0;
    const BLOCK = 4 * 1024 * 1024;
    const parts = [];
    let total = 0;
    for (let offset = 0; offset < size || (!size && !parts.length); offset += BLOCK) {
      const r = await postJson('DownloadBlock', { Offset: offset, BlockLength: size ? Math.min(BLOCK, size - offset) : BLOCK, FileContinuationToken: init.FileContinuationToken });
      const bytes = base64Bytes(r.Data);
      parts.push(bytes);
      total += bytes.length;
      if (!size || !bytes.length) break;
    }
    const all = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      all.set(p, at);
      at += p.length;
    }
    return all;
  }

  // The library's package: its file column ("document") - straight, then in
  // blocks - and last any column that holds or points at an .msapp.
  async function fetchPackage(id) {
    const tried = [];
    try {
      const res = await fetch(API + 'canvasapps(' + id + ')/document/$value', { credentials: 'same-origin' });
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (isZip(bytes)) return bytes;
        tried.push('document: not a package');
      } else tried.push('document: HTTP ' + res.status);
    } catch (e) {
      tried.push('document: ' + e.message);
    }
    // "document" is the app package; "assets" may hold the published one.
    for (const column of ['document', 'assets']) {
      try {
        const bytes = await downloadFile('canvasapps', 'canvasappid', id, column);
        if (isZip(bytes)) return bytes;
        tried.push(column + ' in blocks: not a package (' + bytes.length + ' bytes)');
      } catch (e) {
        tried.push(column + ' in blocks: ' + e.message);
      }
    }
    const row = await getJson('canvasapps(' + id + ')');
    if (row.document != null) tried.push('document column holds ' + String(row.document).slice(0, 60));
    for (const k of Object.keys(row)) {
      const v = row[k];
      if (typeof v !== 'string' || k.indexOf('@') >= 0) continue;
      if (/^UEsDB/.test(v)) return base64Bytes(v);
      if (/^https?:\/\//.test(v) && (/\.msapp/i.test(v) || /document/i.test(k))) {
        try {
          const res = await fetch(v);
          if (res.ok) return new Uint8Array(await res.arrayBuffer());
          tried.push(k + ': HTTP ' + res.status);
        } catch (e) {
          tried.push(k + ': ' + e.message);
        }
      }
    }
    throw new Error(tried.join('; ') + ' - columns: ' + Object.keys(row).filter((k) => k.indexOf('@') < 0).join(', '));
  }

  async function readLibrary(id) {
    const bytes = await fetchPackage(id);
    const rules = [];
    let files = 0;
    for (const e of zipEntries(bytes)) {
      if (!/\.(json|ya?ml)$/i.test(e.name) || e.size > 8e6) continue;
      files++;
      const text = await entryText(bytes, e);
      if (/\.json$/i.test(e.name)) {
        try {
          jsonRules(JSON.parse(text), '', rules, e.name);
        } catch (err) {
          /* not JSON after all */
        }
      } else yamlRules(text, rules, e.name);
    }
    return { rules: rules, files: files };
  }

  const libraries = new Map();

  function commandLibrary(id) {
    if (!libraries.has(id)) {
      libraries.set(
        id,
        readLibrary(id).catch((e) => {
          libraries.delete(id); // not kept: the next look asks again
          return { error: e.message };
        })
      );
    }
    return libraries.get(id);
  }

  // This command's formula in the library: the component and function it
  // names; a function name alone only when it is not a plain "OnSelect".
  function findFormula(lib, ref) {
    const eq = (x, y) => String(x || '').toLowerCase() === String(y || '').toLowerCase();
    const has = (x, y) => String(x || '').toLowerCase().indexOf(String(y || '').toLowerCase()) >= 0;
    const rules = lib.rules;
    const { component, fn } = ref;
    return (
      (component && fn && rules.find((r) => eq(r.control, component) && eq(r.property, fn))) ||
      (component && fn && rules.find((r) => eq(r.control, component) && has(r.property, fn))) ||
      // The designer names components by an id that may sit inside a longer name.
      (component && fn && rules.find((r) => has(r.control, component) && eq(r.property, fn))) ||
      (fn && !/^(onselect|visible|onclick)$/i.test(fn) && rules.find((r) => eq(r.property, fn))) ||
      (component && !fn && rules.find((r) => eq(r.control, component))) ||
      null
    );
  }

  // ---------- loading, once per table and page ----------

  /* Kept for the page's life, so another tab or form of the same table opens
   * at once. A failure is not kept: Try again asks afresh. */
  const cache = new Map();

  /* The last command bars read, per environment and table, also kept in the
   * browser: the next Form as JSON shows them at once - with when they were
   * read - while Dynamics builds them again. The zip as Dynamics gave it; the
   * 5 newest, 14 days. */
  const KEPT_KEY = 'dynaboost.ribbons';
  const KEPT_MAX = 5;
  const KEPT_DAYS = 14;
  const alive = () => !!(DynaBoost.alive && DynaBoost.alive());

  function keptList() {
    return new Promise((resolve) => {
      if (!alive()) return resolve([]);
      try {
        chrome.storage.local.get(KEPT_KEY, (d) => resolve(Array.isArray(d && d[KEPT_KEY]) ? d[KEPT_KEY] : []));
      } catch (e) {
        resolve([]);
      }
    });
  }

  // Within the browser's room for DynaBoost (10 MB, shared with the rest):
  // one table's bars up to 2.5 MB, all of them up to 6 MB.
  const KEPT_ONE = 2.5e6;
  const KEPT_ALL = 6e6;

  async function keep(entity, zip) {
    if (!zip || zip.length > KEPT_ONE) return;
    const host = location.hostname;
    const since = Date.now() - KEPT_DAYS * 864e5;
    const list = (await keptList()).filter((k) => k && k.at > since && !(k.host === host && k.entity === entity));
    list.unshift({ host: host, entity: entity, at: Date.now(), zip: zip });
    const out = [];
    let size = 0;
    for (const k of list.slice(0, KEPT_MAX)) {
      size += (k.zip || '').length;
      if (size > KEPT_ALL) break;
      out.push(k);
    }
    if (!alive()) return;
    try {
      chrome.storage.local.set({ [KEPT_KEY]: out }).catch(() => {});
    } catch (e) {
      /* cut off - nothing kept */
    }
  }

  // { at, ribbon } from the last read in this environment, or null.
  async function kept(entity) {
    const since = Date.now() - KEPT_DAYS * 864e5;
    const hit = (await keptList()).find((k) => k && k.host === location.hostname && k.entity === entity && k.at > since);
    if (!hit) return null;
    try {
      return { at: hit.at, ribbon: parseRibbon(await unzipXml(hit.zip), entity) };
    } catch (e) {
      return null;
    }
  }

  async function loadRibbon(entity) {
    const r = await getJson("RetrieveEntityRibbon(EntityName='" + entity + "',RibbonLocationFilter=Microsoft.Dynamics.CRM.RibbonLocationFilters'All')", null, RIBBON_TIMEOUT);
    const ribbon = parseRibbon(await unzipXml(r.CompressedEntityXml), entity);
    keep(entity, r.CompressedEntityXml);
    return ribbon;
  }

  // The classic command bars (slow) and the modern commands (quick), each on
  // its own, so the quick one does not wait for the slow one.
  const modernCache = new Map();
  function loadModernOnce(entity) {
    if (!modernCache.has(entity)) {
      const p = loadModern(entity);
      modernCache.set(entity, p);
      p.then((m) => m && m.error && modernCache.delete(entity));
    }
    return modernCache.get(entity);
  }

  function loadClassic(entity) {
    if (!cache.has(entity)) {
      cache.set(
        entity,
        loadRibbon(entity).catch((e) => {
          cache.delete(entity);
          return { error: e.message };
        })
      );
    }
    return cache.get(entity);
  }

  function load(entity) {
    return Promise.all([loadClassic(entity), loadModernOnce(entity)]).then(([ribbon, modern]) => ({ ribbon: ribbon, modern: modern }));
  }

  // For the JSON: the custom and customized buttons, and the modern commands.
  function compact(data) {
    const m = data.ribbon;
    const button = (b) => {
      const cmd = m.commands.get(b.command);
      const rules = (kind) => (cmd ? rulesOf(cmd, kind, m).map((r) => ({ id: r.id, steps: r.steps.map(stepText) })) : []);
      return {
        id: b.id,
        label: b.label,
        type: b.type,
        sequence: b.sequence,
        custom: b.custom,
        command: b.command || null,
        actions: cmd ? actionsOf(cmd).map((a) => (a.kind === 'js' ? { javascript: a.fn, library: a.lib.name, parameters: a.params } : { [a.kind]: a.text })) : [],
        displayRules: rules('display'),
        enableRules: rules('enable'),
        menu: b.children.filter(isCustomish).map(button)
      };
    };
    const out = {};
    if (m.error) out.error = m.error;
    else for (const l of LOCATIONS) if (!l.same) out[l.key] = m.locations[l.key].filter(isCustomish).map(button);
    out.modern = Array.isArray(data.modern) ? data.modern.map((a) => Object.assign({}, a, { raw: undefined })) : data.modern || [];
    return out;
  }

  function customCount(commands) {
    if (!commands) return null;
    return LOCATIONS.reduce((n, l) => n + (l.same ? 0 : (commands[l.key] || []).length), 0) + (Array.isArray(commands.modern) ? commands.modern.length : 0);
  }

  // ---------- drawing ----------

  function imageUrl(b, clientUrl) {
    for (const v of [b.modernImage, b.image]) {
      if (!v) continue;
      if (/^\$webresource:/i.test(v)) return clientUrl + '/WebResources/' + v.replace(/^\$webresource:/i, '');
      if (/^\/(_imgs|WebResources)\//i.test(v)) return clientUrl + v;
    }
    return '';
  }

  // The button's own image when it has one that loads; its first letter under it.
  function tileIcon(label, src) {
    return (
      '<span class="cm-ico" aria-hidden="true"><span class="cm-ltr">' + esc(String(label || '?').trim().charAt(0).toUpperCase()) + '</span>' +
      (src ? '<img class="cm-img" src="' + esc(src) + '" alt="">' : '') + '</span>'
    );
  }

  function tileHtml(b, key, clientUrl) {
    const menu = b.children.length || b.populate || /Flyout|Split|Menu/.test(b.type);
    return (
      '<button type="button" class="cm-btn' + (b.custom ? ' custom' : b.customized ? ' mod' : '') + (b.scope ? ' legacy' : '') + '" data-cm="' + esc(key) + '"' +
      ' data-s="' + esc((b.label + ' ' + b.id + ' ' + b.command).toLowerCase()) + '" title="' + esc(b.id) + '">' +
      tileIcon(b.label, imageUrl(b, clientUrl)) + '<span class="cm-lbl">' + esc(b.label) + '</span>' + (menu ? '<span class="cm-caret">▾</span>' : '') + '</button>'
    );
  }

  function modernTile(a, i) {
    return (
      '<button type="button" class="cm-btn fx' + (a.hidden ? ' legacy' : '') + '" data-cmmodern="' + i + '" data-s="' + esc((a.label + ' ' + a.unique).toLowerCase()) + '" title="' + esc(a.unique) + '">' +
      tileIcon(a.label, '') + '<span class="cm-lbl">' + esc(a.label) + '</span><span class="cm-fx">Fx</span></button>'
    );
  }

  // Reading: the busy squares, the seconds, and why it can take long.
  function waitHtml(again) {
    return (
      '<div class="cm-reading">' + DynaBoost.status.html('busy') +
      '<div><div>' + (again ? 'Reading them again from Dynamics' : 'Reading the table’s command bars from Dynamics') + '\u2026<span id="cm-wait"></span></div>' +
      '<div class="lg-dim" id="cm-slow" hidden>Dynamics builds them in one go - every button of the table with the changes of every solution - and for a big table that takes a minute or more. Nothing to do: they appear here by themselves, the other views work meanwhile.</div></div></div>'
    );
  }

  function viewHtml(data, st, clientUrl) {
    if (!data || !data.ribbon) {
      return waitHtml(false) + (data && data.modern ? modernHtml(data.modern, st) : '');
    }
    const parts = [];
    const rb = data.ribbon;
    if (data.keptAt) {
      const d = new Date(data.keptAt);
      const when = d.toDateString() === new Date().toDateString() ? 'today ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      parts.push(
        '<div class="cm-kept">As read ' + esc(when) + ' - shown at once.' +
          (data.againError ? ' Reading them again did not work: ' + esc(data.againError) + ' <button type="button" class="cm-retry" data-cmretry>Try again</button>' : waitHtml(true)) +
          '</div>'
      );
    }
    if (rb.error) {
      parts.push('<p class="lg-empty">The command bars could not be read. ' + esc(rb.error) + ' <button type="button" class="cm-retry" data-cmretry>Try again</button></p>');
    } else {
      const segs = LOCATIONS.map((l) => {
        const list = rb.locations[l.key];
        const own = list.filter(isCustomish).length;
        return (
          '<button type="button" data-cmloc="' + l.key + '" aria-pressed="' + (st.loc === l.key) + '">' + l.label +
          ' <span class="cm-n">' + list.filter((b) => !b.scope).length + (own ? ' · ' + own + ' custom' : '') + '</span></button>'
        );
      }).join('');
      const list = rb.locations[st.loc];
      const legacy = list.filter((b) => b.scope).length;
      const shown = list.map((b, i) => [b, i]).filter(([b]) => (st.classic || !b.scope) && (!st.customOnly || isCustomish(b)));
      parts.push(
        '<div class="cm-top"><span class="seg">' + segs + '</span>' +
          '<label><input type="checkbox" id="cm-custom"' + (st.customOnly ? ' checked' : '') + '> custom only</label>' +
          (legacy
            ? '<label title="Buttons whose display rules keep them to the classic web client or Outlook - Unified Interface never shows them"><input type="checkbox" id="cm-classic"' +
              (st.classic ? ' checked' : '') + '> classic-only too (' + legacy + ')</label>'
            : '') +
          '</div>' +
          '<div class="cm-frame"><div class="cm-bar">' +
          (shown.length ? shown.map(([b, i]) => tileHtml(b, st.loc + ':' + i, clientUrl)).join('') : '<span class="lg-dim">No buttons here.</span>') +
          '</div></div>' +
          '<p class="cm-legend"><span class="cm-sw custom"></span>custom <span class="cm-sw mod"></span>Microsoft, customized <span class="cm-sw"></span>Microsoft' +
          ' · ▾ opens a menu · click a button for its command and rules. Whether a button shows also depends on its rules, the record and the user.' +
          (st.loc === 'assoc' ? ' An associated view shows the subgrid’s classic buttons.' : '') + '</p>'
      );
    }
    parts.push(modernHtml(data.modern, st));
    return parts.join('');
  }

  function modernHtml(modern, st) {
    const head = '<h2 class="lg-h">Modern commands <span class="lg-dim">from the command designer</span></h2>';
    if (!modern) return head + '<p class="lg-note">Reading\u2026</p>';
    if (!Array.isArray(modern)) return head + '<p class="lg-note">Modern commands could not be read. ' + esc(modern && modern.error) + '</p>';
    const here = modern.map((a, i) => [a, i]).filter(([a]) => a.loc === st.loc);
    return (
      head +
      (here.length ? '<div class="cm-frame"><div class="cm-bar">' + here.map(([a, i]) => modernTile(a, i)).join('') + '</div></div>' : '<p class="lg-note">None on this bar.</p>')
    );
  }

  function codeLink(lib, fn) {
    return lib && lib.web && lib.name ? '<button type="button" class="mini" data-code="' + esc(lib.name) + '"' + (fn ? ' data-fn="' + esc(fn) + '"' : '') + '>View code</button>' : '';
  }

  function fnHtml(fn, lib, prms) {
    return (
      '<code class="lg-fn">' + esc(fn) + '</code>' +
      (prms && prms.length ? '<span class="cm-params">' + (Array.isArray(prms) ? prms : [prms]).map((p) => '<code>' + esc(p) + '</code>').join('') + '</span>' : '') +
      '<div class="cm-lib">' + esc(lib.name || '?') + (lib.web ? '' : ' <span class="lg-dim">(system library)</span>') + ' ' + codeLink(lib, fn) + '</div>'
    );
  }

  function stepHtml(s) {
    if (s.kind === 'or') {
      return '<li>Any of:<ul class="cm-or">' + s.alts.map((alt) => '<li>' + alt.map((x) => '<span>' + stepInline(x) + '</span>').join(' <b>and</b> ') + '</li>').join('') + '</ul></li>';
    }
    return '<li>' + stepInline(s) + '</li>';
  }

  function stepInline(s) {
    if (s.kind === 'or') return esc(stepText(s));
    return (s.invert ? '<b class="cm-not">NOT</b> ' : '') + esc(s.text) + (s.fn ? ' ' + fnHtml(s.fn, s.lib, s.params) : '');
  }

  function ruleHtml(r) {
    return (
      '<div class="cm-rule' + (r.custom ? ' custom' : '') + '"><div class="cm-rule-h"><code>' + esc(r.id) + '</code>' + (r.custom ? '<span class="cm-tag custom">custom</span>' : '') + '</div>' +
      (r.el ? '<ul>' + r.steps.map(stepHtml).join('') + '</ul>' : '<p class="lg-note">Defined outside this table’s ribbon (application-wide).</p>') +
      '</div>'
    );
  }

  function kv(k, v) {
    return v ? '<div class="cm-kv"><span>' + k + '</span><div>' + v + '</div></div>' : '';
  }

  function head(title, iconHtml, tags, sub, back, copyLabel, tools) {
    return (
      '<div class="cm-d-head">' +
      (back ? '<button type="button" class="cm-back" data-cmback>← ' + esc(back) + '</button>' : '') +
      '<div class="cm-d-title">' + iconHtml + '<h3>' + esc(title) + '</h3>' + tags +
      '<span class="cm-d-tools">' + (tools || '') + '<button type="button" class="mini" data-copyxml>' + (copyLabel || 'Copy XML') + '</button>' +
      '<button type="button" class="lg-x" data-close title="Close (Esc)" aria-label="Close">×</button></span></div>' +
      '<div class="cm-d-sub">' + sub + '</div></div>'
    );
  }

  function detailHtml(model, b, where, back, clientUrl) {
    const cmd = model.commands.get(b.command);
    const tag = b.custom ? '<span class="cm-tag custom">Custom</span>' : b.customized ? '<span class="cm-tag mod">Customized</span>' : '<span class="cm-tag">Microsoft</span>';
    const scope = b.scope ? '<span class="cm-tag">' + (b.scope === 'classic' ? 'classic UI only' : 'Outlook only') + '</span>' : '';
    const actions = cmd ? actionsOf(cmd) : [];
    const runs = actions.length
      ? actions
          .map((a) =>
            a.kind === 'js'
              ? '<div class="cm-act"><span class="lg-ev">JavaScript</span>' + fnHtml(a.fn, a.lib, a.params) + '</div>'
              : '<div class="cm-act"><span class="lg-ev">' + esc(a.kind === 'url' ? 'URL' : a.kind) + '</span><code>' + esc(a.text) + '</code></div>'
          )
          .join('')
      : '<p class="lg-note">Nothing - the command has no action' + (b.children.length || b.populate ? '; the button only opens its menu' : '') + '.</p>';
    const commandCard =
      '<section class="cm-card"><h4>Command</h4>' +
      (cmd
        ? kv('Id', '<code>' + esc(b.command) + '</code>' + (MICROSOFT.test(b.command) ? '' : ' <span class="cm-tag custom">custom</span>')) + '<div class="cm-sub-h">Runs</div>' + runs
        : '<p class="lg-note">' + (b.command ? 'Command <code>' + esc(b.command) + '</code> is not in this table’s ribbon.' : 'No command - the button only opens its menu.') + '</p>') +
      '</section>';
    const rules = (title, hint, list) =>
      '<section class="cm-card"><h4>' + title + '</h4><p class="cm-hint">' + hint + '</p>' + (list.length ? list.map(ruleHtml).join('') : '<p class="lg-note">No rules - always.</p>') + '</section>';
    const menu =
      b.children.length || b.populate
        ? '<section class="cm-card cm-wide"><h4>Menu</h4>' +
          (b.populate ? '<p class="lg-note">Items are built when the menu opens, by the command <code>' + esc(b.populate) + '</code>.</p>' : '') +
          (b.children.length ? '<div class="cm-bar cm-bar-sm">' + b.children.map((c, i) => tileHtml(c, 'child:' + i, clientUrl)).join('') + '</div>' : '') +
          '</section>'
        : '';
    return (
      head(b.label, tileIcon(b.label, imageUrl(b, clientUrl)), tag + scope, '<code>' + esc(b.id) + '</code> · ' + esc(where) + ' · sequence ' + b.sequence, back) +
      '<div class="cm-d-body"><div class="cm-col">' +
      '<section class="cm-card"><h4>Button</h4>' +
      kv('Label', esc(b.label)) + kv('Tooltip', esc(b.tooltip)) + kv('Type', esc(b.type)) + kv('Group', b.group ? '<code>' + esc(b.group) + '</code>' : '') +
      kv('Template', esc(b.alias)) + kv('Image', esc(b.modernImage || b.image)) +
      '</section>' + commandCard +
      '</div><div class="cm-col">' +
      rules('Shows when', 'Every display rule has to pass, or the button is hidden.', cmd ? rulesOf(cmd, 'display', model) : []) +
      rules('Enabled when', 'Every enable rule has to pass, or the button is greyed out.', cmd ? rulesOf(cmd, 'enable', model) : []) +
      '</div>' + menu + '</div>'
    );
  }

  function libLabel(r) {
    return [r.name || r.id ? 'library ' + (r.name || r.id) : '', r.component ? 'component ' + r.component : '', r.fn ? 'function ' + r.fn : ''].filter(Boolean).join(' · ');
  }

  // A formula stored on the row itself, else a slot filled from the library.
  function formulaSlot(key, direct, ref, none) {
    if (direct && direct.kind === 'formula') return '<pre class="cm-pre">' + DynaBoost.code.html(direct.text, 'fx') + '</pre>';
    if (direct && direct.kind === 'js') return '<div class="cm-act"><span class="lg-ev">JavaScript</span>' + fnHtml(direct.fn, direct.lib, direct.params ? [direct.params] : []) + '</div>';
    if (ref) return '<div data-fx="' + key + '"><p class="lg-note">Reading the formula from the command library…</p></div>';
    return none ? '<p class="lg-note">' + esc(none) + '</p>' : '';
  }

  // The command designer on this command's table, app and bar (form-logic's Edit in...).
  function designerButton(a, entity, text) {
    return a.appId
      ? '<button type="button" class="mini" data-edit="' + esc('command|' + a.id + '|' + a.label) + '" data-entity="' + esc(entity) + '" data-app="' + esc(a.appId) + '" data-loc="' + esc(a.location) +
          '" title="Open the command designer on this bar, with this command picked">' + text + '</button>'
      : '';
  }

  function modernDetailHtml(a, entity) {
    const edit = designerButton(a, entity, 'Edit in…');
    return (
      head(a.label, tileIcon(a.label, ''), '<span class="cm-tag fx">Modern</span>' + (a.custom ? '<span class="cm-tag custom">Custom</span>' : '') + (a.hidden ? '<span class="cm-tag">hidden</span>' : ''),
        '<code>' + esc(a.unique) + '</code> · ' + esc(a.where) + (a.app ? ' · app ' + esc(a.app) : ''), '', 'Copy JSON', edit) +
      '<div class="cm-d-body"><div class="cm-col"><section class="cm-card"><h4>Button</h4>' +
      kv('Label', esc(a.label)) + kv('Tooltip title', esc(a.tooltipTitle)) + kv('Tooltip', esc(a.tooltip)) + kv('Accessibility', esc(a.accessibility)) +
      kv('Where', esc(a.where)) + kv('App', esc(a.app)) + kv('Scope', esc(a.scope)) + kv('Order', esc(a.sequence)) + kv('Icon', esc(a.icon)) +
      kv('Hidden', a.hidden ? 'yes' : '') + kv('Name', a.name && a.name !== a.label ? '<code>' + esc(a.name) + '</code>' : '') + kv('Changed', esc(a.modified)) +
      '</section></div><div class="cm-col">' +
      '<section class="cm-card"><h4>Runs</h4>' + (a.actionType ? '<p class="cm-hint">' + esc(a.actionType) + '</p>' : '') +
      formulaSlot('action', a.action, a.actionLib, 'Nothing.') +
      '</section><section class="cm-card"><h4>Shows when</h4>' + (a.visibilityType ? '<p class="cm-hint">' + esc(a.visibilityType) + '</p>' : '') +
      formulaSlot('visible', a.visible, a.visibleLib, a.visibilityType ? '' : 'Always.') +
      '</section></div><div class="cm-wide" data-fx="all"></div></div>'
    );
  }

  /* Fills the formula slots of an open command window from the command
   * library. When the library cannot say which formula is this button's,
   * every formula in it is listed - it is always there somewhere. */
  async function fillFormulas(box, a, entity) {
    const refs = [
      ['action', a.action ? null : a.actionLib],
      ['visible', a.visible ? null : a.visibleLib]
    ].filter((x) => x[1]);
    if (!refs.length) return;
    const libId = refs.map((x) => x[1].id).find(Boolean);
    const lib = libId ? await commandLibrary(libId) : { error: 'the command names no library' };
    a.formulas = a.formulas || {};
    let missed = false;
    for (const [key, ref] of refs) {
      const slot = box.querySelector('[data-fx="' + key + '"]');
      if (!slot) continue;
      const hit = lib.error ? null : findFormula(lib, ref);
      if (hit) {
        a.formulas[key] = hit.script;
        slot.innerHTML = '<pre class="cm-pre">' + DynaBoost.code.html(hit.script, 'fx') + '</pre><div class="cm-lib">' + esc(libLabel(ref)) + '</div>';
      } else {
        missed = true;
        // Power Apps keeps a library's package on its own side and leaves
        // Dataverse's file column empty: then only the designer shows it.
        const outside = /no file attachment/i.test(lib.error || '');
        slot.innerHTML =
          '<p class="lg-note">' +
          (outside
            ? 'Power Apps keeps this command’s formulas outside Dataverse, so they cannot be read from here.'
            : lib.error
            ? 'The command library could not be read - the reason is at the bottom.'
            : 'Not found by name in the command library - see all its formulas below.') +
          '</p><div class="cm-lib">' + esc(libLabel(ref)) + '</div>' +
          (lib.error ? '<div class="cm-open">' + designerButton(a, entity, 'Open in the designer') + '</div>' : '');
      }
    }
    const all = box.querySelector('[data-fx="all"]');
    if (lib.error && all) {
      all.innerHTML = '<section class="cm-card"><details><summary>Why the command library could not be read</summary><p class="cm-err">' + esc(lib.error) + '</p></details></section>';
    } else if (missed && all && lib.rules.length) {
      all.innerHTML =
        '<section class="cm-card"><details><summary>All ' + lib.rules.length + ' formulas in the command library</summary>' +
        lib.rules
          .slice(0, 400)
          .map((r) => '<div class="cm-allrule"><code>' + esc(r.control + '.' + r.property) + '</code><pre class="cm-pre">' + DynaBoost.code.html(r.script, 'fx') + '</pre></div>')
          .join('') +
        '</details></section>';
    }
  }

  const CSS =
    '.cm-top{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:2px 0 12px}' +
    // Reading: the busy squares beside what is read; the kept bars marked as such.
    '.cm-reading{display:flex;gap:10px;align-items:flex-start;margin:4px 0 12px;font-size:13px;color:var(--dbc-fg-10224e)}' +
    '.cm-reading .db-st{flex:none;margin-top:1px}.cm-reading .db-st.db-st-busy{margin:1px 0}.cm-reading .lg-dim{margin-top:3px;font-size:12.5px}' +
    '.cm-kept{margin:0 0 12px;padding:8px 12px;border:1px dashed var(--dbc-bd-c6d0e4);border-radius:8px;font-size:12.5px;color:var(--dbc-fg-56637f)}' +
    '.cm-kept .cm-reading{margin:6px 0 0}' +
    '.cm-top label{font-size:13px;color:var(--dbc-fg-56637f);display:flex;align-items:center;gap:6px;cursor:pointer}' +
    // The same switch as the views above it.
    '.cm-n{font-size:11.5px;opacity:.7}' +
    '.cm-frame{background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px;box-shadow:0 1px 3px rgba(16,34,78,.08);padding:6px}' +
    '.cm-bar{display:flex;flex-wrap:wrap;gap:2px}' +
    '.cm-retry{margin-left:6px;padding:2px 10px;border:1px solid var(--dbc-bd-c9d3e6);border-radius:4px;background:var(--dbc-bg-fff);color:var(--dbc-fg-1e6bff);font:600 12.5px "Segoe UI",system-ui,sans-serif;cursor:pointer}' +
    '.cm-retry:hover{border-color:var(--dbc-bd-1e6bff)}' +
    '.cm-btn{display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 10px;border:1px solid transparent;border-radius:4px;background:var(--dbc-bg-fff);color:var(--dbc-fg-323130);font:14px "Segoe UI",system-ui,sans-serif;white-space:nowrap}' +
    '.cm-btn:hover{background:var(--dbc-bg-f3f2f1);border-color:transparent;color:var(--dbc-fg-201f1e)}' +
    '.cm-btn.custom{box-shadow:inset 0 -2px 0 var(--dbc-bd-e3b04b);background:var(--dbc-bg-fffaf0);color:var(--dbc-fg-10224e);font-weight:600}' +
    '.cm-btn.custom:hover{background:var(--dbc-bg-fff3dc)}' +
    '.cm-btn.mod{box-shadow:inset 0 -2px 0 var(--dbc-bd-f3d58f);border-bottom-style:dashed}' +
    '.cm-btn.legacy{opacity:.5}' +
    '.cm-btn.fx{box-shadow:inset 0 -2px 0 var(--dbc-bd-7c3aed)}' +
    '.cm-caret{font-size:11px;color:var(--dbc-fg-605e5c);margin-left:-2px}' +
    '.cm-fx{font:600 10px ui-monospace,Consolas,monospace;color:var(--dbc-fg-7c3aed);border:1px solid var(--dbc-bd-d9c8fb);border-radius:4px;padding:0 3px}' +
    '.cm-ico{position:relative;flex:none;width:16px;height:16px}' +
    '.cm-ltr{display:flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:4px;background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f);font:600 10px "Segoe UI",sans-serif}' +
    '.cm-btn.custom .cm-ltr{background:var(--dbc-bg-fdf1d6);color:var(--dbc-fg-9a6a12)}' +
    '.cm-img{position:absolute;inset:0;width:16px;height:16px;object-fit:contain;background:var(--dbc-bg-fff)}.cm-btn.custom .cm-img{background:var(--dbc-bg-fffaf0)}.cm-img.broken{display:none}' +
    '.cm-legend{margin:8px 2px 0;font-size:12px;color:var(--dbc-fg-56637f)}' +
    '.cm-sw{display:inline-block;width:14px;height:10px;margin:0 5px 0 10px;border-radius:2px;background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);vertical-align:-1px}' +
    '.cm-sw:first-child{margin-left:0}.cm-sw.custom{background:var(--dbc-bg-fffaf0);border:0;box-shadow:inset 0 -2px 0 var(--dbc-bd-e3b04b)}.cm-sw.mod{border:0;box-shadow:inset 0 -2px 0 var(--dbc-bd-f3d58f)}' +
    // the details window
    '.lg-box.lg-cmbox{width:min(980px,calc(100% - 48px));max-width:none;max-height:88vh;padding:0;display:flex;flex-direction:column;overflow:hidden}' +
    '.cm-d-head{flex:none;padding:12px 12px 12px 20px;border-bottom:2px solid var(--dbc-bd-e3b04b)}' +
    '.cm-back{margin:0 0 8px;padding:3px 10px;font-size:12.5px}' +
    '.cm-d-title{display:flex;align-items:center;gap:9px}.cm-d-title h3{margin:0;font-size:17px}.cm-d-title .cm-ico{transform:scale(1.25)}' +
    '.cm-d-tools{margin-left:auto;display:flex;align-items:center;gap:6px}.cm-d-tools .mini{margin:0}' +
    '.cm-d-sub{margin-top:4px;font-size:12.5px;color:var(--dbc-fg-56637f)}' +
    '.cm-d-body{flex:1;min-height:0;overflow:auto;padding:14px 20px 18px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:14px;align-content:start;background:var(--dbc-bg-f5f7fc)}' +
    '.cm-col{display:flex;flex-direction:column;gap:14px;min-width:0}.cm-wide{grid-column:1/-1}' +
    '@media (max-width:760px){.cm-d-body{grid-template-columns:1fr}}' +
    '.cm-card{background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px;padding:10px 14px 12px}' +
    '.cm-card h4{margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--dbc-fg-56637f)}' +
    '.cm-hint{margin:-4px 0 8px;font-size:12px;color:var(--dbc-fg-97a5c6)}' +
    '.cm-kv{display:grid;grid-template-columns:100px minmax(0,1fr);gap:8px;font-size:13px;padding:3px 0;overflow-wrap:anywhere}.cm-kv>span{color:var(--dbc-fg-56637f)}' +
    '.cm-sub-h{margin:8px 0 4px;font-size:12px;color:var(--dbc-fg-56637f)}' +
    '.cm-act{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;font-size:13px;margin:4px 0;overflow-wrap:anywhere}' +
    '.cm-lib{flex-basis:100%;font-size:12px;color:var(--dbc-fg-56637f);margin-top:2px}.cm-lib .mini{margin-left:6px}' +
    '.cm-params{display:inline-flex;flex-wrap:wrap;gap:4px;margin-left:6px}.cm-params code{padding:0 6px;border-radius:8px;background:var(--dbc-bg-eef2f9);font-size:11.5px}' +
    '.cm-rule{border-left:3px solid var(--dbc-bd-dde3f0);padding:4px 0 4px 10px;margin:8px 0}.cm-rule.custom{border-left-color:var(--dbc-bd-e3b04b)}' +
    '.cm-rule-h{display:flex;align-items:center;gap:6px;font-size:12.5px}' +
    '.cm-rule ul{margin:4px 0 0;padding-left:18px;font-size:13px}.cm-rule li{margin:3px 0;overflow-wrap:anywhere}' +
    '.cm-or{padding-left:16px}.cm-not{color:var(--dbc-fg-a11a1a);font-size:11.5px}' +
    '.cm-tag{padding:1px 8px;border-radius:10px;background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f);font-size:11px;font-weight:600}' +
    '.cm-tag.custom{background:var(--dbc-bg-fdf1d6);color:var(--dbc-fg-7a5410)}.cm-tag.mod{background:var(--dbc-bg-fff7e6);color:var(--dbc-fg-9a6a12)}.cm-tag.fx{background:var(--dbc-bg-f1eafe);color:var(--dbc-fg-6d28d9)}' +
    '.cm-pre{margin:0;padding:8px 10px;background:var(--dbc-bg-f5f7fc);border:1px solid var(--dbc-bd-edf1f8);border-radius:6px;font:12.5px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}' +
    '.cm-bar-sm .cm-btn{height:32px;font-size:13px}' +
    '.cm-hint+.cm-pre,.cm-hint+div .cm-pre{margin-top:2px}' +
    '.cm-wide:empty{display:none}' +
    '.cm-card summary{cursor:pointer;font-size:13px;color:var(--dbc-fg-10224e)}' +
    '.cm-allrule{margin:10px 0 0}.cm-allrule code{display:block;margin-bottom:3px;font-size:12px}' +
    '.cm-err{margin:8px 0 0;font-size:12px;color:var(--dbc-fg-56637f);overflow-wrap:anywhere}' +
    '.cm-open{margin-top:8px}.cm-open .mini{margin-left:0}';

  // ---------- behaviour ----------

  function copyText(tab, text) {
    return tab.navigator.clipboard.writeText(text).then(
      () => true,
      () => false
    );
  }

  function serialize(els) {
    const ser = new XMLSerializer();
    return els
      .filter(Boolean)
      .map((el) => ser.serializeToString(el).replace(/ xmlns="[^"]*"/g, ''))
      .join('\n\n');
  }

  function openButton(tab, data, locKey, index, clientUrl) {
    const model = data.ribbon;
    const where = LOCATIONS.find((l) => l.key === locKey).label;
    const trail = [model.locations[locKey][index]];
    const m = DynaBoost.formLogic.modal(tab, '', 'lg-cmbox');
    const draw = () => {
      const b = trail[trail.length - 1];
      m.box.innerHTML = detailHtml(model, b, where, trail.length > 1 ? trail[trail.length - 2].label : '', clientUrl);
    };
    m.box.addEventListener('click', (e) => {
      const b = trail[trail.length - 1];
      const child = e.target.closest('[data-cm^="child:"]');
      if (child) {
        trail.push(b.children[Number(child.getAttribute('data-cm').slice(6))]);
        draw();
        return;
      }
      if (e.target.closest('[data-cmback]')) {
        trail.pop();
        draw();
        return;
      }
      const copy = e.target.closest('[data-copyxml]');
      if (copy) {
        const cmd = model.commands.get(b.command);
        const rules = cmd ? rulesOf(cmd, 'display', model).concat(rulesOf(cmd, 'enable', model)).map((r) => r.el) : [];
        copyText(tab, serialize([b.el, cmd].concat(rules))).then((ok) => {
          copy.textContent = ok ? 'Copied' : 'Copy failed';
          setTimeout(() => (copy.textContent = 'Copy XML'), 1600);
        });
      }
    });
    draw();
  }

  function openModern(tab, a, entity) {
    const m = DynaBoost.formLogic.modal(tab, modernDetailHtml(a, entity), 'lg-cmbox');
    fillFormulas(m.box, a, entity);
    m.box.addEventListener('click', (e) => {
      const copy = e.target.closest('[data-copyxml]');
      if (!copy) return;
      copyText(tab, JSON.stringify({ command: a.raw, formulas: a.formulas || {} }, null, 2)).then((ok) => {
        copy.textContent = ok ? 'Copied' : 'Copy failed';
        setTimeout(() => (copy.textContent = 'Copy JSON'), 1600);
      });
    });
  }

  /* The Commands view: drawn at once as "reading", filled when the ribbon is
   * in; dump.logic.commands gets the JSON part and refresh() redraws the
   * counts and the JSON. */
  function wire(tab, dump, refresh) {
    const doc = tab.document;
    const logic = dump.logic;
    const clientUrl = dump.environment;
    const st = { loc: 'form', customOnly: false, classic: false };
    let data = null;
    const draw = () => {
      const view = doc.getElementById('v-commands');
      if (!view) return;
      view.innerHTML = viewHtml(data, st, clientUrl);
      const q = doc.getElementById('q');
      if (q && q.value) q.dispatchEvent(new tab.Event('input'));
    };
    // An image that does not load leaves the letter under it.
    doc.addEventListener(
      'error',
      (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('cm-img')) e.target.classList.add('broken');
      },
      true
    );
    doc.addEventListener('click', (e) => {
      if (e.target.closest('.lg-modal')) return;
      if (e.target.closest('[data-cmretry]')) {
        start();
        return;
      }
      const loc = e.target.closest('[data-cmloc]');
      if (loc) {
        st.loc = loc.getAttribute('data-cmloc');
        draw();
        return;
      }
      const tile = e.target.closest('[data-cm]');
      if (tile && data && data.ribbon && !data.ribbon.error) {
        const [key, index] = tile.getAttribute('data-cm').split(':');
        openButton(tab, data, key, Number(index), clientUrl);
        return;
      }
      const mod = e.target.closest('[data-cmmodern]');
      if (mod && data && Array.isArray(data.modern)) openModern(tab, data.modern[Number(mod.getAttribute('data-cmmodern'))], dump.entity.logicalName);
    });
    doc.addEventListener('change', (e) => {
      if (e.target.id === 'cm-custom') st.customOnly = e.target.checked;
      else if (e.target.id === 'cm-classic') st.classic = e.target.checked;
      else return;
      draw();
    });

    /* While reading, the seconds count up, so slow does not look stuck. */
    let clock = 0;
    const tick = (t0) => {
      const s = Math.round((Date.now() - t0) / 1000);
      const wait = doc.getElementById('cm-wait');
      if (wait && s >= 3) wait.textContent = ' ' + s + ' s';
      const slow = doc.getElementById('cm-slow');
      if (slow && s >= 8) slow.hidden = false;
    };
    /* Three reads, each drawn when it is in: the command bars as last read
     * here (from the browser, at once), the modern commands (quick), and the
     * command bars from Dynamics (slow) - which replace the kept ones. */
    const start = () => {
      const gen = (tab.__dbCommandsGen = (tab.__dbCommandsGen || 0) + 1);
      const mine = () => !tab.closed && tab.__dbCommandsGen === gen;
      const entity = dump.entity.logicalName;
      const t0 = Date.now();
      let fresh = false;
      data = { ribbon: null, modern: null, keptAt: null };
      const show = () => {
        if (!mine()) return;
        if (data.ribbon) {
          try {
            logic.commands = compact(data);
          } catch (e) {
            data.ribbon = { error: e.message };
          }
        }
        draw();
        refresh();
      };
      draw();
      tab.clearInterval(clock);
      clock = tab.setInterval(() => tick(t0), 1000);
      kept(entity).then((k) => {
        if (!k || fresh || !mine()) return;
        data.ribbon = k.ribbon;
        data.keptAt = k.at;
        show();
      });
      loadModernOnce(entity).then((m) => {
        if (!mine()) return;
        data.modern = m;
        show();
      });
      loadClassic(entity).then((rb) => {
        fresh = true;
        if (!mine()) return;
        tab.clearInterval(clock);
        if (rb.error && data.keptAt) data.againError = rb.error; // the kept ones stay, with why
        else {
          data.ribbon = rb;
          data.keptAt = null;
        }
        show();
      });
    };
    start();
  }

  DynaBoost.formCommands = {
    css: CSS,
    wire: wire,
    // Starts reading the ribbon early; wire() picks it up from the cache.
    prefetch: (entity) => {
      load(entity);
    },
    customCount: customCount,
    parseRibbon: parseRibbon,
    unzipXml: unzipXml
  };
})();
