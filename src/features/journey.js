/* Feature: Edit journey (Customer Insights - Journeys, real-time).
 *
 * Opens the journey's definition JSON in an editor tab. Only a Draft journey
 * can be saved (EDITABLE_STATUS, an allowlist); publishing stays in the app.
 * A save needs valid JSON, is refused when the row's ETag changed (HTTP 412),
 * and keeps the previous definition in chrome.storage.local
 * (dynaboost.journeyBackups, last 10) first.
 *
 * The definition column: the known names first, else the largest text column
 * that parses as JSON - the schema differs between versions.
 */
(function () {
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<circle cx="12" cy="4.5" r="2" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<circle cx="6" cy="19.5" r="2" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<circle cx="18" cy="19.5" r="2" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M12 6.5v4m0 0-6 7m6-7 6 7" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="m14 12 2 2 4-4" stroke="#E3B04B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  const API = '/api/data/v9.2/';
  const ENTITY = 'msdynmkt_journey';
  const SET = 'msdynmkt_journeys';
  const FMT = '@OData.Community.Display.V1.FormattedValue';
  const BACKUP_KEY = 'dynaboost.journeyBackups';
  const BACKUPS_KEPT = 10;

  // Statuses the tile may write to, matched against the status reason label
  // (case-insensitive). Everything else is read-only.
  const EDITABLE_STATUS = ['draft'];

  // Columns that hold the definition, in order of preference.
  const DEF_COLUMNS = ['msdynmkt_workflowdefinition', 'msdynmkt_journeydefinition', 'msdynmkt_definition'];

  function clean(g) {
    return String(g || '').replace(/[{}]/g, '').toLowerCase();
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ---------- where are we ----------

  function journeyIdFromUrl() {
    const p = new URLSearchParams(location.search);
    const etn = (p.get('etn') || '').toLowerCase();
    const id = clean(p.get('id'));
    if (etn === ENTITY && /^[0-9a-f-]{36}$/.test(id)) return id;
    return null;
  }

  // ---------- Web API ----------

  async function readError(res) {
    try {
      const j = await res.json();
      return (j.error && j.error.message) || JSON.stringify(j).slice(0, 300);
    } catch (e) {
      return '';
    }
  }

  async function fetchJourney(id) {
    const res = await fetch(API + SET + '(' + id + ')', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'OData-Version': '4.0', Prefer: 'odata.include-annotations="*"' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await readError(res)));
    return res.json();
  }

  async function saveDefinition(id, column, etag, text) {
    const res = await fetch(API + SET + '(' + id + ')', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
        'OData-Version': '4.0',
        'OData-MaxVersion': '4.0',
        'If-Match': etag || '*'
      },
      body: JSON.stringify({ [column]: text })
    });
    if (res.status === 412) throw new Error('This journey changed since you loaded it. Reload and apply your edit again.');
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await readError(res)));
  }

  // ---------- reading the row ----------

  function parseJson(text) {
    if (typeof text !== 'string' || !text.trim()) return null;
    const c = text.trim()[0];
    if (c !== '{' && c !== '[') return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  function findDefinition(row) {
    for (const col of DEF_COLUMNS) {
      if (typeof row[col] === 'string' && parseJson(row[col])) return col;
    }
    let best = null;
    for (const k of Object.keys(row)) {
      if (k.indexOf('@') >= 0 || typeof row[k] !== 'string') continue;
      if (!parseJson(row[k])) continue;
      if (!best || row[k].length > row[best].length) best = k;
    }
    return best;
  }

  function describe(row, column) {
    const state = row.statecode;
    const status = row['statuscode' + FMT] || String(row.statuscode);
    const editable = state === 0 && EDITABLE_STATUS.indexOf(String(status).toLowerCase()) >= 0;
    let why = '';
    if (!column) why = 'No definition column found on this row.';
    else if (!editable) why = 'Status is "' + status + '" — Dynamics only lets a Draft journey be edited. Open read-only.';
    return {
      id: clean(row.msdynmkt_journeyid),
      name: row.msdynmkt_name || '(no name)',
      status: status,
      state: row['statecode' + FMT] || String(state),
      modifiedOn: row['modifiedon' + FMT] || row.modifiedon || '',
      modifiedBy: row['_modifiedby_value' + FMT] || '',
      column: column,
      etag: row['@odata.etag'],
      editable: !!column && editable,
      why: why,
      definition: column ? row[column] : ''
    };
  }

  function pretty(text) {
    const v = parseJson(text);
    return v === null ? text : JSON.stringify(v, null, 2);
  }

  // ---------- backups ----------

  function backup(j) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(BACKUP_KEY, (data) => {
          const list = (data && data[BACKUP_KEY]) || [];
          list.unshift({ id: j.id, name: j.name, savedAt: new Date().toISOString(), column: j.column, definition: j.definition });
          chrome.storage.local.set({ [BACKUP_KEY]: list.slice(0, BACKUPS_KEPT) }, resolve);
        });
      } catch (e) {
        resolve();
      }
    });
  }

  // ---------- the tab ----------

  const CHECK =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m5 13 4 4L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function flash(btn, text, ok) {
    if (btn.__dbTimer) clearTimeout(btn.__dbTimer);
    if (btn.__dbLabel == null) btn.__dbLabel = btn.textContent;
    btn.innerHTML = (ok ? CHECK : '') + esc(text);
    btn.classList.remove('db-ok', 'db-bad');
    btn.classList.add(ok ? 'db-ok' : 'db-bad');
    btn.__dbTimer = setTimeout(() => {
      btn.textContent = btn.__dbLabel;
      btn.classList.remove('db-ok', 'db-bad');
    }, 2600);
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
    const doc = tab.document;
    const blob = new tab.Blob([content], { type: 'application/json' });
    const url = tab.URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = name;
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    setTimeout(() => tab.URL.revokeObjectURL(url), 10000);
  }

  function recordUrl(id) {
    const appid = new URLSearchParams(location.search).get('appid');
    return location.origin + '/main.aspx?' + (appid ? 'appid=' + appid + '&' : '') + 'pagetype=entityrecord&etn=' + ENTITY + '&id=' + id;
  }

  function buildHtml(j) {
    return (
      '<!doctype html><meta charset="utf-8"><title>' + esc(j.name) + ' — journey</title>' +
      '<style>' +
      'html,body{height:100%}' +
      'body{margin:0;display:flex;flex-direction:column;font:14px/1.5 "Segoe UI",system-ui,sans-serif;color:var(--dbc-fg-10224e);background:var(--dbc-bg-f5f7fc)}' +
      'code{font:12.5px ui-monospace,Consolas,monospace;color:var(--dbc-fg-56637f)}' +
      'header{flex:none;padding:16px 22px 0;background:var(--dbc-bg-fff);border-bottom:2px solid var(--dbc-bd-e3b04b)}' +
      'h1{margin:0;font-size:19px;font-weight:600}' +
      '.crumbs{margin-top:3px;font-size:13px;color:var(--dbc-fg-56637f)}.crumbs a{color:var(--dbc-fg-1e6bff);text-decoration:none}.crumbs a:hover{text-decoration:underline}' +
      '.bd{display:inline-block;margin-left:6px;padding:1px 8px;border-radius:10px;background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f);font-size:11.5px;vertical-align:1px}' +
      '.bd.ok{background:var(--dbc-bg-e4f4e8);color:var(--dbc-fg-1c6b32)}.bd.ro{background:var(--dbc-bg-fdf1d6);color:var(--dbc-fg-7a5410)}' +
      '.why{margin-top:8px;padding:8px 12px;border-radius:6px;background:var(--dbc-bg-fdf1d6);color:var(--dbc-fg-7a5410);font-size:13px;max-width:900px}' +
      '.bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px;padding-bottom:12px}' +
      'button{padding:7px 13px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);font:inherit;cursor:pointer}' +
      'button:hover:enabled{border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-1e6bff)}' +
      'button{transition:background-color .15s,border-color .15s,color .15s,transform .06s}' +
      'button:active:enabled{transform:translateY(1px);box-shadow:inset 0 1px 3px rgba(10,23,56,.18)}' +
      'button:disabled{opacity:.45;cursor:default}' +
      'button.primary{background:var(--dbc-bg-1e6bff);border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-fff);font-weight:600}' +
      'button.primary:hover:enabled{background:var(--dbc-bg-155ee0);color:var(--dbc-fg-fff)}' +
      'button svg{width:14px;height:14px;vertical-align:-2px;margin-right:6px}' +
      'button.db-ok,button.db-ok:hover:enabled{border-color:var(--dbc-bd-1c6b32);color:var(--dbc-fg-1c6b32);background:var(--dbc-bg-e4f4e8)}' +
      'button.db-bad,button.db-bad:hover:enabled{border-color:var(--dbc-bd-a11a1a);color:var(--dbc-fg-a11a1a);background:var(--dbc-bg-fde8e8)}' +
      '.status{margin-left:auto;font-size:12.5px;color:var(--dbc-fg-56637f)}.status.bad{color:var(--dbc-fg-a11a1a)}' +
      'main{flex:1;display:flex;min-height:0;padding:14px 22px 18px}' +
      'textarea{flex:1;width:100%;resize:none;padding:14px 18px;border:1px solid var(--dbc-bd-dde3f0);border-radius:8px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);font:12.5px/1.45 ui-monospace,Consolas,monospace;white-space:pre;tab-size:2}' +
      'textarea:focus{outline:2px solid var(--dbc-bd-1e6bff);outline-offset:-1px}' +
      'textarea[readonly]{background:var(--dbc-bg-f9fafd);color:var(--dbc-fg-3d4a66)}' +
      DynaBoost.code.css +
      DynaBoost.tabCss +
      '</style>' +
      '<body>' +
      '<header>' +
      '<h1>' + esc(j.name) +
      '<span class="bd ' + (j.editable ? 'ok' : 'ro') + '">' + esc(j.status) + (j.editable ? ' · editable' : ' · read-only') + '</span></h1>' +
      '<div class="crumbs">journey <code>' + esc(j.id) + '</code> · column <code>' + esc(j.column || '?') + '</code>' +
      (j.modifiedOn ? ' · modified ' + esc(j.modifiedOn) + (j.modifiedBy ? ' by ' + esc(j.modifiedBy) : '') : '') +
      ' · <a href="' + esc(recordUrl(j.id)) + '" target="_blank" rel="noopener">open journey</a></div>' +
      (j.why ? '<div class="why">' + esc(j.why) + '</div>' : '') +
      '<div class="bar">' +
      '<button class="primary" id="save"' + (j.editable ? '' : ' disabled') + '>Save to draft</button>' +
      '<button id="reload">Reload</button>' +
      '<button id="copy">Copy JSON</button>' +
      '<button id="dl">Download .json</button>' +
      '<button id="fmt">Format</button>' +
      '<span class="status" id="status"></span>' +
      '</div></header>' +
      '<main><textarea id="ed" spellcheck="false"' + (j.editable ? '' : ' readonly') + '></textarea></main>'
    );
  }

  function wire(tab, ctx) {
    const doc = tab.document;
    const get = (id) => doc.getElementById(id);
    const ed = get('ed');
    const status = get('status');
    let original = pretty(ctx.journey.definition);
    DynaBoost.code.attach(tab, ed, 'json');
    ed.value = original;

    function setStatus(text, bad) {
      status.textContent = text;
      status.classList.toggle('bad', !!bad);
    }

    function check() {
      const text = ed.value;
      const modified = text !== original;
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        setStatus('Invalid JSON: ' + e.message, true);
        get('save').disabled = true;
        return { ok: false, modified: modified };
      }
      setStatus((modified ? 'Modified · ' : '') + (text.length / 1024).toFixed(0) + ' KB · valid JSON', false);
      get('save').disabled = !ctx.journey.editable || !modified;
      return { ok: true, modified: modified, parsed: parsed };
    }

    let timer = null;
    ed.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(check, 250);
    });
    check();

    tab.addEventListener('beforeunload', (e) => {
      if (ed.value !== original) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    get('fmt').addEventListener('click', (e) => {
      const r = check();
      if (r.ok) {
        ed.value = JSON.stringify(r.parsed, null, 2);
        check();
      }
      flash(e.currentTarget, r.ok ? 'Formatted' : 'Invalid JSON', r.ok);
    });

    get('copy').addEventListener('click', async (e) => {
      const btn = e.currentTarget; // before the await - the event forgets it after
      const ok = await copyInto(tab, ed.value);
      flash(btn, ok ? 'Copied' : 'Copy failed', ok);
    });

    get('dl').addEventListener('click', () => {
      const safe = ctx.journey.name.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 60);
      download(tab, ed.value, 'journey_' + safe + '.json');
      flash(get('dl'), 'Downloaded', true);
    });

    get('reload').addEventListener('click', async (e) => {
      if (ed.value !== original && !tab.confirm('Discard your unsaved edits and reload from Dynamics?')) return;
      const btn = e.currentTarget;
      try {
        const row = await fetchJourney(ctx.id);
        ctx.journey = describe(row, findDefinition(row));
        original = pretty(ctx.journey.definition);
        ed.value = original;
        ed.readOnly = !ctx.journey.editable;
        check();
        flash(btn, 'Reloaded', true);
      } catch (err) {
        flash(btn, 'Reload failed', false);
        setStatus(err.message, true);
      }
    });

    get('save').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const r = check();
      if (!r.ok || !ctx.journey.editable) return;
      btn.disabled = true;
      setStatus('Saving…', false);
      try {
        // Re-read: the status may have changed under us (someone hit Publish).
        const fresh = await fetchJourney(ctx.id);
        const now = describe(fresh, findDefinition(fresh));
        if (!now.editable) throw new Error(now.why || 'This journey is no longer editable.');
        if (now.etag !== ctx.journey.etag) throw new Error('This journey changed since you loaded it. Reload and apply your edit again.');

        await backup(now);
        await saveDefinition(ctx.id, now.column, now.etag, JSON.stringify(r.parsed));

        const after = await fetchJourney(ctx.id);
        ctx.journey = describe(after, findDefinition(after));
        original = pretty(ctx.journey.definition);
        ed.value = original;
        check();
        flash(btn, 'Saved', true);
        setStatus('Saved to draft. Open the journey designer, check it renders, then publish there.', false);
      } catch (err) {
        flash(btn, 'Save failed', false);
        setStatus(err.message, true);
        btn.disabled = false;
      }
    });
  }

  // ---------- run ----------

  async function run() {
    const id = journeyIdFromUrl();
    if (!id) {
      window.alert('Open a journey record first (Customer Insights - Journeys). This tile reads the journey you are looking at.');
      return;
    }

    const tab = window.open('', '_blank');
    if (!tab) {
      window.alert('The tab was blocked. Allow pop-ups for this site and try again.');
      return;
    }
    tab.document.write(
      '<!doctype html><meta charset="utf-8"><title>Reading\u2026</title>' +
        '<body style="font:14px/1.5 \'Segoe UI\',system-ui,sans-serif;padding:24px;color:var(--dbc-fg-10224e)"><p>Reading journey\u2026</p>'
    );
    DynaBoost.themeTab(tab);

    let row;
    try {
      row = await fetchJourney(id);
    } catch (e) {
      if (!tab.closed) tab.close();
      window.alert('Could not read the journey.\n\n' + e.message);
      return;
    }
    if (tab.closed) return;

    const journey = describe(row, findDefinition(row));
    tab.document.open();
    tab.document.write(buildHtml(journey));
    tab.document.close();
    DynaBoost.themeTab(tab);
    wire(tab, { id: id, journey: journey });
  }

  DynaBoost.register({
    id: 'journey',
    name: 'Edit journey',
    group: 'Journeys',
    hosts: ['dynamics.com'],
    when: () => !!journeyIdFromUrl(),
    type: 'action',
    hint: 'The definition JSON of the journey you are looking at: copy it, download it, edit a Draft and save it back. Publishing stays in the designer',
    icon: ICON,
    onRun: run
  });
})();
