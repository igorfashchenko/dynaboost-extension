/* Feature: Copy wiki tree (Azure DevOps). The whole tree of the wiki you
 * are in - every page, the folded ones too, titles only, no content - read
 * at once through the wiki's REST API (pages, recursionLevel=full) with the
 * page's own sign-in, and put on the clipboard as a Markdown outline: context
 * for work on the documentation, with no tab to open. A card in the panel
 * then offers the paths (one a line), a Markdown text file with every page
 * a link, and the tree in a tab - folded and opened there, found by name.
 *
 * The wiki is the one in the address (/_wiki/wikis/{wiki}/...); on the
 * project's /_wiki with none, the project wiki. A code wiki shown at a
 * branch (?version=GB...) is read at that branch. The page you are on is
 * marked in the tree.
 */
(function () {
  if (DynaBoost.off) return;
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="3" y="3" width="8" height="5" rx="1.3" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M7 8v10.5h6M7 12.5h6" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<rect x="13" y="10.5" width="8" height="4" rx="1.2" stroke="#E3B04B" stroke-width="1.6"/>' +
    '<rect x="13" y="16.5" width="8" height="4" rx="1.2" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '</svg>';
  const CHEVRON = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="m5 6 3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 13 4 4L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ---------- where are we ----------

  // dev.azure.com/{org}/... -> https://dev.azure.com/{org}; {org}.visualstudio.com -> its origin
  function origin() {
    if (/\.visualstudio\.com$/i.test(location.hostname)) return location.origin;
    const first = location.pathname.split('/').filter(Boolean)[0];
    return first ? location.origin + '/' + first : location.origin;
  }

  function here() {
    const parts = location.pathname.split('/').filter(Boolean).map((p) => {
      try {
        return decodeURIComponent(p);
      } catch (e) {
        return p;
      }
    });
    const at = parts.findIndex((p) => p.toLowerCase() === '_wiki');
    if (at < 1) return null;
    const q = new URLSearchParams(location.search);
    const wiki = (parts[at + 1] || '').toLowerCase() === 'wikis' && parts[at + 2] ? parts[at + 2] : null;
    const version = q.get('version') || '';
    return {
      project: parts[at - 1],
      wiki: wiki,
      pageId: wiki && /^\d+$/.test(parts[at + 3] || '') ? Number(parts[at + 3]) : null,
      pagePath: q.get('pagePath') || null,
      branch: /^GB./.test(version) ? version.slice(2) : null
    };
  }

  // ---------- REST ----------

  async function api(url) {
    const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || type.indexOf('json') === -1) {
      let why = '';
      try {
        why = ((await res.json()) || {}).message || '';
      } catch (e) {
        /* not JSON */
      }
      throw Object.assign(new Error(why || 'Azure DevOps answered ' + res.status + '.'), { status: res.status });
    }
    return res.json();
  }

  function explain(e) {
    if (e.status === 401 || e.status === 203) return 'Azure DevOps wants you to sign in again - reload the page and try again.';
    if (e.status === 403) return 'Azure DevOps did not let you read this wiki (403).';
    if (e.status === 404) return 'The wiki was not found (404) - open a page of the wiki and try again. ' + (e.message || '');
    return e.message || String(e);
  }

  async function readTree(w) {
    const base = origin() + '/' + encodeURIComponent(w.project) + '/_apis/wiki/wikis';
    let wiki = w.wiki;
    if (!wiki) {
      const list = ((await api(base + '?api-version=7.1').catch(() => api(base + '?api-version=6.0'))) || {}).value || [];
      const pick = list.find((x) => x.type === 'projectWiki') || list[0];
      if (!pick) throw new Error('This project has no wiki.');
      wiki = pick.name;
    }
    const query =
      'path=%2F&recursionLevel=full&includeContent=false' +
      (w.branch ? '&versionDescriptor.version=' + encodeURIComponent(w.branch) + '&versionDescriptor.versionType=branch' : '');
    const url = base + '/' + encodeURIComponent(wiki) + '/pages?' + query;
    let root;
    try {
      root = await api(url + '&api-version=7.1');
    } catch (e) {
      // An Azure DevOps Server that stops at an older API version.
      if (e.status !== 400) throw e;
      root = await api(url + '&api-version=6.0');
    }
    return { wiki: wiki, root: root };
  }

  /* The pages as the wiki orders them: { title, path, id, url, kids }. */
  function shape(p, wiki, project) {
    const kids = (p.subPages || []).slice();
    if (kids.every((k) => typeof k.order === 'number')) kids.sort((a, b) => a.order - b.order);
    const path = p.path || '/';
    return {
      title: path.split('/').filter(Boolean).pop() || wiki,
      path: path,
      id: typeof p.id === 'number' ? p.id : null,
      url: p.remoteUrl || origin() + '/' + encodeURIComponent(project) + '/_wiki/wikis/' + encodeURIComponent(wiki) + '?pagePath=' + encodeURIComponent(path),
      kids: kids.map((k) => shape(k, wiki, project))
    };
  }

  function measure(node, depth, out) {
    for (const k of node.kids) {
      out.pages++;
      out.depth = Math.max(out.depth, depth);
      measure(k, depth + 1, out);
    }
    return out;
  }

  // ---------- as text ----------

  function outline(top, links) {
    const lines = [];
    const walk = (list, depth) =>
      list.forEach((n) => {
        lines.push('  '.repeat(depth) + '- ' + (links ? '[' + n.title.replace(/([[\]])/g, '\\$1') + '](' + n.url.replace(/\)/g, '%29') + ')' : n.title));
        walk(n.kids, depth + 1);
      });
    walk(top, 0);
    return lines.join('\n');
  }

  function paths(top) {
    const lines = [];
    const walk = (list) =>
      list.forEach((n) => {
        lines.push(n.path);
        walk(n.kids);
      });
    walk(top);
    return lines.join('\n');
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
    '.find{margin-left:auto;display:flex;align-items:center;gap:8px}' +
    '.find input{width:220px;padding:7px 10px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);font:inherit;font-size:13.5px}' +
    '.find input:focus{outline:2px solid var(--dbc-bd-1e6bff);outline-offset:-1px;border-color:var(--dbc-bd-1e6bff)}' +
    '.find span{font-size:12.5px;color:var(--dbc-fg-56637f);white-space:nowrap}' +
    'main{margin:16px 22px 40px;padding:10px 14px 14px;background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px}' +
    '.note{margin:0 0 6px;font-size:12.5px;color:var(--dbc-fg-56637f)}' +
    'ul{list-style:none;margin:0;padding:0}' +
    'li>ul{margin-left:11px;padding-left:12px;border-left:1px solid var(--dbc-bd-dde3f0)}' +
    '.row{display:flex;align-items:center;gap:4px;min-height:26px;padding:0 6px 0 0;border-radius:5px}' +
    '.row:hover{background:var(--dbc-bg-eef2f9)}' +
    '.tg,.sp{flex:none;width:22px;height:22px}' +
    '.tg{display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:4px;background:none;color:var(--dbc-fg-56637f)}' +
    '.tg:hover{background:var(--dbc-bg-dde3f0);color:var(--dbc-fg-10224e)}' +
    '.tg svg{width:12px;height:12px;margin:0;transition:transform .15s}' +
    '.folded>.row .tg svg{transform:rotate(-90deg)}' +
    '.folded>ul{display:none}' +
    '.row a{color:var(--dbc-fg-10224e);text-decoration:none;overflow-wrap:anywhere}' +
    '.row a:hover{color:var(--dbc-fg-1e6bff);text-decoration:underline}' +
    '.has>.row>a{font-weight:600}' +
    '.ct{display:none;margin-left:6px;padding:0 6px;border:1px solid var(--dbc-bd-dde3f0);border-radius:9px;background:var(--dbc-bg-f5f7fc);color:var(--dbc-fg-56637f);font-size:11px;line-height:16px}' +
    '.folded>.row .ct{display:inline-block}' +
    '.here>.row{background:var(--dbc-bg-fdf1d6);box-shadow:inset 3px 0 0 var(--dbc-bd-e3b04b)}' +
    '.here>.row .you{margin-left:8px;color:var(--dbc-fg-7a5410);font-size:11.5px}' +
    '.filtering .miss{display:none}' +
    '.filtering .folded>ul{display:block}' +
    '.filtering .folded>.row .tg svg{transform:none}' +
    '.filtering .folded>.row .ct{display:none}' +
    '.hit>.row a{background:var(--dbc-bg-fdf1d6);box-shadow:0 2px 0 var(--dbc-bd-e3b04b)}' +
    '.empty{padding:10px 4px;color:var(--dbc-fg-56637f)}' +
    '@media (prefers-reduced-motion:reduce){.tg svg{transition:none}}';

  function treeHtml(list, hereKey) {
    return list
      .map((n) => {
        const mine = hereKey(n);
        const count = n.kids.length ? countOf(n) : 0;
        return (
          '<li class="' + (n.kids.length ? 'has' : 'leaf') + (mine ? ' here' : '') + '" data-t="' + esc(n.title.toLowerCase()) + '">' +
          '<div class="row">' +
          (n.kids.length ? '<button type="button" class="tg" aria-expanded="true" title="Fold">' + CHEVRON + '</button>' : '<span class="sp"></span>') +
          '<a href="' + esc(n.url) + '" target="_blank" rel="noopener" title="' + esc(n.path) + '">' + esc(n.title) + '</a>' +
          (count ? '<span class="ct" title="' + count + ' page' + (count > 1 ? 's' : '') + ' inside">' + count + '</span>' : '') +
          (mine ? '<span class="you">you are here</span>' : '') +
          '</div>' +
          (n.kids.length ? '<ul>' + treeHtml(n.kids, hereKey) + '</ul>' : '') +
          '</li>'
        );
      })
      .join('');
  }

  const countOf = (n) => n.kids.reduce((s, k) => s + 1 + countOf(k), 0);

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
        ta.remove();
        return ok;
      } catch (e2) {
        return false;
      }
    }
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

  function download(tab, text, name) {
    const blob = new tab.Blob([text], { type: 'text/markdown' });
    const url = tab.URL.createObjectURL(blob);
    const a = tab.document.createElement('a');
    a.href = url;
    a.download = name;
    tab.document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => tab.URL.revokeObjectURL(url), 1000);
  }

  // From the card's button - the tab opens on the click.
  function openTab(w, wiki, top) {
    const tab = window.open('', '_blank');
    if (!tab) return false;
    show(tab, w, wiki, top);
    return true;
  }

  function show(tab, w, wiki, top) {
    const size = measure({ kids: top }, 1, { pages: 0, depth: 0 });
    const hereKey = (n) => (w.pageId != null && n.id === w.pageId) || (!!w.pagePath && n.path === w.pagePath);
    const name = wiki.replace(/\.wiki$/i, '');
    const title = 'Wiki tree · ' + name;
    const doc = tab.document;
    doc.write(
      // Dark from the start, or the buttons fade over from light as it opens.
      '<!doctype html><html' + (DynaBoost.isDark() ? ' class="db-dark"' : '') + '><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
        '<style>' + CSS + DynaBoost.tabCss + '</style></head><body>' +
        '<header><h1>' + esc(title) + '</h1>' +
        '<div class="crumbs">' + esc(w.project) + ' · ' + esc(wiki) + (w.branch ? ' · branch ' + esc(w.branch) : '') + ' · ' +
        size.pages + ' page' + (size.pages === 1 ? '' : 's') + ', ' + size.depth + ' level' + (size.depth === 1 ? '' : 's') + ' deep · titles only, no content</div>' +
        '<div class="bar">' +
        '<button type="button" class="primary" id="copy-md" title="The tree as a Markdown list of titles">Copy tree</button>' +
        '<button type="button" id="copy-paths" title="One page path a line">Copy paths</button>' +
        '<button type="button" id="dl" title="A Markdown text file: the tree as a list, each page a link">Download Markdown file</button>' +
        '<span class="sep"></span>' +
        '<button type="button" id="fold">Fold all</button>' +
        '<button type="button" id="open">Open all</button>' +
        '<div class="find"><span id="found"></span><input id="q" type="search" placeholder="Find a page" aria-label="Find a page"></div>' +
        '</div></header>' +
        '<main id="tree">' +
        (top.length ? '<ul>' + treeHtml(top, hereKey) + '</ul>' : '<div class="empty">This wiki has no pages yet.</div>') +
        '</main></body></html>'
    );
    doc.close();
    DynaBoost.themeTab(tab);

    const get = (id) => doc.getElementById(id);
    const tree = get('tree');
    const items = () => Array.from(tree.querySelectorAll('li'));
    const setFold = (li, folded) => {
      li.classList.toggle('folded', folded);
      const b = li.querySelector(':scope > .row > .tg');
      if (b) {
        b.setAttribute('aria-expanded', String(!folded));
        b.title = folded ? 'Open' : 'Fold';
      }
    };

    // A chevron folds its branch; Alt+click folds or opens everything under it too.
    tree.addEventListener('click', (e) => {
      const tg = e.target.closest('.tg');
      if (!tg) return;
      const li = tg.closest('li');
      const folded = !li.classList.contains('folded');
      setFold(li, folded);
      if (e.altKey) li.querySelectorAll('li.has').forEach((x) => setFold(x, folded));
    });
    get('fold').addEventListener('click', () => items().filter((li) => li.classList.contains('has')).forEach((li) => setFold(li, true)));
    get('open').addEventListener('click', () => items().forEach((li) => setFold(li, false)));

    const header = '# ' + name + ' - page tree\n\n';
    get('copy-md').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const ok = await copyInto(tab, header + outline(top, false) + '\n');
      flash(btn, ok ? 'Copied' : 'Copy failed', ok);
    });
    get('copy-paths').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const ok = await copyInto(tab, paths(top) + '\n');
      flash(btn, ok ? 'Copied' : 'Copy failed', ok);
    });
    get('dl').addEventListener('click', (e) => {
      download(tab, header + outline(top, true) + '\n', name.replace(/[\\/:*?"<>|]+/g, '-') + ' - page tree.md');
      flash(e.currentTarget, 'Downloaded', true);
    });

    // Find: the pages whose title holds the text, with the branches above
    // them - folded ones open while it is used, folded again after.
    let timer = null;
    get('q').addEventListener('input', (e) => {
      clearTimeout(timer);
      const q = e.target.value.trim().toLowerCase();
      timer = setTimeout(() => {
        tree.classList.toggle('filtering', !!q);
        let hits = 0;
        const walk = (li) => {
          const kids = Array.from(li.querySelectorAll(':scope > ul > li'));
          let shown = false;
          for (const k of kids) if (walk(k)) shown = true;
          const hit = !!q && li.dataset.t.indexOf(q) >= 0;
          if (hit) hits++;
          li.classList.toggle('hit', hit);
          li.classList.toggle('miss', !!q && !hit && !shown);
          return hit || shown;
        };
        Array.from(tree.querySelectorAll(':scope > ul > li')).forEach(walk);
        get('found').textContent = q ? (hits ? hits + ' page' + (hits > 1 ? 's' : '') : 'no page') + ' found' : '';
      }, 120);
    });

    const mine = tree.querySelector('.here');
    if (mine) mine.scrollIntoView({ block: 'center' });
  }

  // ---------- the tool ----------

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
        ta.remove();
        return ok;
      } catch (e2) {
        return false;
      }
    }
  }

  let running = false;

  /* The card behaves as Copy work item's: the answer waits 6 s (longer
   * while the pointer is on it); a button clicked says so - "✓ Copied",
   * the others off - and the card goes 1.5 s later; a failure stays 9 s; a
   * clipboard Chrome refused offers Copy again. */
  async function run(ui) {
    if (running) return;
    const w = here();
    const quiet = { set: () => quiet, done: () => quiet, dismissIn: () => quiet };
    const say = (opts) => {
      if (ui) return ui.card(opts);
      DynaBoost.toast('Copy wiki tree', opts.sub, opts.tone === 'error');
      return quiet;
    };
    if (!w) return say({ tone: 'error', title: 'No wiki here', sub: 'Open the wiki of a project first.', hold: true }).dismissIn(9000);
    running = true;
    if (ui) ui.busy(true);
    try {
      const got = await readTree(w);
      const top = shape(got.root, got.wiki, w.project).kids;
      const name = got.wiki.replace(/\.wiki$/i, '');
      const size = measure({ kids: top }, 1, { pages: 0, depth: 0 });
      if (!size.pages) return say({ tone: 'info', title: name + ' has no pages yet', sub: 'Nothing to copy.', hold: true }).dismissIn(6000);
      const header = '# ' + name + ' - page tree\n\n';
      const what = size.pages + ' page' + (size.pages === 1 ? '' : 's') + ', ' + size.depth + ' level' + (size.depth === 1 ? '' : 's');
      const tree = header + outline(top, false) + '\n';
      const title = 'Copied ' + name + ' tree';
      const blocked = { tone: 'error', title: 'Clipboard blocked', sub: 'Chrome refused the copy. Try again with the tab focused.', hold: true };
      const actions = [
        {
          label: 'Copy paths',
          onClick: async (card, b) => {
            if (await copy(paths(top) + '\n')) card.set({ tone: 'ok', title: 'Copied ' + name + ' paths', sub: what + ' - one page a line' }).done(b, 'Copied', 1500);
            else card.set(blocked).dismissIn(9000);
          }
        },
        {
          label: 'Download',
          onClick: (card, b) => {
            const file = name.replace(/[\\/:*?"<>|]+/g, '-') + ' - page tree.md';
            const url = URL.createObjectURL(new Blob([header + outline(top, true) + '\n'], { type: 'text/markdown' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = file;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            card.set({ tone: 'ok', title: 'Saved ' + name + ' tree', sub: 'A Markdown text file, every page a link: ' + file }).done(b, 'Downloaded', 1500);
          }
        },
        {
          label: 'Open tab',
          onClick: (card, b) => {
            if (openTab(w, got.wiki, top)) card.set({ tone: 'ok', title: 'Opened ' + name + ' tree', sub: 'In a new tab - fold, open and find pages there' }).done(b, 'Opened', 1500);
            else card.set({ tone: 'error', title: 'Tab blocked', sub: 'Allow pop-ups for this site and try again.', hold: true }).dismissIn(9000);
          }
        }
      ];
      if (await copy(tree)) {
        DynaBoost.saved('wiki-tree');
        say({ tone: 'ok', title: title, sub: what + ' - titles as a Markdown list', hold: true, actions: actions }).dismissIn(6000);
      } else {
        // Chrome wants the page in focus: a click on the card's button gives it.
        say(Object.assign({}, blocked, {
          actions: [
            {
              label: 'Copy again',
              onClick: async (card, b) => {
                if (!(await copy(tree))) return;
                DynaBoost.saved('wiki-tree');
                card.set({ tone: 'ok', title: title, sub: what + ' - titles as a Markdown list' }).done(b, 'Copied', 1500);
              }
            }
          ]
        }));
      }
    } catch (e) {
      say({ tone: 'error', title: 'Could not read the wiki tree', sub: explain(e), hold: true }).dismissIn(9000);
    } finally {
      running = false;
      if (ui) ui.busy(false);
    }
  }

  DynaBoost.register({
    id: 'wiki-tree',
    name: 'Copy wiki tree',
    group: 'Azure DevOps',
    hosts: ['dev.azure.com', 'visualstudio.com'],
    when: () => /\/_wiki\b/i.test(location.pathname),
    type: 'action',
    panelResult: true,
    hint: 'The whole wiki tree - every page, titles only - to the clipboard',
    icon: ICON,
    onRun: run
  });
})();
