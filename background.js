/* The manifest injects the content scripts into new pages. Tabs that were
 * already open when the extension was installed or updated get them from
 * here, from the same list in the manifest: at once, and again on a toolbar
 * click if that did not reach them. */
const SCRIPT = chrome.runtime.getManifest().content_scripts[0];
const FILES = SCRIPT.js;
const CSS = SCRIPT.css || [];

// The same sites as the manifest's matches, minus its exclude_matches.
const NOT_DEVOPS = ['code.visualstudio.com', 'marketplace.visualstudio.com', 'app.vssps.visualstudio.com'];

function isSupported(url) {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch (e) {
    return false;
  }
  return (
    host === 'make.powerapps.com' ||
    host === 'make.powerautomate.com' ||
    host.endsWith('.dynamics.com') ||
    host === 'dev.azure.com' ||
    (host.endsWith('.visualstudio.com') && !NOT_DEVOPS.includes(host))
  );
}

async function inject(tabId) {
  // A page that already has this DynaBoost keeps it - a second copy would run
  // every feature twice (a page loading while DynaBoost is installed gets one
  // from the manifest too).
  const [probe] = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: () => !!(window.DynaBoost && window.DynaBoost.register && !window.DynaBoost.retired)
  });
  if (probe && probe.result) return;
  await chrome.scripting.insertCSS({ target: { tabId: tabId }, files: CSS });
  await chrome.scripting.executeScript({ target: { tabId: tabId }, files: FILES });
}

async function openPanel(tab) {
  if (!tab.id || !isSupported(tab.url)) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'DB_TOGGLE_PANEL' });
  } catch (e) {
    // Not injected yet (the tab was open before an install or update):
    // inject and retry once.
    try {
      await inject(tab.id);
      await chrome.tabs.sendMessage(tab.id, { type: 'DB_TOGGLE_PANEL' });
    } catch (e2) {
      // The tab closed, scripts cannot run on this page, or the page holds a
      // copy put in while DynaBoost was being reloaded - only a reload helps.
      askReload(tab.id).catch(() => {});
    }
  }
}

function askReload(tabId) {
  return chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: () => {
      let layer = document.getElementById('dynaboost-toast');
      if (!layer) {
        layer = document.createElement('div');
        layer.id = 'dynaboost-toast';
        document.body.appendChild(layer);
      }
      layer.classList.toggle('db-dark', matchMedia('(prefers-color-scheme: dark)').matches);
      const card = document.createElement('div');
      card.className = 'db-toast db-toast-error';
      card.innerHTML =
        '<div class="db-toast-row"><span class="db-toast-mark">!</span><div class="db-toast-text">' +
        '<div class="db-toast-title">Reload this page to use DynaBoost</div>' +
        '<div class="db-toast-sub">DynaBoost was updated while the page was open.</div></div></div>';
      layer.appendChild(card);
      setTimeout(() => card.remove(), 6000);
    }
  });
}

chrome.action.onClicked.addListener(openPanel);

// After an update the copy running in an open tab is cut off and steps aside
// (core.js); the new one goes in straight away, so the tab keeps its tools.
chrome.runtime.onInstalled.addListener(async (details) => {
  // Not on a browser update: the tabs then still have their copy.
  if (details.reason !== 'install' && details.reason !== 'update') return;
  // A new version lights the dot on the heart in the panel (core.js), until
  // Say thanks is opened.
  if (details.reason === 'update') {
    const key = 'dynaboost.use';
    const use = (await chrome.storage.local.get(key))[key] || { since: Date.now(), n: 0 };
    await chrome.storage.local.set({ [key]: Object.assign({}, use, { seen: false, news: chrome.runtime.getManifest().version }) });
    // And a dot on the (i), until What's new is opened from it.
    await chrome.storage.local.set({ [WHATS_NEW]: chrome.runtime.getManifest().version });
  }
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || tab.discarded || !isSupported(tab.url)) continue;
    inject(tab.id).catch(() => {
      // Closed meanwhile, or a page scripts cannot run on.
    });
  }
});

// ---------- backups kept in this browser ----------

/* Edit flow and Edit journey keep the version a save replaces, in
 * chrome.storage.local: the 5 newest of each, none older than 14 days (the
 * editors trim them when they save). Trimmed here too when the browser starts
 * or DynaBoost is installed or updated, so old ones go even if the editor is
 * never opened again. A flow backup older than this rule kept the flow twice
 * (as text and as objects): only the text stays. */
const BACKUPS = ['dynaboost.flowBackups', 'dynaboost.journeyBackups'];
const BACKUPS_KEPT = 5;
const BACKUP_DAYS = 14;

async function trimBackups() {
  const data = await chrome.storage.local.get(BACKUPS);
  const cut = Date.now() - BACKUP_DAYS * 86400000;
  const out = {};
  for (const key of BACKUPS) {
    const list = data[key];
    if (!Array.isArray(list)) continue;
    const kept = list
      .filter((b) => b && Date.parse(b.savedAt) > cut)
      .slice(0, BACKUPS_KEPT)
      .map((b) => {
        if (typeof b.text !== 'string' || !('definition' in b || 'connectionReferences' in b)) return b;
        const c = Object.assign({}, b);
        delete c.definition;
        delete c.connectionReferences;
        return c;
      });
    if (JSON.stringify(kept) !== JSON.stringify(list)) out[key] = kept;
  }
  if (Object.keys(out).length) await chrome.storage.local.set(out);
}

chrome.runtime.onStartup.addListener(() => trimBackups().catch(() => {}));
chrome.runtime.onInstalled.addListener(() => trimBackups().catch(() => {}));

// ---------- another environment, for the compare tools ----------

/* Compare (env-compare.js) reads the other
 * environment in a tab of its own - one the user has open, or one opened in
 * the background for the moment and closed again - with the user's own
 * sign-in. Nothing is read across sites. The list of environments comes from
 * the maker portal - what its own answer held (names and addresses), read in
 * a make.powerapps.com tab the same way.
 * The page asks first (DynaBoost's own dialog) unless the user turned that
 * off; this only does what it was asked. */
const ENV_LIST_KEY = 'dynaboost.environments';
const MAKER = 'make.powerapps.com';

const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    return '';
  }
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function tabOnHost(host) {
  const tabs = await chrome.tabs.query({ url: 'https://' + host + '/*' });
  return tabs.find((t) => !t.discarded && t.status === 'complete') || tabs.find((t) => !t.discarded) || null;
}

// Loaded on the host itself: 'ok'. Held elsewhere - the sign-in page, whose
// address DynaBoost may not even see - for longer than a signed-in browser
// takes to pass it: 'signin'.
async function settle(tabId, host, ms) {
  const end = Date.now() + ms;
  let away = 0;
  while (Date.now() < end) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (e) {
      return 'closed';
    }
    const h = hostOf(tab.url || tab.pendingUrl);
    if (tab.status === 'complete' && h === host) return 'ok';
    if (tab.status === 'complete' && h !== host) {
      if (!away) away = Date.now();
      if (Date.now() - away > 9000) return 'signin';
    } else away = 0;
    await pause(300);
  }
  return 'timeout';
}

async function runIn(tabId, func, args) {
  await inject(tabId);
  const [r] = await chrome.scripting.executeScript({ target: { tabId: tabId }, func: func, args: args || [] });
  return r ? r.result : null;
}

const readHere = (req) =>
  window.DynaBoost && window.DynaBoost.envCompare ? window.DynaBoost.envCompare.read(req) : { error: 'DynaBoost is not ready in that tab.' };

/* One read in the other environment: { result } or { error: 'signin' |
 * 'unreachable' | message }. A tab opened here is closed again, whatever the
 * outcome. */
async function readEnvironment(host, req, opener) {
  let tab = await tabOnHost(host);
  let ours = false;
  try {
    if (!tab) {
      ours = true;
      tab = await chrome.tabs.create({ url: 'https://' + host + '/api/data/v9.2/', active: false, windowId: opener.windowId, index: opener.index + 1 });
      const state = await settle(tab.id, host, 30000);
      if (state === 'signin') return { error: 'signin' };
      if (state !== 'ok') return { error: 'unreachable' };
    }
    let result = await runIn(tab.id, readHere, [req]);
    // The Web API answered 401: the environment wants a sign-in - in a tab of
    // our own, go through it once, as opening the app would.
    if (result && /^HTTP 401\b/.test(result.error || '') && ours) {
      await chrome.tabs.update(tab.id, { url: 'https://' + host + '/main.aspx' });
      const state = await settle(tab.id, host, 30000);
      if (state !== 'ok') return { error: state === 'signin' ? 'signin' : 'unreachable' };
      result = await runIn(tab.id, readHere, [req]);
    }
    if (result && /^HTTP 40[13]\b/.test(result.error || '')) return { error: 'signin', detail: result.error };
    return result && result.error ? { error: result.error } : { result: result };
  } catch (e) {
    return { error: e.message };
  } finally {
    if (ours && tab) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

const listHere = (wait) =>
  window.DynaBoost && window.DynaBoost.envCompare ? window.DynaBoost.envCompare.environments(wait) : null;

/* The list of environments, read in a make.powerapps.com tab: the user's own
 * if one is open (unless `fresh`), else one opened in the background and
 * closed again. A tab opened before this DynaBoost has not seen the portal's
 * answer - { error: 'empty', open: true } then, and the page may ask for a
 * fresh one. The page can stop it (DB_ENV_CANCEL with the same job): its
 * background tab closes at once. */
const envJobs = new Map(); // sender tab id + ':' + job -> { tabId, cancelled }

async function refreshEnvironments(opener, job, fresh) {
  const key = opener.id + ':' + job;
  const state = { tabId: null, cancelled: false };
  envJobs.set(key, state);
  let tab = fresh ? null : await tabOnHost(MAKER);
  const ours = !tab;
  try {
    if (ours) {
      tab = await chrome.tabs.create({ url: 'https://' + MAKER + '/', active: false, windowId: opener.windowId, index: opener.index + 1 });
      state.tabId = tab.id;
      if (state.cancelled) return { error: 'cancelled' };
      const loaded = await settle(tab.id, MAKER, 30000);
      if (state.cancelled) return { error: 'cancelled' };
      if (loaded === 'signin') return { error: 'signin' };
      if (loaded !== 'ok') return { error: 'unreachable' };
    }
    // The portal reads its list a few seconds after it loads; an open tab has it already.
    const list = await runIn(tab.id, listHere, [ours ? 20000 : 3000]);
    if (state.cancelled) return { error: 'cancelled' };
    if (!list || !list.length) return { error: 'empty', open: !ours };
    const stored = { at: Date.now(), list: list };
    await chrome.storage.local.set({ [ENV_LIST_KEY]: stored });
    return { result: stored };
  } catch (e) {
    return { error: state.cancelled ? 'cancelled' : e.message };
  } finally {
    envJobs.delete(key);
    if (ours && tab) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function cancelEnvJob(opener, job) {
  const state = envJobs.get(opener.id + ':' + job);
  if (!state) return;
  state.cancelled = true;
  if (state.tabId) chrome.tabs.remove(state.tabId).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || !sender.tab || !/^DB_ENV_/.test(msg.type || '')) return;
  const host = String(msg.host || '').toLowerCase();
  if (msg.host !== undefined && !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.dynamics\.com$/.test(host)) {
    reply({ error: 'Not a Dynamics 365 address.' });
    return;
  }
  if (msg.type === 'DB_ENV_SOURCES') {
    // The open Dynamics tabs (their hosts) and the list kept from the maker portal.
    Promise.all([chrome.tabs.query({ url: 'https://*.dynamics.com/*' }), chrome.storage.local.get(ENV_LIST_KEY), tabOnHost(MAKER)])
      .then(([tabs, d, maker]) => {
        const open = Array.from(new Set(tabs.map((t) => hostOf(t.url)).filter((h) => /\.dynamics\.com$/.test(h))));
        reply({ open: open, stored: d[ENV_LIST_KEY] || null, maker: !!maker });
      })
      .catch((e) => reply({ error: e.message }));
    return true;
  }
  if (msg.type === 'DB_ENV_READ') {
    readEnvironment(host, msg.req, sender.tab).then(reply);
    return true;
  }
  if (msg.type === 'DB_ENV_REFRESH') {
    refreshEnvironments(sender.tab, String(msg.job || ''), !!msg.fresh).then(reply);
    return true;
  }
  if (msg.type === 'DB_ENV_CANCEL') {
    cancelEnvJob(sender.tab, String(msg.job || ''));
    return;
  }
});

// ---------- Edit flow: a solution flow's draft, in its Dynamics tab ----------

/* A solution flow's draft lives in Dataverse. The Power Automate page can
 * reach it only once its designer has; this reads it - and publishes it -
 * in a tab of the flow's own environment instead, with the sign-in that tab
 * has: one open, or one opened in the background for a moment and closed
 * again (noOpen: only an open one). Asked only by Edit flow's page. */
async function dvFlowHere(op, id, on) {
  const api = location.origin + '/api/data/v9.2/';
  const call = async (method, path, body, extra) => {
    const res = await fetch(api + path, {
      method: method,
      credentials: 'same-origin',
      headers: Object.assign({ Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' }, body ? { 'Content-Type': 'application/json' } : {}, extra || {}),
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      /* not JSON */
    }
    if (!res.ok) throw Object.assign(new Error((data && data.error && data.error.message) || 'HTTP ' + res.status), { status: res.status });
    return data;
  };
  try {
    if (op === 'publish') {
      await call('POST', 'PublishComponent?ActivateFlowOnPublish=' + (on ? 'true' : 'false'), { Target: '/workflows(' + id + ')' });
      return { ok: true };
    }
    const path = 'workflows(' + id + ')?$select=name,clientdata,statecode,modifiedon,componentstate';
    const latest = await call('GET', path, null, { 'MSCRM.IncludeUnpublished': 'true' });
    let published = null;
    try {
      published = await call('GET', path);
    } catch (e) {
      if (e.status !== 404 && e.status !== 400) throw e;
    }
    let p = {};
    try {
      p = (JSON.parse(latest.clientdata || 'null') || {}).properties || {};
    } catch (e) {
      /* not JSON */
    }
    return {
      available: true,
      published: !!published,
      // An unpublished row (componentstate 1) is a draft even when its content matches.
      hasDraft: !(published && published.clientdata === latest.clientdata && latest.componentstate !== 1),
      name: latest.name || '',
      on: latest.statecode === 1,
      modified: latest.modifiedon || '',
      definition: p.definition || null,
      connectionReferences: p.connectionReferences || {}
    };
  } catch (e) {
    return { error: e.message, status: e.status || 0 };
  }
}

async function dvFlow(host, op, id, on, opener, noOpen) {
  let tab = await tabOnHost(host);
  let ours = false;
  const run = async () => {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: dvFlowHere, args: [op, id, !!on] });
    return r ? r.result : { error: 'No answer from the ' + host + ' tab.' };
  };
  try {
    if (!tab) {
      if (noOpen) return { error: 'no-tab' };
      ours = true;
      tab = await chrome.tabs.create({ url: 'https://' + host + '/api/data/v9.2/', active: false, windowId: opener.windowId, index: opener.index + 1 });
      const state = await settle(tab.id, host, 30000);
      if (state !== 'ok') return { error: state === 'signin' ? 'signin' : 'unreachable' };
    }
    let r = await run();
    // 401: the environment wants a sign-in - in a tab of our own, go through
    // it once, as opening the app would.
    if (r && r.status === 401 && ours) {
      await chrome.tabs.update(tab.id, { url: 'https://' + host + '/main.aspx' });
      const state = await settle(tab.id, host, 30000);
      if (state !== 'ok') return { error: state === 'signin' ? 'signin' : 'unreachable' };
      r = await run();
    }
    if (r && r.status === 401) return { error: 'signin' };
    return r;
  } catch (e) {
    return { error: e.message };
  } finally {
    if (ours && tab) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== 'DB_DV_FLOW') return;
  // Only DynaBoost's own Edit flow page, about a flow and a Dynamics host.
  const host = String(msg.host || '').toLowerCase();
  const ok =
    sender.id === chrome.runtime.id &&
    String(sender.url || '').startsWith(chrome.runtime.getURL('src/flow-editor.html')) &&
    sender.tab &&
    /^[a-z0-9-]+(\.[a-z0-9-]+)*\.dynamics\.com$/.test(host) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(msg.id || '')) &&
    (msg.op === 'draft' || msg.op === 'publish');
  if (!ok) {
    reply({ error: 'Not allowed.' });
    return;
  }
  dvFlow(host, msg.op, String(msg.id).toLowerCase(), !!msg.on, sender.tab, !!msg.noOpen).then(reply);
  return true;
});

// ---------- clipboard read for content scripts ----------

const OFFSCREEN = 'src/offscreen.html';

async function readClipboard() {
  const url = chrome.runtime.getURL(OFFSCREEN);
  const open = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
  if (!open.length) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN,
      reasons: ['CLIPBOARD'],
      justification: 'Read the YAML the user copied from Power Apps Studio, on their click'
    });
  }
  return chrome.runtime.sendMessage({ type: 'DB_OFFSCREEN_READ_CLIPBOARD' });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== 'DB_READ_CLIPBOARD' || !sender.tab) return;
  readClipboard().then(
    (r) => reply(r || { ok: false, text: '' }),
    (e) => reply({ ok: false, text: '', error: String(e && e.message) })
  );
  return true;
});

// Edit flow's editor is an extension page next to the flow's tab, so
// reloading that tab does not close it.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'DB_OPEN_FLOW_EDITOR' || !sender.tab) return;
  const url =
    chrome.runtime.getURL('src/flow-editor.html') +
    '?env=' + encodeURIComponent(msg.env || '') +
    '&flow=' + encodeURIComponent(msg.flow || '') +
    '&tab=' + sender.tab.id +
    (sender.tab.incognito ? '&incognito=1' : '') +
    (msg.dark ? '&theme=dark' : '');
  // An extension page cannot open in an incognito window (spanning mode):
  // Chrome puts it in a regular window instead - but not when it is tied to
  // the incognito tab as its opener, which makes it refuse the whole call.
  if (sender.tab.incognito) chrome.tabs.create({ url: url });
  else chrome.tabs.create({ url: url, index: sender.tab.index + 1, openerTabId: sender.tab.id });
});

// The (i) in the panel: the help page next to this tab. The first one of a
// version - after DynaBoost is installed or updated - opens at the top, read
// once; the next ones, after a browser restart too, at the section of the
// page they come from.
const HELP_OPENED = 'dynaboost.helpOpened'; // the version the help was last opened in

// Set on an update (onInstalled): the (i) wears a dot and opens What's new.
const WHATS_NEW = 'dynaboost.whatsNew';

async function newsDue() {
  try {
    if (!(await chrome.storage.local.get(WHATS_NEW))[WHATS_NEW]) return false;
    await chrome.storage.local.remove(WHATS_NEW);
    return true;
  } catch (e) {
    return false;
  }
}

async function firstHelp() {
  try {
    const version = chrome.runtime.getManifest().version;
    if ((await chrome.storage.local.get(HELP_OPENED))[HELP_OPENED] === version) return false;
    await chrome.storage.local.set({ [HELP_OPENED]: version });
    return true;
  } catch (e) {
    return false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'DB_OPEN_HELP' || !sender.tab) return;
  const here = (Array.isArray(msg.here) ? msg.here : []).filter((id) => /^[a-z0-9-]{1,40}$/.test(id)).slice(0, 40);
  Promise.all([firstHelp(), newsDue()]).then(([first, news]) => {
    const url =
      chrome.runtime.getURL('src/help.html') +
      '?here=' + here.join(',') +
      (msg.dark ? '&theme=dark' : '') +
      // The kind of page, for Report a bug: "Dynamics 365 · Record".
      (/^[A-Za-z0-9 ·]{1,40}$/.test(msg.page || '') ? '&page=' + encodeURIComponent(msg.page) : '') +
      (news ? '&news=1' : first ? '&top=1' : '');
    chrome.tabs.create({ url: url, index: sender.tab.index + 1 });
  });
});

// make.powerapps.com shows a solution's cloud flow in a frame from
// make.powerautomate.com. The frame reports which tiles work in it and the
// page's panel runs them through here - a page script cannot send these.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || !sender.tab) return;
  const tabId = sender.tab.id;
  const fromFrame = sender.frameId > 0;
  if (msg.type === 'DB_FRAME_HERE' && fromFrame) {
    chrome.tabs
      .sendMessage(tabId, { type: 'DB_FRAME_HERE', ids: msg.ids || [], frameId: sender.frameId }, { frameId: 0 })
      .catch(() => {});
    return;
  }
  if (msg.type === 'DB_FRAME_PING' && !fromFrame) {
    chrome.tabs.sendMessage(tabId, { type: 'DB_FRAME_PING' }).catch(() => {});
    return;
  }
  if ((msg.type === 'DB_FRAME_RUN' || msg.type === 'DB_FRAME_ASK') && !fromFrame && msg.frameId > 0) {
    chrome.tabs
      .sendMessage(tabId, { type: msg.type, id: msg.id, op: msg.op, payload: msg.payload }, { frameId: msg.frameId })
      .then(
        (r) => reply(r),
        (e) => reply({ error: String((e && e.message) || e) })
      );
    return true;
  }
});

// Fallback for flow frames that have not reported in when the panel opens:
// inject DynaBoost into them from here.
const FRAME_SCRIPT = chrome.runtime
  .getManifest()
  .content_scripts.find((c) => c.all_frames && !c.world && c.matches.some((m) => m.indexOf('/widgets/') >= 0));
const FLOW_WIDGET = /^https:\/\/make\.powerautomate\.com\/(?:[^/?#]+\/)?widgets\//i;

async function injectFlowFrames(tabId) {
  const seen = await chrome.scripting.executeScript({
    target: { tabId: tabId, allFrames: true },
    func: () => ({ url: location.href, loaded: !!(window.DynaBoost && window.DynaBoost.register) })
  });
  const flows = seen.filter((r) => r.frameId > 0 && r.result && FLOW_WIDGET.test(r.result.url));
  const frameIds = flows.filter((r) => !r.result.loaded).map((r) => r.frameId);
  if (!frameIds.length) return { present: flows.length };
  const target = { tabId: tabId, frameIds: frameIds };
  await chrome.scripting.executeScript({ target: target, files: ['src/features/flow-edit-hook.js'], world: 'MAIN' });
  if (FRAME_SCRIPT.css && FRAME_SCRIPT.css.length) await chrome.scripting.insertCSS({ target: target, files: FRAME_SCRIPT.css });
  await chrome.scripting.executeScript({ target: target, files: FRAME_SCRIPT.js });
  return { injected: frameIds.length, present: flows.length };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== 'DB_FRAME_INJECT' || !sender.tab || sender.frameId) return;
  injectFlowFrames(sender.tab.id).then(
    (r) => reply(r),
    (e) => reply({ error: String((e && e.message) || e) })
  );
  return true;
});

// Apply to Studio: bring the Studio tab to the front first - a background
// tab does not render menus.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== 'DB_FOCUS_SENDER_TAB' || !sender.tab) return;
  chrome.tabs.update(sender.tab.id, { active: true }).then(
    () => chrome.windows.update(sender.tab.windowId, { focused: true }),
    () => {}
  ).then(() => reply(true), () => reply(false));
  return true;
});

// ---------- Time saved ----------

/* What one use of a tool saves, in seconds - the owner's numbers. A tool
 * that is not here (or is at 0) is not counted; a new tool gets its number
 * from the owner (kept on the conservative side). 'tool:action' is one action of a tool with its own time
 * (DynaBoost.saved('journey', 'save')). Each use adds its time to
 * dynaboost.saved:
 *   { since, total, n, tools: { id: [uses, seconds] }, months: { 'YYYY-MM': seconds } }
 * The tools say when a use happened (DynaBoost.saved(id)); here the uses
 * are added up and written once a second at most, one write at a time, so
 * tabs counting at once do not overwrite each other. */
const SAVED = {
  'solution-pins': 30,
  'table-export': 120,
  'open-all': 2,
  'auto-advanced': 2,
  'column-defaults': 2,
  'classic-open': 60,
  'canvas-code': 900,
  'canvas-tree': 30,
  'flow-edit': 2700,
  'flow-run-export': 900,
  'flow-run-export:record': 10,
  'expand-all': 30,
  'form-dump': 900,
  'compare:form': 1800,
  'compare:record': 300,
  'form-editor': 60,
  'table-open': 60,
  'view-editor': 60,
  'logical-names': 30,
  'copy-record': 30,
  impersonate: 120,
  'advanced-find': 30,
  'system-jobs': 30,
  workflow: 120,
  'workflow:save': 900,
  'journey:copy': 300,
  'journey:save': 1800,
  'ado-workitem': 30,
  'ado-taskboard-expand': 30,
  'wiki-expand': 30
};
const SAVED_KEY = 'dynaboost.saved';
let savedQueue = Object.create(null);
let savedTimer = 0;
let savedChain = Promise.resolve();

async function writeSaved() {
  const queue = savedQueue;
  savedQueue = Object.create(null);
  const d = (await chrome.storage.local.get(SAVED_KEY))[SAVED_KEY];
  const now = new Date();
  const s = d && typeof d === 'object' && d.tools ? d : { since: now.getTime(), total: 0, n: 0, tools: {}, months: {} };
  const month = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  for (const id in queue) {
    const uses = queue[id];
    const secs = uses * SAVED[id];
    const t = s.tools[id] || [0, 0];
    s.tools[id] = [t[0] + uses, t[1] + secs];
    s.months[month] = (s.months[month] || 0) + secs;
    s.total += secs;
    s.n += uses;
  }
  await chrome.storage.local.set({ [SAVED_KEY]: s });
}

function countSaved(id) {
  if (!Object.prototype.hasOwnProperty.call(SAVED, id) || !(SAVED[id] > 0)) return;
  savedQueue[id] = (savedQueue[id] || 0) + 1;
  if (savedTimer) return;
  savedTimer = setTimeout(() => {
    savedTimer = 0;
    savedChain = savedChain.then(writeSaved).catch(() => {});
  }, 1000);
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'DB_SAVED' || sender.id !== chrome.runtime.id) return;
  countSaved(String(msg.id || '') + (msg.what ? ':' + String(msg.what) : ''));
});

// ---------- Impersonate ----------

/* A session rule per tab (rule id = tab id) adds MSCRMCallerID to the
 * requests the environment's own pages make to it. Dataverse honours it for
 * a caller with the Act on Behalf of Another User privilege. Other tabs and
 * other sites in the same tab are not affected; the rule goes when stopped
 * or when the tab closes. The label's data is kept in storage.session. */
const IMP_KEY = 'dynaboost.imp.';
const IMP_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMP_ORG = /^[a-z0-9-]+\.crm\d*\.dynamics\.com$/i;

async function impGet(tabId) {
  const key = IMP_KEY + tabId;
  return (await chrome.storage.session.get(key))[key] || null;
}

async function impSet(tabId, imp) {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tabId],
    addRules: imp
      ? [
          {
            id: tabId,
            priority: 1,
            action: { type: 'modifyHeaders', requestHeaders: [{ header: 'MSCRMCallerID', operation: 'set', value: imp.id }] },
            condition: { tabIds: [tabId], requestDomains: [imp.host], initiatorDomains: [imp.host], resourceTypes: ['xmlhttprequest'] }
          }
        ]
      : []
  });
  if (imp) await chrome.storage.session.set({ [IMP_KEY + tabId]: imp });
  else await chrome.storage.session.remove(IMP_KEY + tabId);
}

// Only what the label needs, and only for the org the tab is on.
function impClean(user, host) {
  if (!user || !IMP_GUID.test(user.id || '') || !IMP_ORG.test(host)) return null;
  const text = (v, n) => String(v || '').slice(0, n);
  return { host: host, id: user.id.toLowerCase(), name: text(user.name, 160), email: text(user.email, 200), bu: text(user.bu, 160), reflects: !!user.reflects };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || !sender.tab || sender.frameId) return;
  const tabId = sender.tab.id;
  if (msg.type === 'DB_IMP_GET') {
    impGet(tabId).then(reply, () => reply(null));
    return true;
  }
  if (msg.type === 'DB_IMP_SET') {
    let host = '';
    try {
      host = new URL(sender.url).hostname.toLowerCase();
    } catch (e) {
      /* no page, no rule */
    }
    const imp = msg.user ? impClean(msg.user, host) : null;
    if (msg.user && !imp) {
      reply({ error: 'Not a user of this environment.' });
      return;
    }
    impSet(tabId, imp).then(
      () => reply({ ok: true }),
      (e) => reply({ error: String((e && e.message) || e) })
    );
    return true;
  }
});

// A tab opened from an impersonating tab works as the same user.
chrome.tabs.onCreated.addListener(async (tab) => {
  if (!tab.openerTabId) return;
  const imp = await impGet(tab.openerTabId);
  if (imp) await impSet(tab.id, imp);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (await impGet(tabId)) await impSet(tabId, null);
});
