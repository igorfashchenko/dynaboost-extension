/* Feature: Expand wiki tree.
 *
 * A toggle for Azure DevOps wikis. While on, every collapsed node in the left
 * tree is opened as soon as it appears, so the whole page hierarchy is visible
 * at once instead of one click per level. Turning it off puts back what you
 * had - nodes you expanded yourself are left alone.
 *
 * What we click, and what we must not. A tree node is a
 *     <tr class="bolt-tree-row" role="row" aria-expanded="false">
 * but clicking the ROW opens that wiki page (the row carries
 * single-click-activation), which would navigate away mid-pass. The expander
 * is a separate element inside it:
 *     <span class="bolt-tree-expand-button ... ms-Icon--ChevronRightMed">
 * Leaf pages have no such span at all, so the selector doubles as the filter -
 * no need to guess at labels or roles the way the Power Automate designer
 * needed.
 *
 * Each expand fetches that node's children from the server, so passes are
 * spaced out and capped. A wiki with hundreds of pages would otherwise fire a
 * burst of requests.
 *
 * Why collapsing is paced. Clicking all the chevrons in one synchronous loop
 * loses most of them: ADO rebuilds the table after each collapse, and clicks
 * aimed at rows being replaced land nowhere. Measured on a 21-node tree, a
 * tight loop left 5 nodes open, scattered across levels. So we collapse one
 * node at a time with a short pause, then re-check what is still open and go
 * again, until nothing is left or we run out of passes.
 *
 * Why we track nodes by key rather than by element. Loading children makes ADO
 * re-render the tree, and the <tr> we clicked is often replaced by a new one
 * for the same page. A stored element reference then points at a detached node
 * and collapsing silently skips it - which is exactly how a large wiki failed
 * to fold back. So we remember each row's aria-labelledby (derived from the
 * page name, stable across re-renders) and look the row up again at collapse
 * time.
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

  // Keys of rows we expanded, oldest first. See the header comment on why this
  // is a key and not the element itself.
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
    hint: 'Opens every node of the wiki tree; turning it off collapses only what it opened',
    icon: ICON,
    defaultOn: false,
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
