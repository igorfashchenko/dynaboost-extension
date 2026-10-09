/* Feature: Compare - this form and its table, or this record, against
 * another environment; or two records in this one.
 *
 * Form and table: the form's fields (place, label, hidden, read-only,
 * required, the logic on each), the table's columns, and the logic (scripts,
 * business rules, classic workflows, plug-in steps, cloud flows - on or off).
 * Record: two records field by field, here or in another environment. Read
 * only.
 *
 * The other side is read the way Form as JSON reads a form
 * (DynaBoost.formDump.read), in a tab of that environment: one already open,
 * or one opened in the background for the moment and closed again by
 * background.js. That asks first, in DynaBoost's own dialog, unless "Don't
 * ask again" was ticked - the switch in the dialog turns asking back on.
 * The table is matched by its name, the form by its name; when the form is
 * not there by name (or twice), the tab lists the other side's forms to pick.
 * Logic is matched by its name; one named differently is two rows.
 *
 * The environments: the open Dynamics tabs and the list of the user's
 * environments (names and addresses) as the maker portal's own answer gave
 * it (env-list-hook.js; its cache when that went by unseen), kept whenever a
 * make.powerapps.com tab is open - or, asked for, read in one opened in the
 * background, which Stop, Cancel or the cross close again.
 */
(function () {
  if (DynaBoost.off) return;

  const ICON_CONFIG =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="2.5" y="4" width="7.5" height="16" rx="1.5" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<rect x="14" y="4" width="7.5" height="16" rx="1.5" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M4.8 8h3M4.8 11h3M16.3 8h3M16.3 11h3" stroke="#3D8BFF" stroke-width="1.4" stroke-linecap="round"/>' +
    '<path d="M10.6 15h2.8m0 0-1.1-1.1m1.1 1.1-1.1 1.1M13.4 18.2h-2.8m0 0 1.1-1.1m-1.1 1.1 1.1 1.1" stroke="#E3B04B" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
  const LOOK =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10.5" cy="10.5" r="6" stroke="currentColor" stroke-width="1.8"/><path d="m15 15 5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  const ASK_KEY = 'dynaboost.askBackgroundTabs'; // false once "Don't ask again" was ticked
  const ENV_LIST_KEY = 'dynaboost.environments';
  const MAKER = 'make.powerapps.com';
  const CRM_HOST_RE = /https?:\/\/([a-z0-9-]+\.crm[0-9]*\.dynamics\.com)/i;
  const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.dynamics\.com$/;
  const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const FMT = '@OData.Community.Display.V1.FormattedValue';

  // System fields: hidden behind "Hide system fields" - who and when, the
  // row's bookkeeping, the process and the currency rate.
  const SYSTEM = new Set([
    'createdon', 'createdby', 'modifiedon', 'modifiedby', 'createdonbehalfby', 'modifiedonbehalfby', 'overriddencreatedon',
    'ownerid', 'owninguser', 'owningteam', 'owningbusinessunit', 'importsequencenumber', 'versionnumber',
    'timezoneruleversionnumber', 'utcconversiontimezonecode', 'processid', 'stageid', 'traversedpath', 'exchangerate'
  ]);
  const isSystem = (f, primaryId) => SYSTEM.has(f) || f === primaryId || /_base$/.test(f) || /^address\d_addressid$/.test(f);

  // The API's required levels, as the form shows them.
  const REQUIRED = { None: 'optional', Recommended: 'recommended', ApplicationRequired: 'required', SystemRequired: 'required (system)' };
  const required = (v) => REQUIRED[v] || v || '';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clean = (g) => String(g || '').replace(/[{}]/g, '').toLowerCase();
  const params = () => new URLSearchParams(location.search);
  const onRecord = () => params().get('pagetype') === 'entityrecord' || (!!params().get('etn') && !!params().get('id'));

  function stored(key, fallback) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(key, (d) => resolve(d && d[key] !== undefined ? d[key] : fallback));
      } catch (e) {
        resolve(fallback);
      }
    });
  }

  /* A write to DynaBoost's storage. After DynaBoost is updated or reloaded,
   * the copy still in an open tab is cut off and every chrome.* call throws
   * at once ("Extension context invalidated") - that copy then writes
   * nothing, quietly. */
  function save(items) {
    if (!DynaBoost.alive || !DynaBoost.alive()) return;
    try {
      chrome.storage.local.set(items).catch(() => {});
    } catch (e) {
      /* cut off between the check and the call */
    }
  }

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => resolve(r || { error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'No answer.' }));
      } catch (e) {
        resolve({ error: 'DynaBoost was updated - reload this page.' });
      }
    });
  }

  // ---------- the environments the maker portal knows ----------

  /* make.powerapps.com keeps the user's environments in its localStorage
   * ("shell-local-storage-cache:..."), as the environments API returns them:
   * a name, a displayName and the Dataverse address under
   * linkedEnvironmentMetadata. An internal format - read loosely; whatever is
   * not found leaves the list to the open tabs and a pasted address. */
  function makerEnvironments() {
    const found = new Map();
    const add = (id, name, host) => {
      const key = host || 'id:' + id;
      if (!name || found.has(key)) return;
      found.set(key, { id: id || null, name: String(name), host: host || null });
    };
    const walk = (node, depth) => {
      if (node == null || depth > 14) return;
      if (typeof node === 'string') {
        const t = node.trim();
        if (t.length > 40 && (t[0] === '{' || t[0] === '[') && /environment/i.test(t)) {
          try {
            walk(JSON.parse(t), depth + 1);
          } catch (e) {
            /* not JSON */
          }
        }
        return;
      }
      if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
      if (typeof node !== 'object') return;
      const p = node.properties;
      if (p && typeof p === 'object' && p.displayName && /environments\//i.test(String(node.id || ''))) {
        const meta = p.linkedEnvironmentMetadata || {};
        const m = String(meta.instanceUrl || meta.instanceApiUrl || '').match(CRM_HOST_RE);
        add(node.name || '', p.displayName, m ? m[1].toLowerCase() : null);
      }
      for (const k of Object.keys(node)) walk(node[k], depth + 1);
    };
    let store;
    try {
      store = window.localStorage;
    } catch (e) {
      return [];
    }
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i) || '';
      let val = '';
      try {
        val = store.getItem(key) || '';
      } catch (e) {
        continue;
      }
      if (!/linkedEnvironmentMetadata|Microsoft\.PowerApps\/environments|BusinessAppPlatform\/environments/i.test(val)) continue;
      walk(val, 0);
    }
    return Array.from(found.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /* What the portal's own answer held (env-list-hook.js, in the page): the
   * surer source. Only names and Dataverse addresses come across. */
  let fromPage = [];
  const portal = location.hostname === MAKER || location.hostname === 'make.powerautomate.com';

  function keep(list) {
    if (!list.length || window.top !== window) return;
    save({ [ENV_LIST_KEY]: { at: Date.now(), list: list } });
  }

  if (portal) {
    window.addEventListener('message', (e) => {
      if (e.source !== window || !e.data || e.data.source !== 'dynaboost-env-list' || !Array.isArray(e.data.list)) return;
      const seen = new Map();
      for (const env of e.data.list.slice(0, 1000)) {
        const host = String((env && env.host) || '').toLowerCase();
        const name = String((env && env.name) || '').trim().slice(0, 200);
        if (name && HOST_RE.test(host)) seen.set(host, { id: String(env.id || '').slice(0, 100) || null, name: name, host: host });
      }
      if (!seen.size) return;
      fromPage = Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
      keep(fromPage);
    });
    window.postMessage({ source: 'dynaboost-env-list-ask' }, location.origin);
  }

  const listNow = () => (fromPage.length ? fromPage : makerEnvironments().filter((e) => e.host));

  // The list, waiting up to `wait` ms for the portal to read it.
  async function environments(wait) {
    const end = Date.now() + (wait || 0);
    let list = listNow();
    while (!list.length && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 400));
      list = listNow();
    }
    return list;
  }

  // An open maker portal keeps DynaBoost's copy of the list fresh - from its
  // cache too, when its answer went by unseen.
  if (location.hostname === MAKER && window.top === window) {
    const fromCache = () => {
      if (fromPage.length || !DynaBoost.alive || !DynaBoost.alive()) return;
      keep(makerEnvironments().filter((e) => e.host));
    };
    setTimeout(fromCache, 6000);
    setTimeout(fromCache, 30000);
  }

  // ---------- reading: here, or in the other environment's tab ----------

  async function read(req) {
    try {
      return await DynaBoost.formDump.read(req);
    } catch (e) {
      return { error: e.message };
    }
  }

  DynaBoost.envCompare = { read: read, environments: environments };

  // { result } or { error: 'signin' | 'unreachable' | message }
  async function readAt(host, req) {
    if (host === location.hostname) {
      const r = await read(req);
      return r && r.error ? { error: r.error } : { result: r };
    }
    return send({ type: 'DB_ENV_READ', host: host, req: req });
  }

  // ---------- the dialogs over the page ----------

  const envName = (env) => env.name || env.host.split('.')[0];
  const initials = (s) => (String(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase();

  // A record id from an id or a record link (whose first GUID can be the appid).
  function idFrom(text) {
    const t = String(text || '').trim();
    try {
      const id = new URL(t).searchParams.get('id');
      if (id && GUID.test(id)) return clean(id.match(GUID)[0]);
    } catch (e) {
      /* not a link */
    }
    const m = t.match(GUID);
    return m ? clean(m[0]) : null;
  }

  function hostFrom(text) {
    const t = String(text || '').trim().toLowerCase();
    const m = t.match(/^(?:https?:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.dynamics\.com)/);
    return m && HOST_RE.test(m[1]) ? m[1] : null;
  }

  function overlayOf(cls, label) {
    const overlay = document.createElement('div');
    overlay.className = 'db-overlay' + (DynaBoost.isDark() ? ' db-dark' : '');
    overlay.innerHTML = '<div class="db-dialog ' + cls + '" role="dialog" aria-label="' + esc(label) + '"></div>';
    document.body.appendChild(overlay);
    return overlay;
  }

  /* Before a tab opens in the background: what opens, why, and that it
   * closes again. Resolves true for OK; "Don't ask again" turns the picker's
   * switch off. */
  function askBackground(what, host) {
    return new Promise((resolve) => {
      const overlay = overlayOf('db-cmp-ask', 'Open a tab in the background?');
      overlay.style.zIndex = '2147483200';
      const box = overlay.firstChild;
      box.innerHTML =
        '<div class="db-dialog-head"><span>Open a tab in the background?</span><button type="button" data-db="x" aria-label="Close">✕</button></div>' +
        '<div class="db-cmp-text">To ' + esc(what) + ', DynaBoost opens <b>' + esc(host) + '</b> in a tab in the background for a moment and closes it again.</div>' +
        '<div class="db-cmp-text db-cmp-dim">It only reads, with your own sign-in. Nothing is changed or sent anywhere else.</div>' +
        // "Don't ask again" on the right of the buttons, away from OK.
        '<div class="db-dialog-actions"><button type="button" class="db-primary" data-db="ok">OK</button><button type="button" data-db="cancel">Cancel</button>' +
        '<label class="db-cmp-check" title="' + esc(
          'From now on DynaBoost opens and closes these tabs without asking: make.powerapps.com for the list of your environments, and the other environment’s address to read from it. Only reading, with your own sign-in. Turn asking back on with the switch in Compare.'
        ) + '"><input type="checkbox" data-db="never"> Don’t ask again</label></div>';
      const q = (k) => box.querySelector('[data-db="' + k + '"]');
      const done = (ok) => {
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        if (ok && q('never').checked) save({ [ASK_KEY]: false });
        resolve(ok);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          done(false);
        }
      };
      document.addEventListener('keydown', onKey, true);
      q('ok').addEventListener('click', () => done(true));
      q('cancel').addEventListener('click', () => done(false));
      q('x').addEventListener('click', () => done(false));
      overlay.addEventListener('click', (e) => e.target === overlay && done(false));
      q('ok').focus();
    });
  }

  /* One dialog for both, as a small vertical process: From (this
   * environment, always shown) -> Compare (the form and its table, or a
   * record: this one filled in, the other one's id or link) -> With (an
   * environment; for a record this one at first) -> Compare. Under it the
   * switch for asking before a tab opens in the background. */
  async function openCompare(ctx) {
    DynaBoost.closePanel();
    const here = location.hostname;
    const overlay = overlayOf('db-imp db-cmp', 'Compare');
    const box = overlay.firstChild;
    box.innerHTML =
      '<div class="db-dialog-head"><span>Compare</span><button type="button" data-db="x" aria-label="Close">✕</button></div>' +
      '<div class="db-cmp-flow">' +
      '<div class="db-cmp-st db-cmp-done"><span class="db-cmp-dot"></span><span class="db-cmp-k">From</span><div class="db-cmp-v">' +
      '<div class="db-cmp-here"><b data-db="herename"></b><span class="db-cmp-tag">here</span></div>' +
      '<div class="db-cmp-sub">' + esc(ctx.entityLabel) + (ctx.recordName ? ' · ' + esc(ctx.recordName) : '') + (ctx.formName ? ' · form ' + esc(ctx.formName) : '') + '</div></div></div>' +
      '<div class="db-cmp-st" data-db="st-what"><span class="db-cmp-dot"></span><span class="db-cmp-k">Compare</span><div class="db-cmp-v">' +
      '<span class="db-cmp-seg" role="group" aria-label="What to compare">' +
      '<button type="button" data-what="form" aria-pressed="true">Form and table</button>' +
      '<button type="button" data-what="record" aria-pressed="false"' + (ctx.id ? '' : ' disabled title="Save the record first - a new one has no id yet"') + '>Record</button></span>' +
      '<div class="db-cmp-sub" data-db="what-sub"></div>' +
      '<div class="db-cmp-rec" data-db="recbox" hidden>' +
      '<label class="db-cmp-field"><span>This record</span><input type="text" data-db="id1" spellcheck="false" autocomplete="off"></label>' +
      '<label class="db-cmp-field"><span>Other record</span><input type="text" data-db="id2" spellcheck="false" autocomplete="off" placeholder="Its id, or its link from any environment"></label>' +
      '</div></div></div>' +
      '<div class="db-cmp-st db-cmp-last" data-db="st-with"><span class="db-cmp-dot"></span><span class="db-cmp-k">With</span><div class="db-cmp-v">' +
      '<label class="db-imp-search">' + LOOK + '<input type="text" data-db="q" placeholder="Environment name, or paste its address" autocomplete="off" spellcheck="false" aria-label="Find an environment"></label>' +
      '<div class="db-imp-list" role="listbox" data-db="list"></div>' +
      '<div class="db-cmp-fetch" data-db="fetch" hidden></div>' +
      '<div class="db-imp-note" data-db="note"></div>' +
      '</div></div>' +
      '</div>' +
      '<div class="db-dialog-actions"><button type="button" class="db-primary" data-db="go" disabled>Compare</button><button type="button" data-db="cancel">Cancel</button></div>' +
      '<div class="db-imp-foot db-cmp-foot"><span title="' + esc(
        'On: DynaBoost asks before it opens a tab in the background. Off: it opens and closes them by itself - make.powerapps.com for the list of your environments, the other environment to read from it. Only reading, with your own sign-in.'
      ) + '">Ask before opening a tab in the background</span>' +
      '<button type="button" class="db-pr-switch" role="switch" aria-checked="true" data-db="ask" aria-label="Ask before opening a tab in the background"></button></div>';

    const q = (k) => box.querySelector('[data-db="' + k + '"]');
    const input = q('q');
    const list = q('list');
    const note = q('note');
    const go = q('go');
    const fetchBox = q('fetch');
    let sources = { open: [], stored: null };
    let what = 'form';
    let picked = null;
    let ask = true;
    let job = ''; // the read of the list going on, '' when none
    let ticker = 0;

    // Closing - Cancel, the cross, Esc, a click beside - also stops a read of
    // the list that is going on.
    function close() {
      stop();
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
    }
    const onKey = (e) => {
      if (e.key === 'Escape' && !document.querySelector('.db-cmp-ask')) close();
    };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', (e) => e.target === overlay && close());
    q('x').addEventListener('click', close);
    q('cancel').addEventListener('click', close);

    const setAsk = (on) => {
      ask = on;
      q('ask').setAttribute('aria-checked', String(on));
    };
    stored(ASK_KEY, true).then((v) => setAsk(v !== false));
    q('ask').addEventListener('click', () => {
      setAsk(!ask);
      save({ [ASK_KEY]: ask });
    });

    q('id1').value = ctx.id || '';
    for (const id of ['id1', 'id2']) {
      q(id).addEventListener('input', () => {
        // A link brings its environment along.
        const host = id === 'id2' ? hostFrom(q('id2').value) : null;
        if (host) picked = { host: host, name: (known().find((e) => e.host === host) || {}).name || '' };
        draw();
      });
    }

    function setWhat(w) {
      what = w;
      box.querySelectorAll('[data-what]').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-what') === w)));
      q('recbox').hidden = w !== 'record';
      q('what-sub').textContent = w === 'form' ? 'The form’s fields, the table’s columns and the logic on it - only what differs.' : 'Two records of ' + ctx.entityLabel + ', field by field.';
      // A record is compared here at first; a form only with another environment.
      if (w === 'record' && !picked) picked = { host: here, name: '' };
      if (w === 'form' && picked && picked.host === here) picked = null;
      draw();
      if (w === 'record') q('id2').focus();
    }
    box.querySelectorAll('[data-what]').forEach((b) => b.addEventListener('click', () => !b.disabled && setWhat(b.getAttribute('data-what'))));

    function known() {
      const out = new Map();
      for (const e of (sources.stored && sources.stored.list) || []) if (e.host) out.set(e.host, { host: e.host, name: e.name, open: false });
      for (const h of sources.open) {
        const e = out.get(h) || { host: h, name: '', open: false };
        e.open = true;
        out.set(h, e);
      }
      return Array.from(out.values());
    }
    const nameOfHere = () => (known().find((e) => e.host === here) || {}).name || ctx.hereName;

    function rowHtml(env, tag) {
      const on = !!picked && picked.host === env.host;
      return (
        '<button type="button" class="db-imp-row' + (on ? ' db-imp-on' : '') + '" role="option" aria-selected="' + on + '" data-host="' + esc(env.host) + '" data-name="' + esc(env.name || '') + '">' +
        '<span class="db-imp-av">' + esc(initials(env.name || env.host)) + '</span>' +
        '<span class="db-imp-who"><b>' + esc(env.name || env.host.split('.')[0]) + '</b><span>' + esc(env.host) + '</span></span>' +
        (tag ? '<span class="db-cmp-tag">' + esc(tag) + '</span>' : '') +
        '</button>'
      );
    }

    function draw() {
      q('herename').textContent = nameOfHere();
      const term = input.value.trim().toLowerCase();
      const typed = hostFrom(term);
      const all = known().filter((e) => e.host !== here);
      const hit = (e) => !term || typed || (e.name + ' ' + e.host).toLowerCase().indexOf(term) >= 0;
      const parts = [];
      if (typed && typed !== here && !all.some((e) => e.host === typed)) parts.push(rowHtml({ host: typed, name: '' }, 'typed'));
      if (what === 'record' && (!term || (nameOfHere() + ' ' + here).toLowerCase().indexOf(term) >= 0)) {
        parts.push('<div class="db-imp-label">This environment</div>' + rowHtml({ host: here, name: nameOfHere() }, 'here'));
      }
      const open = all.filter((e) => e.open && hit(e));
      const rest = all.filter((e) => !e.open && hit(e));
      if (open.length) parts.push('<div class="db-imp-label">Open in a tab</div>' + open.map((e) => rowHtml(e, 'open')).join(''));
      if (rest.length) parts.push('<div class="db-imp-label">Your environments</div>' + rest.map((e) => rowHtml(e)).join(''));
      else if (sources.stored && !term) parts.push('<div class="db-imp-label">Your environments</div><div class="db-imp-note db-cmp-empty">No other environment in the list.</div>');
      list.innerHTML = parts.join('');
      const idsOk = what !== 'record' || (!!idFrom(q('id1').value) && !!idFrom(q('id2').value));
      q('st-what').classList.toggle('db-cmp-done', idsOk);
      q('st-with').classList.toggle('db-cmp-done', !!picked);
      go.disabled = !picked || !idsOk;
    }

    input.addEventListener('input', draw);
    list.addEventListener('click', (e) => {
      const r = e.target.closest('[data-host]');
      if (!r) return;
      picked = { host: r.getAttribute('data-host'), name: r.getAttribute('data-name') || '' };
      note.textContent = '';
      draw();
    });
    list.addEventListener('dblclick', (e) => e.target.closest('[data-host]') && !go.disabled && go.click());

    /* The list of your environments, under the list: how it stands and the
     * button that reads it - while it reads, the busy squares, the seconds
     * and Stop. */
    function when(at) {
      const d = new Date(at);
      const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return d.toDateString() === new Date().toDateString() ? 'today ' + hm : d.toLocaleDateString() + ' ' + hm;
    }
    const BTN_ICON =
      '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13.2 8A5.2 5.2 0 1 1 11.6 4.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12.2 1.8v2.9H9.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const button = (label, primary, title) =>
      '<button type="button" class="db-cmp-get' + (primary ? ' db-cmp-get-main' : '') + '" data-db="get"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + BTN_ICON + esc(label) + '</button>';

    function setFetch(state, text) {
      clearInterval(ticker);
      ticker = 0;
      fetchBox.hidden = false;
      fetchBox.className = 'db-cmp-fetch db-cmp-fetch-' + state;
      const n = sources.stored && sources.stored.list ? sources.stored.list.length : 0;
      const count = n + (n === 1 ? ' environment' : ' environments');
      if (state === 'busy') {
        const started = Date.now();
        fetchBox.innerHTML =
          DynaBoost.status.html('busy') +
          '<div class="db-cmp-fetch-t"><b>Reading your environments… <span data-db="secs">0 s</span></b><span>' + esc(text) + '</span></div>' +
          '<button type="button" class="db-cmp-get" data-db="stop">Stop</button>';
        const secs = fetchBox.querySelector('[data-db="secs"]');
        ticker = setInterval(() => {
          if (!overlay.isConnected) return clearInterval(ticker);
          secs.textContent = Math.round((Date.now() - started) / 1000) + ' s';
        }, 1000);
      } else if (state === 'ok') {
        fetchBox.innerHTML = DynaBoost.status.html('ok') + '<div class="db-cmp-fetch-t"><b>' + esc(count) + ' read just now</b><span>From make.powerapps.com.</span></div>' + button('Refresh', false, 'Read the list again from make.powerapps.com');
      } else if (state === 'bad') {
        fetchBox.innerHTML = DynaBoost.status.html('bad') + '<div class="db-cmp-fetch-t"><b>The list was not read</b><span>' + esc(text) + '</span></div>' + button('Try again', true);
      } else if (state === 'read') {
        fetchBox.innerHTML =
          '<div class="db-cmp-fetch-t"><b>' + esc(count) + '</b><span>Read from make.powerapps.com ' + esc(when(sources.stored.at)) + '.</span></div>' +
          button('Refresh', false, 'Read the list again from make.powerapps.com');
      } else {
        fetchBox.innerHTML =
          '<div class="db-cmp-fetch-t"><b>Your environments are not read yet</b><span>' +
          (sources.maker ? 'DynaBoost reads them from your open make.powerapps.com tab.' : 'DynaBoost reads them from make.powerapps.com - in a background tab, for a few seconds.') +
          '</span></div>' + button('Get the list', true);
      }
    }
    const idle = () => setFetch(sources.stored ? 'read' : 'none');

    fetchBox.addEventListener('click', (e) => {
      if (e.target.closest('[data-db="get"]')) refresh();
      else if (e.target.closest('[data-db="stop"]')) {
        stop();
        idle();
      }
    });

    // Stops the read going on: background.js closes its tab at once.
    function stop() {
      clearInterval(ticker);
      ticker = 0;
      if (!job) return;
      send({ type: 'DB_ENV_CANCEL', job: job });
      job = '';
    }

    const SLOW = 'make.powerapps.com opens in the background and closes again - usually 5 to 20 seconds, at most a minute.';
    const failed = (r) =>
      r.error === 'signin' ? 'make.powerapps.com wants you to sign in. Open it, sign in, then Try again.' :
      r.error === 'empty' ? 'make.powerapps.com did not show its list. Open make.powerapps.com once, then Try again.' :
      r.error === 'unreachable' ? 'make.powerapps.com did not open in time. Try again.' :
      'Could not read the list: ' + r.error;

    async function refresh() {
      if (job) return;
      // An open make.powerapps.com tab is read as it is - nothing opens.
      if (ask && !sources.maker && !(await askBackground('read the list of your environments', MAKER))) return;
      if (!overlay.isConnected || job) return;
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      job = id;
      setFetch('busy', sources.maker ? 'From your open make.powerapps.com tab - a few seconds.' : SLOW);
      let r = await send({ type: 'DB_ENV_REFRESH', job: id });
      if (job !== id) return; // stopped, or the dialog closed
      if (r.error === 'empty' && r.open) {
        // That tab was open before this DynaBoost and did not show it the list;
        // one opened now does.
        if (ask && !(await askBackground('read the list of your environments', MAKER))) {
          if (job !== id) return;
          job = '';
          setFetch('bad', 'Your open make.powerapps.com tab does not show its list - reload it, then Try again.');
          return;
        }
        if (job !== id) return;
        setFetch('busy', SLOW);
        r = await send({ type: 'DB_ENV_REFRESH', job: id, fresh: true });
        if (job !== id) return;
      }
      job = '';
      if (r.result) {
        sources.stored = r.result;
        setFetch('ok');
      } else setFetch('bad', failed(r));
      draw();
    }

    go.addEventListener('click', async () => {
      if (go.disabled || !picked) return;
      const host = picked.host;
      const env = { host: host, name: picked.name || (known().find((e) => e.host === host) || {}).name || '' };
      const away = host !== here && !sources.open.includes(host);
      const job = what === 'record' ? { mode: 'records', env: env, id1: idFrom(q('id1').value), id2: idFrom(q('id2').value) } : { mode: 'config', env: env };
      if (away && ask) {
        // The click on OK is the one that may open the result tab.
        const ok = await askBackground(what === 'record' ? 'read the other record from ' + envName(env) : 'read the table and form from ' + envName(env), host);
        if (!ok) return;
      }
      ctx.hereName = nameOfHere();
      close();
      startJob(ctx, job);
    });

    setWhat('form');
    input.focus();
    DynaBoost.status.inPage();
    sources = await send({ type: 'DB_ENV_SOURCES' });
    if (sources.error) sources = { open: [], stored: null };
    if (!overlay.isConnected) return;
    idle();
    draw();
  }

  // ---------- the result tab ----------

  const CHECK = '✓';

  function openTab(title) {
    const tab = window.open('', '_blank');
    if (!tab) {
      DynaBoost.toast('Compare', 'The tab was blocked. Allow pop-ups for this site and try again.', true);
      return null;
    }
    tab.document.write('<!doctype html><meta charset="utf-8"><title>' + esc(title) + '</title><body>');
    DynaBoost.themeTab(tab);
    return tab;
  }

  const TAB_CSS =
    '.cmp-steps{margin:18px 22px;max-width:680px;padding:14px 18px;background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px}' +
    '.cmp-steps h2{margin:0 0 8px;padding:0;border:0;font-size:15px}' +
    '.cmp-step{display:flex;gap:10px;align-items:flex-start;padding:5px 0;font-size:13.5px}' +
    '.cmp-step .db-st{margin-top:1px}' +
    '.cmp-step.bad{color:var(--dbc-fg-a11a1a)}.cmp-step .sub{margin-top:2px}' +
    '.cmp-acts{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 2px 28px}' +
    '.cmp-picks{display:flex;flex-direction:column;gap:4px;margin:8px 0 2px 28px}' +
    '.cmp-picks button{text-align:left}' +
    '.cmp-sum{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}' +
    '.cmp-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border:1px solid var(--dbc-bd-dde3f0);border-radius:14px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);font-size:12.5px;cursor:pointer}' +
    '.cmp-chip:hover{border-color:var(--dbc-bd-1e6bff)}' +
    '.cmp-chip b{font-weight:600}.cmp-chip.diff{border-color:var(--dbc-bd-e3b04b);background:var(--dbc-bg-fdf1d6);color:var(--dbc-fg-7a5410)}.cmp-chip.same{border-color:var(--dbc-bd-1c9b4a);background:var(--dbc-bg-e4f4e8);color:var(--dbc-fg-1c6b32)}' +
    '.cmp-chip.bad{border-color:var(--dbc-bd-c42b1c);background:var(--dbc-bg-fde8e8);color:var(--dbc-fg-a11a1a)}' +
    // The matrix: the name, (the type), here, there. A bar on the left says
    // what kind of difference: red - there on one side only, amber - there on
    // both, not the same. "Not there" looks the same on either side.
    '.cmp-cols{position:sticky;top:-14px;z-index:2;display:grid;grid-template-columns:minmax(220px,1.1fr) 140px minmax(0,1fr) minmax(0,1fr);gap:0 14px;margin:-14px -22px 12px;padding:12px 36px 10px 39px;background:var(--dbc-bg-f5f7fc);border-bottom:1px solid var(--dbc-bd-dde3f0);font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dbc-fg-56637f)}' +
    '.cmp-cols .here{margin-left:6px;padding:0 6px;border-radius:8px;background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-1e4fb8);font-size:10.5px;letter-spacing:.02em}' +
    '.row.cmp{grid-template-columns:minmax(220px,1.1fr) 140px minmax(0,1fr) minmax(0,1fr);align-items:center;border-left:3px solid transparent}' +
    '.row.cmp.st-miss,.row.cmp.st-only{border-left-color:var(--dbc-bd-c42b1c)}.row.cmp.st-diff{border-left-color:var(--dbc-bd-e3b04b)}' +
    'body.view-logic .cmp-cols,#v-logic .row.cmp{grid-template-columns:minmax(260px,1.6fr) minmax(0,1fr) minmax(0,1fr)}' +
    'body.view-logic .cmp-cols .ty{display:none}' +
    '.pill{display:inline-block;padding:2px 9px;border-radius:10px;font-size:11.5px;font-weight:600;white-space:nowrap}' +
    '.pill.same,.pill.on{background:var(--dbc-bg-e4f4e8);color:var(--dbc-fg-1c6b32)}.pill.off{background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f)}' +
    '.pill.none{background:transparent;border:1px dashed var(--dbc-bd-c6d0e4);color:var(--dbc-fg-56637f);font-weight:400}' +
    '.only{display:inline-block;margin-left:8px;padding:1px 8px;border-radius:10px;background:var(--dbc-bg-fde8e8);color:var(--dbc-fg-a11a1a);font-size:11px;font-weight:600;vertical-align:1px;white-space:nowrap}' +
    '.kv{font-size:12.5px;margin:1px 0}.kv .k{color:var(--dbc-fg-56637f);margin-right:6px}.kv.x{background:var(--dbc-bg-fdf1d6);border-radius:4px;padding:0 4px;margin-left:-4px}' +
    '.sec h3{display:flex;align-items:center}' +
    '.sec h3 .sec-n{margin-left:auto;font-weight:400;font-size:12px;color:var(--dbc-fg-56637f)}' +
    '.sec h3 .chev{margin-left:8px;padding:0 6px;border:0;background:none;color:var(--dbc-fg-1e6bff);font:inherit;font-size:12px;cursor:pointer}' +
    'body.only-diff .row.cmp[data-st="same"]{display:none}' +
    'body.only-diff .sec.open .row.cmp[data-st="same"]{display:grid}' +
    'body.only-diff .sec[data-alleq="1"]:not(.open) .row{display:none}' +
    'body:not(.only-diff) .chev{display:none}' +
    'body.hide-sys [data-sys="1"]{display:none!important}' +
    '#v-columns,#v-logic,#v-form{display:none}body.view-form #v-form,body.view-columns #v-columns,body.view-logic #v-logic{display:block}' +
    '.lg-h{display:inline-flex;align-items:center;gap:8px;vertical-align:middle}' +
    '.empty-note{padding:14px;color:var(--dbc-fg-56637f);font-size:13px}';

  function shellHtml(title, crumbs) {
    return (
      '<!doctype html><meta charset="utf-8"><title>' + esc(title) + '</title>' +
      '<style>' + DynaBoost.formDump.css + DynaBoost.formLogic.css + DynaBoost.status.css + TAB_CSS + DynaBoost.tabCss + '</style>' +
      '<body class="only-diff hide-sys">' +
      '<header><h1>' + esc(title) + '</h1><div class="crumbs">' + crumbs + '</div><div id="sum"></div>' +
      '<div class="bar" id="bar"></div></header>' +
      '<main><div id="content"></div></main>'
    );
  }

  // The steps while it reads, in the tab: each one ticked off, or what went wrong.
  function stepper(tab) {
    const doc = tab.document;
    const box = doc.createElement('div');
    box.className = 'cmp-steps';
    box.innerHTML = '<h2>Comparing…</h2><div data-steps></div>';
    doc.getElementById('content').appendChild(box);
    const holder = box.querySelector('[data-steps]');
    return {
      box: box,
      step(text) {
        const el = doc.createElement('div');
        el.className = 'cmp-step run';
        el.innerHTML = DynaBoost.status.html('busy') + '<div><div class="t"></div><div class="sub"></div></div>';
        el.querySelector('.t').textContent = text;
        holder.appendChild(el);
        return {
          ok(text2) {
            el.className = 'cmp-step ok';
            el.querySelector('.db-st').outerHTML = DynaBoost.status.html('ok');
            if (text2) el.querySelector('.t').textContent = text2;
          },
          bad(text2, sub) {
            el.className = 'cmp-step bad';
            el.querySelector('.db-st').outerHTML = DynaBoost.status.html('bad');
            if (text2) el.querySelector('.t').textContent = text2;
            if (sub) el.querySelector('.sub').textContent = sub;
            box.querySelector('h2').textContent = 'Not compared';
          },
          wait(text2, sub) {
            el.className = 'cmp-step';
            el.querySelector('.db-st').outerHTML = DynaBoost.status.html('wait');
            if (text2) el.querySelector('.t').textContent = text2;
            if (sub) el.querySelector('.sub').textContent = sub;
          },
          el: el
        };
      },
      actions(buttons) {
        const row = doc.createElement('div');
        row.className = 'cmp-acts';
        for (const b of buttons) {
          const btn = doc.createElement('button');
          btn.type = 'button';
          btn.textContent = b.label;
          if (b.primary) btn.className = 'primary';
          btn.addEventListener('click', () => b.run(btn));
          row.appendChild(btn);
        }
        box.appendChild(row);
        return row;
      }
    };
  }

  // A failed read of the other side, as one step with what to do.
  function failed(tab, steps, s, env, err, retry) {
    if (err === 'signin') {
      s.bad('Not signed in to ' + envName(env), 'Sign in to ' + env.host + ' in a tab, then try again.');
      steps.actions([
        { label: 'Open ' + envName(env) + ' to sign in', primary: true, run: () => tab.open('https://' + env.host + '/main.aspx', '_blank') },
        { label: 'Try again', run: retry }
      ]);
    } else if (err === 'unreachable') {
      s.bad(envName(env) + ' did not open', 'Check the address ' + env.host + ' - or open it in a tab, then try again.');
      steps.actions([{ label: 'Try again', primary: true, run: retry }]);
    } else {
      s.bad('Could not read ' + envName(env), err);
      steps.actions([{ label: 'Try again', primary: true, run: retry }]);
    }
  }

  async function startJob(ctx, job) {
    const env = job.env;
    const hereName = ctx.hereName;
    const thereName = env.host === location.hostname ? hereName : envName(env);
    const title = job.mode === 'records' ? 'Compare records — ' + ctx.entityLabel : (ctx.formName || ctx.entityLabel) + ' — ' + hereName + ' ↔ ' + thereName;
    const tab = openTab(title);
    if (!tab) return;
    const crumbs = esc(ctx.entityLabel) + ' <code>' + esc(ctx.entity) + '</code> · <b>' + esc(hereName) + '</b> <code>' + esc(location.hostname) + '</code> ↔ <b>' + esc(thereName) + '</b> <code>' + esc(env.host) + '</code>';
    const run = () => {
      if (tab.closed) return;
      tab.document.open();
      tab.document.write(shellHtml(title, crumbs));
      tab.document.close();
      DynaBoost.themeTab(tab);
      return job.mode === 'records' ? runRecords(tab, ctx, job, thereName, run) : runForm(tab, ctx, job, thereName, run);
    };
    run();
  }

  // ---------- Compare with: reading ----------

  async function runForm(tab, ctx, job, thereName, retry) {
    const env = job.env;
    const steps = stepper(tab);
    const s1 = steps.step('Reading the form here (' + ctx.hereName + ')');
    const here = await read({ op: 'form', entity: ctx.entity, formId: ctx.formId, formName: ctx.formName, lcid: ctx.lcid });
    if (tab.closed) return;
    if (!here || here.error || !here.dump) return s1.bad('Could not read the form here', (here && here.error) || 'No main form found.');
    s1.ok('Form here: ' + here.dump.form.name);
    const formName = here.dump.form.name;

    const s2 = steps.step('Reading ' + thereName + ' — table ' + ctx.entity + ', form “' + formName + '”');
    const ask = async (req) => {
      const r = await readAt(env.host, req);
      if (tab.closed) return null;
      if (r.error) {
        failed(tab, steps, s2, env, r.error, retry);
        return null;
      }
      return r.result;
    };
    let there = await ask({ op: 'form', entity: ctx.entity, formName: formName, lcid: ctx.lcid });
    if (!there) return;
    if (there.missing === 'table') return s2.bad('There is no table ' + ctx.entity + ' in ' + thereName, 'Nothing to compare: the table has not reached that environment.');
    if (there.pick) {
      if (!there.pick.length) return s2.bad(thereName + ' has no active main form for ' + ctx.entity);
      s2.wait(
        there.reason === 'many' ? thereName + ' has ' + there.pick.filter((f) => f.name.toLowerCase() === formName.toLowerCase()).length + ' main forms named “' + formName + '”' : thereName + ' has no main form named “' + formName + '”',
        'Pick the form to compare with:'
      );
      const chosen = await new Promise((resolve) => {
        const box = tab.document.createElement('div');
        box.className = 'cmp-picks';
        for (const f of there.pick) {
          const b = tab.document.createElement('button');
          b.type = 'button';
          b.textContent = f.name + ' (' + f.controls + ' controls)';
          b.addEventListener('click', () => {
            box.remove();
            resolve(f);
          });
          box.appendChild(b);
        }
        s2.el.after(box);
      });
      s2.wait('Reading ' + thereName + ' — form “' + chosen.name + '”');
      s2.el.className = 'cmp-step run';
      s2.el.querySelector('.db-st').outerHTML = DynaBoost.status.html('busy');
      there = await ask({ op: 'form', entity: ctx.entity, formId: chosen.id, lcid: ctx.lcid });
      if (!there) return;
    }
    if (!there.dump) return s2.bad('Could not read the form in ' + thereName, there.error || '');
    s2.ok(thereName + ': table ' + ctx.entity + ', form “' + there.dump.form.name + '”');
    drawForm(tab, ctx, here, there, thereName);
    DynaBoost.saved('compare', 'form');
  }

  // ---------- Compare with: what differs ----------

  function placesOf(dump) {
    const out = new Map();
    const order = [];
    const add = (tab, sec, c) => {
      const key = c.kind === 'field' ? 'f:' + c.field : c.kind + ':' + (c.id || '');
      if (out.has(key)) return;
      out.set(key, { c: c, tab: tab, sec: sec, key: key });
      order.push(key);
    };
    for (const s of dump.header) for (const c of s.controls) add({ name: 'header', label: 'Header' }, s, c);
    for (const t of dump.tabs) for (const s of t.sections) for (const c of s.controls) add(t, s, c);
    for (const s of dump.footer) for (const c of s.controls) add({ name: 'footer', label: 'Footer' }, s, c);
    return { map: out, order: order };
  }

  const KINDS = ['js', 'rule', 'plug', 'wf', 'flow'];
  const KIND_WORD = { js: 'OnChange scripts', rule: 'Business rules', plug: 'Plug-in steps', wf: 'Classic workflows', flow: 'Cloud flows' };

  function marksOf(logic) {
    try {
      return logic && !logic.error ? DynaBoost.formLogic.marks(logic) : {};
    } catch (e) {
      return {};
    }
  }

  // The things that make a field on the form differ, each as here / there.
  function fieldDiffs(h, t, mh, mt) {
    const out = [];
    const cmp = (what, a, b) => {
      if (String(a == null ? '' : a) !== String(b == null ? '' : b)) out.push({ what: what, here: a, there: b });
    };
    cmp('Label', h.c.label || h.c.displayName, t.c.label || t.c.displayName);
    cmp('Place', (h.tab.label || h.tab.name) + ' › ' + (h.sec.label || h.sec.name), (t.tab.label || t.tab.name) + ' › ' + (t.sec.label || t.sec.name));
    cmp('Shown', h.c.visibility ? 'hidden' : 'visible', t.c.visibility ? 'hidden' : 'visible');
    cmp('Read-only', h.c.disabled ? 'yes' : 'no', t.c.disabled ? 'yes' : 'no');
    if (h.c.kind === 'field') {
      cmp('Type', DynaBoost.formDump.typeText(h.c), DynaBoost.formDump.typeText(t.c));
      cmp('Required', required(h.c.requiredLevel), required(t.c.requiredLevel));
      for (const k of KINDS) {
        const a = mh ? mh[k].length : 0;
        const b = mt ? mt[k].length : 0;
        if (a !== b) out.push({ what: KIND_WORD[k], here: a, there: b });
      }
    }
    return out;
  }

  // Next to the name of something one side only has: where it is.
  const onlyTag = (st, names) =>
    st === 'miss' || st === 'only' ? '<span class="only">only in ' + esc(st === 'miss' ? names.here : names.there) + '</span>' : '';

  const kv = (k, v, x) => '<div class="kv' + (x ? ' x' : '') + '"><span class="k">' + esc(k) + '</span>' + esc(v == null || v === '' ? '–' : v) + '</div>';

  function fieldRow(key, h, t, mh, mt, names, primaryId) {
    const one = h || t;
    const c = one.c;
    const field = c.kind === 'field' ? c.field : '';
    const diffs = h && t ? fieldDiffs(h, t, mh, mt) : [];
    const st = !t ? 'miss' : !h ? 'only' : diffs.length ? 'diff' : 'same';
    const place = (p) => (p.tab.label || p.tab.name) + ' › ' + (p.sec.label || p.sec.name);
    const cell = (side, other, m, isHere) => {
      if (!side) return '<span class="pill none">not on the form</span>';
      if (st === 'same') return '<span class="pill same">the same</span>';
      if (!other) return kv('Place', place(side)) + kv('Label', side.c.label || side.c.displayName);
      return diffs.map((d) => kv(d.what, isHere ? d.here : d.there, true)).join('');
    };
    const marks = field ? DynaBoost.formLogic.markHtml(mh || mt || null, field, c.label || c.displayName) : '';
    const search = [c.label, c.displayName, field, c.id, c.kind].filter(Boolean).join(' ').toLowerCase();
    const html =
      '<div class="row cmp st-' + st + '" data-st="' + (st === 'same' ? 'same' : 'diff') + '" data-s="' + esc(search) + '"' + (field && isSystem(field, primaryId) ? ' data-sys="1"' : '') + '>' +
      '<div class="lbl">' + esc(c.label || c.displayName || c.id) + DynaBoost.formDump.badges(c) + marks + onlyTag(st, names) + '<div class="sub"><code>' + esc(field || c.id) + '</code></div></div>' +
      '<div class="typ">' + esc(DynaBoost.formDump.typeText(c)) + '</div>' +
      '<div class="val">' + cell(h, t, mh, true) + '</div>' +
      '<div class="val">' + cell(t, h, mt, false) + '</div>' +
      '</div>';
    return { html: html, st: st, diffs: diffs };
  }

  function formView(here, there, names) {
    const H = placesOf(here.dump);
    const T = placesOf(there.dump);
    const MH = marksOf(here.logic);
    const MT = marksOf(there.logic);
    const primaryId = here.dump.entity.primaryId;
    let same = 0;
    let total = 0;
    const lines = [];
    // Sections as this form has them; what only the other side has goes last.
    const sections = [];
    const bySec = new Map();
    const secOf = (p) => {
      const id = p.tab.name + '/' + p.sec.name;
      if (!bySec.has(id)) {
        const s = { id: id, tab: p.tab, sec: p.sec, keys: [] };
        bySec.set(id, s);
        sections.push(s);
      }
      return bySec.get(id);
    };
    for (const k of H.order) secOf(H.map.get(k)).keys.push(k);
    for (const k of T.order) if (!H.map.has(k)) secOf(T.map.get(k)).keys.push(k);
    let lastTab = null;
    const html = [];
    for (const s of sections) {
      if (lastTab !== s.tab.name) {
        if (lastTab !== null) html.push('</section>');
        lastTab = s.tab.name;
        const inThere = there.dump.tabs.some((t) => t.name === s.tab.name) || s.tab.name === 'header' || s.tab.name === 'footer';
        const inHere = here.dump.tabs.some((t) => t.name === s.tab.name) || s.tab.name === 'header' || s.tab.name === 'footer';
        html.push('<section class="tab"><h2>' + esc(s.tab.label || s.tab.name) + (!inThere ? '<span class="bd warn">not in ' + esc(names.there) + '</span>' : !inHere ? '<span class="bd">only in ' + esc(names.there) + '</span>' : '') + '<code>' + esc(s.tab.name) + '</code></h2>');
      }
      const rows = [];
      let diff = 0;
      for (const k of s.keys) {
        const h = H.map.get(k) || null;
        const t = T.map.get(k) || null;
        const c = (h || t).c;
        const mh = h && c.kind === 'field' ? MH[c.field] || null : null;
        const mt = t && c.kind === 'field' ? MT[c.field] || null : null;
        const row = fieldRow(k, h, t, mh, mt, names, primaryId);
        rows.push(row.html);
        const sys = c.kind === 'field' && isSystem(c.field, primaryId);
        if (!sys) {
          total++;
          if (row.st === 'same') same++;
          else {
            diff++;
            lines.push('[Form] ' + (c.label || c.displayName || c.id) + ' (' + (c.field || c.id) + ') — ' + (row.st === 'miss' ? 'only in ' + names.here + ', not on the form in ' + names.there : row.st === 'only' ? 'only in ' + names.there : row.diffs.map((d) => d.what + ': ' + d.here + ' / ' + d.there).join('; ')));
          }
        }
      }
      html.push(
        '<div class="sec" data-alleq="' + (diff ? '0' : '1') + '"><h3>' + esc(s.sec.label || s.sec.name) + (s.sec.name !== s.tab.name ? '<code>' + esc(s.sec.name) + '</code>' : '') +
          '<span class="sec-n">' + (diff ? diff + ' of ' + s.keys.length + ' differ' : 'all ' + s.keys.length + ' the same') +
          '<button type="button" class="chev" data-chev aria-expanded="false">' + (diff ? 'show all' : 'show') + ' ›</button></span></h3>' +
          rows.join('') + '</div>'
      );
    }
    if (lastTab !== null) html.push('</section>');
    return { html: html.join(''), same: same, total: total, lines: lines };
  }

  function optionsText(c) {
    return c && c.options ? c.options.join(', ') : '';
  }

  function columnsView(here, there, names, primaryId) {
    const keys = Array.from(new Set(Object.keys(here.columns).concat(Object.keys(there.columns))))
      .filter((f) => !(here.columns[f] || there.columns[f]).of)
      .sort();
    let same = 0;
    let total = 0;
    const lines = [];
    const rows = keys.map((f) => {
      const h = here.columns[f];
      const t = there.columns[f];
      const diffs = [];
      if (h && t) {
        if (h.type !== t.type) diffs.push(['Type', h.type, t.type]);
        if (h.requiredLevel !== t.requiredLevel) diffs.push(['Required', required(h.requiredLevel), required(t.requiredLevel)]);
        if ((h.displayName || '') !== (t.displayName || '')) diffs.push(['Name', h.displayName, t.displayName]);
        if (optionsText(h) !== optionsText(t)) diffs.push(['Options', (h.options || []).length + ' options', (t.options || []).length + ' options']);
        if ((h.targets || []).join() !== (t.targets || []).join()) diffs.push(['Targets', (h.targets || []).join(', '), (t.targets || []).join(', ')]);
      }
      const st = !t ? 'miss' : !h ? 'only' : diffs.length ? 'diff' : 'same';
      const sys = isSystem(f, primaryId);
      if (!sys) {
        total++;
        if (st === 'same') same++;
        else lines.push('[Column] ' + f + ' — ' + (st === 'miss' ? 'not in ' + names.there : st === 'only' ? 'only in ' + names.there : diffs.map((d) => d[0] + ': ' + d[1] + ' / ' + d[2]).join('; ')));
      }
      const one = h || t;
      const cell = (side, isHere) => {
        if (!side) return '<span class="pill none">no such column</span>';
        if (st === 'same') return '<span class="pill same">the same</span>';
        if (st !== 'diff') return kv('Required', required(side.requiredLevel)) + (side.options ? kv('Options', side.options.length) : '');
        return diffs.map((d) => kv(d[0], isHere ? d[1] : d[2], true)).join('');
      };
      return (
        '<div class="row cmp st-' + st + '" data-st="' + (st === 'same' ? 'same' : 'diff') + '" data-s="' + esc((f + ' ' + (one.displayName || '')).toLowerCase()) + '"' + (sys ? ' data-sys="1"' : '') + '>' +
        '<div class="lbl"><code>' + esc(f) + '</code>' + onlyTag(st, names) + '<div class="sub">' + esc(one.displayName || '') + (one.custom ? '' : ' · standard') + '</div></div>' +
        '<div class="typ">' + esc(String(one.type || '').replace(/Type$/, '')) + '</div>' +
        '<div class="val">' + cell(h, true) + '</div><div class="val">' + cell(t, false) + '</div></div>'
      );
    });
    return { html: '<div class="sec" data-alleq="0"><h3>Columns<span class="sec-n">' + (total - same) + ' of ' + total + ' differ</span></h3>' + rows.join('') + '</div>', same: same, total: total, lines: lines };
  }

  // The logic, kind by kind, matched by name: there or not, on or off.
  // A name as the matching sees it: as written, any case. Two names that
  // differ in anything else are two things - one here, one there.
  const loose = (s) => String(s || '').trim().toLowerCase();

  function logicItems(logic) {
    const out = { js: [], rule: [], wf: [], plug: [], flow: [] };
    if (!logic || logic.error) return out;
    const s = logic.scripts || {};
    for (const l of s.libraries || []) out.js.push({ key: 'lib:' + String(l.name).toLowerCase(), name: l.name, what: 'Library' });
    for (const h of s.handlers || []) {
      const target = h.target ? (h.target.kind === 'field' ? h.target.name : h.target.kind) : 'form';
      out.js.push({ key: 'h:' + [h.event, target, h.library, h.function].join('|').toLowerCase(), name: h.function + ' (' + h.event + (target !== 'form' ? ' · ' + target : '') + ')', what: h.library, on: h.enabled !== false });
    }
    if (Array.isArray(logic.businessRules)) for (const r of logic.businessRules) out.rule.push({ key: loose(r.name), name: r.name, on: !!r.active });
    const a = logic.automations || {};
    if (Array.isArray(a.workflows)) for (const w of a.workflows) out.wf.push({ key: loose(w.kind) + ':' + loose(w.name), name: w.name, what: w.kind + (w.mode ? ' · ' + w.mode : ''), on: !!w.active });
    if (Array.isArray(a.pluginSteps)) for (const p of a.pluginSteps) out.plug.push({ key: loose(p.name) + '|' + loose(p.stage), name: p.name, what: p.stage + ' · ' + p.mode, on: !!p.active });
    if (Array.isArray(a.flows)) for (const f of a.flows) out.flow.push({ key: loose(f.name), name: f.name, on: !!f.active });
    return out;
  }

  function logicView(here, there, names) {
    const H = logicItems(here.logic);
    const T = logicItems(there.logic);
    const TITLE = { js: 'Scripts', rule: 'Business rules', wf: 'Classic workflows and processes', plug: 'Plug-in steps', flow: 'Cloud flows' };
    let same = 0;
    let total = 0;
    const lines = [];
    const html = [];
    const unread = (logic) => !logic || logic.error;
    if (unread(here.logic) || unread(there.logic)) {
      html.push('<div class="empty-note">The logic could not be read ' + (unread(here.logic) ? 'here' : 'in ' + esc(names.there)) + ': ' + esc(((unread(here.logic) ? here.logic : there.logic) || {}).error || 'no rights') + '</div>');
    }
    for (const k of ['js', 'rule', 'wf', 'plug', 'flow']) {
      const tm = new Map(T[k].map((x) => [x.key, x]));
      const hm = new Map(H[k].map((x) => [x.key, x]));
      const keys = H[k].map((x) => x.key).concat(T[k].map((x) => x.key).filter((x) => !hm.has(x)));
      if (!keys.length) continue;
      let diff = 0;
      const rows = keys.map((key) => {
        const h = hm.get(key);
        const t = tm.get(key);
        const st = !t ? 'miss' : !h ? 'only' : h.on !== t.on ? 'diff' : 'same';
        total++;
        if (st === 'same') same++;
        else {
          diff++;
          lines.push('[' + TITLE[k] + '] ' + (h || t).name + ' \u2014 ' + (st === 'miss' ? 'only in ' + names.here : st === 'only' ? 'only in ' + names.there : (h.on ? 'on' : 'off') + ' / ' + (t.on ? 'on' : 'off')));
        }
        const state = (x) => (x.on === undefined ? '<span class="pill same">there</span>' : '<span class="pill ' + (x.on ? 'on' : 'off') + '">' + (x.on ? 'On' : 'Off') + '</span>');
        const cell = (x) => (x ? state(x) : '<span class="pill none">not there</span>');
        const one = h || t;
        return (
          '<div class="row cmp st-' + st + '" data-st="' + (st === 'same' ? 'same' : 'diff') + '" data-s="' + esc((one.name + ' ' + (one.what || '')).toLowerCase()) + '">' +
          '<div class="lbl">' + esc(one.name) + onlyTag(st, names) + (one.what ? '<div class="sub">' + esc(one.what) + '</div>' : '') + '</div>' +
          '<div class="val">' + cell(h) + '</div><div class="val">' + cell(t) + '</div></div>'
        );
      });
      html.push(
        '<div class="sec" data-alleq="' + (diff ? '0' : '1') + '"><h3><span class="lg-h">' + DynaBoost.formLogic.icon(k) + esc(TITLE[k]) + '</span>' +
          '<span class="sec-n">' + (diff ? diff + ' of ' + keys.length + ' differ' : 'all ' + keys.length + ' the same') +
          '<button type="button" class="chev" data-chev aria-expanded="false">' + (diff ? 'show all' : 'show') + ' ›</button></span></h3>' + rows.join('') + '</div>'
      );
    }
    if (!html.length) html.push('<div class="empty-note">No scripts, rules, workflows, plug-in steps or cloud flows on either side.</div>');
    return { html: html.join(''), same: same, total: total, lines: lines };
  }

  function chip(view, label, r) {
    const diff = r.total - r.same;
    return '<button type="button" class="cmp-chip ' + (diff ? 'diff' : 'same') + '" data-go="' + view + '"><b>' + esc(label) + '</b>' + (diff ? diff + ' differ' : 'all the same') + ' · ' + r.same + ' of ' + r.total + ' match</button>';
  }

  function drawForm(tab, ctx, here, there, thereName) {
    const names = { here: ctx.hereName, there: thereName };
    const primaryId = here.dump.entity.primaryId;
    const F = formView(here, there, names);
    const C = columnsView(here, there, names, primaryId);
    const L = logicView(here, there, names);
    const doc = tab.document;
    const get = (id) => doc.getElementById(id);
    get('sum').innerHTML = '<div class="cmp-sum">' + chip('form', 'Form', F) + chip('columns', 'Columns', C) + chip('logic', 'Logic', L) + '</div>';
    get('bar').innerHTML =
      '<button class="primary" id="copy">Copy differences</button>' +
      '<span class="seg" role="group" aria-label="View"><button data-view="form" aria-pressed="true">Form</button><button data-view="columns" aria-pressed="false">Columns</button><button data-view="logic" aria-pressed="false">Logic</button></span>' +
      '<label><input type="checkbox" id="only-diff" checked> only differences</label>' +
      '<label title="Created and modified on and by, owner, version number and the like"><input type="checkbox" id="hide-sys" checked> hide system fields</label>' +
      '<input type="search" id="q" placeholder="Filter by name or label">' +
      '<span class="status" id="status"></span>';
    get('content').innerHTML =
      '<div class="cmp-cols"><span>Field</span><span class="ty">Type</span><span>' + esc(names.here) + '<span class="here">here</span></span><span>' + esc(names.there) + '</span></div>' +
      '<div id="v-form">' + F.html + '</div><div id="v-columns">' + C.html + '</div><div id="v-logic">' + L.html + '</div>';
    doc.body.classList.add('view-form');
    const lines = F.lines.concat(C.lines, L.lines);
    get('status').textContent = lines.length ? lines.length + ' differences' : 'No differences';
    wireView(tab, () => [names.here + ' ↔ ' + names.there + ' — ' + ctx.entityLabel + ' (' + ctx.entity + '), form ' + here.dump.form.name, ''].concat(lines.length ? lines : ['No differences.']).join('\n'), ['form', 'columns', 'logic']);
  }

  // The toolbar of a result tab: views, the two switches, the filter, copy.
  function wireView(tab, text, views) {
    const doc = tab.document;
    const get = (id) => doc.getElementById(id);
    const show = (v) => {
      for (const x of views) doc.body.classList.toggle('view-' + x, x === v);
      doc.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === v)));
      const head = doc.querySelector('.cmp-cols span');
      if (head) head.textContent = v === 'logic' ? 'Item' : v === 'columns' ? 'Column' : 'Field';
    };
    doc.addEventListener('click', async (e) => {
      const v = e.target.closest('[data-view],[data-go]');
      if (v) return show(v.getAttribute('data-view') || v.getAttribute('data-go'));
      const ch = e.target.closest('[data-chev]');
      if (ch) {
        const sec = ch.closest('.sec');
        const open = sec.classList.toggle('open');
        ch.setAttribute('aria-expanded', String(open));
        ch.textContent = (open ? 'hide' : sec.getAttribute('data-alleq') === '1' ? 'show' : 'show all') + (open ? ' ‹' : ' ›');
        return;
      }
      if (e.target.id === 'copy') {
        const btn = e.target;
        let ok = false;
        try {
          await tab.navigator.clipboard.writeText(text());
          ok = true;
        } catch (err) {
          ok = false;
        }
        btn.textContent = ok ? CHECK + ' Copied' : 'Copy failed';
        setTimeout(() => (btn.textContent = 'Copy differences'), 2000);
      }
    });
    if (get('only-diff')) get('only-diff').addEventListener('change', (e) => doc.body.classList.toggle('only-diff', e.target.checked));
    if (get('hide-sys')) get('hide-sys').addEventListener('change', (e) => doc.body.classList.toggle('hide-sys', e.target.checked));
    get('q').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      doc.querySelectorAll('.row.cmp').forEach((r) => (r.style.display = !q || (r.getAttribute('data-s') || '').indexOf(q) >= 0 ? '' : 'none'));
    });
  }

  // ---------- Compare records ----------

  function valueOf(record, f, columns) {
    const look = '_' + f + '_value';
    const isLookup = look in record;
    const raw = isLookup ? record[look] : record[f];
    const shown = record[(isLookup ? look : f) + FMT];
    return { raw: raw === undefined ? null : raw, shown: shown !== undefined && shown !== null ? shown : raw === undefined || raw === null ? '' : String(raw), lookup: isLookup, type: (columns[f] || {}).type };
  }

  function fieldsOfRecord(record) {
    const out = new Set();
    for (const k of Object.keys(record || {})) {
      if (k.indexOf('@') >= 0) continue;
      out.add(k.startsWith('_') && k.endsWith('_value') ? k.slice(1, -6) : k);
    }
    return out;
  }

  async function runRecords(tab, ctx, job, thereName, retry) {
    const env = job.env;
    const steps = stepper(tab);
    const s1 = steps.step('Reading this record (' + ctx.hereName + ')');
    const here = await read({ op: 'record', entity: ctx.entity, id: job.id1, lcid: ctx.lcid });
    if (tab.closed) return;
    if (!here || here.error) return s1.bad('Could not read this record', (here && here.error) || '');
    if (here.missing === 'record') return s1.bad('There is no ' + ctx.entity + ' with the id ' + job.id1 + ' here');
    s1.ok('This record: ' + (here.record[here.primaryName] || job.id1));
    const s2 = steps.step('Reading the other record in ' + thereName);
    const r = await readAt(env.host, { op: 'record', entity: ctx.entity, id: job.id2, lcid: ctx.lcid });
    if (tab.closed) return;
    if (r.error) return failed(tab, steps, s2, env, r.error, retry);
    const there = r.result;
    if (there.missing === 'table') return s2.bad('There is no table ' + ctx.entity + ' in ' + thereName);
    if (there.missing === 'record') return s2.bad('There is no ' + ctx.entity + ' with the id ' + job.id2 + ' in ' + thereName, 'Check the id - or the environment: a record keeps its id only within one environment.');
    s2.ok('Other record: ' + (there.record[there.primaryName] || job.id2) + (env.host === location.hostname ? '' : ' (' + thereName + ')'));
    drawRecords(tab, ctx, job, here, there, thereName);
    DynaBoost.saved('compare', 'record');
  }

  function drawRecords(tab, ctx, job, here, there, thereName) {
    const sameEnv = job.env.host === location.hostname;
    const names = { here: sameEnv ? 'This record' : ctx.hereName, there: sameEnv ? 'Other record' : thereName };
    const columns = Object.assign({}, there.columns, here.columns);
    const primaryId = Object.keys(columns).find((f) => columns[f].primary) || ctx.entity + 'id';
    const keys = Array.from(new Set(Array.from(fieldsOfRecord(here.record)).concat(Array.from(fieldsOfRecord(there.record)))))
      .filter((f) => columns[f] && !columns[f].of)
      .sort((a, b) => String(columns[a].displayName || a).localeCompare(String(columns[b].displayName || b)));
    let same = 0;
    let total = 0;
    const lines = [];
    const rows = keys.map((f) => {
      const inH = fieldsOfRecord(here.record).has(f);
      const inT = fieldsOfRecord(there.record).has(f);
      const a = valueOf(here.record, f, columns);
      const b = valueOf(there.record, f, columns);
      // Another environment has other ids: a lookup matches by the name it shows.
      const eq = a.lookup && !sameEnv ? a.shown === b.shown : JSON.stringify(a.raw) === JSON.stringify(b.raw);
      const st = !inT ? 'miss' : !inH ? 'only' : eq ? 'same' : 'diff';
      const sys = isSystem(f, primaryId);
      if (!sys) {
        total++;
        if (st === 'same') same++;
        else lines.push((columns[f].displayName || f) + ' (' + f + '): ' + (a.shown || '–') + ' / ' + (b.shown || '–'));
      }
      const cell = (v, has) => {
        if (!has) return '<span class="pill none">no such column</span>';
        if (v.raw === null || v.raw === '') return '<span class="nil">empty</span>';
        return '<span class="txt">' + esc(v.shown) + '</span>' + (v.lookup || (v.shown !== String(v.raw) && v.raw !== null) ? '<div class="sub"><code>' + esc(v.raw) + '</code></div>' : '');
      };
      const c = columns[f];
      return (
        '<div class="row cmp st-' + st + '" data-st="' + (st === 'same' ? 'same' : 'diff') + '" data-s="' + esc((f + ' ' + (c.displayName || '') + ' ' + a.shown + ' ' + b.shown).toLowerCase()) + '"' + (sys ? ' data-sys="1"' : '') + '>' +
        '<div class="lbl">' + esc(c.displayName || f) + onlyTag(st, names) + '<div class="sub"><code>' + esc(f) + '</code></div></div>' +
        '<div class="typ">' + esc(String(c.type || '').replace(/Type$/, '')) + '</div>' +
        '<div class="val">' + cell(a, inH) + '</div><div class="val">' + cell(b, inT) + '</div></div>'
      );
    });
    const doc = tab.document;
    const get = (id) => doc.getElementById(id);
    const R = { same: same, total: total };
    const nameOf = (side) => side.record[side.primaryName] || '';
    get('sum').innerHTML = '<div class="cmp-sum">' + chip('values', 'Values', R) + '</div>';
    get('bar').innerHTML =
      '<button class="primary" id="copy">Copy differences</button>' +
      '<label><input type="checkbox" id="only-diff" checked> only differences</label>' +
      '<label title="Created and modified on and by, owner, version number and the like"><input type="checkbox" id="hide-sys" checked> hide system fields</label>' +
      '<input type="search" id="q" placeholder="Filter by name, label or value">' +
      '<span class="status" id="status">' + (lines.length ? lines.length + ' differences' : 'No differences') + '</span>';
    get('content').innerHTML =
      '<div class="cmp-cols"><span>Field</span><span class="ty">Type</span><span>' + esc(names.here) + ' · ' + esc(nameOf(here)) + (sameEnv ? '' : '<span class="here">here</span>') + '</span><span>' + esc(names.there) + ' · ' + esc(nameOf(there)) + '</span></div>' +
      '<div id="v-values"><div class="sec" data-alleq="0"><h3>' + esc(ctx.entityLabel) + '<span class="sec-n">' + (total - same) + ' of ' + total + ' differ</span></h3>' + rows.join('') + '</div></div>';
    wireView(tab, () => [ctx.entityLabel + ': ' + nameOf(here) + ' (' + names.here + ') / ' + nameOf(there) + ' (' + names.there + ')', ''].concat(lines.length ? lines : ['No differences.']).join('\n'), ['values']);
  }

  // ---------- the tiles ----------

  async function contextHere() {
    const fc = DynaBoost.formContext ? await DynaBoost.formContext(1500) : null;
    const q = params();
    const entity = (fc && fc.entity) || q.get('etn');
    if (!entity) return null;
    const list = ((await stored(ENV_LIST_KEY, null)) || { list: [] }).list || [];
    const me = list.find((e) => e.host === location.hostname);
    let entityLabel = entity;
    try {
      const res = await fetch("/api/data/v9.2/EntityDefinitions(LogicalName='" + encodeURIComponent(entity) + "')?$select=DisplayName", { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (res.ok) entityLabel = DynaBoost.formDump.label((await res.json()).DisplayName, (fc && fc.lcid) || 1033) || entity;
    } catch (e) {
      /* the logical name does */
    }
    return {
      entity: entity,
      entityLabel: entityLabel,
      id: clean((fc && fc.id) || q.get('id')),
      formId: clean((fc && fc.formId) || q.get('formid')),
      formName: (fc && fc.formName) || null,
      recordName: (fc && fc.recordName) || null,
      lcid: (fc && fc.lcid) || 1033,
      hereName: me ? me.name : location.hostname.split('.')[0]
    };
  }

  async function start() {
    const ctx = await contextHere();
    if (!ctx) {
      DynaBoost.toast('Compare', 'Open a record form first.', true);
      return;
    }
    openCompare(ctx);
  }

  DynaBoost.register({
    id: 'compare',
    name: 'Compare',
    group: 'Records',
    hosts: ['dynamics.com'],
    when: onRecord,
    type: 'action',
    hint: 'This form or record against another environment - or two records',
    icon: ICON_CONFIG,
    onRun: start
  });
})();
