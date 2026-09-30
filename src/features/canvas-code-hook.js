/* DynaBoost - page-world helper for Edit screen code, in the canvas Studio
 * frame (authoring.*.gateway.prod.island.powerapps.com).
 *
 * Reads the YAML of the open View code dialog. Studio bundles Monaco without
 * a global, so the editor is reached through the React tree, which only the
 * page world can see.
 *
 * Apply to Studio does what a person would do in the tree view: deletes the
 * controls being replaced (the row's context menu) and pastes the new YAML (a
 * paste event on the row). It is Studio's own paste and delete - Ctrl+Z undoes
 * it, and nothing is saved until you Save. Collapsed branches are opened on
 * the way and closed again. Every step goes into a log the editor shows.
 *
 * Messages are accepted from, and replies sent to, make.powerapps.com only.
 */
(function () {
  if (window.__dynaboostCanvasHook) return;
  window.__dynaboostCanvasHook = true;

  const SRC = 'dynaboost-canvas-code';
  const PARENT = 'https://make.powerapps.com';

  function isEditor(v) {
    return !!v && typeof v === 'object' && typeof v.getModel === 'function' && typeof v.updateOptions === 'function';
  }

  function fiberOf(el) {
    const k = Object.keys(el).find((x) => x.startsWith('__reactInternalInstance') || x.startsWith('__reactFiber'));
    return k ? el[k] : null;
  }

  // Walk up from the Monaco DOM to the component holding the instance in a ref.
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
              // getters that throw - skip
            }
          }
        }
      }
    }
    return null;
  }

  // The View code dialog is a Fluent dialog; the formula bar also runs on
  // Monaco but never inside one. With several open, the longest text wins.
  function readCode() {
    let best = null;
    for (const node of document.querySelectorAll('.ms-Dialog-main .monaco-editor, [role="dialog"] .monaco-editor')) {
      const ed = editorFor(node);
      const model = ed && ed.getModel();
      if (!model) continue;
      const text = model.getValue();
      if (!best || text.length > best.text.length) {
        const dialog = node.closest('.ms-Dialog-main, [role="dialog"]');
        const title = dialog && dialog.querySelector('.ms-Dialog-title, [id$="-title"]');
        best = { text: text, title: title ? title.textContent.trim() : '', screen: screenFor(text) };
      }
    }
    return best;
  }

  // ---------- apply ----------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function rowOf(name) {
    for (const r of document.querySelectorAll('.pa-tree-row[aria-label]')) {
      if (r.getAttribute('aria-label') === name) return r;
    }
    return null;
  }

  function levelOf(row) {
    return parseInt(row.getAttribute('aria-level') || '0', 10);
  }

  // The screen a control row sits under: an enclosing level-1 tree item
  // (nested tree), or the nearest level-1 row before it (flat tree).
  function screenOf(row) {
    let p = row.parentElement && row.parentElement.closest('.pa-tree-row');
    while (p) {
      if (levelOf(p) === 1) return p;
      p = p.parentElement && p.parentElement.closest('.pa-tree-row');
    }
    const rows = Array.from(document.querySelectorAll('.pa-tree-row'));
    for (let i = rows.indexOf(row) - 1; i >= 0; i--) if (levelOf(rows[i]) === 1) return rows[i];
    return null;
  }

  // The screen of the first top-level control in the code, while it is still
  // in the tree - remembered by the editor so a paste of new controls later
  // knows where to go.
  function screenFor(text) {
    const m = String(text).match(/^-\s+([^\s:#'"][^:#]*?):\s*$/m);
    const row = m && rowOf(m[1].trim());
    const scr = row && screenOf(row);
    return scr ? scr.getAttribute('aria-label') : '';
  }

  function select(row) {
    const r = row.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, clientX: r.left + 24, clientY: r.top + r.height / 2, button: 0 };
    row.dispatchEvent(new MouseEvent('mousedown', at));
    row.dispatchEvent(new MouseEvent('mouseup', at));
    row.dispatchEvent(new MouseEvent('click', at));
    if (row.focus) row.focus();
  }

  async function waitItem(re, tries) {
    for (let i = 0; i < (tries || 20); i++) {
      await sleep(100);
      const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find((m) => re.test(m.textContent.trim()));
      if (item) return item;
    }
    return null;
  }

  function closeMenus() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  async function menuItem(row, re) {
    const r = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 24, clientY: r.top + r.height / 2, button: 2 }));
    const item = await waitItem(re);
    if (!item) closeMenus();
    return item;
  }

  // An item straight in the context menu, or under a submenu (Reorder).
  async function menuPath(row, sub, re) {
    const direct = await menuItem(row, new RegExp('(' + re.source + ')|(' + sub.source + ')', 'i'));
    if (!direct) return null;
    if (re.test(direct.textContent.trim())) return direct;
    direct.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    direct.dispatchEvent(new MouseEvent('mouseenter'));
    direct.click();
    const item = await waitItem(re, 10);
    if (!item) closeMenus();
    return item;
  }

  function closeViewCode() {
    for (const dlg of document.querySelectorAll('.ms-Dialog-main')) {
      if (!dlg.querySelector('.monaco-editor')) continue;
      const btn = dlg.querySelector('button[aria-label="Close"], button[aria-label="Zamknij"], .ms-Dialog-button--close');
      if (btn) btn.click();
    }
  }

  // The row one level up: the enclosing tree item (nested tree) or the
  // nearest shallower row before it (flat tree).
  function parentOf(row) {
    const up = row.parentElement && row.parentElement.closest('.pa-tree-row');
    if (up) return up;
    const lvl = levelOf(row);
    const rows = Array.from(document.querySelectorAll('.pa-tree-row'));
    for (let i = rows.indexOf(row) - 1; i >= 0; i--) if (levelOf(rows[i]) === lvl - 1) return rows[i];
    return null;
  }

  function childrenOf(row) {
    const lvl = levelOf(row);
    const nested = Array.from(row.querySelectorAll('.pa-tree-row')).filter((r) => levelOf(r) === lvl + 1);
    if (nested.length) return nested;
    const rows = Array.from(document.querySelectorAll('.pa-tree-row'));
    const out = [];
    for (let i = rows.indexOf(row) + 1; i < rows.length && levelOf(rows[i]) > lvl; i++) if (levelOf(rows[i]) === lvl + 1) out.push(rows[i]);
    return out;
  }

  function screens() {
    return Array.from(document.querySelectorAll('.pa-tree-row')).filter((r) => levelOf(r) === 1 && r.getAttribute('aria-label') !== 'App');
  }

  // Collapsed branches have no rows in the DOM. Studio's own "Expand all"
  // on each screen puts them there.
  async function expandAll(log) {
    for (const scr of screens()) {
      const name = scr.getAttribute('aria-label');
      const row = rowOf(name) || scr;
      const item = await menuItem(row, /^(Expand all|Rozwiń wszystko)$/i);
      if (item) {
        item.click();
        log.push('expand all: ' + name);
        await sleep(300);
      }
    }
  }

  // ---------- tree state ----------

  function labelOf(row) {
    return row.getAttribute('aria-label');
  }

  function openNames() {
    return new Set(Array.from(document.querySelectorAll('.pa-tree-row[aria-expanded="true"]')).map(labelOf));
  }

  // The row's own expand chevron - not one of its children's.
  function chevronOf(row) {
    for (const c of row.querySelectorAll('[class*="expandIcon"], [class*="ExpandIcon"], [class*="chevron"], [class*="Chevron"]')) {
      if (c.closest('.pa-tree-row') === row) return c;
    }
    return null;
  }

  function isOpen(name) {
    const r = rowOf(name);
    return !!r && r.getAttribute('aria-expanded') === 'true';
  }

  /* Open or close one branch: its chevron first (one level, exactly what a
   * click does), Studio's own Expand all / Collapse all from the row's menu
   * when the chevron does not take. */
  async function setOpen(name, open, log) {
    const row = rowOf(name);
    if (!row || !row.hasAttribute('aria-expanded') || isOpen(name) === open) return true;
    const chev = chevronOf(row);
    if (chev) {
      const r = chev.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
      chev.dispatchEvent(new MouseEvent('mousedown', at));
      chev.dispatchEvent(new MouseEvent('mouseup', at));
      chev.dispatchEvent(new MouseEvent('click', at));
      for (let i = 0; i < 10 && isOpen(name) !== open; i++) await sleep(50);
      if (isOpen(name) === open) return true;
    }
    const item = await menuItem(rowOf(name), open ? /^(Expand all|Rozwiń wszystko)$/i : /^(Collapse all|Zwiń wszystko)$/i);
    if (item) {
      item.click();
      for (let i = 0; i < 10 && isOpen(name) !== open; i++) await sleep(50);
    }
    if (isOpen(name) !== open) log.push('could not ' + (open ? 'expand ' : 'collapse ') + name);
    return isOpen(name) === open;
  }

  /* Put the tree back the way it was: every branch open now that was closed
   * before gets closed, deepest first so nothing is hidden before its turn.
   * `renamed` maps a new name to the one it replaced, so the new control
   * takes over the old one's open/closed state. */
  async function restoreTree(before, renamed, log) {
    const was = (n) => before.has(n) || (renamed[n] != null && before.has(renamed[n]));
    const extra = Array.from(document.querySelectorAll('.pa-tree-row[aria-expanded="true"]'))
      .filter((r) => !was(labelOf(r)))
      .sort((a, b) => levelOf(b) - levelOf(a))
      .map(labelOf);
    for (const n of extra) await setOpen(n, false, log);
    for (const n of Object.keys(renamed)) if (was(n)) await setOpen(n, true, log);
    if (extra.length) log.push('tree put back: closed ' + extra.length + ' branch(es) opened on the way');
  }

  async function removeRow(name, log) {
    const row = rowOf(name);
    if (!row) return 'gone';
    select(row);
    await sleep(150);
    const del = await menuItem(row, /^(Delete|Usuń)\b/i);
    if (!del) return 'no-delete';
    del.click();
    for (let i = 0; i < 20 && rowOf(name); i++) await sleep(100);
    if (rowOf(name)) return 'delete-failed';
    log.push('deleted ' + name);
    return 'ok';
  }

  async function pasteInto(name, yaml, log) {
    const target = rowOf(name);
    if (!target) return false;
    select(target);
    await sleep(200);
    const dt = new DataTransfer();
    dt.setData('text/plain', yaml);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    const into = target.contains(document.activeElement) ? document.activeElement : target;
    into.dispatchEvent(ev);
    log.push('pasted into ' + name + (ev.defaultPrevented ? '' : ' (Studio did not take the paste event)'));
    return ev.defaultPrevented;
  }

  /* Every control in the pasted code should now be in the tree. Studio drops
   * what it cannot create (an unknown control or version) without a word, so
   * this is the one place that says which. */
  async function verify(names, allNames, log) {
    if (!names.length) return { ok: true, missing: [] };
    for (let i = 0; i < 30 && !rowOf(names[0]); i++) await sleep(100);
    await expandAll(log);
    await sleep(200);
    const dup = names.filter((n) => rowOf(n + '_1'));
    if (dup.length) log.push('Studio renamed the pasted copy: ' + dup.map((n) => n + '_1').join(', '));
    const missing = (allNames.length ? allNames : names).filter((n) => !rowOf(n));
    log.push(missing.length ? 'not created by Studio: ' + missing.join(', ') : 'all ' + (allNames.length || names.length) + ' control(s) are in the tree');
    return { ok: !missing.length && !dup.length && names.every((n) => rowOf(n)), missing: missing };
  }


  /* Controls: delete each named control where it is, paste the new code into
   * the parent of the first one (a container, or the screen). New names with
   * no old version go to the remembered / selected / only screen. */
  function indexIn(parentName, name) {
    const p = rowOf(parentName);
    const r = rowOf(name);
    return p && r ? childrenOf(p).indexOf(r) : -1;
  }

  /* Put a pasted control back at its old position among its siblings - order
   * is layout in an auto-layout container. Studio's Reorder menu moves one step
   * per click; which item goes which way is read from the tree. Best effort: a
   * failure is logged. */
  const UP = /^(Bring forward|Move up|Przesuń do przodu|Przenieś w górę)$/i;
  const DOWN = /^(Send backward|Move down|Przesuń do tyłu|Przenieś w dół)$/i;
  const REORDER = /^(Reorder|Zmień kolejność)$/i;

  async function reorder(name, parentName, want, log) {
    let now = indexIn(parentName, name);
    if (want < 0 || now < 0 || now === want) return true;
    let toward = now > want ? UP : DOWN;
    let away = now > want ? DOWN : UP;
    let swapped = false;
    for (let step = 0; step < 40 && now !== want; step++) {
      const row = rowOf(name);
      if (!row) break;
      select(row);
      await sleep(120);
      const item = await menuPath(row, REORDER, toward);
      if (!item) {
        log.push('reorder: no "' + toward.source + '" in the menu');
        break;
      }
      item.click();
      await sleep(250);
      const next = indexIn(parentName, name);
      if (Math.abs(next - want) >= Math.abs(now - want)) {
        if (swapped) break;
        swapped = true; // that item moves the other way in this tree
        const t = toward;
        toward = away;
        away = t;
      }
      now = next;
    }
    log.push(now === want ? 'moved ' + name + ' back to position ' + (want + 1) + ' in ' + parentName : 'could not move ' + name + ' back to position ' + (want + 1) + ' (now ' + (now + 1) + ')');
    return now === want;
  }

  /* Controls: delete the ones the code replaces - what was loaded (so a
   * rename in the code still removes the original) and any name in the code
   * that already exists - then paste the new code into the parent the first
   * of them sat in, and put it back at the same position. With nothing to
   * replace it goes to the remembered / selected / only screen. */
  async function applyControls(yaml, names, allNames, oldNames, screenHint, log) {
    const wanted = Array.from(new Set(oldNames.concat(names)));
    let found = wanted.filter((n) => rowOf(n));
    if (found.length < wanted.length) {
      await expandAll(log);
      found = wanted.filter((n) => rowOf(n));
    }
    log.push('to replace: ' + (found.length ? found.join(', ') : 'nothing (new controls)'));

    let parent = found.length ? parentOf(rowOf(found[0])) : null;
    if (!parent && screenHint) parent = rowOf(screenHint);
    if (!parent) {
      const sel = document.querySelector('.pa-tree-row[aria-selected="true"]');
      if (sel) parent = levelOf(sel) === 1 ? sel : screenOf(sel);
    }
    if (!parent) {
      const only = screens();
      if (only.length === 1) parent = only[0];
    }
    if (!parent) return { error: 'no-screen' };
    const parentName = parent.getAttribute('aria-label');
    const scr = levelOf(parent) === 1 ? parent : screenOf(parent);
    const screenName = scr ? scr.getAttribute('aria-label') : parentName;
    const oldIndex = found.length ? indexIn(parentName, found[0]) : -1;

    const deleted = [];
    for (const n of found) {
      const r = await removeRow(n, log);
      if (r === 'gone') continue;
      if (r !== 'ok') return { error: r, name: n, deleted: deleted };
      deleted.push(n);
    }
    if (!(await pasteInto(parentName, yaml, log)) && !rowOf(parentName)) return { error: 'no-screen', deleted: deleted };
    const v = await verify(names, allNames, log);
    let inPlace = true;
    if (rowOf(names[0]) && oldIndex >= 0 && names.length) inPlace = await reorder(names[0], parentName, oldIndex, log);
    const renamed = {};
    if (names.length && found.length && names[0] !== found[0]) renamed[names[0]] = found[0];
    return { ok: true, screen: screenName, parent: parentName, deleted: deleted, pasted: v.ok, missing: v.missing, inPlace: inPlace, position: oldIndex + 1, focus: names[0] || '', renamed: renamed };
  }

  /* A whole screen: every control on it is deleted and the screen's children
   * from the code are pasted in their place. The screen row itself stays -
   * its own properties (Fill, OnVisible...) cannot travel through a paste,
   * the editor warns when those changed. */
  async function applyScreen(yaml, names, allNames, screenName, screenHint, log) {
    let scr = rowOf(screenName) || (screenHint && rowOf(screenHint));
    if (!scr) {
      const only = screens();
      if (only.length === 1) scr = only[0];
    }
    if (!scr) return { error: 'no-screen' };
    const name = scr.getAttribute('aria-label');
    if (name !== screenName) log.push('code names screen ' + screenName + ', applying to ' + name);

    // A collapsed screen has no child rows to delete - and whatever is not
    // deleted would stay next to the pasted copy.
    await setOpen(name, true, log);
    const olds = childrenOf(rowOf(name) || scr).map((r) => r.getAttribute('aria-label'));
    log.push('on ' + name + ' now: ' + (olds.join(', ') || 'nothing'));
    const deleted = [];
    for (const n of olds) {
      const r = await removeRow(n, log);
      if (r === 'gone') continue;
      if (r !== 'ok') return { error: r, name: n, deleted: deleted };
      deleted.push(n);
    }
    if (yaml.trim()) await pasteInto(name, yaml, log);
    const v = await verify(names, allNames, log);
    return { ok: true, screen: name, parent: name, deleted: deleted, pasted: v.ok, missing: v.missing, inPlace: true, focus: name, renamed: {} };
  }

  async function apply(d) {
    if (!document.querySelector('.pa-tree-row')) return { error: 'no-tree' };
    closeViewCode();
    await sleep(300);
    const log = [];
    const list = (v) => (Array.isArray(v) ? v.map(String) : []);
    const yaml = String(d.yaml || '');
    const hint = d.screen ? String(d.screen) : '';
    const before = openNames();
    const r = d.mode === 'screen'
      ? await applyScreen(yaml, list(d.names), list(d.allNames), String(d.screenName || ''), hint, log)
      : await applyControls(yaml, list(d.names), list(d.allNames), list(d.oldNames), hint, log);

    // Leave the tree as it was found, with the new control selected - where
    // you were when you opened View code.
    try {
      if (r.focus && rowOf(r.focus)) {
        select(rowOf(r.focus));
        await sleep(150);
      }
      await restoreTree(before, r.renamed || {}, log);
    } catch (e) {
      log.push('could not put the tree back: ' + e.message);
    }
    r.log = log;
    return r;
  }

  // ---------- the Expand tree toggle ----------

  let treeBefore = null;

  async function tree(op) {
    if (!document.querySelector('.pa-tree-row')) return { error: 'no-tree' };
    const log = [];
    if (op === 'expand') {
      if (!treeBefore) treeBefore = openNames();
      await expandAll(log);
    } else if (treeBefore) {
      await restoreTree(treeBefore, {}, log);
      treeBefore = null;
    } else {
      // Nothing remembered (Studio was reloaded since): fold each screen.
      for (const scr of screens()) {
        const item = await menuItem(scr, /^(Collapse all|Zwiń wszystko)$/i);
        if (item) {
          item.click();
          log.push('collapse all: ' + labelOf(scr));
          await sleep(250);
        }
      }
    }
    return { ok: true, log: log };
  }

  window.addEventListener('message', async (e) => {
    if (e.origin !== PARENT) return;
    const d = e.data;
    if (!d || d.source !== SRC) return;
    if (d.type === 'tree') {
      let result;
      try {
        result = await tree(d.op === 'expand' ? 'expand' : 'restore');
      } catch (err) {
        result = { error: 'exception', message: String(err && err.message) };
      }
      e.source.postMessage(Object.assign({ source: SRC, type: 'tree-done', nonce: d.nonce }, result), PARENT);
      return;
    }
    if (d.type === 'apply') {
      let result;
      try {
        result = await apply(d);
      } catch (err) {
        result = { error: 'exception', message: String(err && err.message) };
      }
      e.source.postMessage(Object.assign({ source: SRC, type: 'applied', nonce: d.nonce }, result), PARENT);
      return;
    }
    if (d.type !== 'request') return;
    let found = null;
    try {
      found = readCode();
    } catch (err) {
      // Studio changed shape - answer "nothing" rather than stay silent.
    }
    e.source.postMessage(
      { source: SRC, type: 'code', nonce: d.nonce, text: found ? found.text : null, title: found ? found.title : '', screen: found ? found.screen : '' },
      PARENT
    );
  });
})();
