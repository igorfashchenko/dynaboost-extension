# Chrome Web Store and Edge Add-ons — listing and review answers

Everything below is copy-paste material for the Chrome Web Store Developer
Dashboard. Keep it in sync when features or permissions change.

## Before you submit

1. **Package** – the `.zip` of the Release `v<version>` (built from `main`).
2. **Store listing** – the description below, the five screenshots in
   `store/screenshots/` and the promo tile.
3. **Privacy practices** – single purpose, a justification for every
   permission (table below), remote code: No, the data-usage ticks below.
4. **Privacy policy URL** – `store/PRIVACY.md` of the public repository (link
   below). Keep it true whenever features change: reviewers compare it with
   what the extension does.
5. A new permission can make the review take longer; users are asked nothing
   for `declarativeNetRequestWithHostAccess`.

## Package

`manifest.json`, `background.js`, `src/` and `icons/icon{16,32,48,128}.png`.
GitHub builds it on every version bump (`.github/workflows/package.yml`,
attached to a Release `v<version>`). To build it by hand in PowerShell, from
the repo folder:

```powershell
$v = (Get-Content manifest.json | ConvertFrom-Json).version
Compress-Archive -Force -Path manifest.json, background.js, src, icons\icon16.png, icons\icon32.png, icons\icon48.png, icons\icon128.png -DestinationPath "dynaboost-$v.zip"
```

## Store listing tab

**Name:** DynaBoost

**Summary:** taken from the package - `description` in `manifest.json`.

**Category:** Developer Tools  **Language:** English

**Description** (plain text — paste as is; the store keeps line breaks and
bullets):

```text
DynaBoost – the Power Platform toolbelt for makers, consultants and developers.

Stop clicking through five screens to find out why a field is locked, what runs on save or which flow touches a table. DynaBoost adds one panel to the sites you already work in – Power Apps, Power Automate, Dynamics 365 and Azure DevOps – with tools that answer those questions in one click.

HIGHLIGHTS
• Form as JSON – everything behind a model-driven form in one tab: every tab, section and field (hidden ones too) with its values; the JavaScript libraries and handlers with their code; business rules; plug-in steps, classic workflows, cloud flows and Custom APIs that run on the table; the record's business process flow with each stage's fields; the command bar buttons with their display and enable rules. "Edit in…" opens the right editor in the right solution.
• Edit flow – the whole cloud flow definition as JSON in a real code editor. Save runs Power Automate's own error and warning checks, refuses to overwrite a newer version, keeps a backup of every save and your last versions one click back.
• Edit screen code – canvas app YAML with syntax colours and checks, applied back to Studio in one click (Ctrl+Z undoes it).
• Impersonate – work as any user of your environment in one tab, side by side with your own. Favorites and recent users one click away.
• God mode – every hidden field shown, every locked field unlocked, every required field optional – on this page only.

POWER APPS
• Export table – any grid of the maker portal copied as Markdown or CSV, or downloaded as CSV.
• Open on All – the Tables and Apps pages open on "All" instead of "Recommended" / "My apps".
• Open advanced options – the advanced options of a new or edited table or column always open.
• Column defaults – a new column starts without form fill assistance.
• Open in classic, Advanced Find, System jobs – one click from where you are.
• My solutions – up to six shortcuts to the solutions you work in, in any environment.
• Expand tree – every branch of the Studio tree view open, folded back when you are done.

POWER AUTOMATE
• Edit flow – see above.
• Export run – a whole run in one readable tab: the trigger and every action with inputs, outputs, timing and errors; a failed run opens with where it failed and the service's own error; beside the steps, every Dataverse record the run touched, one click to open.
• Expand all steps – every condition, scope and loop open, in the designer and in run history.

DYNAMICS 365
• Form as JSON, Impersonate, God mode – see above.
• Edit form – the form designer, in the unmanaged solution that holds the form; in several, you pick.
• Open table – the record's table in the maker portal, in your solution that holds it; in several, you pick.
• Edit view – the list's view in the view designer, in your solution that holds it; in several, you pick.
• Logical names – the logical name under every field label, one click to copy.
• Copy record – a new record filled with this one's values; nothing is saved until you save.
• Open workflow – a classic workflow written out in words, and its XAML editable in drafts.
• Edit journey – the definition of a real-time journey (Customer Insights – Journeys) as JSON, saved back in drafts.

AZURE DEVOPS
• Copy work item – the item and its whole comment thread as clean Markdown, with people's names replaced by "User 1", "User 2".
• Expand items – taskboards and backlogs fully expanded; rows you opened yourself are remembered.
• Expand wiki tree – the whole wiki tree open at once.

PRESENTING
• Blur data – values blurred on screen for demos and screen sharing; hold Alt to read one.
• Laser pointer – a red laser dot instead of the mouse pointer.
• Spotlight – the page dims around the pointer, or around one field or section.
Switch the laser and the spotlight on in one window and pick your own keys for each.

MADE FOR EVERY DAY
• One click on the toolbar icon opens the panel – it lists only the tools that work on the page you are on.
• Light and dark mode.
• Your own order: drag tiles and sections where you want them, per site.
• Time saved – a small gold capsule in the panel shows how much time the tools have saved you.
• Built-in help: every tool, where it works, its limits and shortcuts – and Report a bug or Suggest an idea in a short form, no account needed.
• The id of the record, table, flow or solution you are on, ready to copy.

PRIVATE BY DESIGN
• No account, no tracking, no analytics, no ads.
• Everything runs in your browser with your own sign-in. Nothing is sent to DynaBoost or any third party.
• Nothing is written without your click – and saves come with conflict checks and backups.
• Impersonate needs the Act on Behalf of Another User privilege; Dataverse enforces the user's own access.

DynaBoost is free. If it saves you time, the heart in the panel ("Say thanks") lets you rate it or leave a tip, once or monthly – it never asks for a tip; after you have used it for a while, and after an update, a small dot on the heart suggests a rating.

DynaBoost is an independent tool and is not affiliated with or endorsed by Microsoft. Microsoft, Power Apps, Power Automate, Dynamics 365 and Azure DevOps are trademarks of the Microsoft group of companies.
```

**Graphics:**
- Store icon 128×128: `icons/icon128.png`
- Small promo tile 440×280: `store/promo-440x280.png`
- Screenshots 1280×800, 24-bit PNG, in this order (`store/screenshots/`):
  1. `1-form-as-json.png` – Form as JSON, the Form view with the Logic strip
  2. `2-javascript.png` – a form script opened at its handler (dark)
  3. `3-automations.png` – everything that runs on the table
  4. `4-edit-flow.png` – Edit flow with its versions (dark)
  5. `5-panel.png` – the panel, light and dark
  They show a made-up demo environment. A screenshot of a real one must not
  show any customer, person or record.

**Additional fields:** homepage and support URL left empty; mature content:
No.

## Privacy practices tab

**Single purpose:**

> Productivity tools for people who build and maintain Microsoft Power Platform, Dynamics 365 and Azure DevOps solutions, shown as tiles in one panel on those sites.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `scripting` | When the toolbar icon is clicked on a supported tab that was open before the extension was installed or updated, the panel's scripts are injected into that tab so it works without a page reload. On make.powerapps.com, when the Power Automate frame showing a cloud flow (make.powerautomate.com) did not get DynaBoost's scripts from the manifest, the same scripts are injected into that frame only. "Compare" runs the same read-only script in a tab of the user's other Dynamics 365 environment - one the user has open, or one opened in the background for a moment and closed again, after asking - and in a make.powerapps.com tab to read the list of the user's environments. "Edit flow" runs a small script in a tab of the flow's own environment the same way - an open one, or one opened in the background for a moment and closed again - to read the solution flow's unpublished draft and, when the user agrees, publish it before saving. |
| `storage` | Remembers which tools are switched on, the "show all tiles" setting, the order the user arranged the panel's sections and tiles in, light or dark mode, the host name of each Dynamics environment the user entered for "Open in classic" and "Advanced Find", backups of journey definitions saved with "Edit journey" and of flow definitions saved with "Edit flow", the user's "My solutions" shortcuts, the names and addresses of the user's environments as make.powerapps.com lists them and whether to ask before opening a tab in the background (Compare), the last five users picked in "Impersonate" and up to three the user starred, for each environment (name, email, business unit - to pick them again in one click), the tiles' names, icons and panel sections for the built-in help page and the version it was last opened in (so it opens at the top once after an update) and the version DynaBoost was last updated to until "What's new" is opened (for the dot on the help button), the id of the app the user last worked in for each Dynamics 365 environment (so the record links in "Export run" open in that app), the command bar definitions of the last five tables read by "Form as JSON" (to show them at once the next time; removed after 14 days), and - for up to two minutes - which web resource or command the user chose with "Edit in…", so the maker portal tab it opens can open that item. Everything stays in the browser. |
| `clipboardWrite` | The Copy buttons of the export and editor tabs put the result on the clipboard, and the copy button under "Say thanks" copies a wallet address. |
| `clipboardRead` | The screen code editor loads canvas YAML the user copied from Power Apps Studio, when the user opens the editor or clicks Load. |
| `offscreen` | Reading the clipboard in Manifest V3 needs an offscreen document; the page's own clipboard API is blocked by the site's permissions policy. |
| `declarativeNetRequestWithHostAccess` | "Impersonate": while the user chooses to work as another user of their own Dynamics 365 environment in one tab, the requests that environment's pages in that tab send to it get the `MSCRMCallerID` header (Dataverse's own impersonation header, honoured only for a caller with the Act on Behalf of Another User privilege). It is one session rule for that tab and that environment only – nothing is blocked or redirected, other tabs and sites are untouched – removed when the user stops it, when the tab closes, or when the browser closes. |

**Host permission justification** (one field):

> DynaBoost runs only on the Microsoft sites its tools are made for: make.powerapps.com (table export, table and column advanced options, classic explorer link, canvas screen code editor), make.powerautomate.com (edit flow, export run, expand all steps), *.dynamics.com (the user's own Dynamics 365 environments: form, workflow and journey tools, Impersonate), dev.azure.com and *.visualstudio.com (Azure DevOps: copy a work item, expand taskboards and the wiki tree; the Visual Studio Code, Marketplace and sign-in sites under visualstudio.com are excluded), and *.gateway.prod.island.powerapps.com, where Power Apps Studio runs in a frame and the screen code editor reads the open "View code" dialog. The tools act only when the user uses them; nothing is sent to any other site.

**Are you using remote code?** No. All JavaScript is in the package.

**Data usage:** DynaBoost does not transmit user data off the device. Tick
"Website content" (the tools read the page you are on) and "Personally
identifiable information" (Impersonate shows the names and emails of the
environment's users and keeps up to eight of them in the browser - favorites
and recent picks), then the three certifications: not sold to third parties,
not used for unrelated purposes, not used for creditworthiness or lending.

**Privacy policy URL:**
https://raw.githubusercontent.com/igorfashchenko/dynaboost-extension/main/store/PRIVACY.md

(The github.com page of the same file timed out in the dashboard's check; the
raw link did not.)

**Contact e-mail** (Account tab, shown on the listing): igorf.job@gmail.com

## Distribution tab

**Visibility:** Unlisted – installable only with the link; not searchable.

## Microsoft Edge Add-ons

The same package (`DynaBoost <version>` from the public repository) goes to
Partner Center → Microsoft Edge: [DynaBoost on Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/dynaboost/lcjglafhmpkbhpoejkbpdgbnfepdcecl).
"Rate DynaBoost" points to the store DynaBoost was installed from
(`DynaBoost.store`, `src/code-view.js`).

- **Properties:** category Developer tools; mature content: No.
- **Privacy:** the single purpose, the permission justifications, remote code
  (No), the data usage ticks and the privacy policy URL - the same texts as
  in the Privacy practices tab above, and the three certifications ticked.
- **Store listing (English):** the description above; logo 300×300 from
  `icons/dynaboost-source.png`; small tile 440×280 `store/promo-440x280.png`;
  large tile 1400×560 (same design); the five screenshots; search terms:
  Dynamics 365, Power Automate, Power Apps, Power Platform, Dataverse,
  Azure DevOps, Dynamics CRM.
- **Testers need an account:** Yes - certification notes:

```text
No DynaBoost account is needed - the extension has no sign-in and no server. It adds tools to Microsoft sites, so testing needs a Microsoft account with access to a Power Platform / Dynamics 365 environment. We cannot share ours (they belong to real organisations); a free one works:
- Power Apps Developer Plan (free): https://aka.ms/PowerAppsDevPlan - gives a Dataverse environment with model-driven apps, cloud flows and canvas apps.
- Azure DevOps (free organisation): https://dev.azure.com

How to test:
1. Sign in to make.powerapps.com, make.powerautomate.com, a Dynamics 365 / model-driven app (*.dynamics.com) or dev.azure.com.
2. Click the DynaBoost toolbar icon - a panel opens with the tools that work on the current page (others are hidden; "Show all" lists them). The (i) button opens the built-in help: every tool, where it works and its limits.
3. Examples: open a record form in a model-driven app and click "Form as JSON" or "Logical names"; open a cloud flow and click "Edit flow" or "Export run"; on the Tables page of make.powerapps.com click "Export table"; open a work item in Azure DevOps and click "Copy work item".

Notes:
- "Impersonate" needs the Dataverse privilege "Act on Behalf of Another User" (System Administrator has it).
- Nothing is changed without the user's click; saves (Edit flow, Edit journey, Open workflow) only write when Save is clicked.
- No data leaves the browser except the Microsoft service's own API calls with the user's existing sign-in. No remote code.
```
