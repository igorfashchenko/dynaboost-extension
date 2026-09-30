/* Feature: Expand all steps (Power Automate designer and runs).
 *
 * Opens every collapsed container as it appears; off closes what it opened.
 * Left alone: the Office shell (inside .o365sx*), menus and combo boxes
 * (aria-haspopup, roles other than button), the fields and menu of an open
 * card, and DynaBoost's own UI.
 *
 * A branch header is a role="button" with aria-expanded around a button with
 * aria-expanded, so only the outermost toggle of a nested chain is clicked;
 * if it stays collapsed, the inner one is tried next.
 */
(function () {
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="3" y="4" width="18" height="4.5" rx="1.5" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<rect x="3" y="15.5" width="18" height="4.5" rx="1.5" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M12 10v4m0 0-1.8-1.8M12 14l1.8-1.8" stroke="#E3B04B" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  // Everything the Office shell renders lives under one of these.
  const CHROME = '[class*="o365sx"], header, [role="banner"], [role="menu"], [role="menubar"]';
  // DynaBoost's own panel and the dialogs it opens over the page.
  const OWN = '#dynaboost-root, .db-overlay';
  // A field of an open card - a choice list or a picker - is not a step, nor
  // is a card's menu button.
  const FIELD = '[class*="dropdown" i], [class*="combobox" i], [class*="picker" i], [role="combobox"], [role="listbox"]';
  const MENU = '[class*="menu" i]';

  const opened = new Set(); // toggles we clicked, in click order
  const failed = new Set(); // clicked but stayed collapsed - try inside instead

  // Expanding a Scope reveals what is inside it, which may be collapsed too,
  // hence repeated passes. The caps stop a runaway loop on a huge flow, or if
  // a portal change ever breaks the matching above.
  const MAX_PER_PASS = 40;
  const MAX_TOTAL = 400;

  let observer = null;
  let timer = null;
  let total = 0;

  function isCandidate(el) {
    if (el.getAttribute('aria-expanded') !== 'false') return false;
    if (el.hasAttribute('aria-haspopup')) return false;

    const role = el.getAttribute('role');
    if (role && role !== 'button') return false;
    if (el.tagName !== 'BUTTON' && role !== 'button') return false;

    if (el.closest(CHROME) || el.closest(OWN) || el.closest(FIELD) || el.matches(MENU)) return false;

    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function expand() {
    if (total >= MAX_TOTAL) return;

    // A click that did not take: let the nested toggle be tried next.
    for (const el of opened) {
      if (el.isConnected && el.getAttribute('aria-expanded') === 'false') failed.add(el);
    }

    const all = Array.from(document.querySelectorAll('[aria-expanded="false"]')).filter(isCandidate);

    // Keep only the outermost of each nested chain; a toggle that already
    // failed no longer shields the one inside it.
    const targets = all.filter(
      (el) => !all.some((other) => other !== el && !failed.has(other) && other.contains(el))
    );

    let count = 0;
    for (const el of targets) {
      if (count >= MAX_PER_PASS || total >= MAX_TOTAL) break;
      if (opened.has(el)) continue;

      try {
        el.click();
        opened.add(el);
        count++;
        total++;
      } catch (e) {
        /* node went away mid-pass - ignore */
      }
    }

    if (count > 0) schedule();
  }

  function schedule() {
    clearTimeout(timer);
    // Give React time to render the newly revealed nodes before looking again.
    timer = setTimeout(expand, 250);
  }

  /* Collapsing runs newest-first. A container is always opened before the
   * nodes inside it, so reverse order closes the innermost while it is still
   * in the DOM - closing the outer one first would detach its children and
   * leave them stuck open. */
  function collapse() {
    const list = Array.from(opened).reverse();
    opened.clear();
    failed.clear();
    for (const el of list) {
      if (!el.isConnected) continue;
      if (el.getAttribute('aria-expanded') !== 'true') continue;
      try {
        el.click();
      } catch (e) {
        /* ignore */
      }
    }
  }

  DynaBoost.register({
    id: 'expand-all',
    name: 'Expand all steps',
    group: 'Power Automate flows',
    hosts: ['make.powerautomate.com'],
    when: () => /\/flows\//i.test(location.pathname),
    inFrames: true,
    hint: 'Opens every collapsed Condition, branch, Scope and Apply to each; turning it off restores what you had',
    icon: ICON,
    defaultOn: false,
    onEnable() {
      if (observer) return;
      total = 0;
      opened.clear();
      failed.clear();
      observer = new MutationObserver(schedule);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      schedule();
    },
    onDisable() {
      if (!observer) return;
      // Disconnect first - collapsing mutates the DOM, and a live observer
      // would schedule a pass that immediately reopens everything.
      observer.disconnect();
      observer = null;
      clearTimeout(timer);
      collapse();
      total = 0;
    }
  });
})();
