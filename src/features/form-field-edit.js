/* Form as JSON - Edit: a field's saved value changed in a window of its own -
 * also a column the form does not show, which the form cannot change at all.
 * Opened by Edit on a field's row (form-dump.js):
 *
 *   DynaBoost.fieldEdit.open(tab, item)
 *     tab   the Form as JSON tab - the window opens from it, within the click
 *     item  { entity, setName, id, recordName, field, displayName, onForm,
 *             choice, states (statecode's options), onSaved(record) }
 *
 * The window reads the column's definition and its value as saved now, and
 * offers what fits the type: text, a number, a date, Yes/No, a choice, several
 * choices, a lookup (found by name, or an id or record link pasted). Save
 * writes it with the Web API - PATCH with If-Match: *, so never a new record -
 * and reads it back; a lookup emptied is unlinked ($ref). A column Dataverse
 * does not let anyone write (calculated, rollup, Created On, the id...) says
 * why instead of offering a field.
 */
(function () {
  if (DynaBoost.off) return;

  const API = '/api/data/v9.2/';
  const FMT = '@OData.Community.Display.V1.FormattedValue';
  const LOOKUP_ENTITY = '@Microsoft.Dynamics.CRM.lookuplogicalname';
  const ANNOTATE = 'odata.include-annotations="*"';
  const GUID_IN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');

  // ---------- Web API ----------

  async function call(method, path, body, prefer) {
    const headers = { Accept: 'application/json', 'OData-Version': '4.0', 'OData-MaxVersion': '4.0' };
    if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
    // An update only: a record gone meanwhile is an error, not a new one.
    if (method === 'PATCH') headers['If-Match'] = '*';
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(API + path, { method: method, credentials: 'same-origin', headers: headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) {
      let detail = '';
      try {
        const j = await res.json();
        detail = (j.error && j.error.message) || '';
      } catch (e) {
        /* no JSON body */
      }
      throw new Error(detail || 'HTTP ' + res.status);
    }
    return res.status === 204 ? null : res.json();
  }

  // One column's whole definition - its own type's properties too (MaxLength,
  // Format, DateTimeBehavior, Targets...), as a single attribute comes back whole.
  const attrCache = new Map();
  function attribute(entity, field) {
    const key = entity + '/' + field;
    if (!attrCache.has(key)) {
      const p = call('GET', "EntityDefinitions(LogicalName='" + entity + "')/Attributes(LogicalName='" + field + "')");
      p.catch(() => attrCache.delete(key));
      attrCache.set(key, p);
    }
    return attrCache.get(key);
  }

  const defCache = new Map();
  function tableDef(entity) {
    if (!defCache.has(entity)) {
      const p = call('GET', "EntityDefinitions(LogicalName='" + entity + "')?$select=EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute,LogicalName,DisplayCollectionName");
      p.catch(() => defCache.delete(entity));
      defCache.set(entity, p);
    }
    return defCache.get(entity);
  }

  const tableLabel = (def) => {
    const l = def && def.DisplayCollectionName && def.DisplayCollectionName.UserLocalizedLabel;
    return (l && l.Label) || (def && def.LogicalName) || '';
  };

  /* The name a lookup is written by: its navigation property for that table
   * (parentcustomerid_account, parentcustomerid_contact) - the column's own
   * name for an owner, or when the table has no other. */
  async function navOf(entity, field, a, target) {
    if (a.AttributeType === 'Owner') return 'ownerid';
    const r = await call(
      'GET',
      "EntityDefinitions(LogicalName='" + entity + "')/ManyToOneRelationships?$select=ReferencingAttribute,ReferencedEntity,ReferencingEntityNavigationPropertyName&$filter=ReferencingAttribute eq '" + field + "'"
    );
    const hit = (r.value || []).find((x) => x.ReferencedEntity === target) || ((a.Targets || []).length === 1 ? (r.value || [])[0] : null);
    return hit ? hit.ReferencingEntityNavigationPropertyName : field;
  }

  // ---------- what the column is ----------

  function kindOf(a) {
    const tn = a.AttributeTypeName && a.AttributeTypeName.Value;
    if (tn === 'MultiSelectPicklistType') return 'multi';
    if (tn === 'ImageType' || tn === 'FileType') return null;
    const fmt = a.FormatName && a.FormatName.Value;
    switch (a.AttributeType) {
      case 'String':
        return fmt === 'TextArea' || fmt === 'Json' || fmt === 'RichText' ? 'area' : 'text';
      case 'Memo':
        return 'area';
      case 'Integer':
        return 'int';
      case 'BigInt':
        return 'bigint';
      case 'Decimal':
      case 'Money':
      case 'Double':
        return 'number';
      case 'Boolean':
        return 'bool';
      case 'Picklist':
        return 'choice';
      case 'Status':
        return 'status';
      case 'DateTime':
        return 'date';
      case 'Lookup':
      case 'Customer':
      case 'Owner':
        return 'lookup';
      default:
        return null;
    }
  }

  // Why Dataverse does not let this column be written - '' when it does.
  function whyNot(a, kind) {
    if (a.IsPrimaryId) return 'It is the record’s id.';
    if (a.SourceType === 1) return 'A calculated column: Dataverse works it out from its formula.';
    if (a.SourceType === 2) return 'A rollup column: Dataverse adds it up from related records.';
    if (a.SourceType === 3) return 'A formula column: Dataverse works it out from its formula.';
    if (a.AttributeType === 'State') return 'Status is changed with its Status Reason - Edit on Status Reason.';
    if (a.IsValidForUpdate === false) return 'Dataverse does not let anyone change this column once the record exists.';
    if (a.AttributeOf) return 'It belongs to ' + a.AttributeOf + ' and changes with it.';
    if (!kind) return 'A column of this type (' + String((a.AttributeTypeName && a.AttributeTypeName.Value) || a.AttributeType || '?').replace(/Type$/, '') + ') cannot be edited here.';
    return '';
  }

  const typeName = (a) => String((a.AttributeTypeName && a.AttributeTypeName.Value) || a.AttributeType || '').replace(/Type$/, '');
  const selectOf = (field, kind) => (kind === 'lookup' ? '_' + field + '_value' : field);

  // The value as it is now, for "Now".
  function nowHtml(rec, field, kind) {
    const key = selectOf(field, kind);
    const raw = rec[key];
    const fmt = rec[key + FMT];
    if (raw === null || raw === undefined || raw === '') return '<span class="fe-nil">empty</span>';
    if (kind === 'lookup') return '<b>' + esc(fmt || raw) + '</b> <code>' + esc(rec[key + LOOKUP_ENTITY] || '') + '</code><div class="fe-sub"><code>' + esc(raw) + '</code></div>';
    if (kind === 'status' && rec.statecode !== undefined && rec.statecode !== null) {
      return esc(fmt || raw) + ' <code>' + esc(raw) + '</code><div class="fe-sub">Status: ' + esc(rec['statecode' + FMT] || rec.statecode) + ' <code>' + esc(rec.statecode) + '</code></div>';
    }
    if (fmt !== undefined && String(fmt) !== String(raw)) return esc(fmt) + ' <code>' + esc(raw) + '</code>';
    return '<span class="fe-txt">' + esc(raw) + '</span>';
  }

  // ---------- dates ----------

  /* A date by its behaviour: Date only is a calendar day as it is; Time zone
   * independent is the time as written; User local is kept in UTC and shown
   * in this browser's time zone. */
  function dateMode(a) {
    const behaviour = (a.DateTimeBehavior && a.DateTimeBehavior.Value) || 'UserLocal';
    const dayOnly = behaviour === 'DateOnly' || a.Format === 'DateOnly';
    return { behaviour: behaviour, dayOnly: dayOnly };
  }
  function dateIn(raw, m) {
    if (!raw) return '';
    if (m.behaviour === 'DateOnly') return String(raw).slice(0, 10);
    if (m.behaviour === 'TimeZoneIndependent') return String(raw).slice(0, m.dayOnly ? 10 : 16);
    const d = new Date(raw);
    if (isNaN(d)) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + (m.dayOnly ? '' : 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()));
  }
  function dateOut(v, m) {
    if (!v) return null;
    if (m.behaviour === 'DateOnly') return v.slice(0, 10);
    if (m.behaviour === 'TimeZoneIndependent') return m.dayOnly ? v.slice(0, 10) + 'T00:00:00Z' : v.slice(0, 16) + ':00Z';
    const d = new Date(m.dayOnly ? v.slice(0, 10) + 'T00:00' : v);
    return isNaN(d) ? undefined : d.toISOString().replace(/\.000Z$/, 'Z');
  }
  function zoneText() {
    const off = -new Date().getTimezoneOffset();
    return 'UTC' + (off >= 0 ? '+' : '−') + pad(Math.floor(Math.abs(off) / 60)) + ':' + pad(Math.abs(off) % 60);
  }

  // ---------- the editors ----------

  /* One editor per kind: its HTML, and read() - { value } to write, or
   * { error }. Values are compared as JSON, so read() of the untouched
   * editor gives back what it was opened with. */
  function editorFor(kind, a, rec, item, doc) {
    const field = item.field;
    const raw = rec[selectOf(field, kind)];
    const get = (id) => doc.getElementById(id);
    const options = (item.choice && item.choice.options) || [];
    const num = (v) => (v === '' ? null : Number(v));

    if (kind === 'text' || kind === 'area') {
      const max = a.MaxLength || null;
      const html =
        (kind === 'area'
          ? '<textarea id="fe-in" rows="7"' + (max ? ' maxlength="' + max + '"' : '') + '>' + esc(raw || '') + '</textarea>'
          : '<input id="fe-in" type="text"' + (max ? ' maxlength="' + max + '"' : '') + ' value="' + esc(raw || '') + '">') +
        (max ? '<div class="fe-hint"><span id="fe-count">' + String(raw || '').length + '</span> / ' + max + ' characters</div>' : '');
      return {
        html: html,
        init() {
          const count = get('fe-count');
          if (count) get('fe-in').addEventListener('input', (e) => (count.textContent = e.target.value.length));
        },
        read: () => ({ value: get('fe-in').value === '' ? null : get('fe-in').value }),
        start: raw === undefined || raw === '' ? null : raw
      };
    }

    if (kind === 'int' || kind === 'bigint' || kind === 'number') {
      const min = typeof a.MinValue === 'number' ? a.MinValue : null;
      const max = typeof a.MaxValue === 'number' ? a.MaxValue : null;
      const html =
        '<input id="fe-in" type="' + (kind === 'bigint' ? 'text' : 'number') + '"' + (kind === 'int' ? ' step="1"' : ' step="any"') +
        (min !== null && kind !== 'bigint' ? ' min="' + min + '"' : '') + (max !== null && kind !== 'bigint' ? ' max="' + max + '"' : '') +
        ' value="' + esc(raw == null ? '' : raw) + '">' +
        (min !== null && max !== null ? '<div class="fe-hint">From ' + esc(min.toLocaleString()) + ' to ' + esc(max.toLocaleString()) + (a.AttributeType === 'Money' ? ' - in the record’s currency' : '') + '</div>' : '');
      return {
        html: html,
        read() {
          const v = get('fe-in').value.trim().replace(',', '.');
          if (v === '') return { value: null };
          const n = Number(v);
          if (!isFinite(n)) return { error: 'Not a number.' };
          if ((kind === 'int' || kind === 'bigint') && !Number.isInteger(n)) return { error: 'A whole number, please.' };
          if (kind === 'bigint' && !Number.isSafeInteger(n)) return { error: 'Too long a number to write from here.' };
          if ((min !== null && n < min) || (max !== null && n > max)) return { error: 'Outside what the column takes.' };
          return { value: n };
        },
        start: raw == null ? null : raw
      };
    }

    if (kind === 'bool') {
      const label = (v) => (options.find((o) => o.value === v) || {}).label || (v ? 'Yes' : 'No');
      const on = raw === true;
      return {
        html:
          '<div class="fe-opts">' +
          [0, 1].map((v) => '<label><input type="radio" name="fe-b" value="' + v + '"' + ((v === 1) === on && raw !== null && raw !== undefined ? ' checked' : '') + '> ' + esc(label(v)) + '</label>').join('') +
          '</div>',
        read() {
          const hit = doc.querySelector('input[name="fe-b"]:checked');
          return { value: hit ? hit.value === '1' : raw == null ? null : raw };
        },
        start: raw == null ? null : raw
      };
    }

    if (kind === 'choice') {
      return {
        html:
          '<select id="fe-in">' +
          '<option value=""' + (raw == null ? ' selected' : '') + '>(empty)</option>' +
          options.map((o) => '<option value="' + o.value + '"' + (o.value === raw ? ' selected' : '') + '>' + esc(o.label) + ' · ' + o.value + '</option>').join('') +
          '</select>',
        read: () => ({ value: num(get('fe-in').value) }),
        start: raw == null ? null : raw
      };
    }

    if (kind === 'status') {
      return statusEditor(rec, item, doc);
    }

    if (kind === 'multi') {
      const now = raw == null || raw === '' ? [] : String(raw).split(',').map((v) => Number(v));
      return {
        html:
          '<div class="fe-opts fe-many">' +
          options.map((o) => '<label><input type="checkbox" value="' + o.value + '"' + (now.includes(o.value) ? ' checked' : '') + '> ' + esc(o.label) + ' <code>' + o.value + '</code></label>').join('') +
          '</div>',
        read() {
          const v = Array.from(doc.querySelectorAll('.fe-many input:checked')).map((x) => Number(x.value)).sort((x, y) => x - y);
          return { value: v.length ? v.join(',') : null };
        },
        start: now.length ? now.slice().sort((x, y) => x - y).join(',') : null
      };
    }

    if (kind === 'date') {
      const m = dateMode(a);
      const start = dateIn(raw, m);
      return {
        html:
          '<input id="fe-in" type="' + (m.dayOnly ? 'date' : 'datetime-local') + '" value="' + esc(start) + '">' +
          '<div class="fe-hint">' +
          (m.behaviour === 'UserLocal'
            ? (m.dayOnly ? 'A date' : 'Date and time') + ' in this browser’s time zone (' + zoneText() + ') - Dynamics keeps it in UTC.'
            : m.behaviour === 'DateOnly'
            ? 'A calendar day - the same in every time zone.'
            : 'Kept as written - the same in every time zone.') +
          '</div>',
        read() {
          const v = dateOut(get('fe-in').value, m);
          return v === undefined ? { error: 'Not a date.' } : { value: v };
        },
        start: start ? dateOut(start, m) : null
      };
    }

    if (kind === 'lookup') {
      return lookupEditor(a, rec, item, doc);
    }
    return null;
  }

  /* Status Reason: every reason, under the status it belongs to - a reason
   * of another status sets that status too, in the same save (statecode and
   * statuscode together). Only the status: what Qualify, Resolve or Win do
   * besides (records made, a resolution) does not happen - said under the
   * list when it is picked. */
  function statusEditor(rec, item, doc) {
    const raw = rec.statuscode;
    const now = rec.statecode;
    const options = (item.choice && item.choice.options) || [];
    const states = item.states || [];
    const stateLabel = (v) => (states.find((x) => x.value === v) || {}).label || (v === now && rec['statecode' + FMT]) || 'Status ' + v;
    const byState = options.some((o) => o.state !== undefined);
    const order = Array.from(new Set(states.map((x) => x.value).concat(options.map((o) => o.state)))).filter((v) => v !== undefined && options.some((o) => o.state === v));
    const radio = (o) =>
      '<label><input type="radio" name="fe-r" value="' + o.value + '"' + (o.state !== undefined ? ' data-state="' + o.state + '"' : '') + (o.value === raw ? ' checked' : '') + '> ' + esc(o.label) + ' <code>' + o.value + '</code></label>';
    const html = byState
      ? order
          .map((v) => '<div class="fe-grp"><div class="fe-grp-h">' + esc(stateLabel(v)) + ' <code>' + v + '</code>' + (v === now ? '<span class="bd">now</span>' : '') + '</div>' + options.filter((o) => o.state === v).map(radio).join('') + '</div>')
          .join('')
      : options.map(radio).join('');
    const read = () => {
      const hit = doc.querySelector('input[name="fe-r"]:checked');
      if (!hit) return { value: { statuscode: raw == null ? null : raw, statecode: now } };
      const st = hit.hasAttribute('data-state') ? Number(hit.getAttribute('data-state')) : now;
      return { value: { statuscode: Number(hit.value), statecode: st } };
    };
    return {
      html: '<div class="fe-opts fe-reasons">' + html + '</div><div class="fe-hint" id="fe-st-hint"></div>',
      init(changed) {
        const hint = () => {
          const v = read().value;
          doc.getElementById('fe-st-hint').innerHTML =
            byState && v.statecode !== now
              ? '<b>Status changes too:</b> ' + esc(stateLabel(now)) + ' → ' + esc(stateLabel(v.statecode)) + '. Only the status - what Qualify, Resolve or Close do besides (new records, a resolution) does not happen.'
              : byState ? 'A reason under another status changes the status too.' : '';
        };
        doc.querySelector('.fe-reasons').addEventListener('change', hint);
        hint();
        const on = doc.querySelector('input[name="fe-r"]:checked');
        if (on) on.scrollIntoView({ block: 'nearest' });
      },
      read: read,
      start: { statuscode: raw == null ? null : raw, statecode: now },
      // What a save sends: the status only when it changes.
      body: (v) => (v.statecode !== now ? { statecode: v.statecode, statuscode: v.statuscode } : { statuscode: v.statuscode })
    };
  }

  /* A lookup: the table (when it takes more than one), its records at once -
   * the active ones, A to Z - narrowed as you type a name; an id or a
   * record's link pasted finds that one. The one picked stands on top and is
   * marked in the list. */
  const LIST_TOP = 50;
  const activeWorks = new Map(); // table -> whether "statecode eq 0" can be asked
  function lookupEditor(a, rec, item, doc) {
    const key = '_' + item.field + '_value';
    const targets = a.Targets || [];
    const start = rec[key] ? { entity: rec[key + LOOKUP_ENTITY] || targets[0], id: String(rec[key]).toLowerCase(), name: rec[key + FMT] || rec[key] } : null;
    let picked = start;
    let rows = [];
    let timer = null;
    let asked = 0;
    const get = (id) => doc.getElementById(id);

    const pickedHtml = () =>
      picked
        ? '<b>' + esc(picked.name) + '</b> <code>' + esc(picked.entity) + '</code><button type="button" class="fe-x" id="fe-clear" title="Leave it empty" aria-label="Leave it empty">×</button>'
        : '<span class="fe-nil">empty</span>';

    // The records of a table: by name, active first when the table has a status.
    async function records(def, target, q) {
      const id = (q.match(GUID_IN) || [])[0];
      if (id) {
        const r = await call('GET', def.EntitySetName + '(' + id.toLowerCase() + ')?$select=' + def.PrimaryIdAttribute + ',' + def.PrimaryNameAttribute);
        return { list: [r], how: 'id' };
      }
      const base = def.EntitySetName + '?$select=' + def.PrimaryIdAttribute + ',' + def.PrimaryNameAttribute + '&$orderby=' + def.PrimaryNameAttribute + '&$top=' + LIST_TOP;
      const byName = q ? 'contains(' + def.PrimaryNameAttribute + ",'" + q.replace(/'/g, "''") + "')" : '';
      const ask = (parts) => call('GET', base + (parts.length ? '&$filter=' + encodeURIComponent(parts.join(' and ')) : ''));
      if (activeWorks.get(target) !== false) {
        try {
          const r = await ask([byName, 'statecode eq 0'].filter(Boolean));
          activeWorks.set(target, true);
          return { list: r.value || [], how: 'active' };
        } catch (e) {
          activeWorks.set(target, false); // a table with no status
        }
      }
      const r = await ask([byName].filter(Boolean));
      return { list: r.value || [], how: 'all' };
    }

    function drawRows(head) {
      const box = get('fe-hits');
      box.innerHTML =
        (head ? '<div class="fe-hits-h">' + head + '</div>' : '') +
        rows
          .map((r, i) => {
            const on = picked && picked.entity === r.entity && picked.id === r.id;
            return '<button type="button" class="fe-hit' + (on ? ' on' : '') + '" data-hit="' + i + '"><span>' + esc(r.name) + '</span><code>' + esc(r.id.slice(0, 8)) + '…</code></button>';
          })
          .join('');
    }

    async function search() {
      const q = get('fe-q').value.trim();
      const box = get('fe-hits');
      const n = ++asked;
      const target = get('fe-t') ? get('fe-t').value : targets[0];
      box.innerHTML = '<div class="fe-wait">' + DynaBoost.status.html('busy') + ' Reading…</div>';
      try {
        const def = await tableDef(target);
        const name = tableLabel(def);
        get('fe-q').placeholder = 'Type to narrow ' + name + ' by name, or paste an id or link';
        const got = await records(def, target, q);
        if (n !== asked) return;
        rows = got.list.map((r) => ({ entity: target, id: String(r[def.PrimaryIdAttribute] || '').toLowerCase(), name: r[def.PrimaryNameAttribute] || '(no name)' }));
        const many = rows.length === LIST_TOP ? ' - the first ' + LIST_TOP + ', type to narrow' : '';
        const head = got.how === 'id' ? 'By its id' : !rows.length ? '' : (got.how === 'active' ? 'Active ' : '') + esc(name) + (q ? ' with “' + esc(q) + '”' : '') + ', A to Z' + many;
        if (!rows.length) {
          box.innerHTML = '<div class="fe-wait">' + (q ? 'Nothing found by that name.' : 'No ' + (got.how === 'active' ? 'active ' : '') + esc(name) + '.') + '</div>';
          return;
        }
        drawRows(head);
      } catch (e) {
        if (n !== asked) return;
        box.innerHTML = '<div class="fe-wait fe-bad">' + esc(e.message) + '</div>';
      }
    }

    return {
      html:
        '<div class="fe-pick" id="fe-pick">' + pickedHtml() + '</div>' +
        '<div class="fe-find">' +
        (targets.length > 1 ? '<select id="fe-t" title="Which table">' + targets.map((t) => '<option' + (start && start.entity === t ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select>' : '') +
        '<input id="fe-q" type="search" placeholder="Type to narrow by name, or paste an id or link" autocomplete="off">' +
        '</div><div class="fe-hits" id="fe-hits"></div>',
      init(changed) {
        get('fe-q').addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(search, 300);
        });
        if (get('fe-t')) get('fe-t').addEventListener('change', search);
        // On its own parts - drawn anew after a save, with their listeners.
        get('fe-hits').addEventListener('click', (e) => {
          const hit = e.target.closest('[data-hit]');
          if (!hit) return;
          picked = rows[Number(hit.getAttribute('data-hit'))];
          const head = get('fe-hits').querySelector('.fe-hits-h');
          drawRows(head ? head.innerHTML : '');
          get('fe-pick').innerHTML = pickedHtml();
          changed();
        });
        get('fe-pick').addEventListener('click', (e) => {
          if (!e.target.closest('#fe-clear')) return;
          picked = null;
          get('fe-hits').querySelectorAll('.fe-hit.on').forEach((b) => b.classList.remove('on'));
          get('fe-pick').innerHTML = pickedHtml();
          changed();
        });
        search(); // the records at once, nothing typed
      },
      read: () => ({ value: picked ? { entity: picked.entity, id: String(picked.id).toLowerCase() } : null }),
      start: start ? { entity: start.entity, id: start.id } : null
    };
  }

  // ---------- the window ----------

  const CSS =
    'html,body{height:100%}' +
    'body{margin:0;display:flex;flex-direction:column;font:14px/1.45 "Segoe UI",system-ui,sans-serif;color:var(--dbc-fg-10224e);background:var(--dbc-bg-f5f7fc)}' +
    'header{flex:none;padding:14px 20px 12px}header h1{font-size:18px}' +
    'code{font:12.5px ui-monospace,Consolas,monospace;color:var(--dbc-fg-56637f)}' +
    '.fe{flex:1;overflow:auto;padding:16px 20px 20px}' +
    '.fe-card{padding:14px 16px 16px;background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px}' +
    '.fe-k{display:block;margin:0 0 5px;font-size:12px;font-weight:600;color:var(--dbc-fg-56637f)}' +
    '.fe-now{margin-bottom:16px}.fe-txt{white-space:pre-wrap;overflow-wrap:anywhere}' +
    '.fe-sub{margin-top:1px;font-size:12px}' +
    '.fe-nil{color:var(--dbc-fg-97a5c6)}' +
    '.fe-note{margin:0 0 14px;padding:8px 12px;border-left:3px solid var(--dbc-bd-e3b04b);border-radius:6px;background:var(--dbc-bg-fffaf0);font-size:13px}' +
    '.fe-why{margin:0;padding:10px 12px;border-left:3px solid var(--dbc-bd-c6d0e4);border-radius:6px;background:var(--dbc-bg-f5f7fc);font-size:13.5px}' +
    'input:not([type=radio]):not([type=checkbox]),select,textarea{box-sizing:border-box;width:100%;padding:7px 10px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);font:inherit}' +
    'textarea{resize:vertical;min-height:110px}' +
    'input:focus,select:focus,textarea:focus{outline:none;border-color:var(--dbc-bd-1e6bff);box-shadow:0 0 0 3px rgba(30,107,255,.15)}' +
    'input[type=radio],input[type=checkbox]{width:15px;height:15px;margin:0;accent-color:var(--dbc-bd-1e6bff);cursor:pointer}' +
    '.fe-hint{margin-top:6px;font-size:12px;color:var(--dbc-fg-56637f)}' +
    '.fe-opts{display:flex;flex-direction:column;gap:7px}.fe-opts label{display:flex;align-items:center;gap:8px;cursor:pointer}' +
    '.fe-many{max-height:220px;overflow:auto}' +
    '.fe-pick{display:flex;align-items:center;gap:8px;min-height:24px;margin-bottom:10px;padding:6px 10px;border:1px solid var(--dbc-bd-e3b04b);border-radius:6px;background:var(--dbc-bg-fffaf0)}' +
    '.fe-pick code{margin-left:2px}' +
    '.fe-x{margin-left:auto;padding:0 8px;border:0;background:none;color:var(--dbc-fg-56637f);font-size:18px;line-height:1}.fe-x:hover{color:var(--dbc-fg-a11a1a)}' +
    '.fe-find{display:flex;gap:8px}.fe-find select{flex:none;width:auto}' +
    '.fe-hits{margin-top:6px;border-radius:6px;overflow:hidden}.fe-hits:not(:empty){border:1px solid var(--dbc-bd-dde3f0)}' +
    '.fe-hit{display:flex;width:100%;justify-content:space-between;gap:10px;padding:7px 10px;border:0;border-top:1px solid var(--dbc-bd-edf1f8);border-radius:0;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);text-align:left}' +
    '.fe-hit:first-child{border-top:0}.fe-hit:hover{background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-10224e)}' +
    '.fe-hits{max-height:250px;overflow:auto}' +
    '.fe-hits-h{position:sticky;top:0;padding:6px 10px;border-bottom:1px solid var(--dbc-bd-dde3f0);background:var(--dbc-bg-f5f7fc);font-size:12px;color:var(--dbc-fg-56637f)}' +
    '.fe-hits-h+.fe-hit{border-top:0}' +
    '.fe-hit.on{font-weight:600;background:var(--dbc-bg-fffaf0)}.fe-hit.on span::before{content:"● ";color:var(--dbc-fg-e3b04b)}' +
    '.fe-reasons{gap:0;max-height:300px;overflow:auto;padding-right:4px}' +
    '.fe-grp{padding:2px 0 8px}.fe-grp+.fe-grp{border-top:1px solid var(--dbc-bd-edf1f8);padding-top:8px}' +
    '.fe-grp-h{margin:0 0 5px;font-size:12px;font-weight:600;color:var(--dbc-fg-56637f)}.fe-grp-h code{font-size:11.5px;font-weight:400}' +
    '.fe-grp label{padding:3px 0 3px 4px}' +
    '.fe-hint b{font-weight:600;color:var(--dbc-fg-10224e)}' +
    '.fe-wait{display:flex;align-items:center;gap:8px;padding:8px 10px;font-size:13px;color:var(--dbc-fg-56637f)}.fe-bad{color:var(--dbc-fg-a11a1a)}' +
    '.fe-bar{display:flex;align-items:center;gap:8px;margin-top:16px}' +
    'button{padding:7px 14px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);font:inherit;cursor:pointer}' +
    'button:hover{border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-1e6bff)}' +
    'button.primary{background:var(--dbc-bg-1e6bff);border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-fff);font-weight:600}' +
    'button.primary:hover{background:var(--dbc-bg-155ee0);color:var(--dbc-fg-fff)}' +
    'button:disabled,button:disabled:hover{opacity:.5;cursor:default;border-color:var(--dbc-bd-c6d0e4);color:var(--dbc-fg-10224e)}' +
    'button.primary:disabled,button.primary:disabled:hover{background:var(--dbc-bg-1e6bff);border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-fff)}' +
    '.fe-st{display:flex;align-items:center;gap:8px;margin-left:6px;font-size:13px;color:var(--dbc-fg-56637f)}' +
    '.fe-st.ok{color:var(--dbc-fg-1c6b32)}.fe-st.bad{color:var(--dbc-fg-a11a1a)}' +
    '.bd{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:10px;background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f);font-size:11px;vertical-align:1px}';

  /* Opened from the Form as JSON tab, within the click - one window per
   * field of the record: Edit on it again brings the same window up. */
  function open(tab, item) {
    const name = 'dbEdit_' + item.id + '_' + item.field;
    const w = tab.open('', name, 'popup,width=640,height=640,left=' + Math.round(tab.screenX + Math.max(0, (tab.outerWidth - 640) / 2)) + ',top=' + Math.round(tab.screenY + 80));
    if (!w) {
      tab.alert('The window was blocked. Allow pop-ups for this site and try again.');
      return;
    }
    if (w.__dbFieldEdit && !w.closed && w.document.body) {
      w.focus();
      return;
    }
    w.__dbFieldEdit = true;
    const title = item.displayName || item.field;
    w.document.open();
    w.document.write(
      '<!doctype html><meta charset="utf-8"><title>Edit ' + esc(title) + '</title>' +
        '<style>' + DynaBoost.status.css + CSS + DynaBoost.tabCss + '</style>' +
        '<body><header><h1>' + esc(title) + '</h1><div class="crumbs"><code>' + esc(item.field) + '</code> · ' + esc(item.recordName || item.entity) + '</div></header>' +
        '<main class="fe"><div class="fe-wait">' + DynaBoost.status.html('busy') + ' Reading the column and its value…</div></main>'
    );
    w.document.close();
    DynaBoost.themeTab(w);
    fill(w, item).catch((e) => {
      if (w.closed) return;
      w.document.querySelector('.fe').innerHTML = '<div class="fe-wait fe-bad">' + DynaBoost.status.html('bad') + ' Could not read the column: ' + esc(e.message) + '</div>';
    });
  }

  async function fill(w, item) {
    const doc = w.document;
    const get = (id) => doc.getElementById(id);
    const a = await attribute(item.entity, item.field);
    const kind = kindOf(a);
    const why = whyNot(a, kind);
    const sel = kind ? selectOf(item.field, kind) : item.field;
    // The value as saved now - the tab may have been open a while.
    const readNow = () => call('GET', item.setName + '(' + item.id + ')?$select=' + sel + (kind === 'status' ? ',statecode' : ''), undefined, ANNOTATE);
    let rec = {};
    try {
      rec = await readNow();
    } catch (e) {
      if (!why) throw e; // not writable: its reason is shown without the value
    }
    if (w.closed) return;

    const crumbs = doc.querySelector('.crumbs');
    crumbs.innerHTML = '<code>' + esc(item.field) + '</code> · ' + esc(typeName(a)) + ' · ' + esc(item.recordName || item.entity) + (item.onForm ? '' : '<span class="bd">not on this form</span>');

    const main = doc.querySelector('.fe');
    const nowBox = () => '<div class="fe-now"><span class="fe-k">Saved now</span><div id="fe-now">' + nowHtml(rec, item.field, kind) + '</div></div>';
    if (why) {
      main.innerHTML = '<div class="fe-card">' + nowBox() + '<p class="fe-why">' + esc(why) + '</p></div>';
      return;
    }

    let ed = editorFor(kind, a, rec, item, doc);
    main.innerHTML =
      '<div class="fe-card">' +
      nowBox() +
      (item.onForm ? '' : '<p class="fe-note">This column is not on the form, so the form cannot change it - Save writes it straight to the record.</p>') +
      '<label class="fe-k" for="fe-in">New value</label><div id="fe-ed">' + ed.html + '</div>' +
      '<div class="fe-bar"><button type="button" class="primary" id="fe-save" disabled>Save</button><button type="button" id="fe-close">Close</button><span class="fe-st" id="fe-st" role="status"></span></div>' +
      '</div>';

    let start = JSON.stringify(ed.start);
    let saving = false;
    let leaving = false;
    const dirty = () => {
      const r = ed.read();
      return !!r.error || JSON.stringify(r.value) !== start;
    };
    const status = (k, text) => {
      const st = get('fe-st');
      st.className = 'fe-st' + (k ? ' ' + k : '');
      st.innerHTML = (k ? DynaBoost.status.html(k) : '') + '<span>' + esc(text) + '</span>';
    };
    const changed = () => {
      if (saving) return;
      get('fe-save').disabled = !dirty();
      if (!get('fe-st').classList.contains('busy')) status('', '');
    };
    if (ed.init) ed.init(changed);
    doc.addEventListener('input', changed);
    doc.addEventListener('change', changed);
    const first = doc.querySelector('#fe-ed input:not([type=radio]):not([type=checkbox]), #fe-ed select, #fe-ed textarea');
    if (first) first.focus();

    async function save() {
      if (saving || get('fe-save').disabled) return;
      const r = ed.read();
      if (r.error) return status('bad', r.error);
      saving = true;
      get('fe-save').disabled = true;
      status('busy', 'Saving…');
      try {
        const path = item.setName + '(' + item.id + ')';
        if (kind === 'lookup') {
          const before = JSON.parse(start);
          if (r.value) {
            const def = await tableDef(r.value.entity);
            const nav = await navOf(item.entity, item.field, a, r.value.entity);
            await call('PATCH', path, { [nav + '@odata.bind']: '/' + def.EntitySetName + '(' + r.value.id + ')' });
          } else if (before) {
            const nav = await navOf(item.entity, item.field, a, before.entity);
            await call('DELETE', path + '/' + nav + '/$ref');
          }
        } else {
          await call('PATCH', path, ed.body ? ed.body(r.value) : { [item.field]: r.value });
        }
        rec = await readNow();
        if (w.closed) return;
        get('fe-now').innerHTML = nowHtml(rec, item.field, kind);
        // The editor starts again from what the record has now.
        ed = editorFor(kind, a, rec, item, doc);
        start = JSON.stringify(ed.start);
        // Drawn again where it shows what the record has (the picked one, the present status).
        if (kind === 'lookup' || kind === 'status') {
          get('fe-ed').innerHTML = ed.html;
          ed.init(changed);
        }
        saving = false;
        get('fe-save').disabled = !dirty();
        status('ok', 'Saved. The form shows it after a refresh (F5).');
        if (item.onSaved) item.onSaved(rec);
        DynaBoost.saved('form-dump', 'edit');
      } catch (e) {
        saving = false;
        get('fe-save').disabled = false;
        status('bad', 'Not saved: ' + e.message);
      }
    }

    get('fe-save').addEventListener('click', save);
    const close = () => {
      if (dirty() && !w.confirm('Close without saving the new value?')) return;
      leaving = true; // asked already - not again as it unloads
      w.close();
    };
    get('fe-close').addEventListener('click', close);
    doc.addEventListener('keydown', (e) => {
      const t = e.target;
      // Esc in the lookup's search empties the search first, as it does anywhere.
      if (e.key === 'Escape') return t.type === 'search' && t.value ? undefined : close();
      // Enter saves from a one-line field; Ctrl+Enter from anywhere.
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || (t.tagName === 'INPUT' && t.id === 'fe-in'))) {
        e.preventDefault();
        save();
      }
    });
    w.addEventListener('beforeunload', (e) => {
      if (leaving || !dirty()) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  DynaBoost.fieldEdit = { open: open };
})();
