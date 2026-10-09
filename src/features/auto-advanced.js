/* Feature: Open advanced options. The New / Edit table and New / Edit column
 * panels hide Schema name, Type, Record ownership, Auto number, Searchable
 * and more behind "Advanced options"; this opens it as the panel renders.
 * Labels in several UI languages. */
(function () {
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M5 7h14M5 12h14M5 17h9" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="m15.5 16 2.5 2.5 3.5-4" stroke="#E3B04B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  const ADVANCED_LABELS = [
    'advanced options',
    'opcje zaawansowane',
    'zaawansowane opcje',
    'erweiterte optionen',
    'options avancées',
    'opciones avanzadas',
    'opzioni avanzate',
    'geavanceerde opties'
  ];

  // Side panels, drawers and dialogs - where the toggle lives.
  const PANES = '[role="dialog"], [role="complementary"], aside, .ms-Panel, [class*="Panel"], [class*="Drawer"], [class*="drawer"]';
  const TOGGLES = 'button, a, [role="button"], summary, .ms-Link';
  const TABLE_PAGES = /\/(entities|tables)(\/|$)|\/solutions\/[^/]+/i;
  const SETTLE = 1500;

  // Toggles the user clicked themselves: theirs from then on, so one they
  // close stays closed.
  const byUser = new WeakSet();
  // toggle -> { at, n }: our last click on it and how many so far
  const tried = new WeakMap();
  const TRIES = 3;
  // Panes where a toggle without aria-expanded was clicked. Such a toggle may
  // be drawn again after the click, so it is clicked once per pane.
  const opened = new WeakSet();
  // Panes counted as a use, for Time saved: once each, however many clicks.
  const counted = new WeakSet();

  let observer = null;
  let timer = null;

  // Icon fonts put their glyph (private use area) in the text, before or
  // after the label.
  function labelOf(el) {
    return (el.textContent || '')
      .replace(/[\uE000-\uF8FF]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^[^\p{L}]+|[^\p{L})]+$/gu, '')
      .toLowerCase();
  }

  function isAdvancedToggle(el) {
    const t = labelOf(el);
    if (!t || t.length > 40) return false;
    return ADVANCED_LABELS.some((l) => t === l || t.startsWith(l));
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function expand() {
    const roots = Array.from(document.querySelectorAll(PANES));
    // The table pages may show the properties outside any pane.
    if (TABLE_PAGES.test(location.pathname) && document.body) roots.push(document.body);
    if (!roots.length) return;

    const seen = new Set();
    const now = Date.now();
    let retry = 0;
    for (const root of roots) {
      for (const el of root.querySelectorAll(TOGGLES)) {
        if (seen.has(el) || byUser.has(el)) continue;
        seen.add(el);
        if (!isAdvancedToggle(el) || !isVisible(el)) continue;
        const state = el.getAttribute('aria-expanded');
        if (state === 'true') continue;
        if (state === null) {
          const pane = el.closest(PANES) || document.body;
          if (opened.has(pane)) continue;
          opened.add(pane);
        } else {
          const mine = tried.get(el) || { at: 0, n: 0 };
          if (mine.n >= TRIES) continue;
          if (now - mine.at < SETTLE) {
            retry = Math.max(retry, SETTLE - (now - mine.at) + 50);
            continue;
          }
          tried.set(el, { at: now, n: mine.n + 1 });
          retry = Math.max(retry, SETTLE + 50);
        }
        el.click();
        const pane = el.closest(PANES) || document.body;
        if (!counted.has(pane)) {
          counted.add(pane);
          DynaBoost.saved('auto-advanced');
        }
      }
    }
    // A click that did not take gets another once the pane has settled, up
    // to TRIES in all.
    if (retry) schedule(retry);
  }

  function onUserClick(e) {
    if (!e.isTrusted || !e.target || !e.target.closest) return;
    const el = e.target.closest(TOGGLES);
    if (el) byUser.add(el);
  }

  function schedule(delay) {
    clearTimeout(timer);
    // Small delay so React finishes rendering the panel and attaches its click
    // handlers before we fire.
    timer = setTimeout(expand, delay || 200);
  }

  DynaBoost.register({
    id: 'auto-advanced',
    name: 'Open advanced options',
    group: 'Tables and columns',
    hosts: ['make.powerapps.com'],
    when: () => TABLE_PAGES.test(location.pathname),
    hint: 'Opens “Advanced options” in table and column panels',
    icon: ICON,
    defaultOn: true,
    onEnable() {
      if (observer) return;
      observer = new MutationObserver(() => schedule());
      observer.observe(document.documentElement, { childList: true, subtree: true });
      document.addEventListener('click', onUserClick, true);
      schedule();
    },
    onDisable() {
      if (!observer) return;
      observer.disconnect();
      observer = null;
      document.removeEventListener('click', onUserClick, true);
      clearTimeout(timer);
    }
  });
})();
