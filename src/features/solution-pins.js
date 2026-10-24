/* Feature: My shortcuts - shortcuts to solutions and apps at the top of the
 * panel, six in all. A solution's shortcut is its address (environment id
 * + solution id), an app's is the address it opens at (a model-driven app
 * in Dynamics 365, a canvas app in the player), so a name can be changed;
 * one per solution or app. Solutions are marked gold, apps blue.
 *
 * Pinned from where you are: a solution page pins the solution - or, when
 * the solution holds apps (solution-apps-hook.js), a small list offers it
 * and its apps; an app ticked in the solution's list is pinned at once. An
 * open model-driven app pins itself. Anywhere, a pasted link to a solution
 * or an app. Three slots, six once the first three are full. Stored in
 * chrome.storage.sync (key unchanged: dynaboost.solutionPins), the fold
 * state in chrome.storage.local. On Azure DevOps a shortcut opens in a new
 * tab.
 */
(function () {
  if (DynaBoost.off) return;
  const STORE_KEY = 'dynaboost.solutionPins';
  const FOLD_KEY = 'dynaboost.solutionPinsFolded';
  const MAX = 6;
  const ROW = 3;
  const MAKERS = ['https://make.powerapps.com', 'https://make.powerautomate.com'];

  // .../environments/{env}/solutions/{solution}. The default environment's id
  // is "Default-<guid>", so the environment part is not a bare GUID.
  const SOLUTION_URL = /\/environments\/([^/?#]+)\/solutions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const DYNAMICS = /^[a-z0-9-]+\.crm[0-9]*\.dynamics\.com$/i;
  const PLAYER = 'https://apps.powerapps.com';
  const KIND = { model: 'Model-driven app', canvas: 'Canvas app' };
  const isApp = (p) => !!p && p.kind === 'app';

  let pins = []; // slot index -> pin or null
  let folded = false;
  let flash = []; // slots to highlight briefly (already pinned)
  let notice = ''; // a line under the header, for a few seconds
  let noticeTimer = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function clean(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  // Every site DynaBoost runs on shows the section.
  function applies() {
    return true;
  }

  // Azure DevOps is a different app: a solution opens beside it, not over it.
  function elsewhere() {
    const host = location.hostname.toLowerCase();
    return host === 'dev.azure.com' || host.endsWith('.visualstudio.com');
  }

  // ---------- the apps a solution holds (solution-apps-hook.js) ----------

  let solutionApps = []; // { sol, id, name, type, host }
  const opensAt = new Map(); // app id -> the address the Power Apps API gave
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'dynaboost-solution-apps') return;
    if (Array.isArray(e.data.apps)) solutionApps = e.data.apps;
    if (Array.isArray(e.data.opens)) e.data.opens.forEach(([id, uri]) => opensAt.set(id, uri));
  });
  if (location.hostname === 'make.powerapps.com') window.postMessage({ source: 'dynaboost-solution-apps-ask' }, location.origin);

  // An app of a solution as a shortcut.
  function appRef(a, env) {
    const url =
      a.type === 'model'
        ? 'https://' + a.host + '/main.aspx?' + (a.unique ? 'appname=' + encodeURIComponent(a.unique) : 'appid=' + a.id)
        : opensAt.get(a.id) || PLAYER + '/play/e/' + encodeURIComponent(env) + '/a/' + a.id;
    return { kind: 'app', type: a.type, env: env, app: a.id, url: url, solName: a.name };
  }

  /* The apps the solution's list shows on the page, for when the portal's
   * answer went by unseen: a model-driven app's row gives its unique name
   * (the Name column), which opens it - main.aspx?appname=... - in the
   * environment's Dynamics 365. Canvas apps need their id: not from here. */
  function appsOnPage(host) {
    if (!host) return [];
    const out = [];
    for (const row of document.querySelectorAll('[role="row"]')) {
      const texts = Array.from(row.querySelectorAll('[role="gridcell"], [role="rowheader"]'))
        .map((c) => clean(c.textContent))
        .filter(Boolean);
      if (!texts.some((t) => /^model-driven app$/i.test(t))) continue;
      const unique = texts.find((t) => /^[a-z0-9]{2,8}_[a-z0-9_]+$/i.test(t));
      const name = texts.find((t) => t !== unique && /\p{L}/u.test(t) && !/^(model-driven app|canvas app|yes|no)$/i.test(t));
      if (unique && name) out.push({ id: unique.toLowerCase(), unique: unique, name: name, type: 'model', host: host });
    }
    return out;
  }

  // The rows ticked in the solution's list, by their text.
  function tickedRows() {
    const rows = document.querySelectorAll('[role="row"][aria-selected="true"], [role="row"]:has([role="checkbox"][aria-checked="true"]), [role="row"]:has(input[type="checkbox"]:checked)');
    return Array.from(new Set(rows))
      .filter((r) => !r.querySelector('[role="columnheader"]'))
      .map((r) => clean(r.textContent).toLowerCase());
  }

  // ---------- storage ----------

  // Drawn, not typed: a ✎ or ✕ sits off centre in most fonts.
  const PEN =
    '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 10l.6-2.4L8.2 2a1 1 0 0 1 1.4 0l.4.4a1 1 0 0 1 0 1.4L4.4 9.4z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  const CROSS = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  // The App designer: a window with its parts laid out.
  const DESIGN =
    '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="2" width="9" height="8" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M1.5 4.6h9M4.4 4.6V10" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
  // Only a model-driven app opens in the App designer from here.
  const designable = (p) => isApp(p) && p.type === 'model';

  function normalise(list) {
    const out = [];
    for (let i = 0; i < MAX; i++) out.push((list && list[i]) || null);
    return out;
  }

  function save() {
    // Trailing empty slots are not stored.
    let last = pins.length;
    while (last > 0 && !pins[last - 1]) last--;
    chrome.storage.sync.set({ [STORE_KEY]: pins.slice(0, last) });
    DynaBoost.refresh();
  }

  function setFolded(v) {
    folded = v;
    chrome.storage.local.set({ [FOLD_KEY]: v });
    DynaBoost.refresh();
  }

  // ---------- addresses and names ----------

  /* A solution in the maker portals, a model-driven app in Dynamics 365
   * (main.aspx?appid=...), or a canvas app in the player
   * (apps.powerapps.com/play/e/{env}/a/{id}). */
  function parseLink(text) {
    let url;
    try {
      url = new URL(String(text || '').trim());
    } catch (e) {
      return null;
    }
    if (MAKERS.indexOf(url.origin) >= 0) {
      const m = url.pathname.match(SOLUTION_URL);
      return m ? { origin: url.origin, env: m[1], sol: m[2].toLowerCase() } : null;
    }
    if (url.protocol === 'https:' && DYNAMICS.test(url.hostname)) {
      const app = String(url.searchParams.get('appid') || '').replace(/[{}]/g, '').toLowerCase();
      const host = url.hostname.toLowerCase();
      const unique = String(url.searchParams.get('appname') || '');
      if (!GUID.test(app) && /^[a-z0-9]{2,8}_[a-z0-9_]+$/i.test(unique)) {
        return { kind: 'app', type: 'model', env: host, app: unique.toLowerCase(), url: 'https://' + host + '/main.aspx?appname=' + encodeURIComponent(unique) };
      }
      if (!GUID.test(app)) return null;
      return { kind: 'app', type: 'model', env: host, app: app, url: 'https://' + host + '/main.aspx?appid=' + app };
    }
    if (url.origin === PLAYER) {
      const m = url.pathname.match(/\/play\/(?:e\/([^/]+)\/a\/)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (!m) return null;
      const tenant = url.searchParams.get('tenantId');
      const app = m[2].toLowerCase();
      return {
        kind: 'app',
        type: 'canvas',
        env: m[1] ? decodeURIComponent(m[1]) : '',
        app: app,
        url: PLAYER + url.pathname.replace(/\/+$/, '') + (tenant ? '?tenantId=' + encodeURIComponent(tenant) : '')
      };
    }
    return null;
  }

  function urlOf(pin) {
    return isApp(pin) ? pin.url : pin.origin + '/environments/' + pin.env + '/solutions/' + pin.sol;
  }

  // Suggestions only - ✎ changes them.
  function guessEnvName(env) {
    const known = pins.find((p) => p && p.env === env);
    if (known) return known.envName;
    const cands = document.querySelectorAll(
      'button[aria-label*="nvironment"], [data-test-id*="nvironment"], [id*="nvironmentPicker"], [class*="nvironmentPicker"], [class*="environment-picker"]'
    );
    for (const el of cands) {
      const text = clean(el.getAttribute('aria-label') || el.textContent)
        .replace(/^(current\s+)?environment\s*[:,\-]?\s*/i, '')
        .replace(/\s*(environment picker|change environment)$/i, '');
      if (text && text.length < 80) return text;
    }
    return '';
  }

  // The solution pages repeat their own titles for screen readers, so a
  // heading reads "OverviewOverview" or "AllAll". Keep one copy.
  function undouble(text) {
    const t = clean(text);
    const half = t.length / 2;
    return t.length % 2 === 0 && t.slice(0, half) === t.slice(half) ? t.slice(0, half) : t;
  }

  // Names of the pages inside a solution - never the solution's own name.
  const SUBPAGES = /^(overview|objects|history|all|solution|solutions|power apps|power automate)$/i;

  function usable(text) {
    const t = undouble(text);
    return t && t.length < 120 && !SUBPAGES.test(t) ? t : '';
  }

  /* On a solution page the left pane reads "Back to solutions", then the
   * solution's name, then Overview, Objects, History. The heading is the
   * sub-page, so it is not used. Breadcrumbs, when there are any, start with
   * the solution. */
  function guessSolutionName() {
    const back = Array.from(document.querySelectorAll('a, button, [role="link"], [role="button"]')).find((el) =>
      // An arrow may come before it, as an icon or a character.
      /^\W*back to solutions$/i.test(clean(el.textContent))
    );
    if (back) {
      // Walk the text after the back link, in document order, inside the pane.
      const pane = back.closest('nav, aside, [role="navigation"], [class*="nav" i], [class*="pane" i]') || back.parentElement.parentElement || document.body;
      const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
      let passed = false;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!passed) {
          if (back.contains(n)) passed = true;
          continue;
        }
        if (back.contains(n)) continue;
        const name = usable(n.textContent);
        if (name) return name;
      }
    }
    const crumbs = document.querySelectorAll('[aria-label*="readcrumb" i] li, [class*="readcrumb" i] li, [class*="readcrumb" i] [class*="item" i]');
    if (crumbs.length > 1) {
      const name = usable(crumbs[0].textContent);
      if (name) return name;
    }
    const title = usable(clean(document.title).split(/\s[|–—-]\s/)[0]);
    return title;
  }

  // ---------- pinning ----------

  /* Duplicates are found by address - environment id and solution id - never
   * by name, so a shortcut you renamed is still recognised. */
  function twinOf(ref, except) {
    return pins.findIndex((p, i) =>
      !p || i === except ? false : isApp(ref) ? isApp(p) && sameApp(p, ref) : !isApp(p) && p.env.toLowerCase() === ref.env.toLowerCase() && p.sol === ref.sol
    );
  }

  /* One app, however it was pinned: by its id, its address - or, as an app
   * found by its id one time and by its unique name another, by its kind,
   * environment and name. */
  function sameApp(a, b) {
    if (a.app === b.app || a.url === b.url) return true;
    const host = (p) => {
      try {
        return new URL(p.url).hostname.toLowerCase();
      } catch (e) {
        return '';
      }
    };
    const name = (p) => clean(p.solName).toLowerCase();
    return a.type === b.type && !!name(a) && name(a) === name(b) && (host(a) === host(b) || String(a.env).toLowerCase() === String(b.env).toLowerCase());
  }

  function nameOf(pin) {
    return pin.envName + ' \u00b7 ' + pin.solName;
  }

  /* Already pinned: each shortcut it is lights up (a solution gold, an app
   * blue) and the line under the header names them all. */
  function showDuplicate(slots) {
    flash = [].concat(slots).filter((i) => i >= 0 && pins[i]);
    if (!flash.length) return;
    const names = flash.map((i) => '\u201c' + pins[i].solName + '\u201d');
    notice =
      flash.length === 1
        ? 'Already pinned as \u201c' + nameOf(pins[flash[0]]) + '\u201d.'
        : 'All already pinned: ' + names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] + '.';
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      flash = [];
      notice = '';
      DynaBoost.refresh();
    }, 3500);
    DynaBoost.refresh();
  }

  /* The open model-driven app, here in Dynamics 365: its address, and its
   * name and the environment's from the environment itself. */
  function appHere() {
    if (!DYNAMICS.test(location.hostname)) return null;
    return parseLink(location.href);
  }

  async function namesOfAppHere(ref) {
    const get = (path) =>
      fetch('/api/data/v9.2/' + path, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null));
    const [app, org] = await Promise.all([
      get('appmodules(' + ref.app + ')?$select=name').catch(() => null),
      get("RetrieveCurrentOrganization(AccessType=@p)?@p=Microsoft.Dynamics.CRM.EndpointAccessType'Default'").catch(() => null)
    ]);
    const d = (org && org.Detail) || {};
    return { solName: clean(app && app.name), envName: clean(d.FriendlyName) || (await envNameOfHost(ref.env)) };
  }

  // The environment's Dataverse address, by its id, from the same list.
  function hostOfEnv(id) {
    const k = String(id || '').toLowerCase();
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get('dynaboost.environments', (d) => {
          const list = ((d && d['dynaboost.environments']) || {}).list || [];
          const hit = list.find((e) => e && String(e.id).toLowerCase() === k);
          resolve(hit ? String(hit.host).toLowerCase() : '');
        });
      } catch (e) {
        resolve('');
      }
    });
  }

  // The environment's name as make.powerapps.com listed it (env-compare.js
  // keeps it), by its Dataverse address or its id.
  function envNameOfHost(key) {
    const k = String(key || '').toLowerCase();
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get('dynaboost.environments', (d) => {
          const list = ((d && d['dynaboost.environments']) || {}).list || [];
          const hit = list.find((e) => e && (String(e.host).toLowerCase() === k || String(e.id).toLowerCase() === k));
          resolve(hit ? hit.name : '');
        });
      } catch (e) {
        resolve('');
      }
    });
  }

  // A shortcut into a slot: named by the page, or asked for when it did not say.
  function place(slot, ref) {
    const twin = twinOf(ref);
    if (twin >= 0) return showDuplicate(twin); // one shortcut each - drag it to move it
    if (!ref.envName || !ref.solName) return openDialog(slot, ref);
    pins[slot] = ref;
    save();
  }

  /* Pin what this page is: an open app, a solution - or, in a solution that
   * holds apps, the app ticked in its list, else a choice of the solution
   * and its apps next to where you clicked. */
  async function pinAt(slot, anchor) {
    const app = appHere();
    if (app) {
      if (twinOf(app) >= 0) return showDuplicate(twinOf(app));
      return place(slot, Object.assign(app, await namesOfAppHere(app)));
    }
    const here = parseLink(location.href);
    if (!here) return openDialog(slot, null);
    const sol = Object.assign(here, { envName: guessEnvName(here.env) || (await envNameOfHost(here.env)), solName: guessSolutionName() });
    const seen = solutionApps.filter((a) => a.sol === here.sol);
    // What the page's list shows and the portal's answer did not.
    const host = (seen[0] && seen[0].host) || (await hostOfEnv(here.env));
    const listed = appsOnPage(host).filter((a) => !seen.some((b) => b.name.toLowerCase() === a.name.toLowerCase()));
    const apps = seen.concat(listed).map((a) => Object.assign(appRef(a, here.env), { envName: sol.envName }));
    if (!apps.length) return place(slot, sol);
    const ticked = tickedRows();
    const picked = apps.filter((a) => ticked.some((t) => t.includes(a.solName.toLowerCase())));
    if (ticked.length === 1 && picked.length === 1) return place(slot, picked[0]);
    // Only what is not pinned yet: one left is pinned at once, more are offered.
    const all = [sol].concat(apps);
    const free = all.filter((r) => twinOf(r) < 0);
    if (!free.length) return showDuplicate(all.map((r) => twinOf(r)));
    if (free.length === 1) return place(slot, free[0]);
    chooser(anchor, slot, free);
  }

  /* The small list next to the click: the solution (gold), then its apps
   * (blue) - one click pins, Escape or a click elsewhere closes. */
  /* A small list next to what was clicked, in the panel: a title, then
   * rows. Escape or a click elsewhere closes it. */
  function popover(anchor, title) {
    const root = document.getElementById('dynaboost-root');
    if (!root || !anchor) return null;
    const old = root.querySelector('.db-pick');
    if (old) old.remove();
    const box = document.createElement('div');
    box.className = 'db-pick';
    box.setAttribute('role', 'menu');
    box.innerHTML = '<div class="db-pick-h">' + esc(title) + '</div><div class="db-pick-body"></div>';
    root.appendChild(box);
    // Under what was clicked, its right edge with the click's - and always
    // inside the panel.
    const a = anchor.getBoundingClientRect();
    const r = root.getBoundingClientRect();
    const w = box.offsetWidth;
    box.style.top = Math.round(a.bottom - r.top + 4) + 'px';
    box.style.left = Math.round(Math.min(Math.max(8, a.right - r.left - w), r.width - w - 8)) + 'px';
    const close = () => {
      box.remove();
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('keydown', onKey, true);
    };
    const outside = (e) => {
      if (!box.contains(e.target)) close();
    };
    // Escape closes the list, not the panel under it.
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      close();
    };
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', onKey, true);
    return { box: box, body: box.querySelector('.db-pick-body'), close: close };
  }

  function chooser(anchor, slot, refs) {
    const pop = popover(anchor, 'Pin to My shortcuts');
    if (!pop) return place(slot, refs[0]);
    const { box, close } = pop;
    pop.body.innerHTML =
      refs
        .map(
          (r, i) =>
            '<button type="button" role="menuitem" class="db-pick-row' + (isApp(r) ? ' db-pick-app' : '') + '" data-i="' + i + '">' +
            '<span class="db-pick-name">' + esc(r.solName || 'This solution') + '</span>' +
            '<span class="db-pick-kind">' + (isApp(r) ? KIND[r.type] : 'Solution') + '</span></button>'
        )
        .join('');
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (!b || b.disabled) return;
      close();
      place(slot, refs[Number(b.dataset.i)]);
    });
    const first = box.querySelector('.db-pick-row:not([disabled])');
    if (first) first.focus();
  }

  function firstFree() {
    return pins.findIndex((p) => !p);
  }

  // ---------- a model-driven app in the App designer ----------

  const DEFAULT_SOLUTION = 'fd140aaf-4df4-11dd-bd17-0019b9312238';
  const WHY = {
    signin: 'Sign in to this environment in a tab first, then try again.',
    unreachable: 'The environment could not be reached.'
  };

  /* The solutions the app is in - read in a tab of its environment
   * (background.js) - next to its ✎: yours first, then the Default
   * Solution, then the managed ones; a click opens the App designer in it. */
  async function designer(anchor, pin) {
    const pop = popover(anchor, 'Open in App designer');
    if (!pop) return;
    if (DynaBoost.status) DynaBoost.status.inPage();
    pop.body.innerHTML = '<div class="db-pick-busy">' + (DynaBoost.status ? DynaBoost.status.html('busy') : '') + '<span>Finding the solutions it is in\u2026</span></div>';
    let got;
    try {
      got = await chrome.runtime.sendMessage({ type: 'DB_ENV_APP_SOLUTIONS', host: new URL(pin.url).hostname, app: pin.app });
    } catch (e) {
      got = { error: e.message };
    }
    if (!pop.box.isConnected) return;
    const r = got && got.result;
    if (!r) {
      pop.body.innerHTML = '<div class="db-pick-note">' + esc(WHY[got && got.error] || (got && got.error) || 'No answer.') + '</div>';
      return;
    }
    const clean8 = (g) => String(g || '').replace(/[{}]/g, '').toLowerCase();
    const seen = new Set();
    const list = r.solutions
      .filter((x) => x.isvisible !== false && x.uniquename !== 'Active' && !seen.has(clean8(x.solutionid)) && seen.add(clean8(x.solutionid)))
      .map((x) => {
        const id = clean8(x.solutionid);
        const isDefault = x.uniquename === 'Default' || id === DEFAULT_SOLUTION;
        return { id: id, name: x.friendlyname || x.uniquename, version: x.version || '', managed: !!x.ismanaged && !isDefault, isDefault: isDefault };
      });
    if (!list.some((x) => x.isDefault)) list.push({ id: DEFAULT_SOLUTION, name: 'Default Solution', version: '', managed: false, isDefault: true });
    const rank = (x) => (x.managed ? 2 : x.isDefault ? 1 : 0);
    list.sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)));
    pop.body.innerHTML = list
      .map(
        (x, i) =>
          '<button type="button" role="menuitem" class="db-pick-row' + (x.managed ? ' db-pick-managed' : '') + '" data-i="' + i + '"' +
          ' title="' + (x.managed ? 'Managed - opens to look; changes belong in an unmanaged solution' : x.isDefault ? 'A change made here is in none of your solutions' : 'Open in this solution') + '">' +
          '<span class="db-pick-name">' + esc(x.name) + '</span>' +
          '<span class="db-pick-kind">' + esc([x.isDefault ? 'not exported with your solutions' : x.managed ? 'managed' : 'unmanaged', x.version].filter(Boolean).join(' \u00b7 ')) + '</span></button>'
      )
      .join('');
    pop.box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      const x = list[Number(b.dataset.i)];
      const tab = window.open('https://make.powerapps.com/e/' + encodeURIComponent(r.env) + '/s/' + x.id + '/app/edit/' + r.app, '_blank');
      if (!tab) {
        pop.body.insertAdjacentHTML('afterbegin', '<div class="db-pick-note">The tab was blocked. Allow pop-ups for this site and try again.</div>');
        return;
      }
      pop.close();
      DynaBoost.saved('solution-pins', 'designer');
    });
    const first = pop.body.querySelector('.db-pick-row');
    if (first) first.focus();
  }

  // ---------- dialog: name a shortcut, or paste a link ----------

  function openDialog(slot, draft) {
    DynaBoost.closePanel();
    const overlay = document.createElement('div');
    overlay.className = 'db-overlay' + (DynaBoost.isDark && DynaBoost.isDark() ? ' db-dark' : '');
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
      if (e.target === overlay) close();
    });

    function paint(note) {
      overlay.innerHTML =
        '<div class="db-dialog db-pins">' +
        '<div class="db-dialog-head"><span>' + (pins[slot] && draft ? 'Rename shortcut' : draft && isApp(draft) ? 'Pin an app' : 'Pin a solution or an app') + '</span>' +
        '<button type="button" data-db="close" aria-label="Close">✕</button></div>' +
        '<form class="db-pin-form" data-db="form">' +
        (draft ? '' : '<label>Link<input type="text" data-db="link" placeholder="Paste a link to a solution or an app" autocomplete="off"></label>') +
        '<div class="db-pin-fields"' + (draft ? '' : ' hidden') + '>' +
        '<label>Environment<input type="text" data-db="env" maxlength="60" autocomplete="off"></label>' +
        '<label>' + (draft && isApp(draft) ? 'App' : 'Solution') + '<input type="text" data-db="sol" maxlength="80" autocomplete="off"></label>' +
        '</div>' +
        '<div class="db-pin-note" data-db="note">' + esc(note || (draft ? 'Short names read best on the shortcut.' : '')) + '</div>' +
        '<div class="db-dialog-actions"><button type="submit" class="db-primary" data-db="save"' + (draft ? '' : ' disabled') + '>Save</button></div>' +
        '</form></div>';
      const q = (k) => overlay.querySelector('[data-db="' + k + '"]');
      q('close').addEventListener('click', close);
      if (draft) {
        q('env').value = draft.envName || '';
        q('sol').value = draft.solName || '';
        (draft.envName ? q('sol') : q('env')).focus();
      } else {
        const link = q('link');
        link.focus();
        link.addEventListener('input', () => {
          const parsed = parseLink(link.value);
          if (!parsed) {
            q('note').textContent = link.value.trim() ? 'Not a link to a solution (make.powerapps.com, make.powerautomate.com) or an app (Dynamics 365, apps.powerapps.com).' : '';
            return;
          }
          const twin = twinOf(parsed, slot);
          if (twin >= 0) {
            q('note').textContent = 'Already pinned as \u201c' + nameOf(pins[twin]) + '\u201d.';
            return;
          }
          draft = Object.assign(parsed, { envName: isApp(parsed) ? '' : guessEnvName(parsed.env), solName: '' });
          if (isApp(parsed) && parsed.type === 'model') {
            envNameOfHost(parsed.env).then((n) => {
              if (n && draft === parsed && !q('env').value) q('env').value = n;
            });
          }
          paint();
        });
      }
      q('form').addEventListener('submit', (e) => {
        e.preventDefault();
        if (!draft) return;
        const envName = clean(q('env').value) || 'Environment';
        const pin = Object.assign({}, draft, { envName: envName, solName: clean(q('sol').value) || (isApp(draft) ? 'App' : 'Solution') });
        pins[slot] = pin;
        // One environment, one name: renaming it renames it on every shortcut.
        pins.forEach((p) => {
          if (p && p.env === pin.env) p.envName = envName;
        });
        save();
        close();
      });
    }
    paint();
  }

  // ---------- drawing ----------

  const CHEVRON = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="m5 6 3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function draw(box) {
    if (!applies()) return;
    const count = pins.filter(Boolean).length;
    const here = appHere() || parseLink(location.href);

    const head = document.createElement('div');
    head.className = 'db-sec-head' + (folded ? ' db-sec-folded' : '');
    head.innerHTML =
      '<button type="button" class="db-sec-toggle" aria-expanded="' + !folded + '">' + CHEVRON +
      '<span>My shortcuts</span><span class="db-sec-count">' + count + '</span></button>' +
      (!folded && count < MAX
        ? '<button type="button" class="db-sec-add" title="' + (here ? (isApp(here) ? 'Pin this app' : 'Pin this solution - or one of its apps') + ' in the first free slot' : 'Pin a solution or an app from its link') + '">+ Add</button>'
        : '');
    head.querySelector('.db-sec-toggle').addEventListener('click', () => setFolded(!folded));
    const add = head.querySelector('.db-sec-add');
    if (add) {
      add.addEventListener('click', () => {
        const slot = firstFree();
        if (slot >= 0) pinAt(slot, add);
      });
    }
    box.appendChild(head);
    if (notice) {
      const note = document.createElement('div');
      note.className = 'db-sec-note';
      note.textContent = notice;
      box.appendChild(note);
    }
    if (folded) return;
    // Redrawn while a shortcut is held (a message going, a change from
    // another tab): the slots being sorted stay as they are.
    if (drag && drag.on) return void box.appendChild(drag.grid);

    // Three slots; all six once the first three are taken (or anything sits
    // in the second row).
    const shown = pins.slice(0, ROW).every(Boolean) || pins.slice(ROW).some(Boolean) ? MAX : ROW;
    const grid = document.createElement('div');
    grid.className = 'db-slots';
    for (let i = 0; i < shown; i++) grid.appendChild(pins[i] ? fullSlot(i, pins[i]) : emptySlot(i, here));
    box.appendChild(grid);
    // Measure once the panel shows the section.
    requestAnimationFrame(() => grid.querySelectorAll('.db-slot-sol').forEach(fitName));
  }

  function fullSlot(i, pin) {
    const el = document.createElement('div');
    el.className = 'db-slot db-slot-full' + (isApp(pin) ? ' db-slot-app' : '') + (designable(pin) ? ' db-slot-three' : '') + (flash.includes(i) ? ' db-slot-flash' : '');
    el.tabIndex = 0;
    el.setAttribute('role', 'link');
    el.dataset.slot = i;
    el.title = pin.envName + '\n' + pin.solName + (isApp(pin) ? ' (' + KIND[pin.type] + ')' : '') + '\n\nClick to open · Ctrl+click for a new tab · drag to move';
    el.innerHTML =
      '<span class="db-slot-env">' + esc(pin.envName) + '</span>' +
      '<span class="db-slot-sol">' + esc(pin.solName) + '</span>' +
      // Rename top-left, remove top-right: far apart, so a slip does not delete.
      (designable(pin) ? '<button type="button" class="db-slot-tool db-slot-design" data-act="design" title="Open in App designer" aria-label="Open in App designer">' + DESIGN + '</button>' : '') +
      '<button type="button" class="db-slot-tool db-slot-edit" data-act="edit" title="Rename" aria-label="Rename">' + PEN + '</button>' +
      '<button type="button" class="db-slot-tool db-slot-del" data-act="del" title="Remove" aria-label="Remove">' + CROSS + '</button>';
    const go = (e) => {
      const url = urlOf(pin);
      DynaBoost.saved('solution-pins');
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1 || elsewhere()) {
        window.open(url, '_blank', 'noopener');
        return;
      }
      DynaBoost.closePanel();
      location.assign(url);
    };
    el.addEventListener('click', (e) => {
      if (Date.now() - dragDone < 400) return; // the end of a drag, not a click
      const act = e.target.closest('[data-act]');
      if (!act) return go(e);
      e.stopPropagation();
      if (act.dataset.act === 'design') return designer(act, pin);
      if (act.dataset.act === 'del') {
        pins[i] = null;
        save();
      } else {
        openDialog(i, Object.assign({}, pin));
      }
    });
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1 && !e.target.closest('[data-act]')) go(e);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go(e);
    });
    el.addEventListener('pointerdown', (e) => grab(e, el));
    return el;
  }

  /* Two lines, then "...": the longest start of the name that still fits.
   * Done by measuring rather than a CSS clamp, which clips descenders. */
  function fitName(el) {
    const full = el.dataset.full || el.textContent;
    el.dataset.full = full;
    el.textContent = full;
    if (!el.offsetParent) return; // not on screen - measured next time
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
    const limit = line * 2 + 1;
    if (el.scrollHeight <= limit) return;
    let lo = 0;
    let hi = full.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      el.textContent = full.slice(0, mid).trimEnd() + '\u2026';
      if (el.scrollHeight <= limit) lo = mid;
      else hi = mid - 1;
    }
    el.textContent = full.slice(0, lo).trimEnd() + '\u2026';
  }

  function emptySlot(i, here) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'db-slot db-slot-empty';
    el.dataset.slot = i;
    el.title = here ? (isApp(here) ? 'Pin this app here' : 'Pin this solution - or one of its apps - here') : 'Pin a solution or an app here from its link';
    el.innerHTML = '<span class="db-slot-plus">+</span><span class="db-slot-hint">' + (here ? 'Pin here' : 'Paste link') + '</span>';
    el.addEventListener('click', () => pinAt(i, el));
    return el;
  }

  // ---------- moving a shortcut ----------

  /* As the panel's tiles are arranged (core.js, "arranging"): a press that
   * moves a few pixels lifts the shortcut - a tilted copy follows the
   * pointer and a dashed place stays behind. Over another slot it takes
   * that place, and those between shift by one, gliding - empty slots
   * too. Let go, the copy settles into the place and the order is kept;
   * Esc puts it back. Once lifted, the panel holds the pointer, so the drag
   * goes on over the page and its frames - not before, or a plain click
   * would not reach the shortcut. */
  let drag = null; // { el, grid, panel, id, x, y, px, py, on, order, ghost, dx, dy, landing }
  let dragDone = 0; // when the last drag ended
  const still = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const slotsOf = (grid) => Array.from(grid.children);

  function grab(e, el) {
    if (drag || e.button !== 0 || e.target.closest('[data-act]')) return;
    const panel = el.closest('.db-panel');
    if (!panel) return;
    drag = { el: el, grid: el.parentElement, panel: panel, id: e.pointerId, x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY, on: false };
    window.addEventListener('pointermove', dragMove, true);
    window.addEventListener('pointerup', dragUp, true);
    window.addEventListener('pointercancel', dragCancel, true);
    window.addEventListener('lostpointercapture', dragUp, true);
    window.addEventListener('keydown', dragKey, true);
  }

  function dragMove(e) {
    if (!drag || drag.landing || e.pointerId !== drag.id) return;
    drag.px = e.clientX;
    drag.py = e.clientY;
    if (!drag.on) {
      if (Math.hypot(drag.px - drag.x, drag.py - drag.y) < 5) return;
      if (!drag.el.isConnected) return endDrag(true); // redrawn under the press
      lift();
    }
    follow();
    sortUnder();
  }

  const dragUp = (e) => drag && e.pointerId === drag.id && endDrag(false);
  const dragCancel = (e) => drag && e.pointerId === drag.id && endDrag(true);
  function dragKey(e) {
    if (e.key !== 'Escape' || !drag || !drag.on) return;
    // Esc puts the shortcut back - and leaves the panel open.
    e.preventDefault();
    e.stopPropagation();
    endDrag(true);
  }

  function lift() {
    const el = drag.el;
    const r = el.getBoundingClientRect();
    drag.on = true;
    drag.dx = drag.x - r.left;
    drag.dy = drag.y - r.top;
    drag.order = slotsOf(drag.grid).map((n) => Number(n.dataset.slot));
    const ghost = el.cloneNode(true);
    ghost.removeAttribute('tabindex');
    ghost.removeAttribute('role');
    ghost.classList.add('db-ghost');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.width = r.width + 'px';
    ghost.style.height = r.height + 'px';
    drag.panel.parentElement.appendChild(ghost);
    drag.ghost = ghost;
    el.classList.add('db-drag-src');
    drag.panel.classList.add('db-dragging');
    try {
      drag.panel.setPointerCapture(drag.id);
    } catch (err) {
      /* moves over the panel still reach it */
    }
  }

  // Tilted a little, as if lifted.
  function follow() {
    drag.ghost.style.transform = 'translate(' + (drag.px - drag.dx) + 'px, ' + (drag.py - drag.dy) + 'px) rotate(2deg)';
  }

  // Over another slot it takes its place. One still gliding is not a target.
  function sortUnder() {
    const node = drag.el;
    const items = slotsOf(drag.grid);
    const x = drag.px;
    const y = drag.py;
    const to = items.find((n) => {
      if (n === node || n.getAnimations().length) return false;
      const r = n.getBoundingClientRect();
      return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
    });
    if (!to) return;
    const was = items.map((n) => n.getBoundingClientRect());
    if (items.indexOf(to) > items.indexOf(node)) to.after(node);
    else to.before(node);
    if (still()) return;
    items.forEach((n, i) => {
      if (n === node) return;
      const b = n.getBoundingClientRect();
      glide(n, was[i].left - b.left, was[i].top - b.top);
    });
  }

  function glide(node, dx, dy) {
    if (!dx && !dy) return;
    node.getAnimations().forEach((a) => a.cancel());
    node.animate([{ transform: 'translate(' + dx + 'px, ' + dy + 'px)' }, { transform: 'none' }], { duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
  }

  function endDrag(cancel) {
    const d = drag;
    if (!d || d.landing) return;
    window.removeEventListener('pointermove', dragMove, true);
    window.removeEventListener('pointerup', dragUp, true);
    window.removeEventListener('pointercancel', dragCancel, true);
    window.removeEventListener('lostpointercapture', dragUp, true);
    window.removeEventListener('keydown', dragKey, true);
    if (!d.on) {
      drag = null;
      return;
    }
    d.landing = true;
    dragDone = Date.now();
    try {
      if (d.panel.hasPointerCapture(d.id)) d.panel.releasePointerCapture(d.id);
    } catch (err) {
      /* already released */
    }
    const order = slotsOf(d.grid).map((n) => Number(n.dataset.slot));
    const changed = !cancel && order.join() !== d.order.join();
    const land = () => {
      drag = null;
      d.ghost.remove();
      d.el.classList.remove('db-drag-src');
      d.panel.classList.remove('db-dragging');
      if (changed) {
        const was = pins.slice();
        order.forEach((from, at) => {
          pins[at] = was[from];
        });
        flash = flash.map((f) => order.indexOf(f)).filter((f) => f >= 0);
        save();
      } else {
        DynaBoost.refresh();
      }
    };
    if (cancel || still() || !d.el.isConnected || !d.ghost.animate) return land();
    const to = d.el.getBoundingClientRect();
    d.ghost
      .animate([{ transform: d.ghost.style.transform }, { transform: 'translate(' + to.left + 'px, ' + to.top + 'px) rotate(0deg)' }], { duration: 150, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' })
      .finished.then(land, land);
  }

  // ---------- boot ----------

  chrome.storage.sync.get(STORE_KEY, (data) => {
    pins = normalise(data && data[STORE_KEY]);
    chrome.storage.local.get(FOLD_KEY, (d) => {
      folded = !!(d && d[FOLD_KEY]);
      DynaBoost.addSection({ id: 'solution-pins', draw: draw });
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[STORE_KEY]) {
      pins = normalise(changes[STORE_KEY].newValue);
      DynaBoost.refresh();
    }
  });
})();
