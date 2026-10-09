/* Presenting - tools for demos and screen sharing, on every site DynaBoost
 * runs on:
 *
 * Blur data - a tile of its own: values blurred, labels left readable:
 *   fields (quick views and the header too), lists and subgrids, lookups,
 *   the timeline, the record's title. Hold Alt to read the one under the
 *   pointer. Stays on across pages and reloads until switched off.
 *
 * The Presenting tile opens a window with the two pointers:
 * Laser pointer - a red dot instead of the pointer, with a short trail and a
 *   ring on each click. This page only.
 * Spotlight - the page dims around a circle that follows the pointer, closing
 *   in on it like a lens; Alt + wheel sizes it, Shift frames the field or
 *   section under the pointer, Esc ends it. This page only.
 * Each has a switch and its own keys (two or three, set with the pencil):
 * while the switch is on, the keys turn the tool on and off on any page.
 *
 * Drawn in the page itself, so a shared screen shows them too; inside a
 * frame from another site the pointer and the keys are not seen. */
(function () {
  if (DynaBoost.off) return;
  const ICON_BLUR =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="3.5" y="5" width="17" height="14" rx="2.5" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M7 10h4M7 14h6" stroke="#3D8BFF" stroke-width="2.6" stroke-linecap="round" opacity=".45"/>' +
    '<path d="M15 10h2" stroke="#E3B04B" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const ICON_LASER =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M4 20 13 11" stroke="#3D8BFF" stroke-width="1.8" stroke-linecap="round"/>' +
    '<circle cx="16.5" cy="7.5" r="2.6" fill="#E3B04B"/>' +
    '<path d="M16.5 2.5v1.4M21.5 7.5h-1.4M20 4l-1 1" stroke="#E3B04B" stroke-width="1.5" stroke-linecap="round"/></svg>';
  const ICON_SPOT =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="3" y="3" width="18" height="18" rx="3" fill="#3D8BFF" opacity=".18"/>' +
    '<circle cx="12" cy="12" r="5" fill="#fff" stroke="#E3B04B" stroke-width="1.6"/>' +
    '<rect x="3" y="3" width="18" height="18" rx="3" stroke="#3D8BFF" stroke-width="1.6"/></svg>';

  // Above the page; under the panel (2147483000), so the panel stays usable.
  const Z_SHADE = 2147482900;
  // The laser is the pointer: above everything.
  const Z_LASER = 2147483640;
  const OURS = '#dynaboost-root, #dynaboost-toast, .db-overlay, #dynaboost-spot, #dynaboost-laser';

  function style(id, css) {
    let st = document.getElementById(id);
    if (!st) {
      st = document.createElement('style');
      st.id = id;
      (document.head || document.documentElement).appendChild(st);
    }
    st.textContent = css;
    return st;
  }

  // ---------- Blur data ----------

  /* What holds data, not what names it: the values of fields (in forms they
   * are inputs, also when read-only), list cells, lookup chips, the record's
   * title. Labels, headers and the app's own search boxes stay readable. */
  const TIMELINE = ':is([data-id*="notescontrol" i], [data-id*="timeline" i], [id*="timeline" i])';
  const ENTRY = 'li, [role="listitem"], article, [role="article"]';
  const VALUES = [
    'input:not([type="checkbox"]):not([type="radio"]):not([type="search"]):not([type="button"]):not([type="submit"]):not([role="searchbox"])',
    'textarea',
    '[contenteditable="true"]',
    '[role="textbox"]',
    '[role="combobox"]:not(input[type="search"])',
    '[role="gridcell"]',
    '[role="cell"]',
    '[data-id*="selected_tag"]',
    '[data-id="header_title"]',
    '[data-id$="_header_title"]',
    '[data-id*="RecordTitle"]',
    '[data-id*="EntityHeaderTitle"]',
    // Every field's control - on the form, in quick views, in the header -
    // whatever it is drawn with; its label is not part of it.
    '[data-id*="fieldControl" i]',
    // The timeline: whole entries - who, when, what, the records they link -
    // and what sits beside an entry's text in it: an opened record card, an
    // attachment, the picture of who wrote it.
    TIMELINE + ' :is(' + ENTRY + ')',
    TIMELINE + ' :has(> :is(' + ENTRY + ')):not([role="menubar"], [role="menu"], [role="toolbar"], [role="tablist"]) > *'
  ];
  const sel = (suffix) => VALUES.map((s) => 'html.db-blur ' + s + suffix).join(',\n');
  const notOurs = OURS.split(',').map((s) => s.trim() + ' *').join(', ');

  const BLUR_CSS =
    sel('') + ' {\n  filter: blur(6px) !important;\n  transition: filter 0.15s ease;\n}\n' +
    // Search and filter boxes the presenter types into, and DynaBoost itself.
    'html.db-blur :is([role="search"], [role="searchbox"], [type="search"]) :is(input, [role="combobox"]),\n' +
    'html.db-blur :is(' + notOurs + ') {\n  filter: none !important;\n}\n' +
    // Hold Alt: the value under the pointer only.
    sel(':hover').replace(/html\.db-blur /g, 'html.db-blur.db-blur-peek ') + ' {\n  filter: none !important;\n}\n';

  const peek = (e) => document.documentElement.classList.toggle('db-blur-peek', !!e.altKey && e.type === 'keydown');
  const unpeek = () => document.documentElement.classList.remove('db-blur-peek');

  const blur = {
    on() {
      style('dynaboost-blur-css', BLUR_CSS);
      document.documentElement.classList.add('db-blur');
      addEventListener('keydown', peek, true);
      addEventListener('keyup', peek, true);
      addEventListener('blur', unpeek);
    },
    off() {
      document.documentElement.classList.remove('db-blur', 'db-blur-peek');
      // Gone while off: the page's styles are not checked against it.
      const st = document.getElementById('dynaboost-blur-css');
      if (st) st.remove();
      removeEventListener('keydown', peek, true);
      removeEventListener('keyup', peek, true);
      removeEventListener('blur', unpeek);
    }
  };

  // ---------- Laser pointer ----------

  const LASER_CSS =
    'html.db-laser, html.db-laser * { cursor: none !important; }\n' +
    '#dynaboost-laser { position: fixed; inset: 0; z-index: ' + Z_LASER + '; pointer-events: none; }\n' +
    // Sized in CSS pixels: drawn in device pixels, it would sit off the dot
    // at any zoom or display scale but 100%.
    '#dynaboost-laser canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }\n' +
    '#dynaboost-laser .db-laser-dot { position: absolute; left: 0; top: 0; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;\n' +
    '  background: radial-gradient(circle, #fff 0 18%, #ff3b30 32% 62%, rgba(255, 59, 48, 0) 72%);\n' +
    '  box-shadow: 0 0 10px 3px rgba(255, 59, 48, 0.55); opacity: 0; transition: opacity 0.15s; will-change: transform; }\n' +
    '#dynaboost-laser.db-laser-seen .db-laser-dot { opacity: 1; }\n' +
    '#dynaboost-laser .db-laser-ring { position: absolute; width: 36px; height: 36px; margin: -18px 0 0 -18px; border: 2px solid #ff3b30; border-radius: 50%;\n' +
    '  animation: db-laser-ring 0.45s ease-out forwards; }\n' +
    '@keyframes db-laser-ring { from { transform: scale(0.3); opacity: 0.9; } to { transform: scale(1.4); opacity: 0; } }\n' +
    '@media (prefers-reduced-motion: reduce) { #dynaboost-laser .db-laser-ring { animation-duration: 0.01s; } }\n';

  const TRAIL_MS = 260;
  let laserEl = null;
  let dot = null;
  let canvas = null;
  let trail = [];
  let drawing = 0;

  function drawTrail() {
    drawing = 0;
    if (!canvas) return;
    const now = performance.now();
    trail = trail.filter((p) => now - p.t < TRAIL_MS);
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    const k = devicePixelRatio || 1;
    for (let i = 1; i < trail.length; i++) {
      const a = 1 - (now - trail[i].t) / TRAIL_MS;
      g.strokeStyle = 'rgba(255, 59, 48, ' + (0.55 * a).toFixed(3) + ')';
      g.lineWidth = 6 * a * k;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(trail[i - 1].x * k, trail[i - 1].y * k);
      g.lineTo(trail[i].x * k, trail[i].y * k);
      g.stroke();
    }
    if (trail.length > 1) drawing = requestAnimationFrame(drawTrail);
  }

  function sizeCanvas() {
    if (!canvas) return;
    const k = devicePixelRatio || 1;
    canvas.width = innerWidth * k;
    canvas.height = innerHeight * k;
  }

  function laserMove(e) {
    if (!dot) return;
    dot.style.transform = 'translate(' + e.clientX + 'px, ' + e.clientY + 'px)';
    laserEl.classList.add('db-laser-seen');
    trail.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    if (!drawing) drawing = requestAnimationFrame(drawTrail);
  }

  function laserClick(e) {
    if (!laserEl) return;
    const ring = document.createElement('div');
    ring.className = 'db-laser-ring';
    ring.style.left = e.clientX + 'px';
    ring.style.top = e.clientY + 'px';
    laserEl.appendChild(ring);
    setTimeout(() => ring.remove(), 500);
  }

  // Into a frame of another site the page cannot follow the pointer.
  const laserOut = () => laserEl && laserEl.classList.remove('db-laser-seen');

  const laser = {
    on() {
      if (laserEl) return;
      style('dynaboost-laser-css', LASER_CSS);
      laserEl = document.createElement('div');
      laserEl.id = 'dynaboost-laser';
      laserEl.setAttribute('aria-hidden', 'true');
      canvas = document.createElement('canvas');
      dot = document.createElement('div');
      dot.className = 'db-laser-dot';
      laserEl.append(canvas, dot);
      document.documentElement.appendChild(laserEl);
      sizeCanvas();
      document.documentElement.classList.add('db-laser');
      addEventListener('mousemove', laserMove, true);
      addEventListener('mousedown', laserClick, true);
      addEventListener('resize', sizeCanvas);
      document.addEventListener('mouseleave', laserOut);
    },
    off() {
      if (!laserEl) return;
      cancelAnimationFrame(drawing);
      drawing = 0;
      trail = [];
      laserEl.remove();
      laserEl = dot = canvas = null;
      document.documentElement.classList.remove('db-laser');
      removeEventListener('mousemove', laserMove, true);
      removeEventListener('mousedown', laserClick, true);
      removeEventListener('resize', sizeCanvas);
      document.removeEventListener('mouseleave', laserOut);
    }
  };

  // ---------- Spotlight ----------

  /* One element - the lit hole - with a shadow as large as the screen: a
   * circle on the pointer, or with Shift a rounded frame around the field or
   * section under it. Size, place and shape ease into each other. The circle
   * is centred by its margins, so it grows and shrinks about the pointer: on
   * it closes in from the whole screen to its size, like a lens; off it opens
   * out again, quickly. */
  const R_MIN = 50;
  const R_MAX = 420;
  const SHADE = 'rgba(6, 12, 28, 0.66)';

  const SPOT_CSS =
    '#dynaboost-spot { position: fixed; left: 0; top: 0; z-index: ' + Z_SHADE + '; pointer-events: none; box-sizing: border-box;\n' +
    '  border-radius: 50%; box-shadow: 0 0 0 200vmax ' + SHADE + ', inset 0 0 20px 8px rgba(6, 12, 28, 0.4);\n' +
    '  opacity: 0; transition: opacity 0.22s ease, width 0.18s ease, height 0.18s ease, margin 0.18s ease, border-radius 0.22s ease; will-change: transform; }\n' +
    '#dynaboost-spot.db-spot-in { opacity: 1; }\n' +
    // On: from the whole screen to its size. Off: the same way back, fast.
    '#dynaboost-spot.db-spot-wide { transition: none; }\n' +
    '#dynaboost-spot.db-spot-iris { transition: opacity 0.2s ease, width 0.55s cubic-bezier(0.22, 1, 0.36, 1), height 0.55s cubic-bezier(0.22, 1, 0.36, 1), margin 0.55s cubic-bezier(0.22, 1, 0.36, 1); }\n' +
    '#dynaboost-spot.db-spot-out { opacity: 0; transition: opacity 0.16s ease-in 0.04s, width 0.2s cubic-bezier(0.55, 0, 1, 0.45), height 0.2s cubic-bezier(0.55, 0, 1, 0.45), margin 0.2s cubic-bezier(0.55, 0, 1, 0.45); }\n' +
    // On a dark page dimming changes little: the lit part is brightened and
    // edged instead.
    '#dynaboost-spot.db-spot-dark { backdrop-filter: brightness(1.5); box-shadow: 0 0 0 200vmax rgba(0, 0, 0, 0.62), 0 0 0 1.5px rgba(255, 255, 255, 0.3), inset 0 0 18px 6px rgba(0, 0, 0, 0.3); }\n' +
    '#dynaboost-spot.db-spot-dark.db-spot-frame { box-shadow: 0 0 0 200vmax rgba(0, 0, 0, 0.62), 0 0 0 2px rgba(227, 176, 75, 0.9); }\n' +
    '#dynaboost-spot.db-spot-frame { border-radius: 12px; box-shadow: 0 0 0 200vmax ' + SHADE + ', 0 0 0 2px rgba(227, 176, 75, 0.9), inset 0 0 12px 2px rgba(6, 12, 28, 0.25);\n' +
    '  transition: opacity 0.22s ease, transform 0.2s cubic-bezier(0.22, 1, 0.36, 1), width 0.2s cubic-bezier(0.22, 1, 0.36, 1), height 0.2s cubic-bezier(0.22, 1, 0.36, 1), border-radius 0.22s ease; }\n' +
    '@media (prefers-reduced-motion: reduce) { #dynaboost-spot, #dynaboost-spot.db-spot-frame, #dynaboost-spot.db-spot-iris, #dynaboost-spot.db-spot-out { transition: opacity 0.01s; } }\n';

  // What a frame snaps to: a field with its label, a section, a row, a card.
  const BOXES =
    '[data-id$="-FieldSectionItemContainer"], [data-id$="FieldSectionItemContainer"], section, [role="row"], [role="group"], fieldset, ' +
    '[role="gridcell"], [role="listitem"], li, article, [class*="card"], [class*="Card"], td';

  let spot = null;
  let r = 150;
  let x = innerWidth / 2;
  let y = innerHeight / 2;
  let framed = false;
  let spotOff = null; // turns the tool off, for Esc
  let irisTimer = 0;
  /* Shift frames only when it is meant for that: pressed on its own, held a
   * moment, and not the Shift of the keys that turned the spotlight on (it
   * counts once it has been let go) or of the keys that turn it off. */
  const FRAME_HOLD = 180;
  let shiftFree = false;
  let frameTimer = 0;

  // A circle of radius rr about the pointer (centred by its margins).
  function circle(el, rr) {
    el.style.width = el.style.height = rr * 2 + 'px';
    el.style.margin = -rr + 'px 0 0 ' + -rr + 'px';
    el.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
  }

  // Wide enough to light the whole screen wherever the pointer is.
  const wide = () => Math.ceil(Math.hypot(innerWidth, innerHeight)) + 40;

  function place() {
    if (!spot) return;
    if (framed) {
      const el = boxAt(x, y);
      if (el) {
        const b = el.getBoundingClientRect();
        const pad = 8;
        spot.classList.remove('db-spot-iris');
        spot.style.width = b.width + pad * 2 + 'px';
        spot.style.height = b.height + pad * 2 + 'px';
        spot.style.margin = '0';
        spot.style.transform = 'translate(' + (b.left - pad) + 'px, ' + (b.top - pad) + 'px)';
        spot.classList.add('db-spot-frame');
        return;
      }
    }
    spot.classList.remove('db-spot-frame');
    circle(spot, r);
  }

  function boxAt(px, py) {
    let el = document.elementFromPoint(px, py);
    if (!el || el.closest(OURS)) return null;
    const maxW = innerWidth * 0.9;
    const maxH = innerHeight * 0.75;
    for (let n = el.closest(BOXES); n; n = n.parentElement && n.parentElement.closest(BOXES)) {
      const b = n.getBoundingClientRect();
      if (b.width >= 40 && b.height >= 18 && b.width <= maxW && b.height <= maxH) return n;
    }
    return null;
  }

  function spotMove(e) {
    x = e.clientX;
    y = e.clientY;
    // Shift let go where its keyup was not seen (another window).
    if (!e.shiftKey) {
      shiftFree = true;
      clearTimeout(frameTimer);
      framed = false;
    }
    place();
  }

  function unframe() {
    clearTimeout(frameTimer);
    if (!framed) return;
    framed = false;
    place();
  }

  function spotKey(e) {
    if (e.key === 'Escape' && spotOff) {
      spotOff();
      return;
    }
    if (e.key !== 'Shift') {
      // Another key with it: keys, not a frame.
      if (e.type === 'keydown') unframe();
      return;
    }
    if (e.type === 'keyup') {
      shiftFree = true;
      return unframe();
    }
    if (e.repeat || !shiftFree || e.altKey || e.ctrlKey || e.metaKey) return;
    clearTimeout(frameTimer);
    frameTimer = setTimeout(() => {
      if (!spot) return;
      framed = true;
      place();
    }, FRAME_HOLD);
  }

  function spotWheel(e) {
    if (!e.altKey) return;
    e.preventDefault();
    r = Math.max(R_MIN, Math.min(R_MAX, r + (e.deltaY < 0 ? 20 : -20)));
    place();
    cfg.spot.r = r;
    save();
  }

  const spotlight = {
    on(off) {
      if (spot) return;
      spotOff = off;
      style('dynaboost-spot-css', SPOT_CSS);
      spot = document.createElement('div');
      spot.id = 'dynaboost-spot';
      spot.setAttribute('aria-hidden', 'true');
      if (DynaBoost.isDark && DynaBoost.isDark()) spot.classList.add('db-spot-dark');
      // Opens on the whole screen, then closes in on the pointer.
      spot.classList.add('db-spot-wide');
      framed = false;
      shiftFree = false;
      circle(spot, wide());
      document.documentElement.appendChild(spot);
      const el = spot;
      el.getBoundingClientRect();
      requestAnimationFrame(() => {
        if (spot !== el) return;
        el.classList.remove('db-spot-wide');
        el.classList.add('db-spot-iris', 'db-spot-in');
        place();
        clearTimeout(irisTimer);
        irisTimer = setTimeout(() => el.classList.remove('db-spot-iris'), 600);
      });
      addEventListener('mousemove', spotMove, true);
      addEventListener('keydown', spotKey, true);
      addEventListener('keyup', spotKey, true);
      addEventListener('wheel', spotWheel, { capture: true, passive: false });
      addEventListener('scroll', place, true);
      addEventListener('resize', place);
    },
    off() {
      if (!spot) return;
      const el = spot;
      spot = null;
      spotOff = null;
      clearTimeout(irisTimer);
      clearTimeout(frameTimer);
      framed = false;
      // Opens out to the whole screen as it fades.
      el.classList.remove('db-spot-in', 'db-spot-iris', 'db-spot-frame');
      el.classList.add('db-spot-out');
      circle(el, wide());
      setTimeout(() => el.remove(), 240);
      removeEventListener('mousemove', spotMove, true);
      removeEventListener('keydown', spotKey, true);
      removeEventListener('keyup', spotKey, true);
      removeEventListener('wheel', spotWheel, { capture: true });
      removeEventListener('scroll', place, true);
      removeEventListener('resize', place);
    }
  };

  // ---------- settings ----------

  /* cfg: per tool, whether its keys work (on) and which keys; Spotlight's
   * size. Keys are written as event codes: "Alt+Shift+KeyL". */
  const KEY = 'dynaboost.present';
  const DEFAULTS = {
    laser: { on: false, keys: 'Alt+Shift+KeyL' },
    spot: { on: false, keys: 'Alt+Shift+KeyS', r: 150 }
  };
  const TOOLS = [
    { id: 'laser', name: 'Laser pointer', what: 'A red laser dot instead of the pointer', icon: ICON_LASER, tip: '' },
    { id: 'spot', name: 'Spotlight', what: 'Dims the page around the pointer', icon: ICON_SPOT, tip: 'Alt + wheel: size · Shift: frame a field · Esc: off' }
  ];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let cfg = clone(DEFAULTS);
  const live = { laser: false, spot: false }; // this page only

  function read(v) {
    const c = clone(DEFAULTS);
    if (!v || typeof v !== 'object') return c;
    for (const t of ['laser', 'spot']) {
      const x = v[t] || {};
      c[t].on = !!x.on;
      if (typeof x.keys === 'string' && x.keys) c[t].keys = x.keys;
    }
    const sr = Number(v.spot && v.spot.r);
    if (sr >= R_MIN && sr <= R_MAX) c.spot.r = sr;
    return c;
  }

  function save() {
    try {
      chrome.storage.local.set({ [KEY]: cfg });
    } catch (e) {
      /* kept for this page */
    }
  }

  // What the settings mean for this page.
  function apply() {
    if (live.laser && !cfg.laser.on) setLive('laser', false);
    if (live.spot && !cfg.spot.on) setLive('spot', false);
    r = cfg.spot.r;
    place();
    const armed = cfg.laser.on || cfg.spot.on;
    removeEventListener('keydown', onKeys, true);
    if (armed) addEventListener('keydown', onKeys, true);
    // Where the pointer is, so the spotlight closes in on it there.
    removeEventListener('mousemove', track, true);
    if (cfg.spot.on) addEventListener('mousemove', track, { capture: true, passive: true });
  }

  function track(e) {
    x = e.clientX;
    y = e.clientY;
  }

  function setLive(id, on) {
    live[id] = on;
    if (id === 'laser') on ? laser.on() : laser.off();
    if (id === 'spot') on ? spotlight.on(() => toggleTool('spot')) : spotlight.off();
  }

  function toggleTool(id) {
    const t = TOOLS.find((x) => x.id === id);
    setLive(id, !live[id]);
    const on = live[id];
    DynaBoost.toast(t.name + (on ? ' on' : ' off'), on ? t.tip : '');
  }

  // ---------- keys ----------

  // "Alt+Shift+KeyD" for the keys held; null while only modifiers are down.
  function comboOf(e) {
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    if (/^(Control|Alt|AltGraph|Shift|Meta|OS)$/.test(e.key) || !e.code) return { mods: parts, combo: null };
    return { mods: parts, combo: parts.concat(e.code).join('+') };
  }

  const keyName = (k) =>
    k.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ').replace(/^Arrow/, '').replace('Backquote', '`').replace('Minus', '-').replace('Equal', '=').replace('Meta', 'Win');
  const keysHtml = (combo) => combo.split('+').map((k) => '<kbd>' + keyName(k) + '</kbd>').join('<i>+</i>');
  const keysText = (combo) => combo.split('+').map(keyName).join(' + ');

  // What the browser or the keyboard keeps for itself.
  const TAKEN = ['Ctrl+KeyA', 'Ctrl+KeyC', 'Ctrl+KeyF', 'Ctrl+KeyL', 'Ctrl+KeyN', 'Ctrl+KeyP', 'Ctrl+KeyR', 'Ctrl+KeyS', 'Ctrl+KeyT', 'Ctrl+KeyV', 'Ctrl+KeyW', 'Ctrl+KeyX', 'Ctrl+KeyY', 'Ctrl+KeyZ',
    'Ctrl+Shift+KeyN', 'Ctrl+Shift+KeyT', 'Ctrl+Shift+KeyW', 'Ctrl+Shift+KeyI', 'Ctrl+Shift+KeyJ', 'Alt+Shift+KeyB', 'Alt+Shift+KeyI', 'Alt+Shift+KeyT', 'Alt+F4', 'Ctrl+F4', 'Alt+Tab'];

  function whyNot(combo, mods, id) {
    if (!mods.length) return 'Add Ctrl, Alt or Shift to the key.';
    if (combo.split('+').length > 3) return 'Three keys at most.';
    if (mods.length === 1 && mods[0] === 'Shift') return 'Shift and a key only types a capital letter – add Ctrl or Alt.';
    if (/^Ctrl\+Alt\+Key/.test(combo)) return 'Ctrl + Alt types letters on some keyboards (AltGr) – pick another.';
    if (TAKEN.indexOf(combo) >= 0) return keysText(combo) + ' is taken by the browser.';
    const other = TOOLS.find((t) => t.id !== id && cfg[t.id].keys === combo);
    if (other) return keysText(combo) + ' is already ' + other.name + '.';
    return '';
  }

  function onKeys(e) {
    if (e.repeat || recording) return;
    const { combo } = comboOf(e);
    if (!combo) return;
    const t = TOOLS.find((x) => cfg[x.id].on && cfg[x.id].keys === combo);
    if (!t) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    toggleTool(t.id);
  }

  // ---------- the window ----------

  const PENCIL =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M4 20h4L19 9l-4-4L4 16z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m13.5 6.5 4 4" stroke="currentColor" stroke-width="1.7"/></svg>';
  let recording = null; // the tool whose keys are being set
  let closeWin = null;

  function openWindow() {
    if (closeWin) return;
    DynaBoost.closePanel();
    const overlay = document.createElement('div');
    overlay.className = 'db-overlay' + (DynaBoost.isDark() ? ' db-dark' : '');
    overlay.innerHTML =
      '<div class="db-dialog db-pr" role="dialog" aria-label="Presenting">' +
      '<div class="db-dialog-head"><span>Presenting</span><button type="button" data-pr="close" aria-label="Close">✕</button></div>' +
      '<div class="db-pr-lead">Switch a pointer on, then press its keys on any page to show or hide it.</div>' +
      TOOLS.map(
        (t) =>
          '<div class="db-pr-tool" data-tool="' + t.id + '">' +
          '<div class="db-pr-row"><span class="db-pr-ic">' + t.icon + '</span>' +
          '<span class="db-pr-name"><b>' + t.name + '</b><span>' + t.what + '</span></span>' +
          '<button type="button" class="db-pr-switch" role="switch" data-pr="switch" aria-label="' + t.name + '"></button></div>' +
          '<div class="db-pr-keys"><span class="db-pr-label">Keys</span><span class="db-pr-combo" data-pr="combo"></span>' +
          '<button type="button" class="db-pr-edit" data-pr="edit" title="Set your own keys" aria-label="Set the keys of ' + t.name + '">' + PENCIL + '</button>' +
          '<span class="db-pr-live" data-pr="live"></span></div>' +
          (t.id === 'spot'
            ? '<label class="db-pr-size"><span class="db-pr-label">Size</span><input type="range" data-pr="size" min="' + R_MIN + '" max="' + R_MAX + '" step="10"></label>'
            : '') +
          '<div class="db-pr-note" data-pr="note"></div>' +
          '</div>'
      ).join('') +
      '<div class="db-pr-foot">Two or three keys, with Ctrl, Alt or Shift · Esc ends the spotlight</div>' +
      '</div>';
    document.body.appendChild(overlay);
    const box = (id) => overlay.querySelector('[data-tool="' + id + '"]');
    const part = (id, k) => box(id).querySelector('[data-pr="' + k + '"]');

    function draw() {
      for (const t of TOOLS) {
        const c = cfg[t.id];
        box(t.id).classList.toggle('db-pr-off', !c.on);
        part(t.id, 'switch').setAttribute('aria-checked', String(c.on));
        if (recording !== t.id) part(t.id, 'combo').innerHTML = keysHtml(c.keys);
        part(t.id, 'live').textContent = c.on && live[t.id] ? 'on now' : '';
      }
      const size = overlay.querySelector('[data-pr="size"]');
      if (size) size.value = cfg.spot.r;
    }

    function stopRecording() {
      if (!recording) return;
      box(recording).classList.remove('db-pr-rec');
      recording = null;
      draw();
    }

    function onKey(e) {
      if (recording) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const id = recording;
        if (e.key === 'Escape') {
          part(id, 'note').textContent = '';
          return stopRecording();
        }
        const { mods, combo } = comboOf(e);
        if (!combo) {
          part(id, 'combo').innerHTML = mods.length ? keysHtml(mods.join('+')) + '<i>+</i><em>…</em>' : '<em>Press the keys…</em>';
          return;
        }
        const why = whyNot(combo, mods, id);
        part(id, 'note').textContent = why;
        if (why) return;
        cfg[id].keys = combo;
        cfg[id].on = true;
        save();
        apply();
        stopRecording();
        return;
      }
      if (e.key === 'Escape') close();
    }

    function close() {
      stopRecording();
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      closeWin = null;
    }
    closeWin = close;

    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) return close();
      const b = e.target.closest('[data-pr]');
      if (!b) return;
      const tool = b.closest('[data-tool]');
      const id = tool && tool.getAttribute('data-tool');
      const what = b.getAttribute('data-pr');
      if (what === 'close') return close();
      if (what === 'switch') {
        stopRecording();
        cfg[id].on = !cfg[id].on;
        save();
        apply();
        draw();
      }
      if (what === 'edit') {
        const again = recording === id;
        stopRecording();
        if (again) return;
        recording = id;
        tool.classList.add('db-pr-rec');
        part(id, 'note').textContent = '';
        part(id, 'combo').innerHTML = '<em>Press the keys…</em>';
      }
    });
    overlay.querySelector('[data-pr="size"]').addEventListener('input', (e) => {
      cfg.spot.r = Number(e.target.value);
      save();
      apply();
    });
    draw();
    overlay.querySelector('[data-pr="switch"]').focus();
  }

  // ---------- start ----------

  // Only in the page itself, never in a frame of it.
  if (window.top !== window) return;

  try {
    chrome.storage.local.get(KEY, (d) => {
      cfg = read(d && d[KEY]);
      apply();
    });
    // Switched in another tab: the same here.
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local' || !ch[KEY]) return;
      cfg = read(ch[KEY].newValue);
      apply();
    });
  } catch (e) {
    /* cut off from the extension */
  }

  DynaBoost.register({
    id: 'blur-data',
    name: 'Blur data',
    group: 'Presenting',
    hint: 'Blurs values on screen – hold Alt to read one',
    icon: ICON_BLUR,
    defaultOn: false,
    onEnable: blur.on,
    onDisable: blur.off
  });

  DynaBoost.register({
    id: 'presenting',
    name: 'Presenting',
    group: 'Presenting',
    type: 'action',
    hint: 'Laser pointer and spotlight – with your keys',
    icon:
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="3.5" y="4" width="17" height="11.5" rx="1.8" stroke="#3D8BFF" stroke-width="1.6"/>' +
      '<path d="M12 15.5V20M8.5 20h7" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
      '<circle cx="12" cy="9.8" r="2.4" fill="#E3B04B"/></svg>',
    onRun: openWindow
  });
})();
