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
| Open advanced options | toggle, on by default | New / Edit table and column panels | Clicks "Advanced options" in panels, drawers and dialogs (on table and solution pages anywhere); icon-font glyphs ignored; a toggle without `aria-expanded` is clicked once, one the user clicks is left alone; labels in 7 UI languages |
| Column defaults | toggle, on by default | New column panel | Only in a pane headed "New column" (7 UI languages); unchecks "Allow form fill assistance" (English label) once per checkbox; a checkbox the user clicks is left alone; rules in `RULES` |
| Open in classic | action | inside a solution | Classic solution explorer on that solution; the org host per environment in `chrome.storage.sync` (`DynaBoost.orgHost`, shared with Advanced Find) |
| Advanced Find | action | Dynamics apps; maker portal in an environment | `https://{org}/main.aspx?pagetype=advancedfind` |
| System jobs | action | Dynamics apps; maker portal in an environment | `asyncoperation`, view "All System Jobs" |
| Time saved | panel header | every site | Gold capsule (`src/time-saved.js`): the number, then its unit in gold - S, M, H, D, MO (30 d), Y; below 10 one decimal, rounded down; a new value rolls in from below and the frame lights up; tooltip with the exact time, uses and top tools. A tool calls `DynaBoost.saved(id)` once it has done its work (`DynaBoost.saved(id, action)` for an action with a time of its own, `SAVED['id:action']` - Edit journey's copy and save, Open workflow's XAML save) (or `countClick: true` for a switch counted per click); `background.js` holds the seconds per tool (`SAVED`) and adds the uses up in `dynaboost.saved` (written once a second at most, one write at a time); `dynaboost.savedSeen` is what a panel showed last, so the next one rolls on from there. Also on the help page, last in its header, with "saved" |
| My solutions | panel section | every site | Up to 6 shortcuts (3, then 3 more); one per solution, matched by environment + solution id; `chrome.storage.sync`, fold state in `chrome.storage.local` |
| Edit screen code | action | Studio, with View code open | `canvas-code-hook.js` (Studio iframe, page world) reads View code and applies through Studio's own tree delete + paste; checks tabs, indentation, duplicate names, a colon in a formula; Versions in the tab per code loaded (as loaded + 5 applied) |
| Expand tree | toggle | Studio, Tree view | Closes exactly what it opened |
| Edit flow | action | a flow: details, designer, run (also framed in make.powerapps.com) | Extension page `src/flow-editor.html`; calls go through `flow-edit-hook.js` with the portal's own sign-in; `checkFlowErrors` / `checkFlowWarnings`; re-read before PATCH; backups `dynaboost.flowBackups` (5 newest of all flows, 14 days, shown for this flow in this environment); Versions in the tab's `sessionStorage` (original + 5); solution flows with drafts: the Flow / Power Platform APIs see the published flow only (a never-published one is "Entity 'workflow' ... Does Not Exist", 0x80040217), so the hook also keeps the designer's Dataverse sign-in and reads the draft with `MSCRM.IncludeUnpublished` - a never-published flow opens as its draft, a pending draft is marked, without the page's Dataverse sign-in the draft is read in a tab of the flow's environment (`DB_DV_FLOW` in `background.js`: an open tab, or one opened in the background and closed; host from `dynaboost.environments`, else `dynaboost.orgHosts`; only `src/flow-editor.html` may ask), not found is not marked; Save to flow looks for a draft again at every save (status: Checking for an unpublished draft…), not found saves as it is, with a draft asks, publishes it (in the page or that tab) with `PublishComponent?ActivateFlowOnPublish=<on as it was>`, then saves (connection references taken from the published flow unless edited); a save refused for a draft (`ActiveUnpublished` or 0x80040217) that it cannot publish asks once - OK copies the code, keeps it as a backup labelled "Your edit, before publishing", focuses the Power Automate tab and closes the editor without the unsaved-edit question; Cancel stays |
| Export run | action | a run | Data from the portal's own run response (`flow-run-hook.js`); large payload links fetched 6 at a time; loop iterations listed, not expanded; a body behind its own link (`bodyContentLink` and other `*ContentLink`) fetched too, up to 20 a run; Where it failed (`failureOf`): the failed steps that are not `ActionFailed` cascades, with code, HTTP status, operation, retries and the messages found in the response body (`detailsOf`), also in the JSON as `failure`; Records column (`findRecords`; each record opened counts `flow-run-export:record` in Time saved): rows by `@odata.id` / `@odata.type` / `@odata.context` and their key, lookups (`_x_value` + lookuplogicalname, system ones left out), an action's `entityName` + `recordId`, `@odata.bind` - each once with its steps, linked as `main.aspx?pagetype=entityrecord`, with the `appid` last seen in that environment (`dynaboost.lastApp`, kept by `core.js` on Dynamics pages); host from the rows, else `dynaboost.environments` |
| Expand all steps | toggle | designer and runs | Outermost toggle of a nested chain only; skips the Office shell (`o365sx`), menus, combo boxes, card menus and DynaBoost's own UI |
| Form as JSON | action | record form | `form-dump.js`, Logic strip `form-logic.js`, Commands `form-commands.js` (`RetrieveEntityRibbon`, `appaction`); Xrm read by `form-dump-hook.js` (also the business process flow: `Xrm.Page.data.process` - stages, steps, the active stage; its fields are not in formxml); the process bar on top of the Form view (a stage opens in place; Edit in... and the table's other BPFs - not in Automations); the JSON: `about`, then `layout` (the form at a glance, `layoutOf`) before the full header / process / tabs / footer, `alsoInProcess` / `alsoOnForm` on a column in both, short objects on one line (`prettyJson`) |
| Compare | action | a record form | `env-compare.js`: one dialog (From → Compare: form and table, or record → With) - the form and its table, or two records, here and in another environment, read by `DynaBoost.formDump.read` (the same code as Form as JSON); the other side in a tab of that environment (`background.js`: one open, or one opened in the background and closed again, after DynaBoost's own question unless `dynaboost.askBackgroundTabs` is off); the environments from the maker portal's own answer (`env-list-hook.js` in the page, its cache as a fallback; `dynaboost.environments`, names and addresses), the read stoppable (`DB_ENV_CANCEL` closes its tab); table and form by name, else a list to pick; logic matched by its name; Form / Columns / Logic, only differences, system fields hidden; across environments a lookup matches by its name |
| Edit form | action | record | `/e/{env}/s/{solution}/entity/{table}/form/edit/{form}`; `solutioncomponents` (type 60): the one unmanaged solution holding the form, or the one pinned in My solutions, opens at once (`window.open` right after the read - a blocked pop-up falls back to the list); otherwise a dialog over the page lists the solutions - unmanaged (pinned first), Default Solution, managed folded - and a click opens it |
| Edit view | action | list | `/e/{env}/s/{solution}/entity/{table}/view/{view}`; the view from `viewid` in the address (a subgrid's list, a picked view), else the table's default public view (`savedqueries`, `isdefault`, `querytype` 0); a personal view (`viewType` 4230) is refused; its solutions from `solutioncomponents` (type 26), the same choice and dialog as Edit form |
| Open table | action | record, list | `/environments/{env}/solutions/{solution}/entities/{MetadataId}` (the short `/e/.../entity/{name}` form does not open a table); the table's `MetadataId` from `EntityDefinitions`, its solutions from `solutioncomponents` (type 1); the same choice and dialog as Edit form (`src/features/form-editor.js`) |
| Logical names | toggle | record forms | Badges drawn by `form-tools-hook.js` (page world, Xrm) |
| God mode | toggle, this page (`session: true`) | record form | `form-tools-hook.js`; a MutationObserver keeps it unlocked; gold 4 px frame + top tab; reasons from attribute metadata (SourceType, IsValidForUpdate, IsSecured) |
| Copy record | action | saved record | Values from the open form (the form's attributes, `getValue()`); creatable columns from `EntityDefinitions` (IsValidForCreate, no autonumber), cached per session; hand-off to the new tab via `chrome.storage.local` `dynaboost.copyRecord` (1 minute) |
| Impersonate | toggle, this tab | `*.crm*.dynamics.com` | A `declarativeNetRequest` session rule per tab (id = tab id): `MSCRMCallerID` on `xmlhttprequest`, `requestDomains` and `initiatorDomains` = the org; state in `chrome.storage.session`; tabs opened from it inherit it; `WhoAmI` before and after the reload; favorites `dynaboost.impFavorites` (3) and recent `dynaboost.impRecent` (5) per host; blue 3 px frame + bottom label |
| Open workflow | action | classic workflow | Steps and XAML views; PATCH only a draft, unmanaged definition row; the original downloaded first; conflict check; Versions in the tab (original + 5); closing with an unsaved edit asks |
| Edit journey | action | real-time journey | Draft only (`EDITABLE_STATUS`); ETag; backups `dynaboost.journeyBackups` (5 newest of all journeys, 14 days, shown for this journey in this environment); Versions in the tab (original + 5) |
| Copy work item | action | ADO work item | REST API; Markdown with content only; images as numbered placeholders; with images both buttons copy the text - "Copy without images", or "Copy with images", which also saves them (one ZIP for several); the tile pulses while it reads, the answer folds down under the list like Say thanks; with images nothing is copied before a button is clicked (6 s); only a failure goes to the bottom |
| Expand items | toggle | ADO taskboard and backlogs | Items you opened yourself remembered per sprint (30 sprints); backlogs through "Expand one level" |
| Expand wiki tree | toggle | ADO wiki | Paced (500 ms), rows keyed by `aria-labelledby`; closes only what it opened |
| Blur data | toggle | any page | One stylesheet (`html.db-blur`), there only while on - inputs, gridcells, comboboxes, lookup chips, field controls (quick views, header), the record title, whole timeline entries with what sits beside them (an opened record card); Alt + hover reveals one; remembered |
| Presenting | action → window | any page | One window (`.db-pr`): Laser pointer, Spotlight - each a switch and its own keys (recorded with the pencil, 2-3 keys with a modifier; taken and AltGr combos refused), kept in `dynaboost.present` with Spotlight's size. Laser: a dot and a CSS-sized canvas trail, `cursor: none`. Spotlight: one element with a 200vmax box-shadow, centred by its margins so it closes in from the whole screen (0.55 s) and opens out when off (0.2 s); Shift on its own frames the field or section (held 180 ms, never the Shift of its keys), Esc |

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
- The pencil in the footer arranges the panel: tiles move within their
  section, sections by their name, with their tiles (drag, or the arrow
  keys) - never a tile into another section, and never above My solutions.
  Each site keeps its own order (`dynaboost.layout`:
  `{ v: 2, sites: { dynamics | powerapps | powerautomate | devops: { groups, tiles } } }`,
  two full lists each; the single `{ groups, tiles }` of 2.39.48 is where
  every site starts). A move does what it shows on every page of the site:
  to the top - first, to the bottom - last, else right after the one shown
  above it. A section or tile not in the lists yet (new after an update)
  comes after the one it follows by default. Reset order resets this site.
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
- (i) opens the help page. The panel hands it the tiles' names, icons and
  sections (`dynaboost.helpTiles`), the ids of the tiles of the current page
  and the kind of page (`&page=Dynamics 365 · Record`, `pageKind()`).
- Report a bug / Suggest an idea: two Tally forms (`FORMS` in
  `src/code-view.js`, `DynaBoost.feedbackUrl(kind, { section, tool, page })`)
  with hidden fields `version`, `browser`, `section`, `tool`, `page` - the
  section preselects "Where in DynaBoost?". Pills in the help's header (the
  section when the page's tiles share one, the tool when there is one), small
  round icons beside Rate DynaBoost in every tab's header (`themeTab`), and
  Report this bug in a tab's error (`tabError`, with the tool and its
  section). The forms' section list follows the panel's sections: a new
  section goes into both forms too.
  After an update (`onInstalled`, also a reload of a copy from a folder)
  `background.js` sets `dynaboost.whatsNew` to the new version: the (i)
  wears the heart's gold dot and its tooltip says so, and its next click
  opens the help at What's new (`&news=1`) and clears the key - the dot goes
  in every tab until the next update. A new install has no dot.
- The heart in the footer (**Say thanks**) holds the Stripe link (Once) and
  the monthly ones (Monthly - `THANKS.monthly`, an amount a month each with its
  own link and QR code; a switch above the pay button - which stays the same -
  points it and its QR code there, and puts in Crypto's place a row of the
  same size with the amounts to pick and "Cancel anytime"), the
  BTC / ETH / USDC addresses and, quietly at the bottom, Rate DynaBoost (its
  page in the store it was installed from - `DynaBoost.store` in
  `src/code-view.js`: the manifest's `update_url` (Google's or Microsoft's),
  for a copy from a folder the browser) and the author's LinkedIn - the `THANKS`
  constant at the top of `src/core.js`. The help page's header links to the
  store, the code on GitHub and LinkedIn (`ABOUT` in `src/help.js`); every
  other tab DynaBoost opens gets a quiet Rate DynaBoost in its header from
  `DynaBoost.themeTab` (`src/code-view.js`). The QR code of the Stripe link is made in advance
  with `python tools/qr-path.py <link>` (needs `pip install segno`) and pasted
  into `THANKS.stripeQr` (the monthly link's into `THANKS.monthlyQr`); each hides itself when its link changes.
- A rating is suggested by a glowing gold dot on the heart: after 15 tools run
  or switched over 3 days at least, and after every update (`background.js`
  sets `news` to the new version), until Say thanks is opened
  (`dynaboost.use`: `{ since, n, seen, news }`).

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
    group: 'Tables and columns', // section heading in the panel
    hint: 'What it does',      // tooltip, a few words
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
It also runs when DynaBoost is updated while the page is open: the copy
running there is cut off from the extension and steps aside for the new one,
which the background puts into the open tabs. A `chrome.*` call a feature makes
outside `onRun` / `onEnable` (a timer, a click handler) checks
`DynaBoost.alive()` first, and a feature file that uses `chrome.*` at all
starts with `if (DynaBoost.off) return;` - a copy put in while DynaBoost was
being reloaded has no `chrome.*` and stays quiet. A message to the user goes through
`DynaBoost.toast()`, or into `DynaBoost.toastLayer()` for one with buttons -
both follow the light or dark mode. An action whose answer has buttons sets
`panelResult: true`: the panel stays open, `ui.busy(true)` makes its tile pulse
while it works, and `ui.card({ title, sub, actions })` folds the answer down
under the list the way Say thanks does (with Say thanks open too, it sits above
it) - it goes by itself (`dismissIn`, `done`) and the panel stays open. What
went wrong goes to the bottom with `DynaBoost.toast()`. Between the header and
the footer the panel scrolls as one area, so however much is open, both stay
in view.
Tabs a feature opens get the shared header from `DynaBoost.tabCss` (append it
to the tab's `<style>`) and call `DynaBoost.themeTab(tab)` once the document is
written.

Tile names say what happens, from the user's side - "Export table", "Open
advanced options" - not what the mechanism is called.

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

Before a release: a release with new features carries `version` as
major.minor (`2.39`), the same as its entry in What's new; a later fix-only
release of it is `2.39.1`, `2.39.2` ... A new permission or site needs its
reason in `store/LISTING.md`, and `store/PRIVACY.md` must stay true.
