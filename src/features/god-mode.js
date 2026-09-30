/* Feature: God mode. On a record form: every hidden field, section and tab
 * shown, every locked field unlocked, every required column optional, kept so
 * while the form's scripts and rules run. Off: the form as it was. This page
 * only, nothing saved; a save still goes through the server's rules, and
 * field-level security stays. Done by form-tools-hook.js through Xrm.
 */
(function () {
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="5" y="10.5" width="14" height="10" rx="2" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 6.8-1.2" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="m12 13.2.8 1.7 1.9.3-1.4 1.3.3 1.9-1.6-.9-1.6.9.3-1.9-1.4-1.3 1.9-.3z" fill="#E3B04B"/>' +
    '</svg>';

  // v2: helpers from before it (no stop()) do not hear this channel.
  const SRC = 'dynaboost-form-tools-v2';

  function injectHook() {
    if (window.__dbFormToolsInjected) return;
    window.__dbFormToolsInjected = true;
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('src/features/form-tools-hook.js');
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  }

  function ask(op, on) {
    return new Promise((resolve) => {
      const id = 'dbgod' + Date.now() + Math.random().toString(36).slice(2);
      let done = false;
      const onMsg = (e) => {
        if (e.source !== window || !e.data || e.data.source !== SRC + '-reply' || e.data.id !== id) return;
        done = true;
        window.removeEventListener('message', onMsg);
        resolve(e.data.result);
      };
      window.addEventListener('message', onMsg);
      injectHook();
      const send = () => !done && window.postMessage({ source: SRC, op: op, on: on, id: id }, location.origin);
      send();
      setTimeout(send, 300);
      setTimeout(send, 900);
      setTimeout(() => {
        if (done) return;
        window.removeEventListener('message', onMsg);
        resolve({ error: 'The page did not answer.' });
      }, 3000);
    });
  }

  const toast = (title, sub, error) => DynaBoost.toast(title, sub, error);

  // Why Dataverse keeps a column read-only, from its metadata.
  const SOURCE = { 1: 'calculated', 2: 'rollup', 3: 'formula' };

  async function reasons(entity, columns) {
    const out = {};
    if (!entity || !columns.length) return out;
    try {
      const res = await fetch(
        "/api/data/v9.2/EntityDefinitions(LogicalName='" + encodeURIComponent(entity) + "')/Attributes?$select=LogicalName,SourceType,IsValidForUpdate,IsSecured",
        { credentials: 'same-origin', headers: { Accept: 'application/json', 'OData-Version': '4.0' } }
      );
      if (!res.ok) return out;
      const want = new Set(columns);
      for (const a of (await res.json()).value || []) {
        if (!want.has(a.LogicalName)) continue;
        out[a.LogicalName] = SOURCE[a.SourceType] || (a.IsValidForUpdate === false ? 'system' : a.IsSecured ? 'field security' : '');
      }
    } catch (e) {
      /* no reasons, then - the names still go out */
    }
    return out;
  }

  // What stays locked once God mode has done its passes, and why.
  async function explain() {
    await new Promise((r) => setTimeout(r, 900));
    if (!active) return '';
    const r = (await ask('still-locked')) || {};
    if (r.formType === 3 || r.formType === 4) return 'The record is read-only (inactive, or no right to change it) - its fields stay locked.';
    const seen = new Set();
    const locked = (r.locked || []).filter((x) => !seen.has(x.column) && seen.add(x.column));
    if (!locked.length) return '';
    const why = await reasons(r.entity, locked.map((x) => x.column));
    const shown = locked.slice(0, 4).map((x) => x.label + (why[x.column] ? ' (' + why[x.column] + ')' : ''));
    return 'Locked by Dataverse, no script can open: ' + shown.join(', ') + (locked.length > 4 ? ' and ' + (locked.length - 4) + ' more' : '') + '.';
  }

  let active = false;
  let resetTile = null;

  // Another record ends it in the page; the tile goes off with it.
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== SRC + '-event') return;
    if (!active) return;
    // The × on the frame: the same as switching the tile off.
    if (e.data.type === 'god-off-request') {
      DynaBoost.toggle('god-mode');
      return;
    }
    if (e.data.type !== 'god-off') return;
    active = false;
    if (resetTile) resetTile();
  });

  async function enable() {
    active = true;
    const r = (await ask('god', true)) || {};
    if (r.error) {
      active = false;
      if (resetTile) resetTile();
      toast('God mode', r.error, true);
      return;
    }
    const parts = [];
    if (r.shown) parts.push(r.shown + ' shown');
    if (r.unlocked) parts.push(r.unlocked + ' unlocked');
    if (r.optional) parts.push(r.optional + ' made optional');
    const note = await explain();
    // Switched off again meanwhile: its own message has been said.
    if (!active) return;
    toast('God mode on', (parts.length ? parts.join(' · ') + ' - ' : '') + 'kept while you work; switch off to put the form back.' + (note ? ' ' + note : ''));
  }

  async function disable() {
    if (!active) return;
    active = false;
    await ask('god', false);
    toast('God mode off', 'The form is as it was.');
  }

  DynaBoost.register({
    id: 'god-mode',
    name: 'God mode',
    group: 'Records',
    hosts: ['dynamics.com'],
    when: () => new URLSearchParams(location.search).get('pagetype') === 'entityrecord',
    type: 'toggle',
    // For this page only: a reload or another record finds it off.
    session: true,
    hint: 'While on: every hidden field, section and tab shown, locked fields unlocked, required ones optional - kept as the form works; off puts the form back. This page only',
    icon: ICON,
    onEnable: enable,
    onDisable: disable,
    onReset: (off) => {
      resetTile = off;
    }
  });
})();
