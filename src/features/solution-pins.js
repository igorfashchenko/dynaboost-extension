/* Feature: My solutions - shortcuts to solutions at the top of the panel.
 * A shortcut is the solution's address (environment id + solution id), so
 * its name can be changed; one per solution. Three slots, six once the first
 * three are full. Stored in chrome.storage.sync, the fold state in
 * chrome.storage.local. On Azure DevOps a shortcut opens in a new tab.
 */
(function () {
  if (DynaBoost.off) return;
  const STORE_KEY = 'dynaboost.solutionPins';
  const FOLD_KEY = 'dynaboost.solutionPinsFolded';
  const MAX = 6;
  const ROW = 3;
  const MAKERS = ['https://make.powerapps.com', 'https://make.powerautomate.com'];

  // .../environments/{env}/solutions/{solution}. The default environment's id
  // is "Default-<guid>", so the environment part is not a bare GUID.
  const SOLUTION_URL = /\/environments\/([^/?#]+)\/solutions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

  let pins = []; // slot index -> pin or null
  let folded = false;
  let flash = -1; // a slot to highlight briefly (already pinned)
  let notice = ''; // a line under the header, for a few seconds
  let noticeTimer = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function clean(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  // Every site DynaBoost runs on shows the section.
  function applies() {
    return true;
  }

  // Azure DevOps is a different app: a solution opens beside it, not over it.
  function elsewhere() {
    const host = location.hostname.toLowerCase();
    return host === 'dev.azure.com' || host.endsWith('.visualstudio.com');
  }

  // ---------- storage ----------

  // Drawn, not typed: a ✎ or ✕ sits off centre in most fonts.
  const PEN =
    '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 10l.6-2.4L8.2 2a1 1 0 0 1 1.4 0l.4.4a1 1 0 0 1 0 1.4L4.4 9.4z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  const CROSS = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

  function normalise(list) {
    const out = [];
    for (let i = 0; i < MAX; i++) out.push((list && list[i]) || null);
    return out;
  }

  function save() {
    // Trailing empty slots are not stored.
    let last = pins.length;
    while (last > 0 && !pins[last - 1]) last--;
    chrome.storage.sync.set({ [STORE_KEY]: pins.slice(0, last) });
    DynaBoost.refresh();
  }

  function setFolded(v) {
    folded = v;
    chrome.storage.local.set({ [FOLD_KEY]: v });
    DynaBoost.refresh();
  }

  // ---------- addresses and names ----------

  function parseLink(text) {
    let url;
    try {
      url = new URL(String(text || '').trim());
    } catch (e) {
      return null;
    }
    if (MAKERS.indexOf(url.origin) < 0) return null;
    const m = url.pathname.match(SOLUTION_URL);
    return m ? { origin: url.origin, env: m[1], sol: m[2].toLowerCase() } : null;
  }

  function urlOf(pin) {
    return pin.origin + '/environments/' + pin.env + '/solutions/' + pin.sol;
  }

  // Suggestions only - ✎ changes them.
  function guessEnvName(env) {
    const known = pins.find((p) => p && p.env === env);
    if (known) return known.envName;
    const cands = document.querySelectorAll(
      'button[aria-label*="nvironment"], [data-test-id*="nvironment"], [id*="nvironmentPicker"], [class*="nvironmentPicker"], [class*="environment-picker"]'
    );
    for (const el of cands) {
      const text = clean(el.getAttribute('aria-label') || el.textContent)
        .replace(/^(current\s+)?environment\s*[:,\-]?\s*/i, '')
        .replace(/\s*(environment picker|change environment)$/i, '');
      if (text && text.length < 80) return text;
    }
    return '';
  }

  // The solution pages repeat their own titles for screen readers, so a
  // heading reads "OverviewOverview" or "AllAll". Keep one copy.
  function undouble(text) {
    const t = clean(text);
    const half = t.length / 2;
    return t.length % 2 === 0 && t.slice(0, half) === t.slice(half) ? t.slice(0, half) : t;
  }

  // Names of the pages inside a solution - never the solution's own name.
  const SUBPAGES = /^(overview|objects|history|all|solution|solutions|power apps|power automate)$/i;

  function usable(text) {
    const t = undouble(text);
    return t && t.length < 120 && !SUBPAGES.test(t) ? t : '';
  }

  /* On a solution page the left pane reads "Back to solutions", then the
   * solution's name, then Overview, Objects, History. The heading is the
   * sub-page, so it is not used. Breadcrumbs, when there are any, start with
   * the solution. */
  function guessSolutionName() {
    const back = Array.from(document.querySelectorAll('a, button, [role="link"], [role="button"]')).find((el) =>
      // An arrow may come before it, as an icon or a character.
      /^\W*back to solutions$/i.test(clean(el.textContent))
    );
    if (back) {
      // Walk the text after the back link, in document order, inside the pane.
      const pane = back.closest('nav, aside, [role="navigation"], [class*="nav" i], [class*="pane" i]') || back.parentElement.parentElement || document.body;
      const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
      let passed = false;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!passed) {
          if (back.contains(n)) passed = true;
          continue;
        }
        if (back.contains(n)) continue;
        const name = usable(n.textContent);
        if (name) return name;
      }
    }
    const crumbs = document.querySelectorAll('[aria-label*="readcrumb" i] li, [class*="readcrumb" i] li, [class*="readcrumb" i] [class*="item" i]');
    if (crumbs.length > 1) {
      const name = usable(crumbs[0].textContent);
      if (name) return name;
    }
    const title = usable(clean(document.title).split(/\s[|–—-]\s/)[0]);
    return title;
  }

  // ---------- pinning ----------

  /* Duplicates are found by address - environment id and solution id - never
   * by name, so a shortcut you renamed is still recognised. */
  function twinOf(ref, except) {
    return pins.findIndex(
      (p, i) => p && i !== except && p.env.toLowerCase() === ref.env.toLowerCase() && p.sol === ref.sol
    );
  }

  function nameOf(pin) {
    return pin.envName + ' \u00b7 ' + pin.solName;
  }

  function showDuplicate(i) {
    flash = i;
    notice = 'Already pinned as \u201c' + nameOf(pins[i]) + '\u201d.';
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      flash = -1;
      notice = '';
      DynaBoost.refresh();
    }, 3500);
    DynaBoost.refresh();
  }

  function pinAt(slot) {
    const here = parseLink(location.href);
    if (!here) {
      openDialog(slot, null);
      return;
    }
    const twin = twinOf(here);
    if (twin >= 0) {
      showDuplicate(twin); // one shortcut per solution - drag it to move it
      return;
    }
    const pin = Object.assign(here, { envName: guessEnvName(here.env), solName: guessSolutionName() });
    if (!pin.envName || !pin.solName) {
      openDialog(slot, pin); // the page did not give both names - ask
      return;
    }
    pins[slot] = pin;
    save();
  }

  function firstFree() {
    return pins.findIndex((p) => !p);
  }

  // ---------- dialog: name a shortcut, or paste a link ----------

  function openDialog(slot, draft) {
    DynaBoost.closePanel();
    const overlay = document.createElement('div');
    overlay.className = 'db-overlay' + (DynaBoost.isDark && DynaBoost.isDark() ? ' db-dark' : '');
    document.body.appendChild(overlay);
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
    }
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    function paint(note) {
      overlay.innerHTML =
        '<div class="db-dialog db-pins">' +
        '<div class="db-dialog-head"><span>' + (pins[slot] && draft ? 'Rename shortcut' : 'Pin a solution') + '</span>' +
        '<button type="button" data-db="close" aria-label="Close">✕</button></div>' +
        '<form class="db-pin-form" data-db="form">' +
        (draft ? '' : '<label>Solution link<input type="text" data-db="link" placeholder="Paste a link to a solution" autocomplete="off"></label>') +
        '<div class="db-pin-fields"' + (draft ? '' : ' hidden') + '>' +
        '<label>Environment<input type="text" data-db="env" maxlength="60" autocomplete="off"></label>' +
        '<label>Solution<input type="text" data-db="sol" maxlength="80" autocomplete="off"></label>' +
        '</div>' +
        '<div class="db-pin-note" data-db="note">' + esc(note || (draft ? 'Short names read best on the shortcut.' : '')) + '</div>' +
        '<div class="db-dialog-actions"><button type="submit" class="db-primary" data-db="save"' + (draft ? '' : ' disabled') + '>Save</button></div>' +
        '</form></div>';
      const q = (k) => overlay.querySelector('[data-db="' + k + '"]');
      q('close').addEventListener('click', close);
      if (draft) {
        q('env').value = draft.envName || '';
        q('sol').value = draft.solName || '';
        (draft.envName ? q('sol') : q('env')).focus();
      } else {
        const link = q('link');
        link.focus();
        link.addEventListener('input', () => {
          const parsed = parseLink(link.value);
          if (!parsed) {
            q('note').textContent = link.value.trim() ? 'Not a solution link from make.powerapps.com or make.powerautomate.com.' : '';
            return;
          }
          const twin = twinOf(parsed, slot);
          if (twin >= 0) {
            q('note').textContent = 'Already pinned as \u201c' + nameOf(pins[twin]) + '\u201d.';
            return;
          }
          draft = Object.assign(parsed, { envName: guessEnvName(parsed.env), solName: '' });
          paint();
        });
      }
      q('form').addEventListener('submit', (e) => {
        e.preventDefault();
        if (!draft) return;
        const envName = clean(q('env').value) || 'Environment';
        const pin = Object.assign({}, draft, { envName: envName, solName: clean(q('sol').value) || 'Solution' });
        pins[slot] = pin;
        // One environment, one name: renaming it renames it on every shortcut.
        pins.forEach((p) => {
          if (p && p.env === pin.env) p.envName = envName;
        });
        save();
        close();
      });
    }
    paint();
  }

  // ---------- drawing ----------

  const CHEVRON = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="m5 6 3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function draw(box) {
    if (!applies()) return;
    const count = pins.filter(Boolean).length;
    const here = parseLink(location.href);

    const head = document.createElement('div');
    head.className = 'db-sec-head' + (folded ? ' db-sec-folded' : '');
    head.innerHTML =
      '<button type="button" class="db-sec-toggle" aria-expanded="' + !folded + '">' + CHEVRON +
      '<span>My solutions</span><span class="db-sec-count">' + count + '</span></button>' +
      (!folded && count < MAX ? '<button type="button" class="db-sec-add" title="' + (here ? 'Pin this solution in the first free slot' : 'Pin a solution from its link') + '">+ Add</button>' : '');
    head.querySelector('.db-sec-toggle').addEventListener('click', () => setFolded(!folded));
    const add = head.querySelector('.db-sec-add');
    if (add) {
      add.addEventListener('click', () => {
        const twin = here ? twinOf(here) : -1;
        if (twin >= 0) return showDuplicate(twin);
        const slot = firstFree();
        if (slot >= 0) pinAt(slot);
      });
    }
    box.appendChild(head);
    if (notice) {
      const note = document.createElement('div');
      note.className = 'db-sec-note';
      note.textContent = notice;
      box.appendChild(note);
    }
    if (folded) return;

    // Three slots; all six once the first three are taken (or anything sits
    // in the second row).
    const shown = pins.slice(0, ROW).every(Boolean) || pins.slice(ROW).some(Boolean) ? MAX : ROW;
    const grid = document.createElement('div');
    grid.className = 'db-slots';
    for (let i = 0; i < shown; i++) grid.appendChild(pins[i] ? fullSlot(i, pins[i]) : emptySlot(i, here));
    box.appendChild(grid);
    // Measure once the panel shows the section.
    requestAnimationFrame(() => grid.querySelectorAll('.db-slot-sol').forEach(fitName));
  }

  function fullSlot(i, pin) {
    const el = document.createElement('div');
    el.className = 'db-slot db-slot-full' + (i === flash ? ' db-slot-flash' : '');
    el.draggable = true;
    el.tabIndex = 0;
    el.setAttribute('role', 'link');
    el.dataset.slot = i;
    el.title = pin.envName + '\n' + pin.solName + '\n\nClick to open · Ctrl+click for a new tab · drag to move';
    el.innerHTML =
      '<span class="db-slot-env">' + esc(pin.envName) + '</span>' +
      '<span class="db-slot-sol">' + esc(pin.solName) + '</span>' +
      // Rename top-left, remove top-right: far apart, so a slip does not delete.
      '<button type="button" class="db-slot-tool db-slot-edit" data-act="edit" title="Rename" aria-label="Rename">' + PEN + '</button>' +
      '<button type="button" class="db-slot-tool db-slot-del" data-act="del" title="Remove" aria-label="Remove">' + CROSS + '</button>';
    const go = (e) => {
      const url = urlOf(pin);
      DynaBoost.saved('solution-pins');
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1 || elsewhere()) {
        window.open(url, '_blank', 'noopener');
        return;
      }
      DynaBoost.closePanel();
      location.assign(url);
    };
    el.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (!act) return go(e);
      e.stopPropagation();
      if (act.dataset.act === 'del') {
        // A slip of the mouse is undone from the message.
        const gone = pins[i];
        pins[i] = null;
        save();
        DynaBoost.toast('Removed from My solutions', gone.solName + ' · ' + gone.envName, false, {
          label: 'Undo',
          run: () => {
            if (pins[i]) return;
            pins[i] = gone;
            save();
          }
        });
      } else {
        openDialog(i, Object.assign({}, pin));
      }
    });
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1 && !e.target.closest('[data-act]')) go(e);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go(e);
    });
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/x-dynaboost-slot', String(i));
      el.classList.add('db-slot-dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('db-slot-dragging'));
    dropTarget(el, i);
    return el;
  }

  /* Two lines, then "...": the longest start of the name that still fits.
   * Done by measuring rather than a CSS clamp, which clips descenders. */
  function fitName(el) {
    const full = el.dataset.full || el.textContent;
    el.dataset.full = full;
    el.textContent = full;
    if (!el.offsetParent) return; // not on screen - measured next time
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
    const limit = line * 2 + 1;
    if (el.scrollHeight <= limit) return;
    let lo = 0;
    let hi = full.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      el.textContent = full.slice(0, mid).trimEnd() + '\u2026';
      if (el.scrollHeight <= limit) lo = mid;
      else hi = mid - 1;
    }
    el.textContent = full.slice(0, lo).trimEnd() + '\u2026';
  }

  function emptySlot(i, here) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'db-slot db-slot-empty';
    el.dataset.slot = i;
    el.title = here ? 'Pin this solution here' : 'Pin a solution here from its link';
    el.innerHTML = '<span class="db-slot-plus">+</span><span class="db-slot-hint">' + (here ? 'Pin here' : 'Paste link') + '</span>';
    el.addEventListener('click', () => pinAt(i));
    dropTarget(el, i);
    return el;
  }

  // Drop on a slot: into it if empty, swap if taken.
  function dropTarget(el, i) {
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('text/x-dynaboost-slot')) return;
      e.preventDefault();
      el.classList.add('db-slot-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('db-slot-over'));
    el.addEventListener('drop', (e) => {
      el.classList.remove('db-slot-over');
      const from = Number(e.dataTransfer.getData('text/x-dynaboost-slot'));
      if (Number.isNaN(from) || from === i) return;
      e.preventDefault();
      const moving = pins[from];
      pins[from] = pins[i];
      pins[i] = moving;
      save();
    });
  }

  // ---------- boot ----------

  chrome.storage.sync.get(STORE_KEY, (data) => {
    pins = normalise(data && data[STORE_KEY]);
    chrome.storage.local.get(FOLD_KEY, (d) => {
      folded = !!(d && d[FOLD_KEY]);
      DynaBoost.addSection({ id: 'solution-pins', draw: draw });
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[STORE_KEY]) {
      pins = normalise(changes[STORE_KEY].newValue);
      DynaBoost.refresh();
    }
  });
})();
