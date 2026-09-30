# DynaBoost

A Chrome / Edge extension for people who build and maintain Power Platform
solutions: small tools for the Power Apps maker portal and Studio, Power
Automate, Dynamics 365 model-driven apps and Azure DevOps. The toolbar icon
opens a panel, and the same icon closes it. Nothing else is added to the page.
Every tool is a tile.

**For users:** every tool - where it works, what it does, its limits and
shortcuts - is described in the in-app help. The **(i)** in the panel's header
opens it (`src/help.html`), at the tools of the page you are on.

## Tools

| Tile | Type | Where | How it works |
| --- | --- | --- | --- |
| Export table | action | maker portal lists | Scrolls the biggest grid on the page to collect every row; Markdown or CSV in a dialog |
| Open on All | toggle, on by default | Tables and Apps pages | Clicks "All" once per visit (per path), only in a row of tabs holding a known neighbour ("Recommended"/"Custom", "My apps"/"Shared with me"); labels in 7 UI languages; elsewhere a DOM change costs one path test |
| Open column details | toggle, on by default | New / Edit column panel | Clicks "Advanced options"; labels in 7 UI languages |
| Open in classic | action | inside a solution | Classic solution explorer on that solution; the org host per environment in `chrome.storage.sync` (`DynaBoost.orgHost`, shared with Advanced Find) |
| Advanced Find | action | Dynamics apps; maker portal in an environment | `https://{org}/main.aspx?pagetype=advancedfind` |
| System jobs | action | Dynamics apps; maker portal in an environment | `asyncoperation`, view "All System Jobs" |
| My solutions | panel section | every site | Up to 6 shortcuts (3, then 3 more); one per solution, matched by environment + solution id; `chrome.storage.sync`, fold state in `chrome.storage.local` |
| Edit screen code | action | Studio, with View code open | `canvas-code-hook.js` (Studio iframe, page world) reads View code and applies through Studio's own tree delete + paste; checks tabs, indentation, duplicate names, a colon in a formula |
| Expand tree | toggle | Studio, Tree view | Closes exactly what it opened |
| Edit flow | action | a flow: details, designer, run (also framed in make.powerapps.com) | Extension page `src/flow-editor.html`; calls go through `flow-edit-hook.js` with the portal's own sign-in; `checkFlowErrors` / `checkFlowWarnings`; re-read before PATCH; backups `dynaboost.flowBackups` (10); Versions in the tab's `sessionStorage` (original + 5) |
| Export run | action | a run | Data from the portal's own run response (`flow-run-hook.js`); large payload links fetched 6 at a time; loop iterations listed, not expanded |
| Expand all steps | toggle | designer and runs | Outermost toggle of a nested chain only; skips the Office shell (`o365sx`), menus, combo boxes, card menus and DynaBoost's own UI |
| Form as JSON | action | record form | `form-dump.js`, Logic strip `form-logic.js`, Commands `form-commands.js` (`RetrieveEntityRibbon`, `appaction`); Xrm read by `form-dump-hook.js` |
| Edit form | action | record | `/e/{env}/s/{solution}/entity/{table}/form/edit/{form}` in the unmanaged solution holding the form; the one pinned in My solutions wins; Default Solution last |
| Logical names | toggle | record forms | Badges drawn by `form-tools-hook.js` (page world, Xrm) |
| God mode | toggle, this page (`session: true`) | record form | `form-tools-hook.js`; a MutationObserver keeps it unlocked; gold 4 px frame + top tab; reasons from attribute metadata (SourceType, IsValidForUpdate, IsSecured) |
| Copy record | action | saved record | Values from the open form (the form's attributes, `getValue()`); creatable columns from `EntityDefinitions` (IsValidForCreate, no autonumber), cached per session; hand-off to the new tab via `chrome.storage.local` `dynaboost.copyRecord` (1 minute) |
| Impersonate | toggle, this tab | `*.crm*.dynamics.com` | A `declarativeNetRequest` session rule per tab (id = tab id): `MSCRMCallerID` on `xmlhttprequest`, `requestDomains` and `initiatorDomains` = the org; state in `chrome.storage.session`; tabs opened from it inherit it; `WhoAmI` before and after the reload; favorites `dynaboost.impFavorites` (3) and recent `dynaboost.impRecent` (5) per host; blue 3 px frame + bottom label |
| Open workflow | action | classic workflow | Steps and XAML views; PATCH only a draft, unmanaged definition row; the original downloaded first; conflict check |
| Edit journey | action | real-time journey | Draft only (`EDITABLE_STATUS`); ETag; backups `dynaboost.journeyBackups` (10) |
| Copy work item | action | ADO work item | REST API; Markdown with content only; images as numbered placeholders + downloads, or inline with "Copy with images" |
| Expand items | toggle | ADO taskboard and backlogs | Items you opened yourself remembered per sprint (30 sprints); backlogs through "Expand one level" |
| Expand wiki tree | toggle | ADO wiki | Paced (500 ms), rows keyed by `aria-labelledby`; closes only what it opened |

Azure DevOps tools work on `dev.azure.com/{org}` and on the older
`{org}.visualstudio.com` (not code., marketplace. or app.vssps.).

Power Automate tools also work in make.powerapps.com when a flow is opened
from a solution (`/objects/cloudflows/…`): Power Apps shows it in a frame from
make.powerautomate.com (`…/widgets/manage/…/flows/{id}/…`). DynaBoost runs in
that frame without a panel of its own, tells the page's panel which tiles work
there, and the panel passes clicks to it - through the extension's background,
never through the page. A frame that does not get DynaBoost from the manifest
gets it from the background (`chrome.scripting`) as soon as it appears.

## The panel

- Only the tiles that work on the current page are listed (`hosts`, then
  `when()`); "Show all" in the footer lists the rest, dashed and grey, under
  "On other pages". Grey means one thing only: not on this page.
- Action tiles run once and close the panel. Toggles show a small switch
  (grey off, blue on, with a gold underline) and survive a reload, unless
  they are `session` toggles.
- The context strip under the header shows the id of what the page is about
  (record, table, flow, run, solution, work item, pull request, build), read
  from the URL only; click to copy.
- Light / dark: the moon / sun in the header. Until it is used, the panel
  follows the browser's `prefers-color-scheme` and a portal set to dark. The
  choice is kept (`dynaboost.theme`) with the browser's mode at that moment;
  the latest change - the button or the browser - wins. Dialogs over the
  page and every tab DynaBoost opens follow the panel.
- (i) opens the help page. The panel hands it the tiles' names and icons
  (`dynaboost.helpTiles`) and the ids of the tiles of the current page.
- The heart in the footer (**Say thanks**) holds the Stripe link and the
  BTC / ETH / USDC addresses - the `THANKS` constant at the top of
  `src/core.js`. The QR code of the Stripe link is made in advance with
  `python tools/qr-path.py <link>` (needs `pip install segno`) and pasted into
  `THANKS.stripeQr`; it hides itself when the link changes.

## Install (unpacked)

1. `chrome://extensions` → turn on **Developer mode**
2. **Load unpacked** → pick this repository's folder
3. Open make.powerapps.com or your `*.dynamics.com` environment
4. Click the DynaBoost icon in the toolbar

After a `git pull`, click ↻ on DynaBoost in `chrome://extensions`. Tabs that
were already open get the new scripts on the first click of the icon.

## Structure

```
manifest.json
background.js            toolbar icon, frame relay, Impersonate's header rules, help tab
src/core.js              feature registry, toggle state, the panel
src/code-view.js         code as in VS Code (every editor and preview), DynaBoost.tabCss / themeTab
src/theme-table.js       tab colours in light and dark (generated by tools/theme-vars.py)
src/flow-editor.html     Edit flow's editor (an extension page) + src/flow-editor.js
src/help.html            the help page (an extension page) + src/help.js
src/panel.css            the panel, dialogs over the page, toasts, page frames
src/features/            one feature, one file
icons/
store/                   Chrome Web Store listing, privacy policy, promo tile
tools/                   qr-path.py, theme-vars.py + theme-dark.json
```

## Adding a feature

1. Create `src/features/my-feature.js`:

```js
(function () {
  DynaBoost.register({
    id: 'my-feature',          // storage key - never change it after a release
    name: 'My feature',        // tile label, two short words at most
    group: 'Columns',          // section heading in the panel
    hint: 'What it does',      // tooltip
    icon: '<svg viewBox="0 0 24 24">...</svg>',
    hosts: ['make.powerapps.com'],                     // which sites
    when: () => /\/canvas\//.test(location.pathname),  // which pages (optional)
    type: 'toggle',            // 'toggle' or 'action'
    defaultOn: false,          // toggles only
    onEnable() { /* start */ },
    onDisable() { /* clean up */ }
    // an 'action' gives onRun() instead of onEnable / onDisable
  });
})();
```

2. Add the file to the first `content_scripts.js` list in `manifest.json`
   (after `core.js`). `background.js` reads that same list, so there is no
   second copy to update. A Power Automate feature that should also work in
   the flow frame of make.powerapps.com gets `inFrames: true` and goes into the
   short `…/widgets/*` entry as well.
3. Describe it for users in `src/help.js`: an entry in `SECTIONS` (where,
   what, one line per fact; a fact starting with `!` is a limit) and its name
   in `NAMES`.
4. Reload the extension in `chrome://extensions`.

`onDisable` has to undo everything `onEnable` did - DOM, observers, timers.
Tabs a feature opens get the shared header from `DynaBoost.tabCss` (append it
to the tab's `<style>`) and call `DynaBoost.themeTab(tab)` once the document is
written.

Tile names say what happens, from the user's side - "Export table", "Open
column details" - not what the mechanism is called.

### Two colours

Everything ships in light and dark (details in `CONTRIBUTING.md`). In the panel,
colours go through the `--db-*` tokens with twins under
`#dynaboost-root.db-dark`. In tabs, write colours as usual (`#1e6bff`), then
`python3 tools/theme-vars.py` turns them into variables and regenerates
`src/theme-table.js`; a colour without a dark value is listed - add it to
`tools/theme-dark.json`. Light mode stays exactly as written.

### Icons

SVG 24×24, `fill="none"`, `stroke-width="1.6"`. Blue `#3D8BFF` for the main
shape, gold `#E3B04B` for the accent. Always drawn in colour.

## Publishing

Everything for the Chrome Web Store form is in `store/`: texts and permission
justifications (`LISTING.md`), the privacy policy (`PRIVACY.md`) and the
440×280 promo tile. GitHub builds the package whenever `version` in
`manifest.json` changes on `main` (`.github/workflows/package.yml`); the `.zip`
is under **Releases** as `v<version>`. With the store's API keys added (see the
workflow file), the same run uploads the new version to the store.

Before a release: bump `version` in `manifest.json`; a new permission or site
needs its reason in `store/LISTING.md`, and `store/PRIVACY.md` must stay true.
