/* Feature: Open on All. The Tables page of make.powerapps.com opens on
 * "Recommended" and the Apps page on "My apps"; this picks "All" once per
 * visit, in every environment. The tab is found by its label (several UI
 * languages) and only in a row of tabs holding a known neighbour, so no other
 * "All" on the page is touched. Elsewhere a mutation costs one path test.
 */
(function () {
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M3.5 9.5h17M9.5 9.5v10" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M12.5 13h5M12.5 16.2h5" stroke="#E3B04B" stroke-width="1.6" stroke-linecap="round"/>' +
    '</svg>';

  const ALL = ['all', 'wszystkie', 'alle', 'tout', 'toutes', 'tous', 'todo', 'todos', 'todas', 'tutto', 'tutti', 'tutte'];
  const PAGES = [
    {
      // Tables: Recommended | Custom | All
      path: /^\/environments\/[^/]+\/(entities|tables)\/?$/i,
      all: ALL,
      near: [
        'recommended', 'custom',
        'zalecane', 'polecane', 'niestandardowe',
        'empfohlen', 'benutzerdefiniert',
        'recommandé', 'recommandées', 'personnalisé', 'personnalisées',
        'recomendado', 'recomendadas', 'personalizado', 'personalizadas',
        'consigliate', 'consigliati', 'personalizzate', 'personalizzati',
        'aanbevolen', 'aangepast'
      ]
    },
    {
      // Apps: My apps | Shared with me | All
      path: /^\/environments\/[^/]+\/apps\/?$/i,
      all: ALL.concat([
        'all apps', 'wszystkie aplikacje', 'alle apps', 'toutes les applications', 'todas las aplicaciones',
        'tutte le app', 'alle apps'
      ]),
      near: [
        'my apps', 'shared with me', 'recent', 'recent apps',
        'moje aplikacje', 'udostępnione mi', 'ostatnie',
        'meine apps', 'für mich freigegeben', 'zuletzt verwendet',
        'mes applications', 'partagées avec moi', 'récentes',
        'mis aplicaciones', 'compartidas conmigo', 'recientes',
        'le mie app', 'condivise con me', 'recenti',
        'mijn apps', 'met mij gedeeld', 'recent'
      ]
    }
  ];
  const TABS = 'button, [role="tab"], [role="radio"], [role="menuitemradio"]';
  const STATES = ['aria-selected', 'aria-checked', 'aria-pressed'];

  const page = () => PAGES.find((p) => p.path.test(location.pathname));
  // A tab's label, without a count after it: "All (345)" is "all".
  const label = (el) =>
    (el.textContent || '')
      .replace(/\s+/g, ' ')
      .replace(/\s*\(\d[\d\s.,]*\)$/, '')
      .trim()
      .toLowerCase();

  let observer = null;
  let timer = null;
  let seen = ''; // the page we are on
  let done = ''; // the page "All" was picked on
  let tries = 0;

  // "All" in its own row of tabs - the nearest parent holding more than it -
  // next to a neighbour the page is known by.
  function findAll(pg) {
    for (const el of document.querySelectorAll(TABS)) {
      if (!pg.all.includes(label(el)) || !el.getClientRects().length) continue;
      let box = el.parentElement;
      for (let up = 0; box && up < 4 && box.querySelectorAll(TABS).length < 2; up++) box = box.parentElement;
      const row = box ? [...box.querySelectorAll(TABS)] : [];
      if (row.length >= 2 && row.length <= 6 && row.some((t) => t !== el && pg.near.includes(label(t)))) return el;
    }
    return null;
  }

  function apply() {
    const pg = page();
    if (!pg || done === location.pathname) return;
    const all = findAll(pg);
    if (!all) return; // not drawn yet - the next mutation asks again
    const readable = STATES.some((a) => all.hasAttribute(a));
    if (readable && STATES.some((a) => all.getAttribute(a) === 'true')) {
      done = location.pathname;
      return;
    }
    // A tab that says nothing about itself gets one click; one that does, up
    // to three, in case the first came before the page was listening.
    all.click();
    if (!readable || ++tries >= 3) done = location.pathname;
    else schedule(600);
  }

  function schedule(wait) {
    clearTimeout(timer);
    timer = setTimeout(apply, wait);
  }

  function onMutation() {
    if (location.pathname !== seen) {
      // Another page, or another environment's: a new visit.
      seen = location.pathname;
      done = '';
      tries = 0;
    }
    if (done !== seen && page()) schedule(150);
  }

  DynaBoost.register({
    id: 'open-all',
    name: 'Open on All',
    group: 'Lists and grids',
    hosts: ['make.powerapps.com'],
    when: () => !!page(),
    hint: 'The Tables and Apps pages open on "All" instead of "Recommended" and "My apps" - in every environment, each time you come to them',
    icon: ICON,
    defaultOn: true,
    onEnable() {
      if (observer) return;
      seen = '';
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
