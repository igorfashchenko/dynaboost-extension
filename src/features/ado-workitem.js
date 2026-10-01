/* Feature: Copy work item (Azure DevOps).
 *
 * Reads the work item through the REST API - the form renders its sections
 * lazily - and copies it as Markdown: the title, every HTML field and the
 * comments. Tracking fields (state, dates, area, iteration, links) are left
 * out.
 *
 * Images never go into the text: each becomes a numbered placeholder
 * (image-1.png ...) and "Download images" saves the files under those names.
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
    // Only sources that name this dialog's own item: a description links to
    // other items too (_workitems/edit/), so the first link is not a safe guess.

    // 1. The dialog's focus heading: aria-label="Feature 1234 ..." - the type,
    //    then the id.
    for (const el of [root.querySelector('.bolt-dialog-focus-element[role="heading"][aria-label]') || root.querySelector('[role="heading"][aria-label]'), root]) {
      const m = ((el && el.getAttribute('aria-label')) || '').match(/^[^\d]*?(\d{2,})\b/);
      if (m) return m[1];
    }
    // 2. The header link whose whole text is "TYPE ID", e.g. "FEATURE 1234"
    //    (a mention reads "1234 Title ..." and does not match).
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
    // 7.1 also says which fields are written in Markdown; older servers stop at 7.0.
    try {
      return await api(base() + '/_apis/wit/workitems/' + id + '?api-version=7.1');
    } catch (e) {
      return api(base() + '/_apis/wit/workitems/' + id + '?api-version=7.0');
    }
  }

  async function fetchComments(project, id) {
    const p = encodeURIComponent(project || '');
    const versions = ['7.1-preview.4', '7.0-preview.3', '6.0-preview.3', '5.1-preview.3'];
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
    let ext = '';
    const data = url.match(/^data:image\/([\w.+-]+)/i);
    if (data) {
      ext = '.' + data[1].toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    } else {
      try {
        ext = ((new URL(url).searchParams.get('fileName') || '').match(/\.\w+$/) || [''])[0].toLowerCase();
      } catch (e) {
        ext = '';
      }
    }
    if (!/^\.(png|jpe?g|gif|bmp|webp|svg)$/.test(ext)) ext = '.png';
    return 'image-' + index + ext;
  }

  // An image as a numbered placeholder; pasted images (data: URIs) too, so no
  // base64 ends up in the text.
  function imageRef(src, alt, ctx) {
    if (!src) return '';
    let abs;
    try {
      abs = new URL(src, location.href).href;
    } catch (e) {
      return '';
    }
    let rec = ctx.images.filter((i) => i.url === abs)[0];
    if (!rec) {
      const index = ctx.images.length + 1;
      // The editor names every pasted picture "image" or "image.png".
      const text = String(alt || '').replace(/[[\]]/g, '').trim();
      rec = { url: abs, index: index, name: fileName(abs, index), alt: /^image(\.\w+)?$/i.test(text) ? '' : text };
      ctx.images.push(rec);
    }
    return '![Image ' + rec.index + (rec.alt ? ' - ' + rec.alt : '') + '](@@IMG' + rec.index + '@@)';
  }

  function image(node, ctx) {
    return imageRef(node.getAttribute('src') || '', node.getAttribute('alt'), ctx);
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
        const key = guid || raw.replace(/^@/, '');
        known(raw, key);
        return void (out += '@' + pseudonym(key));
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

  // ---------- Markdown fields and comments ----------

  const MENTION_ID = /@<([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi;
  const MD_IMAGE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
  const HTML_IMAGE = /<img\b[^>]*>/gi;

  // Written with the Markdown editor: the format when the API names it, else
  // text with no HTML in it.
  function isMarkdown(value, format) {
    if (format) return /markdown/i.test(String(format));
    return !HTML_RE.test(value) && !/&(amp|lt|gt|quot|nbsp|#\d+);/.test(value);
  }

  // Markdown stays as written; mentions (@<id>), images and heading levels are
  // brought in line with the HTML fields.
  function markdownText(text, ctx) {
    let fence = false;
    return String(text)
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => {
        if (/^\s*(```|~~~)/.test(line)) {
          fence = !fence;
          return line;
        }
        if (fence) return line;
        return line
          .replace(/^(#{1,6})(?=\s)/, (h) => '#'.repeat(Math.min(6, h.length + ctx.hShift)))
          .replace(MD_IMAGE, (m, alt, src) => imageRef(src, alt, ctx))
          .replace(HTML_IMAGE, (tag) => {
            const attr = (name) => (tag.match(new RegExp(name + '\\s*=\\s*["\']([^"\']*)["\']', 'i')) || [])[1] || '';
            return imageRef(attr('src'), attr('alt'), ctx);
          })
          .replace(MENTION_ID, (m, id) => '@' + pseudonym(id));
      })
      .join('\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function toMarkdown(value, format, ctx) {
    if (!value) return '';
    const text = String(value);
    return isMarkdown(text, format) ? markdownText(text, ctx) : htmlToMarkdown(text, ctx);
  }

  // ---------- document ----------

  // ---------- names ----------

  /* Nobody's name leaves the page: every person becomes "User 1", "User 2"...,
   * the same label in the header, under their comments and in @mentions, so
   * the thread still reads as a conversation. The mapping lives for one copy.
   * The identity guid is only the grouping key and never reaches the
   * clipboard; times of day are dropped, dates stay. There is no switch. */
  // people: display names met on the way, swept from the plain text at the
  // end; alias: a person's mail address -> their key.
  const anon = { seq: 0, map: new Map(), people: [], alias: new Map() };

  function anonReset() {
    anon.seq = 0;
    anon.map = new Map();
    anon.people = [];
    anon.alias = new Map();
  }

  const keyOf = (key) => {
    const k = String(key || 'unknown').trim().toLowerCase();
    return anon.alias.get(k) || k;
  };

  function pseudonym(key) {
    const k = keyOf(key);
    if (!anon.map.has(k)) anon.map.set(k, 'User ' + ++anon.seq);
    return anon.map.get(k);
  }

  function known(name, key) {
    const n = String(name || '').replace(/^@/, '').replace(/\s+/g, ' ').trim();
    // "User ..." would match the labels given out here.
    if (n.length >= 3 && n.indexOf('@') === -1 && !/^user\b/i.test(n)) anon.people.push({ name: n, key: keyOf(key) });
  }

  function identity(value) {
    if (!value) return null;
    if (typeof value === 'string') {
      // Older APIs hand back "Display Name <mail@example.com>".
      const m = value.match(/^(.*?)\s*<([^<>]+)>\s*$/);
      return m ? { key: m[2], name: m[1] } : { key: value, name: value };
    }
    const key = value.id || value.descriptor || value.uniqueName || value.displayName || 'unknown';
    if (/@/.test(value.uniqueName || '') && value.uniqueName !== key) anon.alias.set(value.uniqueName.toLowerCase(), keyOf(key));
    return { key: key, name: value.displayName };
  }

  function person(value) {
    const who = identity(value);
    if (!who) return '';
    known(who.name, who.key);
    return pseudonym(who.key);
  }

  // The people in the item's own fields (created by, assigned to ...): their
  // names can turn up in the text without a mention.
  function knowFields(fields) {
    Object.keys(fields).forEach((key) => {
      const v = fields[key];
      const who = v && typeof v === 'object' && v.displayName ? identity(v) : typeof v === 'string' && /^[^<>@]+<[^<>\s]+@[^<>\s]+>$/.test(v) ? identity(v) : null;
      if (who) known(who.name, who.key);
    });
  }

  // Mail addresses can sit in plain text anywhere - comment bodies, tables,
  // pasted signatures - so they are swept up after the Markdown is built.
  function scrubMail(text) {
    return text.replace(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/g, (m) => pseudonym(m));
  }

  /* Names written as plain text ("as agreed with Jane Doe", a signature) are
   * swept too, for every person met above: the full name in any case, and
   * the first or last name alone, capitalised, when only one person has it. */
  function scrubNames(text) {
    const full = new Map();
    const parts = new Map();
    anon.people.forEach((p) => {
      full.set(p.name.toLowerCase(), p.key);
      const core = p.name.replace(/\s*[([].*$/, '').trim();
      if (core.length >= 3) full.set(core.toLowerCase(), p.key);
      const words = core.split(/[\s,]+/).filter(Boolean);
      // Only what reads as a person's name - not "Build Service (org)".
      if (words.length < 2 || words.length > 3 || !words.every((w) => /^\p{Lu}[\p{L}'\u2019-]+$/u.test(w))) return;
      words.forEach((w) => {
        if (w.length < 3) return;
        parts.set(w, parts.has(w) && parts.get(w) !== p.key ? null : p.key);
      });
    });
    const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const swap = (map, flags) => {
      Array.from(map.keys())
        .sort((a, b) => b.length - a.length)
        .forEach((name) => {
          const key = map.get(name);
          if (key == null) return;
          const re = new RegExp('(?<![\\p{L}\\p{N}_])' + esc(name) + '(?![\\p{L}\\p{N}_])', flags);
          text = text.replace(re, () => pseudonym(key));
        });
    };
    swap(full, 'giu');
    swap(parts, 'gu');
    // An id-only mention left in text that came as HTML.
    return text.replace(MENTION_ID, (m, id) => '@' + pseudonym(id));
  }

  function date(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d)) return String(value);
    const pad = (n) => String(n).padStart(2, '0');
    // Date only - the time of day can identify the author.
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
    const format = (key) => (item.multilineFieldsFormat || {})[key] || '';
    knowFields(f);
    // As the form's own header writes it: "FEATURE 1234".
    lines.push('# ' + label(type, id) + ' - ' + (f['System.Title'] || 'Work item'));
    lines.push('');

    const used = {};
    SECTIONS.forEach(([key, label]) => {
      used[key] = true;
      const md = toMarkdown(f[key], format(key), ctx);
      if (!md) return;
      stats.sections++;
      lines.push('## ' + label, '', md, '');
    });

    // Custom HTML fields (Custom.*, process-specific fields) come last.
    Object.keys(f).forEach((key) => {
      if (used[key]) return;
      const v = f[key];
      if (typeof v !== 'string' || !(HTML_RE.test(v) || /markdown/i.test(format(key)))) return;
      const md = toMarkdown(v, format(key), ctx);
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
          lines.push(toMarkdown(c.text, c.format, ctx) || '_(empty)_');
          lines.push('');
        });
    }

    if (ctx.images.length) {
      lines.push('## Images', '');
      lines.push('Image files are not part of this text. Save them with "Download images" in DynaBoost and attach them; the file names match the placeholders above.', '');
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
    // A sign-in page instead of the picture is not an image either.
    if (!res.ok || /text\/html/i.test(res.headers.get('content-type') || '')) throw new Error('Could not download ' + img.name);
    img.blob = await res.blob();
    return img;
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

  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // A ZIP with the files stored as they are - pictures are compressed already.
  async function zip(files) {
    const enc = new TextEncoder();
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const day = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const body = [];
    const dir = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = new Uint8Array(await f.blob.arrayBuffer());
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // names in UTF-8
      local.setUint16(10, time, true);
      local.setUint16(12, day, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      body.push(local, name, data);
      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(12, time, true);
      entry.setUint16(14, day, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, data.length, true);
      entry.setUint32(24, data.length, true);
      entry.setUint16(28, name.length, true);
      entry.setUint32(42, offset, true);
      dir.push(entry, name);
      offset += 30 + name.length + data.length;
    }
    const size = dir.reduce((n, part) => n + part.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, size, true);
    end.setUint32(16, offset, true);
    return new Blob(body.concat(dir, [end]), { type: 'application/zip' });
  }

  /* Chrome lets a page start one download by itself and holds the next ones
   * behind a "download multiple files" prompt, so one click saves one file:
   * the image itself, or a ZIP when there are more. */
  async function saveImages(images, base) {
    const ready = [];
    for (const img of images) {
      try {
        ready.push(await loadImage(img));
      } catch (e) {
        /* counted by the caller */
      }
    }
    if (!ready.length) return { saved: 0, file: '' };
    if (ready.length === 1) {
      saveBlob(ready[0].blob, ready[0].name);
      return { saved: 1, file: ready[0].name };
    }
    const file = base.replace(/[^\w-]+/g, '-') + '-images.zip';
    saveBlob(await zip(ready), file);
    return { saved: ready.length, file: file };
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

  function toast(options) {
    const layer = DynaBoost.toastLayer();
    const card = document.createElement('div');
    card.className = 'db-toast' + (options.tone === 'error' ? ' db-toast-error' : '');

    const row = document.createElement('div');
    row.className = 'db-toast-row';

    const mark = document.createElement('span');
    mark.className = 'db-toast-mark';
    mark.textContent = options.tone === 'error' ? '!' : options.tone === 'busy' ? '\u2026' : options.tone === 'info' ? 'i' : '\u2713';

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
    close.addEventListener('click', () => api.dismissIn(0));

    row.append(mark, text, close);
    card.appendChild(row);

    const actions = document.createElement('div');
    actions.className = 'db-toast-actions';
    card.appendChild(actions);
    layer.appendChild(card);

    // The card waits while the pointer is on it, except when it is closing
    // after a button has done its job.
    let timer = null;
    let due = 0;
    let paused = 0;
    let closing = false;
    card.addEventListener('mouseenter', () => {
      if (!timer || closing) return;
      clearTimeout(timer);
      timer = null;
      paused = Math.max(due - Date.now(), 2500);
    });
    card.addEventListener('mouseleave', () => {
      if (paused && !closing) api.dismissIn(paused);
      paused = 0;
    });

    const api = {
      set(opts) {
        if (opts.title != null) title.textContent = opts.title;
        if (opts.sub != null) sub.textContent = opts.sub;
        if (opts.tone) {
          card.classList.toggle('db-toast-error', opts.tone === 'error');
          mark.textContent = opts.tone === 'error' ? '!' : opts.tone === 'busy' ? '\u2026' : opts.tone === 'info' ? 'i' : '\u2713';
        }
        if (opts.actions) {
          actions.textContent = '';
          opts.actions.forEach((a) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = a.label;
            b.addEventListener('click', () => a.onClick(api, b, actions));
            actions.appendChild(b);
          });
        }
        if (opts.hold) {
          clearTimeout(timer);
          timer = null;
          paused = 0;
        } else if (opts.timeout) {
          api.dismissIn(opts.timeout);
        }
        return api;
      },
      dismissIn(ms) {
        clearTimeout(timer);
        due = Date.now() + ms;
        timer = setTimeout(() => {
          card.classList.add('db-toast-out');
          setTimeout(() => card.remove(), 200);
        }, ms);
        return api;
      },
      // A button did its job: it says so, and the card goes shortly after.
      done(button, label, ms) {
        card.querySelectorAll('.db-toast-actions button').forEach((b) => (b.disabled = true));
        button.textContent = '\u2713 ' + label;
        button.classList.add('db-toast-done');
        closing = true;
        paused = 0;
        return api.dismissIn(ms);
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

  /* From the panel (ui): its tile pulses while the item is read, then one
   * answer folds down under the list. Without images the text is
   * copied at once; with images nothing is copied until a button says how -
   * the text without them, or the image files. What went wrong goes to the
   * bottom of the page; the panel stays open. */
  async function run(ui) {
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
    if (ui) ui.busy(true);
    // Outside the panel there is no tile to pulse: a toast says it reads.
    const reading = ui ? null : toast({ tone: 'busy', title: 'Reading #' + id, sub: 'Fetching fields and comments', hold: true });
    const answer = (opts) => (ui ? ui.card(opts) : reading.set(opts));

    try {
      const item = await fetchItem(id);
      const project = (item.fields || {})['System.TeamProject'];
      const comments = await fetchComments(project, id);

      const ctx = newContext();
      anonReset();
      const built = build(item, comments, ctx);
      const name = label((item.fields || {})['System.WorkItemType'], id);
      built.markdown = scrubNames(scrubMail(built.markdown));
      const plain = withFileNames(built.markdown, ctx.images);
      const total = ctx.images.length;

      const bits = [];
      bits.push(built.stats.sections + (built.stats.sections === 1 ? ' section' : ' sections'));
      bits.push(built.stats.comments + (built.stats.comments === 1 ? ' comment' : ' comments'));
      bits.push('names removed');

      const copyText = {
        label: 'Copy without images',
        onClick: async (self, button) => {
          if (await copy(plain)) {
            self.set({ tone: 'ok', title: 'Copied ' + name, sub: total ? 'The text is on the clipboard, images as placeholders' : bits.join(', ') }).done(button, 'Copied', 1000);
          } else {
            self.set({ tone: 'error', sub: 'Clipboard blocked. Click inside the page first, then retry.', hold: true }).dismissIn(9000);
          }
        }
      };

      if (!total) {
        if (await copy(plain)) {
          // Nothing to click: it only says what was copied.
          answer({ tone: 'ok', title: 'Copied ' + name, sub: bits.join(', '), hold: true }).dismissIn(2000);
        } else {
          answer({
            tone: 'error',
            title: 'Clipboard blocked',
            sub: 'Chrome refused the copy. Try again with the tab focused.',
            hold: true,
            actions: [Object.assign({}, copyText, { label: 'Copy again' })]
          });
        }
        return;
      }

      // Images: nothing is copied yet - the buttons say how.
      answer({
        tone: 'info',
        title: name + ' has ' + total + (total === 1 ? ' image' : ' images'),
        sub: bits.join(', '),
        hold: true,
        actions: [
          copyText,
          {
            label: total === 1 ? 'Download image' : 'Download ' + total + ' images',
            onClick: async (self, button) => {
              const label = button.textContent;
              button.disabled = true;
              button.textContent = 'Saving…';
              self.set({ tone: 'busy', sub: total === 1 ? 'Reading the image...' : 'Reading ' + total + ' images...', hold: true });
              const r = await saveImages(ctx.images, name);
              const missed = total - r.saved;
              if (!r.saved) {
                button.disabled = false;
                button.textContent = label;
                self.set({ tone: 'error', sub: 'Could not read the images. Reload the page and try again.' }).dismissIn(9000);
                return;
              }
              self.set({
                tone: 'ok',
                sub: (r.saved === 1 ? 'Saved ' : r.saved + ' images saved in ') + r.file + (missed ? ' - ' + missed + ' could not be read' : '')
              }).done(button, 'Saved', missed ? 4000 : 1500);
            }
          }
        ]
      }).dismissIn(6000); // the question waits 6 s (longer while the pointer is on it)
    } catch (e) {
      (reading || toast({ tone: 'error' })).set({ tone: 'error', title: 'Could not read #' + id, sub: e.message, hold: true }).dismissIn(9000);
    } finally {
      running = false;
      if (ui) ui.busy(false);
    }
  }

  DynaBoost.register({
    id: 'ado-workitem',
    name: 'Copy work item',
    group: 'Azure DevOps',
    hosts: ['dev.azure.com', 'visualstudio.com'],
    when: () => !!workItemId() || /\/_(workitems|boards|backlogs|queries|sprints)\b/i.test(location.pathname),
    type: 'action',
    panelResult: true,
    hint: 'Copy the work item as Markdown, names replaced',
    icon: ICON,
    onRun: run
  });
})();
