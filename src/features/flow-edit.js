/* Feature: Edit flow. Opens the flow's definition and connection references
 * as JSON in src/flow-editor.html, an extension page, so reloading this tab
 * leaves the editor working. This script puts the page helper
 * (flow-edit-hook.js) into the portal and relays the editor's requests to it.
 */
(function () {
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M8 4H6.5A1.5 1.5 0 0 0 5 5.5v4L3.5 12 5 14.5v4A1.5 1.5 0 0 0 6.5 20H8M16 4h1.5A1.5 1.5 0 0 1 19 5.5v4l1.5 2.5-1.5 2.5v4a1.5 1.5 0 0 1-1.5 1.5H16" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="m9.5 12.5 2 2 3.5-4.5" stroke="#E3B04B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  const ASK_TIMEOUT = 60000;

  // ---------- where are we ----------

  // .../environments/{env}/flows/{id}/details, .../solutions/{s}/flows/{id},
  // the designer, a run - the flow id comes after /flows/, perhaps after shared/.
  function flowFromUrl() {
    const m = location.pathname.match(/\/environments\/([^/?#]+)\/(?:.*\/)?flows\/(?:shared\/)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    return m ? { env: decodeURIComponent(m[1]), flow: m[2].toLowerCase() } : null;
  }

  // ---------- the page helper ----------

  function injectHook() {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('src/features/flow-edit-hook.js');
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  }

  const waiting = new Map();
  let seq = 0;

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== 'dynaboost-flow-edit-reply' || !waiting.has(d.id)) return;
    const w = waiting.get(d.id);
    waiting.delete(d.id);
    clearTimeout(w.timer);
    if (d.ok) w.resolve(d.data);
    else w.reject(Object.assign(new Error(d.error), { code: d.code, status: d.status }));
  });

  function ask(op, where, extra) {
    return new Promise((resolve, reject) => {
      const id = 'dbfe' + ++seq + '-' + Date.now();
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error('Power Automate did not answer within ' + ASK_TIMEOUT / 1000 + ' seconds.'));
      }, ASK_TIMEOUT);
      waiting.set(id, { resolve, reject, timer });
      window.postMessage(Object.assign({ source: 'dynaboost-flow-edit', id: id, op: op, env: where.env, flow: where.flow }, extra || {}), location.origin);
    });
  }

  // The editor (src/flow-editor.js) asks through here: a message to this
  // tab, passed on to the page helper, answered with the result.
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || msg.type !== 'DB_FLOW_ASK' || !/make\.powerautomate\.com$/i.test(location.hostname)) return;
    // In make.powerapps.com the flow is a frame of the page, and every frame
    // of the tab hears this: the one showing that flow answers.
    if (window.top !== window) {
      const here = flowFromUrl();
      if (!here || here.flow !== String(msg.flow || '').toLowerCase()) return;
    }
    const extra = {};
    if (msg.body !== undefined) extra.body = msg.body;
    if (msg.via !== undefined) extra.via = msg.via;
    ask(msg.op, { env: msg.env, flow: msg.flow }, extra).then(
      (data) => reply({ ok: true, data: data }),
      (err) => reply({ ok: false, error: err.message, code: err.code, status: err.status })
    );
    return true;
  });

  // ---------- run ----------

  // The editor is a page of the extension, opened by the background next to
  // this tab - it outlives a reload of this one.
  function run() {
    const where = flowFromUrl();
    if (!where) {
      window.alert('Open a cloud flow first - its details page, the designer or a run. This tile edits the flow you are looking at.');
      return;
    }
    chrome.runtime.sendMessage({ type: 'DB_OPEN_FLOW_EDITOR', env: where.env, flow: where.flow, dark: DynaBoost.isDark ? DynaBoost.isDark() : false });
  }

  // The manifest runs the helper before the portal's own scripts; a tab open
  // before an install or reload gets it from here. It runs once either way.
  if (/make\.powerautomate\.com$/i.test(location.hostname)) injectHook();

  DynaBoost.register({
    id: 'flow-edit',
    name: 'Edit flow',
    group: 'Power Automate flows',
    hosts: ['make.powerautomate.com'],
    when: () => !!flowFromUrl(),
    inFrames: true,
    type: 'action',
    hint: 'The flow’s definition as JSON: edit it, check it with Power Automate’s own validation and save it back',
    icon: ICON,
    onRun: run
  });
})();
