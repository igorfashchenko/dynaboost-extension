/* Feature: Column defaults. When the New column panel opens, sets its
 * checkboxes the way the project wants them - for now one: "Allow form fill
 * assistance" is cleared. Only in a New column panel, never when editing a
 * column; a checkbox the user clicks is left as they set it. */
(function () {
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="3.5" y="4.5" width="7" height="7" rx="1.5" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<rect x="3.5" y="13.5" width="7" height="7" rx="1.5" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="m5.3 8 1.4 1.4 2.4-2.6" stroke="#3D8BFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M13.5 8h7M13.5 17h7" stroke="#E3B04B" stroke-width="1.6" stroke-linecap="round"/>' +
    '</svg>';

  // What each rule wants, by the checkbox's label (lower case, no "(preview)").
  const RULES = [{ labels: ['allow form fill assistance'], checked: false }];

  const NEW_COLUMN = ['new column', 'nowa kolumna', 'neue spalte', 'nouvelle colonne', 'nueva columna', 'nuova colonna', 'nieuwe kolom'];
  const PANES = '[role="dialog"], [role="complementary"], aside, .ms-Panel, [class*="Panel"], [class*="Drawer"], [class*="drawer"]';
  const HEADINGS = 'h1, h2, h3, [role="heading"], [class*="title"], [class*="Title"], [class*="header"], [class*="Header"]';
  const BOXES = 'input[type="checkbox"], [role="checkbox"]';

  // Checkboxes set here, or by the user: each is set once.
  const handled = new WeakSet();

  let observer = null;
  let timer = null;

  const norm = (t) =>
    String(t || '')
      .replace(/[\uE000-\uF8FF]/g, '')
      .replace(/\(\s*preview\s*\)/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  function isNewColumnPane(pane) {
    const label = norm(pane.getAttribute('aria-label'));
    if (NEW_COLUMN.some((l) => label === l || label.startsWith(l + ' '))) return true;
    for (const h of pane.querySelectorAll(HEADINGS)) {
      const t = norm(h.textContent);
      if (t.length <= 40 && NEW_COLUMN.some((l) => t === l)) return true;
    }
    return false;
  }

  // The text a checkbox is known by: its label element, aria-label or
  // aria-labelledby, else the nearest wrapper's own text.
  function labelOf(box) {
    if (box.labels && box.labels.length) return norm(box.labels[0].textContent);
    if (box.getAttribute('aria-label')) return norm(box.getAttribute('aria-label'));
    const by = box.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((e) => e.textContent).join(' ');
      if (t) return norm(t);
    }
    const wrap = box.closest('.ms-Checkbox, [class*="Checkbox"], label') || box.parentElement;
    return wrap ? norm(wrap.textContent) : '';
  }

  const isChecked = (box) => (box.tagName === 'INPUT' ? box.checked : box.getAttribute('aria-checked') === 'true');

  function apply() {
    for (const pane of document.querySelectorAll(PANES)) {
      if (!isNewColumnPane(pane)) continue;
      for (const box of pane.querySelectorAll(BOXES)) {
        if (handled.has(box) || box.disabled || box.getAttribute('aria-disabled') === 'true') continue;
        const label = labelOf(box);
        const rule = RULES.find((r) => r.labels.some((l) => label === l || label.startsWith(l)));
        if (!rule) continue;
        handled.add(box);
        if (isChecked(box) !== rule.checked) {
          box.click();
          DynaBoost.saved('column-defaults');
        }
      }
    }
  }

  function onUserClick(e) {
    if (!e.isTrusted || !e.target || !e.target.closest) return;
    const wrap = e.target.closest('label, .ms-Checkbox, [class*="Checkbox"], [role="checkbox"], input[type="checkbox"]');
    if (!wrap) return;
    const box = wrap.matches(BOXES) ? wrap : wrap.querySelector(BOXES) || (wrap.htmlFor && document.getElementById(wrap.htmlFor));
    if (box) handled.add(box);
  }

  function schedule() {
    clearTimeout(timer);
    // After React has drawn the panel and its default values.
    timer = setTimeout(apply, 250);
  }

  DynaBoost.register({
    id: 'column-defaults',
    name: 'Column defaults',
    group: 'Tables and columns',
    hosts: ['make.powerapps.com'],
    when: () => /\/(entities|tables)(\/|$)|\/solutions\/[^/]+/i.test(location.pathname),
    hint: 'New columns start without form fill assistance',
    icon: ICON,
    defaultOn: true,
    onEnable() {
      if (observer) return;
      observer = new MutationObserver(schedule);
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
