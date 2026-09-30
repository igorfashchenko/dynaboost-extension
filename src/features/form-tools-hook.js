/* DynaBoost - page-context helper for Logical names and God mode.
 *
 * Runs in the page's own world, where window.Xrm is. It takes three
 * requests from the content scripts (window.postMessage):
 *   names  { on, dark } - a badge with the column's logical name under the
 *                         label of every field on the form, kept there while
 *                         the form redraws (tabs, other records); a click on
 *                         a badge copies the name. Off takes them away.
 *   god    { on }       - on: every field, section and tab shown, every
 *                         field unlocked, every column optional - and kept
 *                         so while the form's scripts and rules work; off:
 *                         the form as it was. Only in this page - a reload
 *                         undoes it - and nothing is saved unless you save.
 *                         Another record ends it (god-off event).
 * Nothing is fetched and nothing leaves the page.
 */
(function () {
  // A newer helper takes the page over from an older one - one left from
  // before DynaBoost was updated, in a tab that was not reloaded - instead
  // of standing aside for it and leaving the old behaviour in charge.
  if (typeof window.__dynaboostFormToolsStop === 'function') {
    try {
      window.__dynaboostFormToolsStop();
    } catch (e) {
      /* the old one is gone already */
    }
  }
  window.__dynaboostFormTools = true;
  const listeners = [];
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    listeners.push(() => target.removeEventListener(type, fn, opts));
  };

  // v2: helpers from before it (no stop()) do not hear this channel.
  const SRC = 'dynaboost-form-tools-v2';
  const STYLE = 'dynaboost-ln-style';

  let namesOn = false;
  let dark = false;
  let observer = null;
  let timer = 0;

  // What God mode did, for the console: window.__dynaboostGod.
  const log = { passes: 0, touched: [], errors: [] };

  function each(collection, fn) {
    try {
      collection.forEach((x) => {
        try {
          fn(x);
        } catch (e) {
          // One control that cannot say - skipped, but noted.
          if (log.errors.length < 50) log.errors.push(String((x && x.getName && (() => { try { return x.getName(); } catch (er) { return '?'; } })()) || '?') + ': ' + String((e && e.message) || e));
        }
      });
    } catch (e) {
      /* no such collection on this page */
    }
  }

  function css() {
    let s = document.getElementById(STYLE);
    if (!s) {
      s = document.createElement('style');
      s.id = STYLE;
      document.head.appendChild(s);
    }
    const c = dark
      ? { bg: '#1f2233', fg: '#e3e9f7', bd: '#e3b04b', okBg: '#123322', ok: '#4cc27a' }
      : { bg: '#fffaf0', fg: '#10224e', bd: '#e3b04b', okBg: '#e4f4e8', ok: '#1c6b32' };
    s.textContent =
      '.db-ln{display:table;margin:3px 0 1px;padding:1px 7px;border:1px solid ' + c.bd + ';border-radius:5px;background:' + c.bg + ';color:' + c.fg + ';' +
      'font:600 12px/1.5 ui-monospace,Consolas,monospace;letter-spacing:0;text-transform:none;white-space:nowrap;cursor:copy;user-select:all}' +
      '.db-ln:hover{box-shadow:0 0 0 2px ' + c.bd + '55}' +
      '.db-ln.db-ln-ok{border-color:' + c.ok + ';background:' + c.okBg + ';color:' + c.ok + '}';
  }

  function label(controlName) {
    return document.querySelector('label[id$="-' + CSS.escape(controlName) + '-field-label"]') || document.querySelector('label[id$="' + CSS.escape(controlName) + '-field-label"]');
  }

  function drawNames() {
    const X = window.Xrm;
    if (!namesOn || !X || !X.Page || !X.Page.ui) return;
    each(X.Page.ui.controls, (c) => {
      const attr = c.getAttribute && c.getAttribute();
      if (!attr) return;
      const el = label(c.getName());
      if (!el || el.querySelector('.db-ln')) return;
      const badge = document.createElement('span');
      badge.className = 'db-ln';
      badge.textContent = attr.getName();
      badge.title = 'Logical name - click to copy';
      el.appendChild(badge);
    });
  }

  function names(on, isDark) {
    namesOn = !!on;
    dark = !!isDark;
    clearTimeout(timer);
    if (!namesOn) {
      if (observer) observer.disconnect();
      observer = null;
      document.querySelectorAll('.db-ln').forEach((b) => b.remove());
      const s = document.getElementById(STYLE);
      if (s) s.remove();
      return;
    }
    css();
    drawNames();
    if (!observer) {
      // Tabs, the header and other records draw their fields later.
      observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(drawNames, 300);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  // A click on a badge copies the name - and does not reach the field.
  on(
    document,
    'click',
    (e) => {
      const b = e.target && e.target.closest && e.target.closest('.db-ln');
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      const name = b.textContent;
      const done = () => {
        b.classList.add('db-ln-ok');
        b.textContent = 'copied';
        setTimeout(() => {
          b.classList.remove('db-ln-ok');
          b.textContent = name;
        }, 900);
      };
      navigator.clipboard.writeText(name).then(done, () => {
        const ta = document.createElement('textarea');
        ta.value = name;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        done();
      });
    },
    true
  );

  /* God mode, while on: every control shown and unlocked, every column
   * optional, every section and tab shown - set on each of them whether or
   * not it says it is hidden or locked, since some controls do not say. The
   * form's own scripts and business rules lock and hide again as you work,
   * and tabs draw their fields later, so it is kept up while on. What each
   * thing was before is noted the first time it is touched; off puts it
   * back. Another record ends it (the tile goes off with it). */
  const god = { on: false, record: '', was: new Map(), timer: 0, observer: null, counts: null };

  function note(obj, key, value) {
    let w = god.was.get(obj);
    if (!w) god.was.set(obj, (w = {}));
    if (!(key in w)) w[key] = value;
  }

  function read(fn) {
    try {
      return fn();
    } catch (e) {
      return undefined;
    }
  }

  function recordId() {
    const X = window.Xrm;
    return read(() => X.Page.data.entity.getEntityName() + ':' + X.Page.data.entity.getId()) || '';
  }

  function unlockAll(first) {
    const X = window.Xrm;
    if (!X || !X.Page || !X.Page.data || !X.Page.data.entity) return null;
    const n = first ? { shown: 0, unlocked: 0, optional: 0 } : null;
    log.passes++;
    each(X.Page.data.entity.attributes, (a) => {
      const level = read(() => a.getRequiredLevel());
      if (level === 'required') {
        note(a, 'required', level);
        a.setRequiredLevel('none');
        if (n) n.optional++;
      }
    });
    each(X.Page.ui.controls, (c) => {
      const visible = read(() => c.getVisible());
      const disabled = read(() => c.getDisabled());
      // The first pass sets every control, as some lock without saying so;
      // later passes only what is hidden or locked again, so they settle.
      if (c.setVisible && (first || visible === false)) {
        note(c, 'visible', visible);
        c.setVisible(true);
        if (n && visible === false) n.shown++;
      }
      if (c.setDisabled && (first || disabled === true)) {
        note(c, 'disabled', disabled);
        c.setDisabled(false);
        const name = read(() => c.getName());
        if (first && log.touched.length < 400 && log.touched.indexOf(name) < 0) log.touched.push(name);
        if (n && disabled === true) n.unlocked++;
      }
    });
    each(X.Page.ui.tabs, (t) => {
      if (read(() => t.getVisible()) === false) {
        note(t, 'visible', false);
        t.setVisible(true);
        if (n) n.shown++;
      }
      each(t.sections, (sec) => {
        if (read(() => sec.getVisible()) === false) {
          note(sec, 'visible', false);
          sec.setVisible(true);
          if (n) n.shown++;
        }
      });
    });
    return n || {};
  }

  /* Copy record, in the record's page: every column of the form that holds
   * a value, as the form has it - dates as ISO text, lookups as their
   * references - with the form and the table. Nothing is fetched. */
  function cloneRead() {
    const X = window.Xrm;
    const e = read(() => X.Page.data.entity);
    if (!e) return { error: 'No record form on this page.' };
    if (!read(() => e.getId())) return { error: 'This record is not saved yet - there is nothing to copy.' };
    const values = [];
    each(e.attributes, (a) => {
      const v = a.getValue();
      if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return;
      let out = v;
      if (v instanceof Date) out = { date: v.toISOString() };
      else if (Array.isArray(v) && v[0] && typeof v[0] === 'object' && 'entityType' in v[0]) out = v.map((x) => ({ id: x.id, name: x.name, entityType: x.entityType }));
      values.push({ name: a.getName(), type: read(() => a.getAttributeType()) || '', value: out });
    });
    return {
      entity: e.getEntityName(),
      formId: String(read(() => X.Page.ui.formSelector.getCurrentItem().getId()) || '').replace(/[{}]/g, ''),
      name: read(() => e.getPrimaryAttributeValue()) || '',
      values: values
    };
  }

  // Copy record, in the new record's page: the values go in once its form is
  // up - typed as the form wants them, without firing OnChange.
  function cloneFill(entity, values) {
    const X = window.Xrm;
    const e = read(() => X.Page.data.entity);
    if (!e || read(() => X.Page.ui.getFormType()) !== 1 || read(() => e.getEntityName()) !== entity) return { wait: true };
    let filled = 0;
    const skipped = [];
    for (const f of values || []) {
      const a = read(() => X.Page.getAttribute(f.name));
      if (!a) {
        skipped.push(f.name);
        continue;
      }
      try {
        a.setValue(f.value && f.value.date ? new Date(f.value.date) : f.value);
        filled++;
      } catch (err) {
        skipped.push(f.name);
      }
    }
    return { filled: filled, skipped: skipped };
  }

  // Controls God mode could not unlock - Dataverse keeps them read-only.
  function stillLocked() {
    const X = window.Xrm;
    const out = { entity: read(() => X.Page.data.entity.getEntityName()) || '', formType: read(() => X.Page.ui.getFormType()), locked: [] };
    each(X.Page.ui.controls, (c) => {
      if (read(() => c.getDisabled()) !== true) return;
      const attr = read(() => c.getAttribute());
      if (!attr) return;
      out.locked.push({ control: c.getName(), column: attr.getName(), label: read(() => c.getLabel()) || attr.getName() });
    });
    return out;
  }

  function restore() {
    for (const [obj, w] of god.was) {
      try {
        if ('required' in w) obj.setRequiredLevel(w.required);
        if ('visible' in w && w.visible !== undefined) obj.setVisible(w.visible);
        if ('disabled' in w && w.disabled !== undefined) obj.setDisabled(w.disabled);
      } catch (e) {
        /* gone with a redraw - nothing to put back */
      }
    }
    god.was.clear();
  }

  /* While God mode is on: a gold frame round the window with a faint haze
   * from its edges (neither takes a click) and a tab on its top edge,
   * "God mode on \u00d7" - the \u00d7 switches it off. Gold reads on the light form
   * and on the navy app bar alike. */
  const FRAME = 'dynaboost-god-frame';

  function showFrame() {
    if (document.getElementById(FRAME)) return;
    const box = document.createElement('div');
    box.id = FRAME;
    // A 4px frame, a faint gold haze that fades in from the edges (the
    // middle of the form stays as it is), and a tab on the top edge. None of
    // it takes a click but the \u00d7.
    const lock =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="4.5" y="11" width="15" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 7.6-1.7"/></svg>';
    box.innerHTML =
      '<style>#' + FRAME + '{position:fixed;inset:0;z-index:2147482000;pointer-events:none;' +
      'box-shadow:inset 0 0 0 4px rgba(227,176,75,.95),inset 0 0 90px 18px rgba(227,176,75,.16)}' +
      '#' + FRAME + ' .t{position:absolute;top:0;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:3px 7px 5px 14px;border-radius:0 0 10px 10px;' +
      'background:#e3b04b;color:#10224e;font:700 13px/22px "Segoe UI",system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;pointer-events:auto;box-shadow:0 2px 8px rgba(6,14,34,.3)}' +
      '#' + FRAME + ' button{all:unset;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:5px;cursor:pointer;font-size:17px;line-height:1}' +
      '#' + FRAME + ' button:hover{background:rgba(16,34,78,.16)}</style>' +
      '<div class="t" title="God mode is on in this page: hidden fields shown, locked ones unlocked, required ones optional">' + lock + 'God mode on' +
      '<button type="button" aria-label="Switch God mode off" title="Switch off - the form goes back as it was">\u00d7</button></div>';
    box.querySelector('button').addEventListener('click', () => {
      window.postMessage({ source: SRC + '-event', type: 'god-off-request' }, location.origin);
    });
    document.documentElement.appendChild(box);
  }

  function hideFrame() {
    const box = document.getElementById(FRAME);
    if (box) box.remove();
  }

  function godStop(put) {
    hideFrame();
    god.on = false;
    clearTimeout(god.timer);
    if (god.observer) god.observer.disconnect();
    god.observer = null;
    if (put) restore();
    else god.was.clear();
  }

  function godMode(on) {
    if (!on) {
      if (god.on) godStop(true);
      return { off: true };
    }
    if (god.on) return god.counts;
    const counts = unlockAll(true);
    if (!counts) return { error: 'No record form on this page.' };
    god.on = true;
    showFrame();
    god.record = recordId();
    window.__dynaboostGod = { log: log, god: god, counts: counts };
    god.counts = counts;
    god.observer = new MutationObserver(() => {
      clearTimeout(god.timer);
      god.timer = setTimeout(() => {
        if (!god.on) return;
        if (recordId() !== god.record) {
          // Another record: off, and nothing to put back on this one.
          godStop(false);
          window.postMessage({ source: SRC + '-event', type: 'god-off' }, location.origin);
          return;
        }
        unlockAll(false);
      }, 350);
    });
    god.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-disabled', 'aria-readonly', 'disabled', 'readonly'] });
    // UCI can draw a control again right after the first unlock (calculated
    // columns, for one): a second full pass once it has.
    setTimeout(() => {
      if (god.on && recordId() === god.record) unlockAll(true);
    }, 600);
    return counts;
  }

  on(window, 'message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== SRC || !d.op) return;
    let result = null;
    if (d.op === 'names') names(d.on, d.dark);
    if (d.op === 'god') result = godMode(d.on);
    if (d.op === 'still-locked') result = stillLocked();
    if (d.op === 'clone-read') result = cloneRead();
    if (d.op === 'clone-fill') result = cloneFill(d.entity, d.values);
    if (d.id) window.postMessage({ source: SRC + '-reply', id: d.id, result: result }, location.origin);
  });

  // Whoever relies on this helper (Logical names) says again what it wants.
  window.postMessage({ source: SRC + '-event', type: 'ready' }, location.origin);

  window.__dynaboostFormToolsStop = () => {
    listeners.forEach((off) => off());
    if (observer) observer.disconnect();
    if (god.observer) god.observer.disconnect();
    hideFrame();
    clearTimeout(timer);
    clearTimeout(god.timer);
    document.querySelectorAll('.db-ln').forEach((b) => b.remove());
  };
})();
