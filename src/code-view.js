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

  // A very long line (minified code, a long value) stays uncoloured: thousands
  // of coloured pieces on one line cost the browser seconds to lay out.
  const LONG_LINE = 3000;

  function lines(text, lang, mark) {
    const next = tokenizer(lang);
    let st = {};
    return String(text).split(/\r?\n/).map((l) => {
      const r = next(l, st);
      st = r.state;
      return lineHtml(l.length > LONG_LINE ? [['', l]] : r.parts, mark);
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
    // Top right of the header: Report a bug and Suggest an idea as two small
    // round icons, then Rate DynaBoost - small, in thin frames on a solid
    // ground (the gold arcs behind them would swallow them), brighter under
    // the pointer. The title keeps clear of them.
    'header h1{padding-right:220px}' +
    'header>.db-links{position:absolute;z-index:2;top:12px;right:14px;display:flex;align-items:center;gap:6px}' +
    '.db-links>a{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:26px;border:1px solid var(--dbc-bd-dde3f0);border-radius:13px;background:var(--dbc-bg-fff);' +
    'color:var(--dbc-fg-56637f);font:12px "Segoe UI",system-ui,sans-serif;text-decoration:none;white-space:nowrap;transition:color .15s,border-color .15s,box-shadow .15s}' +
    '.db-links>a svg{width:14px;height:14px;flex:none;transition:transform .2s cubic-bezier(.34,1.56,.64,1)}' +
    '.db-links>.db-fb{width:26px;padding:0}' +
    '.db-links>.db-fb-bug:hover{color:var(--dbc-fg-c42b1c);border-color:var(--dbc-bd-c42b1c);box-shadow:0 0 0 3px rgba(196,43,28,.12)}' +
    '.db-links>.db-fb-bug:hover svg{transform:rotate(-12deg)}' +
    '.db-links>.db-fb-idea:hover{color:var(--dbc-fg-e3b04b);border-color:var(--dbc-bd-e3b04b);box-shadow:0 0 0 3px rgba(227,176,75,.2)}' +
    '.db-links>.db-fb-idea:hover svg{transform:scale(1.15)}' +
    '.db-links>.db-rate{padding:0 10px 0 8px;border-color:var(--dbc-bd-e8d5a8)}' +
    '.db-links>.db-rate:hover{color:var(--dbc-fg-10224e);border-color:var(--dbc-bd-e3b04b);box-shadow:0 0 0 3px rgba(227,176,75,.2)}' +
    '.db-links>.db-rate svg{width:13px;height:13px;color:var(--dbc-fg-e3b04b)}' +
    '.db-links>.db-rate:hover svg{transform:scale(1.15) rotate(-8deg)}' +
    'html.db-dark .db-links>.db-rate:hover,html.db-dark .db-links>.db-fb-idea:hover{box-shadow:0 0 0 3px rgba(227,176,75,.25)}' +
    'html.db-dark .db-links>.db-fb-bug:hover{box-shadow:0 0 0 3px rgba(255,123,123,.18)}';

  /* Rate DynaBoost goes to the store it was installed from: the store writes
   * its update address into the installed manifest - Google's or Microsoft's.
   * A copy loaded from a folder has none; then the browser decides (Edge can
   * also install from the Chrome Web Store, so the address comes first).
   * Nothing leaves the browser. Used by the panel (Say thanks), the help page
   * and every tab's header. */
  const STORES = {
    chrome: { url: 'https://chromewebstore.google.com/detail/odonlnpmplbipgojjodfpedjbbahfkmk', name: 'Chrome Web Store', small: 'On the Web Store' },
    edge: { url: 'https://microsoftedge.microsoft.com/addons/detail/dynaboost/lcjglafhmpkbhpoejkbpdgbnfepdcecl', name: 'Edge Add-ons', small: 'On Edge Add-ons' }
  };
  function storeOf() {
    let update = '';
    try {
      update = String(chrome.runtime.getManifest().update_url || '');
    } catch (e) {
      /* no manifest to read */
    }
    if (/(^|\.)edge\.microsoft\.com\//i.test(update.replace(/^https?:\/\//i, ''))) return 'edge';
    if (/(^|\.)google\.com\//i.test(update.replace(/^https?:\/\//i, ''))) return 'chrome';
    try {
      const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
      if (brands.some((b) => /Microsoft Edge/i.test(b.brand))) return 'edge';
    } catch (e) {
      /* no brands */
    }
    return /\bEdg\//.test(navigator.userAgent) ? 'edge' : 'chrome';
  }
  DynaBoost.store = STORES[storeOf()];
  const RATE = DynaBoost.store.url;
  const STAR =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="m12 3.8 2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';

  // Report a bug and Suggest an idea: a bug and a light bulb, drawn like the
  // panel's icons - outlines, rounded ends.
  const BUG_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M9.2 7.6a2.8 2.8 0 0 1 5.6 0"/><rect x="7.2" y="7.6" width="9.6" height="12.4" rx="4.8"/><path d="M12 11v9"/>' +
    '<path d="M9.6 5.2 8.2 3.6M14.4 5.2l1.4-1.6M7.2 12.6H4.4M16.8 12.6h2.8M7.6 9.6 5.2 8.2M16.4 9.6l2.4-1.4M7.6 16.8l-2.4 1.6M16.4 16.8l2.4 1.6"/></svg>';
  const IDEA_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M12 3.4a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1v.4h5v-.4c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3.4z"/><path d="M9.8 19.4h4.4M10.6 21.6h2.8"/></svg>';
  DynaBoost.icons = { bug: BUG_SVG, idea: IDEA_SVG, star: STAR };

  /* Report a bug, Suggest an idea: DynaBoost's two forms on Tally. The link
   * carries only what helps to read a report - the version, the browser, the
   * panel's section and tool, the kind of page (from the panel's context
   * strip: "Dynamics 365 · Record") - never an address, a name or an id. Only
   * the click opens the form; the person writes it and sends it, or not. */
  const FORMS = { bug: 'https://tally.so/r/xXepb9', idea: 'https://tally.so/r/7R8W0z' };
  function browserName() {
    try {
      const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
      const b = brands.find((x) => /Microsoft Edge|Google Chrome|Opera|Brave/i.test(x.brand)) || brands.find((x) => /Chromium/i.test(x.brand));
      if (b) return b.brand.replace(/^Google /, '').replace(/^Microsoft /, '') + ' ' + b.version;
    } catch (e) {
      /* no brands */
    }
    const m = navigator.userAgent.match(/\b(Edg|OPR|Chrome)\/(\d+)/);
    return m ? { Edg: 'Edge', OPR: 'Opera', Chrome: 'Chrome' }[m[1]] + ' ' + m[2] : '';
  }
  DynaBoost.feedbackUrl = function (kind, about) {
    const q = new URLSearchParams();
    try {
      q.set('version', chrome.runtime.getManifest().version);
    } catch (e) {
      /* the extension was updated meanwhile */
    }
    const browser = browserName();
    if (browser) q.set('browser', browser);
    for (const k of ['section', 'tool', 'page']) if (about && about[k]) q.set(k, String(about[k]).slice(0, 60));
    const query = q.toString();
    return (FORMS[kind] || FORMS.bug) + (query ? '?' + query : '');
  };

  // The colour table first, so each tab carries its light and dark values.
  DynaBoost.tabCss = (DynaBoost.themeVars || '') + TAB_CSS + DARK_EXTRA;
  // The golden rectangle and spiral, for a tab's own dialogs.
  DynaBoost.markUrl = MARK_URL;

  /* The icon for a tab, as a data: URL - a tab a page wrote does not show a
   * chrome-extension:// icon. Read from icons/icon32.png once, when the first
   * tab needs it. */
  let iconUrl = null;
  function tabIcon() {
    if (!iconUrl) {
      iconUrl = fetch(chrome.runtime.getURL('icons/icon32.png'))
        .then((res) => res.blob())
        .then((blob) => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        }));
      iconUrl.catch(() => (iconUrl = null)); // a failed read is tried again next time
    }
    return iconUrl;
  }

  /* Light or dark for a tab DynaBoost wrote: html.db-dark switches the
   * table's variables. By default the tab follows the panel (DynaBoost.isDark);
   * the flow editor page passes its own. It also gives the tab DynaBoost's
   * icon. */
  DynaBoost.themeTab = function (tab, dark) {
    const doc = tab && tab.document;
    if (!doc || !doc.documentElement) return;
    if (dark === undefined) dark = typeof DynaBoost.isDark === 'function' ? DynaBoost.isDark() : false;
    doc.documentElement.classList.toggle('db-dark', !!dark);
    // Every tab DynaBoost writes shows its icon, as its own pages (Edit flow,
    // the help) do - "Opening..." included.
    try {
      if (!doc.querySelector('link[rel~="icon"]')) {
        const icon = doc.createElement('link');
        icon.rel = 'icon';
        icon.type = 'image/png';
        (doc.head || doc.documentElement).appendChild(icon);
        tabIcon().then((url) => (icon.href = url), () => {});
        // A tab first written as "Reading..." and then written again does not
        // always take the icon at once: it is given again once the tab settles.
        for (const ms of [400, 1500]) {
          setTimeout(() => {
            if (icon.isConnected && icon.href) icon.replaceWith(icon.cloneNode());
          }, ms);
        }
      }
    } catch (e) {
      /* the extension was updated meanwhile - the tab still works */
    }
    if (!doc.getElementById('db-theme-vars') && DynaBoost.themeVars) {
      const st = doc.createElement('style');
      st.id = 'db-theme-vars';
      st.textContent = DynaBoost.themeVars;
      (doc.head || doc.documentElement).appendChild(st);
    }
    // Every tab with the shared header offers Report a bug, Suggest an idea
    // and Rate DynaBoost (a page that is only "Opening..." has no header and
    // gets none; the help page has its own).
    const header = doc.querySelector('body > header');
    if (header && !header.querySelector('.db-rate, .db-links')) {
      const links = doc.createElement('div');
      links.className = 'db-links';
      const link = (cls, href, html, title) => {
        const a = doc.createElement('a');
        a.className = cls;
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.innerHTML = html;
        if (title) {
          a.title = title;
          a.setAttribute('aria-label', title);
        }
        links.appendChild(a);
      };
      link('db-fb db-fb-bug', DynaBoost.feedbackUrl('bug'), BUG_SVG, 'Report a bug');
      link('db-fb db-fb-idea', DynaBoost.feedbackUrl('idea'), IDEA_SVG, 'Suggest an idea');
      link('db-rate', RATE, STAR + '<span>Rate DynaBoost</span>');
      header.appendChild(links);
    }
  };
  /* A tool that stopped with an error after opening its tab: the tab, in
   * front, says so: in place of "Copying..." (a tab with no header is only
   * that), or at the top of a part of the result.
   * Only a tab DynaBoost writes itself: about:blank, or - once written to - the
   * address of the page that opened it (from); one that has gone on to a page
   * of its own is left alone. */
  const ERROR_CSS =
    '.db-tab-error{margin:16px 24px;padding:12px 16px;border:1px solid var(--dbc-bd-c42b1c);border-left-width:4px;border-radius:8px;background:var(--dbc-bg-fde8e8);' +
    'font:14px/1.5 "Segoe UI",system-ui,sans-serif;color:var(--dbc-fg-10224e)}' +
    '.db-tab-error b{display:block;margin-bottom:2px;color:var(--dbc-fg-a11a1a)}' +
    '.db-tab-error .db-tab-error-n{margin-top:6px;font-size:13px;color:var(--dbc-fg-56637f)}' +
    '.db-tab-error a{color:var(--dbc-fg-1e6bff);font-weight:600;text-decoration:none}' +
    '.db-tab-error a:hover{text-decoration:underline}';
  DynaBoost.tabError = function (tab, title, message, from, section) {
    try {
      if (!tab || tab.closed || (tab.location.href !== 'about:blank' && tab.location.href !== from)) return false;
      const doc = tab.document;
      if (!doc.body) return false;
      DynaBoost.themeTab(tab);
      const st = doc.createElement('style');
      st.textContent = ERROR_CSS;
      (doc.head || doc.documentElement).appendChild(st);
      const box = doc.createElement('div');
      box.className = 'db-tab-error';
      box.setAttribute('role', 'alert');
      const head = doc.createElement('b');
      head.textContent = title + ' stopped with an error';
      const why = doc.createElement('div');
      why.textContent = message;
      const next = doc.createElement('div');
      next.className = 'db-tab-error-n';
      next.textContent = 'You can close this tab and try again. Keeps happening? ';
      const report = doc.createElement('a');
      report.href = DynaBoost.feedbackUrl('bug', { section: section, tool: title });
      report.target = '_blank';
      report.rel = 'noopener noreferrer';
      report.textContent = 'Report this bug';
      next.appendChild(report);
      box.append(head, why, next);
      if (!doc.querySelector('body > header')) doc.body.textContent = '';
      doc.body.insertBefore(box, doc.body.firstChild);
      return true;
    } catch (e) {
      return false;
    }
  };
  /* DynaBoost's status icons - the same wherever a tab shows something
   * working, done or failed:
   *   busy - golden squares laid one by one, then the spiral through them;
   *   ok   - a gold ring closes, then a green tick is drawn;
   *   bad  - a red ring, the cross drawn, one small shake;
   *   wait - a quiet ring, for a step that waits for the user.
   * DynaBoost.status.html(kind) gives the icon; DynaBoost.status.css goes in
   * the tab's <style>. Under "reduce motion" they stand still. */
  const ST_SPIRAL = 'M0 144A144 144 0 0 1 144 0A89 89 0 0 1 233 89A55 55 0 0 1 178 144A34 34 0 0 1 144 110A21 21 0 0 1 165 89A13 13 0 0 1 178 102A8 8 0 0 1 170 110';
  const STATUS_CSS =
    '.db-st{display:inline-block;flex:none;width:20px;height:20px;overflow:visible;vertical-align:middle}' +
    '.db-st.db-st-busy{width:28px;height:18px;margin:1px -8px 1px 0}' +
    '.db-st-busy rect{stroke:var(--dbc-fg-e3b04b);fill:var(--dbc-fg-e3b04b);fill-opacity:0;opacity:0;transform-box:fill-box;transform-origin:center;animation:dbst-lay 2.4s ease-out infinite}' +
    '.db-st-busy rect:nth-child(2){animation-delay:.2s}.db-st-busy rect:nth-child(3){animation-delay:.4s}' +
    '.db-st-busy rect:nth-child(4){animation-delay:.6s}.db-st-busy rect:nth-child(5){animation-delay:.8s}.db-st-busy rect:nth-child(6){animation-delay:1s}' +
    '.db-st-busy .sp{fill:none;stroke:var(--dbc-fg-e3b04b);stroke-linecap:round;stroke-dasharray:520;stroke-dashoffset:520;animation:dbst-draw 2.4s ease-in-out infinite}' +
    '@keyframes dbst-lay{0%{opacity:0;fill-opacity:.25;transform:scale(.85)}15%{opacity:1;fill-opacity:.18;transform:scale(1)}70%{opacity:1;fill-opacity:.04}100%{opacity:0;fill-opacity:0}}' +
    '@keyframes dbst-draw{0%,35%{stroke-dashoffset:520;opacity:1}75%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:0}}' +
    '.db-st-ok .ring{fill:none;stroke:var(--dbc-fg-e3b04b);stroke-dasharray:64;stroke-dashoffset:64;animation:dbst-line .5s ease-out forwards}' +
    '.db-st-ok .tick{fill:none;stroke:var(--dbc-fg-1c9b4a);stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:16;stroke-dashoffset:16;animation:dbst-line .35s .4s ease-out forwards}' +
    '.db-st-bad .ring{fill:var(--dbc-fg-fde8e8);stroke:var(--dbc-fg-c42b1c)}' +
    '.db-st-bad .x{fill:none;stroke:var(--dbc-fg-c42b1c);stroke-linecap:round;stroke-dasharray:12;stroke-dashoffset:12;animation:dbst-line .35s .1s ease-out forwards}' +
    '.db-st-bad g{transform-box:fill-box;transform-origin:center;animation:dbst-shake .45s .4s ease-in-out}' +
    '.db-st-wait .ring{fill:none;stroke:var(--dbc-fg-c6d0e4)}' +
    '@keyframes dbst-line{to{stroke-dashoffset:0}}' +
    '@keyframes dbst-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-1.4px)}55%{transform:translateX(1.4px)}80%{transform:translateX(-.6px)}}' +
    '@media (prefers-reduced-motion:reduce){.db-st *{animation:none!important}.db-st .ring,.db-st .tick,.db-st .x{stroke-dashoffset:0}' +
    '.db-st-busy rect{opacity:1;fill-opacity:.1}.db-st-busy .sp{stroke-dashoffset:0}}';
  const STATUS = {
    busy:
      '<svg class="db-st db-st-busy" viewBox="-8 -8 251 162" aria-hidden="true"><g stroke-width="11">' +
      '<rect x="0" y="0" width="144" height="144"/><rect x="144" y="0" width="89" height="89"/><rect x="178" y="89" width="55" height="55"/>' +
      '<rect x="144" y="110" width="34" height="34"/><rect x="144" y="89" width="21" height="21"/><rect x="165" y="89" width="13" height="13"/></g>' +
      '<path class="sp" stroke-width="14" d="' + ST_SPIRAL + '"/></svg>',
    ok:
      '<svg class="db-st db-st-ok" viewBox="0 0 24 24" aria-hidden="true"><circle class="ring" cx="12" cy="12" r="10" stroke-width="2" transform="rotate(-90 12 12)"/>' +
      '<path class="tick" d="m7.5 12.5 3 3 6-6.5" stroke-width="2.6"/></svg>',
    bad:
      '<svg class="db-st db-st-bad" viewBox="0 0 24 24" aria-hidden="true"><g><circle class="ring" cx="12" cy="12" r="10" stroke-width="2"/>' +
      '<path class="x" d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke-width="2.6"/></g></svg>',
    wait: '<svg class="db-st db-st-wait" viewBox="0 0 24 24" aria-hidden="true"><circle class="ring" cx="12" cy="12" r="10" stroke-width="2"/></svg>'
  };
  /* In a dialog over the page (.db-overlay): the same icons - their rules put
   * in the page once, their colours from .db-overlay in panel.css. */
  function statusInPage() {
    if (document.getElementById('dynaboost-status-css')) return;
    const st = document.createElement('style');
    st.id = 'dynaboost-status-css';
    st.textContent = STATUS_CSS;
    (document.head || document.documentElement).appendChild(st);
  }
  DynaBoost.status = { css: STATUS_CSS, html: (kind) => STATUS[kind] || STATUS.wait, inPage: statusInPage };

  DynaBoost.code = { css: CSS, attach: attach, lines: lines, html: html };
})();
