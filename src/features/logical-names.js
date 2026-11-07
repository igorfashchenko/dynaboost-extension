/* Feature: Logical names.
 *
 * A toggle for the model-driven apps. While on, every field on a record form
 * carries its column's logical name under its label - a small badge, in the
 * panel's light or dark - and a click on it copies the name. It stays with
 * the form as it redraws: other tabs, the header, the next record. The page
 * helper (form-tools-hook.js) does the drawing, since the controls and their
 * columns are known only to the page's Xrm.
 */
(function () {
  if (DynaBoost.off) return;
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M4 6h10M4 10h6" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
    '<rect x="4" y="13.5" width="16" height="6" rx="2" stroke="#E3B04B" stroke-width="1.6"/>' +
    '<path d="M7.5 16.5h9" stroke="#E3B04B" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="1.6 1.6"/>' +
    '</svg>';

  // v2: helpers from before it (no stop()) do not hear this channel.
  const SRC = 'dynaboost-form-tools-v2';
  const onOrg = () => /\.dynamics\.com$/i.test(location.hostname);

  function injectHook() {
    if (window.__dbFormToolsInjected) return;
    window.__dbFormToolsInjected = true;
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('src/features/form-tools-hook.js');
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  }

  const say = () => window.postMessage({ source: SRC, op: 'names', on: wanted, dark: DynaBoost.isDark ? DynaBoost.isDark() : false }, location.origin);

  // The helper loads a moment after it is put in: say it twice.
  function tell(on) {
    wanted = on;
    if (!onOrg()) return;
    injectHook();
    say();
    setTimeout(say, 400);
    clearInterval(guard);
    guard = on ? setInterval(check, 1500) : 0;
  }

  let wanted = false;
  let guard = 0;
  let checking = false;

  // Does the helper answer? Any request with an id gets a reply.
  function ping() {
    return new Promise((resolve) => {
      const id = 'dbln' + Date.now() + Math.random().toString(36).slice(2);
      const got = (e) => {
        if (e.source !== window || !e.data || e.data.source !== SRC + '-reply' || e.data.id !== id) return;
        window.removeEventListener('message', got);
        resolve(true);
      };
      window.addEventListener('message', got);
      window.postMessage({ source: SRC, op: 'ping', id: id }, location.origin);
      setTimeout(() => {
        window.removeEventListener('message', got);
        resolve(false);
      }, 700);
    });
  }

  /* While on: a form whose fields carry no badge is told again - after a
   * reload Dynamics writes its page anew (document.open) and takes the
   * listeners off, so what was said at the start may not have been heard.
   * One that does not answer at all is put in again. */
  async function check() {
    window.addEventListener('message', onEvent);
    if (!wanted || checking || document.querySelector('.db-ln') || !document.querySelector('label[id$="-field-label"]')) return;
    checking = true;
    try {
      if (!(await ping())) window.__dbFormToolsInjected = false;
      if (!wanted) return;
      injectHook();
      say();
      setTimeout(say, 400);
    } finally {
      checking = false;
    }
  }

  // A fresh helper (one taking over from an older one) knows nothing yet.
  // A name copied from a badge is a use, for Time saved.
  function onEvent(e) {
    if (e.source !== window || !e.data || e.data.source !== SRC + '-event') return;
    if (e.data.type === 'name-copied' && wanted) DynaBoost.saved('logical-names');
    if (e.data.type !== 'ready') return;
    if (wanted) say();
  }
  window.addEventListener('message', onEvent);

  DynaBoost.register({
    id: 'logical-names',
    name: 'Logical names',
    group: 'Records',
    hosts: ['dynamics.com'],
    when: () => DynaBoost.page().type === 'entityrecord',
    type: 'toggle',
    defaultOn: false,
    hint: 'Logical names under the field labels',
    icon: ICON,
    onEnable: () => tell(true),
    onDisable: () => tell(false)
  });
})();
