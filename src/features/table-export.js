/* Feature: Table export.
 *
 * An action tile: clicking it scrapes the biggest grid on the page and opens a
 * window with the result as Markdown or CSV. Works on the Columns view in
 * make.powerapps.com and on any other Fluent grid, falling back to the header
 * text printed on the page.
 */
(function () {
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="3" y="4" width="18" height="16" rx="2" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M3 9h18M9 9v11" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M14 13.5h5m0 0-2-2m2 2-2 2" stroke="#E3B04B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  // Known labels for the "Columns" view in make.powerapps.com. Other grids
  // (Tables, Choices, Solutions...) use the header text read off the page.
  const LABELS = {
    displayName: 'Display name',
    uniqueName: 'Name',
    'dataType.text': 'Data type',
    formattedIsManaged: 'Managed',
    isCustomized: 'Customized',
    formattedIsCustomizable: 'Customizable',
    formattedIsRequired: 'Required',
    formattedIsSearchable: 'Searchable'
  };
  // Technical columns (checkbox, "..." context menu) that we skip.
  const SKIP_KEYS = new Set(['col0', 'contextualMenu']);
  // Badges appended to the name (e.g. "ProjectCustom").
  const BADGES = ['Primary name column', 'Custom', 'Managed'];
  // Screen-reader-only text explaining a badge, e.g. "This is a custom column."
  const TOOLTIP_RE = /This is (a|the) [a-z\s]+ column\.?/gi;

  function cleanText(el) {
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  // Like cleanText, but skips visually hidden text (screen-reader descriptions
  // appended to "Custom" / "Managed" / "Primary name column" badges). Such text
  // renders at ~1x1px regardless of its content, so this holds no matter how
  // long or different a given badge's text is.
  function visibleText(el) {
    if (!el) return '';
    let text = '';
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_SKIP;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
        const rect = parent.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walker.nextNode())) text += n.nodeValue;
    return text.replace(/\s+/g, ' ').trim();
  }

  function cleanDisplayName(raw) {
    let s = raw.replace(TOOLTIP_RE, '');
    let changed = true;
    while (changed) {
      changed = false;
      for (const b of BADGES) {
        if (s.endsWith(b)) {
          s = s.slice(0, s.length - b.length);
          changed = true;
        }
      }
    }
    return s.trim();
  }

  function findGrid() {
    const grids = Array.from(document.querySelectorAll('[role="grid"]'));
    let best = null;
    let bestCount = -1;
    for (const g of grids) {
      const count = g.querySelectorAll('[role="row"]').length;
      if (count > bestCount) {
        best = g;
        bestCount = count;
      }
    }
    return best;
  }

  function findScrollParent(el) {
    let node = el;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 5) {
        return node;
      }
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function getHeaders(grid) {
    const headerCells = Array.from(grid.querySelectorAll('[role="columnheader"]'));
    return headerCells
      .map((c, i) => ({
        key: c.getAttribute('data-automation-key') || c.getAttribute('data-item-key') || 'col' + i,
        label: cleanText(c).replace(/^Sort by\s*/i, '').replace(/[▲▼]/g, '').trim()
      }))
      .filter((h) => !SKIP_KEYS.has(h.key));
  }

  function getRows(grid) {
    return Array.from(grid.querySelectorAll('[role="row"]')).filter((r) => r.querySelector('[role="gridcell"]'));
  }

  function extractRow(row) {
    const cells = Array.from(row.querySelectorAll('[role="gridcell"]'));
    const obj = {};
    cells.forEach((cell) => {
      const key = cell.getAttribute('data-automation-key');
      if (!key || SKIP_KEYS.has(key)) return;
      let val = key === 'displayName' ? visibleText(cell) : cleanText(cell);
      if (key === 'displayName') val = cleanDisplayName(val);
      obj[key] = val;
    });
    return obj;
  }

  async function scrapeAll(onProgress) {
    const grid = findGrid();
    if (!grid) throw new Error('No grid on this page. Open a list view and try again.');
    const headers = getHeaders(grid);
    const scrollParent = findScrollParent(grid);
    const captured = new Map();
    let stagnant = 0;
    let lastScrollTop = -1;

    for (let i = 0; i < 1000; i++) {
      const rows = getRows(grid);
      for (const row of rows) {
        const data = extractRow(row);
        const key = data.uniqueName || data.displayName || JSON.stringify(data);
        if (key) captured.set(key, data);
      }
      if (onProgress) onProgress(captured.size);

      if (scrollParent.scrollTop === lastScrollTop) {
        stagnant++;
        if (stagnant > 3) break;
      } else {
        stagnant = 0;
      }
      lastScrollTop = scrollParent.scrollTop;
      scrollParent.scrollTop += Math.max(200, scrollParent.clientHeight * 0.8);
      await new Promise((r) => setTimeout(r, 150));
      if (scrollParent.scrollTop + scrollParent.clientHeight >= scrollParent.scrollHeight - 2 && stagnant > 0) break;
    }

    return { headers, rows: Array.from(captured.values()) };
  }

  // ---------- file name ----------

  /* The URL carries only GUIDs (.../entities/{id}/fields), so the name
   * has to come from the breadcrumb printed above the grid, e.g.
   *   "My Solution > Tables > Account"
   *   "My Solution > Cloud flows"
   * That covers pages with no entity behind them (Cloud flows) as well. */
  /* A breadcrumb item usually carries its label twice - the visible button
   * plus a hidden copy for screen readers or the overflow tooltip. That is how
   * "Cloud flows" comes out as "Cloud flowsCloud flows". */
  function undouble(s) {
    const t = s.trim();
    if (t.length > 1 && t.length % 2 === 0) {
      const half = t.length / 2;
      if (t.slice(0, half) === t.slice(half)) return t.slice(0, half).trim();
    }
    // Same thing with a separator between the copies: "Tables Tables".
    const m = t.match(/^(.+?)[\s_-]+\1$/);
    return m ? m[1].trim() : t;
  }

  function getBreadcrumbParts() {
    const containers = document.querySelectorAll(
      '.ms-Breadcrumb, [class*="readcrumb"], nav[aria-label], [role="navigation"]'
    );
    for (const box of containers) {
      let items = Array.from(box.querySelectorAll('li'));
      if (!items.length) items = Array.from(box.children);

      const parts = [];
      for (const it of items) {
        // visibleText drops the screen-reader copy; undouble catches the case
        // where both copies are actually rendered.
        const t = undouble(
          visibleText(it).replace(/[>›»\/\\]+/g, ' ').replace(/\s+/g, ' ').trim()
        );
        if (!t || t.length > 60) continue;
        // Nested markup (li > button > span) yields the same text repeatedly.
        if (parts.some((p) => p === t || p.includes(t) || t.includes(p))) continue;
        parts.push(t);
      }
      if (parts.length) return parts;
    }
    return [];
  }

  function buildFileName() {
    let parts = getBreadcrumbParts();

    if (!parts.length) {
      for (const el of document.querySelectorAll('[role="heading"][aria-level="1"], h1, h2')) {
        const t = cleanText(el);
        if (t && t.length < 80) {
          parts = [t];
          break;
        }
      }
    }
    if (!parts.length) {
      const t = document.title.split('|')[0].trim();
      if (t && !/^power apps$/i.test(t)) parts = [t];
    }
    if (!parts.length) parts = ['table'];

    // The first crumb is the solution / environment name. It repeats in every
    // file and eats the length budget, so drop it - unless it is all we have.
    if (parts.length > 1) parts = parts.slice(1);

    const name =
      parts
        .join('_')
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .replace(/[\s_]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 120) || 'table';

    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const stamp =
      d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      '_' + p(d.getHours()) + '-' + p(d.getMinutes());

    return name + '_' + stamp + '.csv';
  }

  // ---------- output ----------

  function toMarkdown(headers, rows) {
    const cols = headers.map((h) => LABELS[h.key] || h.label || h.key);
    const lines = [];
    lines.push('| ' + cols.join(' | ') + ' |');
    lines.push('| ' + cols.map(() => '---').join(' | ') + ' |');
    for (const row of rows) {
      lines.push('| ' + headers.map((h) => (row[h.key] || '').replace(/\|/g, '\\|')).join(' | ') + ' |');
    }
    return lines.join('\n');
  }

  function toCSV(headers, rows) {
    const cols = headers.map((h) => LABELS[h.key] || h.label || h.key);
    const esc = (v) => {
      const s = (v || '').toString();
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [cols.map(esc).join(',')];
    for (const row of rows) lines.push(headers.map((h) => esc(row[h.key])).join(','));
    return lines.join('\n');
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e2) {
        return false;
      }
    }
  }

  function downloadCSV(text, filename) {
    const blob = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function buildDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'db-overlay' + (DynaBoost.isDark && DynaBoost.isDark() ? ' db-dark' : '');
    overlay.innerHTML =
      '<div class="db-dialog">' +
      '  <div class="db-dialog-head"><span>Table export</span>' +
      '    <button type="button" data-db="close" aria-label="Close">\u2715</button></div>' +
      '  <div class="db-status" data-db="status"></div>' +
      '  <textarea class="db-output" data-db="output" spellcheck="false"></textarea>' +
      '  <div class="db-dialog-actions">' +
      '    <button type="button" data-db="md">Copy as Markdown</button>' +
      '    <button type="button" data-db="csv">Copy as CSV</button>' +
      '    <button type="button" data-db="download">Download CSV</button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('[data-db="close"]').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    return overlay;
  }

  async function run() {
    // Read the breadcrumb before the dialog goes up and before scraping
    // scrolls the page around.
    const fileName = buildFileName();

    const overlay = buildDialog();
    const statusEl = overlay.querySelector('[data-db="status"]');
    const outputEl = overlay.querySelector('[data-db="output"]');
    statusEl.textContent = 'Scanning...';
    try {
      const { headers, rows } = await scrapeAll((count) => {
        statusEl.textContent = 'Scanning... ' + count + ' rows so far';
      });
      const md = toMarkdown(headers, rows);
      const csv = toCSV(headers, rows);
      statusEl.textContent = rows.length + ' rows, ' + headers.length + ' columns.';
      outputEl.value = md;

      const failed = 'Copy did not go through. Select the text and press Ctrl+C.';
      overlay.querySelector('[data-db="md"]').addEventListener('click', async () => {
        outputEl.value = md;
        statusEl.textContent = (await copyToClipboard(md)) ? 'Copied as Markdown.' : failed;
      });
      overlay.querySelector('[data-db="csv"]').addEventListener('click', async () => {
        outputEl.value = csv;
        statusEl.textContent = (await copyToClipboard(csv)) ? 'Copied as CSV.' : failed;
      });
      overlay.querySelector('[data-db="download"]').addEventListener('click', () => {
        downloadCSV(csv, fileName);
      });
    } catch (e) {
      statusEl.textContent = e.message;
    }
  }

  DynaBoost.register({
    id: 'table-export',
    name: 'Export table',
    group: 'Lists and grids',
    hosts: ['make.powerapps.com'],
    // A list page of the maker portal (tables, columns, solutions...), not
    // the canvas Studio or a flow.
    when: () => !/\/canvas\//i.test(location.pathname),
    type: 'action',
    hint: 'Copy or download this list as Markdown or CSV',
    icon: ICON,
    onRun: run
  });
})();
