/* Feature: Open in classic.
 *
 * An action tile: opens the classic solution explorer for the solution you are
 * currently in, so you land in the right solution context instead of the
 * generic root.
 *
 *   .../solutions/{sol}/...   -> that solution
 *   anything else             -> a message, nothing opens
 *
 * It deliberately does NOT deep-link to a table. manageentity.aspx only ever
 * renders that one table's tree (Forms, Views, Fields...), with no way to jump
 * to another table - and the classic explorer offers no URL parameter for
 * pre-selecting a node in the tree. The root keeps navigation intact.
 *
 * The maker URL never carries the org host (only the environment GUID), so the
 * first time you use this in a new environment we ask for it once and remember
 * it in chrome.storage.sync, keyed by environment id. That also covers other
 * geos - crm4 is EMEA, crm is NA, crm5 APAC and so on.
 */
(function () {
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M13 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="M14.5 9.5 20 4m0 0h-4.5M20 4v4.5" stroke="#E3B04B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  const HOSTS_KEY = 'dynaboost.orgHosts'; // envId -> host

  const GUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

  function matchGuid(pattern) {
    const m = location.pathname.match(new RegExp(pattern.replace('{guid}', '(' + GUID + ')'), 'i'));
    return m ? m[1].toLowerCase() : null;
  }

  function readContext() {
    return {
      envId: matchGuid('/environments/{guid}'),
      solutionId: matchGuid('/solutions/{guid}')
    };
  }

  function getHosts() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(HOSTS_KEY, (data) => resolve((data && data[HOSTS_KEY]) || {}));
    });
  }

  function saveHost(envId, host) {
    return getHosts().then((hosts) => {
      hosts[envId] = host;
      return new Promise((resolve) => {
        chrome.storage.sync.set({ [HOSTS_KEY]: hosts }, resolve);
      });
    });
  }

  // Accepts a full URL or a bare host, returns the bare host or null.
  function normaliseHost(input) {
    if (!input) return null;
    let s = input.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    if (!/^[a-z0-9-]+\.[a-z0-9.-]*dynamics\.com$/i.test(s)) return null;
    return s.toLowerCase();
  }

  const CRM_HOST_RE = /https?:\/\/([a-z0-9-]+\.crm[0-9]*\.dynamics\.com)/i;

  /* The maker keeps the full environment list in localStorage under
   * "shell-local-storage-cache:...", each entry holding the environment id and,
   * a little further along, the org URL. We locate the id and take the first
   * *.dynamics.com host that follows it, stopping before the next environment
   * begins so we cannot pick up a neighbour's address.
   *
   * This is an undocumented internal format and may vanish with any maker
   * update - hence the prompt below stays as the fallback. */
  function hostFromMakerCache(envId) {
    if (!envId) return null;
    let store;
    try {
      store = window.localStorage;
    } catch (e) {
      return null;
    }
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key || key.indexOf('shell-local-storage-cache') === -1) continue;

      let val;
      try {
        val = store.getItem(key) || '';
      } catch (e) {
        continue;
      }

      const at = val.toLowerCase().indexOf(envId);
      if (at === -1) continue;

      let chunk = val.slice(at, at + 8000);
      const nextEnv = chunk.indexOf('/providers/Microsoft.PowerApps/environments/');
      if (nextEnv > 0) chunk = chunk.slice(0, nextEnv);

      const m = chunk.match(CRM_HOST_RE);
      if (m) return m[1].toLowerCase();
    }
    return null;
  }

  async function resolveHost(envId) {
    // On an org page we already know the host, so nothing to ask.
    if (/\.dynamics\.com$/i.test(location.hostname)) return location.hostname;

    const hosts = await getHosts();
    if (envId && hosts[envId]) return hosts[envId];

    const cached = hostFromMakerCache(envId);
    if (cached) {
      if (envId) await saveHost(envId, cached);
      return cached;
    }

    const answer = window.prompt(
      'Which org does this environment belong to?\n\n' +
        'Paste the org URL, e.g. https://yourorg.crm4.dynamics.com\n' +
        'DynaBoost remembers it for this environment.'
    );
    const host = normaliseHost(answer);
    if (!host) {
      if (answer !== null) window.alert('That does not look like a *.dynamics.com address.');
      return null;
    }
    if (envId) await saveHost(envId, host);
    return host;
  }

  function wrap(guid) {
    return '%7B' + guid + '%7D';
  }

  function buildUrl(host, solutionId) {
    return 'https://' + host + '/tools/solution/edit.aspx?id=' + wrap(solutionId);
  }

  async function run() {
    const ctx = readContext();
    if (!ctx.solutionId) {
      window.alert('Open a solution first — this page has no classic equivalent.');
      return;
    }

    const host = await resolveHost(ctx.envId);
    if (!host) return;

    window.open(buildUrl(host, ctx.solutionId), '_blank', 'noopener');
  }

  // Other tiles that open a classic page of the org (Advanced Find) ask for
  // its host the same way, and remember it in the same place.
  DynaBoost.orgHost = resolveHost;
  DynaBoost.envIdFromUrl = () => readContext().envId;

  DynaBoost.register({
    id: 'classic-open',
    name: 'Open in classic',
    group: 'Navigation',
    hosts: ['make.powerapps.com'],
    when: () => new RegExp('/solutions/' + GUID, 'i').test(location.pathname),
    type: 'action',
    hint: 'Opens the solution — or the table you are in — in the classic solution explorer',
    icon: ICON,
    onRun: run
  });
})();
