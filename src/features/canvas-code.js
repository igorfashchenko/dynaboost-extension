/* Feature: Edit screen code (canvas apps and custom pages).
 *
 * Studio's View code is read-only. This opens its YAML in an editable tab -
 * read from the open View code dialog (canvas-code-hook.js) or from the
 * clipboard. Copy puts it back on the clipboard; Apply to Studio replaces the
 * controls named in the YAML through Studio's own delete and paste.
 * Screen-level YAML replaces the screen's children; the screen's own
 * properties cannot travel through a paste.
 *
 * A pasted control whose name exists comes in as a copy (Name_1), so the
 * editor lists the names it finds. Checks: tabs in the indentation, odd
 * indentation, duplicate names, ": " or " #" in a plain value.
 *
 * Versions, for the tab and per code loaded (a screen, or a set of
 * controls): the code as loaded - always kept - and the last 5 applied to
 * Studio; a click loads one into the editor.
 */
(function () {
  if (DynaBoost.off) return;
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="3" y="4" width="18" height="16" rx="2" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="m8.5 10-2.5 2.5L8.5 15M12 10l2.5 2.5L12 15" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="m16 17 1.5-6" stroke="#E3B04B" stroke-width="1.6" stroke-linecap="round"/>' +
    '</svg>';

  const MAX_SAVED = 5; // versions per code loaded, besides the original

  const CHECK =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m5 13 4 4L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ---------- reading the YAML ----------

  const KEY_RE = /^(\s*)(?:-\s+)?([^\s:#'"][^:#]*?):\s*$/;

  function indentOf(line) {
    return line.match(/^\s*/)[0].length;
  }

  /* Names of controls and screens, in order. A control is any key whose first
   * child line is "Control: ...". A screen is a key directly under
   * "Screens:". Everything else (Properties, Children, Groups...) is
   * structure, not a name. */
  function outline(text) {
    const lines = text.split(/\r?\n/);
    const controls = [];
    const screens = [];
    let screensIndent = -1;
    let screenKeyIndent = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const ind = indentOf(line);

      if (screensIndent >= 0 && ind <= screensIndent) screensIndent = screenKeyIndent = -1;
      if (/^\s*Screens:\s*$/.test(line)) {
        screensIndent = ind;
        continue;
      }

      const m = line.match(KEY_RE);
      if (!m) continue;
      const name = m[2].trim();

      if (screensIndent >= 0 && ind > screensIndent && (screenKeyIndent < 0 || ind === screenKeyIndent)) {
        screenKeyIndent = ind;
        screens.push(name);
        continue;
      }

      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && indentOf(lines[j]) > ind && /^\s*Control:\s*\S/.test(lines[j])) controls.push(name);
    }
    return { screens: screens, controls: controls };
  }

  function lint(text) {
    const problems = [];
    const lines = text.split(/\r?\n/);
    const tabs = [];
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*\t/.test(lines[i])) tabs.push(i + 1);
    }
    // A plain value may not hold ": " or " #" - YAML reads a key or a
    // comment there and Studio rejects the paste. Studio itself writes such
    // formulas as a |- block.
    const colon = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\s*(?:-\s+)?[^\s:#'"][^:#]*?:\s+(=.*)$/);
      if (m && /: |\s#/.test(m[1])) colon.push(i + 1);
    }
    if (colon.length) problems.push('Line ' + colon.slice(0, 5).join(', ') + (colon.length > 5 ? '\u2026' : '') + ': the formula holds ": " or " #" \u2014 put it on its own line under "|-"');
    if (tabs.length) problems.push('Tab in the indentation on line ' + tabs.slice(0, 5).join(', ') + (tabs.length > 5 ? '…' : '') + ' — YAML needs spaces');

    const o = outline(text);
    const seen = new Set();
    const dup = new Set();
    for (const n of o.controls.concat(o.screens)) {
      if (seen.has(n)) dup.add(n);
      seen.add(n);
    }
    if (dup.size) problems.push('Duplicate name: ' + Array.from(dup).slice(0, 5).join(', '));
    return { problems: problems, outline: o };
  }

  // ---------- the editor tab ----------

  function flash(btn, text, ok) {
    if (btn.__dbTimer) clearTimeout(btn.__dbTimer);
    if (btn.__dbLabel == null) btn.__dbLabel = btn.textContent;
    btn.innerHTML = (ok ? CHECK : '') + esc(text);
    btn.classList.remove('db-ok', 'db-bad');
    btn.classList.add(ok ? 'db-ok' : 'db-bad');
    btn.__dbTimer = setTimeout(() => {
      btn.textContent = btn.__dbLabel;
      btn.classList.remove('db-ok', 'db-bad');
    }, 2600);
  }

  async function copyInto(tab, text) {
    try {
      await tab.navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const doc = tab.document;
        const ta = doc.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        doc.body.appendChild(ta);
        ta.select();
        const ok = doc.execCommand('copy');
        doc.body.removeChild(ta);
        return ok;
      } catch (e2) {
        return false;
      }
    }
  }

  function download(tab, content, name) {
    const doc = tab.document;
    const blob = new tab.Blob([content], { type: 'text/yaml' });
    const url = tab.URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = name;
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    setTimeout(() => tab.URL.revokeObjectURL(url), 10000);
  }

  /* make.powerapps.com's permissions policy refuses clipboard reads to its
   * pages, and the editor tab inherits it. The extension reads it instead,
   * through an offscreen document (src/offscreen.js). null when that fails. */
  async function readExtensionClipboard() {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'DB_READ_CLIPBOARD' });
      return r && r.ok ? r.text : null;
    } catch (e) {
      return null;
    }
  }

  async function readClipboard(tab) {
    const text = await readExtensionClipboard();
    if (text != null) return text;
    try {
      return await tab.navigator.clipboard.readText();
    } catch (e) {
      return null;
    }
  }

  /* The open View code dialog, read by canvas-code-hook.js in the Studio
   * iframe. Resolves { text, title } or null when there is no dialog. */
  const HOOK = 'dynaboost-canvas-code';
  const STUDIO_ORIGIN = /^https:\/\/[^/]+\.gateway\.prod\.island\.powerapps\.com$/;

  function studioFrames() {
    return Array.from(document.querySelectorAll('iframe')).filter((f) => {
      try {
        return STUDIO_ORIGIN.test(new URL(f.src).origin);
      } catch (e) {
        return false;
      }
    });
  }

  function askStudio() {
    const frames = studioFrames();
    if (!frames.length) return Promise.resolve(null);
    const nonce = Math.random().toString(36).slice(2);
    return new Promise((resolve) => {
      let left = frames.length;
      const done = (v) => {
        window.removeEventListener('message', onMsg);
        clearTimeout(timer);
        resolve(v);
      };
      function onMsg(e) {
        if (!STUDIO_ORIGIN.test(e.origin)) return;
        const d = e.data;
        if (!d || d.source !== HOOK || d.type !== 'code' || d.nonce !== nonce) return;
        if (d.text) return done({ text: d.text, title: d.title || '', screen: d.screen || '' });
        if (--left === 0) done(null);
      }
      window.addEventListener('message', onMsg);
      const timer = setTimeout(() => done(null), 1500);
      for (const f of frames) f.contentWindow.postMessage({ source: HOOK, type: 'request', nonce: nonce }, new URL(f.src).origin);
    });
  }

  // "View code: Screen1" or similar -> "Screen1". Only a hint for where to
  // paste when none of the controls exist yet.
  function screenFromTitle(title) {
    const m = String(title || '').match(/([A-Za-z_][\w]*)\s*$/);
    return m ? m[1] : '';
  }

  // The names at the top of a control-level YAML list: "- Name:" at column 0.
  function topNames(text) {
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^-\s+([^\s:#'"][^:#]*?):\s*$/);
      if (m) out.push(m[1].trim());
    }
    return out;
  }

  /* "Screens:" code -> the one screen's name, its Children as control-level
   * YAML (dedented to column 0), their names, and the screen's own
   * Properties block as text (to notice edits a paste cannot carry). */
  function screenParts(text) {
    const lines = text.split(/\r?\n/);
    const at = lines.findIndex((l) => /^\s*Screens:\s*$/.test(l));
    if (at < 0) return null;
    const base = indentOf(lines[at]);
    const keys = [];
    for (let i = at + 1; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim()) continue;
      const ind = indentOf(l);
      if (ind <= base) break;
      const m = l.match(KEY_RE);
      if (m && (!keys.length || ind === keys[0].ind)) keys.push({ name: m[2].trim(), ind: ind, line: i });
    }
    if (keys.length !== 1) return { error: keys.length ? 'many' : 'none', count: keys.length };
    const scr = keys[0];
    let children = [];
    let props = [];
    let block = null;
    let blockInd = -1;
    for (let i = scr.line + 1; i < lines.length; i++) {
      const l = lines[i];
      const ind = indentOf(l);
      if (l.trim() && ind <= scr.ind) break;
      if (l.trim() && (block === null || ind <= blockInd)) {
        const m = l.match(/^(\s*)(Children|Properties):\s*$/);
        block = m ? m[2] : 'other';
        blockInd = ind;
        continue;
      }
      if (block === 'Children') children.push(l);
      if (block === 'Properties') props.push(l);
    }
    const cut = children.reduce((min, l) => (l.trim() ? Math.min(min, indentOf(l)) : min), Infinity);
    const kids = children.map((l) => l.slice(Math.min(cut, indentOf(l)))).join('\n').replace(/\s+$/, '');
    return { name: scr.name, yaml: kids ? kids + '\n' : '', names: topNames(kids), props: props.join('\n').trim() };
  }

  function applyToStudio(payload) {
    const frames = studioFrames();
    if (!frames.length) return Promise.resolve({ error: 'no-frame' });
    const nonce = Math.random().toString(36).slice(2);
    return new Promise((resolve) => {
      let left = frames.length;
      const done = (v) => {
        window.removeEventListener('message', onMsg);
        clearTimeout(timer);
        resolve(v);
      };
      function onMsg(e) {
        if (!STUDIO_ORIGIN.test(e.origin)) return;
        const d = e.data;
        if (!d || d.source !== HOOK || d.type !== 'applied' || d.nonce !== nonce) return;
        if (d.error === 'no-tree' && --left > 0) return;
        done(d);
      }
      window.addEventListener('message', onMsg);
      const timer = setTimeout(() => done({ error: 'timeout' }), 60000);
      for (const f of frames) {
        f.contentWindow.postMessage(Object.assign({ source: HOOK, type: 'apply', nonce: nonce }, payload), new URL(f.src).origin);
      }
    });
  }

  // Studio YAML, as opposed to whatever else was on the clipboard.
  function looksLikeStudio(text) {
    return /^\s*Control:\s*\S/m.test(text) || /^\s*Screens:\s*$/m.test(text);
  }

  function buildHtml() {
    return (
      '<!doctype html><meta charset="utf-8"><title>Screen code — DynaBoost</title>' +
      '<style>' +
      'html,body{height:100%}' +
      'body{margin:0;display:flex;flex-direction:column;font:14px/1.5 "Segoe UI",system-ui,sans-serif;color:var(--dbc-fg-10224e);background:var(--dbc-bg-f5f7fc)}' +
      'code{font:12.5px ui-monospace,Consolas,monospace;color:var(--dbc-fg-56637f)}' +
      'header{flex:none;padding:16px 22px 0;background:var(--dbc-bg-fff);border-bottom:2px solid var(--dbc-bd-e3b04b)}' +
      'h1{margin:0;font-size:19px;font-weight:600}' +
      '.steps{margin:4px 0 0;padding-left:20px;font-size:13px;color:var(--dbc-fg-56637f)}' +
      '.bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px;padding-bottom:12px}' +
      'button{padding:7px 13px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);font:inherit;cursor:pointer}' +
      'button:hover:enabled{border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-1e6bff)}' +
      'button:disabled{opacity:.45;cursor:default}' +
      'button.primary{background:var(--dbc-bg-1e6bff);border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-fff);font-weight:600}' +
      'button.primary:hover:enabled{background:var(--dbc-bg-155ee0);color:var(--dbc-fg-fff)}' +
      'button svg{width:14px;height:14px;vertical-align:-2px;margin-right:6px}' +
      'button.db-ok{border-color:var(--dbc-bd-1c6b32);color:var(--dbc-fg-1c6b32);background:var(--dbc-bg-e4f4e8)}' +
      'button.db-bad{border-color:var(--dbc-bd-a11a1a);color:var(--dbc-fg-a11a1a);background:var(--dbc-bg-fde8e8)}' +
      '.status{margin-left:auto;font-size:12.5px;color:var(--dbc-fg-56637f)}.status.bad{color:var(--dbc-fg-a11a1a)}' +
      'main{flex:1;display:flex;gap:14px;min-height:0;padding:14px 22px 18px}' +
      'textarea{flex:1;width:100%;resize:none;padding:14px 18px;border:1px solid var(--dbc-bd-dde3f0);border-radius:8px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);font:12.5px/1.45 ui-monospace,Consolas,monospace;white-space:pre;tab-size:2}' +
      'textarea:focus{outline:2px solid var(--dbc-bd-1e6bff);outline-offset:-1px}' +
      // The pane beside the editor, as in the flow editor: Versions | Controls
      'aside{flex:none;width:340px;display:none;flex-direction:column;min-height:0;border:1px solid var(--dbc-bd-dde3f0);border-radius:8px;background:var(--dbc-bg-fff)}' +
      'body.side aside{display:flex}' +
      '.ck-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--dbc-bd-dde3f0);font-weight:600}' +
      '.ck-head .pn{padding:4px 10px;border:1px solid transparent;border-radius:6px;background:none;color:var(--dbc-fg-56637f);font-weight:600;font-size:13px}' +
      '.ck-head .pn:hover:enabled{border-color:transparent;background:var(--dbc-bg-f5f7fc);color:var(--dbc-fg-10224e)}' +
      'body.pane-versions #tab-versions,body.pane-names #tab-names{background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-10224e)}' +
      '.ck-head #vs-close{margin-left:auto;padding:2px 8px;border:none;background:none;color:var(--dbc-fg-56637f);font-size:15px;line-height:1}' +
      '.ck-head #vs-close:hover:enabled{background:var(--dbc-bg-f5f7fc);color:var(--dbc-fg-10224e)}' +
      '#vs-list,#names{display:none;flex:1;overflow:auto}' +
      'body.pane-versions #vs-list,body.pane-names #names{display:block}' +
      '#vs-list{padding:6px 0}#names{padding:12px 14px;font-size:12.5px}' +
      '#names h2{margin:0 0 4px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--dbc-fg-56637f)}' +
      '#names ul{margin:0 0 12px;padding-left:16px}#names li{font-family:ui-monospace,Consolas,monospace}' +
      '#names .none{color:var(--dbc-fg-8a94ab)}' +
      '.warn{margin-top:8px;padding:8px 12px;border-radius:6px;background:var(--dbc-bg-fdf1d6);color:var(--dbc-fg-7a5410);font-size:13px;max-width:900px}' +
      '.warn[hidden]{display:none}' +
      '.log{margin-top:8px;font-size:12.5px;color:var(--dbc-fg-56637f)}.log[hidden]{display:none}.log summary{cursor:pointer}.log ol{margin:4px 0 0;padding-left:22px}' +
      '.sep{width:1px;align-self:stretch;margin:2px 4px;background:var(--dbc-bg-dde3f0)}' +
      '.nb{display:inline-block;min-width:18px;margin-left:4px;padding:0 5px;border-radius:9px;background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f);font-size:11px;line-height:17px;text-align:center}.nb:empty{display:none}' +
      // Versions rows, as in the flow editor
      '.vs-h{padding:10px 14px 4px;font-size:12px;font-weight:600;letter-spacing:.3px;text-transform:uppercase;color:var(--dbc-fg-56637f)}' +
      '.vs{display:flex;align-items:flex-start;gap:10px;margin:4px 10px;padding:8px 10px;border:1px solid var(--dbc-bd-e3e8f2);border-radius:6px;background:var(--dbc-bg-fff);cursor:pointer;transition:border-color .15s,background .15s}' +
      '.vs:hover{border-color:var(--dbc-bd-1e6bff);background:var(--dbc-bg-f7faff)}' +
      '.vs.orig{border-left:3px solid var(--dbc-bd-e3b04b)}.vs.here{box-shadow:0 0 0 2px var(--dbc-bd-1e6bff) inset}.vs.orig.live{background:var(--dbc-bg-fffaf0)}' +
      '.vs-dot{flex:none;width:9px;height:9px;margin-top:6px;border-radius:50%;background:var(--dbc-bg-c6d0e4)}' +
      '.vs.live .vs-dot{background:var(--dbc-bg-1c9b4a)}.vs.orig .vs-dot{background:var(--dbc-bg-e3b04b)}' +
      '.vs-main{flex:1;min-width:0}.vs-t{font-weight:600;font-size:13px}.vs-m{font-size:12px;color:var(--dbc-fg-56637f)}' +
      '.vs-tag{display:inline-block;margin-left:6px;padding:0 6px;border-radius:8px;font-size:11px;font-weight:600;vertical-align:1px}' +
      '.vs-tag.live{background:var(--dbc-bg-e4f4e8);color:var(--dbc-fg-1c6b32)}.vs-tag.here{background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-1e4fb8)}' +
      '.vs-note{padding:6px 14px 8px;font-size:12px;color:var(--dbc-fg-8a95ad)}' +
      DynaBoost.code.css +
      DynaBoost.tabCss +
      '</style>' +
      '<body class="side pane-versions">' +
      '<header>' +
      '<h1 id="title">Screen code</h1>' +
      '<ol class="steps">' +
      '<li>In Studio open <b>… → View code</b> on the screen or control, then click this tile \u2014 the code loads here.</li>' +
      '<li>Edit it.</li>' +
      '<li><b>Apply to Studio</b> \u2014 replaces those controls in Studio (Ctrl+Z there undoes it). Check the result and <b>Save</b> in Studio.</li>' +
      '</ol>' +
      '<div class="warn" id="warn" hidden></div>' +
      '<details class="log" id="logbox" hidden><summary>Steps in Studio</summary><ol id="log"></ol></details>' +
      '<div class="bar">' +
      '<button class="primary" id="apply">Apply to Studio</button>' +
      '<button id="copy">Copy</button>' +
      '<button id="load">Load from Studio</button>' +
      '<button id="revert" disabled>Undo changes</button>' +
      '<button id="dl">Download</button>' +
      '<span class="sep"></span>' +
      '<button id="versions" aria-pressed="true" title="The code as loaded and what you applied - click one to load it">Versions<span class="nb" id="vs-n"></span></button>' +
      '<span class="status" id="status"></span>' +
      '</div></header>' +
      '<main><textarea id="ed" spellcheck="false" placeholder="Open View code in Studio and click Load from Studio \u2014 or paste the code here"></textarea>' +
      '<aside><div class="ck-head">' +
      '<button class="pn" id="tab-versions" data-pane="versions">Versions</button>' +
      '<button class="pn" id="tab-names" data-pane="names">Controls</button>' +
      '<button id="vs-close" title="Close" aria-label="Close">\u2715</button></div>' +
      '<div id="vs-list"></div><div id="names"></div></aside></main>'
    );
  }

  function wire(tab) {
    const doc = tab.document;
    const get = (id) => doc.getElementById(id);
    const ed = get('ed');
    DynaBoost.code.attach(tab, ed, 'yaml');
    const status = get('status');
    const warn = get('warn');
    const names = get('names');
    let original = '';

    function list(title, items) {
      return (
        '<h2>' + esc(title) + ' (' + items.length + ')</h2>' +
        (items.length ? '<ul>' + items.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '<p class="none">none found</p>')
      );
    }

    function check() {
      const text = ed.value;
      if (!text.trim()) {
        status.textContent = 'Empty';
        status.classList.remove('bad');
        warn.hidden = true;
        names.innerHTML = list('Screens', []) + list('Controls', []);
        get('copy').disabled = true;
        get('apply').disabled = true;
        get('revert').disabled = true;
        return;
      }
      const r = lint(text);
      const lines = text.split(/\r?\n/).length;
      const modified = original && text !== original;
      status.textContent = (modified ? 'Modified · ' : source === 'applied' ? 'Applied · ' : source ? 'From ' + source + ' · ' : '') + lines + ' lines · ' + r.outline.controls.length + ' controls' + (r.problems.length ? ' · ' + r.problems.length + ' problem(s)' : '');
      status.classList.toggle('bad', r.problems.length > 0);
      warn.hidden = !r.problems.length;
      warn.textContent = r.problems.join(' · ');
      names.innerHTML = list('Screens', r.outline.screens) + list('Controls', r.outline.controls);
      get('copy').disabled = false;
      get('apply').disabled = false;
      get('revert').disabled = !modified;
    }

    let source = '';
    let lastScreen = '';
    function showLog(lines) {
      const box = get('logbox');
      box.hidden = !(lines && lines.length);
      get('log').innerHTML = (lines || []).map((l) => '<li>' + esc(l) + '</li>').join('');
    }

    function setStatus(text, bad) {
      status.textContent = text;
      status.classList.toggle('bad', !!bad);
    }

    function load(text, from, title, screen) {
      lastScreen = screen || screenFromTitle(title) || lastScreen;
      original = text;
      ed.value = text;
      startVersions(ed.value, title);
      source = from || '';
      get('title').textContent = title ? 'Screen code \u2014 ' + title : 'Screen code';
      doc.title = (title || 'Screen code') + ' \u2014 DynaBoost';
      check();
    }

    // View code first; the clipboard when no dialog is open.
    async function fetchCode(tab) {
      const s = await askStudio();
      if (s) return { text: s.text, from: 'View code', title: s.title, screen: s.screen };
      const c = await readClipboard(tab);
      if (c == null) return { blocked: true };
      return { text: c, from: 'clipboard', title: '' };
    }

    let timer = null;
    ed.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(check, 200);
    });

    // ---------- versions ----------
    //
    // The pane beside the editor, open from the start as in Edit flow. One
    // list per code loaded - a screen, or a set of controls - so loading
    // another screen and coming back keeps each one's versions: the code as
    // loaded - always kept - and the last MAX_SAVED applied to Studio. A click
    // loads one into the editor; Apply to Studio makes it live.
    const lists = new Map();
    let versions = null;
    const vlist = get('vs-list');
    const lf = (t) => String(t || '').replace(/\r\n?/g, '\n'); // as the editor holds text
    const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    function codeKey(text) {
      const sp = screenParts(text);
      if (sp && !sp.error) return 'screen:' + sp.name;
      const names = topNames(text);
      return names.length ? 'controls:' + names.join(',') : 'code';
    }

    function startVersions(text, title) {
      const key = codeKey(text);
      versions = lists.get(key) || { original: { text: text, at: Date.now() }, saved: [], next: 1, title: title || '' };
      lists.set(key, versions);
      renderVersions();
    }

    function versionOf(key) {
      if (!versions) return null;
      if (key === 'o') return { v: versions.original, name: 'The original' };
      const v = versions.saved.find((x) => 's' + x.n === key);
      return v && { v: v, name: 'Version ' + v.n };
    }

    function renderVersions() {
      if (!versions) {
        vlist.innerHTML = '<div class="vs-note">The code as loaded shows here, then each Apply to Studio.</div>';
        get('vs-n').textContent = '';
        return;
      }
      const row = (key, title, v) => {
        const inStudio = v.text === lf(original);
        const here = v.text === ed.value;
        const n = outline(v.text).controls.length;
        return (
          '<div class="vs' + (key === 'o' ? ' orig' : '') + (inStudio ? ' live' : '') + (here ? ' here' : '') + '" data-vs="' + key + '" title="Click to load into the editor">' +
          '<span class="vs-dot"></span><div class="vs-main"><div class="vs-t">' + esc(title) +
          (inStudio ? '<span class="vs-tag live">in Studio</span>' : '') +
          (here && !inStudio ? '<span class="vs-tag here">in the editor</span>' : '') +
          '</div><div class="vs-m">' + esc(clock(v.at)) + ' · ' + n + ' control' + (n === 1 ? '' : 's') + '</div></div></div>'
        );
      };
      const rows = ['<div class="vs-h">' + esc(versions.title || 'This code') + '</div>', row('o', 'Original', versions.original)];
      versions.saved.slice().reverse().forEach((v) => rows.push(row('s' + v.n, 'Version ' + v.n, v)));
      rows.push('<div class="vs-note">' + (versions.saved.length ? 'The last ' + MAX_SAVED + ' applied and the code as loaded. ' : 'Each Apply to Studio adds a version here. ') + 'They stay while this tab is open.</div>');
      vlist.innerHTML = rows.join('');
      get('vs-n').textContent = versions.saved.length ? String(versions.saved.length) : '';
    }

    function showPane(name) {
      doc.body.classList.add('side');
      doc.body.classList.toggle('pane-versions', name === 'versions');
      doc.body.classList.toggle('pane-names', name === 'names');
      get('versions').setAttribute('aria-pressed', String(name === 'versions'));
      if (name === 'versions') renderVersions();
    }

    function hidePane() {
      doc.body.classList.remove('side', 'pane-versions', 'pane-names');
      get('versions').setAttribute('aria-pressed', 'false');
    }

    get('versions').addEventListener('click', () => (doc.body.classList.contains('pane-versions') ? hidePane() : showPane('versions')));
    get('vs-close').addEventListener('click', hidePane);
    for (const b of doc.querySelectorAll('[data-pane]')) b.addEventListener('click', () => showPane(b.getAttribute('data-pane')));

    // "in the editor" follows the typing
    let marks = null;
    ed.addEventListener('input', () => {
      clearTimeout(marks);
      marks = setTimeout(renderVersions, 300);
    });

    vlist.addEventListener('click', (e) => {
      const el = e.target.closest('[data-vs]');
      const found = el && versionOf(el.getAttribute('data-vs'));
      if (!found || found.v.text === ed.value) return;
      const known = ed.value === lf(original) || versions.saved.concat([versions.original]).some((v) => v.text === ed.value);
      if (!known && !tab.confirm('Replace your unsaved edit in the editor with ' + found.name.toLowerCase() + '?')) return;
      ed.value = found.v.text;
      clearTimeout(timer);
      check();
      renderVersions();
      const label = found.name.replace(/^The /, '').replace(/^./, (c) => c.toUpperCase());
      setStatus(label + ' is in the editor' + (found.v.text === lf(original) ? ' - the same as in Studio.' : ' - Apply to Studio to make it live.'), false);
    });
    renderVersions();

    // Applied code that is neither the original nor the last version is a new one.
    function addVersion(text) {
      if (!versions) return;
      const last = versions.saved[versions.saved.length - 1];
      if (text === versions.original.text || (last && last.text === text)) return;
      versions.saved.push({ n: versions.next++, text: text, at: Date.now() });
      while (versions.saved.length > MAX_SAVED) versions.saved.shift();
      renderVersions();
    }

    // A paste into an empty editor is the "original" that Revert goes back to.
    ed.addEventListener('paste', () => {
      if (ed.value.trim()) return;
      setTimeout(() => load(ed.value, 'paste'), 0);
    });

    // YAML wants spaces. Tab indents by two instead of leaving the textarea.
    ed.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault();
      doc.execCommand('insertText', false, '  ');
    });

    tab.addEventListener('beforeunload', (e) => {
      if (original && ed.value !== original) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    get('load').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (ed.value.trim() && ed.value !== original && !tab.confirm('Throw away your changes and load the code again?')) return;
      const r = await fetchCode(tab);
      if (r.blocked) {
        flash(btn, 'Open View code in Studio first', false);
        return;
      }
      if (!r.text.trim() || !looksLikeStudio(r.text)) {
        flash(btn, 'Open View code in Studio first', false);
        return;
      }
      load(r.text, r.from, r.title, r.screen);
      flash(btn, 'Loaded from ' + r.from, true);
    });

    const APPLY_ERRORS = {
      'no-frame': 'Studio is not open in the tab this editor came from.',
      'no-tree': 'Studio\u2019s tree view is not showing. Open the Tree view pane and try again.',
      'no-screen': 'Could not tell which screen to paste into. Select the screen in Studio\u2019s tree and try again.',
      'no-delete': 'Could not open the Delete menu for ',
      'delete-failed': 'Studio did not delete ',
      timeout: 'Studio did not answer. Reload the Studio tab (F5) and try again.',
      exception: 'Studio refused: '
    };

    get('apply').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const text = ed.value;
      const r = lint(text);
      let payload;
      let question;
      const sp = screenParts(text);
      if (sp) {
        if (sp.error) {
          setStatus(sp.error === 'many' ? 'The code holds ' + sp.count + ' screens — apply one screen at a time.' : 'No screen found under "Screens:".', true);
          return;
        }
        const before = screenParts(original);
        const propsChanged = before && !before.error && before.props !== sp.props;
        payload = { mode: 'screen', screenName: sp.name, yaml: sp.yaml, names: sp.names, allNames: outline(sp.yaml).controls, screen: lastScreen };
        question =
          'Replace everything on screen ' + sp.name + ' in Studio?\n\n' +
          'All its controls are deleted and these pasted in their place:\n' + (sp.names.join(', ') || '(none)') +
          (propsChanged ? '\n\nThe screen’s own properties (Fill, OnVisible…) changed in your code — those cannot be pasted; set them in Studio.' : '') +
          (before && !before.error && before.name !== sp.name ? '\n\nThe screen name changed — rename it in Studio’s tree; the controls go onto ' + (lastScreen || before.name) + '.' : '') +
          '\n\nCtrl+Z in Studio undoes it; nothing is saved until you Save there.';
      } else {
        const names = topNames(text);
        if (!names.length) {
          setStatus('No controls found — the code must start with "- ControlName:" or "Screens:".', true);
          return;
        }
        // What was loaded is what gets replaced, whatever it is called now.
        const olds = screenParts(original) ? [] : topNames(original);
        const renamed = olds.length && olds.join() !== names.join();
        payload = { mode: 'controls', yaml: text, names: names, allNames: outline(text).controls, oldNames: olds, screen: lastScreen };
        question =
          'Replace in Studio: ' + (renamed ? olds.join(', ') + ' \u2192 ' + names.join(', ') : names.join(', ')) + '?\n\n' +
          'The old version is deleted and the new code pasted in the same place. Ctrl+Z in Studio undoes it; nothing is saved until you Save there.';
      }
      if (r.problems.length && !tab.confirm('The code has problems:\n\n' + r.problems.join('\n') + '\n\nApply anyway?')) return;
      if (!tab.confirm(question)) return;

      clearTimeout(timer); // a pending check() would overwrite the status below
      btn.disabled = true;
      setStatus('Applying in Studio\u2026', false);
      try {
        await chrome.runtime.sendMessage({ type: 'DB_FOCUS_SENDER_TAB' });
      } catch (err) {
        // still try - the Studio tab may be visible in another window
      }
      const res = await applyToStudio(payload);
      showLog(res.log);
      btn.disabled = false;
      if (res.ok) {
        DynaBoost.saved('canvas-code');
        original = text;
        // Typed in, never loaded: what went to Studio is where its list starts.
        if (versions) addVersion(lf(text));
        else startVersions(lf(text), '');
        source = 'applied';
        lastScreen = res.screen || lastScreen;
        check();
        const where = res.parent && res.parent !== res.screen ? res.parent + ' on ' + res.screen : res.screen;
        const what = res.deleted.length ? 'replaced ' + res.deleted.length + ' control(s)' : 'added ' + payload.names.join(', ');
        const missing = res.missing || [];
        setStatus(
          (missing.length ? 'Applied in ' + where + ', but Studio did not create ' + missing.length + ' control(s): ' + missing.slice(0, 6).join(', ') + (missing.length > 6 ? '\u2026' : '') + ' \u2014 usually a control type or version this app does not have.' :
            (res.pasted ? 'Applied in ' : 'Check Studio \u2014 applied in ') + where + ': ' + what + '.') +
            (res.inPlace === false ? ' It is not at position ' + res.position + ' in ' + res.parent + ' any more \u2014 move it in Studio (\u2026 \u2192 Reorder) if the order matters.' : '') +
            (missing.length ? '' : res.pasted ? ' Save in Studio to keep it.' : ' The paste was not confirmed, see the steps below.'),
          !res.pasted || missing.length > 0
        );
        flash(btn, 'Applied', true);
      } else {
        const msg = (APPLY_ERRORS[res.error] || 'Apply failed: ') + (res.name || res.message || (APPLY_ERRORS[res.error] ? '' : res.error));
        const partial = res.deleted && res.deleted.length ? ' Already deleted: ' + res.deleted.join(', ') + ' \u2014 Ctrl+Z in Studio brings them back.' : '';
        setStatus(msg + partial, true);
        flash(btn, 'Not applied', false);
      }
    });

    get('copy').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const ok = await copyInto(tab, ed.value);
      flash(btn, ok ? 'Copied \u2014 now Paste in Studio' : 'Copy failed', ok);
    });

    get('revert').addEventListener('click', () => {
      if (!tab.confirm('Undo all your changes?')) return;
      ed.value = original;
      check();
    });

    get('dl').addEventListener('click', () => {
      const first = outline(ed.value);
      const base = (first.screens[0] || first.controls[0] || 'screen').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 60);
      download(tab, ed.value, base + '.pa.yaml');
    });

    check();
    ed.focus();

    // Straight from the open View code dialog, or else from the clipboard
    // if Studio code is on it. Nothing found: the tab waits for a paste.
    (async () => {
      const r = await fetchCode(tab);
      if (r.text && looksLikeStudio(r.text) && !ed.value.trim()) load(r.text, r.from, r.title, r.screen);
      else if (!ed.value.trim()) status.textContent = 'Open View code in Studio, then Load from Studio';
    })();
  }

  function run() {
    const tab = window.open('', '_blank');
    if (!tab) {
      window.alert('The tab was blocked. Allow pop-ups for this site and try again.');
      return;
    }
    tab.document.open();
    tab.document.write(buildHtml());
    tab.document.close();
    DynaBoost.themeTab(tab);
    wire(tab);
  }

  // The canvas Studio: /e/{env}/canvas/?action=edit|new-model-app-page...
  function onStudio() {
    return /\/canvas\//i.test(location.pathname);
  }

  // ---------- Expand tree (toggle) ----------

  /* Opens every branch of Studio's tree view, and on the way back closes the
   * ones it opened - the tree is left as it was before. The work happens in
   * the Studio iframe (canvas-code-hook.js); this side only asks, and keeps
   * asking for a while when the toggle is on as the page loads, since Studio
   * takes its time to build the tree. */
  let treeRun = 0;
  let treeOpened = false;

  function askTree(op) {
    const frames = studioFrames();
    if (!frames.length) return Promise.resolve({ error: 'no-frame' });
    const nonce = Math.random().toString(36).slice(2);
    return new Promise((resolve) => {
      let left = frames.length;
      const done = (v) => {
        window.removeEventListener('message', onMsg);
        clearTimeout(timer);
        resolve(v);
      };
      function onMsg(e) {
        if (!STUDIO_ORIGIN.test(e.origin)) return;
        const d = e.data;
        if (!d || d.source !== HOOK || d.type !== 'tree-done' || d.nonce !== nonce) return;
        if (d.error === 'no-tree' && --left > 0) return;
        done(d);
      }
      window.addEventListener('message', onMsg);
      const timer = setTimeout(() => done({ error: 'timeout' }), 30000);
      for (const f of frames) f.contentWindow.postMessage({ source: HOOK, type: 'tree', op: op, nonce: nonce }, new URL(f.src).origin);
    });
  }

  async function runTree(op) {
    const run = ++treeRun;
    for (let i = 0; i < 45 && run === treeRun; i++) {
      const r = await askTree(op);
      if (r.ok || (r.error && r.error !== 'no-frame' && r.error !== 'no-tree' && r.error !== 'timeout')) return;
      await new Promise((res) => setTimeout(res, 2000));
    }
  }

  DynaBoost.register({
    id: 'canvas-tree',
    name: 'Expand tree',
    group: 'Canvas apps',
    hosts: ['make.powerapps.com'],
    when: onStudio,
    type: 'toggle',
    defaultOn: false,
    countClick: true,
    hint: 'Opens every branch of the tree view',
    icon:
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M5 5h5M9 12h5M9 19h5M6.5 5v14M6.5 12H9M6.5 19H9" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="m17 10 2 2 2-2M17 17l2 2 2-2" stroke="#E3B04B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>',
    onEnable: () => {
      treeOpened = true;
      runTree('expand');
    },
    // Core calls onDisable for every toggle that is off as a page loads; only
    // a tree this toggle opened gets folded back.
    onDisable: () => {
      if (!treeOpened) return;
      treeOpened = false;
      runTree('restore');
    }
  });

  DynaBoost.register({
    id: 'canvas-code',
    name: 'Edit screen code',
    group: 'Canvas apps',
    hosts: ['make.powerapps.com'],
    when: onStudio,
    type: 'action',
    hint: 'Edit the code from View code and apply it to Studio',
    icon: ICON,
    onRun: run
  });
})();
