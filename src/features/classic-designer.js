/* Feature: Open in classic - the classic solution explorer for the solution
 * you are in (.../solutions/{sol}/...). Not a table: manageentity.aspx shows
 * one table with no way to another.
 *
 * The maker URL carries only the environment id, so the org host is read from
 * the maker's environment list or asked once, and kept in chrome.storage.sync
 * per environment. */
(function () {
  if (DynaBoost.off) return;
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

  /* The maker's environment list in localStorage ("shell-local-storage-cache:...")
   * holds each environment id with its org URL a little further on: take the
   * first *.dynamics.com host after the id, before the next environment starts.
   * An internal format - the prompt stays as the fallback. */
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
    DynaBoost.saved('classic-open');
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
    hint: 'This solution in the classic solution explorer',
    icon: ICON,
    onRun: run
  });
})();
