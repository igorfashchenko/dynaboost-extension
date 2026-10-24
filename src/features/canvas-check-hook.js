/* DynaBoost - page-world helper for App checker report, in the canvas Studio
 * frame (authoring.*.gateway.prod.island.powerapps.com).
 *
 * Reads Studio's App checker as a person would: opens its pane, goes into
 * each category with issues, opens every group in it and reads each issue -
 * its rule, where it is, what the pane says about it. For a formula issue it
 * then clicks the issue, so Studio goes to that control and property, and
 * reads the formula bar: the formula, and each problem as View Problem
 * (Alt+F8) shows it. Nothing is changed in the app; the pane is left on its
 * list of categories.
 *
 * Studio bundles Monaco without a global, so the formula bar's editor is
 * reached through the React tree, as in canvas-code-hook.js.
 *
 * When the pane is not found or reads empty, the answer carries its layout -
 * tags, roles, class names and the length of each text, never a text - to
 * mend the reading with.
 *
 * Messages are accepted from, and replies sent to, make.powerapps.com only.
 */
(function () {
  /* A frame keeps the copy it was given until it reloads; after an update
   * the panel has a newer one put in (background.js). The newest copy runs,
   * an older one stands down - its listener checks the version on every
   * message. Copies from before the version answered another name. */
  const VERSION = 4;
  if ((window.__dynaboostCheckHookV || 0) >= VERSION) return;
  window.__dynaboostCheckHookV = VERSION;
  const current = () => window.__dynaboostCheckHookV === VERSION;

  const SRC = 'dynaboost-canvas-check-v';
  const PARENT = 'https://make.powerapps.com';
  const CATEGORIES = ['Formulas', 'Runtime', 'Accessibility', 'Performance', 'Data source', 'Rules', 'Variables'];
  const FORMULA_CATEGORIES = ['Formulas', 'Runtime'];
  const UI_WORDS = /^(back|close|recheck all|expand|collapse|error|warning|tip|more|less|how to fix|why fix|learn more|view problem|app checker|formulas|runtime|accessibility|performance|data source|rules|variables)$/i;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const textOf = (el) => (el ? (el.innerText || el.textContent || '').replace(/[\uE000-\uF8FF]/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim() : '');
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  function press(el) {
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, clientX: r.left + Math.min(20, r.width / 2), clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', at));
    el.dispatchEvent(new MouseEvent('mousedown', at));
    el.dispatchEvent(new PointerEvent('pointerup', at));
    el.dispatchEvent(new MouseEvent('mouseup', at));
    el.dispatchEvent(new MouseEvent('click', at));
  }

  async function until(fn, ms) {
    const end = Date.now() + ms;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(120);
    }
  }

  // ---------- the pane ----------

  /* Everything happens inside App checker's pane, and nothing is pressed
   * outside it: the app's own screens are drawn on the same page, with
   * buttons of their own (a Back that leaves the app, say). The pane is
   * known by its heading, "App checker", with Recheck all under it; it is the
   * box around them that is still a side pane - narrower than half the
   * page - so it stays the same while it shows a category. */
  const CLICKABLE = 'button, [role="button"], [role="menuitem"], [role="listitem"], [role="treeitem"], [role="option"], [role="tab"], [role="link"], a';
  const flat = (el) => textOf(el).replace(/\s+/g, ' ').trim();
  let root = null; // the pane, once found

  function headings() {
    const out = [];
    for (const el of document.querySelectorAll('h1, h2, h3, h4, [role="heading"], span, div, label')) {
      if (flat(el) === 'App checker' && visible(el) && !Array.from(el.children).some((c) => flat(c) === 'App checker')) out.push(el);
    }
    return out;
  }

  const inside = (el) => !!root && !!el && root.contains(el);

  // Still the pane: on the page, and showing Recheck all or a Back - Studio
  // empties or redraws it when it goes to a formula.
  const alive = (r) => !!r && r.isConnected && visible(r) && (!!recheckIn(r) || Array.from(r.querySelectorAll('button, [role="button"]')).some((b) => visible(b) && isBack(b)));

  function findPane() {
    if (alive(root)) return root;
    root = null;
    for (const h of headings()) {
      let p = h;
      for (let i = 0; p && i < 10 && !recheckIn(p); i++) p = p.parentElement;
      if (!p || !recheckIn(p)) continue;
      while (p.parentElement && p.parentElement !== document.body && p.parentElement.getBoundingClientRect().width < window.innerWidth * 0.5) p = p.parentElement;
      root = p;
      return root;
    }
    return null;
  }

  function recheckIn(box) {
    for (const el of box.querySelectorAll('*')) {
      if (visible(el) && (/^recheck( all)?$/i.test(flat(el)) || /^recheck/i.test(el.getAttribute('aria-label') || ''))) return el.closest(CLICKABLE) || el;
    }
    return null;
  }

  // Studio's own button for the pane - never anything on the app's screens.
  // With a control selected, Studio's command bar is fuller and App checker
  // goes into its overflow (...): looked for there too - in the command bar
  // only.
  const BARS = '[role="menubar"], [role="toolbar"], [class*="CommandBar" i], [class*="commandbar" i]';
  const isOpener = (b) => visible(b) && /^app checker\b/i.test((b.getAttribute('aria-label') || b.getAttribute('title') || flat(b)).trim());
  let lastMiss = ''; // why the pane could not be opened, for the steps

  async function openPane(log) {
    if (findPane()) return root;
    lastMiss = '';
    let opener = Array.from(document.querySelectorAll('button, [role="menuitem"]')).find(isOpener);
    if (!opener) {
      const more = Array.from(document.querySelectorAll(BARS))
        .flatMap((bar) => Array.from(bar.querySelectorAll('button, [role="button"], [role="menuitem"]')))
        .find((b) => visible(b) && /^(more|more commands|see more|more options|overflow|\.\.\.|…)$/i.test((b.getAttribute('aria-label') || b.getAttribute('title') || flat(b)).trim()) || /overflow/i.test(String(b.className || '')));
      if (more) {
        press(more);
        opener = await until(() => Array.from(document.querySelectorAll('[role="menuitem"], [role="menu"] button, button')).find(isOpener), 2000);
        if (!opener) {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          lastMiss = 'App checker is in no menu';
        }
      } else lastMiss = 'no App checker button, nor a ... in the command bar';
    }
    if (!opener) return null;
    log('Opened the App checker pane');
    press(opener);
    const pane = await until(findPane, 6000);
    if (!pane) lastMiss = 'the pane did not come';
    return pane;
  }

  // "Formulas (16)": a category and its count; one with no count has none.
  const CATEGORY = new RegExp('^(' + CATEGORIES.join('|') + ')(?:\\s*\\((\\d+)\\))?$');

  /* The rows: the text that is a category's name, widened to the biggest box
   * that still says only that (the chevron has no text) - whatever element
   * Studio makes it. */
  function categoryRows() {
    if (!findPane()) return [];
    const rows = [];
    for (const el of root.querySelectorAll('*')) {
      if (!visible(el)) continue;
      const m = flat(el).match(CATEGORY);
      if (!m || Array.from(el.children).some((c) => flat(c) === flat(el))) continue;
      let row = el;
      while (row.parentElement && row.parentElement !== root && flat(row.parentElement) === flat(el)) row = row.parentElement;
      if (rows.some((r) => r.name === m[1])) continue;
      rows.push({ el: row, name: m[1], count: m[2] ? Number(m[2]) : 0 });
    }
    return rows;
  }

  // The list of categories shows: two rows at least - inside a category its
  // name alone is the heading.
  const onList = () => categoryRows().length >= 2;

  function categoryOf(el) {
    const m = flat(el).match(CATEGORY);
    return m ? { name: m[1], count: m[2] ? Number(m[2]) : 0 } : null;
  }

  const isBack = (b) => /^\s*back\s*$|go back|navigate back/i.test(b.getAttribute('aria-label') || '') || /^\s*back\s*$|go back/i.test(b.getAttribute('title') || '') || /^\s*(back|go back)\s*$/i.test(textOf(b));

  // Back, inside a category: by its name - or the pane's first button, with
  // no text, before the category's name.
  function backButton() {
    if (!findPane()) return null;
    for (const b of root.querySelectorAll('button, [role="button"]')) if (visible(b) && isBack(b)) return b;
    return null;
  }

  // What takes you elsewhere - Live monitor, a page of the docs, a menu - is
  // never pressed, nor counted as an issue.
  const AWAY = /monitor|learn more|docs|documentation|feedback|more options|open in|share/i;
  function away(el) {
    const words = (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + textOf(el);
    return AWAY.test(words) || (el.tagName === 'A' && /^https?:/i.test(el.getAttribute('href') || '')) || el.hasAttribute('aria-haspopup');
  }

  function pressInPane(el) {
    if (!inside(el)) throw new Error('Not pressed: outside App checker');
    if (away(el) || el.closest('a[href^="http"]')) throw new Error('Not pressed: it leads away');
    press(el);
  }

  // ---------- inside a category ----------

  // Every group closed in it opened - issues are grouped by rule.
  async function openGroups() {
    for (let round = 0; round < 40; round++) {
      if (!findPane()) return;
      const closed = Array.from(root.querySelectorAll('[aria-expanded="false"]')).filter((el) => visible(el) && !away(el));
      if (!closed.length) return;
      closed.forEach(pressInPane);
      await sleep(250);
    }
  }

  const NOT_ISSUE = /^(back|close|recheck|recheck all|learn more|how to fix|why fix|expand|collapse)$/i;
  // Each issue has a button over it, "Navigate to review issue details." -
  // its words hidden, for screen readers. It is how Studio goes to the issue;
  // the issue's own lines are around it.
  const NAV = /navigate to review|review issue details|go to issue|navigate to issue/i;
  const isNav = (el) => NAV.test((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + textOf(el));
  const withoutNav = (t) => t.split('\n').filter((l) => !NAV.test(l)).join('\n').trim();

  /* The issues: [{ box, nav }]. Where Studio gives each its navigate button,
   * the box is the smallest one around it with lines of its own; otherwise
   * the innermost boxes of the list that carry text, read line by line as
   * the pane shows them. */
  function issueBoxes(pane) {
    if (!pane) return [];
    const navs = Array.from(pane.querySelectorAll('button, [role="button"], [role="link"], a')).filter((b) => visible(b) && isNav(b) && !away(b));
    if (navs.length) {
      return navs.map((nav) => {
        let box = nav.parentElement;
        while (box && box !== pane && !/[\p{L}\p{N}]{2}/u.test(withoutNav(textOf(box)))) box = box.parentElement;
        return { box: box && box !== pane ? box : nav, nav: nav };
      });
    }
    return oldBoxes(pane).map((box) => ({ box: box, nav: box }));
  }

  function oldBoxes(pane) {
    const all = Array.from(pane.querySelectorAll('[role="listitem"], [role="treeitem"], [role="option"], [role="row"], [role="button"], button, [class*="issue" i], [class*="item" i], [class*="card" i]'))
      .filter((el) => visible(el) && /[\p{L}\p{N}]{2}/u.test(textOf(el)) && !NOT_ISSUE.test(textOf(el)) && !NOT_ISSUE.test(el.getAttribute('aria-label') || '') && !categoryOf(el) && !isBack(el) && !away(el));
    // A group header (it opens or closes) is not an issue; neither is a box
    // that holds others.
    return all.filter((el) => !el.hasAttribute('aria-expanded') && !all.some((o) => o !== el && el.contains(o) && textOf(o).length > 3));
  }

  const SEVERITY = /\b(error|warning|tip|info|information)\b/i;
  const LOCATION = /([A-Za-z_][\w]*(?:\s*[>›»/]\s*[A-Za-z_][\w]*)*)\s*[.›>]\s*([A-Za-z_][A-Za-z]\w*)\s*$/;

  function issueOf(box, group) {
    const lines = [];
    for (const l of withoutNav(textOf(box)).split('\n').map((x) => x.trim())) {
      if (!l || NOT_ISSUE.test(l)) continue;
      // "lblHint" then ".Text": one place.
      if (/^\.[A-Za-z]\w*$/.test(l) && lines.length) lines[lines.length - 1] += l;
      else lines.push(l);
    }
    let severity = '';
    for (const el of [box].concat(Array.from(box.querySelectorAll('[aria-label], [class*="error" i], [class*="warning" i], [class*="tip" i], [data-icon-name], i, svg')))) {
      const hint = (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('data-icon-name') || '') + ' ' + String(el.className && el.className.baseVal != null ? el.className.baseVal : el.className || '');
      const m = hint.match(SEVERITY);
      if (m) {
        severity = m[1].toLowerCase().replace('information', 'info');
        break;
      }
    }
    const where = lines.find((l) => LOCATION.test(l) && l.length < 120);
    let location = null;
    if (where) {
      const m = where.match(LOCATION);
      const parts = m[1].split(/\s*[>›»/]\s*/);
      location = { text: where, control: parts[parts.length - 1], screen: parts.length > 1 ? parts[0] : '', property: m[2] };
    }
    const title = lines.find((l) => l !== where) || group || lines[0] || '';
    return { title: title, group: group || '', severity: severity, location: location, lines: lines };
  }

  // The group an issue is under: the nearest group header above it.
  function groupOf(box, pane, boxes) {
    // A Fluent GroupedList: the issues under a group header, its title the rule.
    let gh = null;
    for (const h of pane.querySelectorAll('.ms-GroupHeader, [class*="GroupHeader"]')) {
      if (h.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING && !h.contains(box)) gh = h;
    }
    const ghTitle = gh && flat(gh.querySelector('.ms-GroupHeader-title, [class*="title" i]') || gh).replace(/\s*\(\d+\)\s*$/, '');
    if (ghTitle && !CATEGORY.test(ghTitle)) return ghTitle;
    // The row's own label, when it says more than the lines it shows.
    for (let el = box, up = 0; el && el !== pane && up < 4; el = el.parentElement, up++) {
      const label = (el.getAttribute('aria-label') || '').trim();
      if (label && !NAV.test(label) && !textOf(box).includes(label) && /[\p{L}]{3}/u.test(label)) return label;
    }
    let header = null;
    for (const h of pane.querySelectorAll('[aria-expanded]')) {
      if (h.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING) header = h;
    }
    if (header) return textOf(header).split('\n')[0].replace(/\s*\(\d+\)\s*$/, '');
    const texts = [];
    const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!(n.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING) && !box.contains(n)) break;
      if (box.contains(n)) break;
      const t = (n.nodeValue || '').replace(/[\uE000-\uF8FF]/g, '').trim();
      if (!t || !/[\p{L}]{2}/u.test(t) || NOT_ISSUE.test(t) || NAV.test(t) || CATEGORY.test(t)) continue;
      const parent = n.parentElement;
      if (!parent || !visible(parent) || (boxes || []).some((b) => b.contains(parent))) continue;
      texts.push(t);
    }
    return texts.length ? texts[texts.length - 1].replace(/\s*\(\d+\)\s*$/, '') : '';
  }

  // ---------- the formula bar ----------

  function isEditor(v) {
    return !!v && typeof v === 'object' && typeof v.getModel === 'function' && typeof v.updateOptions === 'function';
  }

  function fiberOf(el) {
    const k = Object.keys(el).find((x) => x.startsWith('__reactInternalInstance') || x.startsWith('__reactFiber'));
    return k ? el[k] : null;
  }

  function editorFor(node) {
    let el = node.parentElement;
    while (el && !fiberOf(el)) el = el.parentElement;
    let f = el && fiberOf(el);
    for (let n = 0; f && n < 60; n++, f = f.return) {
      const cands = [f.memoizedProps, f.stateNode];
      let s = f.memoizedState;
      for (let i = 0; s && i < 30; i++, s = s.next) cands.push(s.memoizedState, s.memoizedState && s.memoizedState.current);
      for (const v of cands) {
        if (isEditor(v)) return v;
        if (v && typeof v === 'object') {
          for (const k of Object.keys(v).slice(0, 60)) {
            try {
              const x = v[k];
              if (isEditor(x)) return x;
              if (x && isEditor(x.current)) return x.current;
            } catch (e) {
              /* a getter that throws */
            }
          }
        }
      }
    }
    return null;
  }

  // The formula bar: a Monaco editor outside every dialog and the pane.
  function formulaBar(pane) {
    const all = Array.from(document.querySelectorAll('.monaco-editor'))
      .filter((node) => visible(node) && !node.closest('.ms-Dialog-main, [role="dialog"]'))
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    for (const node of all.filter((n) => !(pane && pane.contains(n))).concat(all)) {
      const ed = editorFor(node);
      if (ed && ed.getModel()) return { ed: ed, node: node };
    }
    return null;
  }

  // The property the formula bar shows, from the property picker next to it.
  function barProperty(bar) {
    let p = bar.node;
    for (let i = 0; p && i < 8; i++, p = p.parentElement) {
      const pick = p.querySelector('[role="combobox"], input[aria-label*="propert" i]');
      if (pick) return (pick.value || textOf(pick) || pick.getAttribute('aria-label') || '').trim();
    }
    return '';
  }

  /* Each problem as View Problem (Alt+F8) shows it, read from the widget it
   * opens; when the widget does not come, from the squiggles' messages. */
  /* Studio's squiggles - the wavy lines under what is wrong - as Monaco
   * draws them: a decoration of class squiggly-error / -warning / -info
   * over each problem's whole range. */
  function squiggles(model) {
    const out = [];
    try {
      for (const d of model.getAllDecorations()) {
        const m = String((d.options && d.options.className) || '').match(/squiggly-(error|warning|info|hint)/);
        if (!m) continue;
        const r = d.range;
        const key = [r.startLineNumber, r.startColumn, r.endLineNumber, r.endColumn, m[1]].join(':');
        if (out.some((x) => x.key === key)) continue;
        out.push({ key: key, severity: m[1], range: { line: r.startLineNumber, column: r.startColumn, endLine: r.endLineNumber, endColumn: r.endColumn }, text: model.getValueInRange(r) });
      }
    } catch (e) {
      /* no decorations to read */
    }
    return out;
  }

  // The squiggle a problem starts at - or the one around that place.
  function squiggleAt(marks, at) {
    if (!at) return null;
    const after = (l, c, L, C) => l > L || (l === L && c >= C);
    return (
      marks.find((m) => m.range.line === at.line && m.range.column === at.column) ||
      marks.find((m) => after(at.line, at.column, m.range.line, m.range.column) && after(m.range.endLine, m.range.endColumn, at.line, at.column)) ||
      null
    );
  }

  async function problemsIn(bar) {
    const out = await problemsOnly(bar);
    const marks = squiggles(bar.ed.getModel());
    for (const p of out) {
      const m = squiggleAt(marks, p.at);
      if (m) Object.assign(p, { range: m.range, text: m.text, severity: p.severity || m.severity });
    }
    return out;
  }

  async function problemsOnly(bar) {
    const out = [];
    const model = bar.ed.getModel();
    const seen = new Set();
    try {
      bar.ed.focus();
      for (let i = 0; i < 12; i++) {
        bar.ed.trigger('dynaboost', 'editor.action.marker.next', null);
        const widget = await until(() => {
          const w = document.querySelector('.marker-widget, .zone-widget .message');
          return w && textOf(w.querySelector('.message') || w) ? w : null;
        }, 1500);
        if (!widget) break;
        await sleep(80);
        const box = widget.closest('.marker-widget') || widget;
        const message = textOf(box.querySelector('.message') || box).replace(/\s*\n\s*/g, ' ');
        const title = textOf(box.closest('.zone-widget') && box.closest('.zone-widget').querySelector('.peekview-title, .title'));
        const pos = bar.ed.getPosition();
        const key = message + '@' + (pos ? pos.lineNumber + ':' + pos.column : '');
        if (!message || seen.has(key)) break;
        seen.add(key);
        out.push({ message: message, count: title, at: pos ? { line: pos.lineNumber, column: pos.column } : null, near: pos ? model.getLineContent(pos.lineNumber).slice(Math.max(0, pos.column - 21), pos.column + 40) : '' });
      }
      bar.ed.trigger('dynaboost', 'closeMarkersNavigation', null);
    } catch (e) {
      /* the action is not there - the squiggles below */
    }
    if (out.length) return out;
    try {
      for (const d of model.getAllDecorations()) {
        const cls = (d.options && d.options.className) || '';
        if (!/squiggly-(error|warning|info)/.test(cls)) continue;
        const hover = [].concat(d.options.hoverMessage || []).map((h) => (h && h.value) || '').filter(Boolean).join(' ');
        out.push({ message: hover, severity: cls.match(/squiggly-(\w+)/)[1], at: { line: d.range.startLineNumber, column: d.range.startColumn } });
      }
    } catch (e) {
      /* no decorations either */
    }
    return out;
  }

  // ---------- reading it all ----------

  // Into a category: the pane opened again if Studio closed it, back to its
  // list, the category's row, its groups opened.
  /* The pane's heading says where it is: "App checker" on the list, the
   * category's name inside it - its issues, or one issue's details, which
   * "Navigate to review issue details" opens. */
  const heading = () => {
    const h = findPane() && root.querySelector('h1, h2, [role="heading"]');
    return h ? flat(h) : '';
  };
  const inIssues = (name) => heading() === name && issueBoxes(root).length > 0;

  // Back to the list of categories - from an issue's details that is twice.
  async function toList() {
    for (let i = 0; i < 4 && findPane() && !onList(); i++) {
      const b = backButton();
      if (!b) break;
      pressInPane(b);
      await until(onList, 2500);
      await sleep(150);
    }
    return onList();
  }

  // '' when in, else why not. Back as often as it takes - from an issue's
  // details to its category, from there to the list - or not at all when
  // the category's issues show already.
  async function enter(name, log) {
    if (!findPane() && !(await openPane(log))) return 'the pane could not be opened again - ' + lastMiss;
    for (let i = 0; i < 4 && !onList() && !inIssues(name); i++) {
      const b = backButton();
      if (!b) break;
      pressInPane(b);
      await until(() => onList() || inIssues(name), 2500);
      await sleep(200);
    }
    if (inIssues(name)) {
      await openGroups();
      return '';
    }
    if (!onList()) return 'neither the list of categories nor this one\'s issues - Back ' + (backButton() ? 'there' : 'not there');
    const row = categoryRows().find((r) => r.name === name);
    if (!row) return 'its row is not in the list';
    pressInPane(row.el);
    await until(() => !onList() && findPane(), 2500);
    await sleep(300);
    await openGroups();
    return findPane() ? '' : 'the pane went';
  }

  let running = false;

  async function read(opts, progress) {
    const steps = [];
    const log = (t) => {
      steps.push(t);
      progress(t);
    };
    root = null;
    if (!(await openPane(log))) return { error: 'no-pane', layout: layout(document.body, 5) };
    // Inside a category already: back to the list first.
    for (let i = 0; i < 3 && !onList(); i++) {
      const back = backButton();
      if (!back) break;
      pressInPane(back);
      await sleep(500);
    }
    if (opts.recheck) {
      const r = recheckIn(root);
      if (r) {
        log('Checking the app again');
        pressInPane(r);
        await sleep(2500);
        await until(onList, 15000);
      }
    }
    const listed = onList() ? categoryRows() : [];
    if (!listed.length) return { error: 'no-categories', layout: layout(root, 12) };
    const categories = [];
    for (const c of listed) {
      const entry = { name: c.name, count: c.count, issues: [] };
      categories.push(entry);
      if (!c.count) continue;
      log('Reading ' + c.name + ' (' + c.count + ')');
      if (!findPane()) {
        steps.push('The pane went before ' + c.name + ' - opened again');
        if (!(await openPane(log))) break;
        await until(onList, 3000);
      }
      if (!onList() && !(await toList())) steps.push(c.name + ': not back on the list of categories');
      const row = categoryRows().find((r) => r.name === c.name);
      if (!row) {
        steps.push(c.name + ': not in the list');
        continue;
      }
      pressInPane(row.el);
      // Into the category - or, where it opens in place, the list stays.
      const into = await until(() => !onList() && findPane(), 2500);
      if (!findPane()) break;
      await sleep(300);
      await openGroups();
      const found = issueBoxes(root);
      for (const it of found) entry.issues.push(issueOf(it.box, groupOf(it.box, root, found.map((f) => f.box))));
      entry.layout = layout(root, 30);
      steps.push(c.name + ': ' + entry.issues.length + ' of ' + c.count + ' read');
      // Formula issues: Studio goes to each place (control and property)
      // once - the issues there share its formula - and the formula bar is
      // read once it has changed. Studio closes the pane on the way, so it
      // and the category are opened again for the next place. The steps say
      // why a place was not read - by number, never by name.
      if (opts.formulas && FORMULA_CATEGORIES.indexOf(c.name) >= 0) {
        const places = [];
        entry.issues.forEach((it, n) => {
          const key = it.location ? it.location.text : '#' + n;
          let p = places.find((x) => x.key === key);
          if (!p) places.push((p = { key: key, idx: [] }));
          p.idx.push(n);
        });
        const keyOf = (b) => b.ed.getModel().getValue() + '\u0000' + barProperty(b);
        for (let k = 0; k < places.length; k++) {
          const n = places[k].idx[0];
          const at = c.name + ', place ' + (k + 1) + ' of ' + places.length + ' (issue ' + (n + 1) + ')';
          progress('Reading ' + c.name + ' - formula ' + (k + 1) + ' of ' + places.length);
          let its = findPane() && !onList() ? issueBoxes(root) : [];
          if (!its[n]) {
            const why = await enter(c.name, log);
            if (why) {
              steps.push(at + ': ' + why);
              if (/opened again/.test(why)) entry.bars = layout(document.querySelector(BARS) || document.body, 8);
              break;
            }
            its = issueBoxes(root);
          }
          if (!its[n]) {
            steps.push(at + ': not in the list - ' + its.length + ' issues there');
            break;
          }
          const before = formulaBar(root);
          const was = before ? keyOf(before) : null;
          pressInPane(its[n].nav);
          let bar = await until(() => {
            const b = formulaBar(findPane());
            return b && keyOf(b) !== was ? b : null;
          }, 3000);
          if (!bar) {
            bar = formulaBar(findPane());
            steps.push(at + ': ' + (bar ? 'the formula bar did not change - read as it is' : 'no formula bar'));
          }
          if (!bar) continue;
          await sleep(250);
          const got = { formula: bar.ed.getModel().getValue(), property: barProperty(bar), problems: await problemsIn(bar) };
          for (const i of places[k].idx) Object.assign(entry.issues[i], got);
          // The pane now shows the issue's details: their lines kept with it.
          await until(() => findPane() && !onList() && !issueBoxes(root).length, 1200);
          if (findPane() && !onList() && !issueBoxes(root).length) {
            const box = root.querySelector('[class*="detailsContainer"]') || root;
            const raw = [];
            for (const l of textOf(box).split('\n').map((x) => x.trim())) {
              if (!l || NOT_ISSUE.test(l) || NAV.test(l) || l === c.name) continue;
              if (/^\.[A-Za-z]\w*$/.test(l) && raw.length) raw[raw.length - 1] += l;
              else raw.push(l);
            }
            // "Issue" and "Location", each with its value: in the report already.
            const lines = raw.filter((l, i) => !/^(issue|location)$/i.test(l) && !/^(issue|location)$/i.test(raw[i - 1] || ''));
            if (lines.length) entry.issues[n].details = lines;
            if (!entry.detailLayout) entry.detailLayout = layout(root, 16);
          }
          steps.push(at + ': read, ' + got.problems.length + ' problem' + (got.problems.length === 1 ? '' : 's'));
        }
      }
      if (!findPane()) {
        steps.push('The pane went after ' + c.name + ' - opened again');
        if (!(await openPane(log))) break;
      }
      if (into) {
        if (!(await toList())) steps.push('After ' + c.name + ': not back on the list of categories');
      } else {
        const again = categoryRows().find((r) => r.name === c.name);
        if (again) pressInPane(again.el); // closed again
        await sleep(300);
      }
    }
    return { categories: categories, steps: steps, layout: findPane() ? layout(root, 10) : '' };
  }

  /* The layout of a part of the page, to mend the reading with: tags, roles,
   * class names, aria-expanded, and only the length of each text - except
   * Studio's own words (Back, Recheck all, the category names). */
  function layout(root, depth) {
    const out = [];
    const walk = (el, d) => {
      if (!el || d > depth || out.length > 2000) return;
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3 && n.nodeValue.trim())
        .map((n) => n.nodeValue.trim())
        .join(' ');
      const label = el.getAttribute('aria-label') || '';
      const word = (t) => (!t ? '' : UI_WORDS.test(t.replace(/\s*\(\d+\)$/, '')) ? '"' + t + '"' : '#' + t.length);
      out.push(
        '  '.repeat(d) + (visible(el) ? '' : '(hidden) ') + el.tagName.toLowerCase() +
          (el.getAttribute('role') ? '[role=' + el.getAttribute('role') + ']' : '') +
          (el.hasAttribute('aria-expanded') ? '[expanded=' + el.getAttribute('aria-expanded') + ']' : '') +
          (label ? '[label ' + word(label) + ']' : '') +
          (typeof el.className === 'string' && el.className ? ' .' + el.className.trim().split(/\s+/).slice(0, 4).join('.') : '') +
          (own ? ' text ' + word(own) : '')
      );
      for (const c of el.children) walk(c, d + 1);
    };
    walk(root, 0);
    return out.join('\n');
  }

  window.addEventListener('message', async (e) => {
    if (e.origin !== PARENT) return;
    const d = e.data;
    if (!d || d.source !== SRC || !current()) return;
    const reply = (msg) => e.source.postMessage(Object.assign({ source: SRC, nonce: d.nonce, version: VERSION }, msg), PARENT);
    if (d.type === 'hello') return reply({ type: 'hello' });
    if (d.type !== 'read') return;
    if (running) return reply({ type: 'done', error: 'busy' });
    running = true;
    let result;
    try {
      result = await read({ recheck: !!d.recheck, formulas: d.formulas !== false }, (text) => reply({ type: 'progress', text: text }));
    } catch (err) {
      result = { error: 'exception', message: String(err && err.message) };
    } finally {
      running = false;
    }
    reply(Object.assign({ type: 'done' }, result));
  });
})();
