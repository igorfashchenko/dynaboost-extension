# Chrome Web Store — listing and review answers

Everything below is copy-paste material for the Chrome Web Store Developer
Dashboard. Keep it in sync when features or permissions change.

## Before you submit

1. **Package** – the `.zip` of the Release `v<version>` (built from `main`).
2. **Store listing** – summary and description below; screenshots from
   `store/screenshots/` plus one or two of the panel on your own environment;
   the promo tile.
3. **Privacy practices** – single purpose, a justification for every
   permission (table below), remote code: No, the data-usage ticks below.
4. **Privacy policy URL** – a public copy of `store/PRIVACY.md` with its
   current text. Update it whenever `PRIVACY.md` changes: reviewers compare it
   with what the extension does.
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

**Summary** (max 132 characters):

> Power Platform toolbelt: edit canvas screen code, export tables and flow runs, read forms, workflows and journeys, copy work items.

**Category:** Developer Tools  **Language:** English

**Description** (plain text — paste as is; the store keeps line breaks and
bullets):

```text
DynaBoost is a toolbelt for people who build and maintain Microsoft Power Platform solutions. It puts small, focused tools right where you work – in the Power Apps maker portal and Studio, in Power Automate, in Dynamics 365 model-driven apps and in Azure DevOps – so the jobs that usually take a dozen clicks, a screenshot or a support ticket take one click.

HOW IT WORKS
• Click the DynaBoost icon in the toolbar to open the panel; click it again (or press Esc) to close it. Nothing else is added to the page.
• Every tool is one tile. The panel shows only the tiles that work on the page you are on – a journey record shows journey tools, the canvas Studio shows Studio tools – and updates as you move between pages. "Show all" lists the rest.
• Action tiles run once and open their result in a new tab. Toggle tiles switch a behaviour on or off and remember it.
• Light or dark: a button in the panel's header switches; until you use it, DynaBoost follows your browser's setting. The tabs DynaBoost opens come in the same mode.
• The (i) in the panel's header opens the built-in help: every tool, where it works, its limits and shortcuts – at the tools of the page you are on.
• Tiles that work on the page you are on are full-colour cards; toggles show on / off with a small switch; with "Show all", tools for other pages sit under "On other pages", greyed out.
• Power Automate tools also work on a cloud flow opened from a solution in make.powerapps.com, where Power Apps shows the flow in a frame.
• Under the header the panel shows the id of what you are looking at – record, table, flow, solution or work item – with one-click copy.
• DynaBoost is free. If it saves you time, the heart in the panel footer ("Say thanks") lets you leave a tip – by card, PayPal, Apple Pay or Google Pay on a Stripe page, or in crypto. It never asks and never reminds you.

POWER APPS – MAKER PORTAL (make.powerapps.com)

Export table
Where: any list in the maker portal – tables, columns, choices, solutions.
What: collects the whole list, including rows you would have to scroll to, and gives it to you as Markdown or CSV.
Why: document a table's columns for a spec, a wiki page or a review in seconds, instead of screenshots or copying row by row.

Open column details (toggle)
Where: a table's columns, in the New column / Edit column panel.
What: opens "Advanced options" automatically, so Schema name, Auto number, Searchable and the other advanced settings are always in view. Works in the common Power Apps UI languages.
Why: no more expanding the same section every time you check or create a column.

Open on All (toggle)
Where: the Tables and Apps pages of make.powerapps.com.
What: opens Tables on "All" instead of "Recommended" and Apps on "All" instead of "My apps" – in every environment, each time you come to the page. A tab you pick yourself stays until you leave.
Why: see every table and app at once, without the extra click each time.

Open in classic
Where: inside a solution.
What: opens the classic solution explorer for the solution you are in – the right solution, not the generic root. It asks for the environment's address once and remembers it.
Why: the parts of Dataverse that still live in the classic UI are one click away.

Advanced Find
Where: any Dynamics 365 model-driven app, and make.powerapps.com inside an environment.
What: opens the classic Advanced Find of that environment in a new tab. In the maker portal it finds the environment's org address the same way as Open in classic – remembered, from the portal's own environment list, or asked once.
Why: build a query across any table in two clicks, from wherever you are.

System jobs
Where: any Dynamics 365 model-driven app, and make.powerapps.com inside an environment.
What: opens the environment's System Jobs – every workflow run, Dataverse step of a flow and bulk job, with its status and error – in a new tab.
Why: when something did not happen after a save, this is where it says why; no more digging through Settings.

My solutions
Where: at the top of the panel on every site DynaBoost works on – the Power Apps and Power Automate maker portals, Dynamics 365 and Azure DevOps (from Azure DevOps a shortcut opens in a new tab).
What: up to six one-click shortcuts to the solutions you keep going back to, each remembering its environment. Pin the solution you are in, or paste a link; drag to reorder, rename or remove on hover. Shortcuts follow your Chrome profile to your other computers.
Why: jump straight into the solution you work in – in the right environment – from anywhere, instead of going through the environment picker and the solutions list every time.

POWER APPS STUDIO – CANVAS APPS AND CUSTOM PAGES

Edit screen code
Where: Power Apps Studio, with "View code" open on a screen or control.
What: Studio's code view is read-only; this opens the same YAML in an editor. "Apply to Studio" replaces the controls in Studio for you – same container, same position – or a whole screen, after checking for the mistakes that make Studio reject a paste. Ctrl+Z in Studio undoes it; nothing is saved until you save in Studio.
Why: rework a component or a screen – by hand or from a template – in one click.

Expand tree (toggle)
Where: Power Apps Studio, Tree view.
What: opens every branch of the tree at once. Switch it off and it closes exactly what it opened.
Why: see the whole structure of a screen without clicking every container open.

POWER AUTOMATE (make.powerautomate.com)

Expand all steps (toggle)
Where: a cloud flow – in the designer and in a run.
What: opens every Condition, its Yes/No branches, Scopes and Apply to each loops as they appear, so the flow reads top to bottom. Switch it off and they collapse again.
Why: understand or review a flow without clicking open every card.

Export run
Where: a flow run.
What: opens one read-only tab with the whole run – the trigger and every action, including the ones nested in conditions and scopes – with status, timing, inputs, outputs and errors. Copy everything or download it as JSON. It reads what the portal has already loaded; it makes no extra calls and never touches your sign-in token.
Why: debug a failed run, attach it to a ticket or compare two runs without expanding each action. (Iterations inside Apply to each are listed, not expanded.)

Edit flow
Where: a cloud flow – its details page, the designer or a run.
What: the flow's definition and connection references as JSON: edit, format, copy, download and save back. Save runs the designer's own error and warning checks, refuses a flow changed in the meantime and keeps a backup of the version it replaces. The requests are made by the Power Automate page with its own sign-in; DynaBoost never reads your token.
Why: rename actions, bulk-edit expressions or move steps between flows – as text, with the designer's own checks.

DYNAMICS 365 – MODEL-DRIVEN APPS (*.dynamics.com)

Form as JSON
Where: any record form.
What: everything on the form in one tab – every tab, section and control, hidden ones included – with the record's values, choice lists with numbers and linked lookups; views Form, Fields, Choices and JSON. The Logic strip adds what runs behind it: scripts and their handlers ("View code" opens the function), business rules, automations (plug-in steps, workflows, cloud flows, actions, Custom APIs, business process flows) and the command bars with their rules in plain words. Fields something fires on carry small icons; "Edit in…" opens a component's editor in the solution you pick.
Why: answer "what is on this form and what fires when it changes" in one place – for specs, data mapping, debugging and bug reports.

Edit form
Where: a record in a Dynamics 365 model-driven app.
What: opens the very form you are looking at in the form designer of make.powerapps.com, in the unmanaged solution of yours it belongs to (or the one pinned in My solutions, when it is in several); the Default Solution only when there is no other.
Why: from "this field is in the wrong place" to the designer in one click, in the right solution.

Logical names
Where: any record form (a switch – it stays on until you turn it off).
What: puts each field's logical name in a small badge under its label; click a badge to copy the name. It follows the form as you switch tabs and records.
Why: the schema name you need for code, a flow or a filter, without opening the form designer.

God mode
Where: any record form (a switch for this page only – a reload or another record finds it off).
What: while on, every hidden field, section and tab is shown, every locked field unlocked and every required one optional – and kept so while the form's own scripts and rules work; switch it off and the form is as it was. While it is on, a gold frame with a faint haze from the window's edges and a "God mode on ×" tab on its top edge say so – the middle of the form stays as it is and nothing gets in the way of a click; the × switches it off. Nothing is saved by it.
Why: see and test what the form keeps from you, without editing the form.

Copy record
Where: any saved record.
What: opens a new, unsaved record of the same table on the same form in a new tab, filled with this record's values and its name starting "[copy] " (so copies sort to the top of a view by name) – you look it over and save. Columns a new row cannot take (formula, calculated, system), the status, the owner, autonumbers and process fields are left out; dates, lookups and choices go over as they are.
Why: a similar record in seconds, without retyping – and nothing is written until you save.

Impersonate
Where: any page of a Dynamics 365 model-driven app (a switch for this tab).
What: work in this tab as another user – their records, access and saves. Search any word of a name, email or user name; up to 3 favorites (★) and recent users wait on top; one click or Enter. One request first checks that Dataverse lets you (the Act on Behalf of Another User privilege), then the page reloads as them. Other tabs stay you. A blue frame with a faint haze and an "Impersonating …" label at the bottom say who you are – click the name to switch, × to stop.
Why: test a role, form or view as the person who reported the problem, without their password.

Open workflow
Where: a classic workflow (the classic workflow editor or the solution explorer).
What: reads the process and writes its logic out step by step – conditions, branches and actions – with field and choice labels instead of internal names. A second view shows the XAML in an editor; for a draft workflow you can paste a changed version and save it back. Saving is guarded: drafts only, a backup of the original is downloaded first, a change made by someone else in the meantime is detected, and the workflow's internal class name is fixed up for you.
Why: document, review or compare classic workflows without opening "View properties" on every step, and make bulk edits to a workflow's definition.

Edit journey
Where: a Customer Insights – Journeys (real-time) journey record.
What: opens the journey's definition – every step, branch and condition – as JSON. Copy it, download it, format it. For a Draft journey you can edit it and save it back; live and stopped journeys stay read-only. Saving checks that nobody changed the journey since you opened it and keeps the previous versions as backups in your browser. Publishing stays in the journey designer.
Why: inspect, back up, compare or bulk-edit a complex journey without clicking through the canvas.

AZURE DEVOPS (dev.azure.com and *.visualstudio.com)

Copy work item
Where: any work item – on a board, a backlog, in query results, the full form or the dialog over a board.
What: reads the work item and puts a clean Markdown document on your clipboard with just the content: the title, every rich-text section (Description, Acceptance criteria, Repro steps, custom fields) and the whole comment thread – no State, Area, Iteration, related links or other tracking data. Images become numbered placeholders, with the files offered for download under the same names.
Why: hand a work item to a colleague or a document with all its context, in one paste.

Expand items (toggle)
Where: Azure DevOps – Sprints, on the Taskboard; and on backlogs – Boards → Backlogs and Sprints → Backlog.
What: opens every item on the taskboard – including the ones that load as you scroll – on every sprint, and expands a backlog down to its last level. Switch it off and it closes them again, except the items you had opened yourself.
Why: see every story with its tasks at once in stand-ups and planning, and get back to your own view with one click.

Expand wiki tree (toggle)
Where: an Azure DevOps wiki.
What: opens every page in the wiki's tree, paced so it does not flood the server. Switch it off and it closes what it opened; pages you opened yourself stay open.
Why: see the whole wiki structure at a glance and find pages without clicking level by level.

PRIVACY
DynaBoost has no server, no analytics and no tracking. Everything runs in your browser; the only requests it makes go to the Microsoft service you already have open, with your existing sign-in. The "Say thanks" link opens Stripe's own payment page in a new tab only when you click it. Tools that write back (saving a draft workflow, journey or flow, applying code in Studio) do so only when you click to do it. Edit flow's requests are made by the Power Automate page itself, with its own sign-in, which DynaBoost never reads, stores or sends.

DynaBoost is an independent tool and is not affiliated with or endorsed by Microsoft. Microsoft, Power Apps, Power Automate, Dynamics 365 and Azure DevOps are trademarks of the Microsoft group of companies.
```

**Graphics:**
- Store icon 128×128: `icons/icon128.png`
- Small promo tile 440×280: `store/promo-440x280.png`
- Screenshots 1280×800 (1 to 5). Ready in `store/screenshots/`: the built-in
  help (light), Impersonate in the help (dark), a search across the tools.
  Add one or two of your own environment – F12, device toolbar
  (Ctrl+Shift+M), 1280×800, then ⋮ → "Capture screenshot": the panel open on
  make.powerapps.com, the Edit screen code tab, Form as JSON.

## Privacy practices tab

**Single purpose:**

> Productivity tools for people who build and maintain Microsoft Power Platform, Dynamics 365 and Azure DevOps solutions, shown as tiles in one panel on those sites.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `scripting` | When the toolbar icon is clicked on a supported tab that was open before the extension was installed or updated, the panel's scripts are injected into that tab so it works without a page reload. On make.powerapps.com, when the Power Automate frame showing a cloud flow (make.powerautomate.com) did not get DynaBoost's scripts from the manifest, the same scripts are injected into that frame only. |
| `storage` | Remembers which tools are switched on, the "show all tiles" setting, light or dark mode, the host name of each Dynamics environment the user entered for "Open in classic" and "Advanced Find", backups of journey definitions saved with "Edit journey" and of flow definitions saved with "Edit flow", the user's "My solutions" shortcuts, the last five users picked in "Impersonate" and up to three the user starred, for each environment (name, email, business unit - to pick them again in one click), the tiles' names and icons for the built-in help page, and - for up to two minutes - which web resource or command the user chose with "Edit in…", so the maker portal tab it opens can open that item. |
| `clipboardWrite` | The Copy buttons of the export and editor tabs put the result on the clipboard, and the copy button under "Say thanks" copies a wallet address. |
| `clipboardRead` | The screen code editor loads canvas YAML the user copied from Power Apps Studio, when the user opens the editor or clicks Load. |
| `offscreen` | Reading the clipboard in Manifest V3 needs an offscreen document; the page's own clipboard API is blocked by the site's permissions policy. |
| `declarativeNetRequestWithHostAccess` | "Impersonate": while the user chooses to work as another user of their own Dynamics 365 environment in one tab, the requests that environment's pages in that tab send to it get the `MSCRMCallerID` header (Dataverse's own impersonation header, honoured only for a caller with the Act on Behalf of Another User privilege). It is one session rule for that tab and that environment only – nothing is blocked or redirected, other tabs and sites are untouched – removed when the user stops it, when the tab closes, or when the browser closes. |
| Host `make.powerapps.com` | Tools for Power Apps: table export, column details, classic explorer link, canvas screen code editor. |
| Host `make.powerautomate.com` | Tools for Power Automate: expand all steps, export of a flow run. |
| Host `*.dynamics.com` | Tools for model-driven apps in the user's own Dynamics 365 environments (form, workflow, journey). |
| Host `dev.azure.com` | Tools for Azure DevOps: copy a work item, expand the wiki tree. |
| Host `*.visualstudio.com` | The same Azure DevOps tools for organizations still on their older address, `{org}.visualstudio.com`. The Visual Studio Code, Marketplace and sign-in sites under that domain are excluded. |
| Host `*.gateway.prod.island.powerapps.com` (content script) | Power Apps Studio runs in this iframe; the screen code editor reads the open "View code" dialog and replaces controls in the tree view there. |

**Are you using remote code?** No. All JavaScript is in the package.

**Data usage:** DynaBoost does not transmit user data off the device. Tick
"Website content" (the tools read the page you are on) and "Personally
identifiable information" (Impersonate shows the names and emails of the
environment's users and keeps up to eight of them in the browser - favorites
and recent picks), then the three certifications: not sold to third parties,
not used for unrelated purposes, not used for creditworthiness or lending.

**Privacy policy URL:**
https://github.com/igorfashchenko/dynaboost-extension/blob/main/store/PRIVACY.md

**Contact e-mail** (Account tab, shown on the listing): igorf.job@gmail.com

## Distribution tab

**Visibility:** Unlisted – installable only with the link; not searchable.
