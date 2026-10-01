/* Feature: System jobs - the environment's asyncoperation list, view "All
 * System Jobs", in a new tab. In make.powerapps.com the org host comes from
 * DynaBoost.orgHost. */
(function () {
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M4 6h9M4 11h7M4 16h5" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
    '<circle cx="16.5" cy="15.5" r="4.5" stroke="#E3B04B" stroke-width="1.6"/>' +
    '<path d="M16.5 13v2.5l1.6 1" stroke="#E3B04B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  // "All System Jobs" - a view that ships with Dataverse, the same id everywhere.
  const VIEW = '396c49c7-f7f5-4612-b8e6-846a4d813293';

  const onOrg = () => /\.dynamics\.com$/i.test(location.hostname);
  const inEnvironment = () => /\/environments\/[0-9a-f-]{36}/i.test(location.pathname);

  async function run() {
    let host = onOrg() ? location.hostname : null;
    if (!host) {
      if (!DynaBoost.orgHost) return;
      host = await DynaBoost.orgHost(DynaBoost.envIdFromUrl());
    }
    if (!host) return;
    window.open(
      'https://' + host + '/main.aspx?forceUCI=1&pagetype=entitylist&etn=asyncoperation&viewid=' + VIEW + '&viewType=1039',
      '_blank',
      'noopener'
    );
  }

  DynaBoost.register({
    id: 'system-jobs',
    name: 'System jobs',
    group: 'Navigation',
    hosts: ['dynamics.com', 'make.powerapps.com'],
    when: () => onOrg() || inEnvironment(),
    type: 'action',
    hint: 'System Jobs in a new tab',
    icon: ICON,
    onRun: run
  });
})();
