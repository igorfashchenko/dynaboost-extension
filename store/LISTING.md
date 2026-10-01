# Chrome Web Store — listing and review answers

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
• Form as JSON – everything behind a model-driven form in one tab: every tab, section and field (hidden ones too) with its values; the JavaScript libraries and handlers with their code; business rules; plug-in steps, classic workflows, cloud flows, Custom APIs and business process flows that run on the table; the command bar buttons with their display and enable rules. "Edit in…" opens the right editor in the right solution.
• Edit flow – the whole cloud flow definition as JSON in a real code editor. Save runs Power Automate's own error and warning checks, refuses to overwrite a newer version and keeps a backup of every save.
• Edit screen code – canvas app YAML with syntax colours and checks, applied back to Studio in one click (Ctrl+Z undoes it).
• Impersonate – work as any user of your environment in one tab, side by side with your own. Favorites and recent users one click away.
• God mode – every hidden field shown, every locked field unlocked, every required field optional – on this page only.

POWER APPS
• Export table – any grid of the maker portal to Markdown or CSV.
• Open on All – the Tables and Apps pages open on "All" instead of "Recommended" / "My apps".
• Open advanced options – the advanced options of a new or edited table or column always open.
• Column defaults – a new column starts without form fill assistance.
• Open in classic, Advanced Find, System jobs – one click from where you are.
• My solutions – up to six shortcuts to the solutions you work in, in any environment.
• Expand tree – every branch of the Studio tree view open, folded back when you are done.

POWER AUTOMATE
• Edit flow – see above.
• Export run – a whole run in one readable tab: the trigger and every action with inputs, outputs, timing and errors.
• Expand all steps – every condition, scope and loop open, in the designer and in run history.

DYNAMICS 365
• Form as JSON, Impersonate, God mode – see above.
• Edit form – the form designer, in the unmanaged solution that holds the form.
• Logical names – the logical name under every field label, one click to copy.
• Copy record – a new record filled with this one's values; nothing is saved until you save.
• Open workflow – a classic workflow written out in words, and its XAML editable in drafts.
• Edit journey – the definition of a real-time journey (Customer Insights – Journeys) as JSON, saved back in drafts.

AZURE DEVOPS
• Copy work item – the item and its whole comment thread as clean Markdown, with people's names replaced by "User 1", "User 2".
• Expand items – taskboards and backlogs fully expanded; rows you opened yourself are remembered.
• Expand wiki tree – the whole wiki tree open at once.

MADE FOR EVERY DAY
• One click on the toolbar icon opens the panel – it lists only the tools that work on the page you are on.
• Light and dark mode.
• Built-in help: every tool, where it works, its limits and shortcuts.
• The id of the record, table, flow or solution you are on, ready to copy.

PRIVATE BY DESIGN
• No account, no tracking, no analytics, no ads.
• Everything runs in your browser with your own sign-in. Nothing is sent to DynaBoost or any third party.
• Nothing is written without your click – and saves come with conflict checks and backups.
• Impersonate needs the Act on Behalf of Another User privilege; Dataverse enforces the user's own access.

DynaBoost is free. If it saves you time, the heart in the panel ("Say thanks") lets you leave a tip – it never asks and never reminds you.

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
| `scripting` | When the toolbar icon is clicked on a supported tab that was open before the extension was installed or updated, the panel's scripts are injected into that tab so it works without a page reload. On make.powerapps.com, when the Power Automate frame showing a cloud flow (make.powerautomate.com) did not get DynaBoost's scripts from the manifest, the same scripts are injected into that frame only. |
| `storage` | Remembers which tools are switched on, the "show all tiles" setting, light or dark mode, the host name of each Dynamics environment the user entered for "Open in classic" and "Advanced Find", backups of journey definitions saved with "Edit journey" and of flow definitions saved with "Edit flow", the user's "My solutions" shortcuts, the last five users picked in "Impersonate" and up to three the user starred, for each environment (name, email, business unit - to pick them again in one click), the tiles' names and icons for the built-in help page, and - for up to two minutes - which web resource or command the user chose with "Edit in…", so the maker portal tab it opens can open that item. Everything stays in the browser. |
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
