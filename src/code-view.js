/* DynaBoost.code: code shown and edited as in VS Code (Light theme) - line
 * numbers, syntax colours, brackets coloured by depth, indent guides.
 *
 *   DynaBoost.code.css                     CSS to append to a tab's <style>
 *   DynaBoost.code.attach(tab, ta, lang)   turns a <textarea> into an editor
 *   DynaBoost.code.lines(text, lang, mark) one HTML string per line
 *   DynaBoost.code.html(text, lang)        the whole text as HTML, for a <pre>
 *   DynaBoost.tabCss                       the header every DynaBoost tab shares
 *   DynaBoost.themeTab(tab, dark)          light or dark, and Rate DynaBoost in
 *                                          the header
 *
 * attach() keeps the textarea for typing, made transparent over a coloured
 * copy of which only the visible lines are drawn. Setting ta.value redraws.
 *
 * Languages: json, yaml, xml, js, fx (Power Fx). A highlighter, not a parser:
 * each line is coloured on its own, with only the state that crosses a line
 * end carried over. */
(function () {
  // In the portals core.js comes first; the flow editor page has no core.
  if (window.DynaBoost && DynaBoost.code) return;
  window.DynaBoost = window.DynaBoost || {};

  const LH = 19; // line height, px - the same in the textarea and the drawing
  const PAD_Y = 10;
  const PAD_X = 16;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ---------- colouring ----------

  // Each tokenizer takes a line and the state at its start, and returns
  // { parts: [[class, text], ...], state } - the state at its end.

  const BRACKET = (depth) => 'b' + (depth % 3);

  function jsonLine(line, st) {
    const parts = [];
    let depth = st.depth || 0;
    const re = /("(?:[^"\\]|\\.)*"?)(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{[])|([}\]])/g;
    let last = 0;
    let m;
    while ((m = re.exec(line))) {
      if (m.index > last) parts.push(['', line.slice(last, m.index)]);
      if (m[1] !== undefined) {
        parts.push([m[2] ? 'k' : 's', m[1]]);
        if (m[2]) parts.push(['', m[2]]);
      } else if (m[3] !== undefined) parts.push(['n', m[3]]);
      else if (m[4] !== undefined) parts.push(['l', m[4]]);
      else if (m[5] !== undefined) parts.push([BRACKET(depth++), m[5]]);
      else if (m[6] !== undefined) parts.push([BRACKET((depth = Math.max(0, depth - 1))), m[6]]);
      last = re.lastIndex;
    }
    if (last < line.length) parts.push(['', line.slice(last)]);
    return { parts: parts, state: { depth: depth } };
  }

  const JS_KEYWORDS = /^(var|let|const|function|new|delete|typeof|instanceof|in|of|this|class|extends|super|async|await|void|yield|static|get|set|import|export|default|from)$/;
  const JS_CONTROL = /^(if|else|return|for|while|do|switch|case|break|continue|throw|try|catch|finally)$/;
  const JS_LITERAL = /^(true|false|null|undefined|NaN|Infinity)$/;
  const FX_KEYWORDS = /^(And|Or|Not|As|Self|Parent|ThisItem|ThisRecord|in|exactin)$/;
  const FX_LITERAL = /^(true|false|Blank)$/i;

  // JavaScript and Power Fx share the shape: strings, comments, numbers,
  // words, and a word before "(" is a function.
  function codeLine(line, st, fx) {
    const parts = [];
    let depth = st.depth || 0;
    let i = 0;
    if (st.comment) {
      const end = line.indexOf('*/');
      if (end < 0) return { parts: [['c', line]], state: { comment: true, depth: depth } };
      parts.push(['c', line.slice(0, end + 2)]);
      i = end + 2;
    }
    const re = fx
      ? /(\/\/.*$)|(\/\*)|("(?:[^"]|"")*"?)|(\d+(?:\.\d+)?)|([A-Za-z_][\w.]*)(\s*\()?|([{[(])|([}\])])/g
      : /(\/\/.*$)|(\/\*)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(\s*\()?|([{[(])|([}\])])/g;
    re.lastIndex = i;
    let last = i;
    let m;
    while ((m = re.exec(line))) {
      if (m.index > last) parts.push(['', line.slice(last, m.index)]);
      if (m[1] !== undefined) parts.push(['c', m[1]]);
      else if (m[2] !== undefined) {
        const end = line.indexOf('*/', m.index + 2);
        if (end < 0) {
          parts.push(['c', line.slice(m.index)]);
          return { parts: parts, state: { comment: true, depth: depth } };
        }
        parts.push(['c', line.slice(m.index, end + 2)]);
        re.lastIndex = end + 2;
      } else if (m[3] !== undefined) parts.push(['s', m[3]]);
      else if (m[4] !== undefined) parts.push(['n', m[4]]);
      else if (m[5] !== undefined) {
        const w = m[5];
        const cls = fx
          ? FX_LITERAL.test(w) ? 'l' : FX_KEYWORDS.test(w) ? 'w' : m[6] ? 'f' : ''
          : JS_CONTROL.test(w) ? 'x' : JS_KEYWORDS.test(w) ? 'w' : JS_LITERAL.test(w) ? 'l' : m[6] ? 'f' : '';
        parts.push([cls, w]);
        if (m[6]) {
          parts.push(['', m[6].slice(0, -1)]);
          parts.push([BRACKET(depth++), '(']);
        }
      } else if (m[7] !== undefined) parts.push([BRACKET(depth++), m[7]]);
      else if (m[8] !== undefined) parts.push([BRACKET((depth = Math.max(0, depth - 1))), m[8]]);
      last = re.lastIndex;
    }
    if (last < line.length) parts.push(['', line.slice(last)]);
    return { parts: parts, state: { depth: depth } };
  }

  // YAML as canvas apps write it: keys, and values that start with "=" are
  // Power Fx - on the line, or in the block ("|") under the key.
  function yamlLine(line, st) {
    const indent = line.match(/^\s*/)[0].length;
    if (st.block != null) {
      if (!line.trim() || indent > st.block) {
        const r = codeLine(line, st.fx || {}, true);
        return { parts: r.parts, state: { block: st.block, fx: r.state } };
      }
    }
    const parts = [];
    const m = line.match(/^(\s*)(- )?((?:[^:#"'\s][^:#]*?|"[^"]*"|'[^']*'))(:)(\s+|$)(.*)$/);
    if (!m) {
      const c = line.indexOf('#');
      if (/^\s*#/.test(line)) return { parts: [['c', line]], state: {} };
      if (/^\s*- /.test(line)) {
        const dash = line.match(/^\s*- /)[0];
        parts.push(['', dash]);
        parts.push(...yamlValue(line.slice(dash.length)));
        return { parts: parts, state: {} };
      }
      return { parts: c > 0 ? [['', line.slice(0, c)], ['c', line.slice(c)]] : [['', line]], state: {} };
    }
    parts.push(['', m[1] + (m[2] || '')]);
    parts.push(['k', m[3]]);
    parts.push(['', m[4] + m[5]]);
    const value = m[6];
    if (/^[|>][-+]?\s*$/.test(value)) {
      parts.push(['w', value]);
      return { parts: parts, state: { block: indent + (m[2] ? 2 : 0) } };
    }
    parts.push(...yamlValue(value));
    return { parts: parts, state: {} };
  }

  function yamlValue(v) {
    if (!v) return [];
    if (v[0] === '=') return [['w', '=']].concat(codeLine(v.slice(1), {}, true).parts);
    const c = v.search(/\s#/);
    const body = c >= 0 ? v.slice(0, c) : v;
    const tail = c >= 0 ? [['c', v.slice(c)]] : [];
    let cls = '';
    if (/^(["']).*\1$/.test(body.trim())) cls = 's';
    else if (/^-?\d+(\.\d+)?$/.test(body.trim())) cls = 'n';
    else if (/^(true|false|null|~)$/i.test(body.trim())) cls = 'l';
    else cls = 's';
    return [[cls, body]].concat(tail);
  }

  // XML and XAML: tags, attributes and their values, comments, CDATA.
  function xmlLine(line, st) {
    const parts = [];
    let i = 0;
    let inTag = !!st.tag;
    let inComment = !!st.comment;
    while (i < line.length) {
      if (inComment) {
        const end = line.indexOf('-->', i);
        const stop = end < 0 ? line.length : end + 3;
        parts.push(['c', line.slice(i, stop)]);
        i = stop;
        if (end >= 0) inComment = false;
        continue;
      }
      if (inTag) {
        const m = /\s+|([\w:.-]+)(\s*=\s*)?|("[^"]*"?|'[^']*'?)|(\/?>)|(.)/y;
        m.lastIndex = i;
        const t = m.exec(line);
        if (!t || !t[0]) break;
        if (t[1] !== undefined) {
          parts.push(['a', t[1]]);
          if (t[2]) parts.push(['', t[2]]);
        } else if (t[3] !== undefined) parts.push(['v', t[3]]);
        else if (t[4] !== undefined) {
          parts.push(['t', t[4]]);
          inTag = false;
        } else parts.push(['', t[0]]);
        i = m.lastIndex;
        continue;
      }
      const lt = line.indexOf('<', i);
      if (lt < 0) {
        parts.push(['', line.slice(i)]);
        break;
      }
      if (lt > i) parts.push(['', line.slice(i, lt)]);
      if (line.startsWith('<!--', lt)) {
        inComment = true;
        i = lt;
        continue;
      }
      const tag = /<\/?[\w:.-]*|<[!?][\w-]*/y;
      tag.lastIndex = lt;
      const t = tag.exec(line);
      parts.push(['t', t ? t[0] : '<']);
      i = t ? tag.lastIndex : lt + 1;
      inTag = true;
    }
    return { parts: parts, state: { tag: inTag, comment: inComment } };
  }

  const TOKENIZERS = {
    json: jsonLine,
    js: (l, s) => codeLine(l, s, false),
    fx: (l, s) => codeLine(l, s, true),
    yaml: yamlLine,
    xml: xmlLine
  };

  function tokenizer(lang) {
    return TOKENIZERS[lang] || ((l) => ({ parts: [['', l]], state: {} }));
  }

  // Leading spaces get the indent guides: a thin line every indent step.
  function lineHtml(parts, mark) {
    let out = '';
    let lead = true;
    for (const [cls, text] of parts) {
      if (!text) continue;
      let t = text;
      if (lead) {
        const sp = t.match(/^[ \t]*/)[0];
        if (sp.length === t.length && !cls) {
          out += '<span class="qig">' + t + '</span>';
          continue;
        }
        if (sp) out += '<span class="qig">' + sp + '</span>';
        t = t.slice(sp.length);
        lead = false;
      }
      const h = mark ? mark(esc(t)) : esc(t);
      out += cls ? '<span class="q' + cls + '">' + h + '</span>' : h;
    }
    return out;
  }

  // The state at the start of every line, from one pass over the text.
  function states(lines, lang) {
    const next = tokenizer(lang);
    const out = new Array(lines.length);
    let st = {};
    for (let i = 0; i < lines.length; i++) {
      out[i] = st;
      st = next(lines[i], st).state;
    }
    return out;
  }

  function lines(text, lang, mark) {
    const next = tokenizer(lang);
    let st = {};
    return String(text).split(/\r?\n/).map((l) => {
      const r = next(l, st);
      st = r.state;
      return lineHtml(r.parts, mark);
    });
  }

  // For a <pre>: coloured, no numbers. Very large text stays plain - a
  // megabyte of spans costs more than colour is worth.
  const html = (text, lang) => (String(text).length > 600000 ? esc(text) : lines(text, lang).join('\n'));

  // ---------- the editor ----------

  function attach(tab, ta, lang) {
    if (!ta || ta.__dbCode) return ta && ta.__dbCode;
    const doc = tab.document;
    const box = doc.createElement('div');
    box.className = 'cx';
    const gut = doc.createElement('div');
    gut.className = 'cx-gut';
    const gutIn = doc.createElement('div');
    gutIn.className = 'cx-gut-in';
    gut.appendChild(gutIn);
    const area = doc.createElement('div');
    area.className = 'cx-area';
    const cur = doc.createElement('div');
    cur.className = 'cx-cur';
    const hl = doc.createElement('pre');
    hl.className = 'cx-hl';
    hl.setAttribute('aria-hidden', 'true');
    ta.parentNode.insertBefore(box, ta);
    area.append(cur, hl, ta);
    box.append(gut, area);
    ta.classList.add('cx-ta');
    ta.setAttribute('wrap', 'off');
    ta.spellcheck = false;

    const next = tokenizer(lang);
    let text = null;
    let rows = [];
    let starts = [];
    let frame = 0;
    let curLine = 0;

    function reparse() {
      text = ta.value;
      rows = text.split('\n');
      starts = states(rows, lang);
      box.classList.toggle('ro', ta.readOnly);
      gut.style.width = 'calc(' + String(rows.length).length + 'ch + 30px)';
    }

    function paint() {
      frame = 0;
      if (ta.value !== text) reparse();
      const st = ta.scrollTop;
      const first = Math.max(0, Math.floor((st - PAD_Y) / LH) - 4);
      const count = Math.ceil(ta.clientHeight / LH) + 10;
      const last = Math.min(rows.length, first + count);
      let h = '';
      let g = '';
      for (let i = first; i < last; i++) {
        h += lineHtml(next(rows[i].replace(/\r$/, ''), starts[i]).parts) + '\n';
        g += '<div' + (i === curLine ? ' class="on"' : '') + '>' + (i + 1) + '</div>';
      }
      hl.innerHTML = h;
      gutIn.innerHTML = g;
      const y = PAD_Y + first * LH - st;
      hl.style.transform = 'translate(' + -ta.scrollLeft + 'px,' + (y - PAD_Y) + 'px)';
      gutIn.style.transform = 'translateY(' + y + 'px)';
      cur.style.transform = 'translateY(' + (PAD_Y + curLine * LH - st) + 'px)';
    }

    const schedule = () => {
      if (!frame) frame = tab.requestAnimationFrame(paint);
    };

    function caret() {
      const v = ta.value;
      const pos = ta.selectionStart || 0;
      let n = 0;
      for (let i = v.indexOf('\n'); i >= 0 && i < pos; i = v.indexOf('\n', i + 1)) n++;
      if (n !== curLine) {
        curLine = n;
        schedule();
      }
      box.classList.toggle('sel', ta.selectionStart !== ta.selectionEnd);
    }

    ta.addEventListener('input', () => {
      schedule();
      caret();
    });
    ta.addEventListener('scroll', schedule);
    for (const ev of ['keyup', 'mouseup', 'focus', 'select']) ta.addEventListener(ev, caret);
    doc.addEventListener('selectionchange', () => {
      if (doc.activeElement === ta) caret();
    });
    tab.addEventListener('resize', schedule);
    if (tab.ResizeObserver) new tab.ResizeObserver(schedule).observe(area);

    // Features set ta.value from their own code (load, format, reload,
    // save); that fires no input event, so the property itself redraws.
    const proto = Object.getOwnPropertyDescriptor(tab.HTMLTextAreaElement.prototype, 'value');
    Object.defineProperty(ta, 'value', {
      configurable: true,
      get() {
        return proto.get.call(this);
      },
      set(v) {
        proto.set.call(this, v);
        schedule();
      }
    });
    const readOnly = Object.getOwnPropertyDescriptor(tab.HTMLTextAreaElement.prototype, 'readOnly');
    Object.defineProperty(ta, 'readOnly', {
      configurable: true,
      get() {
        return readOnly.get.call(this);
      },
      set(v) {
        readOnly.set.call(this, v);
        text = null;
        schedule();
      }
    });

    reparse();
    paint();
    ta.__dbCode = { refresh: schedule };
    return ta.__dbCode;
  }

  // ---------- the look: VS Code, Light theme ----------

  const FONT = 'Consolas,"Cascadia Mono","Cascadia Code","SF Mono",Menlo,ui-monospace,monospace';

  const CSS =
    // colours - q-prefixed, so they never meet a tab's own class names
    '.qk{color:var(--dbc-fg-0451a5)}.qs{color:var(--dbc-fg-a31515)}.qn{color:var(--dbc-fg-098658)}.ql{color:var(--dbc-fg-0000ff)}.qw{color:var(--dbc-fg-0000ff)}.qx{color:var(--dbc-fg-af00db)}' +
    '.qc{color:var(--dbc-fg-008000)}.qf{color:var(--dbc-fg-795e26)}.qt{color:var(--dbc-fg-800000)}.qa{color:var(--dbc-fg-e50000)}.qv{color:var(--dbc-fg-0000ff)}' +
    '.qb0{color:var(--dbc-fg-0431fa)}.qb1{color:var(--dbc-fg-319331)}.qb2{color:var(--dbc-fg-7b3814)}' +
    '.qig{background-image:linear-gradient(to right,var(--dbc-bg-e3e7ee) 1px,transparent 1px);background-size:2ch 100%;background-repeat:repeat-x}' +
    // the editor
    '.cx{position:relative;flex:1;display:flex;min-width:0;min-height:0;border:1px solid var(--dbc-bd-dde3f0);border-radius:8px;background:var(--dbc-bg-fff);overflow:hidden;' +
    'font:13px/' + LH + 'px ' + FONT + ';font-variant-ligatures:none}' +
    '.cx:focus-within{border-color:var(--dbc-bd-1e6bff);box-shadow:0 0 0 1px var(--dbc-bd-1e6bff)}' +
    '.cx.ro,.cx.ro .cx-gut{background:var(--dbc-bg-fafbfd)}' +
    '.cx-gut{flex:none;overflow:hidden;background:var(--dbc-bg-fff);color:var(--dbc-fg-8c96a8);text-align:right;user-select:none;border-right:1px solid var(--dbc-bd-eef1f6)}' +
    '.cx-gut-in{padding-right:12px;will-change:transform}.cx-gut-in div{height:' + LH + 'px}.cx-gut-in .on{color:var(--dbc-fg-0b216f);font-weight:600}' +
    '.cx-area{position:relative;flex:1;min-width:0;overflow:hidden}' +
    '.cx-cur{position:absolute;left:0;right:0;top:0;height:' + LH + 'px;background:var(--dbc-bg-f3f6fb);border-top:1px solid var(--dbc-bd-eef2f8);border-bottom:1px solid var(--dbc-bd-eef2f8);box-sizing:border-box;pointer-events:none;will-change:transform}' +
    '.cx.sel .cx-cur{display:none}' +
    '.cx-hl{position:absolute;left:0;top:0;margin:0;padding:' + PAD_Y + 'px ' + PAD_X + 'px;border:0;background:none;color:var(--dbc-fg-1f1f1f);white-space:pre;tab-size:2;' +
    'font:inherit;font-variant-ligatures:none;pointer-events:none;will-change:transform}' +
    '.cx textarea.cx-ta,.cx textarea.cx-ta:focus,.cx textarea.cx-ta[readonly]{position:absolute;inset:0;width:100%;height:100%;flex:none;margin:0;' +
    'padding:' + PAD_Y + 'px ' + PAD_X + 'px;border:0;border-radius:0;outline:0;box-shadow:none;resize:none;background:transparent;color:transparent;' +
    'caret-color:var(--dbc-fg-000);white-space:pre;overflow:auto;tab-size:2;font:inherit;font-variant-ligatures:none}' +
    '.cx textarea.cx-ta::selection{background:rgba(173,214,255,.6);color:transparent}' +
    '.cx textarea.cx-ta::placeholder{color:var(--dbc-fg-97a5c6)}' +
    // a coloured <pre>
    'pre.code{font:12.5px/1.5 ' + FONT + ';font-variant-ligatures:none;color:var(--dbc-fg-1f1f1f)}';

  // ---------- the look of every tab DynaBoost opens ----------

  /* The golden rectangle and spiral from the app mark, in the top-right corner
   * of every tab header. */
  const MARK_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 235 146" fill="none" stroke="#e3b04b">' +
    '<g stroke-width="0.9" opacity="0.55"><rect x="0" y="0" width="233" height="144"/>' +
    '<path d="M144 0V144M144 89H233M178 89V144M144 110H178M165 89V110M165 102H178M170 102V110"/></g>' +
    '<path stroke-width="1.6" stroke-linecap="round" d="M0 144A144 144 0 0 1 144 0A89 89 0 0 1 233 89' +
    'A55 55 0 0 1 178 144A34 34 0 0 1 144 110A21 21 0 0 1 165 89A13 13 0 0 1 178 102A8 8 0 0 1 170 110"/>' +
    '</svg>';
  const MARK_URL = 'url("data:image/svg+xml,' + encodeURIComponent(MARK_SVG) + '")';

  /* Appended to each tab's <style> after its own rules: the shared header -
   * white band, gold rule, title, crumbs, the mark. */
  // What the table cannot say: colours with transparency.
  const DARK_EXTRA =
    'html.db-dark .cx textarea.cx-ta::selection{background:rgba(38,79,120,.85)}' +
    'html.db-dark ::-webkit-scrollbar{width:12px;height:12px}html.db-dark ::-webkit-scrollbar-thumb{background:#2a3553;border-radius:6px;border:3px solid transparent;background-clip:content-box}' +
    'html.db-dark ::-webkit-scrollbar-track{background:transparent}' +
    // Fields a tab leaves to the browser: navy, not the browser's grey. :where
    // keeps this weaker than any rule a tab writes for its own fields.
    'html.db-dark :where(input:not([type=checkbox]):not([type=radio]),select,textarea){background-color:#0c1325;color:#e3e9f7;border-color:#34436a}';

  const TAB_CSS =
    'header{position:relative;overflow:hidden;background:var(--dbc-bg-fff);border-bottom:2px solid var(--dbc-bd-e3b04b)}' +
    'header>*{position:relative;z-index:1}' +
    'header::after{content:"";position:absolute;z-index:0;right:-26px;top:-22px;width:290px;height:180px;' +
    'background:' + MARK_URL + ' no-repeat right top/contain;opacity:.45;pointer-events:none}' +
    'header h1{margin:0;font-size:20px;font-weight:600;line-height:1.3;color:var(--dbc-fg-10224e)}' +
    'header .crumbs{margin-top:3px;font-size:13px;color:var(--dbc-fg-56637f)}' +
    // Rate DynaBoost, top right of the header: small, in a thin gold frame on a
    // solid ground (the gold arcs behind it would swallow it), brighter under
    // the pointer. The title keeps clear of it.
    'header h1{padding-right:150px}' +
    'header>.db-rate{position:absolute;z-index:2;top:12px;right:14px;display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px 0 8px;' +
    'border:1px solid var(--dbc-bd-e8d5a8);border-radius:13px;background:var(--dbc-bg-fff);color:var(--dbc-fg-56637f);font:12px "Segoe UI",system-ui,sans-serif;text-decoration:none;white-space:nowrap;' +
    'transition:color .15s,border-color .15s,box-shadow .15s}' +
    'header>.db-rate:hover{color:var(--dbc-fg-10224e);border-color:var(--dbc-bd-e3b04b);box-shadow:0 0 0 3px rgba(227,176,75,.2)}' +
    'header>.db-rate svg{width:13px;height:13px;flex:none;color:var(--dbc-fg-e3b04b);transition:transform .2s cubic-bezier(.34,1.56,.64,1)}' +
    'header>.db-rate:hover svg{transform:scale(1.15) rotate(-8deg)}' +
    'html.db-dark header>.db-rate:hover{box-shadow:0 0 0 3px rgba(227,176,75,.25)}';

  // DynaBoost on the Chrome Web Store - the same as THANKS.rate in core.js.
  const RATE = 'https://chromewebstore.google.com/detail/odonlnpmplbipgojjodfpedjbbahfkmk';
  const STAR =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="m12 3.8 2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';

  // The colour table first, so each tab carries its light and dark values.
  DynaBoost.tabCss = (DynaBoost.themeVars || '') + TAB_CSS + DARK_EXTRA;

  /* Light or dark for a tab DynaBoost wrote: html.db-dark switches the
   * table's variables. By default the tab follows the panel (DynaBoost.isDark);
   * the flow editor page passes its own. */
  DynaBoost.themeTab = function (tab, dark) {
    const doc = tab && tab.document;
    if (!doc || !doc.documentElement) return;
    if (dark === undefined) dark = typeof DynaBoost.isDark === 'function' ? DynaBoost.isDark() : false;
    doc.documentElement.classList.toggle('db-dark', !!dark);
    if (!doc.getElementById('db-theme-vars') && DynaBoost.themeVars) {
      const st = doc.createElement('style');
      st.id = 'db-theme-vars';
      st.textContent = DynaBoost.themeVars;
      (doc.head || doc.documentElement).appendChild(st);
    }
    // Every tab with the shared header offers Rate DynaBoost (a page that is
    // only "Opening..." has no header and gets none).
    const header = doc.querySelector('body > header');
    if (header && !header.querySelector('.db-rate')) {
      const a = doc.createElement('a');
      a.className = 'db-rate';
      a.href = RATE;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.innerHTML = STAR + '<span>Rate DynaBoost</span>';
      header.appendChild(a);
    }
  };
  DynaBoost.code = { css: CSS, attach: attach, lines: lines, html: html };
})();
