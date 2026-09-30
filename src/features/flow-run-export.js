/* Feature: Export run. Opens the run you are looking at in a read-only tab:
 * the trigger and every action with inputs, outputs, status, timing and
 * errors.
 *
 * The data is the portal's own .../runs/{runName}?api-version=1 response,
 * passed on by flow-run-hook.js - no API call of our own, no token. Large
 * payloads come as inputsLink / outputsLink (SAS URLs that expire) and are
 * fetched on the click. Iterations of Apply to each are not expanded (one
 * request per item); loops are listed with a note.
 */
(function () {
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M6 3h8l4 4v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" stroke="#3D8BFF" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M8 9h6M8 12.5h6M8 16h3" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="m16 19.5 2 2 4-4.5" stroke="#E3B04B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  // Newest capture per run name. Later polls are more complete than earlier
  // ones (a run still Running carries few actions), so we simply overwrite.
  const runs = new Map();
  let lastSeen = null;

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== 'dynaboost-flow-run' || !d.run || !d.run.name) return;
    runs.set(d.run.name, d.run);
    lastSeen = d.run.name;
  });

  function injectHook() {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('src/features/flow-run-hook.js');
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  }

  function runIdFromUrl() {
    const m = location.pathname.match(/\/runs\/([^/?#]+)/i);
    return m ? m[1] : null;
  }

  function pickRun() {
    const fromUrl = runIdFromUrl();
    if (fromUrl && runs.has(fromUrl)) return runs.get(fromUrl);
    if (fromUrl) return null;
    return lastSeen ? runs.get(lastSeen) : null;
  }

  // ---------- collecting ----------

  function duration(a) {
    if (!a.startTime || !a.endTime) return '';
    const ms = new Date(a.endTime) - new Date(a.startTime);
    if (!isFinite(ms)) return '';
    return ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(2) + ' s';
  }

  async function fetchLink(link) {
    if (!link || !link.uri) return undefined;
    // Guard against pulling something enormous into a tab.
    if (link.contentSize && link.contentSize > 2 * 1024 * 1024) {
      return '[not fetched - ' + link.contentSize + ' bytes]';
    }
    try {
      const res = await fetch(link.uri);
      if (!res.ok) return '[fetch failed - HTTP ' + res.status + ']';
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch (e) {
        return text;
      }
    } catch (e) {
      // Almost always an expired SAS signature.
      return '[fetch failed - link may have expired]';
    }
  }

  async function collect(run, onProgress) {
    const p = run.properties || {};
    const steps = [];

    const trigger = p.trigger || {};
    steps.push({
      name: trigger.name || 'Trigger',
      kind: 'Trigger',
      status: trigger.status,
      code: trigger.code,
      startTime: trigger.startTime,
      endTime: trigger.endTime,
      error: trigger.error,
      inputs: trigger.inputs,
      outputs: trigger.outputs,
      inputsLink: trigger.inputsLink,
      outputsLink: trigger.outputsLink
    });

    const actions = p.actions || {};
    for (const key of Object.keys(actions)) {
      const a = actions[key];
      steps.push({
        name: key,
        kind: 'Action',
        status: a.status,
        code: a.code,
        startTime: a.startTime,
        endTime: a.endTime,
        error: a.error,
        inputs: a.inputs,
        outputs: a.outputs,
        inputsLink: a.inputsLink,
        outputsLink: a.outputsLink
      });
    }

    steps.sort((x, y) => new Date(x.startTime || 0) - new Date(y.startTime || 0));

    // Only the payloads the portal did not inline need a request.
    const jobs = [];
    for (const s of steps) {
      if (s.inputs === undefined && s.inputsLink) jobs.push([s, 'inputs', s.inputsLink]);
      if (s.outputs === undefined && s.outputsLink) jobs.push([s, 'outputs', s.outputsLink]);
    }

    let done = 0;
    const LIMIT = 6;
    for (let i = 0; i < jobs.length; i += LIMIT) {
      const slice = jobs.slice(i, i + LIMIT);
      await Promise.all(
        slice.map(async ([step, field, link]) => {
          step[field] = await fetchLink(link);
          done++;
          if (onProgress) onProgress(done, jobs.length);
        })
      );
    }

    return steps;
  }

  // ---------- rendering ----------

  function esc(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  function fmt(v) {
    if (v === undefined) return '(none)';
    if (typeof v === 'string') return v;
    try {
      return JSON.stringify(v, null, 2);
    } catch (e) {
      return String(v);
    }
  }

  function buildHtml(run, steps) {
    const p = run.properties || {};
    const flowName =
      (p.flow && p.flow.properties && p.flow.properties.displayName) || 'Flow run';

    const rows = steps
      .map((s) => {
        const cls = 'st-' + String(s.status || '').toLowerCase();
        const err = s.error
          ? '<div class="err"><b>' + esc(s.error.code || 'Error') + '</b> ' +
            esc(s.error.message || '') + '</div>'
          : '';
        return (
          '<section>' +
          '<h2><span class="pill ' + cls + '">' + esc(s.status || '?') + '</span> ' +
          esc(s.name) + ' <span class="meta">' + esc(s.kind) +
          (duration(s) ? ' &middot; ' + duration(s) : '') +
          (s.code ? ' &middot; ' + esc(s.code) : '') + '</span></h2>' +
          err +
          '<h3>Inputs</h3><pre>' + DynaBoost.code.html(fmt(s.inputs), 'json') + '</pre>' +
          '<h3>Outputs</h3><pre>' + DynaBoost.code.html(fmt(s.outputs), 'json') + '</pre>' +
          '</section>'
        );
      })
      .join('');

    const head =
      '<header><h1>' + esc(flowName) + '</h1>' +
      '<div class="crumbs">Run ' + esc(run.name) + ' &middot; ' + esc(p.status || '') +
      (p.startTime ? ' &middot; ' + esc(p.startTime) : '') +
      ' &middot; ' + steps.length + ' steps</div>' +
      (p.error
        ? '<div class="err"><b>' + esc(p.error.code || 'Error') + '</b> ' +
          esc(p.error.message || '') + '</div>'
        : '') +
      '<div class="actions"><button id="copy" class="primary">Copy everything</button>' +
      '<button id="json">Download JSON</button></div></header>';

    const payload = JSON.stringify(
      {
        flow: flowName,
        run: run.name,
        status: p.status,
        startTime: p.startTime,
        endTime: p.endTime,
        error: p.error,
        steps: steps.map((s) => ({
          name: s.name,
          kind: s.kind,
          status: s.status,
          code: s.code,
          startTime: s.startTime,
          endTime: s.endTime,
          error: s.error,
          inputs: s.inputs,
          outputs: s.outputs
        }))
      },
      null,
      2
    );

    const html =
      '<!doctype html><meta charset="utf-8"><title>' + esc(flowName) + ' - run export</title>' +
      '<style>' +
      'body{margin:0;font:14px/1.5 "Segoe UI",system-ui,sans-serif;color:var(--dbc-fg-10224e);background:var(--dbc-bg-f5f7fc)}' +
      'header{padding:16px 22px 12px}' +
      'main{padding:20px 22px}' +
      'h1{margin:0 0 4px;font-size:20px}' +
      'h2{margin:0 0 6px;font-size:15px;font-weight:600}' +
      'h3{margin:12px 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--dbc-fg-56637f)}' +
      '.meta{font-size:12.5px;color:var(--dbc-fg-56637f);font-weight:400}' +
      'section{margin:0 0 14px;padding:14px 16px;background:var(--dbc-bg-fff);border:1px solid var(--dbc-bd-dde3f0);border-radius:8px}' +
      'pre{margin:0;padding:10px;background:var(--dbc-bg-f5f7fc);border:1px solid var(--dbc-bd-dde3f0);border-radius:6px;' +
      'font:12.5px ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto}' +
      '.pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600;background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f)}' +
      '.st-succeeded{background:var(--dbc-bg-e4f4e8);color:var(--dbc-fg-1c6b32)}.st-failed{background:var(--dbc-bg-fde8e8);color:var(--dbc-fg-a11a1a)}' +
      '.st-skipped{background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f)}.st-running{background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-1e6bff)}' +
      '.err{margin:6px 0;padding:8px 10px;background:var(--dbc-bg-fde8e8);border-radius:6px;font-size:13px;color:var(--dbc-fg-7a1414)}' +
      '.actions{margin-top:12px;display:flex;gap:8px}' +
      'button.primary{background:var(--dbc-bg-1e6bff);border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-fff);font-weight:600}' +
      'button.primary:hover{background:var(--dbc-bg-155ee0);color:var(--dbc-fg-fff)}' +
      'button{padding:7px 13px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;background:var(--dbc-bg-fff);font:inherit;cursor:pointer}' +
      'button:hover{border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-1e6bff)}' +
      'button svg{width:14px;height:14px;vertical-align:-2px;margin-right:6px}' +
      'button.db-ok{border-color:var(--dbc-bd-1c6b32);color:var(--dbc-fg-1c6b32);background:var(--dbc-bg-e4f4e8)}' +
      'button.db-bad{border-color:var(--dbc-bd-a11a1a);color:var(--dbc-fg-a11a1a);background:var(--dbc-bg-fde8e8)}' +
      DynaBoost.code.css +
      DynaBoost.tabCss +
      '</style>' +
      head +
      '<main>' + rows + '</main>';

    // The export tab inherits the portal's content security policy, which
    // blocks inline <script>. So the page ships without any script of its own
    // and the buttons get their handlers attached from here - see wire().
    return { html: html, payload: payload };
  }

  // ---------- wiring the export tab ----------

  const CHECK =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="m5 13 4 4L19 7" stroke="currentColor" stroke-width="2.4" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const CROSS =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" ' +
    'stroke-linecap="round"/></svg>';

  function flash(btn, text, ok) {
    if (btn.__dbTimer) clearTimeout(btn.__dbTimer);
    if (btn.__dbLabel == null) btn.__dbLabel = btn.textContent;
    btn.innerHTML = (ok ? CHECK : CROSS) + text;
    btn.classList.remove('db-ok', 'db-bad');
    btn.classList.add(ok ? 'db-ok' : 'db-bad');
    btn.__dbTimer = setTimeout(() => {
      btn.textContent = btn.__dbLabel;
      btn.classList.remove('db-ok', 'db-bad');
    }, 2200);
  }

  async function copyInto(tab, text) {
    // The export tab has focus, so its clipboard API is the one allowed to
    // write; ours would be rejected as "document not focused".
    try {
      await tab.navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const doc = tab.document;
        const ta = doc.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        doc.body.appendChild(ta);
        ta.select();
        const ok = doc.execCommand('copy');
        doc.body.removeChild(ta);
        return ok;
      } catch (e2) {
        return false;
      }
    }
  }

  function wire(tab, filename, payload) {
    const doc = tab.document;
    const copyBtn = doc.getElementById('copy');
    const jsonBtn = doc.getElementById('json');
    if (!copyBtn || !jsonBtn) return;

    copyBtn.addEventListener('click', async () => {
      const ok = await copyInto(tab, payload);
      flash(copyBtn, ok ? 'Copied' : 'Press Ctrl+A, Ctrl+C', ok);
    });

    jsonBtn.addEventListener('click', () => {
      try {
        const blob = new tab.Blob([payload], { type: 'application/json' });
        const url = tab.URL.createObjectURL(blob);
        const a = doc.createElement('a');
        a.href = url;
        a.download = filename;
        doc.body.appendChild(a);
        a.click();
        doc.body.removeChild(a);
        setTimeout(() => tab.URL.revokeObjectURL(url), 10000);
        flash(jsonBtn, 'Downloaded', true);
      } catch (e) {
        flash(jsonBtn, 'Download failed', false);
      }
    });
  }

  // ---------- run ----------

  const NO_RUN =
    'No run data captured yet.\n\n' +
    'Open a flow run and press F5 — DynaBoost reads the response the ' +
    'portal fetches, so it has to be loaded with the page.';
  const STILL_RUNNING = 'This run is still in progress, so most actions are missing.\n\n' + 'Export what there is anyway?';

  function openTab() {
    const tab = window.open('', '_blank');
    if (tab) {
      tab.document.write(
        '<!doctype html><meta charset="utf-8"><title>Exporting…</title>' +
          '<body style="font:14px/1.5 \'Segoe UI\',system-ui,sans-serif;padding:24px;color:var(--dbc-fg-10224e)">' +
          '<p id="s">Collecting run data…</p>'
      );
      DynaBoost.themeTab(tab);
    }
    return tab;
  }

  function show(tab, data, steps) {
    const built = buildHtml(data, steps);
    if (tab && !tab.closed) {
      tab.document.open();
      tab.document.write(built.html);
      tab.document.close();
      DynaBoost.themeTab(tab);
      wire(tab, String(data.name) + '.json', built.payload);
    } else {
      window.alert('The export tab was blocked. Allow pop-ups for this site and try again.');
    }
  }

  async function run() {
    const data = pickRun();
    if (!data) {
      window.alert(NO_RUN);
      return;
    }
    if ((data.properties || {}).status === 'Running' && !window.confirm(STILL_RUNNING)) return;

    const tab = openTab();
    const steps = await collect(data, (done, total) => {
      if (tab && !tab.closed) {
        const el = tab.document.getElementById('s');
        if (el) el.textContent = 'Fetching payloads… ' + done + ' / ' + total;
      }
    });
    show(tab, data, steps);
  }

  /* In make.powerapps.com the run is in a frame from make.powerautomate.com:
   * the frame has the run and fetches its payloads (frameAnswer), this page
   * opens the tab - a frame may not open one on a click made outside it. */
  async function frameRun(ask) {
    let found;
    try {
      found = await ask('status');
    } catch (e) {
      window.alert('Could not reach the flow.\n\n' + e.message);
      return;
    }
    if (!found || !found.name) {
      window.alert(NO_RUN);
      return;
    }
    if (found.status === 'Running' && !window.confirm(STILL_RUNNING)) return;

    const tab = openTab();
    let got;
    try {
      got = await ask('collect');
    } catch (e) {
      if (tab && !tab.closed) tab.close();
      window.alert('Could not read the run.\n\n' + e.message);
      return;
    }
    show(tab, got.data, got.steps);
  }

  function frameAnswer(op) {
    const data = pickRun();
    if (op === 'status') return data ? { name: data.name, status: (data.properties || {}).status } : {};
    if (op === 'collect') {
      if (!data) throw new Error('No run data captured yet.');
      return collect(data, () => {}).then((steps) => ({ data: data, steps: steps }));
    }
    throw new Error('Unknown request.');
  }

  // The hook only goes in where there is something to capture; the tile itself
  // is registered everywhere and the panel hides it off-site (see core.js).
  if (/make\.powerautomate\.com$/i.test(location.hostname)) injectHook();

  DynaBoost.register({
    id: 'flow-run-export',
    name: 'Export run',
    group: 'Power Automate flows',
    hosts: ['make.powerautomate.com'],
    when: () => /\/flows\//i.test(location.pathname),
    inFrames: true,
    type: 'action',
    hint: 'Opens a read-only tab with every input and output of the run on screen',
    icon: ICON,
    onRun: run,
    frameRun: frameRun,
    frameAnswer: frameAnswer
  });
})();
