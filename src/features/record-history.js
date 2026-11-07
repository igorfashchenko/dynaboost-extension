/* Features: Record history and Last change (model-driven record forms).
 *
 * Record history: every audited change of the record in a tab - who, when,
 * the action, and each field's old and new value - newest first; filtered
 * by field, by who or by any text; Copy (Markdown) or Download CSV.
 *
 * Last change: a switch. While on, under each field's label a small badge
 * shows its last change, the old value and the new; on hover a card says who
 * and when; a click opens Record history on that field. The badges are drawn by
 * form-tools-hook.js (the page's Xrm knows the controls), read here.
 *
 * Both read the audit of the environment, with the user's own session: the
 * audit rows (who, when, which columns - the attribute mask) and, for the
 * values, RetrieveAuditDetails per change - the Web API's change history
 * does not say who made a change. Nothing is written. Auditing off, or no
 * right to read it: they say so.
 */
(function () {
  if (DynaBoost.off) return;
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="M4 4.5v3.4h3.4" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M12 8v4.3l2.8 1.8" stroke="#E3B04B" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
  const BADGE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M4 6h10M4 10h6" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
    '<rect x="4" y="13.5" width="16" height="6" rx="2" stroke="#3D8BFF" stroke-width="1.6" stroke-dasharray="2.2 1.6"/>' +
    '<circle cx="18" cy="7" r="3.2" stroke="#E3B04B" stroke-width="1.5"/>' +
    '<path d="M18 5.6V7l.9.7" stroke="#E3B04B" stroke-width="1.3" stroke-linecap="round"/>' +
    '</svg>';
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 13 4 4L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const API = '/api/data/v9.2/';
  const F = '@OData.Community.Display.V1.FormattedValue';
  const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const MAX_TAB = 2000; // changes in the tab, newest first
  const MAX_BADGES = 500; // changes read for the badges
  const EXACT = 20; // the newest of them read whole - columns and values
  // v2: helpers from before it (no stop()) do not hear this channel.
  const SRC = 'dynaboost-form-tools-v2';
  const top = window.top === window;
  const toast = (title, sub, error) => DynaBoost.toast(title, sub, error);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // The record of this page: { table, id } - id '' for one not saved yet.
  function here() {
    const pg = DynaBoost.page();
    if (pg.type !== 'entityrecord' || !pg.etn) return null;
    return { table: pg.etn, id: pg.id };
  }

  // ---------- reading the audit ----------

  const HEADERS = { Accept: 'application/json', 'OData-Version': '4.0', 'OData-MaxVersion': '4.0', Prefer: 'odata.include-annotations="*"' };

  async function get(url, prefer) {
    const res = await fetch(/^(https:|\/)/.test(url) ? url : API + url, {
      credentials: 'same-origin',
      headers: Object.assign({}, HEADERS, prefer ? { Prefer: prefer } : {})
    });
    if (!res.ok) {
      let msg = '';
      try {
        msg = (await res.json()).error.message;
      } catch (e) {
        /* no message in the answer */
      }
      const err = new Error(msg || 'HTTP ' + res.status);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  const labelOf = (l) => (l && l.UserLocalizedLabel && l.UserLocalizedLabel.Label) || '';

  /* The table: its set, primary name, label and audit switch, and its
   * columns by name and by column number - the audit names a change's
   * columns by number. A column with AttributeOf (an owner's type, a
   * lookup's name) counts as the column it belongs to. */
  const metaCache = new Map();
  function meta(table) {
    if (!metaCache.has(table)) {
      const def = "EntityDefinitions(LogicalName='" + table + "')";
      const p = Promise.all([
        get(def + '?$select=EntitySetName,PrimaryNameAttribute,DisplayName,IsAuditEnabled'),
        get(def + '/Attributes?$select=LogicalName,ColumnNumber,DisplayName,AttributeOf,AttributeType')
      ]).then(([d, attrs]) => {
        const byName = new Map();
        const byNumber = new Map();
        for (const a of attrs.value || []) {
          const c = { name: a.LogicalName, label: labelOf(a.DisplayName) || a.LogicalName, of: a.AttributeOf || '' };
          byName.set(c.name, c);
          if (a.ColumnNumber != null) byNumber.set(a.ColumnNumber, c);
        }
        return {
          table: table,
          set: d.EntitySetName,
          primary: d.PrimaryNameAttribute,
          label: labelOf(d.DisplayName) || table,
          audit: d.IsAuditEnabled ? d.IsAuditEnabled.Value : null,
          byName: byName,
          byNumber: byNumber
        };
      });
      p.catch(() => metaCache.delete(table));
      metaCache.set(table, p);
    }
    return metaCache.get(table);
  }

  const owner = (m, name) => {
    const c = m.byName.get(name);
    return c && c.of ? c.of : name;
  };
  const colLabel = (m, name) => (m.byName.get(name) || {}).label || name;

  async function readAudits(rec, max) {
    const read = async (filter) => {
      const out = [];
      let url = API + 'audits?$select=auditid,createdon,action,operation,attributemask,_userid_value,_callinguserid_value&$filter=' + filter + '&$orderby=createdon desc';
      while (url && out.length < max) {
        const page = await get(url, 'odata.include-annotations="*",odata.maxpagesize=' + Math.min(500, max));
        out.push(...(page.value || []));
        url = page['@odata.nextLink'];
      }
      return out.slice(0, max);
    };
    try {
      return await read('_objectid_value eq ' + rec.id + " and objecttypecode eq '" + rec.table + "'");
    } catch (e) {
      // An environment that does not filter on the table this way: the id alone.
      if (e.status !== 400) throw e;
      return read('_objectid_value eq ' + rec.id);
    }
  }

  // An audit row as a change: who, when, the action and its columns.
  function change(a, m) {
    const cols = [];
    for (const n of String(a.attributemask || '').split(',')) {
      if (!n.trim()) continue;
      const c = m.byNumber.get(Number(n));
      if (!c) continue;
      const name = c.of || c.name;
      if (cols.indexOf(name) < 0) cols.push(name);
    }
    const caller = a._callinguserid_value && a._callinguserid_value !== a._userid_value ? a['_callinguserid_value' + F] || '' : '';
    return {
      id: a.auditid,
      when: new Date(a.createdon),
      who: a['_userid_value' + F] || 'unknown',
      caller: caller,
      action: a['action' + F] || String(a.action),
      cols: cols,
      values: null,
      note: '',
      failed: ''
    };
  }

  function valueOf(o, col) {
    if (!o) return '';
    for (const k of ['_' + col + '_value', col]) {
      if (!(k in o)) continue;
      if (o[k + F] != null) return String(o[k + F]);
      const v = o[k];
      if (v == null) return '';
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
    return '';
  }

  // A change's values: old and new for each of its columns.
  async function fill(ch, m) {
    const path = 'audits(' + ch.id + ')/Microsoft.Dynamics.CRM.RetrieveAuditDetails';
    let r;
    try {
      r = await get(path);
    } catch (e) {
      // An environment that wants the function's brackets.
      if (e.status !== 400 && e.status !== 404) throw e;
      r = await get(path + '()');
    }
    const d = r.AuditDetail || {};
    const type = String(d['@odata.type'] || '');
    if (/RelationshipAuditDetail/.test(type)) ch.note = 'Relationship ' + (d.RelationshipName || '') + ' · ' + (d.TargetRecords || []).length + ' record(s)';
    if (/ShareAuditDetail/.test(type)) ch.note = 'Access: ' + (d.OldPrivileges || 'none') + ' → ' + (d.NewPrivileges || 'none');
    const oldV = d.OldValue || null;
    const newV = d.NewValue || null;
    const cols = ch.cols.slice();
    for (const o of [oldV, newV]) {
      if (!o) continue;
      for (const k of Object.keys(o)) {
        if (k.indexOf('@') >= 0) continue;
        const name = owner(m, k.replace(/^_(.+)_value$/, '$1'));
        if (cols.indexOf(name) < 0) cols.push(name);
      }
    }
    const values = {};
    for (const c of cols) values[c] = { old: valueOf(oldV, c), new: valueOf(newV, c) };
    ch.cols = cols;
    ch.values = values;
  }

  // Changes whose values are wanted, six at a time; urgent ones go first.
  function loader(m, onDone) {
    const jobs = new Map();
    const pending = [];
    let busy = 0;
    const pump = () => {
      while (busy < 6 && pending.length) {
        const j = pending.shift();
        busy++;
        fill(j.ch, m)
          .catch((e) => {
            j.ch.failed = (e && e.message) || String(e);
          })
          .then(() => {
            busy--;
            onDone(j.ch);
            j.resolve();
            pump();
          });
      }
    };
    return (ch, urgent) => {
      if (ch.values || ch.failed) return Promise.resolve();
      let j = jobs.get(ch);
      if (!j) {
        j = { ch: ch };
        j.promise = new Promise((r) => (j.resolve = r));
        jobs.set(ch, j);
        if (urgent) pending.unshift(j);
        else pending.push(j);
        pump();
      } else if (urgent) {
        const k = pending.indexOf(j);
        if (k > 0) pending.unshift(pending.splice(k, 1)[0]);
      }
      return j.promise;
    };
  }

  // Why there is nothing to show: auditing off for the table or everywhere.
  async function auditOff(m) {
    if (m.audit === false) return 'Auditing is off for the table ' + m.label + ' - turn it on in its properties (Advanced options > Audit changes to its data).';
    try {
      const o = await get('organizations?$select=isauditenabled');
      if (o.value && o.value[0] && o.value[0].isauditenabled === false) return 'Auditing is off for this environment - an admin turns it on in the Power Platform admin center (Settings > Audit and logs).';
    } catch (e) {
      /* not readable - say nothing more */
    }
    return '';
  }

  const whyFailed = (e) =>
    e && e.status === 403
      ? 'Your security role cannot read the audit history (it needs the View Audit History privilege).'
      : 'The audit could not be read: ' + ((e && e.message) || e);

  // ---------- time ----------

  function ago(d) {
    const s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 86400 * 30) return Math.floor(s / 86400) + ' d ago';
    if (s < 86400 * 365) return Math.floor(s / 86400 / 30) + ' mo ago';
    return Math.floor(s / 86400 / 365) + ' y ago';
  }
  const longDate = (d) => d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const pad = (n) => String(n).padStart(2, '0');
  const isoLocal = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());

  // ---------- Record history: the tab ----------

  const CSS =
    '[hidden]{display:none!important}' +
    'body{margin:0;background:var(--dbc-bg-f5f7fc);color:var(--dbc-fg-10224e);font:14px/1.45 "Segoe UI",system-ui,sans-serif}' +
    'header{padding:16px 22px 12px}' +
    '.bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px}' +
    'button,select,input{padding:7px 11px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);font:inherit;font-size:13.5px}' +
    'button{cursor:pointer;transition:background-color .15s,border-color .15s,color .15s}' +
    'button:hover{border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-1e6bff)}' +
    'button.primary{background:var(--dbc-bg-1e6bff);border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-fff);font-weight:600}' +
    'button.primary:hover{background:var(--dbc-bg-155ee0);color:var(--dbc-fg-fff)}' +
    'button svg{width:14px;height:14px;vertical-align:-2px;margin-right:6px}' +
    'button.db-ok,button.db-ok:hover{border-color:var(--dbc-bd-1c6b32);color:var(--dbc-fg-1c6b32);background:var(--dbc-bg-e4f4e8)}' +
    'button.db-bad,button.db-bad:hover{border-color:var(--dbc-bd-a11a1a);color:var(--dbc-fg-a11a1a);background:var(--dbc-bg-fde8e8)}' +
    'select{max-width:260px}input{width:200px}' +
    'select:focus,input:focus{outline:none;border-color:var(--dbc-bd-1e6bff)}' +
    '.sep{width:1px;align-self:stretch;margin:2px 4px;background:var(--dbc-bg-dde3f0)}' +
    '.count{color:var(--dbc-fg-56637f);font-size:13px}' +
    'main{margin:10px 22px 40px;max-width:1100px}' +
    '.wait{display:flex;align-items:center;gap:14px;padding:18px 4px;color:var(--dbc-fg-56637f)}' +
    '.chg{margin:0 0 10px;padding:10px 14px 12px;background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-left:4px solid var(--dbc-bd-c6d0e4);border-radius:8px}' +
    '.chg.create{border-left-color:var(--dbc-bd-1c6b32)}.chg.update{border-left-color:var(--dbc-bd-1e6bff)}.chg.other{border-left-color:var(--dbc-bd-e3b04b)}' +
    '.ch-h{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 10px}' +
    '.ago,.via{color:var(--dbc-fg-56637f);font-size:12.5px}' +
    '.who{font-weight:600}' +
    '.act{padding:0 7px;border-radius:9px;font-size:11px;font-weight:600;line-height:17px;background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f)}' +
    '.create .act{background:var(--dbc-bg-e4f4e8);color:var(--dbc-fg-1c6b32)}.update .act{background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-1e6bff)}.other .act{background:var(--dbc-bg-fdf1d6);color:var(--dbc-fg-7a5410)}' +
    '.vals{width:100%;margin-top:8px;border-collapse:collapse;table-layout:fixed}' +
    '.vals th,.vals td{padding:4px 8px;border-top:1px solid var(--dbc-bd-dde3f0);text-align:left;vertical-align:top;font-size:13px}' +
    '.vals th{width:28%;font-weight:600}.vals th small{display:block;font:11.5px Consolas,"Cascadia Mono",monospace;color:var(--dbc-fg-56637f);font-weight:400}' +
    '.vals td{white-space:pre-wrap;word-break:break-word}.vals td div{max-height:160px;overflow:auto}' +
    '.vals .arr{width:22px;padding:4px 0;text-align:center;color:var(--dbc-fg-8a94ad)}' +
    '.vals .old{color:var(--dbc-fg-a11a1a)}.vals .new{color:var(--dbc-fg-1c6b32)}' +
    '.vals .none{color:var(--dbc-fg-8a94ad);font-style:italic}' +
    '.vals .loading td{color:var(--dbc-fg-8a94ad)}' +
    '.note{margin:0 0 12px;padding:10px 14px;border-radius:8px;background:var(--dbc-bg-fdf1d6);color:var(--dbc-fg-7a5410);font-size:13px}' +
    '.empty{padding:14px;color:var(--dbc-fg-56637f)}';

  function copyInto(tab, text) {
    return tab.navigator.clipboard.writeText(text).then(
      () => true,
      () => {
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
        } catch (e) {
          return false;
        }
      }
    );
  }

  function flash(btn, text, ok) {
    if (!btn.__dbLabel) btn.__dbLabel = btn.innerHTML;
    clearTimeout(btn.__dbTimer);
    btn.innerHTML = (ok ? CHECK : '') + esc(text);
    btn.classList.remove('db-ok', 'db-bad');
    btn.classList.add(ok ? 'db-ok' : 'db-bad');
    btn.__dbTimer = setTimeout(() => {
      btn.innerHTML = btn.__dbLabel;
      btn.classList.remove('db-ok', 'db-bad');
    }, 2200);
  }

  function save(tab, text, name, type) {
    const url = tab.URL.createObjectURL(new tab.Blob([text], { type: type }));
    const a = tab.document.createElement('a');
    a.href = url;
    a.download = name;
    tab.document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => tab.URL.revokeObjectURL(url), 1000);
  }

  const kindOf = (ch) => (/^create$/i.test(ch.action) ? 'create' : /^update$/i.test(ch.action) ? 'update' : 'other');

  function rowsHtml(ch, m, field) {
    const cols = field ? ch.cols.filter((c) => c === field) : ch.cols;
    const val = (v) => (v === '' ? '<span class="none">empty</span>' : '<div>' + esc(v) + '</div>');
    if (!ch.values) {
      if (ch.failed) return '<tr><td colspan="4" class="none">Values not read: ' + esc(ch.failed) + '</td></tr>';
      return cols.map((c) => '<tr class="loading"><th>' + esc(colLabel(m, c)) + '<small>' + esc(c) + '</small></th><td>…</td><td class="arr">→</td><td>…</td></tr>').join('');
    }
    return cols
      .map((c) => {
        const v = ch.values[c] || { old: '', new: '' };
        return '<tr><th>' + esc(colLabel(m, c)) + '<small>' + esc(c) + '</small></th><td class="old">' + val(v.old) + '</td><td class="arr">→</td><td class="new">' + val(v.new) + '</td></tr>';
      })
      .join('');
  }

  function cardHtml(ch, k, m, field) {
    return (
      '<article class="chg ' + kindOf(ch) + '" data-i="' + k + '"><div class="ch-h"><b>' + esc(longDate(ch.when)) + '</b><span class="ago">' + esc(ago(ch.when)) + '</span>' +
      '<span class="who">' + esc(ch.who) + '</span>' + (ch.caller ? '<span class="via">called by ' + esc(ch.caller) + '</span>' : '') +
      '<span class="act">' + esc(ch.action) + '</span>' + (ch.note ? '<span class="via">' + esc(ch.note) + '</span>' : '') + '</div>' +
      (ch.cols.length ? '<table class="vals">' + rowsHtml(ch, m, field) + '</table>' : '') +
      '</article>'
    );
  }

  const mdCell = (s) => (s === '' ? '_empty_' : String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>'));

  function markdown(h, list, field, filters) {
    const out = ['# History - ' + (h.name || h.rec.id) + ' (' + h.m.label + ')', ''];
    out.push(list.length + ' change' + (list.length === 1 ? '' : 's') + (filters ? ' · ' + filters : '') + ' · newest first · read ' + isoLocal(new Date()), '');
    for (const ch of list) {
      out.push('### ' + isoLocal(ch.when) + ' - ' + ch.who + (ch.caller ? ' (called by ' + ch.caller + ')' : '') + ' - ' + ch.action);
      if (ch.note) out.push('', ch.note);
      const cols = field ? ch.cols.filter((c) => c === field) : ch.cols;
      if (cols.length) {
        out.push('', '| Field | Old | New |', '| --- | --- | --- |');
        for (const c of cols) {
          const v = (ch.values && ch.values[c]) || { old: '?', new: '?' };
          out.push('| ' + mdCell(colLabel(h.m, c)) + ' (`' + c + '`) | ' + mdCell(v.old) + ' | ' + mdCell(v.new) + ' |');
        }
      }
      out.push('');
    }
    return out.join('\n');
  }

  function csv(h, list, field) {
    const cell = (v) => {
      const s = String(v == null ? '' : v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = [['When', 'Who', 'Called by', 'Action', 'Field', 'Logical name', 'Old', 'New']];
    for (const ch of list) {
      const cols = field ? ch.cols.filter((c) => c === field) : ch.cols;
      if (!cols.length) rows.push([isoLocal(ch.when), ch.who, ch.caller, ch.action, ch.note, '', '', '']);
      for (const c of cols) {
        const v = (ch.values && ch.values[c]) || { old: '', new: '' };
        rows.push([isoLocal(ch.when), ch.who, ch.caller, ch.action, colLabel(h.m, c), c, v.old, v.new]);
      }
    }
    return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
  }

  function show(tab, h, field) {
    const doc = tab.document;
    const m = h.m;
    const list = h.list;
    const fields = new Map();
    const people = new Map();
    for (const ch of list) {
      for (const c of ch.cols) fields.set(c, (fields.get(c) || 0) + 1);
      people.set(ch.who, (people.get(ch.who) || 0) + 1);
    }
    if (field && !fields.has(field)) fields.set(field, 0);
    doc.querySelector('.bar').hidden = false;
    doc.getElementById('sub').textContent =
      m.label + ' · ' + list.length + ' audited change' + (list.length === 1 ? '' : 's') + ' · newest first' + (h.capped ? ' · the newest ' + MAX_TAB : '');
    const byLabel = (a, b) => colLabel(m, a).localeCompare(colLabel(m, b));
    const fsel = doc.getElementById('field');
    fsel.innerHTML =
      '<option value="">All fields</option>' +
      Array.from(fields.keys())
        .sort(byLabel)
        .map((c) => '<option value="' + esc(c) + '">' + esc(colLabel(m, c)) + ' (' + fields.get(c) + ')</option>')
        .join('');
    fsel.value = field || '';
    const wsel = doc.getElementById('who');
    wsel.innerHTML =
      '<option value="">Everyone</option>' +
      Array.from(people.keys())
        .sort((a, b) => a.localeCompare(b))
        .map((p) => '<option value="' + esc(p) + '">' + esc(p) + ' (' + people.get(p) + ')</option>')
        .join('');
    const find = doc.getElementById('find');
    const main = doc.querySelector('main');
    main.innerHTML =
      (h.capped ? '<div class="note">Only the newest ' + MAX_TAB + ' changes are shown.</div>' : '') +
      list.map((ch, k) => cardHtml(ch, k, m, fsel.value)).join('') +
      '<div class="empty" id="none" hidden>No change matches.</div>';

    const cardOf = (ch) => main.querySelector('.chg[data-i="' + list.indexOf(ch) + '"]');
    const redraw = (ch) => {
      const el = cardOf(ch);
      if (!el || tab.closed) return;
      const fresh = doc.createElement('div');
      fresh.innerHTML = cardHtml(ch, list.indexOf(ch), m, fsel.value);
      const card = fresh.firstChild;
      card.hidden = el.hidden;
      el.replaceWith(card);
      seen.observe(card);
      // A field the audit row did not name, found in the change itself.
      for (const c of ch.cols) {
        if (fields.has(c)) continue;
        fields.set(c, 0);
        const o = doc.createElement('option');
        o.value = c;
        o.textContent = colLabel(m, c);
        fsel.appendChild(o);
      }
      apply();
    };
    const want = loader(m, redraw);
    // A change's values are read as its card comes into view.
    const seen = new tab.IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const ch = list[Number(e.target.dataset.i)];
          seen.unobserve(e.target);
          if (ch) want(ch, true);
        }
      },
      { rootMargin: '600px 0px' }
    );
    main.querySelectorAll('.chg').forEach((el) => seen.observe(el));

    const textOf = (ch) =>
      (ch.who + ' ' + ch.caller + ' ' + ch.action + ' ' + ch.note + ' ' +
        ch.cols.map((c) => colLabel(m, c) + ' ' + c + ' ' + (ch.values && ch.values[c] ? ch.values[c].old + ' ' + ch.values[c].new : '')).join(' ')).toLowerCase();
    const matches = (ch) => {
      const f = fsel.value;
      const w = wsel.value;
      const t = find.value.trim().toLowerCase();
      return (!f || ch.cols.indexOf(f) >= 0) && (!w || ch.who === w) && (!t || textOf(ch).indexOf(t) >= 0);
    };
    const shown = () => list.filter(matches);
    function apply() {
      let n = 0;
      list.forEach((ch, k) => {
        const el = main.querySelector('.chg[data-i="' + k + '"]');
        if (!el) return;
        const on = matches(ch);
        el.hidden = !on;
        if (on) n++;
      });
      doc.getElementById('none').hidden = n > 0;
      doc.getElementById('count').textContent = n === list.length ? '' : n + ' of ' + list.length;
    }
    const filters = () =>
      [fsel.value ? 'field: ' + colLabel(m, fsel.value) + ' (' + fsel.value + ')' : '', wsel.value ? 'by: ' + wsel.value : '', find.value.trim() ? 'text: ' + find.value.trim() : '']
        .filter(Boolean)
        .join(', ');
    // A field picked: each card shows that field only.
    // One field's history needs every change read: the audit row's list of
    // columns may miss it.
    const readAll = () => list.forEach((ch) => want(ch));
    fsel.onchange = () => {
      list.forEach((ch) => {
        const el = cardOf(ch);
        const t = el && el.querySelector('.vals');
        if (t) t.innerHTML = rowsHtml(ch, m, fsel.value);
      });
      if (fsel.value) readAll();
      apply();
    };
    wsel.onchange = apply;
    find.oninput = apply;
    if (fsel.value) readAll();
    apply();

    // Copy and CSV take what is shown, every value read first.
    async function ready(btn) {
      const now = shown();
      const todo = now.filter((ch) => !ch.values && !ch.failed);
      if (todo.length) {
        let done = 0;
        btn.disabled = true;
        const label = btn.innerHTML;
        btn.textContent = 'Reading values 0/' + todo.length + '…';
        await Promise.all(todo.map((ch) => want(ch).then(() => (btn.textContent = 'Reading values ' + ++done + '/' + todo.length + '…'))));
        btn.innerHTML = label;
        btn.disabled = false;
      }
      return now;
    }
    const file = ((h.name || m.label) + ' - history').replace(/[\\/:*?"<>|]+/g, '-');
    doc.getElementById('copy').onclick = async (e) => {
      const btn = e.currentTarget;
      const now = await ready(btn);
      const ok = await copyInto(tab, markdown(h, now, fsel.value, filters()));
      flash(btn, ok ? 'Copied' : 'Copy failed', ok);
    };
    doc.getElementById('csv').onclick = async (e) => {
      const btn = e.currentTarget;
      const now = await ready(btn);
      save(tab, csv(h, now, fsel.value), file + '.csv', 'text/csv');
      flash(btn, 'Downloaded', true);
    };
  }

  function message(tab, sub, text) {
    if (tab.closed) return;
    tab.document.getElementById('sub').textContent = sub;
    tab.document.querySelector('main').innerHTML = '<div class="note">' + esc(text) + '</div>';
  }

  async function openHistory(field) {
    const rec = here();
    if (!rec || !rec.id) {
      toast('Record history', 'Save the record first - a new one has no history yet.', true);
      return;
    }
    // The tab opens on the click - after an await it would be a pop-up.
    const tab = window.open('', '_blank');
    if (!tab) {
      toast('Record history', 'The tab was blocked. Allow pop-ups for this site and try again.', true);
      return;
    }
    const doc = tab.document;
    doc.write(
      '<!doctype html><html' + (DynaBoost.isDark() ? ' class="db-dark"' : '') + '><head><meta charset="utf-8"><title>History · ' + esc(rec.table) + '</title>' +
        '<style>' + CSS + DynaBoost.status.css + DynaBoost.tabCss + '</style></head><body>' +
        '<header><h1 id="title">History</h1><div class="crumbs" id="sub">Reading the audit…</div>' +
        '<div class="bar" hidden>' +
        '<button type="button" class="primary" id="copy" title="What is shown, as Markdown">Copy</button>' +
        '<button type="button" id="csv" title="What is shown, one row a field change, for Excel">Download CSV</button>' +
        '<span class="sep"></span>' +
        '<select id="field" title="One field’s history"></select>' +
        '<select id="who" title="Changes by one person"></select>' +
        '<input id="find" type="search" placeholder="Find a value, a field…" autocomplete="off">' +
        '<span class="count" id="count"></span></div></header>' +
        '<main><div class="wait">' + DynaBoost.status.html('busy') + '<span>Reading the audit…</span></div></main></body></html>'
    );
    doc.close();
    DynaBoost.themeTab(tab);
    let m;
    try {
      m = await meta(rec.table);
      const [raw, name] = await Promise.all([
        readAudits(rec, MAX_TAB),
        m.primary ? get(m.set + '(' + rec.id + ')?$select=' + m.primary).then((r) => r[m.primary] || '', () => '') : ''
      ]);
      if (tab.closed) return;
      const title = (name || m.label) + ' · history';
      doc.title = title;
      doc.getElementById('title').textContent = 'History · ' + (name || m.label);
      const list = raw.map((a) => change(a, m));
      if (!list.length) {
        const off = await auditOff(m);
        message(tab, m.label + ' · no audited change', off || 'No change of this record is in the audit yet - since auditing was turned on, nobody has changed it.');
        return;
      }
      show(tab, { rec: rec, m: m, name: name, list: list, capped: raw.length >= MAX_TAB }, field);
      DynaBoost.saved('record-history');
    } catch (e) {
      message(tab, 'Could not read the history', whyFailed(e));
    }
  }

  DynaBoost.register({
    id: 'record-history',
    name: 'Record history',
    group: 'Records',
    hosts: ['dynamics.com'],
    when: () => DynaBoost.page().type === 'entityrecord',
    type: 'action',
    hint: 'Every audited change of this record in a tab - who, when, old and new values',
    icon: ICON,
    onRun: () => openHistory('')
  });

  // ---------- Last change: the badges ----------

  let wanted = false;
  // Switched on in the panel: the result is said, whatever it is.
  let asked = false;
  let data = {};
  let key = '';
  let run = 0;
  let watch = 0;
  const counted = new Set();

  // Why there are no badges, said once a table in this tab - not on every
  // record of it.
  const WARNED = 'dynaboost.lastChangeWarned';
  function warnOnce(id, text) {
    let seen = [];
    try {
      seen = JSON.parse(sessionStorage.getItem(WARNED) || '[]');
    } catch (e) {
      /* no session storage - say it */
    }
    if (seen.indexOf(id) >= 0) return;
    seen.push(id);
    try {
      sessionStorage.setItem(WARNED, JSON.stringify(seen));
    } catch (e) {
      /* not kept - it may be said again */
    }
    const say = () => toast('Last change', text, true);
    if (document.body) say();
    else document.addEventListener('DOMContentLoaded', say, { once: true });
  }

  function injectHook() {
    if (window.__dbFormToolsInjected) return;
    window.__dbFormToolsInjected = true;
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('src/features/form-tools-hook.js');
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  }

  // The helper loads a moment after it is put in: say it twice.
  function send(next) {
    data = next;
    injectHook();
    const msg = () => window.postMessage({ source: SRC, op: 'changes', on: wanted, dark: DynaBoost.isDark ? DynaBoost.isDark() : false, data: data }, location.origin);
    msg();
    setTimeout(msg, 400);
  }

  /* Each field's badge, for the page's helper to draw: the old and the new
   * value on the badge itself (who and when until the values are read, or
   * when they cannot be), who and when in the card shown on hover. */
  function badges(r, withValues) {
    const out = {};
    for (const [col, ch] of r.latest) {
      const v = withValues && ch.values && ch.values[col];
      out[col] = {
        key: ch.id + (v ? ':v' : ''),
        who: ch.who,
        caller: ch.caller,
        action: ch.action,
        when: longDate(ch.when),
        at: ch.when.getTime(),
        values: !!v,
        old: v ? v.old.slice(0, 600) : '',
        new: v ? v.new.slice(0, 600) : '',
        count: r.counts.get(col),
        capped: r.capped ? MAX_BADGES : 0
      };
    }
    return out;
  }

  async function load(force) {
    const rec = here();
    const now = rec && rec.id ? rec.table + ':' + rec.id : '';
    if (!force && now === key) return;
    key = now;
    const mine = ++run;
    if (!now) return send({});
    try {
      const m = await meta(rec.table);
      const raw = await readAudits(rec, MAX_BADGES);
      if (mine !== run || !wanted) return;
      const list = raw.map((a) => change(a, m));
      const tally = () => {
        const latest = new Map();
        const counts = new Map();
        for (const ch of list) {
          for (const c of ch.cols) {
            counts.set(c, (counts.get(c) || 0) + 1);
            if (!latest.has(c)) latest.set(c, ch);
          }
        }
        return { latest: latest, counts: counts, capped: raw.length >= MAX_BADGES };
      };
      // First what the audit rows say, at once.
      send(badges(tally(), false));
      if (!list.length) {
        const off = await auditOff(m);
        if (asked && mine === run) {
          asked = false;
          toast('Last change', off || 'This record has no audited change yet.', !!off);
        } else if (off && mine === run) warnOnce(rec.table, off);
        console.info('[DynaBoost] Last change: no audited change of this record.' + (off ? ' ' + off : ''));
        return;
      }
      if (!counted.has(now)) {
        counted.add(now);
        DynaBoost.saved('last-change');
      }
      /* The audit row's list of columns is not to be relied on (Microsoft
       * says so; some environments leave it empty): the newest changes are
       * read whole, columns and values, and so is any older one that is the
       * last change of a field. */
      // Ten at a time; the badges are drawn again as the reads come in.
      let shown = 0;
      const fillAll = async (todo) => {
        let i = 0;
        await Promise.all(
          Array.from({ length: Math.min(10, todo.length) }, async () => {
            while (i < todo.length && mine === run) {
              const ch = todo[i++];
              if (ch.values || ch.failed) continue;
              try {
                await fill(ch, m);
              } catch (e) {
                ch.failed = String((e && e.message) || e);
              }
              if (++shown % 5 === 0 && mine === run && wanted) send(badges(tally(), true));
            }
          })
        );
      };
      await fillAll(list.slice(0, EXACT));
      if (mine !== run || !wanted) return;
      let r = tally();
      await fillAll(Array.from(new Set(r.latest.values())));
      if (mine !== run || !wanted) return;
      r = tally();
      send(badges(r, true));
      if (asked && mine === run) {
        asked = false;
        toast('Last change', r.latest.size ? r.latest.size + ' field' + (r.latest.size === 1 ? '' : 's') + ' with a badge, from ' + raw.length + ' audited change' + (raw.length === 1 ? '' : 's') + '.' : 'No field on this form has an audited change.', false);
      }
      const failed = list.slice(0, EXACT).filter((ch) => ch.failed);
      console.info('[DynaBoost] Last change: ' + raw.length + ' audited change(s), ' + r.latest.size + ' field(s) with a badge' + (failed.length ? '; ' + failed.length + ' change(s) not read: ' + failed[0].failed : '') + '.');
    } catch (e) {
      if (mine !== run) return;
      send({});
      if (asked) {
        asked = false;
        toast('Last change', whyFailed(e), true);
      } else warnOnce('!' + rec.table, whyFailed(e));
    }
  }

  function onEvent(e) {
    if (e.source !== window || !e.data || e.data.source !== SRC + '-event') return;
    if (e.data.type === 'change-history') return openHistory(String(e.data.column || ''));
    if (!wanted) return;
    // A fresh helper (one taking over from an older one) knows nothing yet.
    if (e.data.type === 'ready') send(data);
    if (e.data.type === 'record-saved') setTimeout(() => load(true), 800);
  }
  window.addEventListener('message', onEvent);

  /* Dynamics writes its page anew as it starts (document.open) and takes
   * the listeners off: this one is put on again, and badges not drawn are
   * said again - the helper (which puts its own back) may not have heard. */
  let resaid = 0;
  function check() {
    window.addEventListener('message', onEvent);
    if (!data || !Object.keys(data).length || document.querySelector('.db-lc') || !document.querySelector('label[id$="-field-label"]')) return;
    if (Date.now() - resaid < 3000) return;
    resaid = Date.now();
    send(data);
  }

  DynaBoost.register({
    id: 'last-change',
    name: 'Last change',
    group: 'Records',
    hosts: ['dynamics.com'],
    when: () => DynaBoost.page().type === 'entityrecord',
    type: 'toggle',
    defaultOn: false,
    hint: 'Who changed each field last, and when - under its label',
    icon: BADGE_ICON,
    onEnable() {
      if (!top || wanted) return;
      wanted = true;
      const root = document.getElementById('dynaboost-root');
      asked = !!(root && root.classList.contains('db-open'));
      key = '';
      load(true);
      // Another record opens in the same page: its own badges.
      watch = setInterval(() => {
        load(false);
        check();
      }, 1000);
    },
    onDisable() {
      if (!wanted) return;
      wanted = false;
      clearInterval(watch);
      key = '';
      run++;
      send({});
    }
  });
})();
