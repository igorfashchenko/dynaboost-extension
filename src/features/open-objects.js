/* Feature: Open on Objects. A solution of make.powerapps.com opens on its
 * Overview; this picks Objects in the solution's left pane when you come into
 * a solution - once per visit: Overview chosen afterwards stays, until you
 * leave the solution and come into one again. As Open on All: the item is
 * found by its words (several UI languages) - its own text, whatever the
 * pane wraps it in (an icon, a count, a tree item holding its children) -
 * and only next to a neighbour the pane is known by (Overview, History), so
 * no other "Objects" on the page is touched. It is clicked where you would
 * click it. Elsewhere a mutation costs one path test.
 */
(function () {
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M8.5 4.5v15" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M11.5 9h6M11.5 12h6M11.5 15h4" stroke="#E3B04B" stroke-width="1.6" stroke-linecap="round"/>' +
    '</svg>';

  const OBJECTS = ['objects', 'obiekty', 'objekte', 'objets', 'objetos', 'oggetti', 'objecten'];
  const OVERVIEW = ['overview', 'przegląd', 'übersicht', "vue d'ensemble", 'vue d’ensemble', 'información general', 'descripción general', 'panoramica', 'overzicht'];
  const NEAR = [
    'overview', 'history', 'pipelines', 'source control',
    'przegląd', 'historia', 'potoki',
    'übersicht', 'verlauf', 'pipelines',
    "vue d'ensemble", 'vue d’ensemble', 'historique',
    'información general', 'descripción general', 'historial', 'canalizaciones',
    'panoramica', 'cronologia', 'pipeline',
    'overzicht', 'geschiedenis'
  ];
  // What a click on a pane item lands on: the item itself or a part of it.
  const CLICKABLE = 'a, button, [role="link"], [role="tab"], [role="treeitem"], [role="menuitem"], [role="option"], [role="button"], [tabindex]';
  // A link straight to another part of the solution: come in there, left as it is.
  const ELSEWHERE = /^\/(objects|entities|tables|apps|flows|history|pipelines|source|sourcecontrol|git|catalog|components)\b/;

  // In a solution: /environments/{env}/solutions/{id}[/...].
  const SOLUTION = /^\/(?:environments|e)\/([^/]+)\/(?:solutions|s)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/.*)?$/i;
  const here = () => {
    const m = location.pathname.match(SOLUTION);
    return m ? { key: (m[1] + '/' + m[2]).toLowerCase(), rest: (m[3] || '').replace(/\/+$/, '').toLowerCase() } : null;
  };

  /* An item's words alone: no icon glyph (the portal's font icons are
   * characters of their own), no count - "Objects (24)" is "objects". */
  const label = (el) =>
    (el.textContent || '')
      .replace(/\(\s*\d[\d\s.,]*\)/g, ' ')
      .replace(/[^\p{L}\p{N}'’ ]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  const shown = (el) => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';

  /* The elements whose own text is one of the words - what you click on when
   * you click the item, also when it holds more (a tree item and its
   * children, an icon, a count). Text by text: cheap on a big page. */
  function leaves(words, within) {
    const out = [];
    const walk = document.createTreeWalker(within || document.body, NodeFilter.SHOW_TEXT);
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      const v = t.nodeValue;
      if (!v || v.length > 60 || !words.includes(label({ textContent: v }))) continue;
      const el = t.parentElement;
      if (!el || el.closest('#dynaboost-root, script, style') || !shown(el)) continue;
      if (!out.includes(el)) out.push(el);
    }
    return out;
  }

  const SELECTED = (el) => {
    for (let n = el, up = 0; n && up < 4; n = n.parentElement, up++) {
      if (n.getAttribute('aria-current') && n.getAttribute('aria-current') !== 'false') return true;
      if (n.getAttribute('aria-selected') === 'true') return true;
    }
    return false;
  };

  let observer = null;
  let timer = null;
  let visit = ''; // the solution we are in
  let done = ''; // the solution Objects was picked in - or left as it was
  let tries = 0;

  /* The solution's own pane: "Objects" with a neighbour the pane is known by
   * (Overview, History...) close by - the nearest such pair, so another
   * "Objects" on the page (a heading, a card) is never the one. It must be
   * something you can click: an item, or a part of one. */
  function findPane() {
    let best = null;
    for (const el of leaves(OBJECTS)) {
      const hit = el.closest(CLICKABLE);
      if (!hit && getComputedStyle(el).cursor !== 'pointer') continue;
      let box = el.parentElement;
      for (let up = 1; box && up <= 7; up++, box = box.parentElement) {
        const near = leaves(NEAR, box).filter((n) => !n.contains(el) && !el.contains(n));
        if (!near.length) continue;
        if (leaves(OBJECTS, box).length > 1) break; // more than the pane
        if (!best || up < best.up) best = { el: el, up: up, near: near };
        break;
      }
    }
    return best;
  }

  /* On the Overview: the address says so, or - an address of another form -
   * the pane shows Overview picked. */
  function overview(h, pane) {
    if (h.rest === '' || h.rest === '/overview') return true;
    if (ELSEWHERE.test(h.rest)) return false;
    return !!pane && pane.near.some((n) => OVERVIEW.includes(label(n)) && SELECTED(n));
  }

  function apply() {
    const h = here();
    if (!h || done === h.key) return;
    // Come in somewhere else than the Overview (a link to Objects, History...): left as it is.
    if (ELSEWHERE.test(h.rest)) {
      done = h.key;
      return;
    }
    const pane = findPane();
    if (!pane) return; // not drawn yet - the next mutation asks again
    if (SELECTED(pane.el) || !overview(h, pane)) {
      done = h.key;
      return;
    }
    // Clicked where you would click: its words - the item hears it as yours.
    pane.el.click();
    if (++tries === 1) DynaBoost.saved('open-objects');
    // Asked again in a moment: clicked before the page was listening, the address has not moved.
    if (tries >= 3) done = h.key;
    else schedule(700);
  }

  function schedule(wait) {
    clearTimeout(timer);
    timer = setTimeout(apply, wait);
  }

  function onMutation() {
    const h = here();
    const key = h ? h.key : '';
    if (key !== visit) {
      // Another solution, or out of the solutions: the next one is a new visit.
      visit = key;
      done = '';
      tries = 0;
    }
    if (h && done !== h.key) schedule(150);
  }

  DynaBoost.register({
    id: 'open-objects',
    name: 'Open on Objects',
    group: 'Automatic',
    hosts: ['make.powerapps.com'],
    when: () => !!here(),
    hint: 'A solution opens on Objects, not Overview',
    icon: ICON,
    defaultOn: false,
    onEnable() {
      if (observer) return;
      // Switched on in the panel inside a solution: that one is left as it
      // is. On at the start (a page opened, a reload): this is coming in.
      const root = document.getElementById('dynaboost-root');
      const h = here();
      visit = h ? h.key : '';
      done = root && root.classList.contains('db-open') ? visit : '';
      tries = 0;
      observer = new MutationObserver(onMutation);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      onMutation();
    },
    onDisable() {
      if (!observer) return;
      observer.disconnect();
      observer = null;
      clearTimeout(timer);
    }
  });
})();
