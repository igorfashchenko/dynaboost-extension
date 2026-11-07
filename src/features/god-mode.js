/* Feature: God mode. On a record form: every hidden field, section and tab
 * shown, every locked field unlocked, every required column optional, kept so
 * while the form's scripts and rules run. Off: the form as it was. A switch
 * that is remembered: on, it stays on - a reload, another record, another tab
 * - until it is switched off in the panel or with the \u00d7 on its frame.
 * Nothing saved; a save still goes through the server's rules, and
 * field-level security stays. Done by form-tools-hook.js through Xrm, in the
 * page itself (not its frames).
 */
(function () {
  if (DynaBoost.off) return;
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
  let keep = 0; // re-adds the listener while on
  // Switched off with the × on the frame: says so, as a switch in the panel.
  let byFrame = false;
  const top = window.top === window;

  // A switch in the panel says what it did; one remembered - a reload, another
  // tab - goes on quietly, the gold frame shows it.
  const fromPanel = () => {
    const root = document.getElementById('dynaboost-root');
    return !!(root && root.classList.contains('db-open'));
  };

  // The × on the frame: the same as switching the tile off.
  function onEvent(e) {
    if (e.source !== window || !e.data || e.data.source !== SRC + '-event') return;
    if (!active || e.data.type !== 'god-off-request') return;
    byFrame = true;
    DynaBoost.toggle('god-mode');
  }
  window.addEventListener('message', onEvent);

  async function enable() {
    if (!top || active) return;
    active = true;
    // Dynamics writes its page anew as it starts (document.open), which takes the listener off: put on again while on.
    clearInterval(keep);
    window.addEventListener('message', onEvent);
    keep = setInterval(() => window.addEventListener('message', onEvent), 1500);
    const loud = fromPanel();
    const r = (await ask('god', true)) || {};
    if (!loud || !active) return;
    if (r.error) {
      toast('God mode', r.error, true);
      return;
    }
    if (r.waiting) {
      toast('God mode on', 'No record form here yet - the next one opens up as it comes.');
      return;
    }
    const parts = [];
    if (r.shown) parts.push(r.shown + ' shown');
    if (r.unlocked) parts.push(r.unlocked + ' unlocked');
    if (r.optional) parts.push(r.optional + ' made optional');
    const note = await explain();
    // Switched off again meanwhile: its own message has been said.
    if (!active) return;
    toast('God mode on', (parts.length ? parts.join(' · ') + ' - ' : '') + 'it stays on, also after a reload and on other records, until you switch it off.' + (note ? ' ' + note : ''));
  }

  async function disable() {
    if (!active) return;
    active = false;
    clearInterval(keep);
    keep = 0;
    const loud = byFrame || fromPanel();
    byFrame = false;
    await ask('god', false);
    if (loud) toast('God mode off', 'The form is as it was.');
  }

  DynaBoost.register({
    id: 'god-mode',
    name: 'God mode',
    group: 'Records',
    hosts: ['dynamics.com'],
    when: () => DynaBoost.page().type === 'entityrecord',
    type: 'toggle',
    hint: 'Shows hidden fields, unlocks locked ones - stays on until switched off',
    icon: ICON,
    onEnable: enable,
    onDisable: disable
  });
})();
