/* The panel is injected by the manifest on every supported page. This list
 * is only the repair path for tabs that were already open when the extension
 * was installed or reloaded - Chrome does not inject into those.
 *
 * It is read from the manifest rather than written out again, because the two
 * copies used to drift: a feature added to one list and not the other loads
 * for nobody (or for almost nobody, which is worse - it works right after a
 * reload and vanishes on the next page load). One list, one place to edit. */
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

async function openPanel(tab) {
  if (!tab.id || !isSupported(tab.url)) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'DB_TOGGLE_PANEL' });
  } catch (e) {
    // The content scripts aren't there yet — most commonly because this tab was
    // already open before the extension was installed or reloaded (Chrome does
    // not re-inject into existing tabs). Inject and retry once, so a page
    // refresh isn't needed after every update.
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: CSS });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: FILES });
      await chrome.tabs.sendMessage(tab.id, { type: 'DB_TOGGLE_PANEL' });
    } catch (e2) {
      // Nothing more to do (the tab closed mid-flight, or a chrome:// page
      // slipped through) — fail quietly.
    }
  }
}

chrome.action.onClicked.addListener(openPanel);

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

// Edit flow opens its editor - a page of the extension - next to the flow's
// tab. The page is not tied to that tab: it asks any Power Automate tab
// through flow-edit.js, so reloading the flow to test a save leaves it working.
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

// The (i) in the panel: the help page in a new tab next to this one, at
// the tools of the page the panel was on, in the panel's light or dark.
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
// make.powerautomate.com. DynaBoost in that frame and the panel of the page
// around it talk through here: the frame says which tiles work in it, the
// panel asks it to run them. Only the extension's own scripts can send
// these, so a page cannot start a feature.
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

// The repair path for the flow frame: the manifest puts DynaBoost into it,
// but when the frame has not reported in by the time the panel opens (seen
// in Edge, with access to the site granted), put it in from here - into
// those frames of the tab that show a flow widget and have no DynaBoost yet.
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

// Apply to Studio runs in the Studio tab, which is in the background while
// the editor tab is in front - and a background tab does not render menus.
// Bring it forward first.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== 'DB_FOCUS_SENDER_TAB' || !sender.tab) return;
  chrome.tabs.update(sender.tab.id, { active: true }).then(
    () => chrome.windows.update(sender.tab.windowId, { focused: true }),
    () => {}
  ).then(() => reply(true), () => reply(false));
  return true;
});

// ---------- Impersonate ----------

/* A tab working as another user: every request its environment's own pages
 * make to it carries MSCRMCallerID with that user's id, which Dataverse
 * honours for a caller who has the Act on Behalf of Another User privilege.
 * One session rule per tab, its id the tab's id: other tabs stay you - and
 * so does another site in the same tab, such as the maker portal calling
 * the same environment - the rule goes when it is stopped or the tab
 * closes, and none outlives the browser. Who it is - for the page's label - is kept beside it in
 * storage.session, which only the extension itself can read. */
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

// A tab opened from one working as a user - a record opened in a new tab or
// window - works as that user too.
chrome.tabs.onCreated.addListener(async (tab) => {
  if (!tab.openerTabId) return;
  const imp = await impGet(tab.openerTabId);
  if (imp) await impSet(tab.id, imp);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (await impGet(tabId)) await impSet(tabId, null);
});
