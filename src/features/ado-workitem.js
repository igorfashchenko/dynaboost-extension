/* Feature: Copy work item (Azure DevOps).
 *
 * An action tile. On any work item page (Boards, Backlogs, query results, the
 * full-screen form or the dialog over a board) it reads the item through the
 * REST API — not off the screen — and puts a tidy Markdown document on the
 * clipboard: the title, every HTML section (Description, Acceptance
 * criteria, Repro steps, custom fields) and the whole comment thread.
 *
 * Content only. The document is meant to be handed on - to a spec, a
 * colleague - so the tracking fields (State, Reason, Assigned to, dates,
 * Area, Iteration, Tags, Priority, estimates) and the links to related
 * items are left out: they describe where the item sits in the process and
 * the backlog, not what it asks for. The type stays,
 * in the title line, since a Bug and a Feature are read differently.
 *
 * Why the API and not the DOM: the form renders one section at a time, long
 * descriptions are virtualised, and the comment thread lazy-loads. The API
 * hands over the same HTML the editor saved, complete.
 *
 * Inline images cannot travel through the clipboard as text. Each one becomes
 * a numbered placeholder in the Markdown (image-1.png ...) and the toast
 * offers to download the files under those exact names, so attaching them to
 * a chat lines them up with the placeholders. "Copy with images" instead
 * inlines them as base64 data URIs, for the rare case where that is wanted.
 *
 * The tile registers only on Azure DevOps hosts, so it stays out of the panel
 * on make.powerapps.com and Dynamics.
 */
(function () {
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="8" y="3" width="12" height="14" rx="2" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M16 17v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="M11.5 9.5h5M11.5 12.5h3" stroke="#E3B04B" stroke-width="1.6" stroke-linecap="round"/>' +
    '</svg>';

  // HTML fields, in the order they should appear. Anything else that looks
  // like HTML is appended afterwards under its own name.
  const SECTIONS = [
    ['System.Description', 'Description'],
    ['Microsoft.VSTS.Common.AcceptanceCriteria', 'Acceptance criteria'],
    ['Microsoft.VSTS.TCM.ReproSteps', 'Repro steps'],
    ['Microsoft.VSTS.TCM.SystemInfo', 'System info'],
    ['Microsoft.VSTS.Common.Resolution', 'Resolution'],
    ['Microsoft.VSTS.CMMI.Analysis', 'Analysis'],
    ['Microsoft.VSTS.CMMI.CorrectiveActionPlan', 'Corrective action plan'],
    ['Microsoft.VSTS.CMMI.Symptom', 'Symptom'],
    ['Microsoft.VSTS.CMMI.ProposedFix', 'Proposed fix']
  ];

  const HTML_RE = /<(p|div|br|ul|ol|li|img|table|h[1-6]|span|strong|em|a|pre|blockquote)\b/i;

  // ---------- where are we ----------

  function origin() {
    // dev.azure.com/{org}/...            -> https://dev.azure.com/{org}
    // {org}.visualstudio.com/{project}/  -> https://{org}.visualstudio.com
    if (/\.visualstudio\.com$/i.test(location.hostname)) return location.origin;
    const first = location.pathname.split('/').filter(Boolean)[0];
    return first ? location.origin + '/' + first : location.origin;
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /* The id a work item form shows in its own header. Scoped to the header on
   * purpose: the body lists related items as links too, and the first of
   * those is somebody else's id. */
  function idIn(root) {
    // Only sources that name this dialog's own item. A description can mention
    // other items ("successor feature to #5678"), and those mentions are
    // links to _workitems/edit/ too - so no "first link in the header" guess.

    // 1. The dialog's focus heading, measured: aria-label="Feature 1234
    //    Sign-in page ..." - the type, then the id.
    for (const el of [root.querySelector('.bolt-dialog-focus-element[role="heading"][aria-label]') || root.querySelector('[role="heading"][aria-label]'), root]) {
      const m = ((el && el.getAttribute('aria-label')) || '').match(/^[^\d]*?(\d{2,})\b/);
      if (m) return m[1];
    }
    // 2. The header link whose whole text is "TYPE ID", e.g. "FEATURE 1234".
    //    A mention in the body reads "5678 Payment page ..." and fails.
    for (const a of root.querySelectorAll('a[href*="_workitems/edit/"]')) {
      const text = (a.textContent || '').trim();
      const m = text.match(/^[A-Za-z][A-Za-z ]*?\s(\d{2,})$/);
      const href = a.getAttribute('href').match(/_workitems\/edit\/(\d+)/i);
      if (m && href && href[1] === m[1]) return m[1];
    }
    // 3. Older forms print the id on its own in the header.
    const el = root.querySelector('.work-item-form-id');
    const m = el && (el.textContent || '').match(/\d{2,}/);
    return m ? m[0] : null;
  }

  /* A work item opened from a board, a query or a link inside another item
   * comes up in a dialog over the page, and the address does not change -
   * it still names the item underneath. So an open dialog decides first, the
   * topmost one when ADO has stacked a few. */
  function dialogItemId() {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .bolt-dialog-root, [class*="work-item-form-dialog"]'))
      // A work item dialog holds a form. Hover cards over a mention are
      // dialogs too, and name the mentioned item - and so is our own panel.
      .filter((d) => visible(d) && !d.closest('#dynaboost-root') && !!d.querySelector('.work-item-form-page, [class*="work-item-form"]'));
    for (let i = dialogs.length - 1; i >= 0; i--) {
      const id = idIn(dialogs[i]);
      if (id) return id;
    }
    return null;
  }

  function workItemId() {
    const inDialog = dialogItemId();
    if (inDialog) return inDialog;

    const path = location.pathname.match(/_workitems\/edit\/(\d+)/i);
    if (path) return path[1];

    const q = new URLSearchParams(location.search);
    for (const key of ['workitem', 'workItemId', 'id']) {
      const v = q.get(key);
      if (v && /^\d+$/.test(v)) return v;
    }

    // Dialog over a board sometimes keeps the id only in the form header.
    const el = document.querySelector('.work-item-form-id, [class*="work-item-form-id"]');
    if (el) {
      const m = (el.textContent || '').match(/\d{2,}/);
      if (m) return m[0];
    }
    return null;
  }

  // ---------- REST ----------

  async function api(url) {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || type.indexOf('json') === -1) {
      throw new Error('Azure DevOps returned ' + res.status + '. Reload the page and try again.');
    }
    return res.json();
  }

  function base() {
    return origin();
  }

  async function fetchItem(id) {
    return api(base() + '/_apis/wit/workitems/' + id + '?api-version=7.0');
  }

  async function fetchComments(project, id) {
    const p = encodeURIComponent(project || '');
    const versions = ['7.0-preview.3', '6.0-preview.3', '5.1-preview.3'];
    for (const v of versions) {
      try {
        const data = await api(
          base() + '/' + p + '/_apis/wit/workItems/' + id + '/comments?$top=200&api-version=' + v
        );
        return (data.comments || []).filter((c) => !c.isDeleted);
      } catch (e) {
        // try the next api-version; older on-prem collections need one
      }
    }
    return [];
  }

  // ---------- HTML -> Markdown ----------

  function newContext() {
    return { images: [], hShift: 2 };
  }

  function hasBlock(node) {
    return !!node.querySelector('p, div, ul, ol, table, pre, blockquote, h1, h2, h3, h4, h5, h6, hr');
  }

  function wrap(text, mark) {
    const trimmed = text.trim();
    if (!trimmed) return '';
    return (/^\s/.test(text) ? ' ' : '') + mark + trimmed + mark + (/\s$/.test(text) ? ' ' : '');
  }

  function fileName(url, index) {
    let name = '';
    try {
      name = new URL(url).searchParams.get('fileName') || '';
    } catch (e) {
      name = '';
    }
    const ext = (name.match(/\.(png|jpe?g|gif|bmp|webp|svg)$/i) || ['.png'])[0].toLowerCase();
    return 'image-' + index + ext;
  }

  function image(node, ctx) {
    const src = node.getAttribute('src') || '';
    if (!src) return '';
    let abs;
    try {
      abs = new URL(src, location.href).href;
    } catch (e) {
      return '';
    }
    if (/^data:/i.test(abs)) return '![inline image](' + abs + ')';

    let rec = ctx.images.filter((i) => i.url === abs)[0];
    if (!rec) {
      const index = ctx.images.length + 1;
      rec = { url: abs, index: index, name: fileName(abs, index), alt: node.getAttribute('alt') || '' };
      ctx.images.push(rec);
    }
    const label = 'Image ' + rec.index + (rec.alt ? ' - ' + rec.alt : '');
    return '![' + label + '](@@IMG' + rec.index + '@@)';
  }

  function inline(node, ctx) {
    let out = '';
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) {
        out += n.nodeValue.replace(/\s+/g, ' ');
        return;
      }
      if (n.nodeType !== 1) return;
      const tag = n.tagName.toLowerCase();

      // @mentions: ADO wraps them in a span/anchor carrying the identity guid.
      const mention = n.getAttribute('data-vss-mention') || '';
      if (mention || (n.classList && n.classList.contains('mention'))) {
        const raw = n.textContent.replace(/\s+/g, ' ').trim();
        const guid = (mention.match(/[0-9a-f]{8}-[0-9a-f-]{27}/i) || [])[0];
        return void (out += '@' + pseudonym(guid || raw.replace(/^@/, '')));
      }

      if (tag === 'br') return void (out += '  \n');
      if (tag === 'strong' || tag === 'b') return void (out += wrap(inline(n, ctx), '**'));
      if (tag === 'em' || tag === 'i') return void (out += wrap(inline(n, ctx), '*'));
      if (tag === 's' || tag === 'del' || tag === 'strike') return void (out += wrap(inline(n, ctx), '~~'));
      if (tag === 'code') return void (out += '`' + n.textContent.replace(/\s+/g, ' ').trim() + '`');
      if (tag === 'img') return void (out += image(n, ctx));
      if (tag === 'a') {
        const text = inline(n, ctx).trim();
        const href = n.getAttribute('href') || '';
        out += href && !/^javascript:/i.test(href) ? '[' + (text || href) + '](' + href + ')' : text;
        return;
      }
      out += inline(n, ctx);
    });
    return out;
  }

  function list(node, ctx, indent) {
    const ordered = node.tagName.toLowerCase() === 'ol';
    let counter = 1;
    let out = '';
    Array.prototype.forEach.call(node.children, (li) => {
      const tag = li.tagName.toLowerCase();

      // The editor in Azure DevOps writes deeper levels as a SIBLING of the
      // item they belong to - <ol><li>2</li><ol><li>2a</li></ol></ol> - the
      // way Word and Outlook do. Walking only <li> children silently drops
      // every sub-level, so lists nested this way are recursed into here.
      if (tag === 'ul' || tag === 'ol') {
        out += list(li, ctx, indent + '  ');
        return;
      }
      if (tag !== 'li') return;
      const marker = ordered ? counter++ + '. ' : '- ';
      const clone = li.cloneNode(true);
      const nested = Array.prototype.slice.call(clone.querySelectorAll(':scope > ul, :scope > ol'));
      nested.forEach((l) => l.remove());

      const body = (hasBlock(clone) ? block(clone, ctx, '') : inline(clone, ctx)).trim();
      const lines = body ? body.split('\n') : [''];
      out += indent + marker + lines[0] + '\n';
      lines.slice(1).forEach((l) => (out += indent + '  ' + l + '\n'));
      nested.forEach((l) => (out += list(l, ctx, indent + '  ')));
    });
    // The blank line closes the list; a nested one is still inside its parent,
    // and a blank line there would split the parent into loose items.
    return out + (indent ? '' : '\n');
  }

  function table(node, ctx, indent) {
    const rows = Array.prototype.slice.call(node.querySelectorAll('tr'));
    if (!rows.length) return '';
    const cells = (row) =>
      Array.prototype.slice
        .call(row.children)
        .filter((c) => /^(td|th)$/i.test(c.tagName))
        .map((c) => inline(c, ctx).replace(/\n/g, ' ').replace(/\|/g, '\\|').trim());

    const head = cells(rows[0]);
    let out = indent + '| ' + head.join(' | ') + ' |\n';
    out += indent + '| ' + head.map(() => '---').join(' | ') + ' |\n';
    rows.slice(1).forEach((r) => {
      out += indent + '| ' + cells(r).join(' | ') + ' |\n';
    });
    return out + '\n';
  }

  function block(node, ctx, indent) {
    indent = indent || '';
    let out = '';
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) {
        const t = n.nodeValue.replace(/\s+/g, ' ').trim();
        if (t) out += indent + t + '\n\n';
        return;
      }
      if (n.nodeType !== 1) return;
      const tag = n.tagName.toLowerCase();

      if (/^h[1-6]$/.test(tag)) {
        const level = Math.min(6, parseInt(tag[1], 10) + ctx.hShift);
        const text = inline(n, ctx).trim();
        if (text) out += indent + '#'.repeat(level) + ' ' + text + '\n\n';
        return;
      }
      if (tag === 'ul' || tag === 'ol') return void (out += list(n, ctx, indent));
      if (tag === 'table') return void (out += table(n, ctx, indent));
      if (tag === 'hr') return void (out += indent + '---\n\n');
      if (tag === 'br' || tag === 'script' || tag === 'style') return;
      if (tag === 'pre') {
        out += indent + '```\n' + n.textContent.replace(/\s+$/, '') + '\n' + indent + '```\n\n';
        return;
      }
      if (tag === 'blockquote') {
        const inner = block(n, ctx, '').trim();
        if (inner) out += inner.split('\n').map((l) => indent + '> ' + l).join('\n') + '\n\n';
        return;
      }
      if (hasBlock(n)) {
        out += block(n, ctx, indent);
        return;
      }
      const text = inline(n, ctx).trim();
      if (text) out += indent + text + '\n\n';
    });
    return out;
  }

  function htmlToMarkdown(html, ctx) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    return block(doc.body, ctx, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ---------- document ----------

  // ---------- names ----------

  /* Nobody's name leaves the page. Every person becomes a label that is stable
   * inside one export and meaningless outside it: the same author is "User 2"
   * in the header, under their comments and in every @mention of them, so the
   * thread still reads as a conversation while identifying no one. The mapping
   * is thrown away after each copy - two exports of the same item do not have
   * to agree, which is the point.
   *
   * This is not a setting. A pseudonymisation switch that can be off is a
   * switch that will be off on the day it matters, so there is no toggle and
   * no unmasked path through this file.
   *
   * The Azure DevOps identity guid is deliberately NOT used as the label: it
   * points straight back at a real person in the same tenant, so it is still
   * personal data. It only serves as the grouping key, and never reaches the
   * clipboard.
   *
   * Clock times go too - in a team of eight, "commented at 14:03" narrows the
   * author down as well as a name does. Dates survive, so the order and the
   * pace of the thread are still readable. */
  const anon = { seq: 0, map: new Map() };

  function anonReset() {
    anon.seq = 0;
    anon.map = new Map();
  }

  function pseudonym(key) {
    const k = String(key || 'unknown').trim().toLowerCase();
    if (!anon.map.has(k)) anon.map.set(k, 'User ' + ++anon.seq);
    return anon.map.get(k);
  }

  function person(value) {
    if (!value) return '';
    if (typeof value === 'string') {
      // Older APIs hand back "Display Name <mail@example.com>".
      return pseudonym((value.match(/<([^>]+)>/) || [null, value])[1]);
    }
    return pseudonym(
      value.id || value.descriptor || value.uniqueName || value.displayName || 'unknown'
    );
  }

  // Mail addresses can sit in plain text anywhere - comment bodies, tables,
  // pasted signatures - so they are swept up after the Markdown is built.
  function scrubMail(text) {
    return text.replace(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/g, (m) => pseudonym(m));
  }

  function date(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d)) return String(value);
    const pad = (n) => String(n).padStart(2, '0');
    // Date only. The time of day is an identifier in a small team.
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function friendly(fieldName) {
    const short = fieldName.split('.').pop();
    return short.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  }

  function label(type, id) {
    return (type ? String(type).toUpperCase() + ' ' : '#') + id;
  }

  function build(item, comments, ctx) {
    const f = item.fields || {};
    const id = item.id;
    const lines = [];
    const stats = { sections: 0, comments: 0 };

    const type = f['System.WorkItemType'];
    // As the form's own header writes it: "FEATURE 1234".
    lines.push('# ' + label(type, id) + ' - ' + (f['System.Title'] || 'Work item'));
    lines.push('');

    const used = {};
    SECTIONS.forEach(([key, label]) => {
      used[key] = true;
      const md = htmlToMarkdown(f[key], ctx);
      if (!md) return;
      stats.sections++;
      lines.push('## ' + label, '', md, '');
    });

    // Custom HTML fields (Custom.*, process-specific fields) come last.
    Object.keys(f).forEach((key) => {
      if (used[key]) return;
      const v = f[key];
      if (typeof v !== 'string' || !HTML_RE.test(v)) return;
      const md = htmlToMarkdown(v, ctx);
      if (!md) return;
      stats.sections++;
      lines.push('## ' + friendly(key), '', md, '');
    });

    if (comments.length) {
      lines.push('## Comments (' + comments.length + ')', '');
      comments
        .slice()
        .sort((a, b) => new Date(a.createdDate) - new Date(b.createdDate))
        .forEach((c, i) => {
          stats.comments++;
          lines.push('### ' + (i + 1) + '. ' + person(c.createdBy) + ', ' + date(c.createdDate));
          lines.push('');
          lines.push(htmlToMarkdown(c.text, ctx) || '_(empty)_');
          lines.push('');
        });
    }

    if (ctx.images.length) {
      lines.push('## Images', '');
      lines.push('Image files are not part of this text. Download them from DynaBoost and attach them; the file names match the placeholders above.', '');
      ctx.images.forEach((img) => {
        lines.push('- ' + img.name + (img.alt ? ' - ' + img.alt : ''));
      });
      lines.push('');
    }

    return { markdown: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n', stats: stats };
  }

  // ---------- images ----------

  async function loadImage(img) {
    if (img.blob) return img;
    const res = await fetch(img.url, { credentials: 'include' });
    if (!res.ok) throw new Error('Could not download ' + img.name);
    img.blob = await res.blob();
    return img;
  }

  function toDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('read failed'));
      r.readAsDataURL(blob);
    });
  }

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function withFileNames(markdown, images) {
    let out = markdown;
    images.forEach((img) => {
      out = out.split('@@IMG' + img.index + '@@').join(img.name);
    });
    return out;
  }

  async function withDataUrls(markdown, images) {
    let out = markdown;
    for (const img of images) {
      try {
        await loadImage(img);
        const data = await toDataUrl(img.blob);
        out = out.split('@@IMG' + img.index + '@@').join(data);
      } catch (e) {
        out = out.split('@@IMG' + img.index + '@@').join(img.name);
      }
    }
    return out;
  }

  // ---------- clipboard ----------

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e2) {
        return false;
      }
    }
  }

  // ---------- toast ----------

  let toastRoot = null;

  function toastLayer() {
    if (toastRoot && document.body.contains(toastRoot)) return toastRoot;
    toastRoot = document.createElement('div');
    toastRoot.id = 'dynaboost-toast';
    document.body.appendChild(toastRoot);
    return toastRoot;
  }

  function toast(options) {
    const layer = toastLayer();
    const card = document.createElement('div');
    card.className = 'db-toast' + (options.tone === 'error' ? ' db-toast-error' : '');

    const row = document.createElement('div');
    row.className = 'db-toast-row';

    const mark = document.createElement('span');
    mark.className = 'db-toast-mark';
    mark.textContent = options.tone === 'error' ? '!' : options.tone === 'busy' ? '\u2026' : '\u2713';

    const text = document.createElement('div');
    text.className = 'db-toast-text';
    const title = document.createElement('div');
    title.className = 'db-toast-title';
    title.textContent = options.title || '';
    text.appendChild(title);
    const sub = document.createElement('div');
    sub.className = 'db-toast-sub';
    text.appendChild(sub);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'db-toast-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '\u2715';
    close.addEventListener('click', () => card.remove());

    row.append(mark, text, close);
    card.appendChild(row);

    const actions = document.createElement('div');
    actions.className = 'db-toast-actions';
    card.appendChild(actions);
    layer.appendChild(card);

    let timer = null;
    const api = {
      set(opts) {
        if (opts.title != null) title.textContent = opts.title;
        if (opts.sub != null) sub.textContent = opts.sub;
        if (opts.tone) {
          card.classList.toggle('db-toast-error', opts.tone === 'error');
          mark.textContent = opts.tone === 'error' ? '!' : opts.tone === 'busy' ? '\u2026' : '\u2713';
        }
        if (opts.actions) {
          actions.textContent = '';
          opts.actions.forEach((a) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = a.label;
            b.addEventListener('click', () => a.onClick(api, b));
            actions.appendChild(b);
          });
        }
        if (opts.hold) {
          clearTimeout(timer);
        } else if (opts.timeout) {
          api.dismissIn(opts.timeout);
        }
        return api;
      },
      dismissIn(ms) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          card.classList.add('db-toast-out');
          setTimeout(() => card.remove(), 200);
        }, ms);
        return api;
      },
      close() {
        card.remove();
      }
    };

    api.set(options);
    return api;
  }

  // ---------- run ----------

  let running = false;

  async function run() {
    if (running) return;
    const id = workItemId();
    if (!id) {
      toast({
        tone: 'error',
        title: 'No work item open',
        sub: 'Open an item (or its dialog on the board) and click again.',
        timeout: 6000
      });
      return;
    }

    running = true;
    const t = toast({ tone: 'busy', title: 'Reading #' + id, sub: 'Fetching fields and comments', hold: true });

    try {
      const item = await fetchItem(id);
      const project = (item.fields || {})['System.TeamProject'];
      const comments = await fetchComments(project, id);

      const ctx = newContext();
      anonReset();
      const built = build(item, comments, ctx);
      const name = label((item.fields || {})['System.WorkItemType'], id);
      built.markdown = scrubMail(built.markdown);
      const plain = withFileNames(built.markdown, ctx.images);
      const ok = await copy(plain);

      const bits = [];
      bits.push(built.stats.sections + (built.stats.sections === 1 ? ' section' : ' sections'));
      bits.push(built.stats.comments + (built.stats.comments === 1 ? ' comment' : ' comments'));
      if (ctx.images.length) bits.push(ctx.images.length + (ctx.images.length === 1 ? ' image' : ' images'));
      bits.push('names removed');

      if (!ok) {
        t.set({
          tone: 'error',
          title: 'Clipboard blocked',
          sub: 'Chrome refused the copy. Try again with the tab focused.',
          hold: true,
          actions: [
            {
              label: 'Copy again',
              onClick: async (self) => {
                const second = await copy(plain);
                self.set({
                  tone: second ? 'ok' : 'error',
                  title: second ? 'Copied ' + name : 'Still blocked',
                  sub: second ? bits.join(', ') : 'Click inside the page first, then retry.'
                });
                if (second) self.dismissIn(4000);
              }
            }
          ]
        });
        return;
      }

      const actions = [];
      if (ctx.images.length) {
        actions.push({
          label: 'Download images',
          onClick: async (self, button) => {
            button.disabled = true;
            let done = 0;
            for (const img of ctx.images) {
              try {
                await loadImage(img);
                saveBlob(img.blob, img.name);
                done++;
              } catch (e) {
                /* keep going */
              }
            }
            self.set({ sub: done + ' of ' + ctx.images.length + ' images saved' });
            button.disabled = false;
          }
        });
        actions.push({
          label: 'Copy with images',
          onClick: async (self, button) => {
            button.disabled = true;
            self.set({ sub: 'Embedding images...' });
            const fat = await withDataUrls(built.markdown, ctx.images);
            const done = await copy(fat);
            self.set({
              tone: done ? 'ok' : 'error',
              sub: done
                ? 'Copied with images inline, ' + Math.round(fat.length / 1024) + ' KB'
                : 'Clipboard refused it, probably too large.'
            });
            button.disabled = false;
          }
        });
      }

      t.set({
        tone: 'ok',
        title: 'Copied ' + name,
        sub: bits.join(', '),
        actions: actions,
        hold: !!actions.length
      });
      if (!actions.length) t.dismissIn(4000);
      else t.dismissIn(15000);
    } catch (e) {
      t.set({ tone: 'error', title: 'Could not read #' + id, sub: e.message, hold: true });
      t.dismissIn(9000);
    } finally {
      running = false;
    }
  }

  DynaBoost.register({
    id: 'ado-workitem',
    name: 'Copy work item',
    group: 'Azure DevOps',
    hosts: ['dev.azure.com', 'visualstudio.com'],
    when: () => !!workItemId() || /\/_(workitems|boards|backlogs|queries|sprints)\b/i.test(location.pathname),
    type: 'action',
    hint: 'Copies the open work item as Markdown, content only: the title, every description section and the whole comment thread. People are always replaced by User 1, User 2 ...',
    icon: ICON,
    onRun: run
  });
})();
