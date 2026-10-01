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
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || tab.discarded || !isSupported(tab.url)) continue;
    inject(tab.id).catch(() => {
      // Closed meanwhile, or a page scripts cannot run on.
    });
  }
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
    (msg.dark ? '&theme=dark' : '');
  chrome.tabs.create({ url: url, index: sender.tab.index + 1, openerTabId: sender.tab.id });
});

// The (i) in the panel: the help page next to this tab.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'DB_OPEN_HELP' || !sender.tab) return;
  const here = (Array.isArray(msg.here) ? msg.here : []).filter((id) => /^[a-z0-9-]{1,40}$/.test(id)).slice(0, 40);
  const url =
    chrome.runtime.getURL('src/help.html') +
    '?here=' + here.join(',') +
    (msg.dark ? '&theme=dark' : '');
  chrome.tabs.create({ url: url, index: sender.tab.index + 1 });
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
