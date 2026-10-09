/* DynaBoost - the Edit flow editor, an extension page:
 * src/flow-editor.html?env=...&flow=...&tab=<the portal tab>. It does not
 * depend on the portal tab it came from - reload, navigate or close it.
 *
 * Every read, check and save is a message to a Power Automate tab, whose
 * content script passes it to the page helper (flow-edit-hook.js): the tab it
 * came from, else a tab showing this flow, this environment, or any.
 *
 * Save runs, in order:
 *   1. the text parses as JSON with "definition" and "connectionReferences";
 *   2. checkFlowErrors and checkFlowWarnings, as the designer runs them - an
 *      error stops the save, warnings are asked about; no checks, no save;
 *   3. the flow is read again - changed since it was loaded, the save is
 *      refused;
 *   4. the version being replaced goes to chrome.storage.local
 *      (dynaboost.flowBackups: the 5 newest of all flows, 14 days) before
 *      the PATCH.
 * Validate runs 1 and 2 only.
 */
(function () {
  const PORTAL = 'https://make.powerautomate.com';
  const WAIT_FOR_PAGE = 30000; // a reloading portal tab gets this long to make its first call

  const CHECK =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m5 13 4 4L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const COPY =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/>' +
    '<path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  const BACKUP_KEY = 'dynaboost.flowBackups';
  const BACKUPS_KEPT = 5;
  const BACKUP_DAYS = 14; // background.js trims them too, when the browser starts
  const fresh = (b) => !!b && Date.now() - Date.parse(b.savedAt) < BACKUP_DAYS * 86400000;
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ---------- asking Power Automate ----------

  const params = new URLSearchParams(location.search);
  let source = Number(params.get('tab')) || null;
  // The flow's tab is in an incognito window (and this editor is not): it is
  // the only side whose sign-in this editor uses.
  const sourceIncognito = params.get('incognito') === '1';
  let onWait = null; // the editor's status line, while a tab is being waited for

  function sendTo(tabId, msg) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, msg, (reply) => {
        if (chrome.runtime.lastError || !reply) return reject(Object.assign(new Error('no tab'), { code: 'no-tab' }));
        if (reply.ok) resolve(reply.data);
        else reject(Object.assign(new Error(reply.error), { code: reply.code, status: reply.status }));
      });
    });
  }

  // Power Automate tabs, best first: this flow, this environment, any.
  function portalTabs(where) {
    return new Promise((resolve) => {
      chrome.tabs.query({ url: PORTAL + '/*' }, (tabs) => {
        const score = (t) => (String(t.url).toLowerCase().indexOf(where.flow) >= 0 ? 2 : String(t.url).indexOf(where.env) >= 0 ? 1 : 0);
        // Only tabs on the same side as the flow's: incognito or not, the
        // other side may be signed in as someone else.
        resolve((tabs || []).filter((t) => t.status !== 'unloaded' && !!t.incognito === sourceIncognito).sort((a, b) => score(b) - score(a) || (b.active ? 1 : 0) - (a.active ? 1 : 0)));
      });
    });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function ask(op, where, extra) {
    const msg = Object.assign({ type: 'DB_FLOW_ASK', op: op, env: where.env, flow: where.flow }, extra || {});
    const until = Date.now() + WAIT_FOR_PAGE;
    let last = null;
    for (;;) {
      const tried = [];
      const open = await portalTabs(where);
      if (source) tried.push(source);
      for (const t of open) if (tried.indexOf(t.id) < 0) tried.push(t.id);
      for (const id of tried) {
        try {
          const data = await sendTo(id, msg);
          source = id;
          if (onWait) onWait(null);
          return data;
        } catch (err) {
          last = err;
          if (err.code !== 'no-tab' && err.code !== 'no-auth' && err.code !== 'no-check') {
            source = id;
            if (onWait) onWait(null);
            throw err;
          }
        }
      }
      if (Date.now() > until) break;
      if (onWait) onWait(open.length ? 'Waiting for the Power Automate page to load…' : 'Waiting for a Power Automate tab - open the flow in make.powerautomate.com…');
      await sleep(1500);
    }
    if (onWait) onWait(null);
    if (last && last.code === 'no-tab') throw Object.assign(new Error(NO_TAB), { code: 'no-tab' });
    throw last || new Error(NO_TAB);
  }

  const NO_TAB = 'No Power Automate tab to ask. Open the flow in make.powerautomate.com in another tab, keep it open, and try again.';

  const NOT_READY =
    'Power Automate has not called its API on this page yet, so there is no sign-in to reuse. ' +
    'Wait until the flow has loaded - or reload the page - and try again.';
  const NO_CHECK =
    'Power Automate’s checks are not available on this page yet - the page has not called the Flow API. ' +
    'Open the flow in the designer (Edit) once, come back to this tab and try again. Nothing is saved unchecked.';

  /* A solution flow saved as a draft and never published has no published
   * row in Dataverse yet - and the APIs Edit flow reads and saves with see
   * only the published flow: "Entity 'workflow' With Id = ... Does Not Exist"
   * (0x80040217). */
  const NOT_PUBLISHED =
    'This flow has not been published yet - it exists only as a draft, and DynaBoost could not read the draft. Open the flow in the designer (Edit) once ' +
    'in its Power Automate tab, or sign in to its environment in Dynamics 365, and try again; or publish it once in the designer. ' +
    '(The same message comes for a flow that was deleted or is in another environment.)';
  const isNotPublished = (msg) => /Entity\s+'?workflow'?\s+With\s+Id\s*=.*Does\s+Not\s+Exist|0x80040217/i.test(String(msg || ''));
  // Dataverse refusing a save over a draft that is waiting to be published.
  const DRAFT_BLOCKS =
    'This flow has an unpublished draft, saved in the designer, and Power Automate does not save over it. Publish the draft first - ' +
    'Save to flow asks to when it can reach the flow\u2019s environment - or click Publish in the designer, then Save again.';
  const isDraftBlocking = (msg) => /unpublished active row|ActiveUnpublished/i.test(String(msg || ''));

  function explain(err) {
    if (err && err.code === 'no-dv') return NOT_PUBLISHED;
    if (err && err.code === 'no-auth') return NOT_READY;
    if (err && err.code === 'no-check') return NO_CHECK;
    const msg = (err && err.message) || String(err);
    if (isDraftBlocking(msg)) return DRAFT_BLOCKS;
    return isNotPublished(msg) ? NOT_PUBLISHED : msg;
  }

  // ---------- the draft, wherever it can be reached ----------

  /* The flow's environment in Dynamics 365: from the list DynaBoost keeps of
   * the user's environments (read as make.powerautomate.com or
   * make.powerapps.com lists them), else from Open in classic's memory. */
  function hostOf(env) {
    const key = String(env || '').toLowerCase();
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get('dynaboost.environments', (d) => {
          const list = ((d && d['dynaboost.environments']) || {}).list || [];
          const hit = list.find((e) => e && e.host && String(e.id || '').toLowerCase() === key);
          if (hit) return resolve(hit.host);
          chrome.storage.sync.get('dynaboost.orgHosts', (x) => resolve(((x && x['dynaboost.orgHosts']) || {})[env] || null));
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  // In a tab of the flow's environment (background.js): { result, host } or
  // { error: 'no-host' | 'no-tab' | 'signin' | 'unreachable' | message, host }.
  async function viaDynamics(where, op, on, noOpen) {
    const host = await hostOf(where.env);
    if (!host) return { error: 'no-host' };
    try {
      const r = await chrome.runtime.sendMessage({ type: 'DB_DV_FLOW', host: host, op: op, id: where.flow, on: !!on, noOpen: !!noOpen });
      if (!r) return { error: 'unreachable', host: host };
      return r.error ? { error: r.error, host: host } : { result: r, host: host };
    } catch (e) {
      return { error: e.message, host: host };
    }
  }

  function whyText(v) {
    const e = (v && v.error) || '';
    const host = (v && v.host) || 'the environment';
    if (e === 'no-host') return 'DynaBoost does not know this environment\u2019s Dynamics 365 address yet - open make.powerautomate.com or make.powerapps.com once, so it can read your environments.';
    if (e === 'signin') return 'sign in to ' + host + ' in this browser once.';
    if (e === 'unreachable') return host + ' could not be reached.';
    if (e === 'no-tab') return 'it is looked for when you save.';
    return e || 'no answer.';
  }

  /* A solution flow's draft: read by the Power Automate page when it can
   * (its designer was open there), else in a tab of the flow's environment.
   * null when neither could tell. */
  async function findDraft(where, noOpen) {
    const d = await ask('draft', where).catch(() => null);
    if (d && d.available) return Object.assign(d, { route: 'page' });
    const v = await viaDynamics(where, 'draft', false, noOpen);
    if (v.result && v.result.available) return Object.assign(v.result, { route: 'dynamics', host: v.host });
    return null;
  }

  // As Publish in the designer: the draft becomes the flow, on or off as it was.
  async function publishDraft(where, d) {
    if (d.route === 'page') return ask('publish', where, { body: { on: d.on } });
    const v = await viaDynamics(where, 'publish', d.on, false);
    if (v.error) throw new Error('The draft could not be published in ' + (v.host || 'the environment') + ': ' + whyText(v));
    return v.result;
  }

  // ---------- the flow ----------

  function describe(got) {
    const p = (got.flow && got.flow.properties) || {};
    return {
      via: got.via,
      name: p.displayName || got.flow.name || 'Flow',
      state: p.state || '',
      environment: p.environment || null,
      modified: String(p.lastModifiedTime || '').slice(0, 16).replace('T', ' '),
      definition: p.definition || null,
      connectionReferences: p.connectionReferences || {}
    };
  }

  // A draft read from Dataverse (the hook's 'draft'): draft 'only' - never
  // published; 'pending' - published, with a newer draft saved in the designer.
  function describeDraft(d, kind) {
    return {
      via: null,
      name: d.name || 'Flow',
      state: d.on ? 'Started' : 'Stopped',
      environment: null,
      modified: String(d.modified || '').slice(0, 16).replace('T', ' '),
      definition: d.definition,
      connectionReferences: d.connectionReferences || {},
      draft: kind
    };
  }

  // The published flow, as always; a flow never published opens as its draft.
  async function load(where) {
    try {
      return describe(await ask('get', where));
    } catch (err) {
      if (!isNotPublished(err.message)) throw err;
      const d = await findDraft(where, false);
      if (!d || !d.definition) throw err;
      return describeDraft(d, 'only');
    }
  }

  const editable = (f) => JSON.stringify({ connectionReferences: f.connectionReferences, definition: f.definition }, null, 2);
  // JSON with the keys in order, to compare what two APIs return.
  const canon = (v) =>
    JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, key) => ((o[key] = x[key]), o), {}) : x));
  const same = (a, b) => JSON.stringify(a.definition) === JSON.stringify(b.definition) && JSON.stringify(a.connectionReferences) === JSON.stringify(b.connectionReferences);

  function backup(where, f) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(BACKUP_KEY, (data) => {
          const list = ((data && data[BACKUP_KEY]) || []).filter(fresh);
          // As text only: it keeps the flow's own key order (chrome.storage
          // sorts an object's keys), and the flow is not kept twice.
          list.unshift({ env: where.env, id: where.flow, name: f.name, savedAt: new Date().toISOString(), text: editable(f) });
          chrome.storage.local.set({ [BACKUP_KEY]: list.slice(0, BACKUPS_KEPT) }, resolve);
        });
      } catch (e) {
        resolve();
      }
    });
  }

  // ---------- checks ----------

  // Where JSON.parse stopped: "... at position 123" or "(line 5 column 3)".
  function errorOffset(message, text) {
    let m = /position (\d+)/i.exec(message);
    if (m) return Number(m[1]);
    m = /line (\d+) column (\d+)/i.exec(message);
    if (!m) return -1;
    const lines = text.split('\n').slice(0, Number(m[1]) - 1);
    return lines.reduce((n, l) => n + l.length + 1, 0) + Number(m[2]) - 1;
  }

  // Where it broke, as you would say it: line, column and the text around,
  // with ▮ at the spot - enough to find it, or to send to someone.
  function near(text, offset) {
    if (offset < 0) return '';
    const start = text.lastIndexOf('\n', offset - 1) + 1;
    const end = text.indexOf('\n', offset);
    const line = text.slice(start, end < 0 ? text.length : end);
    const col = offset - start;
    const from = Math.max(0, col - 40);
    const shown = (from ? '…' : '') + line.slice(from, col).replace(/^\s+/, '') + '▮' + line.slice(col, col + 30) + (line.length > col + 30 ? '…' : '');
    return ' - line ' + (text.slice(0, start).split('\n').length) + ', column ' + (col + 1) + ': ' + shown.trim();
  }

  // Copying from a chat, a mail or a preview brings non-breaking and
  // zero-width spaces that look like spaces and are not JSON whitespace.
  const ODD_SPACE = /[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000\ufeff]/;
  const ODD_NAMES = { '\u00a0': 'a non-breaking space', '\u200b': 'a zero-width space', '\ufeff': 'a byte order mark', '\u202f': 'a narrow non-breaking space' };

  // Swaps them for plain spaces (zero-width ones for nothing) outside the
  // strings - inside a string they may be meant, and they are valid there.
  function cleanSpaces(text) {
    let out = '';
    let count = 0;
    let inString = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        out += c;
        if (c === '\\') out += text[++i] || '';
        else if (c === '"') inString = false;
      } else if (c === '"') {
        inString = true;
        out += c;
      } else if (ODD_SPACE.test(c)) {
        count++;
        out += /[\u200b\ufeff]/.test(c) ? '' : ' ';
      } else out += c;
    }
    return { text: out, count: count };
  }

  const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

  // Step 1: the text itself. Returns { ok, parsed, message, offset }.
  function localCheck(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      const offset = errorOffset(e.message, text);
      const odd = offset >= 0 && ODD_SPACE.test(text[offset] || '');
      const what = odd
        ? 'an invisible character here - ' + (ODD_NAMES[text[offset]] || 'U+' + text.charCodeAt(offset).toString(16).toUpperCase().padStart(4, '0')) + ', usually from copying. Paste again: DynaBoost now cleans them'
        : e.message.replace(/ in JSON at position.*$/, '');
      return { ok: false, message: 'Invalid JSON: ' + what + near(text, offset), offset: offset };
    }
    if (!isObject(parsed)) return { ok: false, message: 'The JSON must be an object with "definition" and "connectionReferences".' };
    if (!isObject(parsed.definition)) return { ok: false, message: 'Missing "definition" - the flow itself, with its triggers and actions.' };
    if (!isObject(parsed.connectionReferences)) return { ok: false, message: 'Missing "connectionReferences" - an object, even when empty.' };
    if (!isObject(parsed.definition.triggers) || !Object.keys(parsed.definition.triggers).length) return { ok: false, message: 'The definition has no trigger ("triggers" is missing or empty).' };
    if (parsed.definition.actions != null && !isObject(parsed.definition.actions)) return { ok: false, message: '"actions" in the definition must be an object.' };
    return { ok: true, parsed: parsed };
  }

  // What the designer's checks return varies a little; read it generously.
  function issue(x) {
    if (typeof x === 'string') return { where: '', text: x, fix: '' };
    const fix = x.fixInstructions && (x.fixInstructions.markdownText || x.fixInstructions.text || x.fixInstructions.message);
    return {
      where: x.operationName || x.actionName || x.name || '',
      text: x.errorDescription || x.warningDescription || x.description || x.message || x.ruleId || JSON.stringify(x),
      fix: fix || ''
    };
  }

  // ---------- the tab ----------

  function buildHtml(where, f) {
    const flowUrl = PORTAL + '/environments/' + encodeURIComponent(where.env) + '/flows/' + where.flow + '/details';
    const on = /^started$/i.test(f.state);
    return (
      '<!doctype html><meta charset="utf-8"><title>' + esc(f.name) + ' — flow</title>' +
      '<style>' +
      'html,body{height:100%}' +
      'body{margin:0;display:flex;flex-direction:column;font:14px/1.5 "Segoe UI",system-ui,sans-serif;color:var(--dbc-fg-10224e);background:var(--dbc-bg-f5f7fc)}' +
      'code{font:12.5px ui-monospace,Consolas,monospace;color:var(--dbc-fg-56637f)}' +
      'header{flex:none;padding:16px 22px 0;background:var(--dbc-bg-fff);border-bottom:2px solid var(--dbc-bd-e3b04b)}' +
      'h1{margin:0;font-size:19px;font-weight:600}' +
      '.crumbs{margin-top:3px;font-size:13px;color:var(--dbc-fg-56637f)}.crumbs a{color:var(--dbc-fg-1e6bff);text-decoration:none}.crumbs a:hover{text-decoration:underline}' +
      '.bd{display:inline-block;margin-left:6px;padding:1px 8px;border-radius:10px;background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f);font-size:11.5px;vertical-align:1px}' +
      '.bd.ok{background:var(--dbc-bg-e4f4e8);color:var(--dbc-fg-1c6b32)}' +
      '.bd.draft{background:var(--dbc-bg-fdf1d6);color:var(--dbc-fg-9a6a12);font-weight:600;cursor:help}' +
      // A question in DynaBoost's own dialog, as the panel's (Presenting): the
      // page dimmed, a card with the golden spiral, Yes / No - Yes first, as
      // in Microsoft's dialogs.
      '.ask{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;background:rgba(6,14,34,.55)}' +
      '.ask-box{position:relative;overflow:hidden;width:420px;max-width:calc(100% - 32px);padding:18px 20px;border-radius:10px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);box-shadow:0 18px 50px rgba(6,14,34,.35)}' +
      '.ask-box::after{content:"";position:absolute;right:-22px;top:-18px;width:210px;height:130px;background:' + (DynaBoost.markUrl || 'none') + ' no-repeat right top/contain;opacity:.4;pointer-events:none}' +
      '.ask-box>*{position:relative;z-index:1}' +
      '.ask-head{display:flex;justify-content:space-between;align-items:center;font-size:16px;font-weight:600}' +
      '.ask-head button{border:none;background:none;padding:0 2px;font-size:18px;color:var(--dbc-fg-56637f);cursor:pointer}' +
      '.ask-text{margin:10px 0 18px;font-size:14px;line-height:1.5;color:var(--dbc-fg-3d4a66)}' +
      '.ask-actions{display:flex;justify-content:flex-end;gap:8px}' +
      '.ask-actions button{min-width:76px;padding:8px 16px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);font:inherit;font-size:14px;cursor:pointer}' +
      '.ask-actions button:hover{border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-1e6bff)}' +
      '.ask-actions .primary{border-color:var(--dbc-bd-1e6bff);background:var(--dbc-bg-1e6bff);color:var(--dbc-fg-fff);font-weight:600}' +
      '.ask-actions .primary:hover{background:var(--dbc-bg-155ee0);color:var(--dbc-fg-fff)}' +
      '[hidden]{display:none!important}' +
      '.why{margin-top:8px;padding:8px 12px;border-radius:6px;background:var(--dbc-bg-fdf1d6);color:var(--dbc-fg-7a5410);font-size:13px;max-width:900px}' +
      '.bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px;padding-bottom:12px}' +
      'button{padding:7px 13px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:6px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);font:inherit;cursor:pointer}' +
      'button:hover:enabled{border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-1e6bff)}' +
      'button{transition:background-color .15s,border-color .15s,color .15s,transform .06s}' +
      'button:active:enabled{transform:translateY(1px);box-shadow:inset 0 1px 3px rgba(10,23,56,.18)}' +
      'button:disabled{opacity:.45;cursor:default}' +
      'button.primary{background:var(--dbc-bg-1e6bff);border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-fff);font-weight:600}' +
      'button.primary:hover:enabled{background:var(--dbc-bg-155ee0);color:var(--dbc-fg-fff)}' +
      'button svg{width:14px;height:14px;vertical-align:-2px;margin-right:6px}' +
      'button.db-ok,button.db-ok:hover:enabled{border-color:var(--dbc-bd-1c6b32);color:var(--dbc-fg-1c6b32);background:var(--dbc-bg-e4f4e8)}' +
      'button.db-bad,button.db-bad:hover:enabled{border-color:var(--dbc-bd-a11a1a);color:var(--dbc-fg-a11a1a);background:var(--dbc-bg-fde8e8)}' +
      '.sep{width:1px;align-self:stretch;margin:2px 4px;background:var(--dbc-bg-dde3f0)}' +
      '.status{margin-left:auto;font-size:12.5px;color:var(--dbc-fg-56637f);max-width:520px;text-align:right}.status.bad{color:var(--dbc-fg-a11a1a);cursor:copy}.status.good{color:var(--dbc-fg-1c6b32)}' +
      '.status.bad:hover{text-decoration:underline dotted}.status.copied{color:var(--dbc-fg-1c6b32)}' +
      'main{flex:1;display:flex;gap:14px;min-height:0;padding:14px 22px 18px}' +
      'textarea{flex:1;width:100%;min-width:0;resize:none;padding:14px 18px;border:1px solid var(--dbc-bd-dde3f0);border-radius:8px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);font:12.5px/1.45 ui-monospace,Consolas,monospace;white-space:pre;tab-size:2}' +
      'textarea:focus{outline:2px solid var(--dbc-bd-1e6bff);outline-offset:-1px}' +
      'aside{flex:none;width:340px;display:none;flex-direction:column;min-height:0;border:1px solid var(--dbc-bd-dde3f0);border-radius:8px;background:var(--dbc-bg-fff)}' +
      'body.side aside{display:flex}' +
      '.pn{padding:4px 10px;border:1px solid transparent;border-radius:6px;background:none;color:var(--dbc-fg-56637f);font-weight:600;font-size:13px}' +
      '.pn:hover:enabled{border-color:transparent;background:var(--dbc-bg-f5f7fc)}' +
      'body.pane-checks #tab-checks,body.pane-versions #tab-versions{background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-10224e)}' +
      '.nb{display:inline-block;min-width:18px;margin-left:4px;padding:0 5px;border-radius:9px;background:var(--dbc-bg-eef2f9);color:var(--dbc-fg-56637f);font-size:11px;line-height:17px;text-align:center}' +
      '.nb:empty{display:none}' +
      '#ck-list,#vs-list,#ck-all{display:none}' +
      'body.pane-checks #ck-list,body.pane-versions #vs-list{display:block}body.pane-checks #ck-all{display:inline-block}' +
      '.vs-h{padding:10px 14px 4px;font-size:12px;font-weight:600;letter-spacing:.3px;text-transform:uppercase;color:var(--dbc-fg-56637f)}' +
      '.vs{position:relative;display:flex;align-items:flex-start;gap:10px;margin:4px 10px;padding:8px 10px;border:1px solid var(--dbc-bd-e3e8f2);border-radius:6px;background:var(--dbc-bg-fff);cursor:pointer;transition:border-color .15s,background .15s}' +
      '.vs:hover{border-color:var(--dbc-bd-1e6bff);background:var(--dbc-bg-f7faff)}' +
      '.vs.orig{border-left:3px solid var(--dbc-bd-e3b04b)}' +
      '.vs.here{box-shadow:0 0 0 2px var(--dbc-bd-1e6bff) inset}' +
      '.vs.orig.live{background:var(--dbc-bg-fffaf0)}' +
      '#tab-checks.passed{color:var(--dbc-fg-1c6b32)}' +
      '.vs-dot{flex:none;width:9px;height:9px;margin-top:6px;border-radius:50%;background:var(--dbc-bg-c6d0e4)}' +
      '.vs.live .vs-dot{background:var(--dbc-bg-1c9b4a)}.vs.orig .vs-dot{background:var(--dbc-bg-e3b04b)}' +
      '.vs-main{flex:1;min-width:0}.vs-t{font-weight:600;font-size:13px}.vs-m{font-size:12px;color:var(--dbc-fg-56637f)}' +
      '.vs-tag{display:inline-block;margin-left:6px;padding:0 6px;border-radius:8px;font-size:11px;font-weight:600;vertical-align:1px}' +
      '.vs-tag.live{background:var(--dbc-bg-e4f4e8);color:var(--dbc-fg-1c6b32)}.vs-tag.here{background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-1e4fb8)}.vs-tag.lock{background:var(--dbc-bg-fdf1d6);color:var(--dbc-fg-7a5410)}' +
      '.vs-acts{flex:none;display:flex;gap:4px;opacity:0;transition:opacity .12s}.vs:hover .vs-acts,.vs-acts:focus-within{opacity:1}' +
      '.vs-a{width:26px;height:26px;padding:4px;border:1px solid var(--dbc-bd-dde3f0);border-radius:5px;background:var(--dbc-bg-fff);color:var(--dbc-fg-56637f)}' +
      '.vs-a svg{display:block;width:100%;height:100%;margin:0}' +
      '.vs-a:hover:enabled{border-color:var(--dbc-bd-1e6bff);color:var(--dbc-fg-1e6bff)}.vs-a.del:hover:enabled{border-color:var(--dbc-bd-c42b1c);color:var(--dbc-fg-c42b1c);background:var(--dbc-bg-fdf3f2)}' +
      '.vs-name{width:100%;padding:1px 6px;border:1px solid var(--dbc-bd-1e6bff);border-radius:4px;font:600 13px "Segoe UI",system-ui,sans-serif;color:var(--dbc-fg-10224e);outline:none}' +
      '.vs-note{padding:6px 14px 10px;font-size:12px;color:var(--dbc-fg-8a95ad)}' +
      '.ck-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--dbc-bd-dde3f0);font-weight:600}' +
      '.ck-head button{padding:2px 8px;border:none;color:var(--dbc-fg-56637f);font-size:15px;line-height:1}' +
      '.ck-head #ck-all{margin-left:auto;padding:3px 10px;border:1px solid var(--dbc-bd-c6d0e4);font-size:12.5px;font-weight:600;color:var(--dbc-fg-1e6bff)}' +
      '.ck-list{flex:1;overflow:auto;padding:6px 0}' +
      '.ck-h{padding:8px 14px 4px;font-size:12px;font-weight:600;letter-spacing:.3px;text-transform:uppercase;color:var(--dbc-fg-56637f)}' +
      '.ck{position:relative;margin:4px 10px;padding:8px 34px 8px 10px;border-left:3px solid var(--dbc-bd-c6d0e4);border-radius:4px;background:var(--dbc-bg-f9fafd);font-size:13px;cursor:copy;transition:box-shadow .15s}' +
      '.ck:hover{box-shadow:0 0 0 1px var(--dbc-bd-c6d0e4) inset}' +
      '.ck-copy{position:absolute;top:6px;right:6px;width:24px;height:24px;padding:4px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:5px;background:var(--dbc-bg-fff);color:var(--dbc-fg-56637f);opacity:0;transition:opacity .12s}' +
      '.ck-copy svg{display:block;width:100%;height:100%;margin:0}' +
      '.ck:hover .ck-copy,.ck-copy:focus{opacity:1}' +
      '.ck.copied{box-shadow:0 0 0 2px var(--dbc-bd-1c6b32) inset}.ck.copied .ck-copy{opacity:1;border-color:var(--dbc-bd-1c6b32);color:var(--dbc-fg-1c6b32)}' +
      '.ck.err{border-left-color:var(--dbc-bd-c42b1c);background:var(--dbc-bg-fdf3f2)}.ck.warn{border-left-color:var(--dbc-bd-e3b04b);background:var(--dbc-bg-fdf8ec)}' +
      '.ck b{display:block;font-weight:600}.ck a{color:var(--dbc-fg-1e6bff);cursor:pointer;text-decoration:none}.ck a:hover{text-decoration:underline}' +
      '.ck .fix{margin-top:4px;color:var(--dbc-fg-56637f);font-size:12.5px;white-space:pre-wrap}' +
      '.ck-none{padding:10px 14px;color:var(--dbc-fg-1c6b32);font-size:13px}' +
      DynaBoost.code.css +
      DynaBoost.tabCss +
      '</style>' +
      '<body>' +
      '<header>' +
      '<h1>' + esc(f.name) + '<span class="bd' + (on ? ' ok' : '') + '">' + (on ? 'On' : f.state ? esc(f.state.replace(/^stopped$/i, 'Off')) : 'flow') + '</span>' +
      '<span class="bd draft" id="draft-bd" hidden></span></h1>' +
      '<div class="crumbs">flow <code>' + esc(where.flow) + '</code> · environment <code>' + esc(where.env) + '</code>' +
      (f.modified ? ' · modified ' + esc(f.modified) : '') +
      ' · <a href="' + esc(flowUrl) + '" id="open-flow" target="_blank" rel="noopener">open flow</a>' +
      ' · <a href="#" id="to-portal" title="Reload the Power Automate tab this editor works with and switch to it - to see a save in the designer or test it">reload in Power Automate</a></div>' +
      (on ? '<div class="why">This flow is on: a save takes effect for its next run.</div>' : '') +
      '<div class="bar">' +
      '<button class="primary" id="save" disabled>Save to flow</button>' +
      '<button id="validate">Validate</button>' +
      '<span class="sep"></span>' +
      '<button id="reload">Reload</button>' +
      '<button id="copy">Copy JSON</button>' +
      '<button id="dl">Download .json</button>' +
      '<button id="fmt">Format</button>' +
      '<span class="sep"></span>' +
      '<button id="versions" title="The original and your saved versions - click one to load it">Versions<span class="nb" id="vs-n"></span></button>' +
      '<span class="status" id="status"></span>' +
      '</div></header>' +
      '<main><textarea id="ed" spellcheck="false"></textarea>' +
      '<aside><div class="ck-head">' +
      '<button class="pn" id="tab-versions" data-pane="versions">Versions</button>' +
      '<button class="pn" id="tab-checks" data-pane="checks"><span id="ck-title">Checks</span></button>' +
      '<button id="ck-all" title="Copy every error and warning, ready to send">Copy all</button><button id="ck-close" title="Close">\u2715</button></div>' +
      '<div class="ck-list" id="ck-list"><div class="ck-none" style="color:var(--dbc-fg-56637f)">Validate shows Power Automate\u2019s errors and warnings here.</div></div>' +
      '<div class="ck-list" id="vs-list"></div></aside></main>' +
      '<div class="ask" id="ask" role="dialog" aria-modal="true" aria-labelledby="ask-title" hidden><div class="ask-box">' +
      '<div class="ask-head"><span id="ask-title"></span><button type="button" id="ask-x" aria-label="Close">\u2715</button></div>' +
      '<div class="ask-text" id="ask-text"></div>' +
      '<div class="ask-actions"><button type="button" class="primary" id="ask-yes">Yes</button><button type="button" id="ask-no">No</button></div>' +
      '</div></div>'
    );
  }

  function flash(btn, text, ok) {
    if (btn.__dbTimer) clearTimeout(btn.__dbTimer);
    if (btn.__dbLabel == null) btn.__dbLabel = btn.textContent;
    btn.innerHTML = (ok ? CHECK : '') + esc(text);
    btn.classList.remove('db-ok', 'db-bad');
    btn.classList.add(ok ? 'db-ok' : 'db-bad');
    btn.__dbTimer = setTimeout(() => {
      btn.textContent = btn.__dbLabel;
      btn.classList.remove('db-ok', 'db-bad');
    }, 2600);
  }

  async function copyInto(tab, text) {
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

  function download(tab, content, name) {
    const doc = tab.document;
    const blob = new tab.Blob([content], { type: 'application/json' });
    const url = tab.URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = name;
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    setTimeout(() => tab.URL.revokeObjectURL(url), 10000);
  }

  function wire(tab, where, first) {
    const doc = tab.document;
    const get = (id) => doc.getElementById(id);
    const ed = get('ed');
    const status = get('status');
    let flow = first;
    let original = editable(flow);
    let busy = false;
    // Closing to publish in the designer: no "unsaved edit" question then.
    let closing = false;

    // A question in DynaBoost's own dialog: Yes resolves true; No, ✕, Esc or
    // a click beside it false.
    function choose(title, text, yes, no) {
      const box = get('ask');
      get('ask-title').textContent = title;
      get('ask-text').textContent = text;
      get('ask-yes').textContent = yes || 'Yes';
      get('ask-no').textContent = no || 'No';
      box.hidden = false;
      get('ask-yes').focus();
      return new Promise((resolve) => {
        const done = (yes) => {
          box.hidden = true;
          doc.removeEventListener('keydown', onKey, true);
          box.onclick = null;
          resolve(yes);
        };
        const onKey = (e) => {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          done(false);
        };
        doc.addEventListener('keydown', onKey, true);
        box.onclick = (e) => {
          if (e.target === box || e.target.id === 'ask-no' || e.target.id === 'ask-x') done(false);
          else if (e.target.id === 'ask-yes') done(true);
        };
      });
    }

    /* When the flow has to be published and DynaBoost cannot do it from
     * here: OK keeps the edit (on the clipboard and under Versions), brings
     * the flow's Power Automate tab forward and closes this one - Publish is
     * clicked there, then Edit flow opened again. Cancel stays. */
    async function askToPublish(why) {
      const go = await choose(
        'Publish the flow first',
        why + ' OK closes this tab - your code is copied and kept under Versions - and brings the flow\u2019s Power Automate tab forward: click Publish in its designer, then open Edit flow again.',
        'OK',
        'Cancel'
      );
      if (!go) {
        setStatus('Not saved. Publish the flow in its designer, then Save again.', null);
        return;
      }
      const text = ed.value;
      await copyInto(tab, text).catch(() => false);
      await new Promise((resolve) => {
        try {
          chrome.storage.local.get(BACKUP_KEY, (data) => {
            const list = ((data && data[BACKUP_KEY]) || []).filter(fresh);
            list.unshift({ env: where.env, id: where.flow, name: flow.name, label: 'Your edit, before publishing', savedAt: new Date().toISOString(), text: text });
            chrome.storage.local.set({ [BACKUP_KEY]: list.slice(0, BACKUPS_KEPT) }, resolve);
          });
        } catch (e) {
          resolve();
        }
      });
      closing = true;
      if (source) showSource();
      try {
        chrome.tabs.getCurrent((t) => (t ? chrome.tabs.remove(t.id) : tab.close()));
      } catch (e) {
        tab.close();
      }
    }

    // A draft: a mark by the name, what it means on hover; Save to flow
    // publishes it first (asked).
    function markDraft(kind) {
      flow.draft = kind || null;
      const bd = get('draft-bd');
      bd.hidden = !kind;
      if (kind === 'only') {
        bd.textContent = 'Draft - not published';
        bd.title = 'This flow has not been published yet - this is its draft, as the designer shows it. Save to flow publishes the draft first (it asks), then saves.';
      } else if (kind === 'pending') {
        bd.textContent = 'Unpublished draft';
        bd.title = 'This flow has a newer draft, saved in the designer and not published - shown here is the published flow. Save to flow publishes the draft first (it asks; it stays in the version history), then saves over it.';
      }
    }

    // A published flow with a newer draft waiting in the designer.
    function lookForDraft() {
      if (flow.draft === 'only') return;
      // As it opens: no tab is opened for this - Save looks with one if needed.
      findDraft(where, true).then(
        (d) => {
          if (d && d.published && d.hasDraft) markDraft('pending');
          else if (d) markDraft(null);
        },
        () => {}
      );
    }
    markDraft(flow.draft);
    lookForDraft();

    // ---------- versions ----------
    //
    // For this editor tab: the flow as it was when opened - kept, never
    // dropped - and the last MAX_SAVED saves, a new one pushing out the
    // oldest. Click one to load it into the editor; Save makes it live.
    // Kept in the tab's sessionStorage, so reloading the editor keeps them
    // and closing it lets them go (it asks first, past three). Below them,
    // the backups kept in the browser before every save, from any session.
    const MAX_SAVED = 5;
    const VKEY = 'dynaboost.flowVersions.' + where.flow;
    let versions = null;
    try {
      versions = JSON.parse(tab.sessionStorage.getItem(VKEY) || 'null');
    } catch (e) {
      versions = null;
    }
    if (!versions || !versions.original) versions = { original: { text: editable(first), at: Date.now() }, saved: [], next: 1, live: 'o' };
    if (!versions.live) versions.live = 'o';
    // The version taken from the list and still untouched in the editor -
    // saving it as it is puts that version back rather than making a new one.
    let loaded = versions.live; // at the start the editor holds what is in the flow

    function keepVersions() {
      try {
        tab.sessionStorage.setItem(VKEY, JSON.stringify(versions));
      } catch (e) {
        /* too large for sessionStorage - they still live in this page */
      }
    }

    // After a save. The original picked from the list and saved unchanged
    // is the original again - not a new version that happens to match it.
    // Anything else saved is a new version, pasted-in copies of the
    // original included.
    function afterSave(text) {
      if (loaded === 'o' && sameText(text, versions.original.text)) {
        versions.live = 'o';
      } else {
        versions.saved.push({ n: versions.next, text: text, at: Date.now() });
        versions.live = 's' + versions.next++;
        while (versions.saved.length > MAX_SAVED) versions.saved.shift();
      }
      loaded = versions.live;
      keepVersions();
      renderVersions();
    }

    // Every action, nested ones included - the one number that tells versions apart at a glance.
    function countActions(acts) {
      let n = 0;
      for (const a of Object.values(acts || {})) {
        n++;
        if (!a || typeof a !== 'object') continue;
        n += countActions(a.actions);
        if (a.else) n += countActions(a.else.actions);
        if (a.default) n += countActions(a.default.actions);
        for (const c of Object.values(a.cases || {})) n += countActions(c && c.actions);
      }
      return n;
    }
    const actionsIn = (text) => {
      try {
        return countActions(JSON.parse(text).definition.actions);
      } catch (e) {
        return null;
      }
    };

    const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const DL =
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const PEN =
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 20h4L19 9l-4-4L4 16v4Zm10-14 4 4" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    const BIN =
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 11v5M13.5 11v5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    let older = []; // backups from the browser's storage, for this flow

    function renderVersions() {
      const list = get('vs-list');
      if (!list) return;
      const rows = [];
      const entry = (key, title, v, prevText, extra) => {
        const n = actionsIn(v.text);
        const p = prevText == null ? null : actionsIn(prevText);
        const delta = n != null && p != null && n !== p ? ' · ' + (n > p ? '+' : '\u2212') + Math.abs(n - p) + ' action' + (Math.abs(n - p) > 1 ? 's' : '') : '';
        const live = key === versions.live && original === v.text;
        const here = key === loaded && ed.value === v.text;
        return (
          '<div class="vs' + (extra || '') + (live ? ' live' : '') + (here ? ' here' : '') + '" data-vs="' + key + '" title="Click to load into the editor">' +
          '<span class="vs-dot"></span><div class="vs-main"><div class="vs-t"><span class="vs-l">' + esc((key !== 'o' && v.name) || title) + '</span>' +
          (live ? '<span class="vs-tag live">in the flow</span>' : '') +
          (here && !live ? '<span class="vs-tag here">in the editor</span>' : '') +
          '</div><div class="vs-m">' + esc(clock(v.at)) + (n != null ? ' · ' + n + ' action' + (n === 1 ? '' : 's') : '') + delta + '</div></div>' +
          '<span class="vs-acts">' +
          (key === 'o' ? '' : '<button class="vs-a" data-act="rename" data-key="' + key + '" title="Rename" aria-label="Rename">' + PEN + '</button>') +
          '<button class="vs-a" data-act="dl" data-key="' + key + '" title="Download as .json" aria-label="Download">' + DL + '</button>' +
          (key === 'o' ? '' : '<button class="vs-a del" data-act="del" data-key="' + key + '" title="Delete" aria-label="Delete">' + BIN + '</button>') +
          '</span></div>'
        );
      };
      rows.push('<div class="vs-h">This session</div>');
      rows.push(entry('o', 'Original', versions.original, null, ' orig'));
      const saved = versions.saved.slice().reverse();
      saved.forEach((v, i) => {
        const prev = i + 1 < saved.length ? saved[i + 1].text : versions.original.text;
        rows.push(entry('s' + v.n, 'Version ' + v.n, v, prev));
      });
      rows.push(
        '<div class="vs-note">' +
          (versions.saved.length ? 'The last ' + MAX_SAVED + ' saves are kept; the original always. ' : 'Each Save to flow adds a version here. ') +
          'They stay while this tab is open.</div>'
      );
      if (older.length) {
        rows.push('<div class="vs-h">Backups in this browser</div>');
        older.forEach((b, i) => rows.push(entry('b' + i, 'Before a save', b, null)));
        rows.push('<div class="vs-note">The flow as it was before each save, from any session - kept ' + BACKUP_DAYS + ' days.</div>');
      }
      list.innerHTML = rows.join('');
      get('vs-n').textContent = versions.saved.length ? String(versions.saved.length) : '';
    }

    // The same flow whatever the order of its keys.
    function canonical(v) {
      if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
      if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
      return JSON.stringify(v);
    }
    function sameText(a, b) {
      if (a === b) return true;
      try {
        return canonical(JSON.parse(a)) === canonical(JSON.parse(b));
      } catch (e) {
        return false;
      }
    }

    function loadOlder() {
      try {
        chrome.storage.local.get(BACKUP_KEY, (data) => {
          older = ((data && data[BACKUP_KEY]) || [])
            // this flow in this environment - a solution keeps a flow's id from one environment to the next
            .filter((b) => fresh(b) && b.id === where.flow && b.env === where.env && (b.text || b.definition))
            .map((b) => ({ at: Date.parse(b.savedAt) || Date.now(), savedAt: b.savedAt, name: b.label || '', text: typeof b.text === 'string' ? b.text : editable(b) }))
            // what the session list already shows is not repeated
            .filter((b) => !sameText(b.text, versions.original.text) && !versions.saved.some((v) => sameText(v.text, b.text)));
          renderVersions();
        });
      } catch (e) {
        /* no storage - the session's versions still show */
      }
    }

    function versionOf(key) {
      if (key === 'o') return { v: versions.original, name: 'The original' };
      if (key[0] === 's') {
        const v = versions.saved.find((x) => 's' + x.n === key);
        return v ? { v: v, name: v.name || 'Version ' + v.n } : null;
      }
      if (key[0] !== 'b') return null;
      const b = older[Number(key.slice(1))];
      return b ? { v: b, name: b.name || 'The backup from ' + clock(b.at) } : null;
    }

    // A backup lives in chrome.storage with every flow's others: change the one it is.
    function editBackup(b, change) {
      chrome.storage.local.get(BACKUP_KEY, (data) => {
        const list = (data && data[BACKUP_KEY]) || [];
        const i = list.findIndex((x) => x.id === where.flow && x.savedAt === b.savedAt);
        if (i < 0) return loadOlder();
        if (change === null) list.splice(i, 1);
        else change(list[i]);
        chrome.storage.local.set({ [BACKUP_KEY]: list }, loadOlder);
      });
    }

    // Rename in place: Enter or leaving the field keeps it, Esc does not,
    // an empty name goes back to the default one.
    function rename(key) {
      const found = versionOf(key);
      const row = get('vs-list').querySelector('[data-vs="' + key + '"]');
      if (!found || !row || key === 'o') return; // the original keeps its name
      const label = row.querySelector('.vs-l');
      const input = doc.createElement('input');
      input.className = 'vs-name';
      input.value = found.v.name || label.textContent;
      input.maxLength = 60;
      label.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const finish = (keep) => {
        if (done) return;
        done = true;
        const name = input.value.trim();
        if (!keep) return renderVersions();
        if (key[0] === 'b') return editBackup(found.v, (x) => (x.label = name));
        found.v.name = name;
        keepVersions();
        renderVersions();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
        e.stopPropagation();
      });
      input.addEventListener('blur', () => finish(true));
      input.addEventListener('click', (e) => e.stopPropagation());
    }

    function remove(key) {
      const found = versionOf(key);
      if (!found || key === 'o') return;
      if (!tab.confirm('Delete ' + (found.name.replace(/^The /, 'the ')) + ' from this list? The flow itself does not change.')) return;
      if (key[0] === 'b') return editBackup(found.v, null);
      versions.saved = versions.saved.filter((v) => 's' + v.n !== key);
      if (versions.live === key) versions.live = null;
      if (loaded === key) loaded = null;
      keepVersions();
      renderVersions();
    }

    function showPane(name) {
      doc.body.classList.add('side');
      doc.body.classList.toggle('pane-checks', name === 'checks');
      doc.body.classList.toggle('pane-versions', name === 'versions');
      if (name === 'versions') {
        renderVersions();
        loadOlder();
      }
    }

    function hidePane() {
      doc.body.classList.remove('side', 'pane-checks', 'pane-versions');
    }
    DynaBoost.code.attach(tab, ed, 'json');
    ed.value = original;

    function setStatus(text, kind) {
      status.textContent = text;
      status.classList.toggle('bad', kind === 'bad');
      status.classList.toggle('good', kind === 'good');
      status.classList.remove('copied');
      status.title = kind === 'bad' ? 'Click to copy' : '';
    }

    function select(offset, length) {
      if (offset < 0) return;
      ed.focus();
      ed.setSelectionRange(offset, offset + (length || 1));
      // Bring the selection into view: the line's share of the whole text.
      const line = ed.value.slice(0, offset).split('\n').length;
      const lines = ed.value.split('\n').length;
      ed.scrollTop = Math.max(0, (line / lines) * ed.scrollHeight - ed.clientHeight / 2);
    }

    // As you type: JSON only, no call to Power Automate. quiet leaves the
    // status line alone, for after a save or a failed one.
    function quick(quiet) {
      const modified = ed.value !== original;
      const r = localCheck(ed.value);
      if (!quiet) {
        if (!r.ok) setStatus(r.message, 'bad');
        else setStatus((modified ? 'Modified · ' : '') + (ed.value.length / 1024).toFixed(0) + ' KB · valid JSON', null);
      }
      get('save').disabled = busy || !r.ok || !modified;
      return r;
    }

    // The last checks shown, for the copy buttons.
    let shown = { errors: [], warnings: [] };

    // Plain text to paste into a chat or a ticket: which flow, then each
    // finding with its action and the fix Power Automate suggests.
    const flowLine = () => 'Flow: ' + flow.name + ' (' + where.flow + ', environment ' + where.env + ')';
    const findingText = (x, kind) =>
      '[' + (kind === 'err' ? 'Error' : 'Warning') + ']' + (x.where ? ' ' + x.where.replace(/_/g, ' ') + ' (' + x.where + ')' : '') + '\n' + x.text + (x.fix ? '\nFix: ' + x.fix : '');
    function allText() {
      const e = shown.errors.map((x) => findingText(x, 'err'));
      const w = shown.warnings.map((x) => findingText(x, 'warn'));
      return [flowLine(), e.length + ' error' + (e.length === 1 ? '' : 's') + ', ' + w.length + ' warning' + (w.length === 1 ? '' : 's')].join('\n') + '\n\n' + e.concat(w).join('\n\n');
    }

    function showChecks(result) {
      const list = get('ck-list');
      const errors = result.errors.map(issue);
      const warnings = result.warnings.map(issue);
      shown = { errors: errors, warnings: warnings };
      get('ck-title').textContent = errors.length ? 'Checks · ' + errors.length + ' error' + (errors.length > 1 ? 's' : '') : warnings.length ? 'Checks · ' + warnings.length + ' warning' + (warnings.length > 1 ? 's' : '') : 'Checks passed';
      const item = (x, kind, i) =>
        '<div class="ck ' + kind + '" data-ck="' + kind + ':' + i + '" title="Click to copy">' +
        '<button class="ck-copy" type="button" title="Copy" aria-label="Copy">' + COPY + '</button>' +
        (x.where ? '<b><a data-go="' + esc(x.where) + '">' + esc(x.where.replace(/_/g, ' ')) + '</a></b>' : '') +
        esc(x.text) +
        (x.fix ? '<div class="fix">' + esc(x.fix) + '</div>' : '') +
        '</div>';
      list.innerHTML =
        (errors.length ? '<div class="ck-h">Errors</div>' + errors.map((x, i) => item(x, 'err', i)).join('') : '') +
        (warnings.length ? '<div class="ck-h">Warnings</div>' + warnings.map((x, i) => item(x, 'warn', i)).join('') : '') +
        (!errors.length && !warnings.length ? '<div class="ck-none">No errors and no warnings - the same checks the designer runs on Save.</div>' : '');
      get('ck-all').hidden = !errors.length && !warnings.length;
      get('tab-checks').classList.toggle('passed', !errors.length && !warnings.length);
      // Something to read switches to it; a clean pass stays where you are.
      if (errors.length || warnings.length) showPane('checks');
      return { errors: errors.length, warnings: warnings.length };
    }

    // Steps 1 and 2. Returns the parsed JSON and the counts, or null.
    async function validate() {
      const r = quick();
      if (!r.ok) {
        select(r.offset == null ? -1 : r.offset);
        return null;
      }
      setStatus('Checking with Power Automate…', null);
      let result;
      try {
        result = await ask('check', where, { body: { definition: r.parsed.definition } });
      } catch (err) {
        setStatus(explain(err), 'bad');
        return null;
      }
      const n = showChecks(result);
      if (n.errors) setStatus(n.errors + ' error' + (n.errors > 1 ? 's' : '') + ' - fix ' + (n.errors > 1 ? 'them' : 'it') + ' before saving.', 'bad');
      else setStatus(n.warnings ? n.warnings + ' warning' + (n.warnings > 1 ? 's' : '') + ', no errors.' : 'Checks passed.', 'good');
      return { parsed: r.parsed, errors: n.errors, warnings: n.warnings };
    }

    let timer = null;
    ed.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        quick();
        if (doc.body.classList.contains('pane-versions')) renderVersions();
      }, 250);
    });

    // After a paste, the odd spaces it brought are swapped for plain ones.
    ed.addEventListener('paste', () => {
      tab.setTimeout(() => {
        const c = cleanSpaces(ed.value);
        if (!c.count) return;
        clearTimeout(timer); // the paste's own check would overwrite the note
        const at = ed.selectionStart;
        ed.value = c.text;
        ed.setSelectionRange(Math.min(at, c.text.length), Math.min(at, c.text.length));
        const r = quick();
        if (r.ok) setStatus('Cleaned ' + c.count + ' invisible character' + (c.count > 1 ? 's' : '') + ' from the paste · valid JSON', 'good');
      }, 0);
    });
    quick();
    // Versions is open from the start; the cross closes it when the room is needed.
    showPane('versions');

    // Tab indents by two spaces instead of leaving the editor; Ctrl+S saves.
    ed.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const s = ed.selectionStart;
        ed.setRangeText('  ', s, ed.selectionEnd, 'end');
        ed.dispatchEvent(new tab.Event('input'));
      }
    });
    doc.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!get('save').disabled) get('save').click();
      }
    });

    // Closing asks first when an edit is unsaved or more than three versions
    // were saved.
    tab.addEventListener('beforeunload', (e) => {
      if (closing) return;
      if (ed.value !== original || versions.saved.length > 3) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    get('ck-close').addEventListener('click', hidePane);
    get('versions').addEventListener('click', () => (doc.body.classList.contains('pane-versions') ? hidePane() : showPane('versions')));
    for (const b of doc.querySelectorAll('[data-pane]')) b.addEventListener('click', () => showPane(b.getAttribute('data-pane')));

    /* Opened from an incognito window, the editor sits in a regular one
     * (Chrome keeps extension pages out of incognito), where another account
     * may be signed in. The flow is then shown in its own incognito tab -
     * never opened here. */
    const details = PORTAL + '/environments/' + encodeURIComponent(where.env) + '/flows/' + where.flow + '/details';
    const showSource = () =>
      chrome.tabs.get(source, (t) => {
        if (chrome.runtime.lastError || !t) return;
        chrome.tabs.update(t.id, { active: true });
        chrome.windows.update(t.windowId, { focused: true });
      });
    // The flow lost its tab: open it again, in incognito if it was there.
    const openFlow = () => (sourceIncognito ? chrome.windows.create({ incognito: true, url: details }) : tab.open(details, '_blank'));

    get('open-flow').addEventListener('click', (e) => {
      if (!sourceIncognito) return;
      e.preventDefault();
      if (source) showSource();
      else openFlow();
    });

    // Reload the portal tab and switch to it, to test a save.
    get('to-portal').addEventListener('click', (e) => {
      e.preventDefault();
      if (!source) return void openFlow();
      chrome.tabs.reload(source, {}, () => {
        if (chrome.runtime.lastError) {
          source = null;
          openFlow();
          return;
        }
        showSource();
      });
    });

    // While a Power Automate tab is being waited for, the status line says so.
    onWait = (text) => {
      if (text) setStatus(text, null);
    };
    // A finding: its action name jumps to the action; anywhere else on it -
    // or its copy button - copies it, unless you were selecting text.
    get('ck-list').addEventListener('click', async (e) => {
      const go = e.target.closest('[data-go]');
      if (go) {
        const key = '"' + go.getAttribute('data-go') + '"';
        const at = ed.value.indexOf(key + ':');
        select(at >= 0 ? at : ed.value.indexOf(key), key.length);
        return;
      }
      const card = e.target.closest('[data-ck]');
      if (!card || (!e.target.closest('.ck-copy') && String(tab.getSelection()))) return;
      const [kind, i] = card.getAttribute('data-ck').split(':');
      const x = (kind === 'err' ? shown.errors : shown.warnings)[Number(i)];
      if (!x) return;
      const ok = await copyInto(tab, flowLine() + '\n' + findingText(x, kind));
      card.classList.toggle('copied', ok);
      card.title = ok ? 'Copied' : 'Copy failed';
      setTimeout(() => {
        card.classList.remove('copied');
        card.title = 'Click to copy';
      }, 1400);
    });

    get('vs-list').addEventListener('click', (e) => {
      if (e.target.closest('.vs-name')) return;
      const act = e.target.closest('[data-act]');
      const row = e.target.closest('[data-vs]');
      const key = act ? act.getAttribute('data-key') : row ? row.getAttribute('data-vs') : '';
      // A click beside the rows - a heading, the note - is not a version.
      if (!key) return;
      if (act && act.getAttribute('data-act') === 'rename') return rename(key);
      if (act && act.getAttribute('data-act') === 'del') return remove(key);
      const dl = act && act.getAttribute('data-act') === 'dl';
      const found = versionOf(key || '');
      if (!found) return;
      const label = found.name.replace(/^The /, '').replace(/^./, (c) => c.toUpperCase());
      if (dl) {
        const safe = flow.name.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 50);
        download(tab, found.v.text, 'flow_' + safe + '_' + label.replace(/[^\p{L}\p{N}]+/gu, '_').toLowerCase() + '.json');
        setStatus(label + ' downloaded.', 'good');
        return;
      }
      if (found.v.text === ed.value && loaded === key) return;
      if (ed.value !== original && !versions.saved.concat([versions.original]).some((v) => v.text === ed.value) && !tab.confirm('Replace your unsaved edit in the editor with ' + found.name.toLowerCase() + '?')) return;
      ed.value = found.v.text;
      loaded = key;
      quick(true);
      renderVersions();
      setStatus(label + ' is in the editor' + (found.v.text === original ? ' - the same as in the flow.' : ' - Validate, then Save to flow to make it live.'), found.v.text === original ? null : 'good');
    });

    get('ck-all').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const ok = await copyInto(tab, allText());
      flash(btn, ok ? 'Copied' : 'Copy failed', ok);
    });

    // An error in the status line - a failed save, an unreadable flow - is
    // copied with a click, with the flow it belongs to.
    status.addEventListener('click', async () => {
      if (!status.classList.contains('bad')) return;
      const text = status.textContent;
      const ok = await copyInto(tab, flowLine() + '\n' + text);
      if (!ok) return;
      status.classList.add('copied');
      status.textContent = 'Copied: ' + text;
      setTimeout(() => {
        if (status.textContent === 'Copied: ' + text) status.textContent = text;
        status.classList.remove('copied');
      }, 1400);
    });

    get('fmt').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      try {
        ed.value = JSON.stringify(JSON.parse(ed.value), null, 2);
        flash(btn, 'Formatted', true);
      } catch (err) {
        flash(btn, 'Invalid JSON', false);
      }
      quick();
    });

    // The button is taken before the await: once the click is over the
    // event no longer knows it, and the Copied would have nowhere to show.
    get('copy').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const ok = await copyInto(tab, ed.value);
      flash(btn, ok ? 'Copied' : 'Copy failed', ok);
    });

    get('dl').addEventListener('click', (e) => {
      const safe = flow.name.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 60);
      download(tab, ed.value, 'flow_' + safe + '.json');
      flash(e.currentTarget, 'Downloaded', true);
    });

    get('validate').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const v = await validate();
      btn.disabled = false;
      if (v) flash(btn, v.errors ? 'Errors found' : 'Valid', !v.errors);
    });

    get('reload').addEventListener('click', async (e) => {
      if (ed.value !== original && !tab.confirm('Discard your unsaved edits and reload the flow?')) return;
      const btn = e.currentTarget;
      try {
        flow = await load(where);
        markDraft(flow.draft);
        lookForDraft();
        original = editable(flow);
        ed.value = original;
        if (doc.body.classList.contains('pane-checks')) showPane('versions');
        const match = sameText(original, versions.original.text) ? 'o' : (versions.saved.slice().reverse().find((v) => sameText(v.text, original)) || {}).n;
        versions.live = match === 'o' ? 'o' : match ? 's' + match : null;
        loaded = versions.live;
        keepVersions();
        quick();
        renderVersions();
        flash(btn, 'Reloaded', true);
      } catch (err) {
        flash(btn, 'Reload failed', false);
        setStatus(explain(err), 'bad');
      }
    });

    get('save').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (busy) return;
      busy = true;
      btn.disabled = true;
      try {
        const v = await validate();
        if (!v) return;
        if (v.errors) return;
        if (v.warnings && !tab.confirm(v.warnings + ' warning' + (v.warnings > 1 ? 's' : '') + ' - see the list on the right. Save anyway?')) {
          setStatus('Not saved.', null);
          return;
        }
        // A draft is looked for at every save, not only as the flow opened:
        // the designer may have saved one since - or published it. In the
        // Power Automate page when it can, else in a tab of the flow's
        // environment. Found: published first, as Publish in the designer
        // would - asked. Not to be found: saved as it is; if Power Automate
        // refuses it for a draft, one question - publish it in the designer.
        setStatus('Checking for an unpublished draft\u2026', null);
        // Opened as the draft: there is no published flow to compare with.
        const asDraft = flow.draft === 'only';
        const found = await findDraft(where, false);
        if (found) markDraft(!found.published ? 'only' : found.hasDraft ? 'pending' : null);
        let published = false;
        if (flow.draft && found) {
          const yes = await choose(
            'Publish the draft?',
            flow.draft === 'only'
              ? 'This flow is a draft. To save your code, the draft has to be published first.'
              : 'This flow has an unpublished draft. To save your code, the draft has to be published first – your code then replaces it.'
          );
          if (!yes) {
            setStatus('Not saved.', null);
            return;
          }
          setStatus('Publishing the draft\u2026', null);
          try {
            await publishDraft(where, found);
          } catch (e) {
            return askToPublish('DynaBoost could not publish the draft from here (' + ((e && e.message) || e) + ').');
          }
          published = true;
          markDraft(null);
          setStatus('Draft published. Saving your code\u2026', null);
        } else {
          setStatus('Saving\u2026', null);
        }
        const put = async () => {
          const now = describe(await ask('get', where));
          // Just published (here or in the designer): the flow is the draft
          // now, so there is nothing to compare with what was loaded.
          const fromDraft = published || asDraft;
          if (!fromDraft && !same(now, flow)) throw new Error('This flow changed since you loaded it (saved in the designer or another tab). Copy your edit, Reload, and apply it again.');
          if (published && !now.definition) throw new Error('The flow could not be read after publishing the draft. Reload and try again.');
          // Connection references as the published flow has them (Dataverse
          // keeps a draft's in another form) - unless they were edited here.
          const refs = fromDraft && canon(v.parsed.connectionReferences) === canon(flow.connectionReferences) ? now.connectionReferences : v.parsed.connectionReferences;
          await backup(where, now);
          return ask('save', where, {
            via: flow.via,
            body: { displayName: now.name, environment: now.environment, definition: v.parsed.definition, connectionReferences: refs }
          });
        };
        let saved;
        try {
          saved = await put();
        } catch (err) {
          // Refused because the flow wants publishing: published here when
          // DynaBoost can reach its draft (asked), else the designer's job.
          if (!(isDraftBlocking(err.message) || isNotPublished(err.message))) throw err;
          const why = 'Power Automate did not save: this flow has an unpublished draft';
          if (published) return askToPublish('Power Automate still did not save after the draft was published here.');
          const d = found || (await findDraft(where, false));
          if (!d) return askToPublish(why + ', and DynaBoost cannot publish it from here.');
          markDraft('pending');
          const yes = await choose('Publish the draft?', why + '. Publish it now - as Publish in the designer - and save your code over it?');
          if (!yes) {
            setStatus('Not saved. Publish the flow in its designer, then Save again.', null);
            return;
          }
          setStatus('Publishing the draft\u2026', null);
          try {
            await publishDraft(where, d);
          } catch (e) {
            return askToPublish('DynaBoost could not publish the draft from here (' + ((e && e.message) || e) + ').');
          }
          published = true;
          markDraft(null);
          setStatus('Draft published. Saving your code\u2026', null);
          saved = await put();
        }
        flow = describe(saved);
        if (!flow.definition) flow = describe(await ask('get', where));
        original = editable(flow);
        ed.value = original;
        afterSave(original);
        // A use, for Time saved (background.js adds it up).
        chrome.runtime.sendMessage({ type: 'DB_SAVED', id: 'flow-edit' }).catch(() => {});
        flash(btn, 'Saved', true);
        setStatus('Saved. “Reload in Power Automate” (above) shows it in the designer - this editor stays ready for the next change.', 'good');
      } catch (err) {
        flash(btn, 'Save failed', false);
        setStatus(explain(err), 'bad');
      } finally {
        busy = false;
        quick(true);
      }
    });
  }

  // ---------- start ----------

  // Light or dark as the panel was when the tile was clicked (&theme=dark).
  const dark = params.get('theme') === 'dark';

  async function start() {
    DynaBoost.themeTab(window, dark);
    // The boot note's page, in the table's colours so it follows the mode.
    document.body.style.color = 'var(--dbc-fg-10224e)';
    document.body.style.background = 'var(--dbc-bg-f5f7fc)';
    const where = { env: params.get('env') || '', flow: (params.get('flow') || '').toLowerCase() };
    const note = document.getElementById('boot');
    onWait = (text) => {
      if (text && note) note.textContent = text;
    };
    let flow;
    try {
      if (!where.env || !where.flow) throw new Error('No flow given.');
      flow = await load(where);
      if (!flow.definition) throw new Error('The flow came back without a definition.');
    } catch (e) {
      document.title = 'Edit flow';
      if (note) {
        note.textContent = 'Could not read the flow. ' + explain(e);
        note.style.color = 'var(--dbc-fg-a11a1a)';
      }
      return;
    }
    document.documentElement.innerHTML = buildHtml(where, flow).replace(/^<!doctype html>/i, '');
    DynaBoost.themeTab(window, dark);
    wire(window, where, flow);
  }

  start();
})();
