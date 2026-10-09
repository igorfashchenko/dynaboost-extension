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
  /* A copy put in while DynaBoost itself was being reloaded runs with no
   * chrome.* at all. It stays out of the page and quiet - the features see
   * DynaBoost.off - and the new DynaBoost puts in a copy of its own. */
  let bound = false;
  try {
    bound = !!(chrome.runtime && chrome.runtime.id);
  } catch (e) {
    bound = false;
  }
  if (!bound) {
    if (!window.DynaBoost) {
      const nop = () => {};
      window.DynaBoost = {
        off: true,
        retired: true,
        register: nop,
        addSection: nop,
        refresh: nop,
        isOn: () => false,
        toggle: nop,
        openPanel: nop,
        closePanel: nop,
        isDark: () => false,
        toast: nop,
        toastLayer: () => document.createElement('div'),
        togglePanel: nop,
        alive: () => false
      };
    }
    return;
  }

  // A copy left running from before an update steps aside (see retire()).
  document.dispatchEvent(new Event('dynaboost-start'));
  if (window.DynaBoost && !window.DynaBoost.retired) return;

  const STORAGE_KEY = 'dynaboost.features';
  const SHOW_ALL_KEY = 'dynaboost.showAll';
  const THEME_KEY = 'dynaboost.theme'; // { mode, browser }: the header button's choice, and the browser's mode it was made in
  const HELP_TILES_KEY = 'dynaboost.helpTiles'; // the tiles' names and icons, for the help page
  const LAYOUT_KEY = 'dynaboost.layout'; // { v: 2, sites: { <site>: { groups, tiles } } }: the order the panel was arranged in, per site
  const NEWS_KEY = 'dynaboost.whatsNew'; // the version DynaBoost was updated to, until What's new is opened (background.js)
  const ICON_URL = chrome.runtime.getURL('icons/icon48.png');

  // ---------- after an update ----------

  /* An update or reload of DynaBoost cuts the copy already running in an
   * open tab off from the extension: every chrome.* call there throws
   * "Extension context invalidated". That copy retires - toggles off, panel
   * gone, no more calls - and the new copy takes the page over. */
  const GONE = 'DynaBoost was updated. Reload the page.';
  const timers = [];
  let retired = false;

  function alive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  function retire() {
    if (retired) return;
    retired = true;
    timers.forEach(clearInterval);
    clearInterval(watchTimer);
    for (const f of features) {
      // Only what runs on this page.
      if (f.type !== 'toggle' || !f.onDisable || !isOn(f.id) || !onThisPage(f)) continue;
      try {
        f.onDisable();
      } catch (e) {
        /* its own chrome.* calls fail now */
      }
    }
    if (root) root.remove();
    root = null;
    refs = null;
    // The old features still call it; a new copy may take the name over.
    api.retired = true;
  }

  // A chrome.* call; once cut off, retires instead of throwing.
  function ext(call, fallback) {
    if (retired || !alive()) {
      retire();
      return fallback;
    }
    try {
      return call();
    } catch (e) {
      if (alive()) throw e;
      retire();
      return fallback;
    }
  }

  const send = (msg) => ext(() => chrome.runtime.sendMessage(msg), null) || Promise.reject(new Error(GONE));
  const store = (items) => ext(() => chrome.storage.local.set(items));

  /* Say thanks: the heart in the footer. A coin whose address is empty is
   * listed as coming soon. */
  const THANKS = {
    author: { name: 'Igor Fashchenko', initials: 'IF', linkedin: 'https://www.linkedin.com/in/igor-fashchenko/' },
    stripe: 'https://buy.stripe.com/7sY3cv53q7C04Ld3sc3cc00',
    // The Stripe link as a QR code (tools/qr-path.py). Shown only while "for"
    // is the link above.
    stripeQr: {
      for: 'https://buy.stripe.com/7sY3cv53q7C04Ld3sc3cc00',
      size: 33,
      path: 'M0 0h7v1h-7zM8 0h1v1h-1zM10 0h2v1h-2zM13 0h3v1h-3zM18 0h2v1h-2zM21 0h1v1h-1zM23 0h1v1h-1zM26 0h7v1h-7zM0 1h1v1h-1zM6 1h1v1h-1zM9 1h2v1h-2zM15 1h3v1h-3zM20 1h2v1h-2zM23 1h2v1h-2zM26 1h1v1h-1zM32 1h1v1h-1zM0 2h1v1h-1zM2 2h3v1h-3zM6 2h1v1h-1zM8 2h1v1h-1zM10 2h1v1h-1zM13 2h3v1h-3zM17 2h4v1h-4zM22 2h1v1h-1zM24 2h1v1h-1zM26 2h1v1h-1zM28 2h3v1h-3zM32 2h1v1h-1zM0 3h1v1h-1zM2 3h3v1h-3zM6 3h1v1h-1zM8 3h4v1h-4zM15 3h1v1h-1zM20 3h1v1h-1zM22 3h2v1h-2zM26 3h1v1h-1zM28 3h3v1h-3zM32 3h1v1h-1zM0 4h1v1h-1zM2 4h3v1h-3zM6 4h1v1h-1zM10 4h1v1h-1zM12 4h1v1h-1zM14 4h2v1h-2zM17 4h1v1h-1zM20 4h1v1h-1zM26 4h1v1h-1zM28 4h3v1h-3zM32 4h1v1h-1zM0 5h1v1h-1zM6 5h1v1h-1zM8 5h2v1h-2zM13 5h3v1h-3zM18 5h2v1h-2zM21 5h2v1h-2zM26 5h1v1h-1zM32 5h1v1h-1zM0 6h7v1h-7zM8 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM14 6h1v1h-1zM16 6h1v1h-1zM18 6h1v1h-1zM20 6h1v1h-1zM22 6h1v1h-1zM24 6h1v1h-1zM26 6h7v1h-7zM8 7h2v1h-2zM11 7h9v1h-9zM21 7h4v1h-4zM1 8h1v1h-1zM3 8h1v1h-1zM5 8h5v1h-5zM12 8h1v1h-1zM14 8h1v1h-1zM16 8h1v1h-1zM18 8h1v1h-1zM21 8h1v1h-1zM23 8h1v1h-1zM25 8h3v1h-3zM29 8h2v1h-2zM32 8h1v1h-1zM1 9h1v1h-1zM5 9h1v1h-1zM7 9h1v1h-1zM13 9h1v1h-1zM17 9h1v1h-1zM20 9h3v1h-3zM24 9h4v1h-4zM1 10h1v1h-1zM3 10h4v1h-4zM8 10h3v1h-3zM13 10h3v1h-3zM18 10h2v1h-2zM22 10h1v1h-1zM24 10h5v1h-5zM30 10h1v1h-1zM32 10h1v1h-1zM0 11h1v1h-1zM2 11h3v1h-3zM11 11h1v1h-1zM14 11h1v1h-1zM16 11h1v1h-1zM20 11h2v1h-2zM23 11h2v1h-2zM28 11h2v1h-2zM2 12h1v1h-1zM4 12h3v1h-3zM10 12h2v1h-2zM13 12h2v1h-2zM16 12h1v1h-1zM18 12h1v1h-1zM20 12h4v1h-4zM25 12h3v1h-3zM29 12h1v1h-1zM32 12h1v1h-1zM0 13h2v1h-2zM7 13h4v1h-4zM15 13h2v1h-2zM19 13h3v1h-3zM25 13h8v1h-8zM1 14h2v1h-2zM5 14h2v1h-2zM11 14h4v1h-4zM17 14h1v1h-1zM20 14h9v1h-9zM30 14h2v1h-2zM0 15h1v1h-1zM3 15h3v1h-3zM7 15h3v1h-3zM11 15h1v1h-1zM15 15h2v1h-2zM18 15h1v1h-1zM21 15h1v1h-1zM23 15h1v1h-1zM26 15h1v1h-1zM29 15h1v1h-1zM31 15h1v1h-1zM1 16h2v1h-2zM4 16h3v1h-3zM11 16h5v1h-5zM19 16h4v1h-4zM24 16h1v1h-1zM26 16h1v1h-1zM28 16h2v1h-2zM31 16h1v1h-1zM2 17h2v1h-2zM8 17h2v1h-2zM11 17h1v1h-1zM13 17h3v1h-3zM18 17h1v1h-1zM21 17h1v1h-1zM23 17h1v1h-1zM25 17h1v1h-1zM27 17h1v1h-1zM29 17h1v1h-1zM2 18h1v1h-1zM5 18h2v1h-2zM10 18h4v1h-4zM15 18h1v1h-1zM17 18h1v1h-1zM20 18h3v1h-3zM26 18h1v1h-1zM30 18h3v1h-3zM3 19h3v1h-3zM11 19h2v1h-2zM14 19h1v1h-1zM17 19h1v1h-1zM19 19h3v1h-3zM23 19h1v1h-1zM25 19h1v1h-1zM27 19h1v1h-1zM31 19h2v1h-2zM0 20h1v1h-1zM2 20h1v1h-1zM6 20h2v1h-2zM11 20h2v1h-2zM14 20h1v1h-1zM17 20h3v1h-3zM21 20h1v1h-1zM27 20h1v1h-1zM31 20h1v1h-1zM1 21h3v1h-3zM5 21h1v1h-1zM8 21h2v1h-2zM12 21h4v1h-4zM20 21h1v1h-1zM22 21h1v1h-1zM26 21h2v1h-2zM29 21h1v1h-1zM31 21h2v1h-2zM0 22h4v1h-4zM5 22h2v1h-2zM8 22h2v1h-2zM12 22h1v1h-1zM15 22h1v1h-1zM19 22h1v1h-1zM25 22h2v1h-2zM28 22h2v1h-2zM32 22h1v1h-1zM1 23h2v1h-2zM4 23h2v1h-2zM11 23h1v1h-1zM14 23h3v1h-3zM18 23h1v1h-1zM20 23h4v1h-4zM25 23h1v1h-1zM29 23h1v1h-1zM31 23h1v1h-1zM0 24h1v1h-1zM2 24h2v1h-2zM6 24h2v1h-2zM13 24h1v1h-1zM16 24h2v1h-2zM20 24h2v1h-2zM24 24h5v1h-5zM31 24h1v1h-1zM8 25h2v1h-2zM12 25h2v1h-2zM16 25h1v1h-1zM19 25h1v1h-1zM21 25h1v1h-1zM24 25h1v1h-1zM28 25h2v1h-2zM31 25h2v1h-2zM0 26h7v1h-7zM8 26h3v1h-3zM13 26h4v1h-4zM18 26h1v1h-1zM20 26h3v1h-3zM24 26h1v1h-1zM26 26h1v1h-1zM28 26h3v1h-3zM0 27h1v1h-1zM6 27h1v1h-1zM8 27h2v1h-2zM11 27h1v1h-1zM13 27h1v1h-1zM17 27h6v1h-6zM24 27h1v1h-1zM28 27h1v1h-1zM32 27h1v1h-1zM0 28h1v1h-1zM2 28h3v1h-3zM6 28h1v1h-1zM10 28h1v1h-1zM12 28h2v1h-2zM17 28h3v1h-3zM21 28h2v1h-2zM24 28h6v1h-6zM0 29h1v1h-1zM2 29h3v1h-3zM6 29h1v1h-1zM8 29h1v1h-1zM10 29h1v1h-1zM12 29h2v1h-2zM18 29h1v1h-1zM20 29h2v1h-2zM23 29h1v1h-1zM26 29h1v1h-1zM28 29h1v1h-1zM31 29h1v1h-1zM0 30h1v1h-1zM2 30h3v1h-3zM6 30h1v1h-1zM9 30h1v1h-1zM13 30h3v1h-3zM22 30h4v1h-4zM28 30h2v1h-2zM32 30h1v1h-1zM0 31h1v1h-1zM6 31h1v1h-1zM8 31h1v1h-1zM10 31h3v1h-3zM19 31h1v1h-1zM21 31h3v1h-3zM25 31h1v1h-1zM0 32h7v1h-7zM10 32h2v1h-2zM13 32h1v1h-1zM18 32h1v1h-1zM21 32h1v1h-1zM24 32h3v1h-3zM28 32h1v1h-1zM31 32h1v1h-1z'
    },
    // Monthly support: an amount a month each, its own Stripe link and QR
    // code (tools/qr-path.py); cancelled from the link in Stripe's receipt.
    // One amount shows as itself; several become a choice.
    monthly: [
      {
        amount: '\u20ac2',
        link: 'https://buy.stripe.com/00w8wP53qe0o0uX2o83cc01',
        qr: {
          for: 'https://buy.stripe.com/00w8wP53qe0o0uX2o83cc01',
          size: 33,
          path: 'M0 0h7v1h-7zM8 0h1v1h-1zM10 0h1v1h-1zM14 0h1v1h-1zM17 0h2v1h-2zM21 0h1v1h-1zM26 0h7v1h-7zM0 1h1v1h-1zM6 1h1v1h-1zM8 1h6v1h-6zM18 1h1v1h-1zM20 1h1v1h-1zM22 1h1v1h-1zM26 1h1v1h-1zM32 1h1v1h-1zM0 2h1v1h-1zM2 2h3v1h-3zM6 2h1v1h-1zM11 2h1v1h-1zM13 2h1v1h-1zM16 2h1v1h-1zM18 2h7v1h-7zM26 2h1v1h-1zM28 2h3v1h-3zM32 2h1v1h-1zM0 3h1v1h-1zM2 3h3v1h-3zM6 3h1v1h-1zM9 3h2v1h-2zM14 3h1v1h-1zM17 3h3v1h-3zM26 3h1v1h-1zM28 3h3v1h-3zM32 3h1v1h-1zM0 4h1v1h-1zM2 4h3v1h-3zM6 4h1v1h-1zM9 4h1v1h-1zM11 4h1v1h-1zM13 4h1v1h-1zM15 4h3v1h-3zM19 4h1v1h-1zM21 4h3v1h-3zM26 4h1v1h-1zM28 4h3v1h-3zM32 4h1v1h-1zM0 5h1v1h-1zM6 5h1v1h-1zM11 5h2v1h-2zM15 5h1v1h-1zM20 5h1v1h-1zM22 5h1v1h-1zM24 5h1v1h-1zM26 5h1v1h-1zM32 5h1v1h-1zM0 6h7v1h-7zM8 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM14 6h1v1h-1zM16 6h1v1h-1zM18 6h1v1h-1zM20 6h1v1h-1zM22 6h1v1h-1zM24 6h1v1h-1zM26 6h7v1h-7zM10 7h2v1h-2zM13 7h4v1h-4zM19 7h1v1h-1zM24 7h1v1h-1zM1 8h1v1h-1zM6 8h3v1h-3zM10 8h1v1h-1zM12 8h1v1h-1zM14 8h2v1h-2zM17 8h2v1h-2zM22 8h1v1h-1zM25 8h1v1h-1zM31 8h2v1h-2zM2 9h3v1h-3zM8 9h5v1h-5zM14 9h3v1h-3zM18 9h2v1h-2zM21 9h1v1h-1zM23 9h1v1h-1zM28 9h4v1h-4zM1 10h2v1h-2zM4 10h4v1h-4zM9 10h1v1h-1zM18 10h1v1h-1zM20 10h2v1h-2zM24 10h1v1h-1zM28 10h1v1h-1zM30 10h2v1h-2zM5 11h1v1h-1zM7 11h2v1h-2zM10 11h4v1h-4zM15 11h2v1h-2zM19 11h1v1h-1zM23 11h1v1h-1zM25 11h6v1h-6zM0 12h3v1h-3zM4 12h5v1h-5zM10 12h1v1h-1zM12 12h1v1h-1zM14 12h7v1h-7zM22 12h1v1h-1zM26 12h1v1h-1zM31 12h2v1h-2zM4 13h1v1h-1zM7 13h2v1h-2zM12 13h1v1h-1zM14 13h1v1h-1zM16 13h5v1h-5zM22 13h5v1h-5zM29 13h4v1h-4zM1 14h1v1h-1zM3 14h2v1h-2zM6 14h1v1h-1zM9 14h2v1h-2zM13 14h2v1h-2zM20 14h1v1h-1zM25 14h2v1h-2zM29 14h1v1h-1zM31 14h1v1h-1zM1 15h2v1h-2zM7 15h1v1h-1zM10 15h2v1h-2zM13 15h2v1h-2zM17 15h1v1h-1zM19 15h2v1h-2zM22 15h2v1h-2zM25 15h1v1h-1zM27 15h2v1h-2zM30 15h1v1h-1zM32 15h1v1h-1zM2 16h5v1h-5zM8 16h2v1h-2zM11 16h2v1h-2zM22 16h4v1h-4zM27 16h3v1h-3zM32 16h1v1h-1zM1 17h1v1h-1zM4 17h1v1h-1zM7 17h1v1h-1zM11 17h3v1h-3zM17 17h1v1h-1zM19 17h2v1h-2zM23 17h2v1h-2zM26 17h1v1h-1zM29 17h4v1h-4zM1 18h3v1h-3zM6 18h2v1h-2zM9 18h2v1h-2zM12 18h1v1h-1zM17 18h4v1h-4zM22 18h2v1h-2zM25 18h3v1h-3zM29 18h4v1h-4zM1 19h1v1h-1zM5 19h1v1h-1zM9 19h1v1h-1zM14 19h4v1h-4zM19 19h2v1h-2zM24 19h2v1h-2zM28 19h3v1h-3zM1 20h2v1h-2zM4 20h5v1h-5zM12 20h2v1h-2zM15 20h5v1h-5zM22 20h4v1h-4zM28 20h2v1h-2zM0 21h2v1h-2zM4 21h1v1h-1zM7 21h1v1h-1zM11 21h2v1h-2zM14 21h2v1h-2zM17 21h3v1h-3zM21 21h3v1h-3zM28 21h1v1h-1zM0 22h1v1h-1zM2 22h2v1h-2zM5 22h3v1h-3zM12 22h5v1h-5zM20 22h2v1h-2zM24 22h1v1h-1zM27 22h1v1h-1zM30 22h2v1h-2zM0 23h1v1h-1zM4 23h2v1h-2zM7 23h3v1h-3zM13 23h1v1h-1zM15 23h1v1h-1zM19 23h1v1h-1zM22 23h1v1h-1zM24 23h1v1h-1zM26 23h1v1h-1zM29 23h2v1h-2zM32 23h1v1h-1zM0 24h2v1h-2zM5 24h2v1h-2zM9 24h1v1h-1zM15 24h2v1h-2zM19 24h2v1h-2zM23 24h6v1h-6zM8 25h4v1h-4zM15 25h1v1h-1zM17 25h3v1h-3zM21 25h4v1h-4zM28 25h1v1h-1zM30 25h3v1h-3zM0 26h7v1h-7zM8 26h2v1h-2zM11 26h1v1h-1zM13 26h1v1h-1zM18 26h1v1h-1zM20 26h1v1h-1zM22 26h3v1h-3zM26 26h1v1h-1zM28 26h1v1h-1zM30 26h1v1h-1zM0 27h1v1h-1zM6 27h1v1h-1zM12 27h5v1h-5zM18 27h1v1h-1zM23 27h2v1h-2zM28 27h4v1h-4zM0 28h1v1h-1zM2 28h3v1h-3zM6 28h1v1h-1zM12 28h1v1h-1zM15 28h2v1h-2zM18 28h1v1h-1zM20 28h1v1h-1zM24 28h6v1h-6zM31 28h2v1h-2zM0 29h1v1h-1zM2 29h3v1h-3zM6 29h1v1h-1zM9 29h1v1h-1zM14 29h1v1h-1zM19 29h1v1h-1zM22 29h4v1h-4zM27 29h4v1h-4zM32 29h1v1h-1zM0 30h1v1h-1zM2 30h3v1h-3zM6 30h1v1h-1zM11 30h2v1h-2zM14 30h1v1h-1zM17 30h1v1h-1zM19 30h4v1h-4zM24 30h1v1h-1zM27 30h2v1h-2zM31 30h2v1h-2zM0 31h1v1h-1zM6 31h1v1h-1zM8 31h2v1h-2zM11 31h1v1h-1zM15 31h4v1h-4zM23 31h1v1h-1zM25 31h1v1h-1zM27 31h4v1h-4zM0 32h7v1h-7zM9 32h1v1h-1zM11 32h1v1h-1zM13 32h1v1h-1zM16 32h4v1h-4zM22 32h1v1h-1zM24 32h2v1h-2zM27 32h1v1h-1zM29 32h3v1h-3z'
        }
      },
      {
        amount: '\u20ac5',
        link: 'https://buy.stripe.com/9B600jdzW4pOdhJ3sc3cc02',
        qr: {
          for: 'https://buy.stripe.com/9B600jdzW4pOdhJ3sc3cc02',
          size: 33,
          path: 'M0 0h7v1h-7zM8 0h4v1h-4zM14 0h2v1h-2zM18 0h2v1h-2zM21 0h1v1h-1zM23 0h1v1h-1zM26 0h7v1h-7zM0 1h1v1h-1zM6 1h1v1h-1zM9 1h2v1h-2zM14 1h4v1h-4zM20 1h5v1h-5zM26 1h1v1h-1zM32 1h1v1h-1zM0 2h1v1h-1zM2 2h3v1h-3zM6 2h1v1h-1zM8 2h2v1h-2zM13 2h3v1h-3zM17 2h4v1h-4zM22 2h1v1h-1zM24 2h1v1h-1zM26 2h1v1h-1zM28 2h3v1h-3zM32 2h1v1h-1zM0 3h1v1h-1zM2 3h3v1h-3zM6 3h1v1h-1zM8 3h1v1h-1zM10 3h2v1h-2zM13 3h3v1h-3zM20 3h4v1h-4zM26 3h1v1h-1zM28 3h3v1h-3zM32 3h1v1h-1zM0 4h1v1h-1zM2 4h3v1h-3zM6 4h1v1h-1zM10 4h2v1h-2zM14 4h2v1h-2zM17 4h1v1h-1zM20 4h1v1h-1zM23 4h1v1h-1zM26 4h1v1h-1zM28 4h3v1h-3zM32 4h1v1h-1zM0 5h1v1h-1zM6 5h1v1h-1zM8 5h2v1h-2zM11 5h1v1h-1zM13 5h3v1h-3zM18 5h2v1h-2zM21 5h2v1h-2zM26 5h1v1h-1zM32 5h1v1h-1zM0 6h7v1h-7zM8 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM14 6h1v1h-1zM16 6h1v1h-1zM18 6h1v1h-1zM20 6h1v1h-1zM22 6h1v1h-1zM24 6h1v1h-1zM26 6h7v1h-7zM8 7h2v1h-2zM11 7h4v1h-4zM16 7h4v1h-4zM21 7h4v1h-4zM1 8h1v1h-1zM3 8h1v1h-1zM5 8h5v1h-5zM12 8h1v1h-1zM14 8h1v1h-1zM16 8h1v1h-1zM18 8h1v1h-1zM21 8h1v1h-1zM23 8h1v1h-1zM25 8h3v1h-3zM29 8h2v1h-2zM32 8h1v1h-1zM0 9h2v1h-2zM5 9h1v1h-1zM7 9h1v1h-1zM9 9h1v1h-1zM13 9h1v1h-1zM17 9h1v1h-1zM20 9h1v1h-1zM22 9h1v1h-1zM24 9h4v1h-4zM32 9h1v1h-1zM0 10h2v1h-2zM3 10h1v1h-1zM5 10h2v1h-2zM8 10h1v1h-1zM10 10h1v1h-1zM13 10h3v1h-3zM17 10h3v1h-3zM21 10h1v1h-1zM24 10h2v1h-2zM27 10h2v1h-2zM30 10h3v1h-3zM1 11h3v1h-3zM10 11h2v1h-2zM13 11h1v1h-1zM16 11h1v1h-1zM20 11h2v1h-2zM23 11h3v1h-3zM28 11h2v1h-2zM31 11h1v1h-1zM2 12h2v1h-2zM5 12h2v1h-2zM8 12h1v1h-1zM10 12h5v1h-5zM18 12h1v1h-1zM20 12h8v1h-8zM29 12h1v1h-1zM32 12h1v1h-1zM0 13h1v1h-1zM2 13h1v1h-1zM5 13h1v1h-1zM8 13h2v1h-2zM16 13h1v1h-1zM19 13h3v1h-3zM24 13h2v1h-2zM28 13h1v1h-1zM31 13h2v1h-2zM1 14h1v1h-1zM5 14h2v1h-2zM8 14h1v1h-1zM11 14h7v1h-7zM20 14h4v1h-4zM25 14h2v1h-2zM28 14h2v1h-2zM31 14h1v1h-1zM0 15h1v1h-1zM2 15h1v1h-1zM4 15h2v1h-2zM8 15h2v1h-2zM11 15h1v1h-1zM16 15h1v1h-1zM18 15h1v1h-1zM21 15h1v1h-1zM24 15h1v1h-1zM26 15h1v1h-1zM29 15h1v1h-1zM31 15h1v1h-1zM1 16h2v1h-2zM4 16h4v1h-4zM11 16h4v1h-4zM19 16h6v1h-6zM26 16h1v1h-1zM28 16h2v1h-2zM31 16h1v1h-1zM2 17h3v1h-3zM8 17h1v1h-1zM11 17h1v1h-1zM14 17h2v1h-2zM17 17h2v1h-2zM21 17h1v1h-1zM23 17h1v1h-1zM25 17h1v1h-1zM27 17h1v1h-1zM29 17h1v1h-1zM31 17h2v1h-2zM1 18h2v1h-2zM4 18h3v1h-3zM9 18h7v1h-7zM18 18h1v1h-1zM20 18h3v1h-3zM25 18h2v1h-2zM30 18h3v1h-3zM0 19h1v1h-1zM3 19h1v1h-1zM5 19h1v1h-1zM10 19h3v1h-3zM18 19h4v1h-4zM23 19h1v1h-1zM25 19h3v1h-3zM31 19h1v1h-1zM2 20h2v1h-2zM6 20h2v1h-2zM11 20h1v1h-1zM14 20h1v1h-1zM18 20h2v1h-2zM21 20h1v1h-1zM24 20h1v1h-1zM32 20h1v1h-1zM1 21h2v1h-2zM8 21h2v1h-2zM12 21h2v1h-2zM16 21h1v1h-1zM18 21h1v1h-1zM20 21h1v1h-1zM22 21h3v1h-3zM26 21h1v1h-1zM29 21h1v1h-1zM31 21h2v1h-2zM0 22h2v1h-2zM3 22h1v1h-1zM5 22h5v1h-5zM15 22h1v1h-1zM19 22h1v1h-1zM24 22h3v1h-3zM28 22h1v1h-1zM30 22h1v1h-1zM32 22h1v1h-1zM1 23h2v1h-2zM4 23h2v1h-2zM8 23h1v1h-1zM12 23h1v1h-1zM14 23h1v1h-1zM18 23h1v1h-1zM20 23h3v1h-3zM25 23h1v1h-1zM27 23h2v1h-2zM31 23h1v1h-1zM0 24h1v1h-1zM3 24h1v1h-1zM6 24h1v1h-1zM13 24h1v1h-1zM16 24h2v1h-2zM20 24h2v1h-2zM24 24h6v1h-6zM31 24h1v1h-1zM8 25h1v1h-1zM12 25h1v1h-1zM16 25h1v1h-1zM19 25h1v1h-1zM21 25h1v1h-1zM24 25h1v1h-1zM28 25h2v1h-2zM31 25h2v1h-2zM0 26h7v1h-7zM8 26h2v1h-2zM13 26h1v1h-1zM15 26h2v1h-2zM18 26h1v1h-1zM20 26h3v1h-3zM24 26h1v1h-1zM26 26h1v1h-1zM28 26h3v1h-3zM0 27h1v1h-1zM6 27h1v1h-1zM8 27h4v1h-4zM13 27h1v1h-1zM18 27h5v1h-5zM24 27h1v1h-1zM28 27h1v1h-1zM32 27h1v1h-1zM0 28h1v1h-1zM2 28h3v1h-3zM6 28h1v1h-1zM10 28h1v1h-1zM14 28h1v1h-1zM17 28h1v1h-1zM19 28h1v1h-1zM21 28h2v1h-2zM24 28h6v1h-6zM0 29h1v1h-1zM2 29h3v1h-3zM6 29h1v1h-1zM8 29h1v1h-1zM10 29h1v1h-1zM12 29h2v1h-2zM18 29h1v1h-1zM20 29h2v1h-2zM23 29h1v1h-1zM26 29h1v1h-1zM28 29h1v1h-1zM31 29h1v1h-1zM0 30h1v1h-1zM2 30h3v1h-3zM6 30h1v1h-1zM9 30h1v1h-1zM12 30h3v1h-3zM16 30h1v1h-1zM22 30h4v1h-4zM28 30h1v1h-1zM30 30h1v1h-1zM32 30h1v1h-1zM0 31h1v1h-1zM6 31h1v1h-1zM8 31h1v1h-1zM10 31h1v1h-1zM15 31h1v1h-1zM19 31h1v1h-1zM21 31h2v1h-2zM24 31h2v1h-2zM0 32h7v1h-7zM10 32h1v1h-1zM13 32h1v1h-1zM15 32h1v1h-1zM18 32h1v1h-1zM21 32h1v1h-1zM24 32h1v1h-1zM28 32h2v1h-2zM31 32h1v1h-1z'
        }
      },
      {
        amount: '\u20ac10',
        link: 'https://buy.stripe.com/dRm3cvanK09y4Ld9QA3cc03',
        qr: {
          for: 'https://buy.stripe.com/dRm3cvanK09y4Ld9QA3cc03',
          size: 33,
          path: 'M0 0h7v1h-7zM8 0h4v1h-4zM13 0h3v1h-3zM18 0h2v1h-2zM21 0h1v1h-1zM23 0h1v1h-1zM26 0h7v1h-7zM0 1h1v1h-1zM6 1h1v1h-1zM10 1h1v1h-1zM14 1h4v1h-4zM20 1h2v1h-2zM23 1h2v1h-2zM26 1h1v1h-1zM32 1h1v1h-1zM0 2h1v1h-1zM2 2h3v1h-3zM6 2h1v1h-1zM8 2h3v1h-3zM13 2h1v1h-1zM15 2h1v1h-1zM17 2h4v1h-4zM22 2h1v1h-1zM24 2h1v1h-1zM26 2h1v1h-1zM28 2h3v1h-3zM32 2h1v1h-1zM0 3h1v1h-1zM2 3h3v1h-3zM6 3h1v1h-1zM8 3h1v1h-1zM10 3h2v1h-2zM13 3h3v1h-3zM20 3h1v1h-1zM22 3h2v1h-2zM26 3h1v1h-1zM28 3h3v1h-3zM32 3h1v1h-1zM0 4h1v1h-1zM2 4h3v1h-3zM6 4h1v1h-1zM10 4h2v1h-2zM14 4h2v1h-2zM17 4h1v1h-1zM20 4h1v1h-1zM26 4h1v1h-1zM28 4h3v1h-3zM32 4h1v1h-1zM0 5h1v1h-1zM6 5h1v1h-1zM8 5h2v1h-2zM12 5h3v1h-3zM18 5h2v1h-2zM21 5h2v1h-2zM26 5h1v1h-1zM32 5h1v1h-1zM0 6h7v1h-7zM8 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM14 6h1v1h-1zM16 6h1v1h-1zM18 6h1v1h-1zM20 6h1v1h-1zM22 6h1v1h-1zM24 6h1v1h-1zM26 6h7v1h-7zM8 7h2v1h-2zM11 7h1v1h-1zM13 7h3v1h-3zM17 7h3v1h-3zM21 7h4v1h-4zM1 8h1v1h-1zM3 8h1v1h-1zM5 8h5v1h-5zM12 8h1v1h-1zM14 8h3v1h-3zM18 8h1v1h-1zM21 8h1v1h-1zM23 8h1v1h-1zM25 8h3v1h-3zM29 8h2v1h-2zM32 8h1v1h-1zM1 9h1v1h-1zM5 9h1v1h-1zM7 9h1v1h-1zM17 9h1v1h-1zM20 9h3v1h-3zM24 9h4v1h-4zM31 9h2v1h-2zM1 10h1v1h-1zM3 10h4v1h-4zM8 10h3v1h-3zM14 10h2v1h-2zM17 10h3v1h-3zM22 10h1v1h-1zM24 10h1v1h-1zM27 10h2v1h-2zM30 10h1v1h-1zM32 10h1v1h-1zM0 11h4v1h-4zM5 11h1v1h-1zM11 11h1v1h-1zM14 11h1v1h-1zM16 11h1v1h-1zM18 11h1v1h-1zM20 11h2v1h-2zM23 11h3v1h-3zM28 11h2v1h-2zM31 11h1v1h-1zM0 12h1v1h-1zM2 12h3v1h-3zM6 12h1v1h-1zM10 12h3v1h-3zM16 12h1v1h-1zM18 12h1v1h-1zM20 12h4v1h-4zM25 12h2v1h-2zM29 12h1v1h-1zM32 12h1v1h-1zM0 13h1v1h-1zM3 13h1v1h-1zM9 13h1v1h-1zM11 13h2v1h-2zM14 13h3v1h-3zM19 13h3v1h-3zM28 13h1v1h-1zM30 13h3v1h-3zM1 14h1v1h-1zM5 14h2v1h-2zM13 14h3v1h-3zM17 14h1v1h-1zM20 14h4v1h-4zM25 14h4v1h-4zM30 14h2v1h-2zM0 15h1v1h-1zM3 15h3v1h-3zM7 15h3v1h-3zM11 15h1v1h-1zM16 15h1v1h-1zM18 15h1v1h-1zM21 15h1v1h-1zM23 15h1v1h-1zM26 15h2v1h-2zM29 15h1v1h-1zM31 15h1v1h-1zM1 16h2v1h-2zM4 16h3v1h-3zM11 16h4v1h-4zM19 16h6v1h-6zM26 16h1v1h-1zM28 16h2v1h-2zM31 16h1v1h-1zM2 17h2v1h-2zM8 17h1v1h-1zM11 17h1v1h-1zM13 17h3v1h-3zM18 17h1v1h-1zM23 17h1v1h-1zM25 17h1v1h-1zM27 17h1v1h-1zM29 17h1v1h-1zM32 17h1v1h-1zM0 18h3v1h-3zM4 18h1v1h-1zM6 18h1v1h-1zM9 18h5v1h-5zM15 18h1v1h-1zM18 18h1v1h-1zM20 18h1v1h-1zM22 18h1v1h-1zM30 18h3v1h-3zM0 19h2v1h-2zM3 19h1v1h-1zM11 19h4v1h-4zM17 19h5v1h-5zM23 19h1v1h-1zM25 19h3v1h-3zM0 20h10v1h-10zM11 20h3v1h-3zM16 20h1v1h-1zM18 20h2v1h-2zM31 20h1v1h-1zM3 21h1v1h-1zM5 21h1v1h-1zM7 21h4v1h-4zM13 21h1v1h-1zM15 21h2v1h-2zM18 21h1v1h-1zM20 21h1v1h-1zM22 21h1v1h-1zM24 21h1v1h-1zM26 21h1v1h-1zM29 21h1v1h-1zM31 21h2v1h-2zM0 22h3v1h-3zM5 22h3v1h-3zM9 22h1v1h-1zM11 22h2v1h-2zM19 22h1v1h-1zM25 22h2v1h-2zM28 22h2v1h-2zM32 22h1v1h-1zM1 23h1v1h-1zM3 23h3v1h-3zM12 23h1v1h-1zM14 23h2v1h-2zM18 23h1v1h-1zM20 23h3v1h-3zM25 23h1v1h-1zM29 23h1v1h-1zM31 23h1v1h-1zM0 24h1v1h-1zM2 24h2v1h-2zM6 24h2v1h-2zM11 24h1v1h-1zM13 24h1v1h-1zM16 24h2v1h-2zM20 24h2v1h-2zM23 24h6v1h-6zM31 24h1v1h-1zM8 25h1v1h-1zM12 25h1v1h-1zM16 25h1v1h-1zM19 25h1v1h-1zM21 25h1v1h-1zM24 25h1v1h-1zM28 25h2v1h-2zM32 25h1v1h-1zM0 26h7v1h-7zM8 26h2v1h-2zM14 26h4v1h-4zM20 26h1v1h-1zM22 26h1v1h-1zM24 26h1v1h-1zM26 26h1v1h-1zM28 26h4v1h-4zM0 27h1v1h-1zM6 27h1v1h-1zM8 27h4v1h-4zM17 27h1v1h-1zM19 27h4v1h-4zM24 27h1v1h-1zM28 27h1v1h-1zM32 27h1v1h-1zM0 28h1v1h-1zM2 28h3v1h-3zM6 28h1v1h-1zM9 28h2v1h-2zM12 28h1v1h-1zM14 28h1v1h-1zM16 28h2v1h-2zM19 28h1v1h-1zM22 28h1v1h-1zM24 28h6v1h-6zM0 29h1v1h-1zM2 29h3v1h-3zM6 29h1v1h-1zM8 29h1v1h-1zM10 29h1v1h-1zM12 29h5v1h-5zM18 29h1v1h-1zM20 29h2v1h-2zM23 29h1v1h-1zM26 29h1v1h-1zM28 29h1v1h-1zM31 29h1v1h-1zM0 30h1v1h-1zM2 30h3v1h-3zM6 30h1v1h-1zM9 30h1v1h-1zM13 30h2v1h-2zM22 30h4v1h-4zM28 30h2v1h-2zM32 30h1v1h-1zM0 31h1v1h-1zM6 31h1v1h-1zM8 31h1v1h-1zM10 31h3v1h-3zM15 31h2v1h-2zM21 31h2v1h-2zM24 31h1v1h-1zM0 32h7v1h-7zM10 32h1v1h-1zM13 32h1v1h-1zM18 32h1v1h-1zM21 32h1v1h-1zM23 32h2v1h-2zM28 32h1v1h-1zM31 32h1v1h-1z'
        }
      }
    ],
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
  let layout = { groups: [], tiles: [] }; // this site's order - see "arranging"
  let layouts = {}; // every site's
  let arranging = false;
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
   * @param {string} [feature.hint]    tooltip: a few words (the help says the rest)
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
   * @param {boolean}  [feature.panelResult] actions only: the panel stays open
   *                                        and onRun(ui) answers in it, in a
   *                                        card that folds down under the
   *                                        list - see panelUi()
   * @param {boolean} [feature.countClick]  toggles only: each switch, on or off,
   *                                   is a use for Time saved; other tools
   *                                   call DynaBoost.saved(id) when they did
   *                                   their work
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
      if (feature.countClick) api.saved(id);
      return;
    }
    state[id] = !isOn(id);
    applyFeature(feature);
    queueRender();
    store({ [STORAGE_KEY]: state });
    countUse();
    if (feature.countClick) api.saved(id);
  }

  /* A tool that fails without a message of its own still tells the user -
   * an error thrown at once or a promise that rejects later (async onRun). A
   * tool that shows its own message does not throw, so says it only once.
   * A tab it opened on the click (tabs open before any await - after one they
   * would be pop-ups) comes to the front, over this page's message, so the
   * tab says it too. */
  function guarded(feature, go) {
    const opened = [];
    const from = location.href;
    const open = window.open;
    window.open = function () {
      const tab = open.apply(window, arguments);
      if (tab) opened.push(tab);
      return tab;
    };
    const failed = (e) => {
      const why = (e && e.message) || String(e);
      console.warn('[DynaBoost] feature "' + feature.id + '" failed:', e);
      toast(feature.name, 'It stopped with an error: ' + why, true);
      if (window.DynaBoost.tabError) opened.forEach((tab) => window.DynaBoost.tabError(tab, feature.name, why, from, feature.group));
    };
    try {
      const done = go();
      if (done && typeof done.then === 'function') done.then(null, failed);
    } catch (e) {
      failed(e);
    } finally {
      window.open = open;
    }
  }

  function run(feature) {
    const here = shownHere(feature);
    if (!here && !framed.has(feature.id)) return;
    const ui = here && feature.panelResult ? panelUi(feature) : null;
    if (!ui) setPanel(false);
    countUse();
    if (here) {
      if (feature.onRun) guarded(feature, () => feature.onRun(ui));
    } else if (feature.frameRun) {
      guarded(feature, () => feature.frameRun((op, payload) => askFrame(feature.id, op, payload)));
    } else {
      send({ type: 'DB_FRAME_RUN', id: feature.id, frameId: framed.get(feature.id) }).catch(() => {});
    }
  }

  function setShowAll(value) {
    showAll = !!value;
    store({ [SHOW_ALL_KEY]: showAll });
    render();
  }

  // ---------- a rating, suggested by a dot ----------

  /* The heart in the footer gets a small glowing gold dot after DynaBoost has
   * been used for a while - RATE_AFTER tools run or switched, over RATE_DAYS
   * days at least - and after every update (background.js sets news to the
   * new version). Opening Say thanks puts it away until the next update. The
   * count stays in this browser. */
  const USE_KEY = 'dynaboost.use'; // { since, n, seen, news }
  const RATE_AFTER = 15;
  const RATE_DAYS = 3;
  let use = null;

  const rateDue = () => !!use && !use.seen && (!!use.news || (use.n >= RATE_AFTER && Date.now() - use.since >= RATE_DAYS * 864e5));

  function markThanks() {
    const btn = refs && refs.thanksBtn;
    if (!btn) return;
    const due = rateDue();
    btn.classList.toggle('db-thanks-due', due);
    // What the dot says.
    if (due) btn.title = (use.news ? 'New: DynaBoost ' + use.news + '. ' : '') + 'Enjoying DynaBoost? A rating helps.';
    else btn.removeAttribute('title');
  }

  function countUse() {
    if (!use || use.seen) return;
    use.n++;
    store({ [USE_KEY]: use });
    markThanks();
  }

  function thanksSeen() {
    if (!use || (use.seen && !use.news)) return;
    use.seen = true;
    use.news = null;
    store({ [USE_KEY]: use });
    markThanks();
  }

  // ---------- time saved ----------

  /* The gold capsule in the header: the time the tools have saved, from
   * dynaboost.saved - background.js adds the uses up, sent by
   * DynaBoost.saved(id). Opened, the panel rolls the number on from what a
   * panel showed last, in this tab or another; while it is open, a use rolls
   * it at once. */
  const SAVED_KEY = 'dynaboost.saved';
  const SAVED_SEEN_KEY = 'dynaboost.savedSeen';
  let saved = null;
  let savedSeen = null;

  const toolName = (id) => (id === 'solution-pins' ? 'My solutions' : (features.find((f) => f.id === id) || {}).name || id);

  function showSaved(animate) {
    const clock = refs && refs.saved;
    if (!clock || !root || !root.classList.contains('db-open')) return;
    const total = (saved && saved.total) || 0;
    if (clock.value === null) clock.set(typeof savedSeen === 'number' && savedSeen <= total ? savedSeen : total, false);
    clock.set(total, animate);
    clock.el.title = window.DynaBoost.timeSaved.tip(saved, toolName);
    if (savedSeen !== total) {
      savedSeen = total;
      store({ [SAVED_SEEN_KEY]: total });
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[SAVED_SEEN_KEY]) savedSeen = changes[SAVED_SEEN_KEY].newValue;
    if (!changes[SAVED_KEY]) return;
    saved = changes[SAVED_KEY].newValue || null;
    showSaved(true);
  });

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
   * (prefers-color-scheme) or the page is - the page read once, after it has
   * loaded, so the panel does not change with whatever is on screen when it
   * opens. The button's choice holds on every page, until the browser's own
   * mode changes; then the browser wins. */
  let theme = null; // { mode: 'dark' | 'light', browser: 'dark' | 'light' }
  let pageDark = null; // what the loaded page said

  function luminance(color) {
    const m = String(color).match(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?/);
    if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return null;
    const [r, g, b] = [m[1], m[2], m[3]].map((v) => Number(v) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function pageLooksDark() {
    if (pageDark !== null) return pageDark;
    const probes = [document.querySelector('main, [role="main"]'), document.body, document.documentElement];
    for (const el of probes) {
      if (!el) continue;
      const l = luminance(getComputedStyle(el).backgroundColor);
      if (l === null) continue;
      // Kept once the page has loaded: a dialog or a dark section later on
      // does not turn the panel dark.
      if (document.readyState === 'complete') pageDark = l < 0.35;
      return l < 0.35;
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
    ext(() => chrome.storage.local.remove(THEME_KEY));
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

  // Kept even when it is what the page alone would give: a choice made on a
  // light page holds on a dark one too.
  function toggleTheme() {
    theme = { mode: isDark() ? 'light' : 'dark', browser: browserMode() };
    store({ [THEME_KEY]: theme });
    applyTheme();
  }

  // The browser switched mode, or the button was used in another tab.
  if (browserDark)
    browserDark.addEventListener('change', () => {
      dropStaleTheme();
      applyTheme();
    });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[USE_KEY] && changes[USE_KEY].newValue) {
      use = changes[USE_KEY].newValue;
      markThanks();
    }
    if (area !== 'local' || !changes[THEME_KEY]) return;
    theme = readTheme(changes[THEME_KEY].newValue);
    applyTheme();
  });

  const INFO =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="8.6" stroke="currentColor" stroke-width="1.7"/>' +
    '<path d="M12 11v5.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="7.9" r="1.15" fill="currentColor"/></svg>';

  /* After an update the (i) gets a gold dot, as the heart does: What's new
   * is waiting. Its click opens the help there (background.js knows from
   * dynaboost.whatsNew and clears it), and the dot goes in every tab - until
   * the next update. A new install has none. */
  let newsDue = null;
  const HELP_TIP = 'Help - what every tool does, and its limits';

  function markInfo() {
    const btn = refs && refs.info;
    if (!btn) return;
    btn.classList.toggle('db-info-due', !!newsDue);
    btn.title = newsDue ? 'DynaBoost was updated to v' + newsDue + ' - see What’s new' : HELP_TIP;
    btn.setAttribute('aria-label', btn.title);
  }

  /* The kind of page, for a report from the help's Report a bug: the site and
   * what the context strip calls the page - "Dynamics 365 · Record". Never
   * the address or an id. */
  function pageKind() {
    const host = location.hostname.toLowerCase();
    const site = host.endsWith('.dynamics.com')
      ? 'Dynamics 365'
      : host === 'make.powerapps.com'
        ? 'Power Apps'
        : host === 'make.powerautomate.com'
          ? 'Power Automate'
          : 'Azure DevOps';
    const c = detectContext();
    return site + (c ? ' · ' + c.kind : '');
  }

  /* The (i) in the header: src/help.html at the tools of this page, with the
   * tiles' names and icons - or at What's new, with the dot on. */
  async function openHelp() {
    const here = features.filter(usable).map((f) => f.id);
    if (refs && refs.top.childElementCount) here.push('solution-pins');
    try {
      await store({ [HELP_TILES_KEY]: features.map((f) => ({ id: f.id, name: f.name, icon: f.icon || '', group: groupOf(f) })) });
    } catch (e) {
      /* the page reads without the icons */
    }
    send({ type: 'DB_OPEN_HELP', here: here, dark: isDark(), page: pageKind() }).catch(() => {});
    setPanel(false);
  }

  function buildShell() {
    // One left behind by a copy from before an update.
    document.querySelectorAll('#dynaboost-root').forEach((old) => old.remove());
    root = el('div');
    root.id = 'dynaboost-root';

    const panel = el('div', 'db-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'DynaBoost');

    const head = el('div', 'db-head');
    const headMark = el('img', 'db-head-mark');
    headMark.src = ICON_URL;
    headMark.alt = '';
    const headText = el('div', 'db-head-text');
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
    infoBtn.title = HELP_TIP;
    infoBtn.setAttribute('aria-label', infoBtn.title);
    infoBtn.addEventListener('click', openHelp);
    const themeBtn = el('button', 'db-theme');
    themeBtn.type = 'button';
    themeBtn.addEventListener('click', toggleTheme);
    const savedClock = window.DynaBoost.timeSaved ? window.DynaBoost.timeSaved.counter(document) : null;
    head.append(headMark, headText);
    if (savedClock) head.appendChild(savedClock.el);
    head.append(infoBtn, themeBtn, close);

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
    // The pencil arranges the panel; while it does, the footer holds Reset
    // order and Done instead.
    const arrange = el('button', 'db-arrange');
    arrange.type = 'button';
    arrange.innerHTML = PENCIL_SVG;
    arrange.title = 'Arrange sections and tiles';
    arrange.setAttribute('aria-label', arrange.title);
    arrange.addEventListener('click', () => setArranging(true));
    const reset = el('button', 'db-arrange-reset', 'Reset order');
    reset.type = 'button';
    reset.title = 'Back to the order DynaBoost comes with';
    reset.addEventListener('click', resetLayout);
    const done = el('button', 'db-arrange-done', 'Done');
    done.type = 'button';
    done.addEventListener('click', () => setArranging(false));
    foot.append(thanks.button, reset, arrange, scope, done);

    // Between the header and the footer one area scrolls: the sections, the
    // tiles and the cards that fold down under them (an action's answer, Say
    // thanks). However much is open, the header and the footer stay in view.
    const mid = el('div', 'db-mid');
    mid.append(top, body, thanks.card);
    panel.append(head, ctx, mid, foot);
    root.appendChild(panel);
    document.body.appendChild(root);

    // Esc puts back a tile being dragged, then ends arranging, then closes.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !root || !root.classList.contains('db-open')) return;
      if (drag && drag.on) dragEnd(null, true);
      else if (arranging) setArranging(false);
      else setPanel(false);
    });
    // A drag's pointer is held by the panel (see grab()).
    panel.addEventListener('pointermove', dragMove);
    panel.addEventListener('pointerup', (e) => dragEnd(e, false));
    panel.addEventListener('pointercancel', (e) => dragEnd(e, true));
    panel.addEventListener('lostpointercapture', (e) => dragEnd(e, false));

    return { panel, info: infoBtn, top, body, mid, foot, scope, arrange, reset, ctx, ctxKind, ctxId, ctxSub, ctxCopy, theme: themeBtn, thanksBtn: thanks.button, saved: savedClock };
  }

  const HEART_SVG =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M12 20.3s-7.8-4.7-7.8-10.4A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 7.8 2.7c0 5.7-7.8 10.4-7.8 10.4z" ' +
    'stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  const STAR_SVG =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="m12 3.8 2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  // LinkedIn's own mark, in its own blue.
  const LINKEDIN_SVG =
    '<svg class="db-me-in" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<rect width="24" height="24" rx="4.5" fill="#0A66C2"/>' +
    '<path fill="#fff" d="M7.1 9.4h2.6v8.3H7.1zm1.3-4.1a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm2.9 4.1h2.5v1.1h.04c.35-.66 1.2-1.36 2.47-1.36 2.64 0 3.13 1.74 3.13 4v4.55h-2.6v-4.03c0-.96-.02-2.2-1.34-2.2-1.34 0-1.55 1.05-1.55 2.13v4.1h-2.6z"/></svg>';
  // A QR code as people know it: three corner squares and a few dots.
  const QR_ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="3.5" y="3.5" width="7" height="7" rx="1.3" stroke="currentColor" stroke-width="1.6"/>' +
    '<rect x="13.5" y="3.5" width="7" height="7" rx="1.3" stroke="currentColor" stroke-width="1.6"/>' +
    '<rect x="3.5" y="13.5" width="7" height="7" rx="1.3" stroke="currentColor" stroke-width="1.6"/>' +
    '<g fill="currentColor"><rect x="5.9" y="5.9" width="2.2" height="2.2" rx=".4"/><rect x="15.9" y="5.9" width="2.2" height="2.2" rx=".4"/>' +
    '<rect x="5.9" y="15.9" width="2.2" height="2.2" rx=".4"/><rect x="13.3" y="13.3" width="2.4" height="2.4" rx=".4"/>' +
    '<rect x="18.3" y="13.3" width="2.4" height="2.4" rx=".4"/><rect x="15.8" y="15.8" width="2.4" height="2.4" rx=".4"/>' +
    '<rect x="13.3" y="18.3" width="2.4" height="2.4" rx=".4"/><rect x="18.3" y="18.3" width="2.4" height="2.4" rx=".4"/></g></svg>';
  // The arrow out to another page: Card or PayPal, Rate DynaBoost.
  const GO_OUT =
    '<svg class="db-go" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M7.5 16.5 16.5 7.5M9.5 7.5h7v7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CHECK_SVG =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m5 13 4 4L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const COPY_SVG =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.6"/>' +
    '<path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
    '</svg>';
  const PENCIL_SVG =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M4.5 19.5 5.4 15.3 15.6 5.1a2.1 2.1 0 0 1 3 0l.3.3a2.1 2.1 0 0 1 0 3L8.7 18.6z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
    '<path d="m13.8 6.9 3.3 3.3" stroke="currentColor" stroke-width="1.7"/></svg>';

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
      if (open) {
        thanksSeen();
        reveal(card);
      }
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
        'and what that time is worth. If you would like, leave a voluntary tip; it unlocks nothing extra. ' +
        'A rating helps too: it lets others find it.'
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
    pay.append(payText);
    pay.insertAdjacentHTML('beforeend', GO_OUT);
    // The payment page is open: say thanks.
    pay.addEventListener('click', () => {
      title.textContent = 'Thank you!';
      card.classList.add('db-thanks-said');
    });

    // Beside it, the same payment by phone: a QR code folded under the row.
    const payRow = el('div', 'db-thanks-payrow');
    payRow.appendChild(pay);
    const qrOf = (q, link) => (q && q.for === link ? q : null);
    const qrOk = !!qrOf(THANKS.stripeQr, THANKS.stripe);
    const qr = el('div', 'db-qr');
    let qrCode = null;
    if (qrOk) {
      const qrBtn = el('button', 'db-thanks-qrbtn');
      qrBtn.type = 'button';
      qrBtn.title = 'Pay on your phone - show a QR code';
      qrBtn.setAttribute('aria-label', qrBtn.title);
      qrBtn.setAttribute('aria-expanded', 'false');
      qrBtn.innerHTML = QR_ICON;
      payRow.appendChild(qrBtn);
      const qrIn = el('div', 'db-qr-in');
      qrCode = (q) => {
        const n = q.size;
        return (
          '<svg class="db-qr-code" viewBox="-4 -4 ' + (n + 8) + ' ' + (n + 8) + '" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="QR code of the payment page">' +
          '<rect x="-4" y="-4" width="' + (n + 8) + '" height="' + (n + 8) + '" fill="#fff"/><path fill="#10224e" d="' + q.path + '"/></svg>'
        );
      };
      qrIn.innerHTML = qrCode(THANKS.stripeQr);
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
        if (open) reveal(qr);
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
      if (open) reveal(wallets);
    });

    // Stripe is a link to its Privacy Center - written for the person paying:
    // how the card and the data are kept safe, before paying.
    const note = el('div', 'db-thanks-note', 'Card payments are handled by ');
    const stripe = el('a', 'db-thanks-stripe', 'Stripe');
    stripe.href = 'https://stripe.com/legal/privacy-center';
    stripe.target = '_blank';
    stripe.rel = 'noopener noreferrer';
    stripe.title = 'How Stripe keeps your payment and your data safe';
    note.append(stripe, ' — DynaBoost never sees them.');

    // Quietly at the bottom: rate it, and who made it.
    const link = (href, cls, icon, small, name, end) => {
      const a = el('a', 'db-thanks-link ' + cls);
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      const t = el('span', 'db-link-text');
      t.append(el('span', 'db-link-small', small), el('b', null, name));
      a.append(icon, t);
      a.insertAdjacentHTML('beforeend', end);
      return a;
    };
    const star = el('span', 'db-link-star');
    star.innerHTML = STAR_SVG;
    // A rating is the quickest thank you - in the store DynaBoost came from
    // (DynaBoost.store, src/code-view.js).
    const store = window.DynaBoost.store || { url: 'https://chromewebstore.google.com/detail/odonlnpmplbipgojjodfpedjbbahfkmk', small: 'On the Web Store' };
    const rate = link(store.url, 'db-thanks-rate', star, store.small, 'Rate DynaBoost', GO_OUT);
    const me = link(THANKS.author.linkedin, 'db-thanks-me', el('span', 'db-me-mono', THANKS.author.initials), 'Made by', THANKS.author.name, LINKEDIN_SVG);
    me.title = THANKS.author.name + ' on LinkedIn';
    const links = el('div', 'db-thanks-links');
    links.append(rate, me);

    /* Once or Monthly: one switch above the pay button, which stays the
     * same - only where it goes changes, and its QR code. Monthly puts, where
     * Crypto was (it has no monthly), a row of the same size: the amount a
     * month to pick and how it ends. */
    const plans = THANKS.monthly || [];
    const seg = el('div', 'db-thanks-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'How often');
    const once = el('button', null, 'Once');
    const monthly = el('button', null, 'Monthly');
    for (const b of [once, monthly]) b.type = 'button';
    const plan = el('div', 'db-thanks-opt db-thanks-plan');
    plan.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="3.5" y="5" width="17" height="15" rx="2.2" stroke="currentColor" stroke-width="1.6"/>' +
      '<path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    // One amount is said, not offered: nothing in the row looks like a
    // button (a box around it read as "click to cancel"). Several are a choice.
    const planText = el('span', 'db-thanks-opt-text');
    planText.append(
      el('span', 'db-thanks-opt-name', plans.length === 1 ? plans[0].amount + ' a month' : 'Every month'),
      el('span', 'db-thanks-opt-sub', plans.length === 1 ? 'Cancel anytime from your Stripe receipt' : 'Cancel anytime')
    );
    plan.title = 'Cancel anytime from the link in your Stripe receipt.';
    const chips = el('span', 'db-plan-chips');
    plan.append(planText);
    if (plans.length > 1) plan.appendChild(chips);
    let mode = 'once';
    let planAt = 0;
    const paint = () => {
      const isMonthly = mode === 'monthly';
      card.classList.toggle('db-thanks-monthly', isMonthly);
      once.setAttribute('aria-pressed', String(!isMonthly));
      monthly.setAttribute('aria-pressed', String(isMonthly));
      const p = plans[planAt];
      pay.href = isMonthly ? p.link : THANKS.stripe;
      pay.title = isMonthly ? 'Monthly support, ' + p.amount + ' a month' : '';
      chips.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(i === planAt)));
      const q = isMonthly ? qrOf(p.qr, p.link) : qrOf(THANKS.stripeQr, THANKS.stripe);
      const code = qr.querySelector('.db-qr-code');
      if (code && q && qrCode) code.outerHTML = qrCode(q);
      card.classList.toggle('db-qr-none', !q);
      if (isMonthly && card.classList.contains('db-wallets-open')) cryptoBtn.click();
    };
    plans.forEach((p, i) => {
      const b = el('button', 'db-plan-chip', p.amount);
      b.type = 'button';
      b.setAttribute('aria-label', p.amount + ' a month');
      b.addEventListener('click', () => {
        planAt = i;
        paint();
      });
      chips.appendChild(b);
    });
    once.addEventListener('click', () => {
      mode = 'once';
      paint();
    });
    monthly.addEventListener('click', () => {
      mode = 'monthly';
      paint();
    });
    seg.append(once, monthly);
    paint();

    const cardIn = el('div', 'db-thanks-in');
    cardIn.append(head, text);
    if (plans.length) cardIn.appendChild(seg);
    cardIn.append(payRow);
    if (qrOk) cardIn.appendChild(qr);
    cardIn.append(cryptoBtn, wallets);
    if (plans.length) cardIn.appendChild(plan);
    cardIn.append(note, links);
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
  let savedTimer = null;

  function setPanel(open) {
    if (!root) return;
    if (open) {
      // A frame of this page may have changed its page meanwhile.
      if (!inFrame) send({ type: 'DB_FRAME_PING' }).catch(() => {});
      applyTheme();
      updateContext();
      render();
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => showSaved(true), 260);
      watchedHref = location.href;
      if (!watchTimer) {
        watchTimer = setInterval(() => {
          if (location.href === watchedHref) return;
          watchedHref = location.href;
          // An answer was about the page before.
          dropResult();
          updateContext();
          render();
        }, 700);
      }
    } else {
      dropResult();
      // Arranging ends with the panel; the next one opens as usual.
      if (drag) dragEnd(null, true);
      arranging = false;
      if (watchTimer) {
        clearInterval(watchTimer);
        watchTimer = null;
      }
    }
    root.classList.toggle('db-open', open);
  }

  function togglePanel() {
    ensureShell();
    if (root) setPanel(!root.classList.contains('db-open'));
  }

  // The shell is built lazily, on the first open. Whatever registered before
  // that never got drawn, so paint the tiles as soon as it exists.
  function ensureShell() {
    if (refs || retired) return;
    refs = buildShell();
    watchTileWidth();
    markThanks();
    markInfo();
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
    // Not from under a tile being dragged: once it is let go.
    if (drag) {
      drag.later = true;
      return;
    }
    renderSections();

    // In the order the user arranged them (see "arranging").
    const rank = new Map(tileOrder().map((id, i) => [id, i]));
    const byRank = (a, b) => rank.get(a.id) - rank.get(b.id);
    const here = features.filter(usable).sort(byRank);
    const elsewhere = features.filter((f) => !usable(f)).sort(byRank);
    const listed = showAll ? here.concat(elsewhere) : here;

    const groups = new Map();
    for (const f of listed) {
      const name = groupOf(f);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(f);
    }
    // Groups with something for this page come first; the rest go under
    // one quiet rule. Each part in the user's order.
    const groupRank = new Map(groupOrder().map((g, i) => [g, i]));
    const shown = Array.from(groups, ([name, items]) => ({ name, items, away: !items.some(usable) }));
    shown.sort((a, b) => a.away - b.away || groupRank.get(a.name) - groupRank.get(b.name));

    refs.panel.classList.toggle('db-arranging', arranging);
    refs.body.textContent = '';
    if (arranging) refs.body.appendChild(el('div', 'db-arrange-note', 'Drag tiles within a section, and sections by name. ' + SITES[site] + ' keeps its own order.'));
    let awayHead = false;
    shown.forEach((g) => {
      if (g.away && !awayHead) {
        refs.body.appendChild(el('div', 'db-away-head', 'On other pages'));
        awayHead = true;
      }
      // A section: its name and its tiles, which move together.
      const box = el('div', 'db-group');
      box.dataset.dbGroup = g.name;
      box.dataset.away = String(g.away);
      const head = el('div', 'db-group-name' + (g.away ? ' db-group-away' : ''));
      if (arranging) arrangeHead(head, box, g.name);
      else head.textContent = g.name;
      const grid = el('div', 'db-grid');
      for (const f of g.items) grid.appendChild(buildTile(f, g.name));
      box.append(head, grid);
      refs.body.appendChild(box);
    });

    // Something to arrange: two tiles at least.
    refs.arrange.style.display = listed.length > 1 ? '' : 'none';
    refs.reset.disabled = !arranged();

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
    equalTiles();
  }

  /* Every tile in the panel as tall as the tallest, never one row alone. A
   * name that would take three lines first gets a slightly smaller type, so
   * one long name does not make them all taller. Again when the panel's
   * width changes (it opens, the window is resized). */
  let tilesWidth = 0;
  function equalTiles() {
    if (!refs) return;
    refs.body.style.removeProperty('--db-tile-h');
    refs.body.querySelectorAll('.db-tile-name').forEach((n) => {
      n.style.removeProperty('font-size');
      for (const size of [11.5, 11]) {
        const line = parseFloat(getComputedStyle(n).fontSize) * 1.25;
        if (!line || n.offsetHeight <= line * 2 + 1) break;
        n.style.fontSize = size + 'px';
      }
    });
    let h = 0;
    refs.body.querySelectorAll('.db-tile').forEach((t) => (h = Math.max(h, t.offsetHeight)));
    if (h) refs.body.style.setProperty('--db-tile-h', h + 'px');
    tilesWidth = refs.body.clientWidth;
  }
  function watchTileWidth() {
    if (typeof ResizeObserver !== 'function') return;
    new ResizeObserver(() => {
      if (refs && refs.body.clientWidth !== tilesWidth) requestAnimationFrame(equalTiles);
    }).observe(refs.body);
  }

  function buildTile(feature, group) {
    const here = usable(feature);
    const tile = el('button', 'db-tile db-tile-' + feature.type + (here ? '' : ' db-tile-away'));
    tile.type = 'button';
    tile.dataset.dbId = feature.id;
    if (busy.has(feature.id)) tile.classList.add('db-tile-busy');
    tile.title = here
      ? feature.hint || feature.name
      : (feature.hint || feature.name) + ' – not on this page';
    // While arranging, a tile from another page moves too.
    if (!here && !arranging) tile.disabled = true;

    const icon = el('span');
    icon.innerHTML = feature.icon || '';
    if (icon.firstElementChild) tile.appendChild(icon.firstElementChild);

    tile.appendChild(el('span', 'db-tile-name', feature.name));

    if (feature.type === 'toggle') tile.setAttribute('aria-pressed', String(here && isOn(feature.id)));
    if (arranging) {
      // Moved, never run: dragged, or with the arrow keys.
      tile.insertBefore(el('span', 'db-grip'), tile.firstChild);
      tile.title = 'Drag within ' + group + ' · arrow keys';
      tile.setAttribute('aria-label', feature.name + ' - arrow keys move it within ' + group);
      tile.addEventListener('pointerdown', (e) => grab(e, tile));
      tile.addEventListener('keydown', (e) => {
        const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[e.key];
        if (!by) return;
        e.preventDefault();
        nudge(tile, by);
      });
    } else if (feature.type === 'toggle') {
      tile.addEventListener('click', () => toggle(feature.id));
    } else {
      tile.addEventListener('click', () => run(feature));
    }
    return tile;
  }

  // ---------- arranging ----------

  /* The pencil in the footer arranges the panel: tiles move within their
   * section, sections by their name - never a tile into another section.
   * My solutions and the other sections a feature draws stay on top. A drag
   * moves what it holds over the others, a section with its tiles; the arrow
   * keys do it in steps.
   *
   * Each site keeps its own order - Dynamics 365, Power Apps, Power Automate,
   * Azure DevOps each show other sections, so one order for all of them
   * moved things the user never touched. A site's order is two lists
   * (dynaboost.layout): every section's name and every tile's id. One not in
   * them yet (new after an update) comes after the one it follows by default.
   * A move does what it shows, on every page of the site - whichever
   * sections that page lists: to the top is the top, to the bottom the
   * bottom, anywhere else right under the one now above it. The filters
   * stay as they are: this page's tiles, and Show all for the rest. */
  let drag = null; // { node, id, x, y, on, ghost, ... } - see grab()

  const SITES = { dynamics: 'Dynamics 365', powerapps: 'Power Apps', powerautomate: 'Power Automate', devops: 'Azure DevOps' };
  function siteOf() {
    const host = location.hostname.toLowerCase();
    if (host.endsWith('.dynamics.com')) return 'dynamics';
    if (host === 'make.powerapps.com') return 'powerapps';
    if (host === 'make.powerautomate.com') return 'powerautomate';
    return 'devops';
  }
  const site = siteOf();
  const noLayout = () => ({ groups: [], tiles: [] });

  // Every site's order. The one order of 2.39.48 and before is where every
  // site starts from.
  function readLayouts(v) {
    const list = (x) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string') : []);
    const one = (x) => ({ groups: list(x && x.groups), tiles: list(x && x.tiles) });
    const out = {};
    for (const k of Object.keys(SITES)) {
      if (v && v.sites && v.sites[k]) out[k] = one(v.sites[k]);
      else if (v && !v.sites && (v.groups || v.tiles)) out[k] = one(v);
    }
    return out;
  }

  function storeLayouts() {
    if (Object.keys(layouts).length) store({ [LAYOUT_KEY]: { v: 2, sites: layouts } });
    else ext(() => chrome.storage.local.remove(LAYOUT_KEY));
  }

  // The saved order; what it does not know goes in after its default neighbour.
  function ordered(defaults, saved) {
    const out = saved.filter((x, i) => defaults.includes(x) && saved.indexOf(x) === i);
    defaults.forEach((x, i) => {
      if (out.includes(x)) return;
      let at = 0;
      for (let j = i - 1; j >= 0 && !at; j--) at = out.indexOf(defaults[j]) + 1;
      out.splice(at, 0, x);
    });
    return out;
  }

  const groupOf = (f) => f.group || 'Tools';
  const defaultGroups = () => Array.from(new Set(features.map(groupOf)));
  const groupOrder = () => ordered(defaultGroups(), layout.groups);
  const tileOrder = () => ordered(features.map((f) => f.id), layout.tiles);
  const arranged = () => groupOrder().join('\n') !== defaultGroups().join('\n') || tileOrder().join('\n') !== features.map((f) => f.id).join('\n');

  /* Where a moved one goes in the site's whole list: first when the panel
   * now shows it first, last when last, else right after the one shown
   * above it. */
  function placed(whole, shown, key) {
    const out = whole.filter((x) => x !== key);
    const i = shown.indexOf(key);
    const at = i <= 0 ? 0 : i === shown.length - 1 ? out.length : out.indexOf(shown[i - 1]) + 1;
    out.splice(at, 0, key);
    return out;
  }

  function setArranging(on) {
    if (!refs || on === arranging) return;
    if (drag) dragEnd(null, true);
    arranging = on;
    if (on) {
      dropResult(true);
      // Its button makes way for Reset order and Done.
      if (refs.panel.classList.contains('db-thanks-open')) refs.thanksBtn.click();
    }
    render();
    const next = on ? refs.foot.querySelector('.db-arrange-done') : refs.arrange;
    if (next && next.offsetParent) next.focus({ preventScroll: true });
  }

  function resetLayout() {
    moveShown('group', () => {
      layout = noLayout();
      delete layouts[site];
      storeLayouts();
    });
  }

  // A section's name while arranging: the grip and the name - it is what
  // picks the section up.
  function arrangeHead(head, box, name) {
    head.tabIndex = 0;
    head.title = 'Drag to move the section · arrow keys';
    head.setAttribute('aria-label', name + ' section - arrow keys move it');
    head.append(el('span', 'db-grip'), el('span', 'db-group-text', name));
    head.addEventListener('pointerdown', (e) => grab(e, box));
    head.addEventListener('keydown', (e) => {
      const by = { ArrowUp: -1, ArrowDown: 1 }[e.key];
      if (!by) return;
      e.preventDefault();
      nudge(box, by);
    });
  }

  const isGroup = (node) => node.classList.contains('db-group');
  const keyOf = (node) => (isGroup(node) ? node.dataset.dbGroup : node.dataset.dbId);

  // What a node moves among: the sections of its part (this page or other
  // pages), or the tiles of its section in its part.
  function siblingsOf(node) {
    if (isGroup(node)) return Array.from(refs.body.querySelectorAll(':scope > .db-group')).filter((g) => g.dataset.away === node.dataset.away);
    const away = node.classList.contains('db-tile-away');
    return Array.from(node.parentElement.children).filter((t) => t.classList.contains('db-tile-away') === away);
  }

  // The order the node's siblings now show, kept.
  function keepOrder(node) {
    const shown = siblingsOf(node).map(keyOf);
    if (isGroup(node)) layout = { groups: placed(groupOrder(), shown, keyOf(node)), tiles: layout.tiles };
    else layout = { groups: layout.groups, tiles: placed(tileOrder(), shown, keyOf(node)) };
    layouts[site] = layout;
    storeLayouts();
  }

  /* A change of order drawn anew, with what moved gliding from where it was
   * to where it is - sections, or tiles. */
  function moveShown(kind, change) {
    const sel = kind === 'group' ? ':scope > .db-group' : '.db-tile';
    const key = (n) => (kind === 'group' ? n.dataset.dbGroup : n.dataset.dbId);
    const was = new Map();
    refs.body.querySelectorAll(sel).forEach((n) => was.set(key(n), n.getBoundingClientRect()));
    change();
    render();
    if (still()) return;
    refs.body.querySelectorAll(sel).forEach((n) => {
      const a = was.get(key(n));
      if (!a) return;
      const b = n.getBoundingClientRect();
      glide(n, a.left - b.left, a.top - b.top);
    });
  }

  function glide(node, dx, dy) {
    if (!dx && !dy) return;
    node.getAnimations().forEach((a) => a.cancel());
    node.animate([{ transform: 'translate(' + dx + 'px, ' + dy + 'px)' }, { transform: 'none' }], { duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
  }

  // The arrow keys: a step, the focus staying with it.
  function nudge(node, by) {
    const items = siblingsOf(node);
    const i = items.indexOf(node);
    const j = Math.max(0, Math.min(items.length - 1, i + by));
    if (i === j) return;
    const group = isGroup(node);
    const key = keyOf(node);
    moveShown(group ? 'group' : 'tile', () => {
      if (j > i) items[j].after(node);
      else items[j].before(node);
      keepOrder(node);
    });
    const box = refs.body.querySelector((group ? '.db-group[data-db-group="' : '.db-tile[data-db-id="') + CSS.escape(key) + '"]');
    if (!box) return;
    (group ? box.querySelector('.db-group-name') : box).focus({ preventScroll: true });
    reveal(box);
  }

  /* A drag starts on a press that moves a few pixels - a press alone does
   * nothing. The panel holds the pointer (pointer capture), so the drag goes
   * on over the page and its frames. */
  function grab(e, node) {
    // One pressed but never let go where the panel heard it.
    if (drag && !drag.on) drag = null;
    if (!arranging || drag || e.button !== 0) return;
    e.preventDefault();
    drag = { node: node, id: e.pointerId, x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY, on: false, order: siblingsOf(node).map(keyOf) };
    try {
      refs.panel.setPointerCapture(e.pointerId);
    } catch (err) {
      /* moves over the panel still reach it */
    }
  }

  function dragMove(e) {
    if (!drag || drag.landing || e.pointerId !== drag.id) return;
    drag.px = e.clientX;
    drag.py = e.clientY;
    if (!drag.on) {
      if (Math.hypot(drag.px - drag.x, drag.py - drag.y) < 5) return;
      lift();
    }
    follow();
    sortUnder();
    autoScroll();
  }

  // What is held - a tile, or a section with its tiles - leaves a dashed
  // place behind and follows the pointer.
  function lift() {
    const node = drag.node;
    const r = node.getBoundingClientRect();
    drag.on = true;
    drag.dx = drag.x - r.left;
    drag.dy = drag.y - r.top;
    const ghost = node.cloneNode(true);
    ghost.querySelectorAll('[tabindex]').forEach((n) => n.removeAttribute('tabindex'));
    ghost.classList.add('db-ghost');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.width = r.width + 'px';
    if (!isGroup(node)) ghost.style.height = r.height + 'px';
    root.appendChild(ghost);
    drag.ghost = ghost;
    node.classList.add('db-drag-src');
    refs.panel.classList.add('db-dragging');
  }

  // Tilted a little, as if lifted. A section only goes up and down - and
  // tilts less, being big.
  function follow() {
    const group = isGroup(drag.node);
    const x = (group ? drag.x : drag.px) - drag.dx;
    drag.ghost.style.transform = 'translate(' + x + 'px, ' + (drag.py - drag.dy) + 'px) rotate(' + (group ? 0.4 : 2) + 'deg)';
  }

  /* Over another tile the held one takes its place, and those between
   * shift by one; past the last tile, it goes last. A section passes the
   * next one once its bottom edge (going down) or its top edge (going up)
   * crosses that one's middle - sections differ in height, and so it never
   * swaps straight back. One still gliding is not a target. */
  function sortUnder() {
    const node = drag.node;
    const items = siblingsOf(node);
    const x = drag.px;
    const y = drag.py;
    const free = (n) => n !== node && !n.getAnimations().length;
    const mid = (n) => {
      const r = n.getBoundingClientRect();
      return r.top + r.height / 2;
    };
    let to = null;
    let after = false;
    if (isGroup(node)) {
      const i = items.indexOf(node);
      const top = y - drag.dy;
      const bottom = top + node.getBoundingClientRect().height;
      for (let k = i + 1; k < items.length && free(items[k]) && bottom > mid(items[k]); k++) {
        to = items[k];
        after = true;
      }
      for (let k = i - 1; !to && k >= 0 && free(items[k]) && top < mid(items[k]); k--) to = items[k];
    } else {
      to = items.find((n) => {
        const r = n.getBoundingClientRect();
        return free(n) && y >= r.top && y < r.bottom && x >= r.left && x < r.right;
      });
      after = to && items.indexOf(to) > items.indexOf(node);
      const last = items[items.length - 1];
      const lr = last.getBoundingClientRect();
      const area = node.parentElement.getBoundingClientRect();
      const inside = x >= area.left && x < area.right && y >= area.top - 12 && y < area.bottom + 12;
      if (!to && inside && free(last) && (y >= lr.bottom || (y >= lr.top && x >= lr.right))) {
        to = last;
        after = true;
      }
    }
    if (!to) return;
    const was = items.map((n) => n.getBoundingClientRect());
    if (after) to.after(node);
    else to.before(node);
    if (still()) return;
    items.forEach((n, i) => {
      if (n === node) return;
      const b = n.getBoundingClientRect();
      glide(n, was[i].left - b.left, was[i].top - b.top);
    });
  }

  // Near the top or bottom edge of the list, it scrolls - faster closer in.
  function autoScroll() {
    if (drag.scrolling) return;
    const step = () => {
      if (!drag || !drag.on || drag.landing) return;
      const r = refs.mid.getBoundingClientRect();
      const edge = 40;
      const by = drag.py < r.top + edge ? -(r.top + edge - drag.py) : drag.py > r.bottom - edge ? drag.py - (r.bottom - edge) : 0;
      if (!by) {
        drag.scrolling = false;
        return;
      }
      const top = refs.mid.scrollTop;
      refs.mid.scrollTop += Math.sign(by) * Math.min(16, 2 + Math.abs(by) / 3);
      if (refs.mid.scrollTop !== top) sortUnder();
      requestAnimationFrame(step);
    };
    drag.scrolling = true;
    requestAnimationFrame(step);
  }

  /* Let go: the copy settles into the dashed place, and the new order is
   * kept. Cancelled (Esc, the panel closing): everything goes back. */
  function dragEnd(e, cancel) {
    if (!drag || drag.landing || (e && e.pointerId !== drag.id)) return;
    const d = drag;
    try {
      if (refs.panel.hasPointerCapture(d.id)) refs.panel.releasePointerCapture(d.id);
    } catch (err) {
      /* already released */
    }
    if (!d.on) {
      drag = null;
      if (d.later) render();
      return;
    }
    const changed = !cancel && siblingsOf(d.node).map(keyOf).join('\n') !== d.order.join('\n');
    const land = () => {
      drag = null;
      d.ghost.remove();
      d.node.classList.remove('db-drag-src');
      refs.panel.classList.remove('db-dragging');
      if (changed) keepOrder(d.node);
      render();
    };
    const to = d.node.getBoundingClientRect();
    if (cancel || still() || !d.ghost.animate) return land();
    d.landing = true;
    const from = d.ghost.style.transform;
    d.ghost
      .animate([{ transform: from }, { transform: 'translate(' + to.left + 'px, ' + to.top + 'px) rotate(0deg)' }], { duration: 150, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' })
      .finished.then(land, land);
  }

  // ---------- an action's answer in the panel ----------

  /* An action with panelResult keeps the panel open. onRun(ui) gets
   * ui.busy(on) - its tile pulses while it works - and ui.card(options): a
   * card that folds down under the list, the way Say thanks does, pushing
   * the footer down; with Say thanks open as well, both stay, one above the
   * other. ui.close() closes the panel.
   * options: { tone: 'ok' | 'info' | 'busy' | 'error', title, sub,
   * actions: [{ label, onClick(card, button) }] }. The card has set(options),
   * dismissIn(ms) - it goes ms later, waiting while the pointer moves on it -
   * done(button, label, ms) - the button says it is done, the card goes ms
   * later - and close(); its ✕ closes it too. It goes with the panel, and
   * when the address changes. */
  let result = null; // { id, el }
  const busy = new Set(); // tiles at work

  const still = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  // A card that has just folded down is brought into view if the panel
  // scrolls - its top first, when it is taller than what shows.
  function reveal(node) {
    setTimeout(() => {
      if (!refs || !node.isConnected) return;
      const area = refs.mid.getBoundingClientRect();
      const r = node.getBoundingClientRect();
      const by = Math.min(r.bottom - area.bottom, r.top - area.top);
      if (by > 0) refs.mid.scrollBy({ top: by, behavior: still() ? 'auto' : 'smooth' });
    }, 300);
  }

  function setBusy(id, on) {
    if (on) busy.add(id);
    else busy.delete(id);
    const tile = refs && refs.body.querySelector('.db-tile[data-db-id="' + id + '"]');
    if (tile) tile.classList.toggle('db-tile-busy', on);
  }

  // animate: fold it up; otherwise (the panel closes) it just goes.
  function dropResult(animate) {
    if (!result) return;
    const box = result.el;
    result = null;
    if (!animate || still() || !box.isConnected) return void box.remove();
    box.classList.remove('db-fold-open');
    setTimeout(() => box.remove(), 260);
  }

  function panelUi(feature) {
    return {
      busy(on) {
        setBusy(feature.id, !!on);
      },
      card(options) {
        dropResult();
        const inner = el('div', 'db-sheet-in');
        const head = el('div', 'db-sheet-head');
        const mark = el('span', 'db-sheet-mark');
        const title = el('div', 'db-sheet-title');
        const x = el('button', 'db-sheet-close', '✕');
        x.type = 'button';
        x.setAttribute('aria-label', 'Close');
        head.append(mark, title, x);
        const sub = el('div', 'db-sheet-sub');
        const actions = el('div', 'db-sheet-actions');
        inner.append(head, sub, actions);
        const box = fold(el('div', 'db-sheet'), inner);
        box.setAttribute('role', 'status');
        const mine = { id: feature.id, el: box };

        let timer = null;
        let due = 0;
        let paused = 0;
        let closing = false;
        const goIn = (ms) => {
          clearTimeout(timer);
          due = Date.now() + ms;
          timer = setTimeout(() => {
            if (result === mine) dropResult(true);
          }, ms);
        };
        // The pointer moved onto it - not the card unfolding under a pointer
        // that stayed where it was.
        box.addEventListener('mousemove', (e) => {
          if (!timer || closing || !(e.movementX || e.movementY)) return;
          clearTimeout(timer);
          timer = null;
          // Once the pointer leaves, it goes soon after.
          paused = Math.min(Math.max(due - Date.now(), 1500), 2500);
        });
        box.addEventListener('mouseleave', () => {
          if (paused && !closing) goIn(paused);
          paused = 0;
        });

        const api = {
          set(opts) {
            // While it is open, a new height eases in rather than jumps.
            const shown = result === mine && box.classList.contains('db-fold-open');
            const from = shown ? box.getBoundingClientRect().height : 0;
            if (opts.title != null) title.textContent = opts.title;
            if (opts.sub != null) sub.textContent = opts.sub;
            if (opts.hold && !closing) {
              clearTimeout(timer);
              timer = null;
              paused = 0;
            }
            if (opts.tone) {
              box.classList.toggle('db-sheet-error', opts.tone === 'error');
              mark.textContent = opts.tone === 'error' ? '!' : opts.tone === 'busy' ? '…' : opts.tone === 'info' ? 'i' : '✓';
            }
            if (opts.actions) {
              actions.textContent = '';
              opts.actions.forEach((a) => {
                const b = el('button', null, a.label);
                b.type = 'button';
                b.addEventListener('click', () => a.onClick(api, b));
                actions.appendChild(b);
              });
            }
            if (shown && !still() && box.animate) {
              const to = box.getBoundingClientRect().height;
              if (Math.abs(to - from) > 0.5) box.animate([{ height: from + 'px' }, { height: to + 'px' }], { duration: 200, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
            }
            return api;
          },
          done(button, label, ms) {
            actions.querySelectorAll('button').forEach((b) => (b.disabled = true));
            button.textContent = '✓ ' + label;
            button.classList.add('db-sheet-done');
            closing = true;
            paused = 0;
            goIn(ms);
            return api;
          },
          dismissIn(ms) {
            if (!closing) goIn(ms);
            return api;
          },
          close() {
            clearTimeout(timer);
            if (result === mine) dropResult(true);
          }
        };
        x.addEventListener('click', () => api.close());
        api.set(options);
        if (!refs) return api;
        result = mine;
        // Under the list, above Say thanks: that one stays by its button.
        refs.body.after(box);
        void box.offsetHeight;
        box.classList.add('db-fold-open');
        reveal(box);
        return api;
      },
      close() {
        setPanel(false);
      }
    };
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

  // Where every message goes, in the panel's light or dark.
  function toastLayer() {
    let layer = document.getElementById('dynaboost-toast');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'dynaboost-toast';
      document.body.appendChild(layer);
    }
    layer.classList.toggle('db-dark', isDark());
    return layer;
  }

  // action: { label, run } - a button on the toast (Undo), and a little
  // longer to reach it.
  function toast(title, sub, error, action) {
    const layer = toastLayer();
    fadeOut(shown);
    const card = document.createElement('div');
    card.className = 'db-toast' + (error ? ' db-toast-error' : '');
    card.innerHTML =
      '<div class="db-toast-row"><span class="db-toast-mark"></span><div class="db-toast-text"><div class="db-toast-title"></div><div class="db-toast-sub"></div></div></div>' +
      (action ? '<div class="db-toast-actions"><button type="button"></button></div>' : '');
    card.querySelector('.db-toast-mark').textContent = error ? '!' : '\u2713';
    card.querySelector('.db-toast-title').textContent = title;
    card.querySelector('.db-toast-sub').textContent = sub;
    if (action) {
      const b = card.querySelector('.db-toast-actions button');
      b.textContent = action.label;
      b.addEventListener('click', () => {
        clearTimeout(card.__timer);
        fadeOut(card);
        action.run();
      });
    }
    layer.appendChild(card);
    shown = card;
    card.__timer = setTimeout(() => fadeOut(card), action ? 7000 : 3000);
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
    send({ type: 'DB_FRAME_HERE', ids: ids }).catch(() => {});
  }

  /* A flow frame that does not report in gets DynaBoost from the background,
   * as soon as it appears - Edit flow needs the page helper in before the
   * flow's first API calls. A frame that reloads is served again. */
  const FLOW_FRAME = 'iframe[src*="make.powerautomate.com/"][src*="/widgets/"]';
  let frameProblem = '';
  let frameAsking = false;
  let frameServed = false; // the flow frame has DynaBoost - until it reloads

  function reachFlowFrame() {
    if (retired || frameAsking || frameServed || frameProblem || framed.size || !document.querySelector(FLOW_FRAME)) return;
    frameAsking = true;
    send({ type: 'DB_FRAME_INJECT' }).then(
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

  if (!inFrame && location.hostname === 'make.powerapps.com') timers.push(setInterval(reachFlowFrame, 400));

  function askFrame(id, op, payload) {
    return send({ type: 'DB_FRAME_ASK', id: id, op: op, payload: payload, frameId: framed.get(id) }).then((r) => {
      if (!r) throw new Error('The flow did not answer. Reload the page and try again.');
      if (r.error) throw new Error(r.error);
      return r.data;
    });
  }

  if (inFrame) {
    // The flow's own pages change without a reload: details, the designer, a run.
    let frameHref = location.href;
    timers.push(
      setInterval(() => {
        if (location.href === frameHref) return;
        frameHref = location.href;
        announce();
      }, 1000)
    );
    window.addEventListener('pagehide', () => {
      announced = null;
      if (!retired) send({ type: 'DB_FRAME_HERE', ids: [] }).catch(() => {});
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
      guarded(feature, () => feature.onRun());
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

  // An update, or What's new opened from another tab.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[NEWS_KEY]) return;
    newsDue = changes[NEWS_KEY].newValue || null;
    markInfo();
  });

  // The panel arranged in another tab.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[LAYOUT_KEY]) return;
    layouts = readLayouts(changes[LAYOUT_KEY].newValue);
    const next = layouts[site] || noLayout();
    // This tab's own change is drawn already - and keeps its focus.
    if (JSON.stringify(next) === JSON.stringify(layout)) return;
    layout = next;
    queueRender();
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

  const api = (window.DynaBoost = {
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
    toastLayer: toastLayer,
    togglePanel,
    // A use of a tool: adds the time it saves to Time saved (background.js);
    // what names one of its actions with a time of its own ('copy', 'save').
    saved: (id, what) => {
      send({ type: 'DB_SAVED', id: id, what: what || '' }).catch(() => {});
    },
    // Features check it before a chrome.* call made outside onRun / onEnable.
    alive: () => !retired && alive()
  });

  // Cut off: noticed within a second and a half, or at once when the new
  // copy starts on this page.
  timers.push(
    setInterval(() => {
      if (!alive()) retire();
    }, 1500)
  );
  document.addEventListener('dynaboost-start', () => {
    if (!alive()) retire();
  });

  /* The app you work in, per Dynamics environment: the appid in its address,
   * kept so links DynaBoost builds elsewhere (Export run's records) open the
   * record in that app. Only the id - looked at as the address changes. */
  const LAST_APP_KEY = 'dynaboost.lastApp'; // { host: appid }
  let lastApp = '';
  const noteApp = () => {
    if (inFrame || !/\.dynamics\.com$/i.test(location.hostname)) return;
    let app = '';
    try {
      app = (new URLSearchParams(location.search).get('appid') || '').replace(/[{}]/g, '').toLowerCase();
    } catch (e) {
      return;
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(app) || app === lastApp) return;
    lastApp = app;
    ext(() =>
      chrome.storage.local.get(LAST_APP_KEY, (d) => {
        const map = Object.assign({}, d && d[LAST_APP_KEY]);
        if (map[location.hostname] === app) return;
        map[location.hostname] = app;
        store({ [LAST_APP_KEY]: map });
      })
    );
  };
  if (!inFrame && /\.dynamics\.com$/i.test(location.hostname)) {
    noteApp();
    timers.push(setInterval(noteApp, 2000));
  }

  chrome.storage.local.get([STORAGE_KEY, SHOW_ALL_KEY, THEME_KEY, USE_KEY, SAVED_KEY, SAVED_SEEN_KEY, LAYOUT_KEY, NEWS_KEY], (data) => {
    Object.assign(state, (data && data[STORAGE_KEY]) || {});
    newsDue = (data && data[NEWS_KEY]) || null;
    markInfo();
    layouts = readLayouts(data && data[LAYOUT_KEY]);
    layout = layouts[site] || noLayout();
    saved = (data && data[SAVED_KEY]) || null;
    savedSeen = data ? data[SAVED_SEEN_KEY] : null;
    use = (data && data[USE_KEY]) || null;
    if (!use || typeof use.n !== 'number') {
      use = { since: Date.now(), n: 0, seen: false };
      if (!inFrame) store({ [USE_KEY]: use });
    }
    markThanks();
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
