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

  // The helper loads a moment after it is put in: say it twice.
  function tell(on) {
    wanted = on;
    if (!onOrg()) return;
    injectHook();
    const msg = () => window.postMessage({ source: SRC, op: 'names', on: on, dark: DynaBoost.isDark ? DynaBoost.isDark() : false }, location.origin);
    msg();
    setTimeout(msg, 400);
  }

  let wanted = false;

  // A fresh helper (one taking over from an older one) knows nothing yet.
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== SRC + '-event' || e.data.type !== 'ready') return;
    if (wanted) window.postMessage({ source: SRC, op: 'names', on: true, dark: DynaBoost.isDark ? DynaBoost.isDark() : false }, location.origin);
  });

  DynaBoost.register({
    id: 'logical-names',
    name: 'Logical names',
    group: 'Records',
    hosts: ['dynamics.com'],
    when: () => new URLSearchParams(location.search).get('pagetype') === 'entityrecord',
    type: 'toggle',
    defaultOn: false,
    hint: 'Logical names under the field labels',
    icon: ICON,
    onEnable: () => tell(true),
    onDisable: () => tell(false)
  });
})();
