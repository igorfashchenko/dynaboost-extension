/* Features: Copy code button and Copy choices button - two switches, each
 * a button the maker portal lacks, the panel's own Save copied:
 *  - Copy code, over the Code box of a web resource you edit (below);
 *  - Copy choices, on the line of the word Choices of a choice or a choice
 *    column, at its right end before Sort: its options as a table - number,
 *    label, value - that pastes into Excel as columns and into a mail or a
 *    chat as a table.
 *
 * Copy code. In make.powerapps.com the Edit web resource panel shows
 * the code in a small box: to take it all, you click into it, select all and
 * copy. While on, a Copy code button sits over the box, at its right end -
 * one click puts the whole code on the clipboard.
 *
 * The button is the panel's own Save, copied: the same element with the same
 * classes - so the same size, colour, corners, font and the same look under
 * the pointer - with other words and another job. Where Save cannot be
 * copied (greyed, or not found), a button made to the portal's measures.
 * It belongs to the Code field itself, not to a place on the screen: it is
 * set into the field's own frame, just over the box, so it stays there
 * whatever the zoom or the width of the panel. Labels in several UI
 * languages.
 */
(function () {
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="8" y="8" width="12" height="12" rx="2" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="m11.5 12.5-1.7 1.5 1.7 1.5m5-3 1.7 1.5-1.7 1.5" stroke="#E3B04B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
  const ICON_CHOICES =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="8" y="8" width="12" height="12" rx="2" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="M11 12h6M11 14.5h6M11 17h6" stroke="#E3B04B" stroke-width="1.5" stroke-linecap="round"/>' +
    '</svg>';
  const CODE_LABELS = ['code', 'kod', 'código', 'codice'];
  const CHOICES_LABELS = ['choices', 'opcje', 'wybory', 'auswahlmöglichkeiten', 'optionen', 'choix', 'opciones', 'scelte', 'keuzes'];
  const SAVE = ['save', 'zapisz', 'speichern', 'enregistrer', 'guardar', 'salvar', 'salva', 'opslaan'];
  const PANES = '[role="dialog"], [role="complementary"], aside, .ms-Panel, [class*="Panel"], [class*="Drawer"], [class*="drawer"]';
  // The maker portal's main button as it is drawn, where Save itself cannot be copied: at rest, under the pointer, pressed.
  const PURPLE = 'rgb(116, 39, 116)';
  const PURPLE_OVER = 'rgb(103, 35, 103)';
  const PURPLE_DOWN = 'rgb(89, 29, 88)';
  const MARK = 'data-dynaboost-copy-code';

  const buttons = new WeakMap(); // the Code box, or the Choices heading -> its button
  let codeOn = false;
  let choicesOn = false;
  let observer = null;
  let timer = null;
  let frame = 0;

  const bare = (t) =>
    String(t || '')
      .replace(/[-*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  // The label of a box, and the frame that holds both: the button goes into that frame.
  function fieldOf(box) {
    let label = box.labels && box.labels.length ? box.labels[0] : null;
    let frame = null;
    for (let el = box.parentElement, n = 0; el && n < 5; el = el.parentElement, n++) {
      const l = label && el.contains(label) ? label : !label ? el.querySelector('label') : null;
      if (l) {
        label = l;
        frame = el;
        break;
      }
    }
    return label && frame ? { label: label, frame: frame } : null;
  }

  // A colour that is one: not see-through, not white or grey.
  function coloured(c) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(c || '');
    if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return false;
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return Math.max(r, g, b) - Math.min(r, g, b) > 30;
  }
  const says = (b, words) => words.includes(bare(b.textContent)) || words.includes(bare(b.getAttribute('aria-label')));
  /* The panel's Save - else its main button, the coloured one. The box sits
   * in panes within panes (the panel, its scrolling part, its content): the
   * nearest one that holds such a button - the footer is not in the inner
   * ones. */
  function paneOf(box) {
    // A button saying Save in any pane up the chain first; only then a coloured one (not a colour swatch in the rows).
    for (const pick of [(b) => says(b, SAVE), (b) => coloured(getComputedStyle(b).backgroundColor)]) {
      for (let el = box.parentElement; el; el = el.parentElement) {
        if (el !== document.body && !el.matches(PANES)) continue;
        const hit = Array.from(el.querySelectorAll('button')).find((b) => !b.hasAttribute(MARK) && b.getClientRects().length && pick(b));
        if (hit) return { pane: el, save: hit };
      }
    }
    return null;
  }
  const saveOf = (box) => (paneOf(box) || {}).save || null;
  // Save as it can be copied: there, not greyed, in its colour.
  const fits = (save) => !!save && !save.disabled && save.getAttribute('aria-disabled') !== 'true' && coloured(getComputedStyle(save).backgroundColor);

  /* While the panel saves, the buttons are greyed as Save is, and not to be
   * clicked: a purple button beside a greyed Save looks left on. A click on
   * a pane's Save starts it; it ends once Save can be clicked again (the
   * save did not go through) - or with the pane. */
  const GREY = 'rgb(243, 242, 241)';
  const GREY_WORDS = 'rgb(161, 159, 157)';
  const SAVING_LONGEST = 30000;
  const clicked = new WeakMap(); // a pane -> when its Save was clicked
  const dimmed = new Map(); // a button of ours, greyed -> its style before
  let dimWatch = 0;

  function saving(p) {
    const at = p && clicked.get(p.pane);
    if (!at) return false;
    const gone = Date.now() - at;
    // A moment for Save to grey; then for as long as it is greyed, or the pane shows that it works.
    return gone < SAVING_LONGEST && (gone < 700 || !fits(p.save) || Array.from(p.pane.querySelectorAll('[role="progressbar"], [class*="Spinner"], [class*="spinner"]')).some((x) => x.getClientRects().length));
  }
  function dim(b) {
    if (dimmed.has(b)) return;
    dimmed.set(b, b.style.cssText);
    for (const [k, v] of [['background-color', GREY], ['border-color', GREY], ['color', GREY_WORDS], ['pointer-events', 'none'], ['cursor', 'default']]) b.style.setProperty(k, v, 'important');
    b.setAttribute('aria-disabled', 'true');
    if (!dimWatch) dimWatch = setInterval(undim, 400);
  }
  // Each greyed button whose pane saves no more: as it was, in its place.
  function undim(all) {
    for (const [b, css] of dimmed) {
      if (all !== true && b.isConnected && saving(paneOf(b))) continue;
      dimmed.delete(b);
      b.style.cssText = css;
      b.removeAttribute('aria-disabled');
    }
    if (!dimmed.size) {
      clearInterval(dimWatch);
      dimWatch = 0;
      schedule();
    }
  }
  // A click on a pane's Save: the buttons of ours in that pane grey with it.
  function onClick(e) {
    const hit = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!hit || hit.hasAttribute(MARK)) return;
    for (const b of document.querySelectorAll('[' + MARK + ']')) {
      const p = paneOf(b);
      if (!p || p.save !== hit) continue;
      clicked.set(p.pane, Date.now());
      dim(b);
    }
  }
  // One drawn anew by the page while its pane saves: greyed from the start.
  const dimIfSaving = (b, anchor) => saving(paneOf(anchor)) && dim(b);

  /* The button: Save itself, copied with everything that makes its look -
   * and none of what makes it Save. { el, text: the node its words are in }. */
  function make(box, kind, words, tip) {
    const save = saveOf(box);
    let el;
    let text = null;
    if (fits(save)) {
      el = save.cloneNode(true);
      for (const a of ['id', 'name', 'form', 'aria-describedby', 'aria-labelledby', 'data-automation-id', 'data-testid', 'data-test-id']) el.removeAttribute(a);
      el.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
      // Save's icon stays behind: it is drawn with the portal's icon font, and words written in its place would ask for that font.
      el.querySelectorAll('i, svg, img, [data-icon-name], [class*="Icon"], [class*="icon"]').forEach((x) => x.remove());
      // Its words: the first text in it with a letter says Copy code, any other goes.
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!n.nodeValue.trim()) continue;
        if (!text && /\p{L}/u.test(n.nodeValue)) text = n;
        else n.nodeValue = '';
      }
    }
    if (!text) {
      // The portal's main button by its measures: 32 px high, 14 px semibold, 2 px corners.
      el = document.createElement('button');
      el.style.cssText =
        'box-sizing:border-box;height:32px;min-width:80px;padding:0 16px;border:1px solid ' + PURPLE + ';border-radius:2px;background:' + PURPLE +
        ';color:#fff;font-family:"Segoe UI","Segoe UI Web (West European)",-apple-system,BlinkMacSystemFont,Roboto,"Helvetica Neue",sans-serif;font-size:14px;font-weight:600;cursor:pointer';
      text = document.createTextNode('');
      el.appendChild(text);
      // Under the pointer as Save is: a darker purple, the words still white.
      const paint = (c) => {
        el.style.background = c;
        el.style.borderColor = c;
      };
      el.addEventListener('mouseenter', () => paint(PURPLE_OVER));
      el.addEventListener('mouseleave', () => paint(PURPLE));
      el.addEventListener('mousedown', () => paint(PURPLE_DOWN));
      el.addEventListener('mouseup', () => paint(PURPLE_OVER));
    }
    text.nodeValue = words;
    el.type = 'button';
    el.setAttribute(MARK, kind);
    el.setAttribute('aria-label', words);
    el.title = tip + ' - DynaBoost';
    return { el: el, text: text, own: !fits(save), say: (t) => {
      text.nodeValue = t;
      setTimeout(() => el.isConnected && (text.nodeValue = words), 1600);
    } };
  }

  function add(box) {
    const field = fieldOf(box);
    if (!field || !CODE_LABELS.includes(bare(field.label.textContent))) return;
    const made = make(box, 'code', 'Copy code', 'Copy the whole code');
    const b = made.el;
    // In the field's own frame, at its right end just over the box: it moves and scales with the field.
    if (getComputedStyle(field.frame).position === 'static') field.frame.style.position = 'relative';
    b.style.position = 'absolute';
    b.style.right = '0';
    b.style.margin = '0';
    b.style.zIndex = '1';
    // A Code box the page drew anew: the button of the old one goes.
    field.frame.querySelectorAll('[' + MARK + '="code"]').forEach((old) => old.remove());
    field.frame.appendChild(b);
    const place = () => {
      // The box's top within the frame, in the layout's own pixels - the same at any zoom, the browser's or the page's.
      let y = 0;
      for (let n = box; n && n !== field.frame && field.frame.contains(n); n = n.offsetParent) y += n.offsetTop;
      // Its foot a little over the box's top.
      b.style.top = y - b.offsetHeight - 6 + 'px';
    };
    place();
    dimIfSaving(b, box);
    b.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = box.value || '';
      const ok = !!text && (await DynaBoost.copyText(text));
      made.say(!text ? 'Nothing to copy' : ok ? 'Copied' : 'Copy failed');
      if (ok) DynaBoost.saved('copy-code');
    });
    buttons.set(box, { el: b, place: place, own: made.own });
  }

  // ---------- Copy choices ----------

  const shown = (el) => !!el.getClientRects().length;
  // A choice's value as the portal writes it - 122,280,000 - and as it is: 122280000.
  const numberIn = (v) => (/^-?[\d\s.,\u00a0\u202f']+$/.test(String(v).trim()) && /\d/.test(v) ? String(v).replace(/[^\d-]/g, '') : '');

  /* The choices of a pane, as its rows show them: a row holds two boxes - the
   * label, and the value, a number. [{ label, value }] top to bottom. */
  function choicesIn(pane) {
    const boxes = Array.from(pane.querySelectorAll('input[type="text"], input:not([type])')).filter((i) => shown(i) && !i.closest('[' + MARK + ']'));
    const rows = [];
    const seen = new Set();
    for (const v of boxes) {
      const value = numberIn(v.value);
      if (!value) continue;
      // Its row: the nearest frame around it that holds one more box - the label.
      for (let el = v.parentElement, n = 0; el && el !== pane.parentElement && n < 6; el = el.parentElement, n++) {
        const inside = boxes.filter((b) => el.contains(b));
        if (inside.length < 2) continue;
        // The label first, the value second, as the row shows them - a label may be a number too (1, 2, 3; 2024).
        if (inside.length === 2 && !seen.has(el)) {
          seen.add(el);
          const val = numberIn(inside[1].value);
          if (val) rows.push({ label: inside[0].value || '', value: val });
        }
        break;
      }
    }
    return rows;
  }

  // The table two ways at once: with tabs, for Excel's columns and any plain place - and as a table, for a mail or a chat.
  async function copyTable(rows) {
    const head = ['#', 'Label', 'Value'];
    const lines = [head].concat(rows.map((r, i) => [String(i + 1), r.label, r.value]));
    const text = lines.map((l) => l.map((c) => String(c).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
    const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const html = '<table>' + lines.map((l, i) => '<tr>' + l.map((c) => (i ? '<td>' : '<th>') + esc(c) + (i ? '</td>' : '</th>')).join('') + '</tr>').join('') + '</table>';
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
      return true;
    } catch (e) {
      return DynaBoost.copyText(text);
    }
  }

  // The word Choices over the rows: a label or heading that says just that - else the smallest thing that does.
  function choicesHead(pane) {
    const is = (el) => {
      const t = el.textContent;
      return t.length <= 30 && CHOICES_LABELS.includes(bare(t)) && shown(el);
    };
    for (const el of pane.querySelectorAll('label, h2, h3, h4, [role="heading"]')) if (is(el)) return el;
    for (const el of pane.querySelectorAll('span, div')) if (!el.childElementCount && is(el)) return el;
    return null;
  }

  function addChoices(head, pane) {
    const made = make(head, 'choices', 'Copy choices', 'Copy the choices as a table: number, label, value');
    const b = made.el;
    // On the word's line, in the frame the word sits in - it moves and scales with it: at the line's right end, before what the portal has there (Sort).
    const frame = head.parentElement;
    if (getComputedStyle(frame).position === 'static') frame.style.position = 'relative';
    b.style.position = 'absolute';
    b.style.margin = '0';
    // One line whatever its place: measured where it was, a button pressed to the edge would wrap and seem narrower.
    b.style.whiteSpace = 'nowrap';
    frame.appendChild(b);
    const place = () => {
      const f = frame.getBoundingClientRect();
      const h = head.getBoundingClientRect();
      // Screen pixels to the layout's own: the same at any zoom.
      const k = f.width && frame.offsetWidth ? f.width / frame.offsetWidth : 1;
      const mid = h.top + h.height / 2;
      // What the portal has on this line after the word - the nearest: the button ends before it.
      let next = null;
      for (const el of pane.querySelectorAll('button, [role="button"], [role="menuitem"], [aria-haspopup]')) {
        if (el === b || el.hasAttribute(MARK) || el.contains(head)) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || r.top > mid || r.bottom < mid || r.left < h.right) continue;
        if (!next || r.left < next.left) next = r;
      }
      // Nothing there: the right end of the rows - their last box.
      let end = next ? next.left - 12 * k : 0;
      if (!next) for (const i of pane.querySelectorAll('input')) if (shown(i)) end = Math.max(end, i.getBoundingClientRect().right);
      const left = (end - f.left) / k - b.offsetWidth;
      // No room there: beside the word, as before.
      b.style.left = Math.max(left, head.offsetLeft + head.offsetWidth + 14) + 'px';
      b.style.top = head.offsetTop + Math.round((head.offsetHeight - b.offsetHeight) / 2) + 'px';
    };
    place();
    dimIfSaving(b, head);
    b.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rows = choicesIn(pane);
      const ok = rows.length > 0 && (await copyTable(rows));
      made.say(!rows.length ? 'Nothing to copy' : ok ? 'Copied ' + rows.length : 'Copy failed');
      if (ok) DynaBoost.saved('copy-choices');
    });
    buttons.set(head, { el: b, place: place, own: made.own });
  }

  function scan() {
    for (const box of codeOn ? document.querySelectorAll('textarea') : []) {
      if (box.closest('#dynaboost-root') || !box.closest(PANES)) continue;
      const had = buttons.get(box);
      // Drawn again by the page without it: once more. Made by hand while Save could not be copied, and now it can: Save's copy takes its place.
      if (had && had.el.isConnected && had.own && fits(saveOf(box))) had.el.remove();
      if (!had || !had.el.isConnected) add(box);
      // Still there: in its place, should the field have moved.
      else had.place();
    }
    // A pane with choices in rows: Copy choices beside their heading.
    const done = new Set();
    for (const pane of choicesOn ? document.querySelectorAll(PANES) : []) {
      if (pane.closest('#dynaboost-root')) continue;
      // By its words first: nothing on the page is measured unless a pane says Choices.
      const head = choicesHead(pane);
      if (!head || done.has(head)) continue;
      done.add(head);
      const had = buttons.get(head);
      if (had && had.el.isConnected && had.own && fits(saveOf(head))) had.el.remove();
      if (had && had.el.isConnected) had.place();
      // Once a heading: the panes around it see the same one.
      else if (choicesIn(pane).length) addChoices(head, pane);
    }
  }

  /* After the page has drawn the panel - and just after the browser has
   * laid the page out by itself. Measuring a page that is not laid out yet
   * makes the browser do it there and then, and whatever the page lacks at
   * that moment (the portal's form designer asks for an icon font it does
   * not get) is reported as this file's error. */
  function schedule() {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    timer = setTimeout(() => {
      frame = requestAnimationFrame(() => {
        timer = setTimeout(scan, 0);
      });
    }, 250);
  }

  // One watch for both switches, while either is on.
  function set(kind, to) {
    if (kind === 'code') codeOn = to;
    else choicesOn = to;
    if (!to) document.querySelectorAll('[' + MARK + '="' + kind + '"]').forEach((b) => b.remove());
    if (codeOn || choicesOn) {
      if (!observer) {
        observer = new MutationObserver(schedule);
        observer.observe(document.documentElement, { childList: true, subtree: true });
        // A panel that only changes its width redraws nothing: the buttons are put in place again.
        window.addEventListener('resize', schedule);
      }
      // Each time: the same listener twice is still one, and a page written anew has lost it.
      document.addEventListener('click', onClick, true);
      schedule();
      return;
    }
    if (observer) observer.disconnect();
    observer = null;
    window.removeEventListener('resize', schedule);
    document.removeEventListener('click', onClick, true);
    undim(true);
    clearTimeout(timer);
    cancelAnimationFrame(frame);
  }

  DynaBoost.register({
    id: 'copy-code',
    name: 'Copy code button',
    group: 'Automatic',
    hosts: ['make.powerapps.com'],
    hint: 'Adds a Copy code button to a web resource you edit',
    icon: ICON,
    onEnable: () => set('code', true),
    onDisable: () => set('code', false)
  });
  DynaBoost.register({
    id: 'copy-choices',
    name: 'Copy choices button',
    group: 'Automatic',
    hosts: ['make.powerapps.com'],
    hint: 'Adds a Copy choices button to a choice - number, label and value as a table for Excel',
    icon: ICON_CHOICES,
    onEnable: () => set('choices', true),
    onDisable: () => set('choices', false)
  });
})();
