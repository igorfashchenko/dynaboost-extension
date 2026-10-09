/* Feature: Expand wiki tree (Azure DevOps). Opens every collapsed node of the
 * wiki tree as it appears; off closes what it opened and leaves your own.
 *
 * Only the chevron (span.bolt-tree-expand-button) is clicked - a click on the
 * row opens the page. Each expand loads children from the server, so passes
 * are spaced and capped. Collapsing goes one node at a time with a pause and
 * checks again, since ADO rebuilds the table after each collapse. Rows are
 * kept by aria-labelledby, not by element: re-renders replace them.
 */
(function () {
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M4 5h6M4 12h6M4 19h6" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="M14 5h6M14 12h6M14 19h6" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round" opacity=".45"/>' +
    '<path d="m12.2 8.4 2.4 2.4-2.4 2.4" stroke="#E3B04B" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  const ROW = 'tr.bolt-tree-row[aria-expanded]';
  const CHEVRON = '.bolt-tree-expand-button';

  // aria-labelledby of the rows expanded, oldest first.
  const opened = [];
  const openedSet = new Set();

  // Expanding a node reveals children that may be collapsed too, hence the
  // repeated passes. Caps guard against a very large wiki or a portal change.
  const MAX_PER_PASS = 15;
  const MAX_TOTAL = 300;
  // Children arrive over the network, so give them longer than a local render.
  const DELAY = 500;
  // Collapsing is local, so it needs only enough time for the table to settle.
  const COLLAPSE_DELAY = 130;
  const COLLAPSE_PASSES = 6;

  let observer = null;
  let timer = null;
  let total = 0;
  // Bumped on every enable/disable so a collapse still in flight stops when the
  // user flips the toggle back on.
  let session = 0;

  function keyOf(row) {
    return row.getAttribute('aria-labelledby') || row.id || null;
  }

  function rowByKey(key) {
    return document.querySelector(
      'tr.bolt-tree-row[aria-labelledby="' + CSS.escape(key) + '"]'
    ) || document.getElementById(key);
  }

  function chevronOf(row) {
    // Scoped to this row's own cell - a nested tree would otherwise hand us a
    // descendant row's chevron.
    const cell = row.querySelector('.wiki-page-name-cell') || row;
    return cell.querySelector(CHEVRON);
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function expand() {
    if (total >= MAX_TOTAL) return;

    let count = 0;
    const rows = document.querySelectorAll(ROW);

    for (const row of rows) {
      if (count >= MAX_PER_PASS || total >= MAX_TOTAL) break;
      if (row.getAttribute('aria-expanded') !== 'false') continue;

      const key = keyOf(row);
      if (key && openedSet.has(key)) continue;

      const chevron = chevronOf(row);
      if (!chevron || !isVisible(chevron)) continue;

      try {
        chevron.click();
        if (key) {
          opened.push(key);
          openedSet.add(key);
        }
        count++;
        total++;
      } catch (e) {
        /* row went away mid-pass - ignore */
      }
    }

    if (count > 0) schedule();
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(expand, DELAY);
  }

  /* Collapsing runs newest-first: a parent is always opened before its
   * children, so reverse order closes the deepest node while it is still in
   * the DOM. Closing the parent first would detach the children and leave them
   * expanded underneath. */
  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function collapse() {
    const keys = opened.slice().reverse();
    opened.length = 0;
    openedSet.clear();

    const mine = session;

    for (let pass = 0; pass < COLLAPSE_PASSES; pass++) {
      let left = 0;

      for (const key of keys) {
        if (session !== mine) return; // toggled back on - stop touching the page

        const row = rowByKey(key);
        if (!row || !row.isConnected) continue;
        if (row.getAttribute('aria-expanded') !== 'true') continue;

        const chevron = chevronOf(row);
        if (!chevron) continue;

        try {
          chevron.click();
        } catch (e) {
          /* ignore */
        }
        left++;
        await wait(COLLAPSE_DELAY);
      }

      // Nothing was still open on this sweep, so we are done.
      if (!left) return;
    }
  }

  DynaBoost.register({
    id: 'wiki-expand',
    name: 'Expand wiki tree',
    group: 'Azure DevOps',
    hosts: ['dev.azure.com', 'visualstudio.com'],
    when: () => /\/_wiki\b/i.test(location.pathname),
    hint: 'Opens every node of the wiki tree',
    icon: ICON,
    defaultOn: false,
    countClick: true,
    onEnable() {
      if (observer) return;
      session++;
      total = 0;
      opened.length = 0;
      openedSet.clear();
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
      session++;
      total = 0;
      collapse();
    }
  });
})();
