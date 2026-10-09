/* Features: Edit form, Open table and Edit view. Edit form opens the open form in the
 * maker's form designer, /e/{environment}/s/{solution}/entity/{table}/form/edit/{form};
 * Open table opens the record's table, /environments/{environment}/solutions/{solution}/entities/{table's MetadataId}.
 * Edit view opens the list's view in the view designer,
 * /e/{environment}/s/{solution}/entity/{table}/view/{view}.
 * Each in a solution that holds it: the one unmanaged solution of yours
 * (or the one pinned in My solutions) opens at once; otherwise a list of the
 * solutions it is in - yours first, pinned on top, then the Default
 * Solution, then the managed ones - and you pick. The list is a dialog over
 * the page: a click on it opens the tab, so it is never a blocked pop-up.
 */
(function () {
  if (DynaBoost.off) return;
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="3" y="3" width="14" height="18" rx="2" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M6.5 8h7M6.5 12h4" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="m13.5 18.5.6-2.8 5.6-5.6a1.4 1.4 0 0 1 2 2l-5.6 5.6z" stroke="#E3B04B" stroke-width="1.5" stroke-linejoin="round"/>' +
    '</svg>';
  const TABLE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="3" y="4" width="18" height="16" rx="2" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M3 9h18M9 9v11" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M14 13h4m0 0-1.6-1.6M18 13l-1.6 1.6" stroke="#E3B04B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  const DEFAULT_SOLUTION = 'fd140aaf-4df4-11dd-bd17-0019b9312238';
  const MAKER = 'https://make.powerapps.com';

  const PINS_KEY = 'dynaboost.solutionPins'; // My solutions (solution-pins.js)
  const ENTITY = 1; // solution component types
  const SYSTEM_FORM = 60;
  const SAVED_QUERY = 26;

  const clean = (g) => String(g || '').replace(/[{}]/g, '').toLowerCase();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  async function getJson(path) {
    const res = await fetch('/api/data/v9.2/' + path, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'OData-Version': '4.0' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function environmentId() {
    try {
      const r = await getJson("RetrieveCurrentOrganization(AccessType=@p)?@p=Microsoft.Dynamics.CRM.EndpointAccessType'Default'");
      return (r.Detail && r.Detail.EnvironmentId) || null;
    } catch (e) {
      return null;
    }
  }

  const pinsOf = (envId) =>
    new Promise((resolve) => {
      try {
        chrome.storage.sync.get(PINS_KEY, (d) => resolve(((d && d[PINS_KEY]) || []).filter((p) => p && String(p.env).toLowerCase() === envId)));
      } catch (e) {
        resolve([]);
      }
    });

  /* The solutions a component is in, in the order they are offered: yours
   * (unmanaged; pinned in My solutions first), the Default Solution, the
   * managed ones. */
  async function solutionsOf(objectId, type, envId) {
    const r = await getJson(
      'solutioncomponents?$select=componenttype&$filter=objectid eq ' + objectId + ' and componenttype eq ' + type +
        '&$expand=solutionid($select=solutionid,friendlyname,uniquename,ismanaged,isvisible,version)'
    );
    const pins = await pinsOf(envId);
    const seen = new Set();
    const list = (r.value || [])
      .map((c) => c.solutionid)
      .filter((s) => s && s.isvisible !== false && s.uniquename !== 'Active' && !seen.has(clean(s.solutionid)) && seen.add(clean(s.solutionid)))
      .map((s) => {
        const id = clean(s.solutionid);
        const isDefault = s.uniquename === 'Default' || id === DEFAULT_SOLUTION;
        const pin = pins.find((p) => p.sol === id);
        return { id: id, name: s.friendlyname || s.uniquename, unique: s.uniquename, version: s.version || '', managed: !!s.ismanaged && !isDefault, isDefault: isDefault, pinned: !!pin };
      });
    const rank = (s) => (s.pinned ? 0 : !s.managed && !s.isDefault ? 1 : s.isDefault ? 2 : 3);
    list.sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)));
    if (!list.some((s) => s.isDefault)) list.splice(list.filter((s) => rank(s) < 2).length, 0, { id: DEFAULT_SOLUTION, name: 'Default Solution', unique: 'Default', version: '', managed: false, isDefault: true, pinned: false });
    return list;
  }

  // Opened at once: the one solution of yours, or the one of them pinned.
  function onlyChoice(list) {
    const own = list.filter((s) => !s.managed && !s.isDefault);
    if (own.length === 1) return own[0];
    const pinned = own.filter((s) => s.pinned);
    return pinned.length === 1 ? pinned[0] : null;
  }

  // ---------- the dialog ----------

  function dialog(title) {
    DynaBoost.closePanel();
    if (DynaBoost.status) DynaBoost.status.inPage();
    const overlay = document.createElement('div');
    overlay.className = 'db-overlay' + (DynaBoost.isDark && DynaBoost.isDark() ? ' db-dark' : '');
    overlay.innerHTML =
      '<div class="db-dialog db-solpick" role="dialog" aria-label="' + esc(title) + '">' +
      '<div class="db-dialog-head"><span>' + esc(title) + '</span><button type="button" data-db="close" aria-label="Close">✕</button></div>' +
      '<div class="db-sp-body" data-db="body"></div></div>';
    document.body.appendChild(overlay);
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
    }
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-db="close"]')) close();
    });
    const body = overlay.querySelector('[data-db="body"]');
    return {
      overlay: overlay,
      close: close,
      busy: (text) => (body.innerHTML = '<div class="db-sp-busy">' + (DynaBoost.status ? DynaBoost.status.html('busy') : '') + '<span>' + esc(text) + '</span></div>'),
      fail: (text) => (body.innerHTML = '<div class="db-sp-note db-sp-bad">' + esc(text) + '</div>'),
      body: body
    };
  }

  /* Pick one: what it is in, a row per solution - a click opens it. The
   * Default Solution says what a change made there means; managed ones are
   * folded away under a line of their own. */
  function pick(d, what, list, urlFor, onOpen) {
    const row = (s) =>
      '<button type="button" class="db-sp-row' + (s.managed ? ' db-sp-managed' : '') + (s.isDefault ? ' db-sp-default' : '') + '" data-sol="' + esc(s.id) + '"' +
      ' title="' + (s.managed ? 'Managed - opens to look; changes belong in an unmanaged solution' : s.isDefault ? 'A change made here is in none of your solutions' : 'Open in this solution') + '">' +
      '<span class="db-sp-name">' + esc(s.name) + (s.pinned ? '<span class="db-sp-tag db-sp-pin">My solutions</span>' : '') + '</span>' +
      '<span class="db-sp-meta">' + esc([s.isDefault ? 'not exported with your solutions' : s.managed ? 'managed' : 'unmanaged', s.version, s.unique && !s.isDefault ? s.unique : ''].filter(Boolean).join(' · ')) + '</span>' +
      '<span class="db-sp-go">↗</span></button>';
    const own = list.filter((s) => !s.managed);
    const managed = list.filter((s) => s.managed);
    const mine = own.filter((s) => !s.isDefault).length;
    d.body.innerHTML =
      '<div class="db-sp-note">' +
      (mine
        ? 'This ' + esc(what) + ' is in ' + mine + ' solution' + (mine > 1 ? 's' : '') + ' of yours. Pick the one to open it in.'
        : 'This ' + esc(what) + ' is in no unmanaged solution of yours - open it in the Default Solution, or look at it in a managed one.') +
      '</div>' +
      '<div class="db-sp-list">' + own.map(row).join('') + '</div>' +
      (managed.length
        ? '<details class="db-sp-more"><summary>' + managed.length + ' managed solution' + (managed.length > 1 ? 's' : '') + '</summary><div class="db-sp-list">' + managed.map(row).join('') + '</div></details>'
        : '');
    d.body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sol]');
      if (!b) return;
      const tab = window.open(urlFor(b.getAttribute('data-sol')), '_blank');
      if (!tab) return d.fail('The tab was blocked. Allow pop-ups for this site and try again.');
      d.close();
      onOpen();
    });
    const first = d.body.querySelector('.db-sp-row');
    if (first) first.focus();
  }

  /* Where it goes: the one solution straight away (a pop-up blocked after
   * the wait is asked for in the dialog), else the list. */
  async function openIn(d, what, find, urlFor, toolId) {
    d.busy('Finding the solutions it is in…');
    let list;
    try {
      list = await find();
    } catch (e) {
      return d.fail((e && e.message) || String(e));
    }
    const done = () => DynaBoost.saved(toolId);
    const one = onlyChoice(list);
    if (one && window.open(urlFor(one.id), '_blank')) {
      d.close();
      return done();
    }
    pick(d, what, list, urlFor, done);
  }

  // ---------- Edit form ----------

  // The dialog shows at once, while the page and the environment are read.
  async function runForm() {
    const d = dialog('Edit form');
    d.busy('Reading the form…');
    const ctx = DynaBoost.formContext ? await DynaBoost.formContext() : null;
    const envId = clean((ctx && ctx.envId) || (await environmentId()));
    const why = !ctx || !ctx.entity ? 'No record form on this page.' : !ctx.formId ? 'The page does not say which form is open.' : !envId ? 'The environment id could not be read.' : '';
    if (why) return d.fail('Could not open the form designer. ' + why);
    const formId = clean(ctx.formId);
    openIn(
      d,
      'form',
      () => solutionsOf(formId, SYSTEM_FORM, envId),
      (sol) => MAKER + '/e/' + envId + '/s/' + sol + '/entity/' + encodeURIComponent(ctx.entity) + '/form/edit/' + formId,
      'form-editor'
    );
  }

  // ---------- Open table ----------

  // The table of the record or the list on the page.
  function tableHere() {
    const p = new URLSearchParams(location.search);
    return p.get('etn') || null;
  }

  async function runTable() {
    const d = dialog('Open table');
    d.busy('Reading the table…');
    const ctx = DynaBoost.formContext ? await DynaBoost.formContext() : null;
    const table = (ctx && ctx.entity) || tableHere();
    const envId = clean((ctx && ctx.envId) || (await environmentId()));
    if (!table || !envId) return d.fail('Could not open the table. ' + (!table ? 'No record or list of a table on this page.' : 'The environment id could not be read.'));
    // The maker opens a table by its MetadataId, not its name.
    let metaId = null;
    openIn(
      d,
      'table',
      async () => {
        const meta = await getJson("EntityDefinitions(LogicalName='" + encodeURIComponent(table) + "')?$select=MetadataId");
        metaId = clean(meta.MetadataId);
        return solutionsOf(metaId, ENTITY, envId);
      },
      (sol) => MAKER + '/environments/' + envId + '/solutions/' + sol + '/entities/' + metaId,
      'table-open'
    );
  }

  // ---------- Edit view ----------

  const VIEW_ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M3 6h14M3 11h14M3 16h8" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="m13.5 20.5.6-2.8 5.6-5.6a1.4 1.4 0 0 1 2 2l-5.6 5.6z" stroke="#E3B04B" stroke-width="1.5" stroke-linejoin="round"/>' +
    '</svg>';

  /* The view of the list on the page: the one in the address (a list
   * opened from a subgrid, or a view picked) - else the table's default
   * public view. A personal view (viewType 4230) is in no solution. */
  async function viewHere(table) {
    const p = new URLSearchParams(location.search);
    if (p.get('viewType') === '4230') throw new Error('This is a personal view - it is in no solution and opens in the view designer only as a system view. Pick a system view and try again.');
    const id = clean(p.get('viewid'));
    const path = id
      ? 'savedqueries(' + id + ')?$select=savedqueryid,name'
      : "savedqueries?$select=savedqueryid,name&$filter=returnedtypecode eq '" + encodeURIComponent(table) + "' and isdefault eq true and querytype eq 0";
    const r = await getJson(path);
    const v = id ? r : (r.value || [])[0];
    if (!v) throw new Error('No default public view found for this table.');
    return { id: clean(v.savedqueryid), name: v.name || '' };
  }

  async function runView() {
    const d = dialog('Edit view');
    d.busy('Reading the view\u2026');
    const table = tableHere();
    const envId = clean(await environmentId());
    if (!table || !envId) return d.fail('Could not open the view designer. ' + (!table ? 'No list of a table on this page.' : 'The environment id could not be read.'));
    let view;
    try {
      view = await viewHere(table);
    } catch (e) {
      return d.fail((e && e.message) || String(e));
    }
    openIn(
      d,
      'view' + (view.name ? ' (' + view.name + ')' : ''),
      () => solutionsOf(view.id, SAVED_QUERY, envId),
      (sol) => MAKER + '/e/' + envId + '/s/' + sol + '/entity/' + encodeURIComponent(table) + '/view/' + view.id,
      'view-editor'
    );
  }

  DynaBoost.register({
    id: 'form-editor',
    name: 'Edit form',
    group: 'Records',
    hosts: ['dynamics.com'],
    when: () => new URLSearchParams(location.search).get('pagetype') === 'entityrecord',
    type: 'action',
    hint: 'Open this form in the form designer, in its solution',
    icon: ICON,
    onRun: runForm
  });

  DynaBoost.register({
    id: 'table-open',
    name: 'Open table',
    group: 'Records',
    hosts: ['dynamics.com'],
    when: () => /^entity(record|list)$/.test(new URLSearchParams(location.search).get('pagetype') || '') && !!tableHere(),
    type: 'action',
    hint: 'Open this table in the maker portal, in its solution',
    icon: TABLE_ICON,
    onRun: runTable
  });

  DynaBoost.register({
    id: 'view-editor',
    name: 'Edit view',
    group: 'Records',
    hosts: ['dynamics.com'],
    when: () => new URLSearchParams(location.search).get('pagetype') === 'entitylist' && !!tableHere(),
    type: 'action',
    hint: 'Open this view in the view designer, in its solution',
    icon: VIEW_ICON,
    onRun: runView
  });
})();
