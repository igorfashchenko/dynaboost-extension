/* Feature: Copy record. Opens a new, unsaved record of the same table and
 * form in a new tab, filled with this record's values and named "[copy] ...".
 *
 * Values come from the open form (form-tools-hook.js). The columns a new row
 * accepts come from one metadata request per table and session - no formula,
 * calculated, rollup, system or autonumber columns, status, owner or process
 * fields. The values reach the new tab through chrome.storage.local, for a
 * new record of that table in the same environment, and are dropped if not
 * picked up within a minute. Nothing is saved until you save.
 */
(function () {
  if (DynaBoost.off) return;
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="8" y="8" width="12" height="13" rx="2" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M14 12v5M11.5 14.5h5" stroke="#E3B04B" stroke-width="1.6" stroke-linecap="round"/>' +
    '</svg>';

  const SRC = 'dynaboost-form-tools-v2';
  const JOB = 'dynaboost.copyRecord';
  const MAX_AGE = 60000;

  // Never copied, whatever the metadata says.
  const SKIP = new Set([
    'statecode', 'statuscode', 'ownerid', 'owninguser', 'owningteam', 'owningbusinessunit',
    'createdon', 'createdby', 'modifiedon', 'modifiedby', 'createdonbehalfby', 'modifiedonbehalfby',
    'overriddencreatedon', 'importsequencenumber', 'versionnumber',
    'processid', 'stageid', 'traversedpath', 'timezoneruleversionnumber', 'utcconversiontimezonecode'
  ]);

  const onOrg = () => /\.dynamics\.com$/i.test(location.hostname);
  const params = () => new URLSearchParams(location.search);

  function injectHook() {
    if (window.__dbFormToolsInjected) return;
    window.__dbFormToolsInjected = true;
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('src/features/form-tools-hook.js');
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  }

  function ask(op, extra) {
    return new Promise((resolve) => {
      const id = 'dbcopy' + Date.now() + Math.random().toString(36).slice(2);
      let done = false;
      const onMsg = (e) => {
        if (e.source !== window || !e.data || e.data.source !== SRC + '-reply' || e.data.id !== id) return;
        done = true;
        window.removeEventListener('message', onMsg);
        resolve(e.data.result);
      };
      window.addEventListener('message', onMsg);
      injectHook();
      const send = () => !done && window.postMessage(Object.assign({ source: SRC, op: op, id: id }, extra || {}), location.origin);
      send();
      setTimeout(send, 300);
      setTimeout(send, 900);
      setTimeout(() => {
        if (done) return;
        window.removeEventListener('message', onMsg);
        resolve({ error: 'The page did not answer.' });
      }, 3000);
    });
  }

  // Which columns a new row takes, and the primary ones - once per table and session.
  async function tableInfo(entity) {
    const key = 'dynaboost.copyMeta.' + entity;
    try {
      const kept = sessionStorage.getItem(key);
      if (kept) return JSON.parse(kept);
    } catch (e) {
      /* no session storage - ask */
    }
    const res = await fetch(
      "/api/data/v9.2/EntityDefinitions(LogicalName='" + encodeURIComponent(entity) + "')?$select=PrimaryIdAttribute,PrimaryNameAttribute" +
        '&$expand=Attributes($select=LogicalName,IsValidForCreate,AutoNumberFormat)',
      { credentials: 'same-origin', headers: { Accept: 'application/json', 'OData-Version': '4.0' } }
    );
    if (!res.ok) throw new Error('HTTP ' + res.status + ' reading the table’s columns');
    const m = await res.json();
    const info = {
      id: m.PrimaryIdAttribute,
      name: m.PrimaryNameAttribute,
      creatable: (m.Attributes || []).filter((a) => a.IsValidForCreate && !a.AutoNumberFormat).map((a) => a.LogicalName)
    };
    try {
      sessionStorage.setItem(key, JSON.stringify(info));
    } catch (e) {
      /* kept for this call only */
    }
    return info;
  }

  // ---------- in the record: make the copy ----------

  async function run() {
    // The tab opens on the click - after an await it would be a pop-up.
    const tab = window.open('', '_blank');
    if (!tab) {
      DynaBoost.toast('Copy record', 'The tab was blocked. Allow pop-ups for this site and try again.', true);
      return;
    }
    tab.document.write(
      '<!doctype html><meta charset="utf-8"><title>Copying…</title>' +
        '<body style="font:14px/1.5 \'Segoe UI\',system-ui,sans-serif;padding:24px;color:var(--dbc-fg-10224e)">Copying the record…'
    );
    DynaBoost.themeTab(tab);
    const fail = (why) => {
      if (!tab.closed) tab.close();
      DynaBoost.toast('Copy record', why, true);
    };

    const rec = (await ask('clone-read')) || {};
    if (rec.error) return fail(rec.error);
    let info;
    try {
      info = await tableInfo(rec.entity);
    } catch (e) {
      return fail(e.message);
    }
    const creatable = new Set(info.creatable);
    const values = rec.values.filter((v) => creatable.has(v.name) && !SKIP.has(v.name) && v.name !== info.id);
    const nameField = values.find((v) => v.name === info.name && typeof v.value === 'string');
    if (nameField) nameField.value = '[copy] ' + nameField.value;

    await chrome.storage.local.set({ [JOB]: { origin: location.origin, entity: rec.entity, from: rec.name, values: values, at: Date.now() } });
    const q = params();
    tab.location.replace(
      location.origin + '/main.aspx?' + (q.get('appid') ? 'appid=' + encodeURIComponent(q.get('appid')) + '&' : '') +
        'pagetype=entityrecord&etn=' + encodeURIComponent(rec.entity) + (rec.formId ? '&formid=' + rec.formId : '')
    );
    DynaBoost.toast('Copy record', 'The copy opens in a new tab - ' + values.length + ' fields' + (nameField ? ', named “' + nameField.value + '”' : '') + '. Nothing is saved until you save it.');
    DynaBoost.saved('copy-record');
  }

  // ---------- in the new tab: fill it in ----------

  function pickUp() {
    if (!onOrg()) return;
    const q = params();
    if (q.get('pagetype') !== 'entityrecord' || q.get('id') || !q.get('etn')) return;
    chrome.storage.local.get(JOB, (d) => {
      const job = d && d[JOB];
      // Only a new record of the same table, in the same environment.
      if (!job || Date.now() - job.at > MAX_AGE || job.origin !== location.origin || job.entity !== q.get('etn').toLowerCase()) return;
      chrome.storage.local.remove(JOB);
      let tries = 0;
      const fill = async () => {
        const r = (await ask('clone-fill', { entity: job.entity, values: job.values })) || {};
        if (r.wait || r.error) {
          if (++tries < 60) setTimeout(fill, 500);
          else DynaBoost.toast('Copy record', 'The new form did not come up - the copy was not filled in.', true);
          return;
        }
        DynaBoost.toast(
          'Copy of ' + (job.from || 'the record'),
          r.filled + ' fields filled in' + (r.skipped.length ? ', ' + r.skipped.length + ' not on this form' : '') + ' - look it over and save.'
        );
      };
      fill();
    });
  }

  pickUp();

  DynaBoost.register({
    id: 'copy-record',
    name: 'Copy record',
    group: 'Records',
    hosts: ['dynamics.com'],
    when: () => params().get('pagetype') === 'entityrecord' && !!params().get('id'),
    type: 'action',
    hint: 'An unsaved copy of this record in a new tab',
    icon: ICON,
    onRun: run
  });
})();
