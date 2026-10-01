/* Feature: Edit form. Opens the open form in the maker's form designer,
 * /e/{environment}/s/{solution}/entity/{table}/form/edit/{form}, in the
 * unmanaged solution that holds it (the one pinned in My solutions when there
 * are several; the Default Solution last). The tab is opened on the click and
 * pointed at the designer once known - after an await it would be a pop-up.
 */
(function () {
  if (DynaBoost.off) return;
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="3" y="3" width="14" height="18" rx="2" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M6.5 8h7M6.5 12h4" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="m13.5 18.5.6-2.8 5.6-5.6a1.4 1.4 0 0 1 2 2l-5.6 5.6z" stroke="#E3B04B" stroke-width="1.5" stroke-linejoin="round"/>' +
    '</svg>';

  const DEFAULT_SOLUTION = 'fd140aaf-4df4-11dd-bd17-0019b9312238';

  const PINS_KEY = 'dynaboost.solutionPins'; // My solutions (solution-pins.js)
  const SYSTEM_FORM = 60; // solution component type

  const clean = (g) => String(g || '').replace(/[{}]/g, '').toLowerCase();

  async function getJson(path) {
    const res = await fetch('/api/data/v9.2/' + path, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'OData-Version': '4.0' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function environmentId() {
    try {
      const r = await getJson("RetrieveCurrentOrganization(AccessType=@p)?@p=Microsoft.Dynamics.CRM.EndpointAccessType'Default'");
      return (r.Detail && r.Detail.EnvironmentId) || null;
    } catch (e) {
      return null;
    }
  }

  // The unmanaged solution of yours the form is in, if it can be told.
  async function formSolution(formId, envId) {
    let own;
    try {
      const r = await getJson(
        'solutioncomponents?$select=componenttype&$filter=objectid eq ' + formId + ' and componenttype eq ' + SYSTEM_FORM +
          '&$expand=solutionid($select=solutionid,uniquename,ismanaged,isvisible)'
      );
      own = (r.value || [])
        .map((c) => c.solutionid)
        .filter((s) => s && !s.ismanaged && s.isvisible !== false && s.uniquename !== 'Default' && s.uniquename !== 'Active')
        .map((s) => clean(s.solutionid));
    } catch (e) {
      return null;
    }
    own = Array.from(new Set(own));
    if (own.length <= 1) return own[0] || null;
    const pins = await new Promise((resolve) => chrome.storage.sync.get(PINS_KEY, (d) => resolve((d && d[PINS_KEY]) || [])));
    const pinned = own.filter((id) => pins.some((p) => p && String(p.env).toLowerCase() === envId && p.sol === id));
    return pinned.length === 1 ? pinned[0] : null;
  }

  async function run() {
    const tab = window.open('', '_blank');
    if (!tab) {
      window.alert('The tab was blocked. Allow pop-ups for this site and try again.');
      return;
    }
    tab.document.write(
      '<!doctype html><meta charset="utf-8"><title>Opening the form designer…</title>' +
        '<body style="font:14px/1.5 \'Segoe UI\',system-ui,sans-serif;padding:24px;color:var(--dbc-fg-10224e)">Opening the form designer…'
    );
    DynaBoost.themeTab(tab);
    const ctx = DynaBoost.formContext ? await DynaBoost.formContext() : null;
    const envId = (ctx && ctx.envId) || (await environmentId());
    const why = !ctx || !ctx.entity ? 'No record form on this page.' : !ctx.formId ? 'The page does not say which form is open.' : !envId ? 'The environment id could not be read.' : '';
    if (why) {
      tab.close();
      window.alert('Could not open the form designer. ' + why);
      return;
    }
    const solution = (await formSolution(clean(ctx.formId), clean(envId))) || DEFAULT_SOLUTION;
    tab.location.replace(
      'https://make.powerapps.com/e/' + clean(envId) + '/s/' + solution + '/entity/' + encodeURIComponent(ctx.entity) + '/form/edit/' + clean(ctx.formId)
    );
  }

  DynaBoost.register({
    id: 'form-editor',
    name: 'Edit form',
    group: 'Records',
    hosts: ['dynamics.com'],
    when: () => new URLSearchParams(location.search).get('pagetype') === 'entityrecord',
    type: 'action',
    hint: 'Opens the form you are looking at in the form designer of make.powerapps.com, in the solution of yours it is in',
    icon: ICON,
    onRun: run
  });
})();
