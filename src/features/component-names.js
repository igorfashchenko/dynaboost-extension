/* Feature: Component names. A switch for the form designer of the maker
 * portal. While on, the Name of a tab, section, subgrid or other component
 * follows its Label each time the label is typed or pasted - new components
 * and ones made before: three letters for what it is, then the label in
 * lower case with _ for spaces - Label "Report Parameters" on a section
 * gives sec_report_parameters, "General" on a tab tab_general. Any other
 * component with a Name of its own gets three letters from its pane's title
 * (Knowledge search: kse_...). A field has none - its name is its column's.
 *
 * Typing in the Name field itself stops it for that component, until the
 * page is opened again or the Name is emptied. What a component is comes
 * from its pane - the word under its title ("Section", "Read Only Grid") -
 * else from the name the designer gave it, or the three letters it got
 * before. It listens to the
 * typing itself, in the page and in the frames of it that it may reach, so
 * it does not depend on how the pane is drawn.
 * Labels in several UI languages. */
(function () {
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M3.5 9h17" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M7 13.5h4.5M7 16.5h7" stroke="#E3B04B" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="M15.5 12.5 17 14l-1.5 1.5" stroke="#E3B04B" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  const LABEL_LABELS = ['label', 'etykieta', 'bezeichnung', 'étiquette', 'etiquette', 'etiqueta', 'etichetta'];
  const NAME_LABELS = ['name', 'nazwa', 'nom', 'nombre', 'nome', 'naam'];

  // What a component is, three letters each: by the word its pane names it with, or the designer's name for it.
  const KINDS = [
    { prefix: 'tab', words: ['tab', 'karta', 'registerkarte', 'onglet', 'pestaña', 'scheda'], name: /^tab_?\d+$/i },
    { prefix: 'sec', words: ['section', 'sekcja', 'abschnitt', 'sección', 'sezione', 'sectie'], name: /^(tab_?\d+_)?section_?\d+$/i },
    { prefix: 'sub', words: ['subgrid', 'sub-grid', 'read only grid', 'read-only grid', 'editable grid', 'podsiatka', 'siatka podrzędna', 'siatka tylko do odczytu', 'siatka edytowalna', 'untergeordnetes raster', 'sous-grille', 'subcuadrícula'], name: /^subgrid_/i },
    { prefix: 'qvw', words: ['quick view', 'quick view form', 'widok szybki', 'formularz szybkiego podglądu'], name: /^quickview/i },
    { prefix: 'wrs', words: ['web resource', 'html web resource', 'zasób sieci web'], name: /^webresource_/i },
    { prefix: 'ifr', words: ['iframe', 'external website'], name: /^iframe_/i },
    { prefix: 'tml', words: ['timeline', 'oś czasu'], name: /^timeline/i },
    { prefix: 'spc', words: ['spacer', 'odstęp'], name: /^spacer/i },
    { prefix: 'cvs', words: ['canvas app', 'aplikacja kanwy'], name: /^canvasapp/i }
  ];

  const hand = new WeakSet(); // Name fields typed in by hand
  const counted = new WeakSet();
  let on = false;
  let frames = 0;
  let told = false;

  const bare = (t) =>
    String(t || '')
      .replace(/[*]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
      .toLowerCase();

  // A label's own words - without its info button, icon or tooltip (Name * ⓘ).
  function words(el) {
    const copy = el.cloneNode(true);
    for (const x of copy.querySelectorAll('button, svg, [role="tooltip"], [role="button"], [hidden], [aria-hidden="true"]')) x.remove();
    return bare(copy.textContent);
  }

  // What an input is called: its <label>, aria-labelledby, aria-label, or the label just before it.
  function nameOf(input) {
    const doc = input.ownerDocument;
    if (input.labels && input.labels.length && words(input.labels[0])) return words(input.labels[0]);
    const by = input.getAttribute('aria-labelledby');
    if (by) {
      const t = by
        .split(/\s+/)
        .map((id) => doc.getElementById(id))
        .filter(Boolean)
        .map(words)
        .join(' ');
      if (bare(t)) return bare(t);
    }
    if (input.getAttribute('aria-label')) return bare(input.getAttribute('aria-label'));
    for (let el = input.parentElement, n = 0; el && n < 4; el = el.parentElement, n++) {
      const l = el.querySelector('label');
      if (l && !l.contains(input)) return words(l);
    }
    return '';
  }

  // "Name", also "Name Unique name" when a hint's words come along.
  const is = (input, list) => {
    const t = nameOf(input);
    return list.some((w) => t === w || (t.startsWith(w + ' ') && t.length <= w.length + 30));
  };

  // "Report Parameters" -> report_parameters: letters and digits, _ between.
  const slug = (t) =>
    String(t || '')
      .replace(/ł/g, 'l')
      .replace(/Ł/g, 'L')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80);

  // A value put in so that the designer's own code (React) takes it - with the setter of the input's own window.
  function put(input, value) {
    if (input.value === value) return false;
    const proto = input.ownerDocument.defaultView.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  /* Three letters for a kind not in the list, from the pane's title:
   * "Knowledge search" kse, "Map" map, "Address input control" aic. */
  function prefixOf(title) {
    const w = slug(title).split('_').filter((x) => /^[a-z]/.test(x));
    if (!w.length) return '';
    if (w.length >= 3) return w[0][0] + w[1][0] + w[2][0];
    if (w.length === 2) return (w[0][0] + w[1].slice(0, 2)).padEnd(3, w[1][0]);
    return w[0].slice(0, 3);
  }

  const isInput = (el) => !!el && el.tagName === 'INPUT' && (!el.type || el.type === 'text');
  const inputsIn = (box) => Array.from(box.querySelectorAll('input')).filter(isInput);

  // The Name field beside a Label field: in the nearest box that holds both.
  function pairOf(label) {
    let box = label.parentElement;
    for (let n = 0; box && n < 10; n++, box = box.parentElement) {
      const name = inputsIn(box).find((x) => x !== label && is(x, NAME_LABELS));
      if (name) return { name: name, box: box };
    }
    return null;
  }

  // The pane's own words, not what a component is.
  const UI_WORDS = ['properties', 'właściwości', 'display options', 'opcje wyświetlania', 'formatting', 'formatowanie', 'events', 'zdarzenia', 'components', 'składniki'];

  /* What the component is: the designer's own name for it (tab_3_section_1),
   * else the kind's word nearest above the Label field ("Section" under the
   * title - never a text further down the pane), else the three letters it
   * got before (sec_...), else three letters from the line under the pane's
   * title (the pane says what the component is there: "Knowledge search"). */
  function kindOf(box, name, label) {
    const value = name.value || '';
    const byDefault = KINDS.find((x) => x.name.test(value));
    if (byDefault) return byDefault;
    // The pane: as far up as no other component's Label field comes in.
    let pane = box;
    for (let el = box, n = 0; el && n < 12; el = el.parentElement, n++) {
      if (inputsIn(el).filter((x) => is(x, LABEL_LABELS)).length > 1) break;
      pane = el;
    }
    // The short visible lines above the Label field: the title, then the kind.
    const lines = [];
    for (const t of pane.querySelectorAll('h1, h2, h3, h4, [role="heading"], span, div, p')) {
      if (t.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_PRECEDING) break;
      if (t.children.length || t.closest('input, select, textarea, button, label, [role="tooltip"], [hidden], [aria-hidden="true"]')) continue;
      if (!t.getClientRects().length) continue;
      const text = bare(t.textContent);
      if (text && text.length <= 40 && !UI_WORDS.includes(text)) lines.push(text);
    }
    for (let i = lines.length - 1; i >= 0; i--) {
      const k = KINDS.find((x) => x.words.includes(lines[i]));
      if (k) return k;
    }
    const before = KINDS.find((x) => value.toLowerCase().startsWith(x.prefix + '_'));
    if (before) return before;
    const p = lines.length >= 2 ? prefixOf(lines[1]) : lines.length ? prefixOf(lines[0]) : '';
    return p.length === 3 ? { prefix: p } : null;
  }

  /* The designer keeps a Name only when its field loses focus (Tab out of
   * it); one only put in is gone when another component is opened. So the
   * Name gets a focus and a blur of its own - a moment after the typing stops,
   * and at once when the Label is left. */
  function commit(name) {
    const win = name.ownerDocument.defaultView;
    name.dispatchEvent(new win.FocusEvent('focus'));
    name.dispatchEvent(new win.FocusEvent('focusin', { bubbles: true }));
    name.dispatchEvent(new win.FocusEvent('blur'));
    name.dispatchEvent(new win.FocusEvent('focusout', { bubbles: true }));
  }

  // The Label being typed in: its Name to follow, and to keep.
  let waiting = null; // { label, follow, keep }

  function flush() {
    const w = waiting;
    waiting = null;
    if (!w) return;
    clearTimeout(w.follow);
    clearTimeout(w.keep);
    const name = follow(w.label);
    if (name) commit(name);
  }

  // The Name after the Label: put in, and the field it went to.
  function follow(el) {
    const pair = pairOf(el);
    if (!pair) {
      if (!told) console.info('[DynaBoost] Component names: no Name field found beside this Label.', el);
      told = true;
      return null;
    }
    if (pair.name.disabled || pair.name.readOnly) return null;
    if (hand.has(pair.name) && pair.name.value.trim()) return null;
    const kind = kindOf(pair.box, pair.name, el);
    const s = slug(el.value);
    if (!kind || !s) return null;
    if (put(pair.name, kind.prefix + '_' + s) && !counted.has(pair.name)) {
      counted.add(pair.name);
      DynaBoost.saved('component-names');
    }
    return pair.name;
  }

  // Typed or pasted in a Label: its Name follows - after the designer has taken the label.
  function onInput(e) {
    const el = e.target;
    if (!on || !e.isTrusted || !isInput(el)) return;
    if (is(el, NAME_LABELS)) {
      // A name typed by hand stays; one cleared follows the label again.
      if (el.value.trim()) hand.add(el);
      else hand.delete(el);
      return;
    }
    if (!is(el, LABEL_LABELS)) return;
    if (waiting && waiting.label !== el) flush();
    if (waiting) {
      clearTimeout(waiting.follow);
      clearTimeout(waiting.keep);
    }
    const w = (waiting = { label: el });
    w.follow = setTimeout(() => follow(el), 30);
    w.keep = setTimeout(() => waiting === w && flush(), 600);
  }

  // The Label left (Tab, a click on another component): its Name kept first.
  function onLeave(e) {
    if (waiting && e.target === waiting.label) flush();
  }

  // The page, and every frame of it this page may reach - the designer may draw in one.
  function listen(doc) {
    if (!doc || doc.__dbComponentNames) return;
    doc.__dbComponentNames = true;
    doc.addEventListener('input', onInput, true);
    doc.addEventListener('focusout', onLeave, true);
  }

  function reachFrames() {
    for (const f of document.querySelectorAll('iframe')) {
      try {
        listen(f.contentDocument);
      } catch (e) {
        /* another site's frame */
      }
    }
  }

  DynaBoost.register({
    id: 'component-names',
    name: 'Component names',
    group: 'Automatic',
    hosts: ['make.powerapps.com'],
    when: () => /\/form\/edit\//i.test(location.pathname),
    hint: 'In the form designer, a tab, section or subgrid takes its name from its label: sec_report_parameters',
    icon: ICON,
    onEnable() {
      on = true;
      listen(document);
      reachFrames();
      if (!frames) frames = setInterval(reachFrames, 2000);
    },
    onDisable() {
      flush();
      on = false;
      clearInterval(frames);
      frames = 0;
    }
  });
})();
