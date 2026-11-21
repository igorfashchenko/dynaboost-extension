/* Feature: Clear cache - the same on every site DynaBoost works on (Dynamics
 * 365, make.powerapps.com, Power Automate, Azure DevOps). A site keeps a copy
 * of forms, views, menus and lists in the browser between visits - Ctrl+F5
 * does not touch it, and an old version after a change often comes from
 * there. This clears what the site you are on keeps in the browser - only
 * its address: its saved data (IndexedDB), local and session storage,
 * downloaded files, service workers - and reloads past the browser's cache.
 * Cookies stay. Where the site keeps its sign-in in its own storage (the
 * maker portals), the window says that it may sign you in again.
 *
 * The first time a window shows each kind with what it holds now, and you
 * pick; with "Next time at once" the tile then clears the same at a click,
 * no window, no message - the pencil on the tile (the pointer on it) opens
 * the window any time. A form
 * with unsaved changes is never cleared at once: the window asks first.
 * The clearing itself is the browser's (browsingData, in background.js),
 * for this environment's address only.
 *
 * God mode on: switched off before the page reloads, and said so - before
 * the reload and after it. A page that loads with nothing kept in the
 * browser runs its form scripts late, after God mode has opened the form,
 * and they lock again what it opened.
 */
(function () {
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="M18 3.5v3.6h-3.6" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M12 8.6l.9 2.5 2.5.9-2.5.9-.9 2.5-.9-2.5-2.5-.9 2.5-.9z" stroke="#E3B04B" stroke-width="1.3" stroke-linejoin="round"/>' +
    '</svg>';

  const KEY = 'dynaboost.clearCache'; // { what: [kind ids], ask: bool } - one choice for every environment
  const KINDS = [
    { id: 'data', name: 'Saved forms and data', tech: 'IndexedDB', what: 'Forms, views, menus and lists as the site keeps them between visits - where an old version after a change usually comes from.' },
    { id: 'local', name: 'Page settings', tech: 'local storage', what: 'What the pages remember between visits - views and panels last used, small choices.' },
    { id: 'session', name: 'This tab’s memory', tech: 'session storage', what: 'What this tab keeps until it closes. Page settings empties it too.' },
    { id: 'files', name: 'Downloaded files', tech: 'cache', what: 'Scripts, styles and images the browser and the page keep - downloaded again.' },
    { id: 'workers', name: 'Background helpers', tech: 'service workers', what: 'Taken off - the page puts back what it needs as it loads.' }
  ];
  const ALL = KINDS.map((k) => k.id);
  const OWN_SIGN_IN = /^make\.(powerapps|powerautomate)\.com$/i;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  async function choice() {
    try {
      const v = (await chrome.storage.local.get(KEY))[KEY];
      if (v && Array.isArray(v.what)) return { what: v.what.filter((k) => ALL.includes(k)), ask: !!v.ask, set: true };
    } catch (e) {
      /* the extension was updated meanwhile */
    }
    return { what: ALL.slice(), ask: true, set: false };
  }

  // What each kind holds now - what this page can see of it.
  async function measure() {
    const out = {};
    try {
      const dbs = await indexedDB.databases();
      out.data = plural(dbs.length, 'database', 'databases');
    } catch (e) {
      /* not told */
    }
    try {
      out.local = plural(localStorage.length, 'entry', 'entries');
    } catch (e) {
      /* not told */
    }
    try {
      out.session = plural(sessionStorage.length, 'entry', 'entries');
    } catch (e) {
      /* not told */
    }
    try {
      const keys = await caches.keys();
      out.files = keys.length ? plural(keys.length, 'page cache', 'page caches') + ' and the browser’s' : 'the browser’s';
    } catch (e) {
      out.files = 'the browser’s';
    }
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      out.workers = regs.length ? plural(regs.length, 'helper', 'helpers') : 'none';
    } catch (e) {
      /* not told */
    }
    try {
      const est = await navigator.storage.estimate();
      if (est && est.usage) out.size = est.usage;
    } catch (e) {
      /* not told */
    }
    return out;
  }

  const mb = (bytes) => (bytes >= 1048576 ? (bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB');

  // A record form with unsaved changes - they would go with the reload:
  // null, or the labels of the columns changed (a form script that sets a
  // value on load makes them too).
  async function unsaved() {
    if (DynaBoost.page().type !== 'entityrecord' || !DynaBoost.formDump || !DynaBoost.formDump.context) return null;
    try {
      const ctx = await DynaBoost.formDump.context(1500);
      const changed = (ctx && Array.isArray(ctx.changed) ? ctx.changed : []).filter((x) => typeof x === 'string' && x);
      return ctx && (ctx.unsaved || changed.length) ? { changed: changed } : null;
    } catch (e) {
      return null;
    }
  }

  // Why the window is there, and what would be lost.
  function warnHtml(dirty, stopped) {
    const shown = dirty.changed.slice(0, 5).map((x) => '<b>' + esc(x) + '</b>').join(', ');
    const more = dirty.changed.length > 5 ? ' and ' + (dirty.changed.length - 5) + ' more' : '';
    return (
      (stopped ? '<b>Not cleared at once</b> - this' : 'This') +
      ' form has unsaved changes' + (shown ? ' (' + shown + more + ')' : '') +
      ' - they are lost when the page reloads. Save the record first, or clear anyway.'
    );
  }

  // God mode was switched off for a clearing: said again once the page is back (this tab's memory outlives the reload).
  const GOD_NOTE = 'dynaboost.clearedGodOff';
  const GOD_OFF = 'God mode is switched off - a page loading anew runs its scripts after it. Switch it on again once the form is there.';

  function godOff() {
    try {
      if (!DynaBoost.isOn('god-mode')) return false;
      DynaBoost.toggle('god-mode');
      return true;
    } catch (e) {
      return false;
    }
  }

  async function clean(what) {
    const god = godOff();
    if (what.includes('session')) {
      try {
        sessionStorage.clear();
      } catch (e) {
        /* nothing kept */
      }
    }
    if (god) {
      DynaBoost.toast('Clearing cache', GOD_OFF);
      // Kept by the extension: clearing Page settings empties this tab's session storage too.
      await chrome.storage.local.set({ [GOD_NOTE]: { host: location.host, at: Date.now() } }).catch(() => {});
    }
    DynaBoost.saved('clear-cache');
    // The background clears this address's data and reloads the tab.
    const r = await chrome.runtime.sendMessage({ type: 'DB_CLEAR_SITE', what: what });
    if (r && r.error) DynaBoost.toast('Not cleared', r.error, true);
  }

  // ---------- the window ----------

  let closeDialog = null;

  // dirty: the form's unsaved changes, when clearing at once stopped on them.
  async function openDialog(dirty) {
    if (closeDialog) return;
    const stopped = !!(dirty && dirty.changed);
    DynaBoost.closePanel();
    const now = await choice();
    const overlay = document.createElement('div');
    overlay.className = 'db-overlay' + (DynaBoost.isDark() ? ' db-dark' : '');
    overlay.innerHTML =
      '<div class="db-dialog db-cc" role="dialog" aria-label="Clear cache">' +
      '<div class="db-dialog-head"><span>Clear cache</span><button type="button" data-db="close" aria-label="Close">✕</button></div>' +
      '<div class="db-cc-where">What <b>' + esc(location.hostname) + '</b> keeps in this browser<span data-db="size"></span></div>' +
      '<div class="db-cc-warn" data-db="warn"' + (stopped ? '>' + warnHtml(dirty, true) : ' hidden>') + '</div>' +
      '<div class="db-cc-list">' +
      KINDS.map(
        (k) =>
          '<label class="db-cc-row"><input type="checkbox" data-k="' + k.id + '"' + (now.what.includes(k.id) ? ' checked' : '') + '>' +
          '<span class="db-cc-t"><span class="db-cc-name"><b>' + esc(k.name) + '</b> <code>' + esc(k.tech) + '</code><span class="db-cc-n" data-n="' + k.id + '"></span></span>' +
          '<span class="db-cc-w">' + esc(k.what) + '</span></span></label>'
      ).join('') +
      '</div>' +
      '<div class="db-cc-keep"><b>Kept:</b> cookies; other environments and sites; DynaBoost’s own settings.' +
      // The maker portals keep their sign-in in the page's own storage, not in cookies.
      (OWN_SIGN_IN.test(location.hostname) ? ' This site keeps its sign-in in Page settings and This tab’s memory: clearing them may sign you in again - usually by itself.' : ' You stay signed in.') +
      '</div>' +
      '<label class="db-cc-once"><input type="checkbox" data-db="once"' + (now.set && now.ask ? '' : ' checked') + '><span>Next time clear at once - the <b>pencil</b> on the tile opens this window again</span></label>' +
      '<div class="db-dialog-actions"><button type="button" class="db-primary" data-db="go">Clear and reload</button><button type="button" data-db="cancel">Cancel</button></div>' +
      '</div>';
    document.body.appendChild(overlay);
    const q = (k) => overlay.querySelector('[data-db="' + k + '"]');

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      closeDialog = null;
    }
    closeDialog = close;
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    q('close').addEventListener('click', close);
    q('cancel').addEventListener('click', close);

    const picked = () => Array.from(overlay.querySelectorAll('[data-k]:checked')).map((b) => b.getAttribute('data-k'));
    const sync = () => (q('go').disabled = !picked().length);
    /* The choice is kept the moment it changes - closing the window keeps
     * it too: "Next time clear at once" ticked and the window closed, the
     * next click clears at once. */
    const keep = () => {
      const what = picked();
      if (!what.length) return;
      try {
        chrome.storage.local.set({ [KEY]: { what: what, ask: !q('once').checked } }).catch(() => {});
      } catch (e) {
        /* the extension was updated meanwhile */
      }
    };
    overlay.querySelectorAll('[data-k]').forEach((b) =>
      b.addEventListener('change', () => {
        sync();
        keep();
      })
    );
    q('once').addEventListener('change', keep);
    sync();

    q('go').addEventListener('click', async () => {
      const what = picked();
      if (!what.length) return;
      q('go').disabled = true;
      q('go').textContent = 'Clearing…';
      try {
        await chrome.storage.local.set({ [KEY]: { what: what, ask: !q('once').checked } });
        await clean(what);
      } catch (e) {
        DynaBoost.toast('Not cleared', String((e && e.message) || e), true);
      }
      close();
    });
    // Unsaved changes: Enter does not lose them.
    (stopped ? q('cancel') : q('go')).focus();

    measure().then((m) => {
      if (!overlay.isConnected) return;
      for (const k of ALL) if (m[k]) overlay.querySelector('[data-n="' + k + '"]').textContent = m[k];
      if (m.size) q('size').textContent = ' - about ' + mb(m.size);
    });
    if (!stopped)
      unsaved().then((d) => {
        if (!overlay.isConnected || !d) return;
        q('warn').innerHTML = warnHtml(d, false);
        q('warn').hidden = false;
      });
  }

  async function run() {
    const now = await choice();
    if (!now.set || now.ask || !now.what.length) return openDialog();
    // At once - unless the form has changes the reload would lose.
    const dirty = await unsaved();
    if (dirty) return openDialog(dirty);
    DynaBoost.closePanel();
    try {
      await clean(now.what);
    } catch (e) {
      DynaBoost.toast('Not cleared', String((e && e.message) || e), true);
    }
  }

  /* Back after a clearing that switched God mode off: said once the page is
   * up - Dynamics writes its page anew as it starts, a message shown before
   * that would go with it. */
  async function sayGodOff() {
    let note = null;
    try {
      note = (await chrome.storage.local.get(GOD_NOTE))[GOD_NOTE];
    } catch (e) {
      return;
    }
    if (!note || note.host !== location.host) return;
    chrome.storage.local.remove(GOD_NOTE).catch(() => {});
    // Not a mark left by a clearing that never came back.
    if (!note.at || Date.now() - note.at > 120000) return;
    let tries = 0;
    const wait = setInterval(() => {
      if (++tries < 120 && (document.readyState !== 'complete' || !document.body)) return;
      clearInterval(wait);
      setTimeout(() => DynaBoost.toast('Cache cleared', GOD_OFF), 1500);
    }, 500);
  }
  if (window.top === window && !DynaBoost.off) sayGodOff();

  DynaBoost.register({
    id: 'clear-cache',
    name: 'Clear cache',
    group: 'Navigation',
    hosts: ['dynamics.com', 'make.powerapps.com', 'make.powerautomate.com', 'dev.azure.com', 'visualstudio.com'],
    type: 'action',
    hint: 'Clears what this site keeps in the browser and reloads',
    icon: ICON,
    onRun: run,
    settings: openDialog,
    settingsHint: 'Choose what is cleared'
  });
})();
