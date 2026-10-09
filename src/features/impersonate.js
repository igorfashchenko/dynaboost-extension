/* Feature: Impersonate - work in this tab as another user of the environment.
 *
 * The background adds MSCRMCallerID to this tab's requests to the environment
 * (a session rule for this tab, background.js) and the page reloads as them;
 * a tab opened from this one follows it. A blue frame and a label on the
 * bottom edge show who you are. Favorites (3) and recent users (5) head the
 * search.
 *
 * Dataverse applies it, so data, access and saves are the user's. It needs
 * the Act on Behalf of Another User privilege: one WhoAmI as the user checks
 * it before anything changes, another after the reload confirms it.
 *
 * The search asks for a few columns and 8 rows, startswith on each word; the
 * next keystroke cancels the last request, answers are cached while the
 * dialog is open, and a longer word is filtered locally when it can be.
 */
(function () {
  if (DynaBoost.off) return;
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<circle cx="15.6" cy="7.4" r="2.7" stroke="#E3B04B" stroke-width="1.6"/>' +
    '<path d="M13.3 13.3a4.8 4.8 0 0 1 7.2 4.2" stroke="#E3B04B" stroke-width="1.6" stroke-linecap="round"/>' +
    '<circle cx="9" cy="9.6" r="3.2" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M3.5 20.5a5.5 5.5 0 0 1 11 0" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
    '</svg>';
  const PERSON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>';
  const SWAP =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M7 4 4 7l3 3M4 7h13M17 20l3-3-3-3M20 17H7"/></svg>';
  const STAR =
    '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>';
  const LOOK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/></svg>';

  const ORG = /^[a-z0-9-]+\.crm\d*\.dynamics\.com$/i;
  const API = '/api/data/v9.2/';
  const RECENT_KEY = 'dynaboost.impRecent'; // chrome.storage.local: { host: [user, ...] }, newest first
  const FAV_KEY = 'dynaboost.impFavorites'; // chrome.storage.local: { host: [user, ...] }, in the order starred
  const SEEN_KEY = 'dynaboost.imp.seen'; // sessionStorage: the user this tab has confirmed
  const STOPPED_KEY = 'dynaboost.imp.stopped'; // sessionStorage: say it after the reload
  const ROWS = 8;
  const RECENT = 5;
  const FAVS = 3;

  const onOrg = () => ORG.test(location.hostname) && window.top === window;
  const host = () => location.hostname.toLowerCase();

  let current = null; // { host, id, name, email, bu, reflects } - who this tab works as
  let lit = false; // the tile is on
  let resetTile = null;
  let closePicker = null;

  const toast = (title, sub, error) => DynaBoost.toast(title, sub, error);

  async function send(msg) {
    try {
      return (await chrome.runtime.sendMessage(msg)) || null;
    } catch (e) {
      return { error: 'DynaBoost was updated - reload the page and try again.' };
    }
  }

  function whenBody(fn) {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  async function api(path, headers, signal) {
    const res = await fetch(API + path, {
      credentials: 'same-origin',
      signal: signal,
      headers: Object.assign({ Accept: 'application/json', 'OData-Version': '4.0', 'OData-MaxVersion': '4.0' }, headers)
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error((body && body.error && body.error.message) || 'HTTP ' + res.status);
    return body;
  }

  // ---------- users ----------

  const GUID = /^\{?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}?$/i;
  const FIELDS = ['fullname', 'firstname', 'lastname', 'internalemailaddress', 'domainname'];
  const BU = '_businessunitid_value';
  // People who can sign in: enabled, and not support, application or partner accounts.
  const PEOPLE = 'isdisabled eq false and accessmode ne 3 and accessmode ne 4 and accessmode ne 5';

  const words = (term) => term.split(' ').filter(Boolean).slice(0, 4);

  function filterFor(term) {
    const g = term.match(GUID);
    if (g) return 'systemuserid eq ' + g[1];
    return words(term)
      .map((w) => {
        const q = "'" + w.replace(/'/g, "''") + "'";
        return '(' + FIELDS.map((f) => 'startswith(' + f + ',' + q + ')').join(' or ') + ')';
      })
      .join(' and ');
  }

  // Letters as Dataverse compares them: no case, no accents.
  const FOLD = { ł: 'l', đ: 'd', ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', ı: 'i' };
  const fold = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[łđøæœßı]/g, (c) => FOLD[c]);

  function toUser(r) {
    return {
      id: String(r.systemuserid).toLowerCase(),
      name: r.fullname || r.domainname || r.systemuserid,
      email: r.internalemailaddress || r.domainname || '',
      bu: r[BU + '@OData.Community.Display.V1.FormattedValue'] || '',
      // What the search matched, for filtering a longer word here.
      keys: [r.fullname, r.firstname, r.lastname, r.internalemailaddress, r.domainname].map(fold)
    };
  }

  // The same test as filterFor, on rows already here.
  function matches(user, term) {
    return words(fold(term)).every((w) => user.keys.some((k) => k.startsWith(w)));
  }

  async function search(term, signal) {
    const body = await api(
      'systemusers?$select=fullname,firstname,lastname,internalemailaddress,domainname,' + BU +
        '&$filter=' + encodeURIComponent(PEOPLE + ' and ' + filterFor(term)) +
        '&$orderby=fullname&$top=' + ROWS,
      { Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"' },
      signal
    );
    return (body.value || []).map(toUser);
  }

  const plain = (u) => ({ id: u.id, name: u.name, email: u.email, bu: u.bu });

  // Recent users and favorites, each a list per environment.
  async function stored(key) {
    try {
      const all = (await chrome.storage.local.get(key))[key] || {};
      return (all[host()] || []).filter((u) => u && GUID.test(u.id || ''));
    } catch (e) {
      return [];
    }
  }

  async function store(key, users) {
    try {
      const all = (await chrome.storage.local.get(key))[key] || {};
      all[host()] = users.map(plain);
      await chrome.storage.local.set({ [key]: all });
    } catch (e) {
      /* not remembered - it still works */
    }
  }

  async function remember(user) {
    await store(RECENT_KEY, [user].concat((await stored(RECENT_KEY)).filter((u) => u.id !== user.id)).slice(0, RECENT));
  }

  // ---------- start and stop ----------

  function explain(message, user) {
    if (/prvActOnBehalfOfAnotherUser/i.test(message))
      return 'You need the Act on Behalf of Another User privilege to work as someone else - in a security role under Business Management, Miscellaneous privileges. The Delegate role has it.';
    return 'Dataverse would not let you work as ' + user.name + ': ' + message;
  }

  /* One WhoAmI as the user, before anything changes: the privilege, and the
   * user, are Dataverse's to judge. A switch takes this tab's rule off first -
   * the check has to go out as you - and puts it back if the check fails. */
  async function start(user) {
    const was = current;
    if (was) await send({ type: 'DB_IMP_SET', user: null });
    let reflects = false;
    try {
      const me = await api('WhoAmI', { MSCRMCallerID: user.id });
      reflects = String(me.UserId).toLowerCase() === user.id;
    } catch (e) {
      if (was) await send({ type: 'DB_IMP_SET', user: was });
      return explain(String(e.message || e), user);
    }
    const r = await send({ type: 'DB_IMP_SET', user: Object.assign(plain(user), { reflects: reflects }) });
    if (!r || r.error) {
      if (was) await send({ type: 'DB_IMP_SET', user: was });
      return (r && r.error) || 'DynaBoost could not start it.';
    }
    await remember(user);
    DynaBoost.saved('impersonate');
    try {
      sessionStorage.removeItem(SEEN_KEY);
    } catch (e) {
      /* the confirmation just says it again */
    }
    reload(() => {
      if (closePicker) closePicker();
      adopt(Object.assign({ host: host(), reflects: reflects }, plain(user)));
      toast('Impersonating ' + user.name, 'The page kept its unsaved changes - reload it to see all of it as them.');
    });
    return '';
  }

  async function stop() {
    const r = await send({ type: 'DB_IMP_SET', user: null });
    if (r && r.error) {
      toast('Impersonate', r.error, true);
      return;
    }
    const was = current ? current.name : '';
    try {
      sessionStorage.setItem(STOPPED_KEY, was);
      sessionStorage.removeItem(SEEN_KEY);
    } catch (e) {
      /* no word after the reload, then */
    }
    reload(() => {
      try {
        sessionStorage.removeItem(STOPPED_KEY);
      } catch (e) {
        /* said now instead */
      }
      if (closePicker) closePicker();
      adopt(null);
      toast('Impersonation stopped', 'The page kept its unsaved changes - reload it to see all of it as you.');
    });
  }

  // The page reloads as the new user. Still here a moment later: it asked to
  // stay (unsaved changes) - the requests have changed already, so say so.
  function reload(stayed) {
    location.reload();
    setTimeout(stayed, 2500);
  }

  // Who this tab works as, on the tile and the page.
  function adopt(imp) {
    current = imp;
    feature.hint = imp
      ? 'Impersonating ' + imp.name + (imp.email ? ' (' + imp.email + ')' : '') + ' in this tab - switch off to be you again'
      : HINT;
    const label = document.getElementById(LABEL);
    if (label) label.remove();
    if (imp) {
      if (!lit) DynaBoost.toggle(feature.id); // lit; onEnable sees who it is and opens nothing
      whenBody(showLabel);
    } else if (lit) {
      lit = false;
      if (resetTile) resetTile();
    }
    DynaBoost.refresh();
  }

  // ---------- the picker ----------

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function initials(name) {
    const parts = String(name || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').split(' ').filter(Boolean);
    return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  function whoHtml(u) {
    const sub = [u.email, u.bu].filter(Boolean).join(' · ');
    return (
      '<span class="db-imp-av">' + esc(initials(u.name)) + '</span>' +
      '<span class="db-imp-who"><b>' + esc(u.name) + '</b>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</span>'
    );
  }

  const starHtml = () => '<button type="button" class="db-imp-star" aria-pressed="false">' + STAR + '</button>';

  function openPicker() {
    if (closePicker) return;
    DynaBoost.closePanel();
    const overlay = document.createElement('div');
    overlay.className = 'db-overlay' + (DynaBoost.isDark() ? ' db-dark' : '');
    overlay.innerHTML =
      '<div class="db-dialog db-imp" role="dialog" aria-label="Impersonate">' +
      '<div class="db-dialog-head"><span>' + (current ? 'Switch user' : 'Impersonate') + '</span>' +
      '<button type="button" data-db="close" aria-label="Close">✕</button></div>' +
      (current
        ? '<div class="db-imp-now">' + whoHtml(current) + starHtml() + '<button type="button" class="db-imp-stop" data-db="stop">Stop</button></div>'
        : '<div class="db-imp-lead">Work in this tab as another user - their records, access and saves. Other tabs stay you.</div>') +
      '<label class="db-imp-search">' + LOOK +
      '<input type="text" data-db="q" placeholder="Name, email or user name" autocomplete="off" spellcheck="false" aria-label="Search users"></label>' +
      '<div class="db-imp-list" role="listbox" data-db="list"></div>' +
      '<div class="db-imp-note" data-db="note"></div>' +
      '<div class="db-imp-foot">Needs the Act on Behalf of Another User privilege · ↑ ↓ Enter to pick</div>' +
      '</div>';
    document.body.appendChild(overlay);
    const q = (k) => overlay.querySelector('[data-db="' + k + '"]');
    const input = q('q');
    const list = q('list');
    const note = q('note');

    let groups = []; // what the list shows: [{ title, users }]
    let items = []; // its users in order, for the keys
    let active = 0;
    let busy = false;
    let favs = [];
    const loaded = stored(FAV_KEY).then((f) => (favs = f));
    const cache = new Map(); // term -> users
    let ctrl = null;
    let timer = 0;
    let slow = 0;

    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) close();
    };
    function close() {
      if (ctrl) ctrl.abort();
      clearTimeout(timer);
      clearTimeout(slow);
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      closePicker = null;
      // Opened from the tile and nobody picked: the tile goes off again.
      if (!current && lit) {
        lit = false;
        if (resetTile) resetTile();
      }
    }
    closePicker = close;
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && !busy) close();
    });
    q('close').addEventListener('click', () => !busy && close());
    if (current) {
      q('stop').addEventListener('click', () => !busy && stop());
      const star = overlay.querySelector('.db-imp-now .db-imp-star');
      star.addEventListener('click', () => !busy && toggleFav(current));
      loaded.then(() => paintStar(star, current));
    }

    function say(text, error) {
      note.textContent = text || '';
      note.classList.toggle('db-imp-err', !!error);
    }

    function mark(i, scroll) {
      active = i;
      list.querySelectorAll('.db-imp-row').forEach((row, n) => {
        row.classList.toggle('db-imp-on', n === i);
        row.setAttribute('aria-selected', String(n === i));
        if (n === i && scroll) row.scrollIntoView({ block: 'nearest' });
      });
    }

    const isNow = (u) => !!current && current.id === u.id;
    const isFav = (u) => favs.some((f) => f.id === u.id);

    function paintStar(star, u) {
      const on = isFav(u);
      star.setAttribute('aria-pressed', String(on));
      star.title = on ? 'Remove from favorites' : 'Keep as a favorite - up to ' + FAVS + ', at the top of the list';
    }

    async function toggleFav(u) {
      await loaded;
      if (isFav(u)) favs = favs.filter((f) => f.id !== u.id);
      else if (favs.length >= FAVS) return say('Up to ' + FAVS + ' favorites - take the star off one first.', true);
      else favs = favs.concat(plain(u));
      say('');
      store(FAV_KEY, favs);
      const star = overlay.querySelector('.db-imp-now .db-imp-star');
      if (star) paintStar(star, current);
      if (input.value.trim()) render(groups, active);
      else showStart(active);
    }

    function row(u, i) {
      const now = isNow(u);
      const el = document.createElement('div');
      el.className = 'db-imp-row';
      el.setAttribute('role', 'option');
      if (now) el.setAttribute('aria-disabled', 'true');
      el.title = u.name + (u.email ? ' - ' + u.email : '');
      el.innerHTML = whoHtml(u) + '<span class="db-imp-go">' + (now ? 'Now' : 'Impersonate') + '</span>' + starHtml();
      const star = el.querySelector('.db-imp-star');
      paintStar(star, u);
      star.addEventListener('click', () => !busy && toggleFav(u));
      el.addEventListener('click', (e) => !star.contains(e.target) && pick(i));
      el.addEventListener('mousemove', () => active !== i && !busy && mark(i));
      return el;
    }

    // Groups under their titles; the first user that is not you now is marked.
    function render(next, keep) {
      groups = next;
      items = [];
      list.textContent = '';
      for (const g of groups) {
        if (!g.users.length) continue;
        if (g.title) {
          const title = document.createElement('div');
          title.className = 'db-imp-label';
          title.textContent = g.title;
          list.appendChild(title);
        }
        for (const u of g.users) list.appendChild(row(u, items.push(u) - 1));
      }
      const first = items.findIndex((u) => !isNow(u));
      mark(keep != null && keep < items.length && !isNow(items[keep]) ? keep : first < 0 ? 0 : first);
    }

    async function pick(i) {
      const user = items[i];
      if (!user || busy || isNow(user)) return;
      busy = true;
      overlay.classList.add('db-imp-working');
      const row = list.querySelectorAll('.db-imp-row')[i];
      row.classList.add('db-imp-busy');
      row.querySelector('.db-imp-go').textContent = 'Checking\u2026';
      say('');
      const error = await start(user);
      if (!error) {
        row.querySelector('.db-imp-go').textContent = 'Reloading\u2026';
        return;
      }
      busy = false;
      overlay.classList.remove('db-imp-working');
      render(groups, i);
      say(error, true);
    }

    // Nothing typed: favorites, then recent users - one click away.
    async function showStart(keep) {
      const [recent] = await Promise.all([stored(RECENT_KEY), loaded]);
      if (input.value.trim()) return; // typed meanwhile
      render(
        [
          { title: 'Favorites', users: favs.filter((u) => !isNow(u)) },
          { title: 'Recent', users: recent.filter((u) => !isNow(u) && !isFav(u)) }
        ],
        keep
      );
      say(items.length ? '' : 'Type a name, an email or a user name. \u2605 keeps up to ' + FAVS + ' favorites here.');
    }

    function answer(term, users) {
      render([{ title: '', users: users }]);
      say(users.length ? '' : 'No enabled user matches “' + term + '”.');
    }

    function lookUp() {
      const term = input.value.trim().replace(/\s+/g, ' ');
      clearTimeout(timer);
      clearTimeout(slow);
      if (ctrl) ctrl.abort();
      ctrl = null;
      if (!term) return showStart();
      if (cache.has(term)) return answer(term, cache.get(term));
      // A shorter term that got fewer than a page has every user this one can.
      if (!GUID.test(term)) {
        for (const [t, users] of cache) {
          if (users.length < ROWS && term.startsWith(t) && !GUID.test(t)) {
            const found = users.filter((u) => matches(u, term));
            cache.set(term, found);
            return answer(term, found);
          }
        }
      }
      timer = setTimeout(async () => {
        const mine = (ctrl = new AbortController());
        slow = setTimeout(() => say('Searching…'), 250);
        try {
          const users = await search(term, mine.signal);
          cache.set(term, users);
          if (ctrl === mine) answer(term, users);
        } catch (e) {
          if (ctrl === mine && e.name !== 'AbortError') {
            render([]);
            say('The search failed: ' + (e.message || e), true);
          }
        } finally {
          if (ctrl === mine) clearTimeout(slow);
        }
      }, 120);
    }

    input.addEventListener('input', lookUp);
    input.addEventListener('keydown', (e) => {
      if (busy) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (items.length) mark((active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length, true);
      } else if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        pick(active);
      }
    });
    showStart();
    input.focus();
  }

  // ---------- on the page, while it is on ----------

  const LABEL = 'dynaboost-imp';

  function showLabel() {
    if (!current || document.getElementById(LABEL)) return;
    const box = document.createElement('div');
    box.id = LABEL;
    if (DynaBoost.isDark()) box.className = 'db-dark';
    box.innerHTML =
      '<div class="db-imp-tab">' + PERSON + '<span class="db-imp-tag">Impersonating</span>' +
      '<button type="button" class="db-imp-name" title="Switch to another user"><span></span>' + SWAP + '</button>' +
      '<button type="button" class="db-imp-x" aria-label="Stop impersonating" title="Stop - this tab is you again">×</button></div>';
    const name = box.querySelector('.db-imp-name');
    name.firstChild.textContent = current.name;
    box.querySelector('.db-imp-tab').title =
      'This tab works as ' + current.name + (current.email ? ' (' + current.email + ')' : '') + ' - other tabs are still you';
    name.addEventListener('click', openPicker);
    box.querySelector('.db-imp-x').addEventListener('click', stop);
    document.documentElement.appendChild(box);
  }

  // Once per user and tab: does Dataverse see them in this tab's requests?
  async function confirmOnce() {
    try {
      if (sessionStorage.getItem(SEEN_KEY) === current.id) return;
      sessionStorage.setItem(SEEN_KEY, current.id);
    } catch (e) {
      /* said on every load, then */
    }
    let who = '';
    try {
      who = String((await api('WhoAmI')).UserId || '').toLowerCase();
    } catch (e) {
      toast('Impersonation failed', explain(String(e.message || e), current) + ' Stop it with the × at the bottom.', true);
      return;
    }
    if (who === current.id || !current.reflects)
      toast('Impersonating ' + current.name, 'This tab now reads and saves as them. Other tabs are still you.');
    else toast('Impersonation did not take', 'Dataverse still sees you in this tab. Stop it with the × at the bottom and try again.', true);
  }

  const HINT = 'Work in this tab as another user';
  const feature = {
    id: 'impersonate',
    name: 'Impersonate',
    group: 'Users',
    hosts: ['dynamics.com'],
    when: onOrg,
    type: 'toggle',
    // Its state is this tab's, kept by the background - never stored here.
    session: true,
    hint: HINT,
    icon: ICON,
    onEnable: () => {
      lit = true;
      if (!current) openPicker();
    },
    onDisable: () => {
      if (!lit) return;
      lit = false;
      if (current) stop();
      else if (closePicker) closePicker();
    },
    onReset: (off) => {
      resetTile = off;
    }
  };
  DynaBoost.register(feature);

  if (onOrg()) {
    send({ type: 'DB_IMP_GET' }).then((imp) => {
      if (!imp || !imp.id || imp.host !== host()) return;
      adopt(imp);
      whenBody(confirmOnce);
    });
    whenBody(() => {
      let was = null;
      try {
        was = sessionStorage.getItem(STOPPED_KEY);
        sessionStorage.removeItem(STOPPED_KEY);
      } catch (e) {
        /* nothing to say */
      }
      if (was !== null) toast('Impersonation stopped', (was ? 'No longer ' + was + ' - ' : '') + 'this tab is you again.');
    });
  }
})();
