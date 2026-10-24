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
 *
 * The designer draws a step anew when you click around, and leaves out the
 * steps that are off screen - so off closes the steps it opened by what they
 * are (keyOf), not only by the elements it clicked: those drawn anew, and
 * those drawn later, as they come into view.
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
  const openedKeys = new Set(); // what they are - see keyOf()

  // Expanding a Scope reveals what is inside it, which may be collapsed too,
  // hence repeated passes. The caps stop a runaway loop on a huge flow, or if
  // a portal change ever breaks the matching above.
  const MAX_PER_PASS = 40;
  const MAX_TOTAL = 400;

  let observer = null;
  let timer = null;
  let total = 0;

  function isCandidate(el) {
    return el.getAttribute('aria-expanded') === 'false' && isToggle(el);
  }

  function isToggle(el) {
    if (el.hasAttribute('aria-haspopup')) return false;

    const role = el.getAttribute('role');
    if (role && role !== 'button') return false;
    if (el.tagName !== 'BUTTON' && role !== 'button') return false;

    if (el.closest(CHROME) || el.closest(OWN) || el.closest(FIELD) || el.matches(MENU)) return false;

    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /* A toggle, the same however often it is drawn: the step it is in (its
   * data-id, data-automation-id or data-testid, and those around it up to
   * the step's node) and its own label, without the words that flip with it
   * (Expand / Collapse, Show / Hide...). */
  const STEP_ATTRS = ['data-id', 'data-automation-id', 'data-testid'];
  const FLIPS = /\b(expand(ed)?|collapsed?|show|hide|more|less|open|close|toggle)\b/gi;
  function keyOf(el) {
    const label = (el.getAttribute('aria-label') || el.textContent || '').replace(FLIPS, ' ').replace(/[^\p{L}\p{N}_]+/gu, ' ').trim().slice(0, 80);
    const step = [];
    for (let n = el, up = 0; n && n !== document.body && up < 15; n = n.parentElement, up++) {
      for (const a of STEP_ATTRS) {
        const v = n.getAttribute(a);
        if (v) step.push(a + '=' + v);
      }
      if (n.hasAttribute('data-id')) break; // the step's node: unique in the flow
    }
    return step.join('/') + '|' + label;
  }

  function expand() {
    timer = null;
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
      // Drawn anew by an earlier click of this pass: the next pass finds it.
      if (opened.has(el) || !el.isConnected) continue;

      try {
        const key = keyOf(el);
        el.click();
        opened.add(el);
        openedKeys.add(key);
        count++;
        total++;
      } catch (e) {
        /* node went away mid-pass - ignore */
      }
    }

    if (count > 0) schedule();
  }

  /* Give React time to render the newly revealed nodes before looking
   * again - but no longer: while the pointer moves over the designer the
   * page changes all the time, and putting the pass off at every change
   * stalled it until the mouse stood still. */
  function schedule() {
    if (timer) return;
    timer = setTimeout(expand, 250);
  }

  /* Collapsing runs newest-first. A container is always opened before the
   * nodes inside it, so reverse order closes the innermost while it is still
   * in the DOM - closing the outer one first would detach its children and
   * leave them stuck open. */
  function collapse() {
    const list = Array.from(opened).reverse();
    const keys = new Set(openedKeys);
    opened.clear();
    failed.clear();
    openedKeys.clear();
    const clicked = new WeakSet();
    for (const el of list) {
      if (!el.isConnected) continue;
      if (el.getAttribute('aria-expanded') !== 'true') continue;
      try {
        el.click();
        clicked.add(el);
      } catch (e) {
        /* ignore */
      }
    }
    if (keys.size) closeRest(keys, clicked);
  }

  /* Then the steps it opened that the first round could not reach: drawn
   * anew, or out of view until now - closed as they show up open, dropped
   * as they show up closed. On the same page, for ten minutes at most; on
   * again, it stops. */
  let closing = null; // { keys, clicked, observer, timer, until, href }
  const CLOSE_FOR = 10 * 60 * 1000;

  function closeRest(keys, clicked) {
    stopClosing();
    closing = { keys: keys, clicked: clicked, timer: null, until: Date.now() + CLOSE_FOR, href: location.href };
    closing.observer = new MutationObserver(closeSoon);
    closing.observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'] });
    closeSoon();
  }

  function closeSoon() {
    if (!closing || closing.timer) return;
    closing.timer = setTimeout(closePass, 300);
  }

  function closePass() {
    if (!closing) return;
    closing.timer = null;
    if (Date.now() > closing.until || location.href !== closing.href) return stopClosing();
    const open = [];
    const shut = new Set();
    for (const el of document.querySelectorAll('[aria-expanded]')) {
      if (!isToggle(el)) continue;
      const key = keyOf(el);
      if (!closing.keys.has(key)) continue;
      if (el.getAttribute('aria-expanded') !== 'true') shut.add(key);
      else if (!closing.clicked.has(el)) open.push({ el: el, key: key });
    }
    // The innermost first, as above: later in the page is further in.
    for (const x of open.reverse()) {
      closing.clicked.add(x.el);
      shut.delete(x.key);
      try {
        x.el.click();
      } catch (e) {
        /* ignore */
      }
    }
    for (const key of shut) closing.keys.delete(key);
    if (!closing.keys.size) stopClosing();
  }

  function stopClosing() {
    if (!closing) return;
    closing.observer.disconnect();
    clearTimeout(closing.timer);
    closing = null;
  }

  DynaBoost.register({
    id: 'expand-all',
    name: 'Expand all steps',
    group: 'Power Automate flows',
    hosts: ['make.powerautomate.com'],
    when: () => /\/flows\//i.test(location.pathname),
    inFrames: true,
    hint: 'Opens every collapsed step of the flow',
    icon: ICON,
    defaultOn: false,
    countClick: true,
    onEnable() {
      if (observer) return;
      stopClosing();
      total = 0;
      opened.clear();
      failed.clear();
      openedKeys.clear();
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
      timer = null;
      collapse();
      total = 0;
    }
  });
})();
