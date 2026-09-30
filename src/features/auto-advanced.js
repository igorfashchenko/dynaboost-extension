/* Feature: Open column details. The New / Edit column panel hides Schema
 * name, Auto number and more behind "Advanced options"; this opens it as the
 * panel renders. Labels in several UI languages. */
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

  // Toggles we already clicked. Used only when the element gives us no
  // aria-expanded to read, to avoid clicking it open then shut again.
  const clicked = new WeakSet();

  let observer = null;
  let timer = null;

  function isAdvancedToggle(el) {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!t || t.length > 40) return false;
    return ADVANCED_LABELS.some((l) => t === l || t.startsWith(l));
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function expand() {
    // Cheap guard: the toggle only lives inside a panel or dialog, so skip the
    // much more expensive scan on ordinary page mutations.
    if (!document.querySelector('[role="dialog"], .ms-Panel, [class*="Panel"]')) return;

    const candidates = document.querySelectorAll('button, a, [role="button"], summary, .ms-Link');
    for (const el of candidates) {
      if (!isAdvancedToggle(el)) continue;
      if (!isVisible(el)) continue;

      const expanded = el.getAttribute('aria-expanded');
      if (expanded === 'true') {
        clicked.add(el);
        continue;
      }
      if (expanded === null && clicked.has(el)) continue;

      clicked.add(el);
      el.click();
    }
  }

  function schedule() {
    clearTimeout(timer);
    // Small delay so React finishes rendering the panel and attaches its click
    // handlers before we fire.
    timer = setTimeout(expand, 200);
  }

  DynaBoost.register({
    id: 'auto-advanced',
    name: 'Open column details',
    group: 'Columns',
    hosts: ['make.powerapps.com'],
    when: () => /\/(entities|tables)\//i.test(location.pathname),
    hint: 'In the New / Edit column panel, expands "Advanced options" for you so Schema name, Auto number and Searchable are visible straight away',
    icon: ICON,
    defaultOn: true,
    onEnable() {
      if (observer) return;
      observer = new MutationObserver(schedule);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      schedule();
    },
    onDisable() {
      if (!observer) return;
      observer.disconnect();
      observer = null;
      clearTimeout(timer);
    }
  });
})();
