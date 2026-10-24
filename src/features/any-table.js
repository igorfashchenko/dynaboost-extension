/* Feature: Open any table. In a model-driven app, any table of the
 * environment - also one the app's navigation leaves out - opened in the
 * same app as a view (pagetype=entitylist, its default view) or as a new
 * record's form (pagetype=entityrecord, its default main form), as you would
 * by changing etn= in the address.
 *
 * A dialog over the page: View or Form - what this page is, unless you
 * change it - and the tables, found by display name, logical name and schema
 * name at once. Up to five favorites and the last five opened, per
 * environment, wait at the top. The tables are read once a tab
 * (EntityDefinitions), without the intersect and private ones.
 */
(function () {
  if (DynaBoost.off) return;
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="3.5" y="4.5" width="13" height="11" rx="1.8" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M3.5 8.5h13M8 8.5v7" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M14 19.5h6.5m0 0-2.6-2.6m2.6 2.6-2.6 2.6" stroke="#E3B04B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
  const STAR =
    '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>';
  const LOOK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/></svg>';

  const FAV_KEY = 'dynaboost.anyTableFavorites'; // chrome.storage.local: { host: [logical name, ...] }, in the order starred
  const RECENT_KEY = 'dynaboost.anyTableRecent'; // chrome.storage.local: { host: [logical name, ...] }, newest first
  const LIST_KEY = 'dynaboost.anyTable.tables'; // sessionStorage: the tables, read once a tab
  const FAVS = 5;
  const RECENT = 5;
  const SHOWN = 60; // rows a search shows; typing more narrows it

  const onApp = () => /\.dynamics\.com$/i.test(location.hostname) && /\/main\.aspx$/i.test(location.pathname) && window.top === window;
  const host = () => location.hostname.toLowerCase();
  const params = () => new URLSearchParams(location.search);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ---------- the tables ----------

  let tables = null; // [{ l: logical, s: schema, d: display }], by display name

  async function readTables() {
    if (tables) return tables;
    try {
      const kept = JSON.parse(sessionStorage.getItem(LIST_KEY) || 'null');
      if (Array.isArray(kept) && kept.length) return (tables = kept);
    } catch (e) {
      /* read again */
    }
    const res = await fetch('/api/data/v9.2/EntityDefinitions?$select=LogicalName,SchemaName,DisplayName,IsIntersect,IsPrivate', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' }
    });
    if (!res.ok) throw new Error('Dataverse answered ' + res.status + ' - reload the page and try again.');
    const rows = ((await res.json()) || {}).value || [];
    tables = rows
      .filter((t) => t.LogicalName && !t.IsIntersect && !t.IsPrivate)
      .map((t) => ({ l: t.LogicalName, s: t.SchemaName || t.LogicalName, d: (t.DisplayName && t.DisplayName.UserLocalizedLabel && t.DisplayName.UserLocalizedLabel.Label) || t.LogicalName }))
      .sort((a, b) => a.d.localeCompare(b.d) || a.l.localeCompare(b.l));
    try {
      sessionStorage.setItem(LIST_KEY, JSON.stringify(tables));
    } catch (e) {
      /* kept for this page only */
    }
    return tables;
  }

  /* Every word typed in the display name, the logical name or the schema
   * name; a name that is the term, or starts with it, comes first. */
  function find(term) {
    const words = term.toLowerCase().split(/\s+/).filter(Boolean);
    const rank = (t) => {
      const names = [t.d.toLowerCase(), t.l, t.s.toLowerCase()];
      if (!words.every((w) => names.some((n) => n.indexOf(w) >= 0))) return -1;
      const whole = term.toLowerCase().trim();
      if (names.some((n) => n === whole)) return 0;
      if (names.some((n) => n.startsWith(whole))) return 1;
      return 2;
    };
    return tables
      .map((t) => ({ t: t, r: rank(t) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r)
      .map((x) => x.t);
  }

  // ---------- favorites and recent, per environment ----------

  async function stored(key) {
    try {
      const all = (await chrome.storage.local.get(key))[key] || {};
      return (all[host()] || []).filter((n) => typeof n === 'string');
    } catch (e) {
      return [];
    }
  }

  async function store(key, names) {
    try {
      const all = (await chrome.storage.local.get(key))[key] || {};
      all[host()] = names;
      await chrome.storage.local.set({ [key]: all });
    } catch (e) {
      /* not remembered - it still works */
    }
  }

  // ---------- opening ----------

  // In the app this page is in: its appid, or its appname.
  function addressOf(table, mode) {
    const p = params();
    const app = p.get('appid') ? 'appid=' + encodeURIComponent(p.get('appid')) + '&' : p.get('appname') ? 'appname=' + encodeURIComponent(p.get('appname')) + '&' : '';
    return location.origin + '/main.aspx?' + app + 'pagetype=' + (mode === 'form' ? 'entityrecord' : 'entitylist') + '&etn=' + encodeURIComponent(table.l);
  }

  // ---------- the dialog ----------

  let closeDialog = null;

  function openDialog() {
    if (closeDialog) return;
    DynaBoost.closePanel();
    let mode = params().get('pagetype') === 'entityrecord' ? 'form' : 'view';
    const overlay = document.createElement('div');
    overlay.className = 'db-overlay' + (DynaBoost.isDark() ? ' db-dark' : '');
    overlay.innerHTML =
      '<div class="db-dialog db-imp db-anyt" role="dialog" aria-label="Open any table">' +
      '<div class="db-dialog-head"><span>Open any table</span><button type="button" data-db="close" aria-label="Close">✕</button></div>' +
      '<div class="db-anyt-mode" role="group" aria-label="Open as">' +
      '<button type="button" data-mode="view">View</button><button type="button" data-mode="form">Form</button></div>' +
      '<label class="db-imp-search">' + LOOK +
      '<input type="text" data-db="q" placeholder="Display, logical or schema name" autocomplete="off" spellcheck="false" aria-label="Search tables"></label>' +
      '<div class="db-imp-list" role="listbox" data-db="list"></div>' +
      '<div class="db-imp-note" data-db="note"></div>' +
      '<div class="db-imp-foot">↑ ↓ Enter to open · Ctrl+Enter or Ctrl+click: a new tab · ★ up to ' + FAVS + ' favorites</div>' +
      '</div>';
    document.body.appendChild(overlay);
    const q = (k) => overlay.querySelector('[data-db="' + k + '"]');
    const input = q('q');
    const list = q('list');
    const note = q('note');

    let items = [];
    let active = 0;
    let favs = [];
    let recent = [];
    const loaded = Promise.all([stored(FAV_KEY), stored(RECENT_KEY)]).then(([f, r]) => {
      favs = f;
      recent = r;
    });

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

    const say = (text, error) => {
      note.textContent = text || '';
      note.classList.toggle('db-imp-err', !!error);
    };

    function setMode(next) {
      mode = next;
      overlay.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
      list.querySelectorAll('.db-imp-go').forEach((g) => (g.textContent = mode === 'form' ? 'Open form' : 'Open view'));
      input.focus();
    }
    overlay.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

    function mark(i, scroll) {
      active = i;
      list.querySelectorAll('.db-imp-row').forEach((row, n) => {
        row.classList.toggle('db-imp-on', n === i);
        row.setAttribute('aria-selected', String(n === i));
        if (n === i && scroll) row.scrollIntoView({ block: 'nearest' });
      });
    }

    const isFav = (t) => favs.indexOf(t.l) >= 0;
    function paintStar(star, t) {
      const on = isFav(t);
      star.setAttribute('aria-pressed', String(on));
      star.title = on ? 'Remove from favorites' : 'Keep as a favorite - up to ' + FAVS + ', at the top of the list';
    }

    function toggleFav(t) {
      if (isFav(t)) favs = favs.filter((n) => n !== t.l);
      else if (favs.length >= FAVS) return say('Up to ' + FAVS + ' favorites - take the star off one first.', true);
      else favs = favs.concat(t.l);
      say('');
      store(FAV_KEY, favs);
      show(active);
    }

    const initials = (t) => (t.d.match(/[A-Za-z0-9]/g) || ['?']).slice(0, 2).join('').toUpperCase();

    function row(t, i) {
      const el = document.createElement('div');
      el.className = 'db-imp-row';
      el.setAttribute('role', 'option');
      el.title = t.d + ' - ' + t.l + (t.s !== t.l ? ' · ' + t.s : '');
      el.innerHTML =
        '<span class="db-imp-av">' + esc(initials(t)) + '</span>' +
        '<span class="db-imp-who"><b>' + esc(t.d) + '</b><span>' + esc(t.l) + (t.s !== t.l ? ' · ' + esc(t.s) : '') + '</span></span>' +
        '<span class="db-imp-go">' + (mode === 'form' ? 'Open form' : 'Open view') + '</span>' +
        '<button type="button" class="db-imp-star" aria-pressed="false">' + STAR + '</button>';
      const star = el.querySelector('.db-imp-star');
      paintStar(star, t);
      star.addEventListener('click', () => toggleFav(t));
      el.addEventListener('click', (e) => !star.contains(e.target) && open(i, e.ctrlKey || e.metaKey || e.shiftKey));
      el.addEventListener('auxclick', (e) => e.button === 1 && !star.contains(e.target) && open(i, true));
      el.addEventListener('mousemove', () => active !== i && mark(i));
      return el;
    }

    function render(groups, keep) {
      items = [];
      list.textContent = '';
      for (const g of groups) {
        if (!g.tables.length) continue;
        if (g.title) {
          const title = document.createElement('div');
          title.className = 'db-imp-label';
          title.textContent = g.title;
          list.appendChild(title);
        }
        for (const t of g.tables) list.appendChild(row(t, items.push(t) - 1));
      }
      mark(keep != null && keep < items.length ? keep : 0);
    }

    // Nothing typed: favorites, then the last ones opened; typed: what matches.
    function show(keep) {
      if (!tables) return;
      const term = input.value.trim();
      const by = (names) => names.map((n) => tables.find((t) => t.l === n)).filter(Boolean);
      if (!term) {
        render([{ title: 'Favorites', tables: by(favs) }, { title: 'Recent', tables: by(recent).filter((t) => !isFav(t)) }], keep);
        say(items.length ? '' : tables.length + ' tables - type a display, logical or schema name.');
        return;
      }
      const found = find(term);
      render([{ title: '', tables: found.slice(0, SHOWN) }], keep);
      say(!found.length ? 'No table matches “' + term + '”.' : found.length > SHOWN ? SHOWN + ' of ' + found.length + ' - type more to narrow it.' : '');
    }

    function open(i, newTab) {
      const t = items[i];
      if (!t) return;
      recent = [t.l].concat(recent.filter((n) => n !== t.l)).slice(0, RECENT);
      store(RECENT_KEY, recent);
      DynaBoost.saved('any-table');
      const url = addressOf(t, mode);
      if (newTab) {
        window.open(url, '_blank', 'noopener');
        return;
      }
      close();
      location.assign(url);
    }

    input.addEventListener('input', () => show());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (items.length) mark((active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length, true);
      } else if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        open(active, e.ctrlKey || e.metaKey);
      }
    });

    setMode(mode);
    say('Reading the tables…');
    Promise.all([readTables(), loaded]).then(
      () => closeDialog === close && show(),
      (e) => closeDialog === close && say('The tables could not be read: ' + (e.message || e), true)
    );
  }

  DynaBoost.register({
    id: 'any-table',
    name: 'Open any table',
    group: 'Navigation',
    hosts: ['dynamics.com'],
    when: onApp,
    type: 'action',
    hint: 'Any table of the environment as a view or a form, in this app',
    icon: ICON,
    onRun: openDialog
  });
})();
