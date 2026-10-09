/* Feature: Open workflow (classic workflows). Opens the process in a tab with
 * two views: Steps - the logic in words, with field and choice labels from
 * metadata - and XAML, editable and saved back with PATCH. Unsaved XAML is
 * parsed on the spot, so Steps doubles as a preview.
 *
 * A classic workflow is a `workflow` row with category 0 and its logic in
 * `xaml`. A published process has a definition row (type 1) and an
 * activation row (type 2).
 *
 * Saving: definition rows only, draft (statecode 0) and unmanaged; the
 * original XAML is downloaded before the first save; If-Match with the ETag;
 * x:Class is set to XrmWorkflow + the id without dashes. The XAML is not
 * validated - activation does that. Editing `xaml` directly is not
 * documented by Microsoft: for development environments.
 *
 * Versions, for the tab: the XAML as opened - always kept - and the last 5
 * saves; a click loads one into the editor. Closing the tab with an unsaved
 * edit asks first.
 */
(function () {
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M6 3h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" stroke="#3D8BFF" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M9 9h6M9 12.5h4" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="m13.5 17.5 5.2-5.2 1.4 1.4-5.2 5.2H13.5v-1.4Z" stroke="#E3B04B" stroke-width="1.5" stroke-linejoin="round"/>' +
    '</svg>';

  const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const X_NS = 'http://schemas.microsoft.com/winfx/2006/xaml';
  const API = '/api/data/v9.2/';
  const MAX_SAVED = 5; // versions in the tab, besides the original

  // ---------- finding the workflow ----------

  function idFromUrl(href) {
    try {
      const url = new URL(href);
      if (!/\/sfa\/workflow\/edit\.aspx/i.test(url.pathname)) return null;
      const m = (url.searchParams.get('id') || '').match(GUID);
      return m ? m[0].toLowerCase() : null;
    } catch (e) {
      return null;
    }
  }

  /* The classic editor usually sits inside the solution explorer's frames, so
   * the address bar shows edit.aspx only when opened directly. Frames here are
   * same-origin, so we can look through them. */
  function scanFrames(win, depth) {
    if (depth > 4) return null;
    let hit;
    try {
      hit = idFromUrl(win.location.href);
    } catch (e) {
      return null; // cross-origin - nothing to read
    }
    if (hit) return hit;
    for (let i = 0; i < win.frames.length; i++) {
      try {
        const found = scanFrames(win.frames[i], depth + 1);
        if (found) return found;
      } catch (e) {
        /* cross-origin - skip */
      }
    }
    return null;
  }

  function findWorkflowId() {
    const here = scanFrames(window.top || window, 0);
    if (here) return here;
    const typed = window.prompt(
      'Workflow id not found on this page.\n\n' +
        'Open the classic workflow editor, or paste the workflow id here.'
    );
    if (!typed) return null;
    const m = typed.match(GUID);
    return m ? m[0].toLowerCase() : null;
  }

  async function getJson(url) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'OData-Version': '4.0' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
    return res.json();
  }

  function fetchWorkflow(id) {
    const select =
      '$select=name,description,category,type,statecode,mode,scope,primaryentity,ismanaged,' +
      'ondemand,subprocess,triggeroncreate,triggerondelete,triggeronupdateattributelist,xaml';
    return getJson(API + 'workflows(' + id + ')?' + select);
  }

  // ---------- metadata ----------

  const meta = Object.create(null); // entity logical name -> { label, attrs, options }

  function labelOf(node) {
    const l = node && node.UserLocalizedLabel && node.UserLocalizedLabel.Label;
    return l || null;
  }

  async function loadEntity(name) {
    if (meta[name]) return meta[name];
    const entry = { label: null, attrs: Object.create(null), options: Object.create(null) };
    meta[name] = entry;

    const base = API + "EntityDefinitions(LogicalName='" + name + "')";

    try {
      const e = await getJson(base + '?$select=LogicalName,DisplayName');
      entry.label = labelOf(e.DisplayName);
    } catch (err) {
      /* fall back to the logical name */
    }

    try {
      const a = await getJson(base + '/Attributes?$select=LogicalName,DisplayName,AttributeType');
      for (const at of a.value || []) {
        entry.attrs[at.LogicalName] = { label: labelOf(at.DisplayName), type: at.AttributeType };
      }
    } catch (err) {
      /* names only */
    }

    // Picklist, Status and State keep their choices in separate metadata types.
    const casts = [
      'Microsoft.Dynamics.CRM.PicklistAttributeMetadata',
      'Microsoft.Dynamics.CRM.StatusAttributeMetadata',
      'Microsoft.Dynamics.CRM.StateAttributeMetadata'
    ];
    for (const cast of casts) {
      try {
        const r = await getJson(
          base + '/Attributes/' + cast + '?$select=LogicalName&$expand=OptionSet($select=Options)'
        );
        for (const at of r.value || []) {
          const set = (at.OptionSet && at.OptionSet.Options) || [];
          const map = entry.options[at.LogicalName] || (entry.options[at.LogicalName] = Object.create(null));
          for (const o of set) map[String(o.Value)] = labelOf(o.Label) || null;
        }
      } catch (err) {
        /* numbers only */
      }
    }

    return entry;
  }

  function attrLabel(entity, attribute) {
    const e = meta[entity];
    const a = e && e.attrs[attribute];
    return a && a.label ? a.label + ' (' + attribute + ')' : attribute;
  }

  function entityLabel(name) {
    const e = meta[name];
    return e && e.label ? e.label + ' (' + name + ')' : name;
  }

  function optionLabel(entity, attribute, value) {
    const e = meta[entity];
    const set = e && e.options[attribute];
    const l = set && set[String(value)];
    return l ? l + ' (' + value + ')' : String(value);
  }

  // ---------- reading the XAML ----------

  function attr(node, name) {
    return node.getAttribute(name) || '';
  }

  function keyOf(node) {
    return node.getAttributeNS(X_NS, 'Key') || node.getAttribute('x:Key') || '';
  }

  function kindOf(node) {
    const m = attr(node, 'AssemblyQualifiedName').match(/Activities\.([A-Za-z]+),/);
    return m ? m[1] : node.localName;
  }

  function argsOf(node) {
    const out = {};
    for (const child of node.children) {
      if (child.localName !== 'ActivityReference.Arguments') continue;
      for (const a of child.children) {
        const k = keyOf(a);
        if (k) out[k] = (a.textContent || '').trim();
      }
    }
    return out;
  }

  function propsOf(node) {
    const out = {};
    for (const child of node.children) {
      if (child.localName !== 'ActivityReference.Properties') continue;
      for (const p of child.children) {
        const k = keyOf(p);
        if (k) out[k] = p;
      }
    }
    return out;
  }

  function varName(text) {
    const m = String(text || '').match(/^\[([A-Za-z0-9_]+)\]$/);
    return m ? m[1] : null;
  }

  // [New Object() { ...WorkflowPropertyType.OptionSetValue, "100000001", "Picklist" }]
  function literalOf(params) {
    const m = String(params || '').match(/WorkflowPropertyType\.(\w+),\s*"([^"]*)"/);
    return m ? { kind: 'literal', type: m[1], value: m[2] } : null;
  }

  const OPERATORS = {
    Null: 'is empty',
    NotNull: 'is not empty',
    Equal: 'equals',
    NotEqual: 'does not equal',
    GreaterThan: 'is greater than',
    LessThan: 'is less than',
    GreaterEqual: 'is greater or equal to',
    LessEqual: 'is less or equal to',
    Like: 'contains',
    NotLike: 'does not contain',
    In: 'is in',
    NotIn: 'is not in',
    On: 'is on',
    Between: 'is between'
  };

  /* Produces a flat list of nodes:
   *   { depth, type: 'section' | 'if' | 'else' | 'step' | 'set' | 'action', ... }
   * plus the set of entities it referenced, so metadata can be fetched before
   * anything is rendered. */
  function readWorkflow(xaml) {
    /* Dataverse stores the declaration as encoding="utf-16", but what we hold
     * is a JavaScript string - the browser rejects the document as declaring an
     * encoding it was not given. Dropping the declaration is enough; the markup
     * itself is unchanged. */
    let cleaned = String(xaml).replace(/^\uFEFF?\s*<\?xml[^>]*\?>/i, '');

    /* .NET writes namespaces as
     *   xmlns:mva="clr-namespace:Microsoft.VisualBasic.Activities;assembly=..., Version=4.0.0.0, ..."
     * which contains spaces and commas and is therefore not a valid URI, so the
     * browser's XML parser refuses the whole document. We swap each one for a
     * synthetic but valid URI. Element and attribute names are untouched, and
     * everything below matches on localName, so nothing else changes. The x:
     * namespace is already a proper URI and is left alone - x:Key is read
     * through it. */
    cleaned = cleaned.replace(
      /xmlns:([A-Za-z0-9_.-]+)="clr-namespace:[^"]*"/g,
      'xmlns:$1="urn:dynaboost:$1"'
    );

    const doc = new DOMParser().parseFromString(cleaned, 'application/xml');
    const bad = doc.getElementsByTagName('parsererror')[0];
    if (bad) {
      throw new Error(
        'Could not parse the workflow XAML — ' +
          (bad.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300)
      );
    }

    const vars = Object.create(null);
    const items = [];
    const entities = new Set();

    function label(node) {
      const d = attr(node, 'DisplayName');
      const i = d.indexOf(': ');
      return i > -1 ? d.slice(i + 2) : d;
    }

    function resolve(text) {
      const v = varName(text);
      return v ? vars[v] || { kind: 'raw', text: v } : { kind: 'raw', text: String(text || '') };
    }

    function walk(node, depth) {
      for (const child of node.children) {
        const kind = kindOf(child);

        if (kind === 'GetEntityProperty') {
          const out = varName(attr(child, 'Value'));
          const entity = attr(child, 'EntityName');
          entities.add(entity);
          if (out) vars[out] = { kind: 'field', entity: entity, attribute: attr(child, 'Attribute') };
          continue;
        }

        if (kind === 'EvaluateExpression') {
          const a = argsOf(child);
          const out = varName(a.Result);
          if (out) vars[out] = literalOf(a.Parameters) || { kind: 'raw', text: 'value' };
          continue;
        }

        if (kind === 'EvaluateCondition') {
          const a = argsOf(child);
          const out = varName(a.Result);
          const rightVar = String(a.Parameters || '').match(/\{\s*([A-Za-z0-9_]+)\s*\}/);
          if (out) {
            vars[out] = {
              kind: 'condition',
              left: resolve(a.Operand),
              op: a.ConditionOperator || '',
              right: rightVar ? vars[rightVar[1]] || null : null
            };
          }
          continue;
        }

        if (kind === 'ConditionSequence') {
          items.push({ depth: depth, type: 'section', text: label(child) || 'Condition' });
          walk(child, depth);
          continue;
        }

        if (kind === 'ConditionBranch') {
          const p = propsOf(child);
          items.push({ depth: depth, type: 'if', cond: resolve(argsOf(child).Condition) });
          if (p.Then) walk(p.Then, depth + 1);
          if (p.Else && p.Else.children.length) {
            items.push({ depth: depth, type: 'else' });
            walk(p.Else, depth + 1);
          }
          continue;
        }

        if (kind === 'SetEntityProperty') {
          const entity = attr(child, 'EntityName');
          entities.add(entity);
          items.push({
            depth: depth,
            type: 'set',
            entity: entity,
            attribute: attr(child, 'Attribute'),
            value: resolve(attr(child, 'Value'))
          });
          continue;
        }

        if (kind === 'UpdateEntity' || kind === 'CreateEntity' || kind === 'AssignEntity') {
          const entity = attr(child, 'EntityName');
          entities.add(entity);
          items.push({
            depth: depth,
            type: 'action',
            verb: kind.replace('Entity', '').toLowerCase(),
            entity: entity
          });
          continue;
        }

        if (kind === 'TerminateWorkflow') {
          const st = (attr(child, 'Exception').match(/OperationStatus\.(\w+)/) || [])[1] || '';
          items.push({ depth: depth, type: 'action', verb: 'stop workflow', status: st });
          continue;
        }

        if (child.localName === 'Sequence') {
          const l = label(child);
          if (l) items.push({ depth: depth, type: 'step', text: l });
          walk(child, depth);
          continue;
        }

        walk(child, depth); // Composite, Collection, Workflow, Assign...
      }
    }

    walk(doc.documentElement, 0);
    return { items: items, entities: Array.from(entities).filter(Boolean) };
  }

  // ---------- turning it into words ----------

  function valueText(value, entity, attribute) {
    if (!value) return '';
    if (value.kind === 'field') return attrLabel(value.entity, value.attribute);
    if (value.kind === 'literal') {
      if (value.type === 'OptionSetValue' && entity && attribute) {
        return optionLabel(entity, attribute, value.value);
      }
      if (value.type === 'OptionSetValue') return 'option ' + value.value;
      if (value.value === '') return '(empty)';
      return '"' + value.value + '"';
    }
    return value.text || '';
  }

  function conditionText(cond) {
    if (!cond || cond.kind !== 'condition') return (cond && cond.text) || '?';
    const left = cond.left;
    const leftText =
      left && left.kind === 'field' ? attrLabel(left.entity, left.attribute) : valueText(left);
    const op = OPERATORS[cond.op] || cond.op || '';
    const right =
      left && left.kind === 'field'
        ? valueText(cond.right, left.entity, left.attribute)
        : valueText(cond.right);
    return (leftText + ' ' + op + (right ? ' ' + right : '')).trim();
  }

  function itemText(it) {
    if (it.type === 'section') return it.text;
    if (it.type === 'if') return 'If ' + conditionText(it.cond);
    if (it.type === 'else') return 'Otherwise';
    if (it.type === 'step') return it.text;
    if (it.type === 'set') {
      return 'set ' + attrLabel(it.entity, it.attribute) + ' = ' +
        valueText(it.value, it.entity, it.attribute);
    }
    if (it.type === 'action') {
      if (it.verb === 'stop workflow') return 'stop workflow' + (it.status ? ' (' + it.status + ')' : '');
      return it.verb + ' ' + entityLabel(it.entity);
    }
    return '';
  }

  const CATEGORY = { 0: 'Workflow', 1: 'Dialog', 2: 'Business rule', 3: 'Action', 4: 'Business process flow', 5: 'Modern flow' };
  const STATE = { 0: 'Draft', 1: 'Activated' };
  const MODE = { 0: 'Background (async)', 1: 'Real-time (sync)' };
  const SCOPE = { 1: 'User', 2: 'Business unit', 3: 'Parent: child business units', 4: 'Organization' };

  function triggerList(wf) {
    const t = [];
    if (wf.triggeroncreate) t.push('record is created');
    if (wf.triggeronupdateattributelist) t.push('fields change: ' + wf.triggeronupdateattributelist);
    if (wf.triggerondelete) t.push('record is deleted');
    if (wf.ondemand) t.push('on demand');
    if (wf.subprocess) t.push('as a child process');
    return t.length ? t.join(', ') : '(none)';
  }

  function headerPairs(wf) {
    return [
      ['Entity', entityLabel(wf.primaryentity || '')],
      ['Category', CATEGORY[wf.category] || wf.category],
      ['Row', (wf.type === 1 ? 'Definition' : 'Activation') + ' (type ' + wf.type + ')'],
      ['State', STATE[wf.statecode] || wf.statecode],
      ['Mode', MODE[wf.mode] || wf.mode],
      ['Scope', SCOPE[wf.scope] || wf.scope],
      ['Runs when', triggerList(wf)],
      ['Id', wf.workflowid]
    ];
  }

  function asText(wf, items) {
    const out = [wf.name, '='.repeat(Math.min(String(wf.name || '').length, 70))];
    for (const [k, v] of headerPairs(wf)) out.push(k.padEnd(11) + ' ' + v);
    if (wf.description) out.push('', wf.description);
    out.push('');
    for (const it of items) {
      const bullet =
        it.type === 'section' ? '## ' :
        it.type === 'if' ? '' :
        it.type === 'else' ? '' :
        it.type === 'step' ? '• ' : '- ';
      out.push('  '.repeat(it.depth) + bullet + itemText(it));
    }
    return out.join('\n') + '\n';
  }

  // ---------- output tab ----------

  function esc(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

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

  function itemHtml(it) {
    const pad = 'style="margin-left:' + it.depth * 22 + 'px"';
    if (it.type === 'section') return '<h2 ' + pad + '>' + esc(itemText(it)) + '</h2>';
    if (it.type === 'if') return '<div class="cond" ' + pad + '><b>If</b> ' + esc(conditionText(it.cond)) + '</div>';
    if (it.type === 'else') return '<div class="cond alt" ' + pad + '><b>Otherwise</b></div>';
    if (it.type === 'step') return '<div class="step" ' + pad + '>' + esc(it.text) + '</div>';
    if (it.type === 'set') return '<div class="line" ' + pad + '>' + esc(itemText(it)) + '</div>';
    return '<div class="line verb" ' + pad + '>' + esc(itemText(it)) + '</div>';
  }

  // The tab inherits this page's content security policy, which blocks inline
  // <script> - so it ships without any and the buttons are wired from here.
  // ---------- writing back ----------

  const CLASS_RE = /XrmWorkflow[0-9a-fA-F]{32}/g;

  async function readError(res) {
    try {
      const j = await res.json();
      return (j.error && j.error.message) || JSON.stringify(j).slice(0, 300);
    } catch (e) {
      return '';
    }
  }

  async function saveXaml(id, etag, xaml) {
    const res = await fetch(API + 'workflows(' + id + ')', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
        'OData-Version': '4.0',
        'OData-MaxVersion': '4.0',
        'If-Match': etag || '*'
      },
      body: JSON.stringify({ xaml: xaml })
    });
    if (res.status === 412) {
      throw new Error('Someone else saved this workflow since you opened it. Reload and try again.');
    }
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await readError(res)));
  }

  function className(id) {
    return 'XrmWorkflow' + id.replace(/-/g, '');
  }

  function fixClass(xaml, id) {
    const target = className(id);
    let changed = 0;
    const out = xaml.replace(CLASS_RE, (m) => {
      if (m === target) return m;
      changed++;
      return target;
    });
    return { xaml: out, changed: changed };
  }

  function download(tab, content, name, mime) {
    const doc = tab.document;
    const blob = new tab.Blob([content], { type: mime });
    const url = tab.URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = name;
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    setTimeout(() => tab.URL.revokeObjectURL(url), 10000);
  }

  function editability(wf) {
    if (wf.type !== 1) return 'This is an activation row (type 2). Open the definition to edit it.';
    if (wf.statecode !== 0) return 'This workflow is activated. Deactivate it in the designer first, then edit.';
    if (wf.ismanaged) return 'This workflow is managed. Edit it in the unmanaged source solution.';
    return '';
  }

  // ---------- steps from any XAML ----------

  // Parses a definition and loads whatever metadata it mentions. Works on the
  // saved XAML and on unsaved editor text alike - that is what makes the Steps
  // view a preview.
  async function stepsFor(wf, xaml, status) {
    let parsed = { items: [], entities: [] };
    let failure = null;

    if (!xaml) {
      failure =
        'This row has no XAML. Business rules and modern flows keep their logic ' +
        'elsewhere, and an activation row (type 2) can be empty \u2014 open the ' +
        'definition (type 1) instead.';
    } else {
      try {
        parsed = readWorkflow(xaml);
      } catch (e) {
        failure = 'Could not parse this XAML: ' + e.message;
      }
    }

    const wanted = new Set(parsed.entities);
    if (wf.primaryentity) wanted.add(wf.primaryentity);
    let done = 0;
    for (const name of wanted) {
      status('Reading metadata\u2026 ' + ++done + ' / ' + wanted.size);
      await loadEntity(name);
    }
    status('');
    return failure ? [{ depth: 0, type: 'section', text: failure }] : parsed.items;
  }

  // ---------- the tab ----------

  function buildHtml(wf, id) {
    const rows = headerPairs(wf)
      .map(([k, v]) => '<div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div>')
      .join('');
    const blocked = editability(wf);

    return (
      '<!doctype html><meta charset="utf-8"><title>' + esc(wf.name) + '</title>' +
      '<style>' +
      'html,body{height:100%}' +
      'body{margin:0;display:flex;flex-direction:column;font:14px/1.5 "Segoe UI",system-ui,sans-serif;color:var(--dbc-fg-10224e);background:var(--dbc-bg-f5f7fc)}' +
      'header{flex:none;padding:16px 22px 0;background:var(--dbc-bg-fff);border-bottom:2px solid var(--dbc-bd-e3b04b)}' +
      'h1{margin:0 0 8px;font-size:19px}' +
      '.grid{margin-top:8px;display:grid;grid-template-columns:120px 1fr;gap:2px 14px;font-size:13px;max-width:820px}' +
      '.k{color:var(--dbc-fg-56637f)}.v{color:var(--dbc-fg-10224e)}' +
      '.desc{margin-top:8px;font-size:13px;color:var(--dbc-fg-56637f);max-width:820px}' +
      '.bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px;padding-bottom:12px}' +
      'button{padding:7px 13px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;background:var(--dbc-bg-fff);font:inherit;cursor:pointer}' +
      'button:hover{border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-1e6bff)}' +
      'button:disabled{opacity:.45;cursor:default}' +
      'button.primary{background:var(--dbc-bg-1e6bff);border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-fff);font-weight:600}' +
      'button.primary:hover:enabled{background:var(--dbc-bg-155ee0)}' +
      'button svg{width:14px;height:14px;vertical-align:-2px;margin-right:6px}' +
      'button.db-ok{border-color:var(--dbc-bd-1c6b32);color:var(--dbc-fg-1c6b32);background:var(--dbc-bg-e4f4e8)}' +
      'button.db-bad{border-color:var(--dbc-bd-a11a1a);color:var(--dbc-fg-a11a1a);background:var(--dbc-bg-fde8e8)}' +
      // the view switch: two halves of one control, the active one filled navy
      '.seg{display:inline-flex;margin-right:6px;border:1px solid var(--dbc-bd-10224e);border-radius:6px;overflow:hidden}' +
      '.seg button{border:0;border-radius:0;padding:7px 14px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e)}' +
      '.seg button:hover{color:var(--dbc-fg-1e6bff)}' +
      '.seg button[aria-pressed="true"]{background:var(--dbc-bg-10224e);color:var(--dbc-fg-fff)}' +
      '.status{margin-left:auto;font-size:12.5px;color:var(--dbc-fg-56637f)}' +
      '.note{margin:10px 0 0;padding:8px 12px;border-radius:0 6px 6px 0;font-size:13px}' +
      '.note.warn{background:var(--dbc-bg-fdf1d6);border-left:3px solid var(--dbc-bd-e3b04b)}' +
      '.note.block{background:var(--dbc-bg-fde8e8);border-left:3px solid var(--dbc-bd-a11a1a)}' +
      '.note.preview{background:var(--dbc-bg-e9f1ff);border-left:3px solid var(--dbc-bd-1e6bff)}' +
      // the two panes; body.view-* decides which one is on
      '#steps,#xaml{display:none}' +
      'body.view-steps #steps{display:block}body.view-xaml #xaml{display:flex}' +
      '#xaml{border:0;border-radius:0;box-shadow:none}' +
      'body.view-steps .only-xaml,body.view-xaml .only-steps{display:none}' +
      '#steps{flex:1;overflow:auto;padding:12px 22px 28px}' +
      '#steps main{max-width:900px}' +
      'h2{margin:22px 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--dbc-fg-56637f);' +
      'border-bottom:1px solid var(--dbc-bd-dde3f0);padding-bottom:6px}' +
      '.cond{margin:14px 0 6px;padding:7px 12px;background:var(--dbc-bg-e9f1ff);border-left:3px solid var(--dbc-bd-1e6bff);border-radius:0 6px 6px 0}' +
      '.cond.alt{background:var(--dbc-bg-f5f7fc);border-left-color:var(--dbc-bd-97a5c6)}' +
      '.step{margin:8px 0 4px;font-weight:600}' +
      '.line{margin:2px 0 2px 14px;padding:4px 10px;background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);' +
      'border-radius:6px;display:inline-block;font:13px ui-monospace,Consolas,monospace}' +
      '.line.verb{border-color:var(--dbc-bd-e3b04b);background:var(--dbc-bg-fffaf0)}' +
      '.sep{width:1px;align-self:stretch;margin:2px 4px;background:var(--dbc-bg-dde3f0)}' +
      'body.view-steps .sep{display:none}' +
      '.nb{display:inline-block;min-width:18px;margin-left:4px;padding:0 5px;border-radius:9px;background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f);font-size:11px;line-height:17px;text-align:center}.nb:empty{display:none}' +
      // Versions: the pane beside the XAML, as in the flow editor
      '#xwrap{display:none;flex:1;min-height:0}body.view-xaml #xwrap{display:flex}' +
      'aside{flex:none;width:340px;display:none;flex-direction:column;min-height:0;margin:14px 22px 18px 0;border:1px solid var(--dbc-bd-dde3f0);border-radius:8px;background:var(--dbc-bg-fff)}' +
      'body.side aside{display:flex}' +
      '.ck-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--dbc-bd-dde3f0);font-weight:600}' +
      '.pn{padding:4px 10px;border-radius:6px;background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-10224e);font-size:13px}' +
      '.ck-head button{margin-left:auto;padding:2px 8px;border:none;background:none;color:var(--dbc-fg-56637f);font-size:15px;line-height:1}' +
      '.ck-head button:hover{background:var(--dbc-bg-f5f7fc);color:var(--dbc-fg-10224e)}' +
      '.ck-list{flex:1;overflow:auto;padding:6px 0}' +
      '.vs-h{padding:10px 14px 4px;font-size:12px;font-weight:600;letter-spacing:.3px;text-transform:uppercase;color:var(--dbc-fg-56637f)}' +
      '.vs{display:flex;align-items:flex-start;gap:10px;margin:4px 10px;padding:8px 10px;border:1px solid var(--dbc-bd-e3e8f2);border-radius:6px;background:var(--dbc-bg-fff);cursor:pointer;transition:border-color .15s,background .15s}' +
      '.vs:hover{border-color:var(--dbc-bd-1e6bff);background:var(--dbc-bg-f7faff)}' +
      '.vs.orig{border-left:3px solid var(--dbc-bd-e3b04b)}.vs.here{box-shadow:0 0 0 2px var(--dbc-bd-1e6bff) inset}.vs.orig.live{background:var(--dbc-bg-fffaf0)}' +
      '.vs-dot{flex:none;width:9px;height:9px;margin-top:6px;border-radius:50%;background:var(--dbc-bg-c6d0e4)}' +
      '.vs.live .vs-dot{background:var(--dbc-bg-1c9b4a)}.vs.orig .vs-dot{background:var(--dbc-bg-e3b04b)}' +
      '.vs-main{flex:1;min-width:0}.vs-t{font-weight:600;font-size:13px}.vs-m{font-size:12px;color:var(--dbc-fg-56637f)}' +
      '.vs-tag{display:inline-block;margin-left:6px;padding:0 6px;border-radius:8px;font-size:11px;font-weight:600;vertical-align:1px}' +
      '.vs-tag.live{background:var(--dbc-bg-e4f4e8);color:var(--dbc-fg-1c6b32)}.vs-tag.here{background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-1e4fb8)}' +
      '.vs-note{padding:6px 14px 8px;font-size:12px;color:var(--dbc-fg-8a95ad)}' +
      DynaBoost.code.css +
      DynaBoost.tabCss +
      '</style>' +
      '<body class="view-steps side">' +
      '<header><h1>' + esc(wf.name) + '</h1>' +
      '<div class="grid">' + rows + '</div>' +
      (wf.description ? '<div class="desc">' + esc(wf.description) + '</div>' : '') +
      '<div class="only-steps note preview" id="preview" hidden></div>' +
      (blocked
        ? '<div class="only-xaml note block">' + esc(blocked) + '</div>'
        : '<div class="only-xaml note warn">Saving writes straight to Dataverse. A backup of the ' +
          'current XAML is downloaded before the first save. Refresh the designer afterwards to see ' +
          'the steps. Validation happens at activation, not here.</div>') +
      '<div class="bar">' +
      '<span class="seg" role="group" aria-label="View">' +
      '<button id="v-steps" aria-pressed="true">Steps</button>' +
      '<button id="v-xaml" aria-pressed="false">XAML</button></span>' +
      '<button class="only-steps" id="copy-text">Copy as text</button>' +
      '<button class="only-steps" id="dl-text">Download .txt</button>' +
      '<button class="only-xaml primary" id="save"' + (blocked ? ' disabled' : '') + '>Save to Dataverse</button>' +
      '<button class="only-xaml" id="backup">Download backup</button>' +
      '<button class="only-xaml" id="copy-xaml">Copy XAML</button>' +
      '<button class="only-xaml" id="reload">Reload from Dataverse</button>' +
      '<span class="sep"></span>' +
      '<button class="only-xaml" id="versions" aria-pressed="true" title="The XAML as opened and your saves - click one to load it">Versions<span class="nb" id="vs-n"></span></button>' +
      '<span class="status" id="status"></span>' +
      '</div></header>' +
      '<div id="steps"><main id="steps-main"></main></div>' +
      '<div id="xwrap"><textarea id="ed" spellcheck="false"' + (blocked ? ' readonly' : '') + '></textarea>' +
      '<aside><div class="ck-head"><span class="pn">Versions</span><button id="vs-close" title="Close" aria-label="Close">\u2715</button></div>' +
      '<div class="ck-list" id="vs-list"></div></aside></div>'
    );
  }

  function wire(tab, ctx) {
    const doc = tab.document;
    const get = (id) => doc.getElementById(id);
    const ed = get('ed');
    // The XAML pane is the editor's frame; body.view-* shows or hides it.
    DynaBoost.code.attach(tab, ed, 'xml');
    ed.closest('.cx').id = 'xaml';
    const status = (msg) => {
      if (get('status')) get('status').textContent = msg;
    };
    const safe = String(ctx.wf.name || 'workflow').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 80);

    ed.value = ctx.wf.xaml || '';
    let backedUp = false;
    let stepsText = '';
    let stepsFrom = null; // the XAML the Steps pane was last rendered from

    async function renderSteps(xaml, isPreview) {
      const items = await stepsFor(ctx.wf, xaml, status);
      get('steps-main').innerHTML = items.map(itemHtml).join('');
      stepsText = asText(ctx.wf, items);
      stepsFrom = xaml;
      const note = get('preview');
      note.hidden = !isPreview;
      if (isPreview) {
        note.textContent =
          'Preview of unsaved XAML from the editor. Save it to write it to Dataverse.';
      }
    }

    function show(view) {
      doc.body.classList.remove('view-steps', 'view-xaml');
      doc.body.classList.add('view-' + view);
      get('v-steps').setAttribute('aria-pressed', String(view === 'steps'));
      get('v-xaml').setAttribute('aria-pressed', String(view === 'xaml'));
      if (view === 'steps') {
        // Unsaved text in the editor is what the person wants to read back.
        const source = ed.value !== ctx.wf.xaml ? ed.value : ctx.wf.xaml || '';
        if (source !== stepsFrom) renderSteps(source, source !== ctx.wf.xaml);
      }
    }

    get('v-steps').addEventListener('click', () => show('steps'));
    get('v-xaml').addEventListener('click', () => show('xaml'));

    // ---------- versions ----------
    //
    // The pane beside the XAML, open from the start as in Edit flow: the XAML
    // as opened - always kept - and the last MAX_SAVED saves of this tab. A
    // click loads one into the editor; Save to Dataverse makes it live.

    // Compared as the editor holds text: a textarea turns \r\n into \n.
    const lf = (t) => String(t || '').replace(/\r\n?/g, '\n');
    const live = () => lf(ctx.wf.xaml); // what is in Dataverse
    const versions = { original: { text: lf(ctx.original), at: Date.now() }, saved: [], next: 1 };
    const list = get('vs-list');
    const kb = (t) => Math.max(1, Math.round(t.length / 1024)) + ' KB';
    const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    function versionOf(key) {
      if (key === 'o') return { v: versions.original, name: 'The original' };
      const v = versions.saved.find((x) => 's' + x.n === key);
      return v && { v: v, name: 'Version ' + v.n };
    }

    function renderVersions() {
      const row = (key, title, v) => {
        const inDv = v.text === live();
        const here = v.text === ed.value;
        return (
          '<div class="vs' + (key === 'o' ? ' orig' : '') + (inDv ? ' live' : '') + (here ? ' here' : '') + '" data-vs="' + key + '" title="Click to load into the editor">' +
          '<span class="vs-dot"></span><div class="vs-main"><div class="vs-t">' + esc(title) +
          (inDv ? '<span class="vs-tag live">in Dataverse</span>' : '') +
          (here && !inDv ? '<span class="vs-tag here">in the editor</span>' : '') +
          '</div><div class="vs-m">' + esc(clock(v.at)) + ' · ' + kb(v.text) + '</div></div></div>'
        );
      };
      const rows = ['<div class="vs-h">This tab</div>', row('o', 'Original', versions.original)];
      versions.saved.slice().reverse().forEach((v) => rows.push(row('s' + v.n, 'Version ' + v.n, v)));
      rows.push('<div class="vs-note">' + (versions.saved.length ? 'The last ' + MAX_SAVED + ' saves and the original. ' : 'Each save adds a version here. ') + 'They stay while this tab is open; the backup file stays in your downloads.</div>');
      list.innerHTML = rows.join('');
      get('vs-n').textContent = versions.saved.length ? String(versions.saved.length) : '';
    }

    function showVersions() {
      doc.body.classList.add('side');
      get('versions').setAttribute('aria-pressed', 'true');
      renderVersions();
    }

    function hideVersions() {
      doc.body.classList.remove('side');
      get('versions').setAttribute('aria-pressed', 'false');
    }

    get('versions').addEventListener('click', () => (doc.body.classList.contains('side') ? hideVersions() : showVersions()));
    get('vs-close').addEventListener('click', hideVersions);

    // "in the editor" follows the typing
    let marks = null;
    ed.addEventListener('input', () => {
      clearTimeout(marks);
      marks = setTimeout(renderVersions, 300);
    });

    list.addEventListener('click', (e) => {
      const el = e.target.closest('[data-vs]');
      const found = el && versionOf(el.getAttribute('data-vs'));
      if (!found || found.v.text === ed.value) return;
      const known = ed.value === live() || versions.saved.concat([versions.original]).some((v) => v.text === ed.value);
      if (!known && !tab.confirm('Replace your unsaved edit in the editor with ' + found.name.toLowerCase() + '?')) return;
      ed.value = found.v.text;
      renderVersions();
      const label = found.name.replace(/^The /, '').replace(/^./, (c) => c.toUpperCase());
      status(label + ' is in the editor' + (found.v.text === live() ? ' - the same as in Dataverse.' : ' - Save to Dataverse to make it live.'));
    });
    renderVersions();

    // A save that is neither the original nor the last version is a new one.
    function addVersion(text) {
      const last = versions.saved[versions.saved.length - 1];
      if (text === versions.original.text || (last && last.text === text)) return;
      versions.saved.push({ n: versions.next++, text: text, at: Date.now() });
      while (versions.saved.length > MAX_SAVED) versions.saved.shift();
      renderVersions();
    }

    // Closing the tab with an edit not in Dataverse asks first.
    tab.addEventListener('beforeunload', (e) => {
      if (ed.value !== live()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    get('copy-text').addEventListener('click', async () => {
      const ok = await copyInto(tab, stepsText);
      flash(get('copy-text'), ok ? 'Copied' : 'Press Ctrl+A, Ctrl+C', ok);
    });

    get('dl-text').addEventListener('click', () => {
      try {
        download(tab, stepsText, safe + '.txt', 'text/plain');
        flash(get('dl-text'), 'Downloaded', true);
      } catch (e) {
        flash(get('dl-text'), 'Download failed', false);
      }
    });

    function backup(auto) {
      try {
        download(tab, ctx.original, safe + '.backup.xaml', 'application/xml');
        backedUp = true;
        if (!auto) flash(get('backup'), 'Downloaded', true);
      } catch (e) {
        if (!auto) flash(get('backup'), 'Download failed', false);
      }
    }

    get('backup').addEventListener('click', () => backup(false));

    get('copy-xaml').addEventListener('click', async () => {
      const ok = await copyInto(tab, ed.value);
      flash(get('copy-xaml'), ok ? 'Copied' : 'Press Ctrl+A, Ctrl+C', ok);
    });

    async function refresh() {
      const fresh = await fetchWorkflow(ctx.id);
      ctx.wf = fresh;
      ctx.etag = fresh['@odata.etag'];
      ed.value = fresh.xaml || '';
      renderVersions();
      await renderSteps(ctx.wf.xaml || '', false);
    }

    get('reload').addEventListener('click', async () => {
      if (ed.value !== ctx.wf.xaml && !tab.confirm('Discard your edits and reload from Dataverse?')) return;
      try {
        await refresh();
        status('Reloaded.');
      } catch (e) {
        status('Reload failed: ' + e.message);
      }
    });

    async function save() {
      const btn = get('save');
      if (btn.disabled) return;

      let xaml = ed.value;
      if (!xaml.trim()) {
        flash(btn, 'Nothing to save', false);
        return;
      }

      const fixed = fixClass(xaml, ctx.id);
      xaml = fixed.xaml;
      if (fixed.changed) {
        ed.value = xaml;
        status('x:Class corrected to ' + className(ctx.id) + ' (' + fixed.changed + ' places).');
      }

      if (!backedUp) backup(true);

      btn.disabled = true;
      try {
        await saveXaml(ctx.id, ctx.etag, xaml);
        await refresh();
        addVersion(live());
        flash(btn, 'Saved \u2014 refresh the designer', true);
        status('Saved at ' + new Date().toLocaleTimeString() + '. Steps view updated.');
        DynaBoost.saved('workflow', 'save');
      } catch (e) {
        flash(btn, 'Save failed', false);
        status(e.message);
      } finally {
        btn.disabled = false;
      }
    }

    get('save').addEventListener('click', save);
    doc.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      }
    });

    renderSteps(ctx.wf.xaml || '', false);
  }

  // ---------- run ----------

  async function run() {
    const id = findWorkflowId();
    if (!id) return;

    const tab = window.open('', '_blank');
    if (tab) {
      tab.document.write(
        '<!doctype html><meta charset="utf-8"><title>Reading\u2026</title>' +
          '<body style="font:14px/1.5 \'Segoe UI\',system-ui,sans-serif;padding:24px;color:var(--dbc-fg-10224e)">' +
          '<p>Reading workflow\u2026</p>'
      );
      DynaBoost.themeTab(tab);
    }

    let wf;
    try {
      wf = await fetchWorkflow(id);
    } catch (e) {
      if (tab && !tab.closed) tab.close();
      window.alert('Could not read the workflow.\n\n' + e.message);
      return;
    }

    if (!tab || tab.closed) {
      window.alert('The tab was blocked. Allow pop-ups for this site and try again.');
      return;
    }

    tab.document.open();
    tab.document.write(buildHtml(wf, id));
    tab.document.close();
    DynaBoost.themeTab(tab);

    wire(tab, {
      id: id,
      wf: wf,
      etag: wf['@odata.etag'],
      original: wf.xaml || ''
    });
    DynaBoost.saved('workflow');
  }

  DynaBoost.register({
    id: 'workflow',
    name: 'Open workflow',
    group: 'Classic processes',
    hosts: ['dynamics.com'],
    // The classic UI: the workflow editor itself, a solution explorer it can
    // sit in, or a workflow record - never the Unified Interface elsewhere.
    when: () => {
      const q = new URLSearchParams(location.search);
      return /\/sfa\/workflow\/|\/tools\/solution\//i.test(location.pathname) || (q.get('etn') || '').toLowerCase() === 'workflow' || !!scanFrames(window, 0);
    },
    type: 'action',
    hint: 'The workflow’s steps and XAML in a tab',
    icon: ICON,
    onRun: run
  });
})();
