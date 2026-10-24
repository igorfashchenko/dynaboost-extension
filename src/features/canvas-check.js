/* Feature: App checker report (canvas apps). Studio's App checker shows its
 * issues one category at a time and gives nothing to copy. This reads them
 * all - the whole app, whichever screen is open - through
 * canvas-check-hook.js in the Studio frame, and opens them in a tab: by
 * category, each with its rule, where it is and what the pane says; a
 * formula issue also with its formula and each problem as View Problem
 * (Alt+F8) shows it. Copy (Markdown), Download JSON (all of it) or CSV.
 *
 * When the pane cannot be read, the tab says so and offers Copy layout: the
 * pane's shape without a single name or text, to mend the reading with.
 */
(function () {
  if (DynaBoost.off) return;
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M5 4h10l4 4v12H5z" stroke="#3D8BFF" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M8.5 11h7M8.5 14.5h4" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
    '<circle cx="16.5" cy="17" r="3.2" fill="#E3B04B"/>' +
    '<path d="M16.5 15.5v1.8M16.5 18.6v.1" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round"/>' +
    '</svg>';
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 13 4 4L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const HOOK = 'dynaboost-canvas-check-v';
  const HOOK_VERSION = 4; // canvas-check-hook.js's VERSION
  const STUDIO_ORIGIN = /^https:\/\/[^/]+\.gateway\.prod\.island\.powerapps\.com$/;
  const TIMEOUT = 10 * 60 * 1000; // a big app, every formula visited

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  const onStudio = () => /\/canvas(\/|$)/i.test(location.pathname); // also embedded: .../canvas?action=edit&source=ModelDrivenFormIntegration

  function studioFrames() {
    return Array.from(document.querySelectorAll('iframe')).filter((f) => {
      try {
        return STUDIO_ORIGIN.test(new URL(f.src).origin);
      } catch (e) {
        return false;
      }
    });
  }

  /* Studio's frame has the helper it was given when it loaded; after an
   * update that is an older one. Asked first who is there: none, or an old
   * one, and the newest is put in from background.js - the old one stands
   * down. */
  function hello() {
    const frames = studioFrames();
    if (!frames.length) return Promise.resolve(0);
    return new Promise((resolve) => {
      const nonce = Math.random().toString(36).slice(2);
      let best = 0;
      const onMsg = (e) => {
        const d = e.data;
        if (!d || d.source !== HOOK || d.nonce !== nonce || d.type !== 'hello' || !STUDIO_ORIGIN.test(e.origin)) return;
        best = Math.max(best, d.version || 0);
        if (best >= HOOK_VERSION) done();
      };
      const done = () => {
        window.removeEventListener('message', onMsg);
        clearTimeout(timer);
        resolve(best);
      };
      const timer = setTimeout(done, 1500);
      window.addEventListener('message', onMsg);
      for (const f of frames) f.contentWindow.postMessage({ source: HOOK, type: 'hello', nonce: nonce }, new URL(f.src).origin);
    });
  }

  async function freshHelper() {
    if ((await hello()) >= HOOK_VERSION) return true;
    try {
      await chrome.runtime.sendMessage({ type: 'DB_STUDIO_HOOK' });
    } catch (e) {
      /* the extension was updated meanwhile */
    }
    return (await hello()) >= HOOK_VERSION;
  }

  /* Every Studio frame is asked; the one with the pane answers with it. A
   * frame without it says so; the best answer wins. */
  function ask(opts, progress) {
    const frames = studioFrames();
    if (!frames.length) return Promise.resolve({ error: 'no-frame' });
    return new Promise((resolve) => {
      const nonce = Math.random().toString(36).slice(2);
      let left = frames.length;
      let best = null;
      const rank = (r) => (r.categories ? 3 : r.error === 'no-categories' ? 2 : r.error === 'busy' ? 1 : 0);
      const done = (r) => {
        window.removeEventListener('message', onMsg);
        clearTimeout(timer);
        resolve(r);
      };
      const onMsg = (e) => {
        const d = e.data;
        if (!d || d.source !== HOOK || d.nonce !== nonce || !STUDIO_ORIGIN.test(e.origin)) return;
        if (d.type === 'progress') return progress(d.text);
        if (d.type !== 'done') return;
        if (!best || rank(d) > rank(best)) best = d;
        if (d.categories || --left === 0) done(best);
      };
      const timer = setTimeout(() => done(best || { error: 'timeout' }), TIMEOUT);
      window.addEventListener('message', onMsg);
      for (const f of frames) f.contentWindow.postMessage(Object.assign({ source: HOOK, type: 'read', nonce: nonce }, opts), new URL(f.src).origin);
    });
  }

  // ---------- as text ----------

  const where = (i) => (i.location ? i.location.text : '') || '';
  const sevOf = (i) => i.severity || (i.problems && i.problems.length && /\(error\)/i.test(i.problems[0].message) ? 'error' : '');

  /* A category's issues in groups: a formula category by place (control
   * and property) - the formula once, with every problem in it - and the
   * others by rule, each with the places it is found. */
  const FORMULA_CATEGORIES = ['Formulas', 'Runtime'];
  function groups(c) {
    const byPlace = FORMULA_CATEGORIES.indexOf(c.name) >= 0;
    const out = [];
    for (const i of c.issues) {
      const key = byPlace ? where(i) || i.title : i.group || i.title;
      let g = out.find((x) => x.key === key);
      if (!g) out.push((g = { key: key, byPlace: byPlace, issues: [] }));
      g.issues.push(i);
    }
    return out;
  }
  // What a problem is about: the code under its squiggle, on one line.
  const snippet = (p) => {
    const t = String(p.text || '').replace(/\s*\n\s*/g, ' ⏎ ').trim();
    return t.length > 80 ? t.slice(0, 77) + '…' : t;
  };
  const lineOf = (p) => p.message + (p.at ? ' (line ' + p.at.line + ', column ' + p.at.column + (snippet(p) ? ': `' + snippet(p).replace(/`/g, "'") + '`' : '') + ')' : '');

  function markdown(app, result) {
    const out = ['# App checker - ' + app, ''];
    for (const c of result.categories) {
      if (!c.count) continue;
      out.push('## ' + c.name + ' (' + c.count + ')', '');
      groups(c).forEach((g, n) => {
        const first = g.issues[0];
        if (g.byPlace) {
          out.push('### ' + (n + 1) + '. ' + g.key + ' - ' + g.issues.length + ' issue' + (g.issues.length === 1 ? '' : 's'));
          out.push('', 'App checker:');
          for (const i of g.issues) out.push('- ' + i.title + (sevOf(i) ? ' [' + sevOf(i) + ']' : ''));
          const details = (g.issues.find((i) => i.details) || {}).details;
          if (details) out.push('', 'Details (App checker):', details.join('\n'));
          if (first.problems && first.problems.length) {
            out.push('', 'Problems (as View Problem shows them):');
            for (const p of first.problems) out.push('- ' + lineOf(p));
          }
          if (first.formula != null) out.push('', 'Formula' + (first.property ? ' (' + first.property + ')' : '') + ':', '```', first.formula, '```');
          else out.push('', '(formula not read)');
        } else {
          out.push('### ' + (n + 1) + '. ' + g.key + ' - ' + g.issues.length + ' place' + (g.issues.length === 1 ? '' : 's') + (sevOf(first) ? ' [' + sevOf(first) + ']' : ''));
          for (const i of g.issues) {
            const rest = i.lines.filter((l) => l !== g.key);
            out.push('- ' + (rest.join(' · ') || i.title));
          }
        }
        out.push('');
      });
    }
    return out.join('\n');
  }

  function csv(result) {
    const cell = (v) => {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = [['Category', 'Severity', 'Issue', 'Rule', 'Where', 'Screen', 'Control', 'Property', 'Details', 'Problems', 'Formula']];
    for (const c of result.categories) {
      for (const i of c.issues) {
        rows.push([
          c.name, sevOf(i), i.title, i.group, where(i),
          i.location ? i.location.screen : '', i.location ? i.location.control : '', (i.location && i.location.property) || i.property || '',
          i.lines.filter((l) => l !== i.title && l !== where(i)).join(' | '),
          (i.problems || []).map((p) => p.message).join(' | '),
          i.formula || ''
        ]);
      }
    }
    return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
  }

  // ---------- the tab ----------

  const CSS =
    'body{margin:0;background:var(--dbc-bg-f5f7fc);color:var(--dbc-fg-10224e);font:14px/1.45 "Segoe UI",system-ui,sans-serif}' +
    'header{padding:16px 22px 12px}' +
    '.bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px}' +
    'button{padding:7px 13px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);font:inherit;font-size:13.5px;cursor:pointer;transition:background-color .15s,border-color .15s,color .15s}' +
    'button:hover{border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-1e6bff)}' +
    'button.primary{background:var(--dbc-bg-1e6bff);border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-fff);font-weight:600}' +
    'button.primary:hover{background:var(--dbc-bg-155ee0);color:var(--dbc-fg-fff)}' +
    'button svg{width:14px;height:14px;vertical-align:-2px;margin-right:6px}' +
    'button.db-ok,button.db-ok:hover{border-color:var(--dbc-bd-1c6b32);color:var(--dbc-fg-1c6b32);background:var(--dbc-bg-e4f4e8)}' +
    'button.db-bad,button.db-bad:hover{border-color:var(--dbc-bd-a11a1a);color:var(--dbc-fg-a11a1a);background:var(--dbc-bg-fde8e8)}' +
    '.sep{width:1px;align-self:stretch;margin:2px 4px;background:var(--dbc-bg-dde3f0)}' +
    '.chips{display:flex;gap:6px;flex-wrap:wrap}' +
    '.chip{padding:4px 10px;border-radius:14px;font-size:12.5px}' +
    '.chip[aria-pressed="true"]{border-color:var(--dbc-bd-1e6bff);background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-1e6bff);font-weight:600}' +
    'main{margin:16px 22px 40px;max-width:1100px}' +
    '.wait{display:flex;align-items:center;gap:14px;padding:18px 4px;color:var(--dbc-fg-56637f)}' +
    'h2{margin:22px 0 8px;font-size:16px}' +
    '.issue{margin:0 0 10px;padding:12px 14px;background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-left:4px solid var(--dbc-bd-c6d0e4);border-radius:8px}' +
    '.issue.error{border-left-color:var(--dbc-bd-c42b1c)}.issue.warning{border-left-color:var(--dbc-bd-e3b04b)}.issue.tip,.issue.info{border-left-color:var(--dbc-bd-1e6bff)}' +
    '.issue h3{margin:0;font-size:14.5px}' +
    '.sev{display:inline-block;margin-left:8px;padding:0 7px;border-radius:9px;font-size:11px;font-weight:600;line-height:17px;vertical-align:1px;background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f)}' +
    '.error .sev{background:var(--dbc-bg-fde8e8);color:var(--dbc-fg-a11a1a)}.warning .sev{background:var(--dbc-bg-fdf1d6);color:var(--dbc-fg-7a5410)}' +
    '.loc{margin-top:2px;font:12.5px Consolas,"Cascadia Mono",monospace;color:var(--dbc-fg-1e6bff)}' +
    '.rule{margin-top:6px;font-size:12.5px;color:var(--dbc-fg-56637f)}' +
    '.mono{font-family:Consolas,"Cascadia Mono",monospace;font-size:14px}' +
    '.checks,.places{margin:6px 0 0;padding-left:20px}.checks li,.places li{margin:2px 0}' +
    '.places{columns:2;column-gap:28px}' +
    '.probs b{display:block;margin-bottom:4px;font-size:12px;color:var(--dbc-fg-a11a1a)}' +
    '.lines{margin-top:6px;white-space:pre-wrap;color:var(--dbc-fg-10224e)}' +
    '.probs{margin:8px 0 0;padding:8px 12px;border-radius:6px;background:var(--dbc-bg-fdf3f2);color:var(--dbc-fg-a11a1a);font-size:13px}' +
    '.probs div+div{margin-top:4px}' +
    '.fx{margin-top:8px;border:1px solid var(--dbc-bd-dde3f0);border-radius:6px;overflow:auto;max-height:260px}' +
    '.fx-h{padding:4px 10px;border-bottom:1px solid var(--dbc-bd-dde3f0);background:var(--dbc-bg-f5f7fc);color:var(--dbc-fg-56637f);font-size:12px}' +
    '.fxl{padding:6px 0;font:12.5px/1.6 Consolas,"Cascadia Mono",monospace;tab-size:4}' +
    '.fxr{display:flex}.fxn{flex:none;width:34px;padding-right:10px;text-align:right;color:var(--dbc-fg-8a94ad);user-select:none}' +
    '.fxc{position:relative;flex:1;white-space:pre;padding-right:10px}' +
    '.sq{position:absolute;top:0;color:transparent;white-space:pre;text-decoration:underline wavy;text-decoration-thickness:1.5px;text-underline-offset:3px;cursor:help;border-radius:2px}' +
    '.sq-err{text-decoration-color:var(--dbc-bd-c42b1c)}.sq-warn{text-decoration-color:var(--dbc-bd-e3b04b)}.sq-info{text-decoration-color:var(--dbc-bd-1e6bff)}' +
    '.sq.on{background:var(--dbc-bg-fde8e8)}' +
    '.prob{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 6px;padding:2px 4px;border-radius:4px}.prob+.prob{margin-top:2px}.prob.on{background:var(--dbc-bg-fde8e8)}' +
    '.pn{flex:none;min-width:18px;height:18px;border-radius:9px;background:var(--dbc-bg-c42b1c);color:var(--dbc-fg-fff);font-size:11px;font-weight:600;line-height:18px;text-align:center}' +
    '.prob .at{padding:0 5px;border-radius:4px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);font:12px Consolas,"Cascadia Mono",monospace;border:1px solid var(--dbc-bd-f3c7c2)}' +
    '.note{margin:0 0 12px;padding:10px 14px;border-radius:8px;background:var(--dbc-bg-fdf1d6);color:var(--dbc-fg-7a5410);font-size:13px}' +
    '.empty{padding:14px;color:var(--dbc-fg-56637f)}';

  function copyInto(tab, text) {
    return tab.navigator.clipboard.writeText(text).then(
      () => true,
      () => {
        try {
          const ta = tab.document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          tab.document.body.appendChild(ta);
          ta.select();
          const ok = tab.document.execCommand('copy');
          ta.remove();
          return ok;
        } catch (e) {
          return false;
        }
      }
    );
  }

  function flash(btn, text, ok) {
    if (!btn.__dbLabel) btn.__dbLabel = btn.innerHTML;
    clearTimeout(btn.__dbTimer);
    btn.innerHTML = (ok ? CHECK : '') + esc(text);
    btn.classList.remove('db-ok', 'db-bad');
    btn.classList.add(ok ? 'db-ok' : 'db-bad');
    btn.__dbTimer = setTimeout(() => {
      btn.innerHTML = btn.__dbLabel;
      btn.classList.remove('db-ok', 'db-bad');
    }, 2200);
  }

  function save(tab, text, name, type) {
    const url = tab.URL.createObjectURL(new tab.Blob([text], { type: type }));
    const a = tab.document.createElement('a');
    a.href = url;
    a.download = name;
    tab.document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => tab.URL.revokeObjectURL(url), 1000);
  }

  function appName() {
    const t = (document.title || '')
      .replace(/^\s*Power Apps( Studio)?\s*[|·-]\s*/i, '')
      .replace(/\s*[|·-]\s*Power Apps.*$/i, '')
      .replace(/\s*\((Editing|Preview|Read-only)\)\s*$/i, '')
      .trim();
    return t || 'Canvas app';
  }

  /* The formula as the formula bar shows it: line numbers, colours, and a
   * wavy line under each problem's code - red for an error, gold for a
   * warning - numbered as in the list above it. Monospace, so a column is
   * 1ch; a tab counts to the next fourth. */
  const TAB = 4;
  const visual = (line, col) => {
    let v = 0;
    for (let i = 0; i < col - 1 && i < line.length; i++) v = line[i] === '\t' ? v + TAB - (v % TAB) : v + 1;
    return v;
  };
  const untab = (s, start) => {
    let out = '';
    let v = start;
    for (const ch of s) {
      if (ch === '\t') {
        const n = TAB - (v % TAB);
        out += ' '.repeat(n);
        v += n;
      } else {
        out += ch;
        v++;
      }
    }
    return out;
  };

  function formulaHtml(text, problems) {
    const lines = String(text).split(/\r?\n/);
    const coloured = DynaBoost.code && DynaBoost.code.lines ? DynaBoost.code.lines(text, 'fx') : lines.map(esc);
    const marks = (problems || []).map((p, k) => ({ p: p, n: k + 1 })).filter((x) => x.p.range);
    return (
      '<div class="fxl">' +
      lines
        .map((l, k) => {
          const ln = k + 1;
          const over = marks
            .map(({ p, n }) => {
              const r = p.range;
              if (ln < r.line || ln > r.endLine) return '';
              const from = ln === r.line ? r.column : 1;
              const to = ln === r.endLine ? r.endColumn : l.length + 1;
              if (to <= from) return '';
              const left = visual(l, from);
              const sev = /warn/i.test(p.severity || '') ? 'warn' : /info|hint/i.test(p.severity || '') ? 'info' : 'err';
              return '<span class="sq sq-' + sev + '" data-p="' + n + '" style="left:' + left + 'ch" title="' + n + '. ' + esc(p.message) + '">' + esc(untab(l.slice(from - 1, to - 1), left)) + '</span>';
            })
            .join('');
          return '<div class="fxr"><span class="fxn">' + ln + '</span><span class="fxc">' + (coloured[k] || '') + over + '</span></div>';
        })
        .join('') +
      '</div>'
    );
  }

  const fxHtml = (i) =>
    '<div class="fx"><div class="fx-h">Formula' + (i.property ? ' · ' + esc(i.property) : '') + '</div>' + formulaHtml(i.formula, i.problems) + '</div>';

  const problemHtml = (p, n) =>
    '<div class="prob" data-p="' + (n + 1) + '"><span class="pn">' + (n + 1) + '</span>' + esc(p.message) +
    (p.at ? ' <small>(line ' + p.at.line + ', col ' + p.at.column + ')</small>' : '') +
    (snippet(p) ? '<code class="at">' + esc(snippet(p)) + '</code>' : '') + '</div>';

  function groupHtml(g) {
    const first = g.issues[0];
    const sev = sevOf(first);
    if (g.byPlace) {
      return (
        '<div class="issue ' + esc(sev) + '"><h3 class="mono">' + esc(g.key) + '<span class="sev">' + g.issues.length + ' issue' + (g.issues.length === 1 ? '' : 's') + '</span></h3>' +
        '<ul class="checks">' + g.issues.map((i) => '<li>' + esc(i.title) + '</li>').join('') + '</ul>' +
        ((g.issues.find((i) => i.details) || {}).details ? '<div class="lines">' + esc(g.issues.find((i) => i.details).details.join('\n')) + '</div>' : '') +
        (first.problems && first.problems.length ? '<div class="probs"><b>View Problem (Alt+F8)</b>' + first.problems.map(problemHtml).join('') + '</div>' : '') +
        (first.formula != null ? fxHtml(first) : '<div class="rule">Formula not read.</div>') +
        '</div>'
      );
    }
    return (
      '<div class="issue ' + esc(sev) + '"><h3>' + esc(g.key) + '<span class="sev">' + g.issues.length + (sev ? ' · ' + esc(sev) : '') + '</span></h3>' +
      '<ul class="places">' + g.issues.map((i) => '<li>' + esc(i.lines.filter((l) => l !== g.key).join(' · ') || i.title) + '</li>').join('') + '</ul></div>'
    );
  }

  function show(tab, app, result) {
    const doc = tab.document;
    const total = result.categories.reduce((n, c) => n + c.issues.length, 0);
    const counted = result.categories.reduce((n, c) => n + (c.count || 0), 0);
    const withCount = result.categories.filter((c) => c.count);
    const missing = withCount.filter((c) => c.issues.length < c.count);
    const unread = withCount.filter((c) => FORMULA_CATEGORIES.indexOf(c.name) >= 0).reduce((n, c) => n + groups(c).filter((g) => g.issues[0].formula == null).length, 0);
    doc.querySelector('.bar').hidden = false;
    doc.getElementById('sub').textContent =
      total + ' issue' + (total === 1 ? '' : 's') + ' in ' + withCount.length + ' categor' + (withCount.length === 1 ? 'y' : 'ies') + ' · the whole app' +
      (result.categories.some((c) => c.issues.some((i) => i.formula != null)) ? ' · formulas read from the formula bar' : '');
    const chips = doc.getElementById('chips');
    chips.innerHTML = '<button type="button" class="chip" data-cat="" aria-pressed="true">All (' + total + ')</button>' +
      withCount.map((c) => '<button type="button" class="chip" data-cat="' + esc(c.name) + '" aria-pressed="false">' + esc(c.name) + ' (' + c.issues.length + ')</button>').join('');
    const main = doc.querySelector('main');
    main.innerHTML =
      (missing.length || total !== counted
        ? '<div class="note">Read ' + total + ' of the ' + counted + ' the pane counts' + (missing.length ? ' - fewer in ' + missing.map((c) => esc(c.name) + ' (' + c.issues.length + ' of ' + c.count + ')').join(', ') : ' - more than it shows') + '. Copy layout (above) and send it, to mend the reading.</div>'
        : '') +
      (unread ? '<div class="note">' + unread + ' formula' + (unread === 1 ? ' was' : 's were') + ' not read. Copy layout (above) and send it - it says where it stopped, without names.</div>' : '') +
      (withCount.length
        ? withCount.map((c) => '<section data-cat="' + esc(c.name) + '"><h2>' + esc(c.name) + ' (' + c.issues.length + ')</h2>' + (c.issues.length ? groups(c).map(groupHtml).join('') : '<div class="empty">No issue could be read here.</div>') + '</section>').join('')
        : '<div class="empty">App checker found nothing to fix.</div>');
    const light = (e, on) => {
      const el = e.target.closest && e.target.closest('[data-p]');
      const box = el && el.closest('.issue');
      if (!box) return;
      box.querySelectorAll('[data-p="' + el.dataset.p + '"]').forEach((x) => x.classList.toggle('on', on));
    };
    main.addEventListener('mouseover', (e) => light(e, true));
    main.addEventListener('mouseout', (e) => light(e, false));
    chips.addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      chips.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      main.querySelectorAll('section').forEach((s) => (s.hidden = !!b.dataset.cat && s.dataset.cat !== b.dataset.cat));
    });
    const file = app.replace(/[\\/:*?"<>|]+/g, '-') + ' - App checker';
    doc.getElementById('copy').onclick = async (e) => {
      const btn = e.currentTarget;
      const ok = await copyInto(tab, markdown(app, result));
      flash(btn, ok ? 'Copied' : 'Copy failed', ok);
    };
    doc.getElementById('json').onclick = (e) => {
      save(tab, JSON.stringify({ app: app, read: new Date().toISOString(), categories: result.categories }, null, 2), file + '.json', 'application/json');
      flash(e.currentTarget, 'Downloaded', true);
    };
    doc.getElementById('csv').onclick = (e) => {
      save(tab, csv(result), file + '.csv', 'text/csv');
      flash(e.currentTarget, 'Downloaded', true);
    };
    // Read fewer than the pane counts: the layout of each part, and the steps.
    const layouts =
      '== steps\n' + (result.steps || []).join('\n') + '\n\n== the list\n' + (result.layout || '') + '\n\n' +
      result.categories.filter((c) => c.layout || c.bars || c.detailLayout).map((c) => '== ' + c.name + '\n' + (c.layout || '') + (c.detailLayout ? '\n== ' + c.name + ', an issue\'s details\n' + c.detailLayout : '') + (c.bars ? '\n== command bar\n' + c.bars : '')).join('\n\n');
    const lay = doc.getElementById('layout');
    lay.hidden = false;
    lay.onclick = async (e) => {
      const btn = e.currentTarget;
      const ok = await copyInto(tab, layouts);
      flash(btn, ok ? 'Copied' : 'Copy failed', ok);
    };
  }

  function failed(tab, result) {
    const doc = tab.document;
    const why = {
      'no-frame': 'Studio is not open in this tab.',
      'no-pane': 'The App checker pane could not be found or opened. Open it (the stethoscope icon at the top) and try again.',
      'no-categories': 'The App checker pane is open, but its categories could not be read.',
      busy: 'It is reading the App checker already.',
      'old-helper': 'Studio still has the DynaBoost helper from before the update. Reload the Studio tab (F5), then try again.',
      timeout: 'Studio did not answer.'
    }[result.error] || 'It stopped: ' + (result.message || result.error);
    doc.getElementById('sub').textContent = 'Could not read the App checker';
    doc.querySelector('main').innerHTML = '<div class="note">' + esc(why) + (result.layout ? ' Copy layout and send it - it holds the shape of the page, no names or texts - to mend the reading.' : '') + '</div>';
    const lay = doc.getElementById('layout');
    if (result.layout) {
      doc.querySelector('.bar').hidden = false;
      doc.querySelectorAll('.bar > :not(#layout)').forEach((x) => (x.hidden = true));
      lay.hidden = false;
      lay.onclick = async (e) => {
        const btn = e.currentTarget;
        const ok = await copyInto(tab, result.layout);
        flash(btn, ok ? 'Copied' : 'Copy failed', ok);
      };
    }
  }

  async function run() {
    // The tab opens on the click - after an await it would be a pop-up.
    const tab = window.open('', '_blank');
    if (!tab) {
      DynaBoost.toast('App checker report', 'The tab was blocked. Allow pop-ups for this site and try again.', true);
      return;
    }
    const app = appName();
    const doc = tab.document;
    doc.write(
      '<!doctype html><html' + (DynaBoost.isDark() ? ' class="db-dark"' : '') + '><head><meta charset="utf-8"><title>App checker · ' + esc(app) + '</title>' +
        '<style>' + CSS + DynaBoost.status.css + (DynaBoost.code ? DynaBoost.code.css : '') + DynaBoost.tabCss + '</style></head><body>' +
        '<header><h1>App checker · ' + esc(app) + '</h1><div class="crumbs" id="sub">Reading Studio’s App checker…</div>' +
        '<div class="bar" hidden>' +
        '<button type="button" class="primary" id="copy" title="Every issue, with its formula and problems, as Markdown">Copy</button>' +
        '<button type="button" id="json" title="All of it, as read">Download JSON</button>' +
        '<button type="button" id="csv" title="One row an issue, for Excel">Download CSV</button>' +
        '<button type="button" id="layout" hidden title="The pane’s shape - no names, no texts - to mend the reading">Copy layout</button>' +
        '<span class="sep"></span><div class="chips" id="chips"></div></div></header>' +
        '<main><div class="wait">' + DynaBoost.status.html('busy') + '<span id="step">Opening the App checker…</span></div></main></body></html>'
    );
    doc.close();
    DynaBoost.themeTab(tab);
    if (!(await freshHelper())) {
      if (!tab.closed) failed(tab, { error: 'old-helper' });
      return;
    }
    const result = await ask({ recheck: false, formulas: true }, (text) => {
      const step = !tab.closed && doc.getElementById('step');
      if (step) step.textContent = text + '…';
    });
    if (tab.closed) return;
    if (!result.categories) return failed(tab, result);
    show(tab, app, result);
    DynaBoost.saved('canvas-check');
  }

  DynaBoost.register({
    id: 'canvas-check',
    name: 'App checker report',
    group: 'Canvas apps',
    hosts: ['make.powerapps.com'],
    when: onStudio,
    type: 'action',
    hint: 'Every App checker issue of the whole app - with formulas and problems - to copy or download',
    icon: ICON,
    onRun: run
  });
})();
