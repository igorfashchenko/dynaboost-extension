/* Feature: Advanced Find.
 *
 * An action tile that opens the classic Advanced Find of the environment you
 * are in, in a new tab: https://{org}/main.aspx?pagetype=advancedfind.
 *
 * Where it shows: in the model-driven apps (*.dynamics.com), where the org is
 * the page's own host, and in make.powerapps.com inside an environment, where
 * the URL carries only the environment id. There the org's host comes the way
 * Open in classic finds it (classic-designer.js, DynaBoost.orgHost): the one
 * remembered for that environment, else the maker's own environment list, else
 * a one-time question - and it is remembered for both tiles.
 */
(function () {
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<circle cx="10.5" cy="10.5" r="6" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="m15 15 5 5" stroke="#3D8BFF" stroke-width="1.8" stroke-linecap="round"/>' +
    '<path d="M7.5 8.5h6l-2.3 2.6v2.4l-1.4.8v-3.2z" stroke="#E3B04B" stroke-width="1.3" stroke-linejoin="round"/>' +
    '</svg>';

  const onOrg = () => /\.dynamics\.com$/i.test(location.hostname);
  const inEnvironment = () => /\/environments\/[0-9a-f-]{36}/i.test(location.pathname);

  async function run() {
    let host = onOrg() ? location.hostname : null;
    if (!host) {
      if (!DynaBoost.orgHost) return;
      host = await DynaBoost.orgHost(DynaBoost.envIdFromUrl());
    }
    if (!host) return;
    window.open('https://' + host + '/main.aspx?pagetype=advancedfind', '_blank', 'noopener');
  }

  DynaBoost.register({
    id: 'advanced-find',
    name: 'Advanced Find',
    group: 'Navigation',
    hosts: ['dynamics.com', 'make.powerapps.com'],
    when: () => onOrg() || inEnvironment(),
    type: 'action',
    hint: 'Opens the classic Advanced Find of this environment in a new tab',
    icon: ICON,
    onRun: run
  });
})();
