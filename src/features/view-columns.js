/* Feature: Copy view columns - for makers, in make.powerapps.com only: in a
 * view's designer, or anywhere in a table (its Views, Columns, Forms ...).
 * The columns of one view of a table - which, in which order, how wide -
 * copied to the table's other views, each keeping its own filter: Active
 * Accounts' columns on Inactive Accounts, still the inactive ones. Filters
 * too, when asked: the source's filter on each view, each keeping its own
 * Status condition (one with none takes the source's) and the columns a
 * Quick Find searches. A tab lists the
 * table's system views - public, Quick Find, Lookup, Associated, Advanced
 * Find - each with its filter in words and what the copy would change (+
 * added, − taken away, order, filter); tick the ones to change, Apply. All
 * views shows every column against every view.
 *
 * Apply saves and does not publish - as the designer's Save: Publish in the
 * tab publishes the table, or each view's Designer link opens it to check and
 * publish there. Versions: the views as opened and after each of the last 5
 * Applies, and the backups kept in this browser (before each Apply, the 5
 * newest, 14 days, shown for the same table in the same environment) - a
 * click on one ticks the views it would put back; only Apply writes them.
 * With a solution in the address, the changed views are added to it.
 *
 * A view keeps its columns twice: layoutxml (the grid's cells) and the
 * fetchxml's attributes (what is read). Both are written; the fetchxml's
 * filters (unless asked), its sort (unless asked) and its links that filter
 * stay as they are. A column of a related table brings its link along - an
 * outer one, so that it never takes rows away. The views are read as the
 * designer has them, saved and not yet published
 * (RetrieveUnpublishedMultiple). make.powerapps.com cannot call the
 * environment's Web API: the calls go in batches to a tab of the environment
 * (background.js, DB_ENV_API). A managed view that may not be changed, and a
 * kind of view the designer does not offer, is shown and left alone.
 */
(function () {
  if (DynaBoost.off) return;
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="3" y="4" width="18" height="16" rx="2" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M3 9h18M9 9v11M15 9v11" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M12.5 14.5h7m0 0-2.4-2.4m2.4 2.4-2.4 2.4" stroke="#E3B04B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const clean = (id) => String(id || '').replace(/[{}]/g, '').toLowerCase();
  // Why it was refused, as Dataverse says it - without its own full stop, the sentence has one.
  const why = (e) => String((e && e.message) || 'it refused').replace(/\.+$/, '');

  // The kinds of system view the view designer offers.
  const KINDS = { 0: 'Public', 4: 'Quick Find', 64: 'Lookup', 2: 'Associated', 1: 'Advanced Find' };
  const KIND_ORDER = [0, 4, 64, 2, 1];
  // Others a table may have: shown, never changed.
  const OTHER_KINDS = { 8: 'Reporting', 16: 'Offline filters', 32: 'Appointment book', 128: 'Outlook filters', 256: 'Address book filters', 512: 'Mobile client', 1024: 'Other', 2048: 'Interactive workflow', 4096: 'Offline template', 8192: 'Custom', 16384: 'Export field translations', 65536: 'Outlook template' };

  const MAKER = 'https://make.powerapps.com';
  const DEFAULT_SOLUTION = 'fd140aaf-4df4-11dd-bd17-0019b9312238';
  const BACKUP_KEY = 'dynaboost.viewBackups'; // chrome.storage.local: [{ env, host, table, savedAt, views: [{ id, name, layoutxml, fetchxml }] }]
  const BACKUPS_KEPT = 5;
  const BACKUP_DAYS = 14;
  const APPLIES_KEPT = 5;

  // ---------- where: make.powerapps.com ----------

  /* The environment, the solution, the table and the view in the address:
   * /e/{env}/s/{solution}/entity/{table}/view/{view} (the designer),
   * /environments/{env}/[solutions/{solution}/]entities/{table's MetadataId}/views
   * (a table) - a table by its logical name or its MetadataId; the default
   * environment's id is "Default-{guid}". */
  function here() {
    if (location.hostname !== 'make.powerapps.com') return null;
    const p = location.pathname;
    if (/\/canvas(\/|$)/i.test(p)) return null;
    const m = (re) => (re.exec(p) || [])[1] || '';
    const env = clean(m(/\/(?:environments|e)\/((?:default-)?[0-9a-f-]{36})(?:\/|$)/i));
    const table = m(/\/(?:entity|entities|tables)\/([A-Za-z0-9_-]{1,128})(?:\/|$)/i);
    if (!env || !table || /^(entity|entities|tables)$/i.test(table)) return null;
    if (!GUID.test(table) && !/^[a-z][a-z0-9_]*$/i.test(table)) return null;
    return {
      env: env,
      // For links: the maker writes the default environment "Default-{guid}".
      envUrl: /^default-/.test(env) ? 'Default-' + env.slice(8) : env,
      sol: clean(m(/\/(?:solutions|s)\/([0-9a-f-]{36})(?:\/|$)/i)),
      table: GUID.test(table) ? clean(table) : table.toLowerCase(),
      view: clean(m(/\/view\/([0-9a-f-]{36})(?:\/|$)/i))
    };
  }

  // ---------- the Web API, in a tab of the environment ----------

  /* api(path, opts) as DynaBoost.webApi - the calls made in one go (in the
   * same turn) travel together, one trip to the environment's tab. */
  function connect(host) {
    let queue = [];
    let timer = null;
    const say = (r) =>
      r && r.error === 'signin'
        ? 'Sign in to ' + host + ' - open it in a tab - and try again.'
        : r && r.error === 'unreachable'
        ? host + ' could not be reached.'
        : (r && r.error) || 'No answer from ' + host + '.';
    /* Nothing asked and nothing on its way for a moment: the environment's tab
     * in the background can go (background.js closes it at once; the next call
     * opens one again). */
    let flying = 0;
    let idle = null;
    const rest = () => {
      clearTimeout(idle);
      if (flying || queue.length) return;
      idle = setTimeout(() => !flying && !queue.length && DynaBoost.send({ type: 'DB_ENV_DONE', host: host }).catch(() => {}), 900);
    };
    async function flush() {
      const batch = queue;
      queue = [];
      timer = null;
      let r;
      flying++;
      clearTimeout(idle);
      try {
        r = await DynaBoost.send({ type: 'DB_ENV_API', host: host, calls: batch.map((b) => b.call) });
      } catch (e) {
        r = { error: 'DynaBoost was updated - reload the page this tab was opened from.' };
      }
      flying--;
      // After the answers are handed out: what they start is asked first.
      setTimeout(rest, 0);
      batch.forEach((b, i) => {
        const x = r && !r.error && Array.isArray(r.result) ? r.result[i] : null;
        if (!x) return b.reject(Object.assign(new Error(say(r)), { status: 0 }));
        if (x.error) return b.reject(Object.assign(new Error(x.error), { status: x.status }));
        b.resolve(x.data);
      });
    }
    function api(path, opts) {
      const o = opts || {};
      return new Promise((resolve, reject) => {
        queue.push({ call: { method: o.method || (o.body !== undefined ? 'POST' : 'GET'), path: path, body: o.body, prefer: o.prefer }, resolve: resolve, reject: reject });
        if (queue.length >= 40) {
          clearTimeout(timer);
          flush();
        } else if (!timer) timer = setTimeout(flush, 0);
      });
    }
    return { host: host, api: api, tableMeta: metaReader(api) };
  }

  // ---------- XML ----------

  function parse(xml) {
    const doc = new DOMParser().parseFromString(String(xml || ''), 'text/xml');
    return doc.getElementsByTagName('parsererror').length ? null : doc;
  }
  const xmlText = (doc) => new XMLSerializer().serializeToString(doc.documentElement);
  const kids = (el, tag) => Array.from((el && el.children) || []).filter((c) => c.tagName === tag);
  const mainOf = (fetch) => fetch && fetch.querySelector('fetch > entity');
  const linksIn = (el) => Array.from(el.getElementsByTagName('link-entity'));
  const cellsOf = (layout) => kids(layout && layout.querySelector('grid > row'), 'cell').map((c) => ({ name: c.getAttribute('name') || '', width: Number(c.getAttribute('width')) || 100, el: c }));


  // ---------- reading ----------

  /* The table's labels, and its choices' options for the filters in words;
   * a related table's labels when one of its columns is shown. */
  function metaReader(api) {
    const metaCache = new Map();
    function tableMeta(table) {
      if (metaCache.has(table)) return metaCache.get(table);
      const base = "EntityDefinitions(LogicalName='" + encodeURIComponent(table) + "')";
      // The options of choices, Yes/No, Status and Status Reason - for the filters' values -
      // asked with the table itself: they need nothing of its answer.
      const options = new Map();
      const casts = ['PicklistAttributeMetadata', 'StateAttributeMetadata', 'StatusAttributeMetadata', 'MultiSelectPicklistAttributeMetadata'];
      const reads = casts.map((c) =>
        api(base + '/Attributes/Microsoft.Dynamics.CRM.' + c + '?$select=LogicalName&$expand=OptionSet($select=Options)').then(
          (r) => (r.value || []).forEach((a) => options.set(a.LogicalName, new Map(((a.OptionSet && a.OptionSet.Options) || []).map((o) => [String(o.Value), label(o.Label)])))),
          () => {}
        )
      );
      reads.push(
        api(base + '/Attributes/Microsoft.Dynamics.CRM.BooleanAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=TrueOption,FalseOption)').then(
          (r) => (r.value || []).forEach((a) => a.OptionSet && options.set(a.LogicalName, new Map([['1', label(a.OptionSet.TrueOption && a.OptionSet.TrueOption.Label)], ['0', label(a.OptionSet.FalseOption && a.OptionSet.FalseOption.Label)], ['true', label(a.OptionSet.TrueOption && a.OptionSet.TrueOption.Label)], ['false', label(a.OptionSet.FalseOption && a.OptionSet.FalseOption.Label)]]))),
          () => {}
        )
      );
      const p = Promise.all([api(base + '?$select=LogicalName,DisplayName,PrimaryIdAttribute,MetadataId&$expand=Attributes($select=LogicalName,DisplayName)'), Promise.all(reads)]).then(([d]) => ({
        table: table,
        label: label(d.DisplayName) || table,
        metadataId: clean(d.MetadataId),
        id: d.PrimaryIdAttribute,
        attrs: new Map((d.Attributes || []).map((a) => [a.LogicalName, { label: label(a.DisplayName) || a.LogicalName }])),
        options: options
      }));
      p.catch(() => metaCache.delete(table));
      metaCache.set(table, p);
      return p;
    }
    function label(l) {
      if (!l) return '';
      return (l.UserLocalizedLabel && l.UserLocalizedLabel.Label) || ((l.LocalizedLabels || [])[0] || {}).Label || '';
    }
    return tableMeta;
  }

  /* The table's system views, as the designer has them - saved, published
   * or not. Where that cannot be asked, the published ones (drafts: false). */
  const VIEW_SELECT = '$select=savedqueryid,name,fetchxml,layoutxml,querytype,isdefault,iscustomizable,ismanaged';
  const UNPUBLISHED = 'savedqueries/Microsoft.Dynamics.CRM.RetrieveUnpublishedMultiple()?';
  async function readViews(api, table) {
    const filter = "&$filter=returnedtypecode eq '" + encodeURIComponent(table) + "' and statecode eq 0&$orderby=name asc";
    let r;
    let drafts = true;
    try {
      r = await api(UNPUBLISHED + VIEW_SELECT + filter);
    } catch (e) {
      // Only where the function itself is not there - a refusal, a limit (429) or a
      // server error is shown as it is, never taken for "published only" (which
      // publishes the whole table on every Apply).
      if (![400, 404, 405, 501].includes(e.status)) throw e;
      drafts = false;
      r = await api('savedqueries?' + VIEW_SELECT + filter);
    }
    const views = [];
    for (const v of r.value || []) if (v.layoutxml && v.fetchxml) views.push(viewOf(v));
    views.sort(byPlace);
    return { views: views, drafts: drafts };
  }
  // Those that may not be changed at the end of their group, the other kinds last.
  const byPlace = (a, b) => a.rank - b.rank || b.editable - a.editable || a.name.localeCompare(b.name);
  // One view as it is now - before it is written over.
  async function readView(api, id, drafts) {
    const r = await api((drafts ? UNPUBLISHED : 'savedqueries?') + '$select=layoutxml,fetchxml&$filter=savedqueryid eq ' + clean(id));
    const v = (r.value || [])[0];
    if (!v) throw new Error('the view is no longer there');
    return v;
  }
  function viewOf(v) {
    const known = v.querytype in KINDS;
    const locked = v.iscustomizable && v.iscustomizable.Value === false;
    const editable = known && !locked;
    return {
      id: clean(v.savedqueryid),
      name: v.name || '(no name)',
      kind: known ? KINDS[v.querytype] : OTHER_KINDS[v.querytype] || 'Type ' + v.querytype,
      rank: known ? KIND_ORDER.indexOf(v.querytype) * 2 + (v.isdefault ? 0 : 1) : 90,
      isDefault: !!v.isdefault,
      lookup: v.querytype === 64,
      editable: editable,
      other: !known,
      why: editable ? '' : locked ? 'managed - may not be changed' : 'a kind the view designer does not offer - left alone',
      layoutxml: v.layoutxml,
      fetchxml: v.fetchxml
    };
  }

  // ---------- links ----------

  // The link an alias names, in a fetch.
  const linkByAlias = (fetch, alias) => linksIn(fetch).find((l) => l.getAttribute('alias') === alias) || null;
  const linkKey = (l) => [l.getAttribute('name'), l.getAttribute('from'), l.getAttribute('to')].join('|');

  /* The link in the target that stands for the source's: one of the same
   * alias, or the same table joined the same way under the same parent,
   * else a new outer one - so it shows a column and never takes a row
   * away. Its own filters are not brought along. */
  function ensureLink(sLink, sMain, tMain, tFetch) {
    const parent = sLink.parentElement;
    const tParent = parent === sMain ? tMain : ensureLink(parent, sMain, tMain, tFetch);
    const alias = sLink.getAttribute('alias');
    const same = alias && linkByAlias(tFetch, alias);
    if (same && linkKey(same) === linkKey(sLink)) return same;
    const kin = kids(tParent, 'link-entity').find((l) => linkKey(l) === linkKey(sLink) && !kids(l, 'filter').length && (l.getAttribute('link-type') || 'inner') === 'outer');
    if (kin) {
      if (!kin.getAttribute('alias')) kin.setAttribute('alias', alias || newAlias());
      return kin;
    }
    const link = tFetch.createElement('link-entity');
    for (const a of ['name', 'from', 'to', 'intersect']) if (sLink.getAttribute(a)) link.setAttribute(a, sLink.getAttribute(a));
    link.setAttribute('visible', 'false');
    link.setAttribute('link-type', 'outer');
    link.setAttribute('alias', alias && !linkByAlias(tFetch, alias) ? alias : newAlias());
    tParent.appendChild(link);
    return link;
  }
  function ensureAttr(doc, el, name) {
    if (kids(el, 'attribute').some((a) => a.getAttribute('name') === name)) return;
    const a = doc.createElement('attribute');
    a.setAttribute('name', name);
    const after = kids(el, 'attribute').pop();
    if (after) after.after(a);
    else el.insertBefore(a, el.firstElementChild);
  }

  // ---------- filters too ----------

  // What makes a view itself and stays when the filter is copied: its Status.
  const STATE = ['statecode', 'statuscode'];
  const isQuickFind = (f) => f.getAttribute('isquickfindfields') === '1';
  const typeOf = (l) => (l.getAttribute('link-type') || 'inner').toLowerCase();
  // A link that takes rows away: not an outer one, or one with a filter.
  const filtering = (l) => typeOf(l) !== 'outer' || kids(l, 'filter').length > 0;
  const isState = (c) => !c.getAttribute('entityname') && STATE.includes(c.getAttribute('attribute'));
  const newAlias = () => 'db_' + Math.random().toString(36).slice(2, 8);

  // An "or" of Status only - "Status Reason is Won or Lost", nested groups of Status too: a Status as well, taken whole.
  const allState = (f) => f.children.length > 0 && Array.from(f.children).every((c) => (c.tagName === 'condition' && isState(c)) || (c.tagName === 'filter' && allState(c)));
  const stateGroup = (f) => (f.getAttribute('type') || 'and').toLowerCase() === 'or' && allState(f);
  // The Status a filter holds through "and"s - those a view stands on: its conditions, and such "or" groups.
  function stateOf(f, out) {
    if (stateGroup(f)) return out.push(f), out;
    if ((f.getAttribute('type') || 'and').toLowerCase() !== 'and') return out;
    for (const c of kids(f, 'condition')) if (isState(c)) out.push(c);
    for (const g of kids(f, 'filter')) stateOf(g, out);
    return out;
  }
  const empty = (f) => !Array.from(f.children).some((k) => ['condition', 'filter', 'link-entity'].includes(k.tagName));
  function prune(f) {
    for (const g of kids(f, 'filter')) {
      prune(g);
      if (empty(g)) g.remove();
    }
  }

  // A link that filtered, kept for the columns it shows: an outer one now, its filters gone.
  function unfilter(l) {
    l.setAttribute('link-type', 'outer');
    kids(l, 'filter').forEach((f) => f.remove());
    for (const k of kids(l, 'link-entity')) {
      if (k.getElementsByTagName('attribute').length) unfilter(k);
      else k.remove();
    }
  }

  /* The source's filter on the target: the target keeps its Quick Find
   * columns and the Status it stands on (Inactive stays inactive; "Won or
   * Lost" too, its "or" group whole); its other
   * filters and links that filter go - a link that also shows a column stays
   * as an outer one. The source's filters come with the links they need,
   * under aliases of their own, without their Status: a target with none of
   * its own to keep (none, or one in an "or" with other conditions) takes the
   * source's - put first either way, and a Status group that was a filter of
   * its own stays one, so that a second copy finds nothing to change. The
   * answer: true when the target took the source's Status. */
  function copyFilters(sF, sMain, tF, tMain) {
    const keep = [];
    const alone = new Set(); // a Status group that was a filter of its own: put back as one
    for (const f of kids(tMain, 'filter')) {
      if (isQuickFind(f)) continue;
      stateOf(f, []).forEach((c) => {
        const k = c.cloneNode(true);
        if (c === f) alone.add(k);
        keep.push(k);
      });
      f.remove();
    }
    for (const l of kids(tMain, 'link-entity')) {
      if (!filtering(l)) continue;
      if (l.getElementsByTagName('attribute').length) unfilter(l);
      else l.remove();
    }

    const filters = kids(sMain, 'filter')
      .filter((f) => !isQuickFind(f))
      .map((f) => tF.importNode(f, true));
    const fromSource = !keep.length;
    const whole = new Set(); // a filter that is all Status itself
    for (const f of filters) {
      stateOf(f, []).forEach((c) => {
        if (fromSource) keep.push(c);
        if (c === f) whole.add(f), alone.add(f);
        else c.remove();
      });
      prune(f);
    }
    const kept = filters.filter((f) => !whole.has(f) && !empty(f));

    // The links: those that filter, and those a condition names.
    const named = new Set();
    for (const f of kept) for (const c of f.getElementsByTagName('condition')) if (c.getAttribute('entityname')) named.add(c.getAttribute('entityname'));
    const top = (l) => {
      while (l.parentElement && l.parentElement !== sMain) l = l.parentElement;
      return l.parentElement === sMain && l.tagName === 'link-entity' ? l : null;
    };
    const links = [];
    for (const l of kids(sMain, 'link-entity')) if (filtering(l)) links.push(l);
    for (const a of named) {
      const l = linkByAlias(sF, a);
      const t = l && top(l);
      if (t && !links.includes(t)) links.push(t);
    }
    const clones = links.map((l) => {
      const c = tF.importNode(l, true);
      Array.from(c.getElementsByTagName('attribute')).forEach((a) => a.remove());
      Array.from(c.getElementsByTagName('all-attributes')).forEach((a) => a.remove());
      return c;
    });

    // Aliases the target has already: the copied ones get their own.
    const taken = new Set(linksIn(tF).map((l) => l.getAttribute('alias')).filter(Boolean));
    const renamed = new Map();
    for (const el of clones.concat(kept)) {
      for (const l of [el].concat(linksIn(el))) {
        if (l.tagName !== 'link-entity') continue;
        const a = l.getAttribute('alias');
        if (a && taken.has(a)) {
          const b = newAlias();
          renamed.set(a, b);
          l.setAttribute('alias', b);
        }
        if (l.getAttribute('alias')) taken.add(l.getAttribute('alias'));
      }
    }
    for (const el of clones.concat(kept)) for (const c of el.getElementsByTagName('condition')) if (renamed.has(c.getAttribute('entityname'))) c.setAttribute('entityname', renamed.get(c.getAttribute('entityname')));

    // The target's Status first, then the source's filter.
    const inner = keep.filter((c) => !alone.has(c));
    if (inner.length) {
      const and = kept.find((f) => (f.getAttribute('type') || 'and').toLowerCase() === 'and');
      if (and) inner.reverse().forEach((c) => and.insertBefore(c, and.firstChild));
      else {
        const f = tF.createElement('filter');
        f.setAttribute('type', 'and');
        inner.forEach((c) => f.appendChild(c));
        kept.unshift(f);
      }
    }
    kept.unshift(...keep.filter((c) => alone.has(c)));
    const at = kids(tMain, 'link-entity')[0] || null;
    for (const f of kept) tMain.insertBefore(f, at);
    for (const c of clones) tMain.appendChild(c);
    // A link to many rows the source reads once each (distinct) is read so here too.
    if (clones.length && sF.documentElement.getAttribute('distinct') === 'true') tF.documentElement.setAttribute('distinct', 'true');

    // A link nothing uses any more: no column, no filter, no condition naming it.
    const usedAlias = new Set(Array.from(tF.getElementsByTagName('condition')).map((c) => c.getAttribute('entityname')).filter(Boolean));
    for (const l of kids(tMain, 'link-entity')) if (typeOf(l) === 'outer' && !l.children.length && !usedAlias.has(l.getAttribute('alias'))) l.remove();
    return fromSource && keep.length > 0;
  }

  // ---------- the copy ----------

  /* The target's layout and fetch with the source's columns.
   * opts: { mode: 'same' | 'add', widths: true (the source's) | false,
   *         sort: false | true, filters: false | true }
   * The answer: { layoutxml, fetchxml, skipped, statusFromSource } and what
   * changes (diff) - or { error }. */
  function copyColumns(source, target, opts, primaryId, idOf) {
    const sL = parse(source.layoutxml);
    const sF = parse(source.fetchxml);
    const tL = parse(target.layoutxml);
    const tF = parse(target.fetchxml);
    if (!sL || !sF || !tL || !tF) return { error: 'its XML could not be read' };
    const sMain = mainOf(sF);
    const tMain = mainOf(tF);
    const tRow = tL.querySelector('grid > row');
    if (!sMain || !tMain || !tRow) return { error: 'it has no grid' };

    const statusFromSource = opts.filters ? copyFilters(sF, sMain, tF, tMain) : false;

    const sCells = cellsOf(sL);
    const tCells = cellsOf(tL);
    const before = tCells.map((c) => c.name);
    const tWidth = new Map(tCells.map((c) => [c.name, c.width]));

    // A related column only through links to one row (their from is the
    // joined table's key): through a one-to-many link it would repeat rows.
    const toOne = (l) => {
      for (; l && l !== sMain; l = l.parentElement) if (!idOf || l.getAttribute('from') !== idOf(l.getAttribute('name'))) return false;
      return true;
    };
    const skipped = [];
    // Each source column under its name in the target: a related table's
    // column takes the alias its link has there.
    const nameThere = (c) => {
      const dot = c.name.indexOf('.');
      if (dot < 0) return c.name;
      const sLink = linkByAlias(sF, c.name.slice(0, dot));
      if (!sLink) return null;
      if (!toOne(sLink)) {
        skipped.push(c.name);
        return null;
      }
      const tLink = ensureLink(sLink, sMain, tMain, tF);
      ensureAttr(tF, tLink, c.name.slice(dot + 1));
      return tLink.getAttribute('alias') + '.' + c.name.slice(dot + 1);
    };
    const fromSource = [];
    for (const c of sCells) {
      const n = nameThere(c);
      if (n && !fromSource.some((x) => x.name === n)) fromSource.push({ name: n, width: c.width, el: c.el });
    }
    // A target's own related column whose link is gone with its filter: not shown any more.
    const alive = (c) => c.name.indexOf('.') < 0 || !!linkByAlias(tF, c.name.slice(0, c.name.indexOf('.')));
    const out =
      opts.mode === 'add'
        ? tCells.filter(alive).map((c) => ({ name: c.name, width: c.width, el: c.el })).concat(fromSource.filter((c) => !tWidth.has(c.name)))
        : fromSource.map((c) => ({ name: c.name, width: opts.widths || !tWidth.has(c.name) ? c.width : tWidth.get(c.name), el: c.el }));

    // The grid: the target's own grid and row, the cells anew.
    for (const c of kids(tRow, 'cell')) c.remove();
    for (const c of out) {
      const cell = tL.createElement('cell');
      for (const a of Array.from(c.el.attributes)) cell.setAttribute(a.name, a.value);
      cell.setAttribute('name', c.name);
      cell.setAttribute('width', String(c.width));
      tRow.appendChild(cell);
    }

    // What is read: each shown column; a column no longer shown, no longer
    // read - unless something else needs it (the key, a sort, a filter).
    const keep = new Set([primaryId]);
    for (const o of tMain.getElementsByTagName('order')) keep.add(o.getAttribute('attribute'));
    for (const c of tMain.getElementsByTagName('condition')) if (!c.closest('link-entity')) keep.add(c.getAttribute('attribute'));
    const now = new Set(out.map((c) => c.name));
    for (const c of out) if (c.name.indexOf('.') < 0) ensureAttr(tF, tMain, c.name);
    for (const name of before) {
      if (now.has(name)) continue;
      const dot = name.indexOf('.');
      if (dot < 0) {
        if (!keep.has(name)) kids(tMain, 'attribute').filter((a) => a.getAttribute('name') === name).forEach((a) => a.remove());
        continue;
      }
      const link = linkByAlias(tF, name.slice(0, dot));
      if (!link) continue;
      kids(link, 'attribute').filter((a) => a.getAttribute('name') === name.slice(dot + 1)).forEach((a) => a.remove());
      // A link that now does nothing: gone. One that filters, or that a condition names, stays.
      const named = Array.from(tF.getElementsByTagName('condition')).some((x) => x.getAttribute('entityname') === link.getAttribute('alias'));
      if (typeOf(link) === 'outer' && !link.children.length && !named) link.remove();
    }

    // The sort, only when asked: the source's, on the table's own columns.
    if (opts.sort) {
      kids(tMain, 'order').forEach((o) => o.remove());
      const at = kids(tMain, 'filter')[0] || kids(tMain, 'link-entity')[0] || null;
      for (const o of kids(sMain, 'order')) tMain.insertBefore(tF.importNode(o, true), at);
    }

    const layoutxml = xmlText(tL);
    const fetchxml = xmlText(tF);
    return Object.assign(diff(target, layoutxml, fetchxml), { layoutxml: layoutxml, fetchxml: fetchxml, skipped: skipped, statusFromSource: statusFromSource });
  }

  // The sort and the filter of a fetch, to tell whether they changed.
  const orderKey = (main) => kids(main, 'order').map((o) => o.getAttribute('attribute') + ':' + (o.getAttribute('descending') || 'false')).join(',');
  function filterKey(main) {
    if (!main) return '';
    const parts = kids(main, 'filter').map((f) => xmlText({ documentElement: f }));
    for (const l of kids(main, 'link-entity')) {
      if (!filtering(l)) continue;
      const c = l.cloneNode(true);
      Array.from(c.getElementsByTagName('attribute')).forEach((a) => a.remove());
      parts.push(xmlText({ documentElement: c }).replace(/ alias="[^"]*"/g, ''));
    }
    // A condition on a linked table by the join it names, not its alias; the
    // filters and links side by side are and-ed - their order does not count.
    const join = (a) => {
      const l = linksIn(main).find((x) => x.getAttribute('alias') === a);
      return l ? linkKey(l) : '';
    };
    return parts
      .map((x) => x.replace(/ entityname="([^"]*)"/g, (m, a) => ' entityname="' + join(a) + '"'))
      .sort()
      .join('');
  }
  const same = (a, b) => {
    const x = parse(a);
    const y = parse(b);
    return !!x && !!y && xmlText(x) === xmlText(y);
  };

  /* What writing layoutxml and fetchxml over a view would change:
   * { added, removed, moved, widened, sorted, filtered, other, same } -
   * other: nothing that shows, the XML all the same differs. */
  function diff(view, layoutxml, fetchxml) {
    const bL = parse(view.layoutxml);
    const aL = parse(layoutxml);
    const bF = parse(view.fetchxml);
    const aF = parse(fetchxml);
    const b = cellsOf(bL);
    const a = cellsOf(aL);
    const before = b.map((c) => c.name);
    const after = a.map((c) => c.name);
    const width = new Map(b.map((c) => [c.name, c.width]));
    const added = after.filter((n) => !before.includes(n));
    const removed = before.filter((n) => !after.includes(n));
    const moved = after.filter((n) => before.includes(n)).join('|') !== before.filter((n) => after.includes(n)).join('|');
    const widened = a.some((c) => width.has(c.name) && width.get(c.name) !== c.width);
    const bMain = mainOf(bF);
    const aMain = mainOf(aF);
    const sorted = orderKey(bMain) !== orderKey(aMain);
    const filtered = filterKey(bMain) !== filterKey(aMain);
    const shows = added.length || removed.length || moved || widened || sorted || filtered;
    const exact = !!bL && !!aL && !!bF && !!aF && xmlText(bL) === xmlText(aL) && xmlText(bF) === xmlText(aF);
    return { added: added, removed: removed, moved: moved, widened: widened, sorted: sorted, filtered: filtered, other: !shows && !exact, same: !shows };
  }

  // ---------- the filter in words ----------

  const OPS = {
    eq: 'is', ne: 'is not', neq: 'is not', gt: 'is greater than', ge: 'is at least', lt: 'is less than', le: 'is at most',
    like: 'is like', 'not-like': 'is not like', 'begins-with': 'starts with', 'not-begin-with': 'does not start with', 'ends-with': 'ends with', 'not-end-with': 'does not end with',
    in: 'is one of', 'not-in': 'is none of', between: 'is between', 'not-between': 'is not between',
    null: 'is empty', 'not-null': 'has a value',
    'eq-userid': 'is me', 'ne-userid': 'is not me', 'eq-userteams': 'is one of my teams', 'eq-useroruserteams': 'is me or my teams',
    'eq-useroruserhierarchy': 'is me or someone under me', 'eq-useroruserhierarchyandteams': 'is me, under me or my teams', 'eq-businessid': 'is my business unit', 'ne-businessid': 'is not my business unit',
    today: 'is today', yesterday: 'is yesterday', tomorrow: 'is tomorrow', 'this-week': 'is this week', 'last-week': 'is last week', 'next-week': 'is next week',
    'this-month': 'is this month', 'last-month': 'is last month', 'next-month': 'is next month', 'this-year': 'is this year', 'last-year': 'is last year', 'next-year': 'is next year',
    'last-seven-days': 'is in the last 7 days', 'next-seven-days': 'is in the next 7 days',
    on: 'is on', 'on-or-after': 'is on or after', 'on-or-before': 'is on or before', 'not-on': 'is not on',
    under: 'is under', 'eq-or-under': 'is or is under', 'not-under': 'is not under', above: 'is above', 'eq-or-above': 'is or is above',
    'contain-values': 'contains', 'not-contain-values': 'does not contain'
  };
  // last-x-days: "is in the last 30 days"; olderthan-x-months: "is older than 6 months".
  function opText(op, v) {
    let m = /^(last|next)-x-(minutes|hours|days|weeks|months|years|fiscal-years|fiscal-periods)$/.exec(op);
    if (m) return 'is in the ' + m[1] + ' ' + v + ' ' + m[2].replace('fiscal-', 'fiscal ');
    m = /^olderthan-x-(minutes|hours|days|weeks|months|years)$/.exec(op);
    if (m) return 'is older than ' + v + ' ' + m[1];
    return OPS[op] || op.replace(/-/g, ' ');
  }
  const NO_VALUE = /^(null|not-null|eq-user|ne-user|eq-business|ne-business|today|yesterday|tomorrow|this-|last-week|next-week|last-month|next-month|last-year|next-year|last-seven|next-seven|eq-useror)/;

  /* A filter as a sentence: "Status is Active and Owner is me" - the
   * names in bold, choices by their labels, a lookup by its name, a
   * related table's column after its link ("Primary Contact › Email"),
   * a link that filters as what it asks ("has no related Contact"). */
  function filterWords(fetchxml, meta, metaOf) {
    const doc = parse(fetchxml);
    const main = mainOf(doc);
    if (!main) return { words: '', search: [] };
    const AND = ' <span class="op">and</span> ';
    // A link: the table it reaches and the column it goes through.
    // A link to many rows (through this table's own key) is named by the table it reaches.
    const viaOf = (l) => {
      const lm = metaOf(l.getAttribute('name'));
      const pm = l.parentElement === main ? meta : metaOf(l.parentElement.getAttribute('name'));
      const name = (lm && lm.label) || l.getAttribute('name');
      const toKey = pm && pm.id && l.getAttribute('to') === pm.id;
      return { lm: lm, via: (!toKey && ((pm && pm.attrs.get(l.getAttribute('to'))) || {}).label) || name, name: name };
    };
    const value = (m, c, v, el) => {
      const opts = m && m.options.get(c.getAttribute('attribute'));
      if (opts && opts.has(String(v))) return opts.get(String(v));
      if (el && el.getAttribute('uiname')) return el.getAttribute('uiname');
      if (c.getAttribute('uiname')) return c.getAttribute('uiname');
      return String(v).replace(/^%|%$/g, '');
    };
    const cond = (c, m, prefix) => {
      // A condition on a linked table's column, written in the main filter.
      const en = c.getAttribute('entityname');
      const el = en && linkByAlias(doc, en);
      if (el) {
        const x = viaOf(el);
        // "Does not contain data": no row at the other end of an outer link.
        if ((el.getAttribute('link-type') || 'inner') === 'outer' && c.getAttribute('operator') === 'null' && [el.getAttribute('from'), x.lm && x.lm.id].includes(c.getAttribute('attribute'))) return 'has no related <b>' + esc(x.name) + '</b>';
        m = x.lm;
        prefix = x.via + ' › ';
      }
      const attr = c.getAttribute('attribute') || '';
      const field = '<b>' + esc(prefix + ((m && m.attrs.get(attr) && m.attrs.get(attr).label) || attr)) + '</b>';
      const op = c.getAttribute('operator') || 'eq';
      const raw = c.getAttribute('value');
      const valEls = kids(c, 'value');
      let vals = valEls.map((v) => v.textContent);
      if (raw != null && !vals.length) vals = [raw];
      if (op === 'like' || op === 'not-like') {
        // %x% contains, x% starts with, %x ends with.
        const v = vals[0] || '';
        const k = /^%.*%$/.test(v) ? 0 : /%$/.test(v) ? 1 : /^%/.test(v) ? 2 : 3;
        const word = (op === 'like' ? ['contains', 'starts with', 'ends with', 'is like'] : ['does not contain', 'does not start with', 'does not end with', 'is not like'])[k];
        return field + ' ' + word + ' <i>' + esc(v.replace(/^%|%$/g, '')) + '</i>';
      }
      if (/-x-/.test(op)) return field + ' ' + esc(opText(op, vals[0] || ''));
      if (NO_VALUE.test(op) || !vals.length) return field + ' ' + esc(opText(op));
      const shown = vals.map((v, i) => '<i>' + esc(value(m, c, v, valEls[i])) + '</i>');
      return field + ' ' + esc(opText(op)) + ' ' + (op === 'between' || op === 'not-between' ? shown.join(' and ') : shown.join(', '));
    };
    // A link that filters: any / not all - has one; not any - has none;
    // all - has some, none of them matching.
    const related = (l) => {
      const x = viaOf(l);
      const type = typeOf(l);
      const where = kids(l, 'filter').map((f) => group(f, x.lm, '', false)).filter(Boolean).join(AND);
      const nm = '<b>' + esc(x.name) + '</b>';
      if (type === 'not any') return 'has no related ' + nm + (where ? ' where ' + where : '');
      if (type === 'all') return 'has a related ' + nm + (where ? ', none of them where ' + where : '');
      if (type === 'any' || type === 'not all') return 'has a related ' + nm + (where ? ' where ' + where : '');
      // inner, exists, in: a column of the related table, through its link.
      const inner = kids(l, 'filter').map((f) => group(f, x.lm, x.via + ' › ', true)).filter(Boolean).join(AND);
      return inner || 'has a related ' + nm;
    };
    const group = (f, m, prefix, top) => {
      const type = (f.getAttribute('type') || 'and').toLowerCase() === 'or' ? 'or' : 'and';
      const parts = [];
      for (const k of Array.from(f.children)) {
        if (k.tagName === 'condition') parts.push(cond(k, m, prefix));
        else if (k.tagName === 'filter') {
          const inner = group(k, m, prefix, false);
          if (inner) parts.push(inner);
        } else if (k.tagName === 'link-entity') parts.push(related(k));
      }
      if (!parts.length) return '';
      const s = parts.join(' <span class="op">' + type + '</span> ');
      // Joined with "and" to what is around it, an "or" needs its brackets.
      return parts.length === 1 || (top && type === 'and') ? s : '(' + s + ')';
    };
    const out = [];
    let search = [];
    for (const f of kids(main, 'filter')) {
      // Quick Find: the columns it searches, said apart.
      if (isQuickFind(f)) {
        search = kids(f, 'condition').map((c) => (meta.attrs.get(c.getAttribute('attribute')) || { label: c.getAttribute('attribute') }).label);
        continue;
      }
      const g = group(f, meta, '', true);
      if (g) out.push(g);
    }
    // Links under the table that filter rows.
    for (const l of linksIn(main)) {
      if (l.closest('filter')) continue; // said with its filter
      const type = typeOf(l);
      // An outer link takes no row away - what it says is read in the filter above (entityname).
      if (type === 'outer') continue;
      out.push(related(l));
    }
    return { words: out.filter(Boolean).join(AND), search: search };
  }


  // ---------- the tab ----------

  const CSS =
    '[hidden]{display:none!important}' +
    'body{margin:0;background:var(--dbc-bg-f5f7fc);color:var(--dbc-fg-10224e);font:14px/1.45 "Segoe UI",system-ui,sans-serif}' +
    'header{padding:16px 22px 12px}' +
    // The header and its toolbar stay on top as the list scrolls, the footer at the foot.
    // (body>header outweighs the shared header{position:relative}; the header stays a child of body - its links need it.)
    'body>header{position:sticky;top:0;z-index:6}' +
    '.tb{position:sticky;top:var(--head,80px);z-index:5;padding:10px 22px;border-bottom:1px solid var(--dbc-bd-dde3f0);background:var(--dbc-bg-f5f7fc)}' +
    // A control of the list reached with the keyboard is not hidden under them, nor under the footer
    // (on the list's controls only: one in a sticky bar would scroll the page on and on).
    '.list *,.src *{scroll-margin:calc(var(--top,150px) + 8px) 0 calc(var(--foot,64px) + 8px)}' +
    '.wrap{display:flex;align-items:flex-start;gap:16px;padding:16px 22px 96px}main{flex:1;min-width:0}' +
    'button,select{padding:6px 11px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);font:inherit;font-size:13px}' +
    'button{cursor:pointer}button:hover{border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-1e6bff)}' +
    'button.primary{background:var(--dbc-bg-1e6bff);border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-fff);font-weight:600}button.primary:hover{background:var(--dbc-bg-155ee0);color:var(--dbc-fg-fff)}' +
    'button:disabled,button:disabled:hover{opacity:.5;cursor:default;border-color:var(--dbc-bd-c6d0e4);color:var(--dbc-fg-10224e)}button.primary:disabled{background:var(--dbc-bg-1e6bff);color:var(--dbc-fg-fff)}' +
    'select{max-width:380px;font-weight:600}' +
    'input[type=checkbox]{width:15px;height:15px;margin:0;accent-color:var(--dbc-bd-1e6bff);cursor:pointer}' +
    '.bar{display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap;margin:0}' +
    '.bar .k{font-size:12px;font-weight:600;color:var(--dbc-fg-56637f)}' +
    '.seg{display:inline-flex;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;overflow:hidden;background:var(--dbc-bg-fff)}' +
    '.seg button{border:0;border-radius:0;padding:5px 12px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e)}.seg button+button{border-left:1px solid var(--dbc-bd-dde3f0)}' +
    '.seg button[aria-pressed="true"]{background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-1e6bff);box-shadow:inset 0 -2px 0 var(--dbc-bd-1e6bff)}' +
    'label.opt{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--dbc-fg-56637f);cursor:pointer}' +
    'label.opt:has(input:disabled){opacity:.5;cursor:default}input[type=checkbox]:disabled{cursor:default}' +
    '.sp{flex:1}' +
    '.card{padding:12px 14px;background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px}' +
    '.src{margin:0 0 18px;border-left:3px solid var(--dbc-bd-1e6bff)}' +
    '.src .sh{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px 12px;margin:0 0 9px}.src h2{flex:1;margin:0;font-size:15px;font-weight:600;color:var(--dbc-fg-10224e)}' +
    '.cols{display:flex;flex-wrap:wrap;gap:5px}' +
    '.col{display:inline-flex;align-items:baseline;gap:5px;padding:2px 9px;border-radius:10px;background:var(--dbc-bg-eef2f9);font-size:12.5px;white-space:nowrap}' +
    '.col small{color:var(--dbc-fg-97a5c6);font-size:11px}' +
    '.flt{margin-top:9px;font-size:12.5px;color:var(--dbc-fg-56637f)}.flt b{color:var(--dbc-fg-10224e);font-weight:600}.flt i{font-style:normal;color:var(--dbc-fg-10224e)}.flt .op{color:var(--dbc-fg-9a6a12);font-weight:600;font-size:11.5px}' +
    '.flt .lbl{display:inline-block;min-width:52px;margin-right:4px;color:var(--dbc-fg-97a5c6);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}' +
    'h3{margin:18px 0 8px;font-size:12px;font-weight:600;color:var(--dbc-fg-56637f);letter-spacing:.04em;text-transform:uppercase}' +
    '.list{display:grid;gap:8px}' +
    'label.v{display:grid;grid-template-columns:22px 1fr auto;gap:4px 10px;align-items:start;padding:10px 14px;background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px;cursor:pointer}' +
    'label.v:hover{border-color:var(--dbc-bd-1e6bff)}label.v.on{border-color:var(--dbc-bd-1e6bff);background:var(--dbc-bg-f7faff)}label.v.off{cursor:default;opacity:.62}label.v.off:hover{border-color:var(--dbc-bd-dde3f0)}' +
    'label.v input{margin-top:3px}' +
    '.v .nm{font-weight:600}.v .nm small,.src h2 small{white-space:nowrap;margin-left:6px;padding:0 7px;border-radius:9px;background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f);font-size:11px;font-weight:600;vertical-align:1px}' +
    '.v .nm small.def,.src h2 small.def{background:var(--dbc-bg-fdf1d6);color:var(--dbc-fg-7a5410)}' +
    '.v .chg{grid-column:3;grid-row:1;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px;max-width:46vw}' +
    '.v .flt{grid-column:2;margin-top:2px}' +
    '.v .err{grid-column:2;font-size:12.5px;color:var(--dbc-fg-a11a1a)}' +
    '.v .st{grid-column:1;grid-row:1}.v .st .db-st{width:18px;height:18px}.v .st .db-st-busy{width:22px;height:14px;margin:3px 0 0}' +
    '.d{padding:1px 8px;border-radius:9px;font-size:12px;font-weight:600;white-space:nowrap}' +
    '.d.add{background:var(--dbc-bg-e4f4e8);color:var(--dbc-fg-1c6b32)}.d.rem{background:var(--dbc-bg-fde8e8);color:var(--dbc-fg-a11a1a)}.d.mv{background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f)}.d.same{color:var(--dbc-fg-97a5c6);font-weight:400}' +
    '.d.warn{background:var(--dbc-bg-fdf1d6);color:var(--dbc-fg-7a5410)}.d.bad{background:var(--dbc-bg-fde8e8);color:var(--dbc-fg-a11a1a)}' +
    '.foot{position:fixed;left:0;right:0;bottom:0;z-index:5;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 22px;background:var(--dbc-bg-fff);border-top:1px solid var(--dbc-bd-dde3f0)}' +
    // The status line: icon and words apart (the busy icon reaches past its own box).
    '.msg{flex:1;min-width:0;display:flex;align-items:center;gap:14px;font-size:13px;color:var(--dbc-fg-56637f)}' +
    '.foot .rt{display:flex;align-items:center;gap:14px;margin-left:auto}' +
    '.wait{display:flex;align-items:center;gap:16px;padding:30px 4px;color:var(--dbc-fg-56637f)}' +
    '.bad{color:var(--dbc-fg-a11a1a)}' +
    // All views: every column against every view.
    '.mx-wrap{overflow:auto;max-height:calc(100vh - 260px);background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px}' +
    'table.mx{border-collapse:separate;border-spacing:0;font-size:13px}' +
    '.mx th,.mx td{padding:6px 10px;border-bottom:1px solid var(--dbc-bd-edf1f8);text-align:center;white-space:nowrap}' +
    '.mx thead th{position:sticky;top:0;z-index:2;background:var(--dbc-bg-f5f7fc);vertical-align:bottom;font-size:12px;font-weight:600;color:var(--dbc-fg-56637f);max-width:130px;white-space:normal;min-width:84px}' +
    '.mx thead th button{padding:2px 7px;margin-top:4px;font-size:11px}' +
    '.mx th.c{position:sticky;left:0;z-index:1;background:var(--dbc-bg-fff);text-align:left;font-weight:400}.mx thead th.c{z-index:3;background:var(--dbc-bg-f5f7fc)}' +
    '.mx th.c small{display:block;color:var(--dbc-fg-97a5c6);font:11px ui-monospace,Consolas,monospace}' +
    '.mx th.is-src{color:var(--dbc-fg-1e6bff);box-shadow:inset 0 -2px 0 var(--dbc-bd-1e6bff)}' +
    '.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--dbc-bg-1e6bff)}' +
    '.ring{display:inline-block;width:7px;height:7px;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--dbc-bd-e3b04b)}' +
    '.mx tr:hover td,.mx tr:hover th.c{background:var(--dbc-bg-f7faff)}';

  // What this tool adds to the tab's look: the links, the gold "not published", Versions as in Edit flow.
  const CSS_MORE =
    'a.dz,button.lk{padding:0;border:0;background:none;color:var(--dbc-fg-1e6bff);font:600 12px "Segoe UI",system-ui,sans-serif;text-decoration:none;white-space:nowrap;cursor:pointer}' +
    'a.dz:hover,button.lk:hover{text-decoration:underline;color:var(--dbc-fg-1e6bff)}' +
    '.acts{display:flex;align-items:center;justify-content:flex-end;gap:12px}' +
    // A row's own actions show under the pointer, or when one has the focus.
    '.v .acts{grid-column:3;grid-row:2;opacity:0;transition:opacity .12s}label.v:hover .acts,.v .acts:focus-within{opacity:1}' +
    '.flt.to{margin-top:3px}.flt.to .lbl{color:var(--dbc-fg-9a6a12)}' +
    '.d.pub{background:var(--dbc-bg-fdf1d6);color:var(--dbc-fg-7a5410)}' +
    '.tb .hint{margin-top:7px;font-size:12.5px;color:var(--dbc-fg-56637f)}' +
    '.tb .rs{padding:2px 0 2px 10px;border-left:3px solid var(--dbc-bd-e3b04b)}.tb .rs b{color:var(--dbc-fg-10224e)}' +
    'button .nb{margin-left:6px;padding:0 6px;border-radius:8px;background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f);font-size:11px}' +
    'button.pub{border-color:var(--dbc-bd-e3b04b);color:var(--dbc-fg-7a5410);font-weight:600}button.pub:hover{border-color:var(--dbc-bd-e3b04b);color:var(--dbc-fg-7a5410);background:var(--dbc-bg-fdf1d6)}' +
    // Versions: the pane on the right, as in Edit flow.
    'aside{flex:none;width:340px;position:sticky;top:calc(var(--top,150px) + 16px);display:flex;flex-direction:column;max-height:calc(100vh - var(--top,150px) - 100px);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px;background:var(--dbc-bg-fff)}' +
    '.ck-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--dbc-bd-dde3f0);font-weight:600}' +
    '.ck-head button{margin-left:auto;padding:2px 8px;border:none;background:none;color:var(--dbc-fg-56637f);font-size:15px;line-height:1}' +
    '.vs-list{flex:1;overflow:auto;padding:6px 0}' +
    '.vs-h{padding:10px 14px 4px;font-size:12px;font-weight:600;letter-spacing:.3px;text-transform:uppercase;color:var(--dbc-fg-56637f)}' +
    'button.vs{display:flex;align-items:flex-start;gap:10px;width:calc(100% - 20px);margin:4px 10px;padding:8px 10px;border:1px solid var(--dbc-bd-e3e8f2);border-radius:6px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);text-align:left;transition:border-color .15s,background .15s}' +
    'button.vs:hover{border-color:var(--dbc-bd-1e6bff);background:var(--dbc-bg-f7faff);color:var(--dbc-fg-10224e)}' +
    '.vs.orig{border-left:3px solid var(--dbc-bd-e3b04b)}.vs.here{box-shadow:0 0 0 2px var(--dbc-bd-1e6bff) inset}' +
    '.vs-dot{flex:none;width:9px;height:9px;margin-top:6px;border-radius:50%;background:var(--dbc-bg-c6d0e4)}.vs.orig .vs-dot{background:var(--dbc-bg-e3b04b)}.vs.here .vs-dot{background:var(--dbc-bg-1e6bff)}' +
    '.vs-main{flex:1;min-width:0}.vs-t{display:block;font-weight:600;font-size:13px}.vs-m{display:block;font-size:12px;color:var(--dbc-fg-56637f);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.vs-note{padding:6px 14px 10px;font-size:12px;color:var(--dbc-fg-8a95ad)}' +
    '.dlg-bg{position:fixed;inset:0;z-index:20;display:flex;align-items:flex-start;justify-content:center;padding-top:14vh;background:rgba(12,19,37,.32)}' +
    '.dlg{width:min(480px,calc(100vw - 32px));box-sizing:border-box;padding:18px 20px;box-shadow:0 12px 40px rgba(12,19,37,.25)}' +
    '.dlg h2{margin:0 0 12px;font-size:16px;font-weight:600}' +
    '.dlg .k{display:block;margin:0 0 5px;font-size:12px;font-weight:600;color:var(--dbc-fg-56637f)}' +
    '.dlg input{box-sizing:border-box;width:100%;padding:7px 10px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);font:inherit}' +
    '.dlg input:focus{outline:2px solid var(--dbc-bd-1e6bff);outline-offset:-1px;border-color:var(--dbc-bd-1e6bff)}' +
    '.dlg .dim{margin:8px 0 14px;font-size:12.5px;color:var(--dbc-fg-56637f)}' +
    '.dlg .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.dlg .err{color:var(--dbc-fg-a11a1a);font-size:12.5px}';

  // A time as the tab says it: 10:42, or 6 Nov, 10:42 when not today.
  function clock(t) {
    const d = new Date(t);
    const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString() ? hm : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ', ' + hm;
  }

  // The tab before anything is read: the header with its toolbar on top, the list beside Versions, the footer.
  function shell(host) {
    return (
      '<!doctype html><meta charset="utf-8"><title>View columns</title>' +
      '<style>' + DynaBoost.status.css + CSS + CSS_MORE + DynaBoost.tabCss + '</style>' +
      '<body><header><h1>Copy view columns</h1><div class="crumbs" id="crumbs">' + esc(host) + '</div></header><div class="tb" id="tb" hidden></div>' +
      '<div class="wrap"><main id="main"><div class="wait">' + DynaBoost.status.html('busy') + '<span>Reading the views…</span></div></main><aside id="side" hidden></aside></div>' +
      '<div class="foot" id="foot" hidden></div>'
    );
  }

  async function open() {
    const at = here();
    if (!at) return;
    const asked = Date.now();
    let host = null;
    try {
      host = DynaBoost.orgHost ? await DynaBoost.orgHost(at.env) : null;
    } catch (e) {
      host = null;
    }
    if (!host) {
      DynaBoost.toast('The environment’s address is not known', 'Open the environment once from the maker’s environment picker, then try again.', true);
      return;
    }
    // The environment is read - and the ticked views saved - in a tab of our own: asked first, as Compare asks.
    const ask = DynaBoost.envCompare && DynaBoost.envCompare.mayOpen;
    if (ask && !(await ask(null, 'read the views of this table', [host], 'It reads with your own sign-in, and saves the views you tick when you click Apply. Nothing is sent anywhere else.'))) return;
    const tab = window.open('', '_blank');
    if (!tab) {
      // A click may open a tab for a few seconds only - an address typed into the prompt takes longer; it is kept now.
      if (Date.now() - asked > 4000) DynaBoost.toast('The environment’s address is kept', 'Click Open to open the tab.', false, { label: 'Open', run: open });
      else DynaBoost.toast('The tab was blocked', 'Allow pop-ups for make.powerapps.com and try again.', true);
      return;
    }
    tab.document.write(shell(host));
    tab.document.close();
    DynaBoost.themeTab(tab);
    // The tab runs on this page's script: once the page is closed or reloaded, it says so instead of going quiet.
    const gone = () => {
      if (tab.closed) return;
      const d = tab.document;
      d.querySelectorAll('button, input, select, textarea').forEach((x) => {
        x.disabled = true;
      });
      const foot = d.getElementById('foot');
      if (foot) {
        foot.hidden = false;
        foot.innerHTML = '<span class="msg bad">' + DynaBoost.status.html('bad') + '<span>The make.powerapps.com page this tab was opened from was closed or reloaded - this tab no longer works. What was saved stays saved (its backup is under Versions); open Copy view columns again.</span></span>';
      }
    };
    window.addEventListener('pagehide', gone);
    tab.addEventListener('pagehide', () => window.removeEventListener('pagehide', gone));
    const conn = connect(host);
    (async () => {
      let table = at.table;
      if (GUID.test(table)) table = (await conn.api('EntityDefinitions(' + table + ')?$select=LogicalName')).LogicalName;
      tab.document.title = 'View columns – ' + table;
      await run(tab, conn, Object.assign({}, at, { host: host, table: table }));
    })().catch((e) => {
      if (tab.closed) return;
      tab.document.getElementById('main').innerHTML = '<div class="wait bad">' + DynaBoost.status.html('bad') + '<span>' + esc(e.message || 'The views could not be read.') + '</span></div>';
    });
  }

  async function readSolution(api, id) {
    try {
      const s = await api('solutions(' + id + ')?$select=solutionid,uniquename,friendlyname,ismanaged');
      return { id: clean(s.solutionid), unique: s.uniquename, name: s.friendlyname || s.uniquename, managed: !!s.ismanaged, isDefault: s.uniquename === 'Default' || clean(s.solutionid) === DEFAULT_SOLUTION };
    } catch (e) {
      return null;
    }
  }

  async function run(tab, conn, at) {
    const doc = tab.document;
    const get = (id) => doc.getElementById(id);
    const api = conn.api;
    const table = at.table;
    const [read, meta, sol, envId] = await Promise.all([
      readViews(api, table),
      conn.tableMeta(table),
      at.sol ? readSolution(api, at.sol) : null,
      // The environment the kept address leads to - it must be the one in the address.
      api("RetrieveCurrentOrganization(AccessType=@p)?@p=Microsoft.Dynamics.CRM.EndpointAccessType'Default'").then((r) => clean(r && r.Detail && r.Detail.EnvironmentId), () => '')
    ]);
    if (tab.closed) return;
    const bare = (id) => id.replace(/^default-/, '');
    if (envId && bare(envId) !== bare(at.env)) throw new Error(conn.host + ' is not the environment in this address - the address DynaBoost keeps for it is wrong.');
    const views = read.views;
    const drafts = read.drafts;
    if (!views.length) throw new Error('This table has no views to copy between.');
    const solName = sol ? ' · ' + esc(sol.name) : '';
    get('crumbs').innerHTML =
      esc(conn.host) + ' · <b>' + esc(meta.label) + '</b> <code>' + esc(table) + '</code> · ' + views.length + ' views' + solName +
      (drafts ? '' : ' · published views only – Apply publishes the table');

    // Related tables named by the views' columns and filters: their labels, read once.
    const metas = new Map([[table, meta]]);
    const others = new Set();
    for (const v of views) for (const l of linksIn(mainOf(parse(v.fetchxml)) || doc.createElement('x'))) others.add(l.getAttribute('name'));
    others.delete(table);
    await Promise.all(Array.from(others).map((t) => conn.tableMeta(t).then((m) => metas.set(t, m), () => {})));
    if (tab.closed) return;
    const metaOf = (t) => metas.get(t) || null;

    // A filter in words and a column's label come from the XML alone: kept by its
    // text, so that a redraw does not read it again - and a view written anew is read anew.
    const memo = (cache, key, make) => {
      if (cache.has(key)) return cache.get(key);
      if (cache.size > 300) cache.clear();
      const x = make();
      cache.set(key, x);
      return x;
    };
    const labelsOf = new Map(); // fetchxml -> Map(column name -> label)
    // A column's label: "Account Name"; a related one "Primary Contact › Email".
    const colLabel = (v, name) => {
      const dot = name.indexOf('.');
      if (dot < 0) return (meta.attrs.get(name) || { label: name }).label;
      return memo(memo(labelsOf, v.fetchxml, () => new Map()), name, () => relLabel(v, name, dot));
    };
    const relLabel = (v, name, dot) => {
      const link = linkByAlias(parse(v.fetchxml), name.slice(0, dot));
      if (!link) return name;
      const lm = metaOf(link.getAttribute('name'));
      const pm = link.parentElement.tagName === 'entity' ? meta : metaOf(link.parentElement.getAttribute('name'));
      const via = ((pm && pm.attrs.get(link.getAttribute('to'))) || {}).label || (lm ? lm.label : link.getAttribute('name'));
      return via + ' › ' + ((lm && lm.attrs.get(name.slice(dot + 1))) || { label: name.slice(dot + 1) }).label;
    };

    // The view in the designer is the source at first, else the default public one.
    let source = views.find((v) => v.id === at.view) || views.find((v) => v.isDefault && v.kind === 'Public') || views.find((v) => v.editable) || views[0];
    const opts = { mode: 'same', widths: true, sort: false, filters: false };
    const picked = new Set();
    let tabView = 'copy';
    const done = new Map(); // id -> { state: 'busy'|'ok'|'bad', error }
    let undo = null; // [{ view, layoutxml, fetchxml }] - what the last Apply changed, as it was
    let busy = false; // a write is on: Apply and Undo wait
    const unpublished = new Set(); // views saved here and not published since
    // Into the solution in the address - an unmanaged one of yours; every view is in the Default one.
    const solOk = !!(sol && !sol.managed && !sol.isDefault);
    let toSolution = solOk;
    const designerSol = sol && !sol.managed ? sol.id : at.sol && !sol ? at.sol : DEFAULT_SOLUTION;
    const designer = (v) => MAKER + '/e/' + (at.envUrl || at.env) + '/s/' + designerSol + '/entity/' + encodeURIComponent(table) + '/view/' + v.id;

    // ---- versions ----
    // The views as opened - always kept - and after each of the last 5 Applies.
    const original = { key: 'o', name: 'As opened', at: Date.now(), map: new Map(views.map((v) => [v.id, { layoutxml: v.layoutxml, fetchxml: v.fetchxml }])) };
    const applies = [];
    let applyN = 1;
    let backups = []; // kept in this browser before an Apply, for this table here
    let restoring = null; // the version being put back: { key, name, map }
    let showVersions = false;
    const mine = (b) => b && b.env === at.env && b.table === table && Array.isArray(b.views) && Date.parse(b.savedAt) > Date.now() - BACKUP_DAYS * 86400000;
    async function loadBackups() {
      try {
        const d = await chrome.storage.local.get(BACKUP_KEY);
        backups = (Array.isArray(d[BACKUP_KEY]) ? d[BACKUP_KEY] : []).filter(mine);
      } catch (e) {
        backups = [];
      }
    }
    // Before every write: the views as they are, in this browser (the 5 newest of all tables, 14 days).
    async function keepBackup(list) {
      if (!list.length) return;
      const entry = { env: at.env, host: conn.host, table: table, savedAt: new Date().toISOString(), views: list.map((b) => ({ id: b.view.id, name: b.view.name, layoutxml: b.layoutxml, fetchxml: b.fetchxml })) };
      const key = (x) => JSON.stringify(x.views.map((v) => [v.id, v.layoutxml, v.fetchxml]));
      try {
        const d = await chrome.storage.local.get(BACKUP_KEY);
        const cut = Date.now() - BACKUP_DAYS * 86400000;
        const all = (Array.isArray(d[BACKUP_KEY]) ? d[BACKUP_KEY] : []).filter((b) => b && Date.parse(b.savedAt) > cut && !(b.env === entry.env && b.table === entry.table && key(b) === key(entry)));
        all.unshift(entry);
        await chrome.storage.local.set({ [BACKUP_KEY]: all.slice(0, BACKUPS_KEPT) });
        backups = all.slice(0, BACKUPS_KEPT).filter(mine);
      } catch (e) {
        /* no storage - the tab's own versions still show */
      }
    }
    const versionOf = (key) => {
      if (key === 'o') return original;
      if (key[0] === 'a') return applies.find((a) => a.key === key) || null;
      const b = backups.find((x) => 'b' + x.savedAt === key);
      return b ? { key: key, name: 'Before a save, ' + clock(Date.parse(b.savedAt)), map: new Map(b.views.map((v) => [v.id, v])) } : null;
    };

    /* What Apply would write over a view, and what it changes - kept while
     * nothing it is made of changes (a redraw, a tick), worked out anew when
     * the source, an option, the version or either view's XML does. */
    const planned = new WeakMap(); // view -> { inputs, p }
    const plan = (t) => {
      const inputs = [restoring, source, source.layoutxml, source.fetchxml, t.layoutxml, t.fetchxml, opts.mode, opts.widths, opts.sort, opts.filters];
      const m = planned.get(t);
      if (m && m.inputs.every((x, i) => x === inputs[i])) return m.p;
      const p = planOnce(t);
      planned.set(t, { inputs: inputs, p: p });
      return p;
    };
    const planOnce = (t) => {
      if (restoring) {
        const x = restoring.map.get(t.id);
        if (!x) return { none: true };
        const d = diff(t, x.layoutxml, x.fetchxml);
        d.same = d.same && !d.other;
        return Object.assign(d, { layoutxml: x.layoutxml, fetchxml: x.fetchxml, skipped: [] });
      }
      return t === source ? null : copyColumns(source, t, opts, meta.id, (name) => (metaOf(name) || {}).id);
    };
    const wordsOf = new Map(); // fetchxml -> { words, search }
    const words = (v) => memo(wordsOf, v.fetchxml, () => filterWords(v.fetchxml, meta, metaOf));
    const filterLine = (v, labelled) => {
      const w = words(v);
      return (
        '<div class="flt">' + (labelled ? '<span class="lbl">Filter</span>' : '') + (w.words || '<span class="d same">none – every row</span>') +
        (w.search.length ? '<br>' + (labelled ? '<span class="lbl">Search</span>' : 'Searches ') + esc(w.search.join(', ')) : '') + '</div>'
      );
    };
    // The filter a view would have after the copy, when it changes.
    const becomes = (p) => {
      if (!p || p.none || p.error || p.same || !p.filtered) return '';
      const w = words({ fetchxml: p.fetchxml });
      return (
        '<div class="flt to"><span class="lbl">Filter after</span>' + (w.words || '<span class="d same">none – every row</span>') +
        (p.statusFromSource ? ' <span class="d warn" title="It had no Status of its own to keep - it takes the source’s">Status from the source</span>' : '') + '</div>'
      );
    };
    const chipsOf = (v, p) => {
      if (!v.editable) return '<span class="d same">' + esc(v.why) + '</span>';
      if (!p) return '';
      if (p.none) return '<span class="d same">not in this version</span>';
      if (p.error) return '<span class="d bad">' + esc(p.error) + '</span>';
      if (p.same) return '<span class="d same">' + (restoring ? 'as in this version' : 'same columns') + '</span>';
      const ch = [];
      // An added column is named as the view will have it, a removed one as it had it.
      const list = (names, cls, sign, where) => {
        names.slice(0, 4).forEach((n) => ch.push('<span class="d ' + cls + '">' + sign + ' ' + esc(colLabel(where, n)) + '</span>'));
        if (names.length > 4) ch.push('<span class="d ' + cls + '" title="' + esc(names.slice(4).map((n) => colLabel(where, n)).join(', ')) + '">' + sign + ' ' + (names.length - 4) + ' more</span>');
      };
      list(p.added, 'add', '+', { fetchxml: p.fetchxml });
      list(p.removed, 'rem', '−', v);
      if (p.moved) ch.push('<span class="d mv">order</span>');
      if (p.widened) ch.push('<span class="d mv">widths</span>');
      if (p.sorted) ch.push('<span class="d mv">sort</span>');
      if (p.filtered) ch.push('<span class="d warn" title="' + esc('Its filter becomes: ' + words({ fetchxml: p.fetchxml }).words.replace(/<[^>]+>/g, '')) + '">filter</span>');
      if (p.other) ch.push('<span class="d mv" title="Nothing you see changes - the query behind it does">query</span>');
      if (p.skipped.length) ch.push('<span class="d warn" title="' + esc(p.skipped.map((n) => colLabel(source, n)).join(', ')) + ' - through a one-to-many link it would repeat the view’s rows">' + p.skipped.length + ' not copied</span>');
      if (v.lookup && cellsOf(parse(p.layoutxml)).length > 3) ch.push('<span class="d warn" title="A lookup shows only its first columns">lookup shows the first 3</span>');
      return ch.join('');
    };
    const kindTag = (v) => '<small class="' + (v.isDefault ? 'def' : '') + '">' + esc(v.kind) + (v.isDefault ? ' · default' : '') + '</small>';
    const pubTag = (v) => (unpublished.has(v.id) ? '<span class="d pub" title="Saved, not published - Publish below, or in its designer">not published</span>' : '');
    const newTag = (v) => (v.fresh ? '<span class="d add" title="Made here - saved, not published">new</span>' : '');
    /* A view's own actions: its designer; Rename, a view that may be changed;
     * Duplicate, a public one - a table has one view of each other kind. */
    const acts = (v) => {
      const a = [];
      if (v.editable) a.push('<a class="dz" href="' + esc(designer(v)) + '" target="_blank" rel="noopener" aria-label="' + esc('Designer: ' + v.name) + '" title="This view in the view designer - to check it, and publish it there">Designer ↗</a>');
      if (!restoring && !busy) {
        if (v.editable) a.push('<button class="lk" data-rename="' + esc(v.id) + '" aria-label="' + esc('Rename ' + v.name) + '" title="Its name - as the view picker shows it">Rename</button>');
        if (v.kind === 'Public') a.push('<button class="lk" data-dup="' + esc(v.id) + '" aria-label="' + esc('Duplicate ' + v.name) + '" title="A copy of this view - its columns, filter and sort - as a new public view">Duplicate</button>');
      }
      return a.length ? '<span class="acts">' + a.join('') + '</span>' : '';
    };

    // Versions: the pane on the right, as in Edit flow.
    function drawSide() {
      const side = get('side');
      side.hidden = !showVersions;
      if (!showVersions) return;
      const item = (key, title, meta, cls) =>
        '<button class="vs' + cls + (restoring && restoring.key === key ? ' here' : '') + '" data-ver="' + esc(key) + '" title="' + esc(meta) + '">' +
        '<span class="vs-dot"></span><span class="vs-main"><span class="vs-t">' + esc(title) + '</span><span class="vs-m">' + esc(meta) + '</span></span></button>';
      const nameOf = (id) => (views.find((v) => v.id === id) || { name: id }).name;
      const rows = [item('o', 'As opened', clock(original.at) + ' · every view', ' orig')];
      for (const a of applies.slice().reverse()) rows.push(item(a.key, a.name, clock(a.at) + ' · ' + Array.from(a.map.keys()).map(nameOf).join(', '), ''));
      if (backups.length) {
        rows.push('<div class="vs-h">In this browser</div>');
        for (const b of backups) rows.push(item('b' + b.savedAt, 'Before a save', clock(Date.parse(b.savedAt)) + ' · ' + b.views.map((v) => v.name).join(', '), ''));
      }
      side.innerHTML =
        '<div class="ck-head">Versions<button id="vs-close" title="Close" aria-label="Close Versions">✕</button></div>' +
        '<div class="vs-list">' + rows.join('') +
        '<div class="vs-note">A click ticks the views it would put back; Apply writes them. The last ' + APPLIES_KEPT + ' Applies stay while this tab is open, the backups ' + BACKUP_DAYS + ' days.</div></div>';
    }

    // The toolbar under the header: what is copied and how - or the version being put back.
    function drawBar() {
      const nv = applies.length + backups.length;
      const vbtn = '<button id="versions" aria-pressed="' + showVersions + '" title="The views as opened, after each Apply, and the backups in this browser">Versions' + (nv ? '<span class="nb">' + nv + '</span>' : '') + '</button>';
      const tb = get('tb');
      tb.hidden = false;
      if (restoring) {
        tb.innerHTML = '<div class="bar rs"><span>Putting back <b>' + esc(restoring.name) + '</b> – the views it changes are ticked.</span><span class="sp"></span><button id="leave">Back to copying</button>' + vbtn + '</div>';
        return;
      }
      const hint =
        tabView === 'all'
          ? 'Every column against every view. <b>Copy from</b> on a view makes it the source.'
          : (opts.filters
              ? 'Columns and filter: each view takes the source’s filter and keeps its own Status (one without takes the source’s) and its Quick Find columns.'
              : 'Columns only: each view keeps its own filter.') + ' Apply saves; Publish makes it live.';
      tb.innerHTML =
        '<div class="bar"><label class="k" for="src">From</label><select id="src">' +
        views.map((v) => '<option value="' + esc(v.id) + '"' + (v === source ? ' selected' : '') + '>' + esc(v.name) + ' · ' + esc(v.kind) + '</option>').join('') +
        '</select>' +
        '<span class="seg" role="group" aria-label="Mode"><button data-mode="same" aria-pressed="' + (opts.mode === 'same') + '" title="The views get exactly these columns, in this order">Same columns</button>' +
        '<button data-mode="add" aria-pressed="' + (opts.mode === 'add') + '" title="Only the columns a view does not have are added, at its end - nothing is taken away">Add missing</button></span>' +
        '<label class="opt"' + (opts.mode === 'add' ? ' title="In Add missing each view keeps its own widths - the columns added come with the source’s"' : '') + '><input type="checkbox" id="widths"' + (opts.widths ? ' checked' : '') + (opts.mode === 'add' ? ' disabled' : '') + '> Copy widths</label>' +
        '<label class="opt"><input type="checkbox" id="sort"' + (opts.sort ? ' checked' : '') + '> Copy sort order</label>' +
        '<label class="opt" title="The source’s filter on each view - each keeps its own Status condition (Active, Inactive), one with none takes the source’s - and the columns its Quick Find searches"><input type="checkbox" id="filters"' + (opts.filters ? ' checked' : '') + '> Copy filters</label>' +
        '<span class="sp"></span>' + vbtn +
        '<span class="seg" role="group" aria-label="Show"><button data-tab="copy" aria-pressed="' + (tabView === 'copy') + '">Copy</button><button data-tab="all" aria-pressed="' + (tabView === 'all') + '">All views</button></span></div>' +
        '<div class="hint">' + hint + '</div>';
    }

    // The sticky header's and toolbar's heights: the toolbar under the header, the Versions pane under both.
    const fit = () => {
      const head = doc.querySelector('body > header').offsetHeight;
      const tb = get('tb');
      doc.documentElement.style.setProperty('--head', head + 'px');
      doc.documentElement.style.setProperty('--top', head + (tb.hidden ? 0 : tb.offsetHeight) + 'px');
      const foot = get('foot');
      doc.documentElement.style.setProperty('--foot', (foot.hidden ? 0 : foot.offsetHeight) + 'px');
    };
    tab.addEventListener('resize', fit);

    // The control that has the focus, found again after a redraw (not in a dialog).
    const FOCUS_KEYS = ['data-pick', 'data-mode', 'data-tab', 'data-ver', 'data-rename', 'data-dup', 'data-from', 'id'];
    const focusOf = () => {
      const a = doc.activeElement;
      if (!a || a === doc.body || a.closest('.dlg-bg')) return null;
      const k = FOCUS_KEYS.find((x) => a.hasAttribute(x));
      return k ? { k: k, v: a.getAttribute(k) } : null;
    };
    const focusBack = (f) => {
      if (!f) return;
      const el = Array.from(doc.querySelectorAll('[' + f.k + ']')).find((x) => x.getAttribute(f.k) === f.v);
      if (el && !el.disabled && doc.activeElement !== el) el.focus({ preventScroll: true });
    };

    function draw() {
      const f = focusOf();
      drawBar();
      drawSide();
      const sCells = cellsOf(parse(source.layoutxml));
      const src = restoring
        ? ''
        : '<div class="card src"><div class="sh"><h2>' + esc(source.name) + kindTag(source) + ' ' + newTag(source) + pubTag(source) + '</h2>' + acts(source) + '</div><div class="cols">' +
          sCells.map((c) => '<span class="col">' + esc(colLabel(source, c.name)) + '<small>' + c.width + '</small></span>').join('') + '</div>' +
          filterLine(source, true) + '</div>';
      let body = '';
      if (tabView === 'copy' || restoring) {
        const groups = [];
        for (const v of views) {
          if (v === source && !restoring) continue;
          const key = v.other ? 'Other kinds – left alone' : v.kind === 'Public' ? 'Public views' : 'Other system views';
          let g = groups.find((x) => x.key === key);
          if (!g) groups.push((g = { key: key, items: [] }));
          g.items.push(v);
        }
        body = groups
          .map(
            (g) =>
              '<h3>' + esc(g.key) + '</h3><div class="list">' +
              g.items
                .map((v) => {
                  const p = v.editable ? plan(v) : null;
                  const can = !busy && v.editable && p && !p.none && !p.error && !p.same;
                  if (!can) picked.delete(v.id);
                  const d = done.get(v.id);
                  const st = d && d.state !== 'bad' ? DynaBoost.status.html(d.state) : '<input type="checkbox" id="pk-' + esc(v.id) + '" data-pick="' + esc(v.id) + '" aria-label="' + esc(v.name) + '"' + (picked.has(v.id) ? ' checked' : '') + (can ? '' : ' disabled') + '>';
                  return (
                    '<label class="v' + (picked.has(v.id) ? ' on' : '') + (v.editable ? '' : ' off') + '" for="pk-' + esc(v.id) + '"><span class="st">' + st + '</span>' +
                    '<span class="nm">' + esc(v.name) + kindTag(v) + ' ' + newTag(v) + pubTag(v) + '</span><span class="chg">' + chipsOf(v, p) + '</span>' + (d && d.state === 'bad' ? '<span class="err">Not saved: ' + esc(d.error) + '</span>' : '') + filterLine(v, false) + becomes(p) + acts(v) + '</label>'
                  );
                })
                .join('') +
              '</div>'
          )
          .join('');
      } else body = matrix();
      get('main').innerHTML = (tabView === 'copy' || restoring ? src : '') + body;
      drawFoot();
      fit();
      focusBack(f);
    }

    // Every column of every view: rows the columns, columns the views.
    function matrix() {
      const rows = [];
      const seen = new Map();
      const cellsBy = new Map(views.map((v) => [v.id, cellsOf(parse(v.layoutxml))]));
      for (const v of [source].concat(views.filter((x) => x !== source))) {
        for (const c of cellsBy.get(v.id)) {
          // The same column in two views can hide behind two aliases: matched by its label.
          const key = colLabel(v, c.name);
          if (!seen.has(key)) {
            seen.set(key, rows.length);
            rows.push({ label: key, name: c.name, inSrc: v === source });
          }
        }
      }
      const has = new Map(views.map((v) => [v.id, new Map(cellsBy.get(v.id).map((c) => [colLabel(v, c.name), c.width]))]));
      const head =
        '<thead><tr><th class="c">Column</th>' +
        views.map((v) => '<th class="' + (v === source ? 'is-src' : '') + '">' + esc(v.name) + '<br><small style="font-weight:400">' + esc(v.kind) + '</small>' + (v === source ? '' : '<br><button data-from="' + esc(v.id) + '" aria-label="' + esc('Copy from ' + v.name) + '">Copy from</button>') + '</th>').join('') +
        '</tr></thead>';
      const body = rows
        .map(
          (r) =>
            '<tr><th class="c">' + esc(r.label) + '<small>' + esc(r.name) + '</small></th>' +
            views.map((v) => (has.get(v.id).has(r.label) ? '<td title="' + esc(v.name + ' · ' + has.get(v.id).get(r.label) + ' px') + '"><span class="dot"></span></td>' : r.inSrc && v.editable ? '<td title="' + esc(v.name + ' does not have it') + '"><span class="ring"></span></td>' : '<td></td>')).join('') +
            '</tr>'
        )
        .join('');
      return '<div class="mx-wrap"><table class="mx">' + head + '<tbody>' + body + '</tbody></table></div>' + '<p class="flt"><span class="dot"></span> the view has the column · <span class="ring"></span> a column of <b>' + esc(source.name) + '</b> the view does not have. <b>Copy from</b> on a view makes it the one copied.</p>';
    }

    let said = ''; // the footer's last word, kept across redraws
    function drawFoot() {
      const foot = get('foot');
      const n = picked.size;
      foot.hidden = tabView !== 'copy' && !restoring && !undo && !unpublished.size;
      const what = restoring
        ? n ? 'Put back ' + n + ' view' + (n === 1 ? '' : 's') : 'Tick the views to put back'
        : n ? 'Apply to ' + n + ' view' + (n === 1 ? '' : 's') : 'Tick the views to change';
      foot.innerHTML =
        '<button class="primary" id="apply"' + (n && !busy ? '' : ' disabled') + '>' + what + '</button>' +
        (undo ? '<button id="undo"' + (busy ? ' disabled' : '') + ' title="Puts back what the last Apply changed">Undo</button>' : '') +
        '<span class="msg" id="said" role="status">' + said + '</span>' +
        '<span class="rt">' +
        (solOk ? '<label class="opt" title="A changed or new view not yet in the solution is added to it, so that it goes with it"><input type="checkbox" id="tosol"' + (toSolution ? ' checked' : '') + '> Add to ' + esc(sol.name) + '</label>' : '') +
        (unpublished.size
          ? '<button class="pub" id="publish"' + (busy ? ' disabled' : '') + ' title="Publishes the table ' + esc(meta.label) + ' - and with it whatever else in it is saved and not published, yours or anyone’s">Publish ' + esc(meta.label) + '<span class="nb">' + unpublished.size + '</span></button>'
          : '') +
        '</span>';
    }
    const say = (html) => {
      said = html;
      const el = get('said');
      if (el) el.innerHTML = html;
    };

    // ---- writing ----

    const publishTable = () => api('PublishXml', { body: { ParameterXml: '<importexportxml><entities><entity>' + table + '</entity></entities></importexportxml>' } });

    // The changed views into the solution in the address, unless the table is in it whole.
    async function intoSolution(written) {
      if (!solOk || !toSolution || !written.length) return '';
      try {
        const r = await api('solutioncomponents?$select=objectid,componenttype,rootcomponentbehavior&$filter=_solutionid_value eq ' + sol.id + ' and (componenttype eq 1 or componenttype eq 26)');
        const comps = r.value || [];
        if (comps.some((c) => c.componenttype === 1 && clean(c.objectid) === meta.metadataId && c.rootcomponentbehavior === 0)) return '';
        const missing = written.filter((b) => !comps.some((c) => c.componenttype === 26 && clean(c.objectid) === b.view.id));
        // One after another - the first may bring the table into the solution too.
        let added = 0;
        let err = null;
        for (const b of missing) {
          try {
            await api('AddSolutionComponent', { body: { ComponentId: b.view.id, ComponentType: 26, SolutionUniqueName: sol.unique, AddRequiredComponents: false, DoNotIncludeSubcomponents: false } });
            added++;
          } catch (e) {
            err = err || e;
          }
        }
        if (!err) return added ? ' ' + added + ' added to ' + sol.name + '.' : '';
        return (added ? ' ' + added + ' added to ' + sol.name + ', ' + (missing.length - added) + ' not' : ' Not added to ' + sol.name) + ' - ' + why(err) + '.';
      } catch (e) {
        return ' Not added to ' + sol.name + ' - ' + why(e) + '.';
      }
    }

    // kind: 'apply' (a copy), 'restore' (a version put back) or 'undo'.
    async function write(list, kind) {
      if (busy) return;
      busy = true;
      say(DynaBoost.status.html('busy') + ' ' + (kind === 'undo' ? 'Undoing' : 'Saving') + '…');
      draw(); // the rows and buttons locked at once - the views are read first
      const name = kind === 'restore' && restoring ? 'After putting back “' + restoring.name + '”' : kind === 'undo' ? 'After Undo' : 'After Apply ' + applyN;
      // The source and options as they were at Apply - the controls stay live while it saves.
      const src0 = source;
      const opts0 = Object.assign({}, opts);
      // The views as they are now, in one trip - someone may have changed one since the
      // tab read it; the backup is what is about to be written over.
      const nows = await Promise.all(list.map((w) => readView(api, w.view.id, drafts).catch((e) => e)));
      await keepBackup(list.map((w, i) => (nows[i] instanceof Error ? null : { view: w.view, layoutxml: nows[i].layoutxml, fetchxml: nows[i].fetchxml })).filter(Boolean));
      const before = []; // what was written over, for Undo
      const failed = []; // an Undo that did not take: kept to try again
      for (const [i, w] of list.entries()) {
        done.set(w.view.id, { state: 'busy' });
        draw();
        try {
          const now = nows[i];
          if (now instanceof Error) throw now;
          if (!same(now.layoutxml, w.view.layoutxml) || !same(now.fetchxml, w.view.fetchxml)) {
            if (kind !== 'apply') throw new Error('it was changed since - not put back');
            w.view.layoutxml = now.layoutxml;
            w.view.fetchxml = now.fetchxml;
            Object.assign(w, copyColumns(src0, w.view, opts0, meta.id, (n) => (metaOf(n) || {}).id));
            if (w.error) throw new Error(w.error);
            if (w.same) {
              done.set(w.view.id, { state: 'ok' });
              continue;
            }
          }
          await api('savedqueries(' + w.view.id + ')', { method: 'PATCH', body: { layoutxml: w.layoutxml, fetchxml: w.fetchxml } });
          before.push({ view: w.view, layoutxml: w.view.layoutxml, fetchxml: w.view.fetchxml });
          w.view.layoutxml = w.layoutxml;
          w.view.fetchxml = w.fetchxml;
          unpublished.add(w.view.id);
          done.set(w.view.id, { state: 'ok' });
        } catch (e) {
          if (kind === 'undo') failed.push(w);
          done.set(w.view.id, { state: 'bad', error: e.message || 'not saved' });
        }
      }
      // Where the saved views cannot be read before they are published, they
      // are published at once - else this tab would read them back as they were.
      let published = '';
      if (!drafts && before.length) {
        try {
          await publishTable();
          before.forEach((b) => unpublished.delete(b.view.id));
          published = ' Published - this environment shows views here only as published.';
        } catch (e) {
          published = ' Not published - ' + why(e) + '.';
        }
      }
      // As Dataverse keeps them - it may write the XML its own way.
      await Promise.all(
        before.map((b) =>
          readView(api, b.view.id, drafts).then(
            (now) => {
              b.view.layoutxml = now.layoutxml;
              b.view.fetchxml = now.fetchxml;
            },
            () => {}
          )
        )
      );
      const added = await intoSolution(before);
      busy = false;
      if (tab.closed) return;
      const ok = before.length;
      const bad = list.filter((w) => done.get(w.view.id) && done.get(w.view.id).state === 'bad').length;
      if (ok) {
        applies.push({ key: 'a' + applyN, name: name, at: Date.now(), map: new Map(before.map((b) => [b.view.id, { layoutxml: b.view.layoutxml, fetchxml: b.view.fetchxml }])) });
        applyN++;
        while (applies.length > APPLIES_KEPT) applies.shift();
      }
      undo = kind === 'undo' ? (failed.length ? failed : null) : ok ? before : undo;
      if (kind === 'apply' && ok) DynaBoost.saved('view-columns');
      if (ok && kind !== 'undo') restoring = null;
      picked.clear();
      said =
        DynaBoost.status.html(bad ? 'bad' : 'ok') + ' ' + (kind === 'undo' ? 'Undone: ' : 'Saved: ') + ok + ' view' + (ok === 1 ? '' : 's') + (bad ? ', ' + bad + ' not - why is on its row' : '') + '.' +
        (ok && !published ? ' Not published yet.' : '') + esc(published + added);
      draw();
      setTimeout(() => {
        for (const [id, d] of done) if (d.state === 'ok') done.delete(id);
        if (!busy && !tab.closed && (tabView === 'copy' || restoring)) draw();
      }, 2500);
    }

    // ---- a name: a new view (Duplicate) or a view renamed ----

    // "Active Projects (1)" - or the next number free among the table's views.
    function nextName(name) {
      const base = name.replace(/ \(\d+\)$/, '');
      const taken = new Set(views.map((v) => v.name.toLowerCase()));
      let n = 1;
      while (taken.has((base + ' (' + n + ')').toLowerCase())) n++;
      return base + ' (' + n + ')';
    }

    function askName(v, dup) {
      if (busy || doc.querySelector('.dlg-bg')) return;
      const box = doc.createElement('div');
      box.className = 'dlg-bg';
      box.innerHTML =
        '<form class="dlg card" role="dialog" aria-modal="true" aria-labelledby="dlg-title"><h2 id="dlg-title">' + (dup ? 'Duplicate ' : 'Rename ') + esc(v.name) + '</h2>' +
        '<label class="k" for="dlg-name">' + (dup ? 'Name of the new view' : 'New name') + '</label>' +
        '<input id="dlg-name" maxlength="200" autocomplete="off" value="' + esc(dup ? nextName(v.name) : v.name) + '">' +
        '<p class="dim">' +
        (dup ? 'A public view with the same columns, filter and sort' : 'The name the view picker shows') +
        ' - saved, not published' + (dup && solOk && toSolution ? ', added to ' + esc(sol.name) : '') + '.</p>' +
        '<div class="row"><button type="submit" class="primary">' + (dup ? 'Create' : 'Rename') + '</button><button type="button" data-cancel>Cancel</button><span class="err" id="dlg-err"></span></div></form>';
      doc.body.appendChild(box);
      const input = box.querySelector('input');
      const err = box.querySelector('#dlg-err');
      input.focus();
      input.select();
      // Modal: what is behind it out of reach; Escape closes it, the focus goes back where it was.
      const behind = Array.from(doc.body.children).filter((el) => el !== box && !el.inert);
      behind.forEach((el) => (el.inert = true));
      const opener = dup ? 'data-dup' : 'data-rename';
      const onKey = (e) => {
        if (e.key === 'Escape' && !input.disabled) close();
      };
      const close = () => {
        box.remove();
        doc.removeEventListener('keydown', onKey);
        behind.forEach((el) => (el.inert = false));
        const b = Array.from(doc.querySelectorAll('[' + opener + ']')).find((x) => x.getAttribute(opener) === v.id) || get('apply');
        if (b && !b.disabled) b.focus({ preventScroll: true });
      };
      doc.addEventListener('keydown', onKey);
      box.addEventListener('click', (e) => {
        if (e.target === box || (e.target.closest && e.target.closest('[data-cancel]'))) close();
      });
      box.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name) return void (err.textContent = 'Give it a name.');
        if (!dup && name === v.name) return close();
        if (views.some((x) => x !== v && x.name.toLowerCase() === name.toLowerCase()) || (dup && v.name.toLowerCase() === name.toLowerCase())) {
          return void (err.textContent = 'A view of this table has this name already.');
        }
        box.querySelectorAll('button, input').forEach((x) => (x.disabled = true));
        err.innerHTML = DynaBoost.status.html('busy');
        try {
          await (dup ? duplicate(v, name) : rename(v, name));
          close();
        } catch (ex) {
          box.querySelectorAll('button, input').forEach((x) => (x.disabled = false));
          err.textContent = ex.message || 'Not saved.';
        }
      });
    }

    // A new public view: the same columns, filter and sort - saved, not published.
    async function duplicate(v, name) {
      busy = true;
      draw();
      say(DynaBoost.status.html('busy') + ' Creating ' + esc(name) + '…');
      try {
        const made = await api('savedqueries?$select=savedqueryid,name,querytype,isdefault,iscustomizable,ismanaged,layoutxml,fetchxml', {
          method: 'POST',
          body: { name: name, returnedtypecode: table, querytype: 0, isdefault: false, layoutxml: v.layoutxml, fetchxml: v.fetchxml },
          prefer: 'return=representation'
        });
        if (!made || !made.savedqueryid) throw new Error('It was created, but no id came back - reopen this tab to see it.');
        const now = await readView(api, made.savedqueryid, drafts).catch(() => made);
        const nv = viewOf(Object.assign({}, made, { name: name, querytype: 0, isdefault: false, iscustomizable: { Value: true }, layoutxml: now.layoutxml, fetchxml: now.fetchxml }));
        nv.fresh = true;
        views.push(nv);
        views.sort(byPlace);
        unpublished.add(nv.id);
        const added = await intoSolution([{ view: nv }]);
        DynaBoost.saved('view-columns', 'duplicate');
        said = DynaBoost.status.html('ok') + ' Created ' + esc(name) + '. Not published yet.' + esc(added);
      } catch (e) {
        said = DynaBoost.status.html('bad') + ' Not created - ' + esc(why(e)) + '.';
        throw e;
      } finally {
        busy = false;
        if (!tab.closed) draw();
      }
    }

    async function rename(v, name) {
      busy = true;
      draw();
      say(DynaBoost.status.html('busy') + ' Renaming ' + esc(v.name) + '…');
      const was = v.name;
      try {
        await api('savedqueries(' + v.id + ')', { method: 'PATCH', body: { name: name } });
        v.name = name;
        unpublished.add(v.id);
        const added = await intoSolution([{ view: v }]);
        said = DynaBoost.status.html('ok') + ' Renamed ' + esc(was) + ' → ' + esc(name) + '. Not published yet.' + esc(added);
      } catch (e) {
        said = DynaBoost.status.html('bad') + ' Not renamed - ' + esc(why(e)) + '.';
        throw e;
      } finally {
        busy = false;
        if (!tab.closed) draw();
      }
    }

    async function publish() {
      if (busy || !unpublished.size) return;
      busy = true;
      draw();
      say(DynaBoost.status.html('busy') + ' Publishing ' + esc(meta.label) + '…');
      let html;
      try {
        await publishTable();
        unpublished.clear();
        html = DynaBoost.status.html('ok') + ' Published ' + esc(meta.label) + '.';
      } catch (e) {
        html = DynaBoost.status.html('bad') + ' Not published - ' + esc(why(e)) + '. Open a view in its designer (Designer ↗) and publish it there.';
      }
      busy = false;
      if (tab.closed) return;
      said = html;
      draw();
    }

    function putBack(key) {
      const v = versionOf(key);
      if (!v) return;
      restoring = { key: v.key, name: v.name, map: v.map };
      picked.clear();
      for (const [id, d] of done) if (d.state === 'ok') done.delete(id);
      for (const t of views) {
        if (!t.editable) continue;
        const p = plan(t);
        if (p && !p.none && !p.error && !p.same) picked.add(t.id);
      }
      draw();
    }

    // ---- events ----
    doc.addEventListener('change', (e) => {
      const t = e.target;
      if (t.id === 'src') {
        source = views.find((v) => v.id === t.value) || source;
        picked.clear();
      } else if (t.id === 'widths') opts.widths = t.checked;
      else if (t.id === 'sort') opts.sort = t.checked;
      else if (t.id === 'filters') opts.filters = t.checked;
      else if (t.id === 'tosol') return void (toSolution = t.checked);
      else if (t.hasAttribute('data-pick')) {
        const id = t.getAttribute('data-pick');
        if (t.checked) picked.add(id);
        else picked.delete(id);
        // A tick changes its row and the footer only (and the focus stays on the box).
        const row = t.closest('.v');
        if (!row) return void draw();
        row.classList.toggle('on', t.checked);
        return void drawFoot();
      } else return;
      draw();
    });
    doc.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.hasAttribute('data-mode')) {
        opts.mode = t.getAttribute('data-mode');
        return draw();
      }
      if (t.hasAttribute('data-tab')) {
        tabView = t.getAttribute('data-tab');
        return draw();
      }
      if (t.hasAttribute('data-from')) {
        source = views.find((v) => v.id === t.getAttribute('data-from')) || source;
        picked.clear();
        tabView = 'copy';
        return draw();
      }
      if (t.id === 'vs-close') {
        showVersions = false;
        return draw();
      }
      if (t.id === 'versions') {
        showVersions = !showVersions;
        if (showVersions) loadBackups().then(() => !tab.closed && draw());
        return draw();
      }
      if (t.hasAttribute('data-ver')) return busy ? undefined : putBack(t.getAttribute('data-ver'));
      if (t.hasAttribute('data-dup') || t.hasAttribute('data-rename')) {
        e.preventDefault();
        const v = views.find((x) => x.id === (t.getAttribute('data-dup') || t.getAttribute('data-rename')));
        if (v) askName(v, t.hasAttribute('data-dup'));
        return;
      }
      if (t.id === 'leave') {
        restoring = null;
        picked.clear();
        return draw();
      }
      if (busy) return;
      if (t.id === 'apply') {
        const list = views.filter((v) => picked.has(v.id)).map((v) => Object.assign({ view: v }, plan(v))).filter((w) => !w.none && !w.error && !w.same);
        if (list.length) write(list, restoring ? 'restore' : 'apply');
        return;
      }
      if (t.id === 'undo' && undo) write(undo.map((b) => ({ view: b.view, layoutxml: b.layoutxml, fetchxml: b.fetchxml })), 'undo');
      if (t.id === 'publish') publish();
    });
    // Closing asks first while views are ticked, a save is on, or saved views are not published.
    tab.addEventListener('beforeunload', (e) => {
      if (!picked.size && !busy && !unpublished.size) return;
      e.preventDefault();
      e.returnValue = '';
    });
    // The page it was opened from asks too - only while a save is on, which it would cut short.
    const leaving = (e) => {
      if (!busy || tab.closed) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', leaving);
    tab.addEventListener('pagehide', () => window.removeEventListener('beforeunload', leaving));
    await loadBackups();
    draw();
  }

  DynaBoost.register({
    id: 'view-columns',
    name: 'Copy view columns',
    group: 'Lists and grids',
    hosts: ['make.powerapps.com'],
    when: () => !!here(),
    type: 'action',
    hint: 'This table’s views made alike: one view’s columns - and its filter, if you wish - on the others',
    icon: ICON,
    onRun: open
  });
})();
