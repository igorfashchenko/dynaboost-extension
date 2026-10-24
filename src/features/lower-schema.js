/* Feature: Lowercase schema names. While on, the Schema name of a new table
 * or column - and the Name of a new choice - is kept in lower case as you
 * type: the display name "My Field" gives new_myfield, not new_MyField - and
 * one typed in by hand is lowered too. One that can no longer be changed (an
 * existing table, column or choice) is left alone. Labels in several UI
 * languages. */
(function () {
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M2.5 18 6.5 6l4 12M4 14h5" stroke="#3D8BFF" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M11.5 12h3M13.3 10.3 15 12l-1.7 1.7" stroke="#E3B04B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="19" cy="15.3" r="2.7" stroke="#3D8BFF" stroke-width="1.7"/>' +
    '<path d="M21.7 12.3V18" stroke="#3D8BFF" stroke-width="1.7" stroke-linecap="round"/>' +
    '</svg>';

  const SCHEMA_LABELS = ['schema name', 'nazwa schematu', 'schemaname', 'schema-name', 'nom du schéma', 'nombre de esquema', 'nome dello schema', 'nome schema', 'schemanaam'];
  const DISPLAY_LABELS = ['display name', 'nazwa wyświetlana', 'anzeigename', 'nom d’affichage', "nom d'affichage", 'nom complet', 'nombre para mostrar', 'nombre visible', 'nome visualizzato', 'weergavenaam'];
  // The New choice panel calls it just "Name": only there is a Name one.
  const NAME_LABELS = ['name', 'nazwa', 'nom', 'nombre', 'nome', 'naam'];
  const NEW_CHOICE = ['new choice', 'nowy wybór', 'nowa opcja', 'neue auswahl', 'nouveau choix', 'nueva opción', 'nuova scelta', 'nieuwe keuze'];
  const HEADINGS = 'h1, h2, h3, [role="heading"]';
  const PANES = '[role="dialog"], [role="complementary"], aside, .ms-Panel, [class*="Panel"], [class*="Drawer"], [class*="drawer"]';
  const TABLE_PAGES = /\/(entities|tables)(\/|$)|\/solutions\/[^/]+/i;

  // schema input -> { display, prefix, typed }
  const fields = new WeakMap();
  // Panes counted as a use, for Time saved: once each.
  const counted = new WeakSet();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;

  let on = false;
  let observer = null;
  let timer = null;

  const bare = (t) =>
    String(t || '')
      .replace(/[-*]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
      .toLowerCase();

  const isOne = (name, list) => !!name && list.some((l) => name === l || name.startsWith(l + ' '));

  // What an input is called: its <label>, aria-labelledby, aria-label, or
  // the label just before it in its field.
  function nameOf(input) {
    if (input.labels && input.labels.length) return bare(input.labels[0].textContent);
    const by = input.getAttribute('aria-labelledby');
    if (by) {
      const t = by
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((el) => el.textContent)
        .join(' ');
      if (bare(t)) return bare(t);
    }
    if (input.getAttribute('aria-label')) return bare(input.getAttribute('aria-label'));
    for (let el = input.parentElement, n = 0; el && n < 4; el = el.parentElement, n++) {
      const l = el.querySelector('label');
      if (l && !l.contains(input)) return bare(l.textContent);
    }
    return '';
  }

  // The schema name the portal makes of a display name: letters, digits and
  // underscores, no spaces.
  const slug = (t) =>
    String(t || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9_]/g, '');

  // A value put in so that the page's own code (React) takes it.
  function put(input, value) {
    if (input.value === value) return false;
    const at = input === document.activeElement ? input.selectionStart : null;
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (at !== null) {
      try {
        input.setSelectionRange(at, at);
      } catch (e) {
        /* not a text input */
      }
    }
    return true;
  }

  /* Lower case. Once we have changed it the portal stops filling the schema
   * name in from the display name - so, until it is typed in by hand, it is
   * made from the display name here: what went before the display name in
   * the portal's own value (the publisher's prefix, if the field holds it)
   * and the display name's letters and digits. */
  function lower(input) {
    const st = fields.get(input);
    if (!on || !st || input.disabled || input.readOnly) return;
    let changed;
    if (!st.typed && st.display) {
      const v = input.value;
      const s = slug(st.display.value);
      if (st.prefix === undefined && s && v.toLowerCase().endsWith(s.toLowerCase())) st.prefix = v.slice(0, v.length - s.length);
      changed = st.prefix !== undefined ? put(input, (st.prefix + s).toLowerCase()) : put(input, v.toLowerCase());
    } else changed = put(input, input.value.toLowerCase());
    if (changed) {
      const pane = input.closest(PANES) || document.body;
      if (!counted.has(pane)) {
        counted.add(pane);
        DynaBoost.saved('lower-schema');
      }
    }
  }

  function isChoicePane(pane) {
    for (const h of pane.querySelectorAll(HEADINGS)) {
      const t = bare(h.textContent);
      if (t.length <= 40 && NEW_CHOICE.includes(t)) return true;
    }
    return NEW_CHOICE.includes(bare(pane.getAttribute('aria-label')));
  }

  function scan() {
    if (!on) return;
    const roots = Array.from(document.querySelectorAll(PANES));
    // The table pages may show the properties outside any pane.
    if (TABLE_PAGES.test(location.pathname) && document.body) roots.push(document.body);
    for (const root of roots) {
      let display = null;
      const choice = root !== document.body && isChoicePane(root);
      for (const input of root.querySelectorAll('input[type="text"], input:not([type])')) {
        const name = nameOf(input);
        if (isOne(name, DISPLAY_LABELS)) display = input;
        const schema = isOne(name, SCHEMA_LABELS) || (choice && NAME_LABELS.includes(name));
        if (!schema || fields.has(input) || input.disabled || input.readOnly) continue;
        const st = { display: display, prefix: undefined, typed: false };
        fields.set(input, st);
        // Typed in by hand: lower case too, and no longer made from the display name.
        input.addEventListener('input', (e) => {
          if (!e.isTrusted) return;
          st.typed = true;
          lower(input);
        });
        if (display) {
          display.addEventListener('input', (e) => {
            // After the portal has filled the schema name in from it.
            if (e.isTrusted) setTimeout(() => lower(input), 30);
          });
        }
        lower(input);
      }
    }
  }

  function schedule() {
    clearTimeout(timer);
    // After React has drawn the panel and its values.
    timer = setTimeout(scan, 250);
  }

  DynaBoost.register({
    id: 'lower-schema',
    name: 'Lowercase schema names',
    group: 'Tables and columns',
    hosts: ['make.powerapps.com'],
    when: () => TABLE_PAGES.test(location.pathname),
    hint: 'Schema names of new tables and columns in lower case',
    icon: ICON,
    onEnable() {
      on = true;
      if (observer) return;
      observer = new MutationObserver(schedule);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      schedule();
    },
    onDisable() {
      on = false;
      if (!observer) return;
      observer.disconnect();
      observer = null;
      clearTimeout(timer);
    }
  });
})();
