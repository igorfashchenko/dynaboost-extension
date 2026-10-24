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
| Lowercase schema names | toggle, off by default | New table / New column / New choice panels | `lower-schema.js`: a Schema name input that can still be set (7 UI languages, found by its label; in a pane headed New choice also the one labelled Name) is kept in lower case - set through the input's own value setter and an input event, so React takes it; once changed, the portal no longer fills it from Display name, so it is made here: the portal's prefix part (learned from its first value) + the display name's letters and digits; typed by hand: lowered, no longer made from the display name; disabled / read-only inputs (Edit) left alone; Time saved `lower-schema` 2 s, once a pane (a table, column or choice created) |
| Column defaults | toggle, on by default | New column panel | Only in a pane headed "New column" (7 UI languages); unchecks "Allow form fill assistance" (English label) once per checkbox; a checkbox the user clicks is left alone; rules in `RULES` |
| Open in classic | action | inside a solution | Classic solution explorer on that solution; the org host per environment in `chrome.storage.sync` (`DynaBoost.orgHost`, shared with Advanced Find) |
| Advanced Find | action | Dynamics apps; maker portal in an environment | `https://{org}/main.aspx?pagetype=advancedfind` |
| Open any table | action | a model-driven app | `src/features/any-table.js`: a dialog on Impersonate's (`db-imp db-anyt`): View / Form (from `pagetype`), the tables from `EntityDefinitions` once a tab (sessionStorage; no intersect or private ones) found by display, logical and schema name at once; opens `main.aspx?appid=|appname=…&pagetype=entitylist|entityrecord&etn=` in the same app (Ctrl: a new tab); favorites (5) and recent (5) per environment in `dynaboost.anyTableFavorites` / `dynaboost.anyTableRecent` |
| System jobs | action | Dynamics apps; maker portal in an environment | `asyncoperation`, view "All System Jobs" |
| Time saved | panel header | every site | Gold capsule (`src/time-saved.js`): the number, then its unit in gold - S, M, H, D, MO (30 d), Y; below 10 one decimal, rounded down; a new value rolls in from below and the frame lights up; tooltip with the exact time, uses and top tools. A tool calls `DynaBoost.saved(id)` once it has done its work (`DynaBoost.saved(id, action)` for an action with a time of its own, `SAVED['id:action']` - Edit journey's copy and save, Open workflow's XAML save) (or `countClick: true` for a switch counted per click); `background.js` holds the seconds per tool (`SAVED`) and adds the uses up in `dynaboost.saved` (written once a second at most, one write at a time); `dynaboost.savedSeen` is what a panel showed last, so the next one rolls on from there. Also on the help page, last in its header, with "saved" |
| My shortcuts | panel section | every site | Up to 6 shortcuts (3, then 3 more) to solutions (gold) and apps (blue, `db-slot-app`); one per solution (environment + solution id) or app (app id); an app's address: a model-driven app `https://{org}/main.aspx?appid=`, a canvas app the player (`appOpenUri` when the portal's app list gave it, else `apps.powerapps.com/play/e/{env}/a/{id}`); pinned from an open model-driven app (names from `appmodules` and `RetrieveCurrentOrganization`), from a solution - its apps from `solution-apps-hook.js` (the portal's `msdyn_solutioncomponentsummaries`, types 80 and 300; the solution from the row or the query's filter) and, for model-driven apps, from the list on the page (`appsOnPage`: a row of type Model-Driven App, its unique name - opened as `main.aspx?appname=`, the host from the environment list) - with a ticked row pinned at once, else a small list (`.db-pick`) of what of the solution and its apps is not pinned yet (one left: pinned at once); one app is one shortcut however it was found (`sameApp`: id, address, or kind + environment + name); ✕ removes at once; or from a pasted link; a model-driven app's third tool, Open in App designer (`designer`): `DB_ENV_APP_SOLUTIONS` - `background.js` `appSolutionsHere` in a tab of its environment (`runInEnvironment`, as Compare's reads): the app by id or `uniquename`, `RetrieveCurrentOrganization`, `solutioncomponents` type 80 - a list (yours, Default, managed) whose row opens `make.powerapps.com/e/{env}/s/{solution}/app/edit/{app}` (`solution-pins:designer` in Time saved); `chrome.storage.sync` (`dynaboost.solutionPins`), fold state in `chrome.storage.local` |
| Edit screen code | action | Studio, with View code open | `canvas-code-hook.js` (Studio iframe, page world) reads View code and applies through Studio's own tree delete + paste; checks tabs, indentation, duplicate names, a colon in a formula; Versions in the tab per code loaded (as loaded + 5 applied) |
| App checker report | action | Studio | `canvas-check.js` asks `canvas-check-hook.js` (Studio frame, page world; a frame keeps the copy it loaded with, so after an update the newest is put in from `background.js` - `DB_STUDIO_HOOK` - and takes over, the older standing down by `VERSION`; none answering: reload Studio): it opens the App checker pane (the stethoscope) if closed, goes into each category with a count, opens every group (`aria-expanded`), reads each issue's lines (rule, where - `Screen > Control.Property` - and what the pane says; severity from icon names and labels), and for Formulas / Runtime clicks each issue and reads the formula bar's Monaco (reached through the React tree): the formula, the property, and each problem from View Problem's widget (`editor.action.marker.next`, else the squiggles), with the range and code of its squiggle (`squiggly-error|warning|info` decorations) - the tab draws the formula with line numbers and a wavy line under each problem's code, numbered as the list, and the Markdown quotes that code; back to the list after. A tab: by category (chips), Copy (Markdown), Download JSON / CSV; read fewer than the pane counts, or no pane: a note and Copy layout - tags, roles, classes, text lengths, Studio's own words only |
| Expand tree | toggle | Studio, Tree view | Closes exactly what it opened |
| Edit flow | action | a flow: details, designer, run (also framed in make.powerapps.com) | Extension page `src/flow-editor.html`; calls go through `flow-edit-hook.js` with the portal's own sign-in; a flow made new in the designer keeps `.../flows/new/...` as its address after the save, so the hook passes on the id its save gives (a PATCH / PUT of `.../flows/{id}`, or the answer to the POST that created it - not a read, which may be another flow) and Edit flow shows for that address (`dynaboost-flow-saved`; `DynaBoost.refresh()` also tells the page's panel when in a frame); `checkFlowErrors` / `checkFlowWarnings`; re-read before PATCH; backups `dynaboost.flowBackups` (5 newest of all flows, 14 days, shown for this flow in this environment); Versions in the tab's `sessionStorage` (original + 5); solution flows with drafts: the Flow / Power Platform APIs see the published flow only (a never-published one is "Entity 'workflow' ... Does Not Exist", 0x80040217), so the hook also keeps the designer's Dataverse sign-in and reads the draft with `MSCRM.IncludeUnpublished` - a never-published flow opens as its draft, a pending draft is marked, without the page's Dataverse sign-in the draft is read in a tab of the flow's environment (`DB_DV_FLOW` in `background.js`: an open tab, or one opened in the background and closed; host from `dynaboost.environments`, else `dynaboost.orgHosts`; only `src/flow-editor.html` may ask), not found is not marked; Save to flow looks for a draft again at every save - started with the checks, not after them (status: Checking for an unpublished draft…, with the host when it is read in the environment's tab), not found saves as it is, with a draft asks, publishes it (in the page or that tab) with `PublishComponent?ActivateFlowOnPublish=<on as it was>`, then saves (connection references taken from the published flow unless edited); a save refused for a draft (`ActiveUnpublished` or 0x80040217) that it cannot publish asks once - OK copies the code, keeps it as a backup labelled "Your edit, before publishing", focuses the Power Automate tab and closes the editor without the unsaved-edit question; Cancel stays; a step still working shows `DynaBoost.status` busy in the status line, and from 3 s on how long it has taken |
| Export run | action | a run | Data from the portal's own run response (`flow-run-hook.js`); large payload links fetched 6 at a time; a body behind its own link (`bodyContentLink` and other `*ContentLink`) fetched too, up to 20 a batch; loops (Apply to each, Do until): each repeated action's iterations from `.../runs/{run}/actions/{action}/repetitions` (`flow-edit-hook.js` op `repetitions`, the page's own sign-in, Flow API else Power Platform API, `nextLink` pages followed, up to 100 an action - a loop read only in part says "5000 of 8000 iterations", in Where it failed too, and `read` / `readNote` in the JSON), grouped by loop and iteration (`repetitionIndexes`; nested: the innermost loop, numbers `2 › 3`, its own section after the loop it is in); a loop that ran more than once gets a strip of iteration numbers (Failed / All, the failed first), ← →, Copy iteration and Copy failed iterations (`flow-run-export:iteration`, 900 s each in Time saved, as an export), a loop that ran once just its actions; payloads: 150 links before the tab opens (failed iterations first), up to 400 in the background, the rest when an iteration is opened; Copy everything / Download carry `loops` with every iteration (a note when some were left out); if the iterations cannot be read, the loop's actions show once, as before, with a note; Where it failed (`failureOf`): the failed steps that are not `ActionFailed` cascades - inside a loop the action once, with the iterations it failed in (links to them) - with code, HTTP status, operation, retries and the messages found in the response body (`detailsOf`), also in the JSON as `failure`; Records column (`findRecords`; each record opened counts `flow-run-export:record` in Time saved): rows by `@odata.id` / `@odata.type` / `@odata.context` and their key, lookups (`_x_value` + lookuplogicalname, system ones left out), an action's `entityName` + `recordId`, `@odata.bind` - each once with its steps, linked as `main.aspx?pagetype=entityrecord`, with the `appid` last seen in that environment (`dynaboost.lastApp`, kept by `core.js` on Dynamics pages); host from the rows, else `dynaboost.environments` |
| Expand all steps | toggle | designer and runs | Outermost toggle of a nested chain only; skips the Office shell (`o365sx`), menus, combo boxes, card menus and DynaBoost's own UI; a pass at most 250 ms after the page changes (not put off at every change - a moving mouse stalled it); off closes what it opened newest first, then - as the designer draws steps anew and leaves out those off screen - finds them again by `keyOf` (the step's `data-id` / `data-automation-id` / `data-testid` and the toggle's label without Expand / Collapse...) and closes them as they show up open, for 10 minutes on the same page |
| Form as JSON | action | record form | `form-dump.js`, Logic strip `form-logic.js`, Commands `form-commands.js` (`RetrieveEntityRibbon`, `appaction`); Xrm read by `form-dump-hook.js` (also the business process flow: `Xrm.Page.data.process` - stages, steps, the active stage; its fields are not in formxml); the process bar on top of the Form view (a stage opens in place; Edit in... and the table's other BPFs - not in Automations); the JSON: `about`, then `layout` (the form at a glance, `layoutOf`) before the full header / process / tabs / footer, `alsoInProcess` / `alsoOnForm` on a column in both, short objects on one line (`prettyJson`); *whole entity* adds a Not on this form section to the Form view (and its nav entry), and is off when there is nothing more to show |
| Compare | action | a record form | `env-compare.js`: one dialog (From → Compare: form and table, or record → With) - the form and its table, or two records, here and in another environment, read by `DynaBoost.formDump.read` (the same code as Form as JSON); the other side in a tab of that environment (`background.js`: one open, or one opened in the background and closed again, after DynaBoost's own question unless `dynaboost.askBackgroundTabs` is off); the environments from the maker portal's own answer (`env-list-hook.js` in the page, its cache as a fallback; `dynaboost.environments`, names and addresses), the read stoppable (`DB_ENV_CANCEL` closes its tab); table and form by name, else a list to pick; logic matched by its name; Form / Columns / Logic, only differences, system fields hidden; across environments a lookup matches by its name |
| Edit form | action | record | `/e/{env}/s/{solution}/entity/{table}/form/edit/{form}`; the tab opened on the click ("Opening the form designer…", status icons) and sent on with `location.replace`, so never a blocked pop-up; the solution: the first of `solutioncomponents` (type 60) - pinned in My solutions, else unmanaged, else the Default Solution - no list (`openDirect`); a problem is said in the tab |
| Edit view | action | list | `/e/{env}/s/{solution}/entity/{table}/view/{view}`; the view from `viewid` in the address (a subgrid's list, a picked view), else the table's default public view (`savedqueries`, `isdefault`, `querytype` 0); a personal view (`viewType` 4230) is refused; opened as Edit form (`openDirect`, type 26) - no list |
| Open table | action | record, list | `/environments/{env}/solutions/{solution}/entities/{MetadataId}` (the short `/e/.../entity/{name}` form does not open a table); the table's `MetadataId` from `EntityDefinitions`, its solutions from `solutioncomponents` (type 1); the one unmanaged solution holding it, or the one pinned in My solutions, opens at once (a blocked pop-up falls back to the list); otherwise a dialog over the page lists them - yours, pinned on top, then the Default Solution, then the managed ones folded away (`src/features/form-editor.js`) |
| Logical names | toggle | record forms | Badges drawn by `form-tools-hook.js` (page world, Xrm) |
| God mode | toggle, this page (`session: true`) | record form | `form-tools-hook.js`; a MutationObserver keeps it unlocked; gold 4 px frame + top tab; reasons from attribute metadata (SourceType, IsValidForUpdate, IsSecured) |
| Copy record | action | saved record | Values from the open form (the form's attributes, `getValue()`); creatable columns from `EntityDefinitions` (IsValidForCreate, no autonumber), cached per session; hand-off to the new tab via `chrome.storage.local` `dynaboost.copyRecord` (1 minute) |
| Impersonate | toggle, this tab | `*.crm*.dynamics.com` | A `declarativeNetRequest` session rule per tab (id = tab id): `MSCRMCallerID` on `xmlhttprequest`, `requestDomains` and `initiatorDomains` = the org; state in `chrome.storage.session`; tabs opened from it inherit it; `WhoAmI` before and after the reload; favorites `dynaboost.impFavorites` (3) and recent `dynaboost.impRecent` (5) per host; blue 3 px frame + bottom label |
| Open workflow | action | classic workflow | Steps and XAML views; PATCH only a draft, unmanaged definition row; the original downloaded first; conflict check; Versions in the tab (original + 5); closing with an unsaved edit asks |
| Edit journey | action | real-time journey | Draft only (`EDITABLE_STATUS`); ETag; backups `dynaboost.journeyBackups` (5 newest of all journeys, 14 days, shown for this journey in this environment); Versions in the tab (original + 5) |
| Copy work item | action | ADO work item | REST API; Markdown with content only; images as numbered placeholders; with images both buttons copy the text - "Copy without images", or "Copy with images", which also saves them (one ZIP for several); the tile pulses while it reads, the answer folds down under the list like Say thanks; with images nothing is copied before a button is clicked (6 s); only a failure goes to the bottom |
| Expand items | toggle | ADO taskboard and backlogs | Items you opened yourself remembered per sprint (30 sprints); backlogs through "Expand one level" |
| Expand wiki tree | toggle | ADO wiki | Paced (500 ms), rows keyed by `aria-labelledby`; closes only what it opened |
| Copy wiki tree | action | ADO wiki | `src/features/wiki-tree.js`: `{project}/_apis/wiki/wikis/{wiki}/pages?path=/&recursionLevel=full&includeContent=false` (7.1, else 6.0), the wiki from the address (none: the project wiki from `_apis/wiki/wikis`), `?version=GB<branch>` read at that branch; sorted by `order`; copied at once as a Markdown outline of titles (`panelResult` card: Copy paths, Download - a .md with `remoteUrl` links, Open tab - fold / open / find, Alt+click a whole branch, the page in the address marked); the card as Copy work item's: waits 6 s (longer under the pointer), a clicked button says ✓ Copied / Downloaded / Opened with the others off and the card goes 1.5 s later, a failure stays 9 s, a refused clipboard is "Clipboard blocked" with Copy again |
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
  keys) - never a tile into another section, and never above My shortcuts.
  Each site keeps its own order (`dynaboost.layout`:
  `{ v: 2, sites: { dynamics | powerapps | powerautomate | devops: { groups, tiles } } }`,
  two full lists each; the single `{ groups, tiles }` of 2.39.48 is where
  every site starts). A move does what it shows on every page of the site:
  to the top - first, to the bottom - last, else right after the one shown
  above it. A section or tile not in the lists yet (new after an update)
  comes after the one it follows by default. Reset order resets this site.
- A section's name folds it, with My shortcuts' chevron (the fold of Say
  thanks: `grid-template-rows` 1fr / 0fr). Folded, it shows how many tiles
  it holds and how many of its switches are on. The folded names are kept
  for every site (`dynaboost.folded`); arranging opens them all, Done folds
  them back.
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
  The same update sets `dynaboost.tour`: the next panel opened shows the
  tour of what is new (`TOUR` in `core.js` - a few of the release's tools,
  each `{ id, title, text, where }`): the panel dims, the tool's tile glows
  in gold beside a bubble (n of steps + 1, Skip / Back, Next); a tool of
  another page is listed for the tour (as Show all), its section opened,
  dashed, with "Not on this page" and where it works; the last one has an ×,
  has a gold card - how many more the release has and a few of them
  (`TOUR.more`: `n`, `chips`, `rest`), a click on it the help at What's new -
  and See what's new for Next. Skip, the ×, See what's new or closing the panel
  ends it and clears the key, in every tab. The tour's tiles wear a gold NEW
  (`dynaboost.tourNew`, `{ v, ids }`) until each is used once.
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
