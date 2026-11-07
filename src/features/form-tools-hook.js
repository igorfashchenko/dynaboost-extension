/* DynaBoost - page-context helper for Logical names, Last change and God
 * mode.
 *
 * Runs in the page's own world, where window.Xrm is. It takes these
 * requests from the content scripts (window.postMessage):
 *   names  { on, dark } - a badge with the column's logical name under the
 *                         label of every field on the form, kept there while
 *                         the form redraws (tabs, other records); a click on
 *                         a badge copies the name. Off takes them away.
 *   changes { on, dark, data } - under the label of every field data names
 *                         (by column), its last audited change: a badge
 *                         with who and when, the values in its title. A
 *                         click on it asks for the field's history
 *                         (change-history event); a save says record-saved.
 *   god    { on }       - on: every field, section and tab shown, every
 *                         field unlocked, every column optional - and kept
 *                         so while the form's scripts and rules work; off:
 *                         the form as it was. On stays on: another record
 *                         (also a new one once saved) is opened up as it
 *                         comes, a page with no form waits for one, and a
 *                         reload is asked again by the content script.
 *                         Nothing is saved unless you save.
 * Nothing is fetched and nothing leaves the page.
 */
(function () {
  // A newer helper takes over from an older one (a tab not reloaded after an
  // update).
  if (typeof window.__dynaboostFormToolsStop === 'function') {
    try {
      window.__dynaboostFormToolsStop();
    } catch (e) {
      /* the old one is gone already */
    }
  }
  window.__dynaboostFormTools = true;
  const listeners = [];
  const bound = [];
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    bound.push(() => target.addEventListener(type, fn, opts));
    listeners.push(() => target.removeEventListener(type, fn, opts));
  };
  /* Dynamics writes its page anew as it starts (document.open), and that
   * takes every listener off the window and the document - this helper
   * would no longer hear what it is asked. So each second they are put on
   * again (the same one twice is still one). */
  const rebind = setInterval(() => bound.forEach((add) => add()), 1000);

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
      (document.head || document.documentElement).appendChild(s);
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

  /* The field's label on the form you see: a multisession app keeps the
   * forms of the other sessions in the page too, hidden. */
  function label(controlName) {
    const name = CSS.escape(controlName);
    const all = Array.from(document.querySelectorAll('label[id$="-' + name + '-field-label"]'));
    if (!all.length) all.push(...document.querySelectorAll('label[id$="' + name + '-field-label"]'));
    return all.find((el) => el.getClientRects().length) || all[0] || null;
  }

  /* The watches look at the whole document, not at its <html> or <body>:
   * Dynamics can write its page anew as it starts (document.open), and a
   * watch on the old elements would see nothing after that - nor would the
   * badges' style, gone with the old <head>. A beat every two seconds too,
   * for whatever a watch still misses. */
  let beat = 0;
  function heartbeat() {
    const want = namesOn || lc.on;
    if (want && !beat) beat = setInterval(() => {
      drawNames();
      drawChanges();
    }, 2000);
    if (!want && beat) {
      clearInterval(beat);
      beat = 0;
    }
  }

  function drawNames() {
    const X = window.Xrm;
    if (!namesOn || !X || !X.Page || !X.Page.ui) return;
    if (!document.getElementById(STYLE)) css();
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
    heartbeat();
    clearTimeout(timer);
    timer = 0;
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
        // At most every 300 ms - a page that never stops changing as it
        // loads (UCI) must not put the drawing off for ever.
        if (timer) return;
        timer = setTimeout(() => {
          timer = 0;
          drawNames();
        }, 300);
      });
      // A page asked early (the process designer, still loading) has no
    // body yet - its root is there from the start.
    observer.observe(document, { childList: true, subtree: true });
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
        window.postMessage({ source: SRC + '-event', type: 'name-copied' }, location.origin);
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

  /* Last change: the badges come ready from the content script (record-
   * history.js reads the audit); here they are put under the labels and kept
   * there as the form redraws. */
  const LC_STYLE = 'dynaboost-lc-style';
  const lc = { on: false, dark: false, data: {}, observer: null, timer: 0 };
  const saveHooked = new WeakSet();

  function lcCss() {
    let s = document.getElementById(LC_STYLE);
    if (!s) {
      s = document.createElement('style');
      s.id = LC_STYLE;
      (document.head || document.documentElement).appendChild(s);
    }
    const c = lc.dark
      ? { bg: '#1c2438', fg: '#c9d6f2', bd: '#3d5a99', was: '#ff9a9a', now: '#6fd396', mute: '#9aa8c7', card: '#1f2233', cardFg: '#e3e9f7', cardBd: '#3d5a99', tag: '#2a3350', gold: '#e3b04b' }
      : { bg: '#f2f6ff', fg: '#2b3a5e', bd: '#9db8f0', was: '#a11a1a', now: '#1c6b32', mute: '#5a6a8a', card: '#ffffff', cardFg: '#10224e', cardBd: '#c6d0e4', tag: '#eef2fb', gold: '#e3b04b' };
    s.textContent =
      '.db-lc{display:block;width:fit-content;max-width:100%;box-sizing:border-box;margin:3px 0 1px;padding:0 7px;border:1px dashed ' + c.bd + ';border-radius:5px;background:' + c.bg + ';color:' + c.fg + ';' +
      'font:500 11.5px/1.6 "Segoe UI",system-ui,sans-serif;letter-spacing:0;text-transform:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}' +
      '.db-lc:hover{border-style:solid}' +
      '.db-lc .db-lc-was{color:' + c.was + ';text-decoration:line-through;text-decoration-thickness:1px}' +
      '.db-lc .db-lc-now{color:' + c.now + ';font-weight:600}' +
      '.db-lc .db-lc-arrow{color:' + c.mute + ';margin:0 5px}' +
      '.db-lc i{color:' + c.mute + ';font-style:italic;text-decoration:none}' +
      '#dynaboost-lc-card{position:fixed;z-index:2147483646;max-width:380px;min-width:220px;padding:9px 12px 8px;border:1px solid ' + c.cardBd + ';border-top:3px solid ' + c.gold + ';border-radius:8px;' +
      'background:' + c.card + ';color:' + c.cardFg + ';box-shadow:0 8px 24px rgba(16,34,78,.18);font:12.5px/1.45 "Segoe UI",system-ui,sans-serif;letter-spacing:0;text-transform:none;pointer-events:none}' +
      '#dynaboost-lc-card[hidden]{display:none}' +
      '#dynaboost-lc-card .h{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap}' +
      '#dynaboost-lc-card b{font-size:13.5px}' +
      '#dynaboost-lc-card .tag{padding:0 6px;border-radius:4px;background:' + c.tag + ';color:' + c.mute + ';font-size:11px;font-weight:600}' +
      '#dynaboost-lc-card .via,#dynaboost-lc-card .t,#dynaboost-lc-card .f{color:' + c.mute + '}' +
      '#dynaboost-lc-card .v{display:grid;grid-template-columns:auto 1fr;gap:1px 8px;margin:6px 0 5px}' +
      '#dynaboost-lc-card .v span{color:' + c.mute + '}' +
      '#dynaboost-lc-card .v div{white-space:pre-wrap;word-break:break-word;max-height:7.5em;overflow:hidden}' +
      '#dynaboost-lc-card .was{color:' + c.was + '}#dynaboost-lc-card .now{color:' + c.now + ';font-weight:600}' +
      '#dynaboost-lc-card i{color:' + c.mute + '}' +
      '#dynaboost-lc-card .f{font-size:11.5px;border-top:1px solid ' + c.cardBd + ';padding-top:4px;margin-top:2px}';
  }

  const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

  function lcAgo(at) {
    const s = (Date.now() - at) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 86400 * 30) return Math.floor(s / 86400) + ' d ago';
    if (s < 86400 * 365) return Math.floor(s / 86400 / 30) + ' mo ago';
    return Math.floor(s / 86400 / 365) + ' y ago';
  }

  // On the badge: the value's first line, short.
  const short = (t) => {
    const line = String(t).split(/\r?\n/)[0];
    return line.length > 28 ? line.slice(0, 27) + '\u2026' : line;
  };
  const shown = (t, cls) => (t === '' ? '<i>empty</i>' : '<span class="' + cls + '">' + esc(short(t)) + '</span>');

  function badgeHtml(ch) {
    if (!ch.values) return '\u270e ' + esc(ch.who) + ' \u00b7 ' + lcAgo(ch.at);
    return shown(ch.old, 'db-lc-was') + '<span class="db-lc-arrow">\u2192</span>' + shown(ch.new, 'db-lc-now');
  }

  // The card on hover: who and when, the values whole.
  function cardHtml(ch) {
    const value = (t, cls) => (t === '' ? '<i>empty</i>' : '<div class="' + cls + '">' + esc(t) + '</div>');
    return (
      '<div class="h"><b>' + esc(ch.who) + '</b><span class="tag">' + esc(ch.action) + '</span></div>' +
      (ch.caller ? '<div class="via">called by ' + esc(ch.caller) + '</div>' : '') +
      '<div class="t">' + esc(ch.when) + ' \u00b7 ' + lcAgo(ch.at) + '</div>' +
      (ch.values ? '<div class="v"><span>Was</span>' + value(ch.old, 'was') + '<span>Now</span>' + value(ch.new, 'now') + '</div>' : '') +
      '<div class="f">' + ch.count + ' audited change' + (ch.count === 1 ? '' : 's') + (ch.capped ? ' in the newest ' + ch.capped : '') + ' \u00b7 click for the field\u2019s history</div>'
    );
  }

  function card() {
    let c = document.getElementById('dynaboost-lc-card');
    if (!c) {
      c = document.createElement('div');
      c.id = 'dynaboost-lc-card';
      c.hidden = true;
      (document.body || document.documentElement).appendChild(c);
    }
    return c;
  }

  function showCard(b) {
    const ch = lc.data[b.dataset.col];
    if (!ch) return;
    if (!document.getElementById(LC_STYLE)) lcCss();
    const c = card();
    c.innerHTML = cardHtml(ch);
    c.hidden = false;
    const r = b.getBoundingClientRect();
    const w = c.offsetWidth;
    const h = c.offsetHeight;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const below = r.bottom + 6 + h <= window.innerHeight - 8;
    c.style.left = left + 'px';
    c.style.top = (below ? r.bottom + 6 : Math.max(8, r.top - h - 6)) + 'px';
  }

  function hideCard() {
    const c = document.getElementById('dynaboost-lc-card');
    if (c) c.hidden = true;
  }

  on(document, 'mouseover', (e) => {
    const b = e.target && e.target.closest && e.target.closest('.db-lc');
    if (b && lc.on) showCard(b);
  }, true);
  on(document, 'mouseout', (e) => {
    const b = e.target && e.target.closest && e.target.closest('.db-lc');
    if (b && !(e.relatedTarget && b.contains(e.relatedTarget))) hideCard();
  }, true);
  on(window, 'scroll', hideCard, true);

  // A save writes a new change: the content script reads the audit again.
  function hookSave() {
    const e = read(() => window.Xrm.Page.data.entity);
    if (!e || typeof e.addOnPostSave !== 'function' || saveHooked.has(e)) return;
    saveHooked.add(e);
    try {
      e.addOnPostSave(() => {
        if (lc.on) window.postMessage({ source: SRC + '-event', type: 'record-saved' }, location.origin);
      });
    } catch (err) {
      /* no post-save on this form - a new record is read when it opens */
    }
  }

  function drawChanges() {
    const X = window.Xrm;
    if (!lc.on || !X || !X.Page || !X.Page.ui) return;
    if (!document.getElementById(LC_STYLE)) lcCss();
    hookSave();
    each(X.Page.ui.controls, (c) => {
      const attr = c.getAttribute && c.getAttribute();
      if (!attr) return;
      const el = label(c.getName());
      if (!el) return;
      const col = attr.getName();
      const ch = lc.data[col];
      const old = el.querySelector('.db-lc');
      if (old && ch && old.dataset.key === ch.key) return;
      if (old) old.remove();
      if (!ch) return;
      const badge = document.createElement('span');
      badge.className = 'db-lc';
      badge.dataset.col = col;
      badge.dataset.key = ch.key;
      badge.innerHTML = badgeHtml(ch);
      badge.setAttribute('aria-label', 'Last change: ' + ch.who + ', ' + ch.when + (ch.values ? ' - was ' + (ch.old || 'empty') + ', now ' + (ch.new || 'empty') : '') + ' - click for its history');
      el.appendChild(badge);
    });
  }

  function changes(on, isDark, data) {
    lc.on = !!on;
    lc.dark = !!isDark;
    heartbeat();
    lc.data = (on && data) || {};
    clearTimeout(lc.timer);
    lc.timer = 0;
    if (!lc.on) {
      if (lc.observer) lc.observer.disconnect();
      lc.observer = null;
      document.querySelectorAll('.db-lc, #dynaboost-lc-card').forEach((b) => b.remove());
      const s = document.getElementById(LC_STYLE);
      if (s) s.remove();
      return;
    }
    lcCss();
    drawChanges();
    if (!lc.observer) {
      lc.observer = new MutationObserver(() => {
        if (lc.timer) return;
        lc.timer = setTimeout(() => {
          lc.timer = 0;
          drawChanges();
        }, 300);
      });
      lc.observer.observe(document, { childList: true, subtree: true });
    }
  }

  // A click on a badge asks for the field's history - and does not reach
  // the field.
  on(
    document,
    'click',
    (e) => {
      const b = e.target && e.target.closest && e.target.closest('.db-lc');
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      window.postMessage({ source: SRC + '-event', type: 'change-history', column: b.dataset.col }, location.origin);
    },
    true
  );

  /* God mode, while on: every control shown and unlocked, every column
   * optional, every section and tab shown - on each of them, since some do not
   * say they are hidden or locked. Kept up while on, as the form's scripts and
   * rules change them again and tabs draw their fields later. What each was
   * before is noted on first touch; off puts it back. Another record is
   * opened up anew - the one before is gone, there is nothing to put back. */
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

  /* While God mode is on: a gold frame with a faint haze (click-through) and
   * a tab on the top edge whose \u00d7 switches it off. */
  const FRAME = 'dynaboost-god-frame';

  function showFrame() {
    if (document.getElementById(FRAME)) return;
    const box = document.createElement('div');
    box.id = FRAME;
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
      '<div class="t" title="God mode is on: hidden fields shown, locked ones unlocked, required ones optional - also after a reload and on other records">' + lock + 'God mode on' +
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
    god.timer = 0;
    if (god.observer) god.observer.disconnect();
    god.observer = null;
    if (put) restore();
    else god.was.clear();
  }

  // The form there is now, if any: the frame shows only over a form.
  function godPass(first) {
    const counts = unlockAll(first);
    if (counts) showFrame();
    else hideFrame();
    return counts;
  }

  // A record's first pass, and a second full one once UCI has drawn its
  // controls again (calculated columns, for one).
  function godOpen() {
    god.record = recordId();
    god.counts = godPass(true);
    const record = god.record;
    setTimeout(() => {
      if (god.on && recordId() === record) godPass(true);
    }, 600);
  }

  function godMode(on) {
    if (!on) {
      if (god.on) godStop(true);
      return { off: true };
    }
    if (god.on) return god.counts || { waiting: true };
    god.on = true;
    godOpen();
    window.__dynaboostGod = { log: log, god: god };
    god.observer = new MutationObserver(() => {
      if (god.timer) return;
      god.timer = setTimeout(() => {
        god.timer = 0;
        if (!god.on) return;
        if (recordId() !== god.record) {
          // Another record: the one before is gone - nothing to put back.
          god.was.clear();
          godOpen();
          return;
        }
        godPass(false);
      }, 350);
    });
    god.observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-disabled', 'aria-readonly', 'disabled', 'readonly'] });
    return god.counts || { waiting: true };
  }

  on(window, 'message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== SRC || !d.op) return;
    let result = null;
    if (d.op === 'names') names(d.on, d.dark);
    if (d.op === 'changes') changes(d.on, d.dark, d.data);
    if (d.op === 'god') result = godMode(d.on);
    if (d.op === 'still-locked') result = stillLocked();
    if (d.op === 'clone-read') result = cloneRead();
    if (d.op === 'clone-fill') result = cloneFill(d.entity, d.values);
    if (d.id) window.postMessage({ source: SRC + '-reply', id: d.id, result: result }, location.origin);
  });

  // Whoever relies on this helper (Logical names, Last change) says again
  // what it wants.
  window.postMessage({ source: SRC + '-event', type: 'ready' }, location.origin);

  window.__dynaboostFormToolsStop = () => {
    clearInterval(rebind);
    listeners.forEach((off) => off());
    if (observer) observer.disconnect();
    if (god.observer) god.observer.disconnect();
    if (lc.observer) lc.observer.disconnect();
    clearInterval(beat);
    hideFrame();
    clearTimeout(timer);
    clearTimeout(god.timer);
    clearTimeout(lc.timer);
    document.querySelectorAll('.db-ln, .db-lc, #dynaboost-lc-card').forEach((b) => b.remove());
  };
})();
