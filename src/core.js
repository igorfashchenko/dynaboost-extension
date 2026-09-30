/* DynaBoost core: the feature registry, the state of toggles
 * (chrome.storage.local), which features belong to the current page, and
 * the panel, which opens and closes with the toolbar icon.
 *
 * A tile is a 'toggle' (onEnable / onDisable) or an 'action' (onRun).
 * `hosts` limits it to some sites and `when()` to some pages - checked each
 * time the panel opens, since these sites navigate without reloading. A
 * toggle keeps running on every page of its hosts. "Show all" lists the other
 * tiles too, dimmed and inert.
 *
 * A new feature: src/features/<name>.js calls DynaBoost.register({ ... }) and
 * is listed in manifest.json under content_scripts.js (background.js reads
 * the same list). */
(function () {
  if (window.DynaBoost) return;

  const STORAGE_KEY = 'dynaboost.features';
  const SHOW_ALL_KEY = 'dynaboost.showAll';
  const THEME_KEY = 'dynaboost.theme'; // { mode, browser }: the header button's choice, and the browser's mode it was made in
  const HELP_TILES_KEY = 'dynaboost.helpTiles'; // the tiles' names and icons, for the help page
  const ICON_URL = chrome.runtime.getURL('icons/icon48.png');

  /* Say thanks: the heart in the footer. A coin whose address is empty is
   * listed as coming soon. */
  const THANKS = {
    stripe: 'https://buy.stripe.com/7sY3cv53q7C04Ld3sc3cc00',
    // The Stripe link as a QR code (tools/qr-path.py). Shown only while "for"
    // is the link above.
    stripeQr: {
      for: 'https://buy.stripe.com/7sY3cv53q7C04Ld3sc3cc00',
      size: 33,
      path: 'M0 0h7v1h-7zM8 0h1v1h-1zM10 0h2v1h-2zM13 0h3v1h-3zM18 0h2v1h-2zM21 0h1v1h-1zM23 0h1v1h-1zM26 0h7v1h-7zM0 1h1v1h-1zM6 1h1v1h-1zM9 1h2v1h-2zM15 1h3v1h-3zM20 1h2v1h-2zM23 1h2v1h-2zM26 1h1v1h-1zM32 1h1v1h-1zM0 2h1v1h-1zM2 2h3v1h-3zM6 2h1v1h-1zM8 2h1v1h-1zM10 2h1v1h-1zM13 2h3v1h-3zM17 2h4v1h-4zM22 2h1v1h-1zM24 2h1v1h-1zM26 2h1v1h-1zM28 2h3v1h-3zM32 2h1v1h-1zM0 3h1v1h-1zM2 3h3v1h-3zM6 3h1v1h-1zM8 3h4v1h-4zM15 3h1v1h-1zM20 3h1v1h-1zM22 3h2v1h-2zM26 3h1v1h-1zM28 3h3v1h-3zM32 3h1v1h-1zM0 4h1v1h-1zM2 4h3v1h-3zM6 4h1v1h-1zM10 4h1v1h-1zM12 4h1v1h-1zM14 4h2v1h-2zM17 4h1v1h-1zM20 4h1v1h-1zM26 4h1v1h-1zM28 4h3v1h-3zM32 4h1v1h-1zM0 5h1v1h-1zM6 5h1v1h-1zM8 5h2v1h-2zM13 5h3v1h-3zM18 5h2v1h-2zM21 5h2v1h-2zM26 5h1v1h-1zM32 5h1v1h-1zM0 6h7v1h-7zM8 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM14 6h1v1h-1zM16 6h1v1h-1zM18 6h1v1h-1zM20 6h1v1h-1zM22 6h1v1h-1zM24 6h1v1h-1zM26 6h7v1h-7zM8 7h2v1h-2zM11 7h9v1h-9zM21 7h4v1h-4zM1 8h1v1h-1zM3 8h1v1h-1zM5 8h5v1h-5zM12 8h1v1h-1zM14 8h1v1h-1zM16 8h1v1h-1zM18 8h1v1h-1zM21 8h1v1h-1zM23 8h1v1h-1zM25 8h3v1h-3zM29 8h2v1h-2zM32 8h1v1h-1zM1 9h1v1h-1zM5 9h1v1h-1zM7 9h1v1h-1zM13 9h1v1h-1zM17 9h1v1h-1zM20 9h3v1h-3zM24 9h4v1h-4zM1 10h1v1h-1zM3 10h4v1h-4zM8 10h3v1h-3zM13 10h3v1h-3zM18 10h2v1h-2zM22 10h1v1h-1zM24 10h5v1h-5zM30 10h1v1h-1zM32 10h1v1h-1zM0 11h1v1h-1zM2 11h3v1h-3zM11 11h1v1h-1zM14 11h1v1h-1zM16 11h1v1h-1zM20 11h2v1h-2zM23 11h2v1h-2zM28 11h2v1h-2zM2 12h1v1h-1zM4 12h3v1h-3zM10 12h2v1h-2zM13 12h2v1h-2zM16 12h1v1h-1zM18 12h1v1h-1zM20 12h4v1h-4zM25 12h3v1h-3zM29 12h1v1h-1zM32 12h1v1h-1zM0 13h2v1h-2zM7 13h4v1h-4zM15 13h2v1h-2zM19 13h3v1h-3zM25 13h8v1h-8zM1 14h2v1h-2zM5 14h2v1h-2zM11 14h4v1h-4zM17 14h1v1h-1zM20 14h9v1h-9zM30 14h2v1h-2zM0 15h1v1h-1zM3 15h3v1h-3zM7 15h3v1h-3zM11 15h1v1h-1zM15 15h2v1h-2zM18 15h1v1h-1zM21 15h1v1h-1zM23 15h1v1h-1zM26 15h1v1h-1zM29 15h1v1h-1zM31 15h1v1h-1zM1 16h2v1h-2zM4 16h3v1h-3zM11 16h5v1h-5zM19 16h4v1h-4zM24 16h1v1h-1zM26 16h1v1h-1zM28 16h2v1h-2zM31 16h1v1h-1zM2 17h2v1h-2zM8 17h2v1h-2zM11 17h1v1h-1zM13 17h3v1h-3zM18 17h1v1h-1zM21 17h1v1h-1zM23 17h1v1h-1zM25 17h1v1h-1zM27 17h1v1h-1zM29 17h1v1h-1zM2 18h1v1h-1zM5 18h2v1h-2zM10 18h4v1h-4zM15 18h1v1h-1zM17 18h1v1h-1zM20 18h3v1h-3zM26 18h1v1h-1zM30 18h3v1h-3zM3 19h3v1h-3zM11 19h2v1h-2zM14 19h1v1h-1zM17 19h1v1h-1zM19 19h3v1h-3zM23 19h1v1h-1zM25 19h1v1h-1zM27 19h1v1h-1zM31 19h2v1h-2zM0 20h1v1h-1zM2 20h1v1h-1zM6 20h2v1h-2zM11 20h2v1h-2zM14 20h1v1h-1zM17 20h3v1h-3zM21 20h1v1h-1zM27 20h1v1h-1zM31 20h1v1h-1zM1 21h3v1h-3zM5 21h1v1h-1zM8 21h2v1h-2zM12 21h4v1h-4zM20 21h1v1h-1zM22 21h1v1h-1zM26 21h2v1h-2zM29 21h1v1h-1zM31 21h2v1h-2zM0 22h4v1h-4zM5 22h2v1h-2zM8 22h2v1h-2zM12 22h1v1h-1zM15 22h1v1h-1zM19 22h1v1h-1zM25 22h2v1h-2zM28 22h2v1h-2zM32 22h1v1h-1zM1 23h2v1h-2zM4 23h2v1h-2zM11 23h1v1h-1zM14 23h3v1h-3zM18 23h1v1h-1zM20 23h4v1h-4zM25 23h1v1h-1zM29 23h1v1h-1zM31 23h1v1h-1zM0 24h1v1h-1zM2 24h2v1h-2zM6 24h2v1h-2zM13 24h1v1h-1zM16 24h2v1h-2zM20 24h2v1h-2zM24 24h5v1h-5zM31 24h1v1h-1zM8 25h2v1h-2zM12 25h2v1h-2zM16 25h1v1h-1zM19 25h1v1h-1zM21 25h1v1h-1zM24 25h1v1h-1zM28 25h2v1h-2zM31 25h2v1h-2zM0 26h7v1h-7zM8 26h3v1h-3zM13 26h4v1h-4zM18 26h1v1h-1zM20 26h3v1h-3zM24 26h1v1h-1zM26 26h1v1h-1zM28 26h3v1h-3zM0 27h1v1h-1zM6 27h1v1h-1zM8 27h2v1h-2zM11 27h1v1h-1zM13 27h1v1h-1zM17 27h6v1h-6zM24 27h1v1h-1zM28 27h1v1h-1zM32 27h1v1h-1zM0 28h1v1h-1zM2 28h3v1h-3zM6 28h1v1h-1zM10 28h1v1h-1zM12 28h2v1h-2zM17 28h3v1h-3zM21 28h2v1h-2zM24 28h6v1h-6zM0 29h1v1h-1zM2 29h3v1h-3zM6 29h1v1h-1zM8 29h1v1h-1zM10 29h1v1h-1zM12 29h2v1h-2zM18 29h1v1h-1zM20 29h2v1h-2zM23 29h1v1h-1zM26 29h1v1h-1zM28 29h1v1h-1zM31 29h1v1h-1zM0 30h1v1h-1zM2 30h3v1h-3zM6 30h1v1h-1zM9 30h1v1h-1zM13 30h3v1h-3zM22 30h4v1h-4zM28 30h2v1h-2zM32 30h1v1h-1zM0 31h1v1h-1zM6 31h1v1h-1zM8 31h1v1h-1zM10 31h3v1h-3zM19 31h1v1h-1zM21 31h3v1h-3zM25 31h1v1h-1zM0 32h7v1h-7zM10 32h2v1h-2zM13 32h1v1h-1zM18 32h1v1h-1zM21 32h1v1h-1zM24 32h3v1h-3zM28 32h1v1h-1zM31 32h1v1h-1z'
    },
    // ETH and USDC share one address, on the Ethereum network only.
    crypto: [
      { coin: 'BTC', name: 'Bitcoin', network: 'Bitcoin network', address: '15oLwQXC4FuQxa9nBQBpws9RZfrJUtphDF' },
      { coin: 'ETH', name: 'Ethereum', network: 'Ethereum · ERC-20', address: '0xbc8e2062d6c02eb69fbc4b978f281885132dfde3' },
      { coin: 'USDC', name: 'USD Coin', network: 'Ethereum · ERC-20', address: '0xbc8e2062d6c02eb69fbc4b978f281885132dfde3' }
    ]
  };

  // The coins' own marks, drawn in their brand colours (32×32).
  const COIN_SVG = {
    BTC:
      '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="16" fill="#F7931A"/>' +
      '<path fill="#FFF" d="M23.19 14.02c.31-2.1-1.28-3.22-3.47-3.98l.71-2.84-1.73-.43-.69 2.77c-.45-.12-.92-.22-1.38-.33l.69-2.78L15.6 6l-.71 2.84c-.38-.09-.75-.17-1.1-.26l-2.39-.6-.46 1.85s1.28.29 1.26.31c.7.18.83.64.8 1.01l-.8 3.23c.05.02.11.03.18.06l-.18-.05-1.13 4.54c-.09.21-.3.53-.8.41.02.02-1.25-.32-1.25-.32l-.86 1.98 2.25.56c.42.11.83.22 1.23.32l-.71 2.87 1.72.43.71-2.84c.47.13.93.25 1.38.36l-.71 2.83 1.73.43.72-2.87c2.95.56 5.16.33 6.1-2.33.75-2.15-.04-3.39-1.59-4.2 1.13-.26 1.98-1 2.21-2.54zm-3.95 5.54c-.53 2.15-4.15.99-5.32.7l.95-3.81c1.17.3 4.93.87 4.37 3.11zm.54-5.57c-.49 1.95-3.5.96-4.47.72l.86-3.45c.97.24 4.12.7 3.61 2.73z"/></svg>',
    ETH:
      '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="16" fill="#627EEA"/><g fill="#FFF">' +
      '<path fill-opacity=".6" d="M16.5 4v8.87l7.5 3.35z"/><path d="M16.5 4 9 16.22l7.5-3.35z"/>' +
      '<path fill-opacity=".6" d="M16.5 21.97V28L24 17.62z"/><path d="M16.5 28v-6.03L9 17.62z"/>' +
      '<path fill-opacity=".2" d="m16.5 20.57 7.5-4.35-7.5-3.35z"/><path fill-opacity=".6" d="m9 16.22 7.5 4.35v-7.7z"/></g></svg>',
    USDC:
      '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="16" fill="#2775CA"/><g fill="#FFF">' +
      '<path d="M20.02 18.12c0-2.12-1.28-2.85-3.84-3.15-1.83-.25-2.19-.73-2.19-1.58s.61-1.4 1.83-1.4c1.1 0 1.7.37 2.01 1.28a.46.46 0 0 0 .43.3h.98a.42.42 0 0 0 .42-.42v-.06a3.04 3.04 0 0 0-2.74-2.49V9.14c0-.24-.18-.42-.49-.48h-.91c-.25 0-.43.18-.49.48v1.4c-1.83.24-2.99 1.46-2.99 2.97 0 2 1.22 2.8 3.78 3.1 1.71.3 2.26.66 2.26 1.63s-.86 1.64-2.01 1.64c-1.59 0-2.14-.67-2.32-1.58-.06-.24-.24-.36-.43-.36h-1.03a.42.42 0 0 0-.43.42v.06c.24 1.52 1.22 2.61 3.23 2.92v1.45c0 .25.18.43.49.49h.91c.25 0 .43-.18.49-.49v-1.45c1.83-.3 3.05-1.58 3.05-3.22z"/>' +
      '<path d="M12.89 24.5c-4.75-1.7-7.19-6.98-5.42-11.66.91-2.55 2.92-4.49 5.42-5.4.24-.12.37-.3.37-.6v-.85c0-.25-.13-.43-.37-.49-.06 0-.18 0-.24.06a10.9 10.9 0 0 0-7.13 13.72 10.9 10.9 0 0 0 7.13 7.1c.24.12.49 0 .55-.24.06-.06.06-.12.06-.24v-.85c0-.18-.18-.42-.37-.55zm6.46-18.94c-.24-.12-.49 0-.55.24-.06.06-.06.12-.06.24v.85c0 .24.18.49.37.6 4.75 1.7 7.19 6.99 5.42 11.66-.91 2.55-2.92 4.49-5.42 5.4-.24.12-.37.3-.37.6v.85c0 .25.13.43.37.49.06 0 .18 0 .24-.06a10.9 10.9 0 0 0 7.13-13.72 10.99 10.99 0 0 0-7.13-7.15z"/></g></svg>'
  };

  const features = [];
  const state = Object.create(null); // id -> boolean
  const pageState = Object.create(null); // id -> boolean, for session toggles - never stored
  let showAll = false;
  let stateLoaded = false;
  let root = null;
  let refs = null;
  let renderQueued = false;
  // In the flow frame of make.powerapps.com - see "features in a frame".
  const inFrame = window.top !== window;
  const framed = new Map(); // around such a frame: feature id -> frameId it works in

  // ---------- registry ----------

  /**
   * @param {object} feature
   * @param {string} feature.id        stable key, also the storage key
   * @param {string} feature.name      tile label, two short words at most
   * @param {string} feature.group     section heading in the panel
   * @param {string} feature.icon      inline SVG markup, 24x24 viewBox
   * @param {string} [feature.type]    'toggle' (default) or 'action'
   * @param {string} [feature.hint]    tooltip
   * @param {string[]} [feature.hosts] domains this tile applies to, e.g.
   *                                   ['make.powerapps.com', 'dynamics.com'].
   *                                   Omit for a tile that works everywhere.
   * @param {Function} [feature.when] the page this tile applies to, e.g.
   *                                   () => /\/canvas\//.test(location.pathname).
   *                                   Omit for every page of its hosts.
   * @param {boolean} [feature.defaultOn]   toggles only
   * @param {boolean} [feature.session]     toggles only: on for this page only -
   *                                   not stored, off after a reload
   * @param {Function} [feature.onReset]    session toggles: receives off(), which
   *                                   the feature calls when its page says it is
   *                                   over (another record)
   * @param {Function} [feature.onEnable]   toggles only
   * @param {Function} [feature.onDisable]  toggles only
   * @param {Function} [feature.onRun]      actions only
   * @param {boolean} [feature.inFrames]    also works in a frame and is offered
   *                                   to the panel of the page around it
   * @param {Function} [feature.frameRun]   actions in a frame: run from the page
   *                                   around it, with ask(op, payload) answered
   *                                   by feature.frameAnswer(op, payload) in the
   *                                   frame - for what the frame cannot do on
   *                                   a click made outside it, such as open a tab
   */
  function register(feature) {
    if (!feature || !feature.id) return;
    if (features.some((f) => f.id === feature.id)) return;
    feature.type = feature.type === 'action' ? 'action' : 'toggle';
    features.push(feature);
    // A session toggle the page switches off itself (another record).
    if (feature.session && feature.onReset) {
      feature.onReset(() => {
        if (!pageState[feature.id]) return;
        pageState[feature.id] = false;
        queueRender();
      });
    }
    if (stateLoaded && feature.type === 'toggle') applyFeature(feature);
    queueRender();
    announce();
  }

  // 'dynamics.com' matches yourorg.crm4.dynamics.com; an exact host matches too.
  function onThisPage(feature) {
    const hosts = feature.hosts;
    if (!hosts || !hosts.length) return true;
    const host = location.hostname.toLowerCase();
    return hosts.some((h) => {
      const p = String(h).toLowerCase().replace(/^\./, '');
      return host === p || host.endsWith('.' + p);
    });
  }

  // Listed and runnable here: the right site, and the right page on it.
  function shownHere(feature) {
    if (!onThisPage(feature)) return false;
    if (typeof feature.when !== 'function') return true;
    try {
      return !!feature.when();
    } catch (e) {
      return false;
    }
  }

  // Usable from this page's panel: here, or in a frame of it.
  function usable(feature) {
    return shownHere(feature) || framed.has(feature.id);
  }

  function isOn(id) {
    const f = features.find((x) => x.id === id);
    if (!f || f.type !== 'toggle') return false;
    if (f.session) return !!pageState[id];
    return id in state ? state[id] : !!f.defaultOn;
  }

  function applyFeature(feature) {
    // A toggle left on from another site must not start here: its selectors
    // were written for a page this is not.
    const on = isOn(feature.id) && onThisPage(feature);
    try {
      if (on && feature.onEnable) feature.onEnable();
      if (!on && feature.onDisable) feature.onDisable();
    } catch (e) {
      console.warn('[DynaBoost] feature "' + feature.id + '" failed:', e);
    }
  }

  function toggle(id) {
    const feature = features.find((f) => f.id === id);
    if (!feature || feature.type !== 'toggle') return;
    if (!onThisPage(feature) && !framed.has(id)) return;
    if (feature.session) {
      pageState[id] = !isOn(id);
      applyFeature(feature);
      queueRender();
      return;
    }
    state[id] = !isOn(id);
    applyFeature(feature);
    queueRender();
    chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  function run(feature) {
    const here = shownHere(feature);
    if (!here && !framed.has(feature.id)) return;
    setPanel(false);
    try {
      if (here) {
        if (feature.onRun) feature.onRun();
      } else if (feature.frameRun) {
        feature.frameRun((op, payload) => askFrame(feature.id, op, payload));
      } else {
        chrome.runtime.sendMessage({ type: 'DB_FRAME_RUN', id: feature.id, frameId: framed.get(feature.id) }).catch(() => {});
      }
    } catch (e) {
      console.warn('[DynaBoost] feature "' + feature.id + '" failed:', e);
    }
  }

  function setShowAll(value) {
    showAll = !!value;
    chrome.storage.local.set({ [SHOW_ALL_KEY]: showAll });
    render();
  }

  // ---------- context strip ----------

  const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  /* What the page is about, from the URL only: { kind, id, sub } or null.
   * A record that has not been saved yet has no id. */
  function detectContext() {
    const host = location.hostname.toLowerCase();
    const path = location.pathname;
    const q = new URLSearchParams(location.search);
    const guid = (s) => {
      const m = (s || '').match(GUID);
      return m ? m[0].toLowerCase() : null;
    };

    if (host.endsWith('.dynamics.com')) {
      const etn = q.get('etn');
      const id = guid(q.get('id'));
      if (id) return { kind: 'Record', id: id, sub: etn };
      if (q.get('pagetype') === 'entityrecord' && etn) return { kind: 'Record', id: null, sub: etn + ' \u2014 not saved yet' };
      if (etn) return { kind: 'Table', id: etn, sub: null };
      const app = guid(q.get('appid'));
      if (app) return { kind: 'App', id: app, sub: null };
      return null;
    }

    if (host === 'make.powerapps.com' || host === 'make.powerautomate.com') {
      const rules = [
        [/\/entities\/([0-9a-f-]{36})/i, 'Table'],
        [/\/flows\/([0-9a-f-]{36})\/runs\/([^/?#]+)/i, 'Run'],
        [/\/flows\/([0-9a-f-]{36})/i, 'Flow'],
        [/\/solutions\/([0-9a-f-]{36})/i, 'Solution'],
        [/\/apps\/([0-9a-f-]{36})/i, 'App'],
        [/\/environments\/([0-9a-f-]{36})/i, 'Environment']
      ];
      for (const [re, kind] of rules) {
        const m = path.match(re);
        if (m) return { kind: kind, id: (m[2] || m[1]).toLowerCase(), sub: m[2] ? 'flow ' + m[1].toLowerCase() : null };
      }
      return null;
    }

    // Azure DevOps: dev.azure.com/{org}, or the older {org}.visualstudio.com.
    if (host === 'dev.azure.com' || host.endsWith('.visualstudio.com')) {
      let m = path.match(/\/_workitems\/edit\/(\d+)/i);
      if (m) return { kind: 'Work item', id: m[1], sub: null };
      m = path.match(/\/pullrequest\/(\d+)/i);
      if (m) return { kind: 'Pull request', id: m[1], sub: null };
      m = location.href.match(/buildId=(\d+)/i);
      if (m) return { kind: 'Build', id: m[1], sub: null };
      return null;
    }
    return null;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
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

  function updateContext() {
    if (!refs || !refs.ctx) return;
    const c = detectContext();
    refs.ctx.style.display = c ? '' : 'none';
    if (!c) return;
    refs.ctxKind.textContent = c.kind;
    refs.ctxId.textContent = c.id || '\u2014';
    refs.ctxSub.textContent = c.sub || '';
    refs.ctxSub.style.display = c.sub ? '' : 'none';
    refs.ctxCopy.disabled = !c.id;
    refs.ctx.dataset.id = c.id || '';
  }

  // ---------- UI ----------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // ---------- light and dark ----------

  /* Until the header button is used, the panel is dark when the browser
   * (prefers-color-scheme) or the page is. The button's choice is kept with the
   * browser's mode at that moment, and whichever changes last wins. A click
   * back to the default forgets the choice. */
  let theme = null; // { mode: 'dark' | 'light', browser: 'dark' | 'light' }

  function luminance(color) {
    const m = String(color).match(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?/);
    if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return null;
    const [r, g, b] = [m[1], m[2], m[3]].map((v) => Number(v) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function pageLooksDark() {
    const probes = [document.querySelector('main, [role="main"]'), document.body, document.documentElement];
    for (const el of probes) {
      if (!el) continue;
      const l = luminance(getComputedStyle(el).backgroundColor);
      if (l !== null) return l < 0.35;
    }
    return null;
  }

  const browserDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const browserMode = () => (browserDark && browserDark.matches ? 'dark' : 'light');

  function readTheme(v) {
    const ok = (x) => x === 'dark' || x === 'light';
    return v && ok(v.mode) && ok(v.browser) ? { mode: v.mode, browser: v.browser } : null;
  }

  // The browser's mode has changed since the click: the click is over.
  function dropStaleTheme() {
    if (!theme || theme.browser === browserMode()) return;
    theme = null;
    chrome.storage.local.remove(THEME_KEY);
  }

  function autoDark() {
    return !!(browserDark && browserDark.matches) || pageLooksDark() === true;
  }

  function isDark() {
    if (theme && theme.browser === browserMode()) return theme.mode === 'dark';
    return autoDark();
  }

  const MOON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  const SUN =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.7"/>' +
    '<path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

  function applyTheme() {
    if (!root) return;
    const dark = isDark();
    root.classList.toggle('db-dark', dark);
    const btn = refs && refs.theme;
    if (!btn) return;
    // The button shows where it takes you: the moon to go dark, the sun to go light.
    btn.innerHTML = dark ? SUN : MOON;
    btn.title = dark ? 'Light mode' : 'Dark mode';
    btn.setAttribute('aria-label', btn.title);
  }

  function toggleTheme() {
    const next = isDark() ? 'light' : 'dark';
    theme = (next === 'dark') === autoDark() ? null : { mode: next, browser: browserMode() };
    if (theme) chrome.storage.local.set({ [THEME_KEY]: theme });
    else chrome.storage.local.remove(THEME_KEY);
    applyTheme();
  }

  // The browser switched mode, or the button was used in another tab.
  if (browserDark)
    browserDark.addEventListener('change', () => {
      dropStaleTheme();
      applyTheme();
    });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[THEME_KEY]) return;
    theme = readTheme(changes[THEME_KEY].newValue);
    applyTheme();
  });

  const INFO =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="8.6" stroke="currentColor" stroke-width="1.7"/>' +
    '<path d="M12 11v5.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="7.9" r="1.15" fill="currentColor"/></svg>';

  /* The (i) in the header: src/help.html at the tools of this page, with the
   * tiles' names and icons. */
  async function openHelp() {
    const here = features.filter(usable).map((f) => f.id);
    if (refs && refs.top.childElementCount) here.push('solution-pins');
    try {
      await chrome.storage.local.set({ [HELP_TILES_KEY]: features.map((f) => ({ id: f.id, name: f.name, icon: f.icon || '' })) });
    } catch (e) {
      /* the page reads without the icons */
    }
    chrome.runtime.sendMessage({ type: 'DB_OPEN_HELP', here: here, dark: isDark() }).catch(() => {});
    setPanel(false);
  }

  function buildShell() {
    root = el('div');
    root.id = 'dynaboost-root';

    const panel = el('div', 'db-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'DynaBoost');

    const head = el('div', 'db-head');
    const headMark = el('img', 'db-head-mark');
    headMark.src = ICON_URL;
    headMark.alt = '';
    const headText = el('div');
    const headTitle = el('div', 'db-head-title', 'DynaBoost');
    headTitle.appendChild(el('span', 'db-head-ver', 'v' + chrome.runtime.getManifest().version));
    headText.appendChild(headTitle);
    headText.appendChild(el('div', 'db-head-sub', 'Dynamics 365 toolbelt'));
    const close = el('button', 'db-close', '\u2715');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => setPanel(false));
    const infoBtn = el('button', 'db-info');
    infoBtn.type = 'button';
    infoBtn.innerHTML = INFO;
    infoBtn.title = 'Help - what every tool does, and its limits';
    infoBtn.setAttribute('aria-label', infoBtn.title);
    infoBtn.addEventListener('click', openHelp);
    const themeBtn = el('button', 'db-theme');
    themeBtn.type = 'button';
    themeBtn.addEventListener('click', toggleTheme);
    head.append(headMark, headText, infoBtn, themeBtn, close);

    const ctx = el('div', 'db-ctx');
    const ctxText = el('div', 'db-ctx-text');
    const ctxKind = el('span', 'db-ctx-kind');
    const ctxId = el('code', 'db-ctx-id');
    const ctxSub = el('span', 'db-ctx-sub');
    ctxText.append(ctxKind, ctxId, ctxSub);
    const ctxCopy = el('button', 'db-ctx-copy');
    ctxCopy.type = 'button';
    ctxCopy.title = 'Copy id';
    ctxCopy.setAttribute('aria-label', 'Copy id');
    ctxCopy.innerHTML = COPY_SVG;
    const copyId = async () => {
      const id = ctx.dataset.id;
      if (!id) return;
      const ok = await copyText(id);
      ctx.classList.toggle('db-ctx-copied', ok);
      ctx.classList.toggle('db-ctx-failed', !ok);
      ctxCopy.title = ok ? 'Copied' : 'Copy failed';
      clearTimeout(ctx.__dbTimer);
      ctx.__dbTimer = setTimeout(() => {
        ctx.classList.remove('db-ctx-copied', 'db-ctx-failed');
        ctxCopy.title = 'Copy id';
      }, 1600);
    };
    ctxCopy.addEventListener('click', copyId);
    ctxId.addEventListener('click', copyId);
    ctxId.title = 'Click to copy';
    ctx.append(ctxText, ctxCopy);

    // Sections a feature draws itself, between the context strip and the
    // tiles - pinned solutions. See addSection().
    const top = el('div', 'db-top');
    const body = el('div', 'db-body');

    const thanks = buildThanks(panel);

    const foot = el('div', 'db-foot');
    const scope = el('button', 'db-scope');
    scope.type = 'button';
    scope.addEventListener('click', () => setShowAll(!showAll));
    foot.append(thanks.button, scope);

    panel.append(head, ctx, top, body, thanks.card, foot);
    root.appendChild(panel);
    document.body.appendChild(root);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && root.classList.contains('db-open')) setPanel(false);
    });

    return { top, body, scope, ctx, ctxKind, ctxId, ctxSub, ctxCopy, theme: themeBtn };
  }

  const HEART_SVG =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M12 20.3s-7.8-4.7-7.8-10.4A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 7.8 2.7c0 5.7-7.8 10.4-7.8 10.4z" ' +
    'stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  const QR_ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2" stroke="currentColor" stroke-width="1.6"/>' +
    '<rect x="14" y="3.5" width="6.5" height="6.5" rx="1.2" stroke="currentColor" stroke-width="1.6"/>' +
    '<rect x="3.5" y="14" width="6.5" height="6.5" rx="1.2" stroke="currentColor" stroke-width="1.6"/>' +
    '<path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM18 14h2.5M14 20.5h2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const CHECK_SVG =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m5 13 4 4L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const COPY_SVG =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.6"/>' +
    '<path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
    '</svg>';

  /* The heart in the footer and its card. The card sits between the tiles and
   * the footer, so the tiles shrink instead of being covered. */
  function buildThanks(panel) {
    const button = el('button', 'db-thanks-btn');
    button.type = 'button';
    button.innerHTML = HEART_SVG;
    button.appendChild(el('span', null, 'Say thanks'));
    button.setAttribute('aria-expanded', 'false');

    const card = el('div', 'db-thanks');
    card.id = 'db-thanks';
    button.setAttribute('aria-controls', card.id);

    const setOpen = (open) => {
      panel.classList.toggle('db-thanks-open', open);
      button.setAttribute('aria-expanded', String(open));
    };
    button.addEventListener('click', () => setOpen(!panel.classList.contains('db-thanks-open')));

    const head = el('div', 'db-thanks-head');
    const title = el('div', 'db-thanks-title', 'Enjoying DynaBoost?');
    const close = el('button', 'db-thanks-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => setOpen(false));
    head.append(title, close);

    const text = el(
      'div',
      'db-thanks-text',
      'DynaBoost is free and built to save you time. Think about how much time it has saved you — ' +
        'and what that time is worth. If you would like, leave a voluntary tip to support its development. ' +
        'It unlocks nothing extra; it is simply a thank you.'
    );

    const pay = el('a', 'db-thanks-opt db-thanks-pay');
    pay.href = THANKS.stripe;
    pay.target = '_blank';
    pay.rel = 'noopener noreferrer';
    pay.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="3" y="5.5" width="18" height="13" rx="2.2" stroke="currentColor" stroke-width="1.6"/>' +
      '<path d="M3 9.5h18M6.5 15h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    const payText = el('span', 'db-thanks-opt-text');
    payText.append(
      el('span', 'db-thanks-opt-name', 'Card or PayPal'),
      el('span', 'db-thanks-opt-sub', 'Apple Pay · Google Pay')
    );
    pay.append(payText, el('span', 'db-thanks-opt-go', '↗'));
    // The payment page is open: say thanks.
    pay.addEventListener('click', () => {
      title.textContent = 'Thank you!';
      card.classList.add('db-thanks-said');
    });

    // Beside it, the same payment by phone: a QR code folded under the row.
    const payRow = el('div', 'db-thanks-payrow');
    payRow.appendChild(pay);
    const qrOk = THANKS.stripeQr && THANKS.stripeQr.for === THANKS.stripe;
    const qr = el('div', 'db-qr');
    if (qrOk) {
      const qrBtn = el('button', 'db-thanks-qrbtn');
      qrBtn.type = 'button';
      qrBtn.title = 'Pay on your phone - show a QR code';
      qrBtn.setAttribute('aria-label', qrBtn.title);
      qrBtn.setAttribute('aria-expanded', 'false');
      qrBtn.innerHTML = QR_ICON;
      payRow.appendChild(qrBtn);
      const n = THANKS.stripeQr.size;
      const qrIn = el('div', 'db-qr-in');
      qrIn.innerHTML =
        '<svg class="db-qr-code" viewBox="-4 -4 ' + (n + 8) + ' ' + (n + 8) + '" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="QR code of the payment page">' +
        '<rect x="-4" y="-4" width="' + (n + 8) + '" height="' + (n + 8) + '" fill="#fff"/><path fill="#10224e" d="' + THANKS.stripeQr.path + '"/></svg>';
      const qrText = el('div', 'db-qr-text');
      qrText.append(
        el('b', null, 'Scan with your phone'),
        el('span', null, 'The same payment page opens there \u2014 Apple Pay and Google Pay are one tap away.')
      );
      qrIn.appendChild(qrText);
      fold(qr, qrIn);
      qrBtn.addEventListener('click', () => {
        const open = !card.classList.contains('db-qr-open');
        card.classList.toggle('db-qr-open', open);
        qrBtn.setAttribute('aria-expanded', String(open));
      });
    }

    const cryptoBtn = el('button', 'db-thanks-opt db-thanks-crypto');
    cryptoBtn.type = 'button';
    cryptoBtn.setAttribute('aria-expanded', 'false');
    cryptoBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<circle cx="12" cy="12" r="8.6" stroke="currentColor" stroke-width="1.6"/>' +
      '<path d="M10 7.5v9M12.6 7.5v1.3M12.6 15.2v1.3M9 8.8h4.2a1.8 1.8 0 0 1 0 3.6H9h4.7a1.9 1.9 0 0 1 0 3.8H9" ' +
      'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const cryptoText = el('span', 'db-thanks-opt-text');
    cryptoText.append(
      el('span', 'db-thanks-opt-name', 'Crypto'),
      el('span', 'db-thanks-opt-sub', THANKS.crypto.map((c) => c.coin).join(' · '))
    );
    cryptoBtn.append(cryptoText, el('span', 'db-thanks-opt-go db-thanks-chev', '›'));

    const walletsIn = el('div', 'db-wallets-in');
    for (const c of THANKS.crypto) walletsIn.appendChild(buildWallet(c));
    walletsIn.appendChild(el('div', 'db-wallets-note', 'Send only on the network shown next to the coin.'));
    const wallets = fold(el('div', 'db-wallets'), walletsIn);
    cryptoBtn.addEventListener('click', () => {
      const open = !card.classList.contains('db-wallets-open');
      card.classList.toggle('db-wallets-open', open);
      cryptoBtn.setAttribute('aria-expanded', String(open));
    });

    const note = el('div', 'db-thanks-note', 'Card payments are handled by Stripe — DynaBoost never sees them.');

    const cardIn = el('div', 'db-thanks-in');
    cardIn.append(head, text, payRow);
    if (qrOk) cardIn.appendChild(qr);
    cardIn.append(cryptoBtn, wallets, note);
    fold(card, cardIn);
    return { button, card };
  }

  /* Makes box fold open and shut around content: the box animates its
   * height, the clip hides what does not fit yet, and the content keeps its
   * own padding and border - see .db-fold in panel.css. */
  function fold(box, content) {
    box.classList.add('db-fold');
    const clip = el('div', 'db-fold-clip');
    clip.appendChild(content);
    box.appendChild(clip);
    return box;
  }

  /* One coin: its mark, name, network, the address shortened in the middle
   * (all of it on hover) and Copy. */
  function buildWallet(c) {
    const row = el('div', 'db-wallet db-wallet-' + c.coin.toLowerCase());
    const coin = el('span', 'db-wallet-coin');
    coin.innerHTML = COIN_SVG[c.coin] || '';
    coin.title = c.name;
    const info = el('span', 'db-wallet-info');
    const head = el('span', 'db-wallet-head');
    head.append(el('b', null, c.coin), el('span', 'db-wallet-net', c.network));
    info.appendChild(head);
    row.append(coin, info);

    if (!c.address) {
      row.classList.add('db-wallet-soon');
      info.appendChild(el('span', 'db-wallet-addr', 'address coming soon'));
      return row;
    }

    const addr = el('code', 'db-wallet-addr', c.address.length > 16 ? c.address.slice(0, 8) + '…' + c.address.slice(-6) : c.address);
    addr.title = c.address;
    info.appendChild(addr);
    const copy = el('button', 'db-wallet-copy');
    copy.type = 'button';
    copy.title = 'Copy the full ' + c.coin + ' address';
    const label = el('span', null, 'Copy');
    copy.innerHTML = COPY_SVG;
    copy.appendChild(label);
    const net = head.querySelector('.db-wallet-net');
    const doCopy = async () => {
      const ok = await copyText(c.address);
      row.classList.toggle('db-wallet-copied', ok);
      row.classList.toggle('db-wallet-failed', !ok);
      copy.innerHTML = ok ? CHECK_SVG : COPY_SVG;
      label.textContent = ok ? 'Copied' : 'Failed';
      copy.appendChild(label);
      net.textContent = ok ? c.coin + ' address copied' : 'Copy failed - select the address';
      clearTimeout(row.__dbTimer);
      row.__dbTimer = setTimeout(() => {
        row.classList.remove('db-wallet-copied', 'db-wallet-failed');
        copy.innerHTML = COPY_SVG;
        label.textContent = 'Copy';
        copy.appendChild(label);
        net.textContent = c.network;
      }, 1800);
    };
    copy.addEventListener('click', doCopy);
    addr.addEventListener('click', doCopy);
    row.appendChild(copy);
    return row;
  }

  // Power Apps, Power Automate and Azure DevOps change pages without a
  // reload. While the panel is open, a new address re-lists the tiles.
  let watchTimer = null;
  let watchedHref = '';

  function setPanel(open) {
    if (!root) return;
    if (open) {
      // A frame of this page may have changed its page meanwhile.
      if (!inFrame) chrome.runtime.sendMessage({ type: 'DB_FRAME_PING' }).catch(() => {});
      applyTheme();
      updateContext();
      render();
      watchedHref = location.href;
      if (!watchTimer) {
        watchTimer = setInterval(() => {
          if (location.href === watchedHref) return;
          watchedHref = location.href;
          updateContext();
          render();
        }, 700);
      }
    } else if (watchTimer) {
      clearInterval(watchTimer);
      watchTimer = null;
    }
    root.classList.toggle('db-open', open);
  }

  function togglePanel() {
    ensureShell();
    setPanel(!root.classList.contains('db-open'));
  }

  // The shell is built lazily, on the first open. Whatever registered before
  // that never got drawn, so paint the tiles as soon as it exists.
  function ensureShell() {
    if (refs) return;
    refs = buildShell();
    render();
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    // Features register one after another as their scripts run; render once
    // they have all had their turn.
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  // ---------- sections ----------

  /* A section is drawn by its feature, not as tiles: draw(container) fills
   * the element it is given, or leaves it empty to stay out of this page.
   * It is redrawn with the rest of the panel - when it opens, when the
   * address changes, and when the feature asks with DynaBoost.refresh(). */
  const sections = [];

  function addSection(section) {
    if (!section || typeof section.draw !== 'function') return;
    sections.push(section);
    queueRender();
  }

  function renderSections() {
    refs.top.textContent = '';
    for (const s of sections) {
      const box = el('div', 'db-section');
      try {
        s.draw(box);
      } catch (e) {
        console.warn('[DynaBoost] section failed:', e);
      }
      if (box.childNodes.length) refs.top.appendChild(box);
    }
  }

  function render() {
    if (!document.body || !refs) return;
    renderSections();

    const here = features.filter(usable);
    const elsewhere = features.filter((f) => !usable(f));
    const listed = showAll ? here.concat(elsewhere) : here;

    const groups = new Map();
    for (const f of listed) {
      const name = f.group || 'Tools';
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(f);
    }

    refs.body.textContent = '';
    // Groups with something for this page come first (here before
    // elsewhere); the rest go under one quiet rule.
    let awayHead = false;
    for (const [name, items] of groups) {
      const away = !items.some(usable);
      if (away && !awayHead) {
        refs.body.appendChild(el('div', 'db-away-head', 'On other pages'));
        awayHead = true;
      }
      refs.body.appendChild(el('div', 'db-group-name' + (away ? ' db-group-away' : ''), name));
      const grid = el('div', 'db-grid');
      for (const f of items) grid.appendChild(buildTile(f));
      refs.body.appendChild(grid);
    }

    if (!listed.length) {
      refs.body.appendChild(el('div', 'db-empty', 'Nothing for this page.'));
    }
    if (frameProblem && !framed.size) {
      refs.body.appendChild(el('div', 'db-empty', 'DynaBoost could not reach the flow shown on this page: ' + frameProblem));
    }

    refs.scope.textContent = showAll
      ? 'This page only'
      : 'Show all (' + elsewhere.length + ')';
    refs.scope.style.display = elsewhere.length || showAll ? '' : 'none';
  }

  function buildTile(feature) {
    const here = usable(feature);
    const tile = el('button', 'db-tile db-tile-' + feature.type + (here ? '' : ' db-tile-away'));
    tile.type = 'button';
    tile.title = here
      ? feature.hint || feature.name
      : (feature.hint || feature.name) + ' — not available on this page';
    if (!here) tile.disabled = true;

    const icon = el('span');
    icon.innerHTML = feature.icon || '';
    if (icon.firstElementChild) tile.appendChild(icon.firstElementChild);

    tile.appendChild(el('span', 'db-tile-name', feature.name));

    if (feature.type === 'toggle') {
      tile.setAttribute('aria-pressed', String(here && isOn(feature.id)));
      tile.addEventListener('click', () => toggle(feature.id));
    } else {
      tile.addEventListener('click', () => run(feature));
    }
    return tile;
  }

  // ---------- toast ----------

  /* A short message at the bottom right. One at a time: a new one replaces
   * the last; each goes after 3 s. */
  let shown = null;

  function fadeOut(card) {
    if (!card || card.__leaving) return;
    card.__leaving = true;
    clearTimeout(card.__timer);
    // Out of the column, in the same spot: the next card does not jump.
    card.style.position = 'absolute';
    card.style.right = '0';
    card.style.bottom = '0';
    card.classList.add('db-toast-out');
    setTimeout(() => card.remove(), 200);
    if (shown === card) shown = null;
  }

  function toast(title, sub, error) {
    let layer = document.getElementById('dynaboost-toast');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'dynaboost-toast';
      document.body.appendChild(layer);
    }
    fadeOut(shown);
    const card = document.createElement('div');
    card.className = 'db-toast' + (error ? ' db-toast-error' : '');
    card.innerHTML =
      '<div class="db-toast-row"><span class="db-toast-mark"></span><div class="db-toast-text"><div class="db-toast-title"></div><div class="db-toast-sub"></div></div></div>';
    card.querySelector('.db-toast-mark').textContent = error ? '!' : '\u2713';
    card.querySelector('.db-toast-title').textContent = title;
    card.querySelector('.db-toast-sub').textContent = sub;
    layer.appendChild(card);
    shown = card;
    card.__timer = setTimeout(() => fadeOut(card), 3000);
  }

  // ---------- features in a frame ----------

  /* make.powerapps.com shows a solution's cloud flow in a frame from
   * make.powerautomate.com (.../widgets/manage/.../flows/{id}/...). DynaBoost
   * runs there without a panel: it tells the page's panel which of its tiles
   * work there and runs them when clicked. Messages go through the background
   * (chrome.runtime), never through the page. Only features marked inFrames
   * take part. */
  let announced = null;

  function announce(force) {
    if (!inFrame || !stateLoaded) return;
    // A hidden frame (sign-in and the like) has nothing to offer.
    const ids = innerWidth && innerHeight ? features.filter((f) => f.inFrames && shownHere(f)).map((f) => f.id) : [];
    const key = ids.join(',');
    if (!force && key === announced) return;
    announced = key;
    chrome.runtime.sendMessage({ type: 'DB_FRAME_HERE', ids: ids }).catch(() => {});
  }

  /* A flow frame that does not report in gets DynaBoost from the background,
   * as soon as it appears - Edit flow needs the page helper in before the
   * flow's first API calls. A frame that reloads is served again. */
  const FLOW_FRAME = 'iframe[src*="make.powerautomate.com/"][src*="/widgets/"]';
  let frameProblem = '';
  let frameAsking = false;
  let frameServed = false; // the flow frame has DynaBoost - until it reloads

  function reachFlowFrame() {
    if (frameAsking || frameServed || frameProblem || framed.size || !document.querySelector(FLOW_FRAME)) return;
    frameAsking = true;
    chrome.runtime.sendMessage({ type: 'DB_FRAME_INJECT' }).then(
      (r) => {
        frameAsking = false;
        if (r && r.present) frameServed = true;
        if (r && r.error) {
          frameProblem = r.error;
          queueRender();
        }
      },
      (e) => {
        frameAsking = false;
        frameProblem = String((e && e.message) || e);
        queueRender();
      }
    );
  }

  if (!inFrame && location.hostname === 'make.powerapps.com') setInterval(reachFlowFrame, 400);

  function askFrame(id, op, payload) {
    return chrome.runtime.sendMessage({ type: 'DB_FRAME_ASK', id: id, op: op, payload: payload, frameId: framed.get(id) }).then((r) => {
      if (!r) throw new Error('The flow did not answer. Reload the page and try again.');
      if (r.error) throw new Error(r.error);
      return r.data;
    });
  }

  if (inFrame) {
    // The flow's own pages change without a reload: details, the designer, a run.
    let frameHref = location.href;
    setInterval(() => {
      if (location.href === frameHref) return;
      frameHref = location.href;
      announce();
    }, 1000);
    window.addEventListener('pagehide', () => {
      announced = null;
      chrome.runtime.sendMessage({ type: 'DB_FRAME_HERE', ids: [] }).catch(() => {});
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg) return;
    // Around the frame: what works in there, from the background.
    if (msg.type === 'DB_FRAME_HERE' && !inFrame) {
      // A frame leaving (or reloading) may need DynaBoost put in again.
      if (!(msg.ids || []).length) frameServed = false;
      for (const [id, frameId] of framed) if (frameId === msg.frameId) framed.delete(id);
      for (const id of msg.ids || []) framed.set(id, msg.frameId);
      queueRender();
      return;
    }
    if (!inFrame) return;
    if (msg.type === 'DB_FRAME_PING') {
      announce(true);
      return;
    }
    const feature = features.find((f) => f.id === msg.id);
    if (!feature || !feature.inFrames || !shownHere(feature)) return;
    if (msg.type === 'DB_FRAME_RUN' && feature.onRun) {
      try {
        feature.onRun();
      } catch (e) {
        console.warn('[DynaBoost] feature "' + feature.id + '" failed:', e);
      }
      return;
    }
    if (msg.type === 'DB_FRAME_ASK' && feature.frameAnswer) {
      Promise.resolve()
        .then(() => feature.frameAnswer(msg.op, msg.payload))
        .then(
          (data) => reply({ data: data }),
          (e) => reply({ error: String((e && e.message) || e) })
        );
      return true;
    }
  });

  // A toggle switched in another tab, or in the panel around this frame.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY] || !stateLoaded) return;
    const next = changes[STORAGE_KEY].newValue || {};
    for (const f of features) {
      if (f.type !== 'toggle' || f.session) continue;
      const was = isOn(f.id);
      if (f.id in next) state[f.id] = !!next[f.id];
      else delete state[f.id];
      if (isOn(f.id) !== was) applyFeature(f);
    }
    queueRender();
  });

  // ---------- boot ----------

  window.DynaBoost = {
    register,
    addSection,
    refresh: queueRender,
    isOn,
    toggle,
    openPanel: () => {
      ensureShell();
      setPanel(true);
    },
    closePanel: () => setPanel(false),
    // For the dialogs features open over the page, to match the panel.
    isDark: isDark,
    toast: toast,
    togglePanel
  };

  chrome.storage.local.get([STORAGE_KEY, SHOW_ALL_KEY, THEME_KEY], (data) => {
    Object.assign(state, (data && data[STORAGE_KEY]) || {});
    showAll = !!(data && data[SHOW_ALL_KEY]);
    theme = readTheme(data && data[THEME_KEY]);
    dropStaleTheme();
    applyTheme();
    stateLoaded = true;
    features.filter((f) => f.type === 'toggle').forEach(applyFeature);
    queueRender();
    announce();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    // The panel lives in the page itself, never in a frame of it.
    if (msg && msg.type === 'DB_TOGGLE_PANEL' && !inFrame) togglePanel();
  });
})();
