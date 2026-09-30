/* Feature: Expand items (Azure DevOps taskboard and backlogs).
 *
 * Taskboard: while on, every collapsed row opens as it appears. Off closes
 * them again, except the rows you had opened yourself - stored per sprint, so
 * after a reload rows ADO kept open are not mistaken for yours.
 *
 * A parent row has button.taskboard-expand-collapse-button; its icon tells
 * open (ms-Icon--TriangleSolidDown12) from closed (...Right12), since the
 * aria-label is in the user's language. Rows are tracked by work item id
 * (data-itemid on the card, the end of the button id), never by element: the
 * table is virtualised. Each id is handled once per visit, so a row closed by
 * hand stays closed.
 *
 * Backlogs: "Expand one level" (button.expand-collapse-button, icon
 * ms-Icon--Add; ms-Icon--Remove collapses) is clicked level by level, once per
 * visit; off collapses the list the same way.
 */
(function () {
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="3" y="4" width="18" height="16" rx="2" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M3 9.5h18M3 15h18" stroke="#3D8BFF" stroke-width="1.6" opacity=".45"/>' +
    '<path d="m6 6 1.4 1.4L6 8.8M6 11.4l1.4 1.4L6 14.2" stroke="#E3B04B" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  const STORE_KEY = 'dynaboost.adoTaskboardOpen'; // sprint path -> [ids you had open]
  const KEEP = 30; // sprints remembered
  const BUTTON = 'button.taskboard-expand-collapse-button';
  const BATCH = 12; // clicks per pass
  const DELAY = 80;

  function onTaskboard() {
    return /\/_sprints\/taskboard\//i.test(location.pathname);
  }

  function onBacklog() {
    return /\/_(backlogs|sprints)\/backlog(\/|$)/i.test(location.pathname);
  }

  function idOf(button) {
    const row = button.closest('tr');
    const card = row && row.querySelector('.taskboard-parent-cell [data-itemid]');
    if (card) return card.getAttribute('data-itemid');
    const m = (button.id || '').match(/(\d+)$/);
    return m ? m[1] : null;
  }

  function isOpen(button) {
    const icon = button.querySelector('[class*="ms-Icon--Triangle"]');
    if (icon) return /TriangleSolidDown/.test(icon.className);
    return /^collapse/i.test(button.getAttribute('aria-label') || '');
  }

  // ---------- storage ----------

  function readAll() {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORE_KEY, (data) => resolve((data && data[STORE_KEY]) || {}));
    });
  }

  async function save(key, ids) {
    const all = await readAll();
    delete all[key]; // re-insert last, so it counts as the newest
    all[key] = ids;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) delete all[k];
    chrome.storage.local.set({ [STORE_KEY]: all });
  }

  async function drop(key) {
    const all = await readAll();
    if (!(key in all)) return;
    delete all[key];
    chrome.storage.local.set({ [STORE_KEY]: all });
  }

  // ---------- state ----------

  let on = false;
  let observer = null;
  let timer = null;
  let board = null; // the sprint path the state below belongs to
  let state = null; // { user, snapshot, saved, handled, closed, restore }

  function schedule() {
    if (timer) return;
    timer = setTimeout(pass, DELAY);
  }

  function watch() {
    if (observer) return;
    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    schedule();
  }

  async function loadBoard(key) {
    const all = await readAll();
    if (board !== key) return; // moved on while reading
    const stored = all[key];
    state = {
      user: new Set(stored || []),
      snapshot: !stored, // no stored set: take it from what is open on screen
      saved: !!stored,
      savedSize: stored ? stored.length : -1,
      handled: new Set(),
      closed: new Set(),
      restore: !on && !!stored
    };
    if (!on && stored) drop(key); // restoring now; the set lives on in memory for this visit
    schedule();
  }

  function pass() {
    timer = null;
    if (onBacklog()) {
      board = null;
      state = null;
      backlogPass();
      return;
    }
    if (!onTaskboard()) {
      board = null;
      state = null;
      return;
    }
    const key = location.pathname;
    if (key !== board) {
      board = key;
      state = null;
      loadBoard(key);
      return;
    }
    if (!state) return; // still reading storage
    if (on) openPass(key);
    else if (state.restore) closePass();
  }

  function openPass(key) {
    const toOpen = [];
    let seen = false;
    for (const b of document.querySelectorAll(BUTTON)) {
      const id = idOf(b);
      if (!id) continue;
      seen = true;
      if (state.handled.has(id)) continue;
      state.handled.add(id);
      if (isOpen(b)) {
        if (state.snapshot) state.user.add(id);
      } else {
        toOpen.push(b);
      }
    }
    // Store the set as soon as the board shows rows - even an empty one, so
    // after a reload rows ADO kept open are not mistaken for yours - and again
    // only when it grows (a row of yours scrolled into view).
    if (seen && state.snapshot && (!state.saved || state.user.size !== state.savedSize)) {
      save(key, Array.from(state.user));
      state.saved = true;
      state.savedSize = state.user.size;
    }
    toOpen.slice(0, BATCH).forEach((b) => {
      try {
        b.click();
      } catch (e) {
        /* row re-rendered mid-pass - the next pass picks it up */
      }
    });
    if (toOpen.length > BATCH) {
      // Not handled yet after all: let the next pass click the rest.
      toOpen.slice(BATCH).forEach((b) => state.handled.delete(idOf(b)));
      schedule();
    }
  }

  function closePass() {
    let clicked = 0;
    for (const b of document.querySelectorAll(BUTTON)) {
      if (clicked >= BATCH) {
        schedule();
        break;
      }
      const id = idOf(b);
      if (!id || state.user.has(id) || state.closed.has(id) || !isOpen(b)) continue;
      state.closed.add(id); // once: open it again by hand and it stays open
      try {
        b.click();
        clicked++;
      } catch (e) {
        state.closed.delete(id);
      }
    }
  }

  // ---------- backlogs ----------

  const LEVELS = 6; // Epic > Feature > Story > Task is three; room for custom levels
  const STEP = 450; // a level re-renders the list before the next click
  const SETTLE = 700; // the list loads after the toolbar
  let expanded = null; // the backlog path this visit has expanded
  let stepping = false;

  function levelButton(icon) {
    for (const b of document.querySelectorAll('button.expand-collapse-button')) {
      if (b.querySelector('.ms-Icon--' + icon)) return b;
    }
    return null;
  }

  const usable = (b) => !!b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && !b.classList.contains('disabled');

  // Clicks one button until it gives out, the levels run out, you leave, or
  // the toggle flips the other way (expanding stops the moment it is off).
  async function stepAll(icon, key) {
    const wanted = icon === 'Add';
    stepping = true;
    try {
      for (let i = 0; i < LEVELS; i++) {
        const b = levelButton(icon);
        if (!usable(b) || location.pathname !== key || on !== wanted) break;
        b.click();
        await new Promise((r) => setTimeout(r, STEP));
      }
    } finally {
      stepping = false;
    }
  }

  function backlogPass() {
    const key = location.pathname;
    if (!on || stepping || expanded === key) return;
    if (!levelButton('Add')) return; // toolbar not drawn yet - the observer calls again
    expanded = key;
    setTimeout(() => {
      if (on && location.pathname === key) stepAll('Add', key);
    }, SETTLE);
  }

  DynaBoost.register({
    id: 'ado-taskboard-expand',
    name: 'Expand items',
    group: 'Azure DevOps',
    hosts: ['dev.azure.com', 'visualstudio.com'],
    when: () => onTaskboard() || onBacklog(),
    hint: 'Opens every item on the sprint taskboard and on backlogs, on every one you open. Turning it off closes them again - on the taskboard, except the ones you had opened yourself',
    icon: ICON,
    defaultOn: false,
    onEnable() {
      on = true;
      // A fresh look at the sprint on screen: what is open now is yours.
      board = null;
      state = null;
      expanded = null;
      watch();
    },
    onDisable() {
      const wasOn = on;
      on = false;
      if (wasOn && onBacklog() && expanded === location.pathname) {
        expanded = null;
        stepAll('Remove', location.pathname);
        return;
      }
      expanded = null;
      if (wasOn && state && board) {
        state.restore = true;
        drop(board);
        schedule();
        return;
      }
      // Off as the page loads: stay idle unless some sprint still carries a
      // set from when the toggle was on - then close it on the next visit.
      readAll().then((all) => {
        if (!on && Object.keys(all).length) watch();
      });
    }
  });
})();
