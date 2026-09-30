/* DynaBoost - the help page (src/help.html), opened by the (i) in the panel:
 * help.html?here=<ids>[&theme=dark]. The tiles of that page are marked and
 * listed first; their names and icons come from chrome.storage.local
 * (dynaboost.helpTiles). One line per fact; a fact starting with "!" is a
 * limit.
 */
(function () {
  const TILES_KEY = 'dynaboost.helpTiles';
  const params = new URLSearchParams(location.search);
  const here = new Set((params.get('here') || '').split(',').filter(Boolean));
  const dark = params.has('theme') ? params.get('theme') === 'dark' : !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);

  const svg = (d) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const SITE_ICON = {
    start: svg('<circle cx="12" cy="12" r="8.5"/><path d="m14.8 9.2-1.9 4.7-4.7 1.9 1.9-4.7z"/>'),
    panel: svg('<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M4 9h16M9 9v11"/>'),
    'power-apps': svg('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
    studio: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
    'power-automate': svg('<circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="12" r="2.2"/><circle cx="6" cy="18" r="2.2"/><path d="M8 7l8 4M8 17l8-4"/>'),
    dynamics: svg('<path d="M4 20V8l8-4 8 4v12"/><path d="M9 20v-6h6v6M8 10h.01M12 10h.01M16 10h.01"/>'),
    devops: svg('<rect x="4" y="5" width="4.5" height="14" rx="1"/><rect x="10" y="5" width="4.5" height="9" rx="1"/><rect x="16" y="5" width="4" height="11" rx="1"/>'),
    privacy: svg('<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
    trouble: svg('<path d="M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.4 2.4-2.6-.4-.4-2.6z"/>'),
    news: svg('<path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>')
  };
  const PIN_ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="5" width="7" height="6" rx="1.5" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<rect x="13" y="5" width="7" height="6" rx="1.5" stroke="#3D8BFF" stroke-width="1.6"/><rect x="4" y="13" width="7" height="6" rx="1.5" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M16.5 13.5v5M14 16h5" stroke="#E3B04B" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const LOOK = svg('<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>');

  // The tiles' names, as the panel shows them.
  const NAMES = {
    'table-export': 'Export table', 'open-all': 'Open on All', 'auto-advanced': 'Open column details', 'classic-open': 'Open in classic',
    'canvas-code': 'Edit screen code', 'canvas-tree': 'Expand tree', 'flow-edit': 'Edit flow', 'flow-run-export': 'Export run',
    'expand-all': 'Expand all steps', 'form-dump': 'Form as JSON', 'form-editor': 'Edit form', 'logical-names': 'Logical names',
    'god-mode': 'God mode', 'copy-record': 'Copy record', impersonate: 'Impersonate', 'advanced-find': 'Advanced Find',
    'system-jobs': 'System jobs', workflow: 'Open workflow', journey: 'Edit journey', 'ado-workitem': 'Copy work item',
    'ado-taskboard-expand': 'Expand items', 'wiki-expand': 'Expand wiki tree'
  };

  // kind: action | switch | switch-on (on by default) | page (this page only) | tab (this tab only) | panel
  const KIND = {
    action: ['Action', ''],
    switch: ['Switch · remembered', 'sw'],
    'switch-on': ['Switch · on by default', 'sw'],
    page: ['Switch · this page only', 'one'],
    tab: ['Switch · this tab only', 'one'],
    panel: ['In the panel', '']
  };

  const SECTIONS = [
    {
      id: 'start',
      name: 'Getting started',
      facts: [
        'The toolbar icon opens and closes the panel; <kbd>Esc</kbd> closes it too.',
        'Only the tiles for the current page are listed; <b>Show all</b> in the footer shows the rest.',
        '<b>Action</b> tiles run once. <b>Switches</b> remember their state – except “this page only” and “this tab only”.',
        'The id under the header (record, table, flow, run, solution, work item…) copies on click.',
        'Light / dark follows the browser until you pick one; a later change in the browser wins. Tabs DynaBoost opens follow the panel.',
        '<b>(i)</b> opens this page at the current page’s tools; <kbd>/</kbd> jumps to the search.',
        'Sites: make.powerapps.com, make.powerautomate.com, *.dynamics.com, dev.azure.com, {org}.visualstudio.com.',
        'Power Automate tiles also work on a flow opened from a solution in make.powerapps.com, where it is shown in a frame.',
        'Tabs open before an install or update get DynaBoost on the first click of the icon – no reload.'
      ]
    },
    {
      id: 'panel',
      name: 'In the panel',
      tools: [
        {
          id: 'solution-pins',
          name: 'My solutions',
          kind: 'panel',
          icon: PIN_ICON,
          where: 'the top of the panel, on every site',
          what: 'One-click shortcuts to solutions, each in its own environment.',
          facts: [
            '!Up to <b>6</b> shortcuts – 3, then 3 more.',
            'In a solution <b>[+]</b> pins it; anywhere else [+] takes a pasted solution link.',
            '!One shortcut per solution, matched by its address – a rename does not hide a duplicate.',
            '<kbd>Ctrl</kbd>+click or middle click: new tab. Drag to reorder; hover for ✎ and ✕. Renaming an environment renames all its shortcuts.',
            'From Azure DevOps a shortcut opens in a new tab.',
            'Synced with your Chrome profile.'
          ]
        }
      ]
    },
    {
      id: 'power-apps',
      name: 'Power Apps',
      sub: 'make.powerapps.com',
      tools: [
        {
          id: 'table-export',
          kind: 'action',
          where: 'any list in the maker portal – tables, columns, choices, solutions',
          what: 'The whole list as Markdown or CSV – copy or download.',
          facts: ['Scrolls the list itself, so rows off screen are included.', '!Takes the biggest grid on the page, with the columns it shows.']
        },
        {
          id: 'open-all',
          kind: 'switch-on',
          where: 'the Tables and Apps pages',
          what: 'Tables opens on <b>All</b> instead of “Recommended”, Apps on <b>All</b> instead of “My apps”.',
          facts: [
            'Every environment, every visit. A tab you pick yourself stays until you leave the page.',
            'Clicks only the “All” next to its known neighbours – any other “All” (a type filter) is left alone.',
            '!UI languages: EN, PL, DE, FR, ES, IT, NL – in others it does nothing.'
          ]
        },
        {
          id: 'auto-advanced',
          kind: 'switch-on',
          where: 'a table’s New column / Edit column panel',
          what: 'Opens “Advanced options”, so Schema name, Auto number and Searchable are in view.',
          facts: ['!UI languages: EN, PL, DE, FR, ES, IT, NL.']
        },
        {
          id: 'classic-open',
          kind: 'action',
          where: 'inside a solution',
          what: 'The classic solution explorer on that solution.',
          facts: [
            'The org address (e.g. yourorg.crm4.dynamics.com) comes from the portal, or is asked once per environment – synced.',
            '!Opens the solution root – the classic explorer cannot open on a single table.'
          ]
        }
      ]
    },
    {
      id: 'studio',
      name: 'Power Apps Studio',
      sub: 'canvas apps and custom pages',
      tools: [
        {
          id: 'canvas-code',
          kind: 'action',
          where: 'Studio, with <b>View code</b> open on a screen or a control',
          what: 'View code’s read-only YAML in an editor – and back into Studio in one click.',
          facts: [
            'Reads the open View code; without it, the clipboard.',
            '<b>Apply to Studio</b> deletes the controls named at the top of the code – renamed ones too – and pastes the new ones in the same container and position.',
            '!A whole screen (<code>Screens:</code>) gets its controls replaced, not its own name or properties.',
            '!Pre-checks only tabs, indentation, duplicate names and a colon in a formula – Studio reports the rest.',
            'After Apply: reports controls Studio did not create (a control type or version the app lacks), restores the tree view, selects the new control.',
            '<kbd>Ctrl</kbd>+<kbd>Z</kbd> in Studio undoes it; nothing is saved until you Save in Studio.'
          ]
        },
        {
          id: 'canvas-tree',
          kind: 'switch',
          where: 'Studio, Tree view',
          what: 'Opens every branch of the tree.',
          facts: ['Off: closes exactly what it opened.']
        }
      ]
    },
    {
      id: 'power-automate',
      name: 'Power Automate',
      sub: 'make.powerautomate.com, and a flow opened from a solution in make.powerapps.com',
      tools: [
        {
          id: 'flow-edit',
          kind: 'action',
          where: 'a cloud flow – details, designer or a run',
          what: 'Definition and connection references as JSON – edit, format, save back.',
          facts: [
            '<b>Validate</b> / <b>Save</b> run the designer’s own checks: errors block, warnings are asked about (click one to jump to the action).',
            '!Checks unavailable – no save. Flow changed meanwhile (designer, another tab) – save refused.',
            'Before each save a backup: 10 newest, all flows. <b>Versions</b>: the original + the last 5 saves of this tab.',
            '!Versions live in the editor tab; closing it with unsaved edits or more than 3 versions asks first.',
            'Keeps working when the Power Automate tab is reloaded or closed – any open Power Automate tab will do.',
            '<kbd>Ctrl</kbd>+<kbd>S</kbd> saves.',
            'Calls go through the Power Automate page’s own sign-in; the token never reaches DynaBoost.'
          ]
        },
        {
          id: 'flow-run-export',
          kind: 'action',
          where: 'a flow run',
          what: 'The whole run in one tab: trigger and every action, nested ones too, with status, timing, inputs, outputs, errors – copy or download.',
          facts: [
            'No extra calls, except large inputs / outputs fetched from their own links (6 at a time).',
            '!Those links expire after a few hours – an older run may miss them.',
            '!Apply to each: iterations listed, not expanded.'
          ]
        },
        {
          id: 'expand-all',
          kind: 'switch',
          where: 'a cloud flow – the designer and a run',
          what: 'Opens every Condition, branch, Scope and Apply to each as they appear.',
          facts: ['Leaves card menus, choice lists and DynaBoost’s own panel alone.']
        }
      ]
    },
    {
      id: 'dynamics',
      name: 'Dynamics 365',
      sub: 'model-driven apps on *.dynamics.com',
      tools: [
        {
          id: 'form-dump',
          kind: 'action',
          where: 'any record form',
          what: 'Every tab, section and control of the form – hidden ones too – with the saved values.',
          facts: [
            'Views: Form, Fields, Choices, JSON; <b>whole entity</b> adds the columns that are not on the form.',
            '<b>Logic</b>: scripts and handlers (<b>View code</b> jumps to the function), business rules, plug-in steps, workflows, cloud flows, actions, Custom APIs, BPFs, and the command bars with their rules in words.',
            '!Handlers attached in code are found only when written plainly.',
            'Icons on a field show what fires on it; click one to open it.',
            '<b>Edit in…</b> opens the editor in a solution you pick.',
            '!The Default Solution only after a warning; managed solutions greyed out.'
          ]
        },
        {
          id: 'form-editor',
          kind: 'action',
          where: 'a record',
          what: 'This form in the make.powerapps.com form designer.',
          facts: ['Opens in your unmanaged solution holding the form; in several, the one pinned in My solutions.', '!The Default Solution only as the last resort.']
        },
        {
          id: 'logical-names',
          kind: 'switch',
          where: 'record forms',
          what: 'Each field’s logical name in a badge under its label; click to copy.',
          facts: []
        },
        {
          id: 'god-mode',
          kind: 'page',
          where: 'a record form',
          what: 'Shows hidden fields, sections and tabs, unlocks fields, makes required ones optional – and keeps it while the form’s scripts run.',
          facts: [
            'Off, a reload or another record: the form as it was.',
            'Saves nothing; a save still goes through the server’s rules.',
            '!Stays locked: calculated, rollup, formula and system columns, field security, read-only records – the message says which and why.'
          ]
        },
        {
          id: 'copy-record',
          kind: 'action',
          where: 'a saved record',
          what: 'A new, unsaved copy on the same form in a new tab; its name starts “[copy] ”.',
          facts: [
            'Values from the form as it is now – unsaved changes included.',
            '!Only the columns on the form.',
            '!Left out: columns a new row cannot take (formula, calculated, rollup, system), status, owner, autonumbers, process fields.',
            'OnChange does not run while it fills in.',
            '!The new tab has a minute to pick the copy up.'
          ]
        },
        {
          id: 'impersonate',
          kind: 'tab',
          where: 'any page of a model-driven app',
          what: 'This tab works as another user – their data, access and saves.',
          facts: [
            '!Needs <b>Act on Behalf of Another User</b> (Business Management → Miscellaneous; in the Delegate role) – checked before anything changes.',
            'This tab only; a tab opened from it follows it.',
            'Search any words in any order – name, email, user name; a user id works.',
            '!Enabled people only – no application, support or partner accounts.',
            '★ up to <b>3</b> favorites, plus the last 5 users – per environment.',
            'Ends on ×, when the tab or the browser closes, or when DynaBoost updates.',
            'Saves are marked in Dataverse as made on your behalf.',
            '!The app’s start-up – some menus, scripts that read the roles – may still follow you.',
            'Unsaved changes may block the reload; the tab already runs as the user.'
          ]
        },
        {
          id: 'advanced-find',
          kind: 'action',
          where: 'model-driven apps, and make.powerapps.com inside an environment',
          what: 'The environment’s classic Advanced Find, in a new tab.',
          facts: ['In the maker portal the org address comes from the portal, or is asked once.']
        },
        {
          id: 'system-jobs',
          kind: 'action',
          where: 'model-driven apps, and make.powerapps.com inside an environment',
          what: 'All System Jobs – workflow runs, Dataverse steps of flows, bulk jobs – with status and error, in a new tab.',
          facts: []
        },
        {
          id: 'workflow',
          kind: 'action',
          where: 'a classic workflow – its classic editor or the solution explorer',
          what: 'The logic as readable steps, with field and choice labels – and the XAML in an editor.',
          facts: [
            'Pasted XAML is previewed as steps before saving.',
            '!Saves only a draft, unmanaged definition – deactivate first.',
            'On save: the original is downloaded, a concurrent change is caught, the class name is fixed.',
            '<kbd>Ctrl</kbd>+<kbd>S</kbd> saves; refresh the classic designer to see it.'
          ]
        },
        {
          id: 'journey',
          kind: 'action',
          where: 'a Customer Insights – Journeys (real-time) journey',
          what: 'The journey’s definition as JSON – copy, download, format, edit.',
          facts: ['!Saves only a Draft journey, and not when it changed since you opened it.', 'Backups: 10 newest, in the browser.', '!Publishing stays in the designer.']
        }
      ]
    },
    {
      id: 'devops',
      name: 'Azure DevOps',
      sub: 'dev.azure.com and {org}.visualstudio.com',
      tools: [
        {
          id: 'ado-workitem',
          kind: 'action',
          where: 'any work item – board, backlog, query, the form or the dialog over a board',
          what: 'The work item as Markdown on the clipboard: title and type, every rich-text field, all comments.',
          facts: [
            '!Content only – no state, assignee, dates, area, iteration, tags, priority, estimates or links.',
            'Read through the API, so long descriptions and all comments are complete.',
            'Images become numbered placeholders (image-1.png …) with the files offered for download; <b>Copy with images</b> puts them inline (base64).'
          ]
        },
        {
          id: 'ado-taskboard-expand',
          kind: 'switch',
          where: 'Sprints → Taskboard; Boards → Backlogs; Sprints → Backlog',
          what: 'Taskboard: every item open, the ones loaded on scroll too, on every sprint. Backlogs: expanded to the last level.',
          facts: [
            'Off: closes all but the items you opened yourself – remembered per sprint, across reloads.',
            '!Remembers the last 30 sprints.',
            'An item you close while it is on stays closed.',
            'Backlogs: expanded once per visit.'
          ]
        },
        {
          id: 'wiki-expand',
          kind: 'switch',
          where: 'a wiki',
          what: 'Opens every page in the wiki’s tree.',
          facts: ['!Paced – every level loads from the server, so a big wiki takes a while.', 'Off: closes only what it opened.']
        }
      ]
    },
    {
      id: 'privacy',
      name: 'Privacy & permissions',
      facts: [
        'No server, analytics or tracking; requests go only to the Microsoft service you have open, with your sign-in.',
        'Writes only on your click – a flow, a draft workflow or journey, code applied in Studio. Impersonate adds one header to one tab.',
        'Stored in the browser: switch states, light / dark, org addresses, My solutions (Chrome sync), flow and journey backups, Impersonate favorites and recent users.',
        'The clipboard is read only by the screen code editor.',
        'Permissions: storage, scripting, clipboard, offscreen, declarativeNetRequestWithHostAccess (Impersonate).'
      ]
    },
    {
      id: 'trouble',
      name: 'If something does not work',
      facts: ['The panel does not open: only on the sites in Getting started – otherwise reload the page.', 'A new tab did not open: allow pop-ups for the site.']
    },
    {
      id: 'news',
      name: 'What’s new',
      facts: [
        '<b>2.37</b> – this help, behind (i) in the panel.',
        '<b>2.36</b> – Open on All: Tables and Apps open on All.',
        '<b>2.35</b> – Impersonate: 3 favorites; a blue frame with a faint haze.',
        '<b>2.34</b> – Impersonate: work in one tab as another user.'
      ]
    }
  ];

  const CSS =
    '*{box-sizing:border-box}' +
    'body{margin:0;font:14px/1.55 "Segoe UI",system-ui,sans-serif;color:var(--dbc-fg-10224e);background:var(--dbc-bg-f5f7fc)}' +
    'header{padding:18px 28px 16px}' +
    'header .top{display:flex;align-items:center;gap:14px}' +
    'header .mark{width:34px;height:34px;border-radius:7px;flex:none}' +
    'header h1 .ver{margin-left:8px;font-size:12.5px;font-weight:400;color:var(--dbc-fg-56637f)}' +
    '.wrap{display:grid;grid-template-columns:300px minmax(0,1fr);align-items:start;max-width:1320px;margin:0 auto}' +
    'nav{position:sticky;top:0;max-height:100vh;overflow:auto;padding:16px 14px 40px 18px;border-right:1px solid var(--dbc-bd-dde3f0)}' +
    '.find{position:relative;margin-bottom:6px}' +
    '.find svg{position:absolute;left:10px;top:50%;width:15px;height:15px;transform:translateY(-50%);color:var(--dbc-fg-56637f)}' +
    '.find input{width:100%;padding:8px 10px 8px 32px;border:1px solid var(--dbc-bd-c6d0e4);border-radius:7px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);font:inherit;font-size:13.5px}' +
    '.find input:focus{outline:none;border-color:var(--dbc-bd-1e6bff);box-shadow:0 0 0 1px var(--dbc-bd-1e6bff)}' +
    '.ng{margin:16px 4px 6px;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--dbc-fg-56637f)}' +
    // A block per group: a header on a tinted band, its tools under a guide line.
    '.grp{margin:0 0 8px;padding:4px;border:1px solid var(--dbc-bd-dde3f0);border-radius:10px;background:var(--dbc-bg-fff)}' +
    '.grp.here{border-left:3px solid var(--dbc-bd-1c9b4a)}' +
    'nav a{display:flex;align-items:center;gap:9px;padding:5px 8px;border-radius:6px;color:var(--dbc-fg-10224e);text-decoration:none;font-size:13.5px;line-height:1.3}' +
    'nav a:hover{background:var(--dbc-bg-eef2f9)}' +
    'nav a svg{flex:none;width:18px;height:18px}' +
    'nav a.ns{padding:7px 8px;background:var(--dbc-bg-f1f3f8);font-weight:700;font-size:13.5px}' +
    'nav a.ns svg{color:var(--dbc-fg-1e6bff)}' +
    'nav a.ns:hover{background:var(--dbc-bg-e9f1ff)}' +
    'nav a.ns.cur{background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-1e6bff)}' +
    'nav .grp.solo{padding:4px}' +
    'nav .cnt{margin-left:auto;min-width:22px;padding:0 6px;border:1px solid var(--dbc-bd-dde3f0);border-radius:9px;background:var(--dbc-bg-fff);color:var(--dbc-fg-56637f);font-size:11px;font-weight:600;line-height:17px;text-align:center}' +
    '.items{margin:4px 0 2px 17px;padding-left:7px;border-left:2px solid var(--dbc-bd-dde3f0)}' +
    '.grp.here .items,.items.flat{margin:0;padding:0;border-left:0}' +
    'nav a.nt{padding:5px 8px}' +
    'nav a.on{background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-1e6bff);font-weight:600;box-shadow:inset 3px 0 0 var(--dbc-bd-1e6bff)}' +
    'nav a .dot{flex:none;margin-left:auto;width:7px;height:7px;border-radius:50%;background:var(--dbc-bg-1c9b4a)}' +
    'nav .hide,main .hide{display:none}' +
    'main{min-width:0;padding:22px 34px 90px}' +
    '.legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin:0 0 22px;font-size:12.5px;color:var(--dbc-fg-56637f)}' +
    '.legend span{display:inline-flex;align-items:center;gap:6px}' +
    '.legend i{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--dbc-bg-e3b04b)}' +
    '.legend i.h{background:var(--dbc-bg-1c9b4a)}' +
    'section{margin:0 0 34px;scroll-margin-top:14px}' +
    'section>h2{display:flex;align-items:center;gap:10px;margin:0;font-size:21px;line-height:1.3}' +
    'section>h2 svg{width:22px;height:22px;flex:none;color:var(--dbc-fg-1e6bff)}' +
    'section>.sub{margin:2px 0 0 32px;font-size:13px;color:var(--dbc-fg-56637f)}' +
    'section>ul.facts{margin:12px 0 0;padding:14px 18px 14px 34px;border:1px solid var(--dbc-bd-dde3f0);border-radius:10px;background:var(--dbc-bg-fff)}' +
    '.tool{margin:12px 0 0;padding:15px 18px 14px;border:1px solid var(--dbc-bd-dde3f0);border-radius:10px;background:var(--dbc-bg-fff);scroll-margin-top:14px}' +
    '.tool.here{border-left:3px solid var(--dbc-bd-1c9b4a);padding-left:16px}' +
    '.th{display:flex;align-items:center;gap:10px;flex-wrap:wrap}' +
    '.th .ic{display:inline-flex;width:28px;height:28px}' +
    '.th .ic svg{width:100%;height:100%}' +
    '.th h3{margin:0;font-size:16.5px;line-height:1.3}' +
    '.kind{padding:1px 9px;border-radius:10px;font-size:11.5px;font-weight:600;background:var(--dbc-bg-f1f3f8);color:var(--dbc-fg-56637f)}' +
    '.kind.sw{background:var(--dbc-bg-e9f1ff);color:var(--dbc-fg-1e4fb8)}' +
    '.kind.one{background:var(--dbc-bg-fdf1d6);color:var(--dbc-fg-7a5410)}' +
    '.kind.here{background:var(--dbc-bg-e4f4e8);color:var(--dbc-fg-1c6b32)}' +
    '.where{margin:6px 0 0;font-size:13px;color:var(--dbc-fg-56637f)}' +
    '.where b{color:var(--dbc-fg-10224e);font-weight:600}' +
    '.what{margin:6px 0 0}' +
    'ul.facts{margin:8px 0 0;padding-left:20px}' +
    'ul.facts li{margin:4px 0}' +
    'ul.facts li::marker{color:var(--dbc-fg-97a5c6)}' +
    'ul.facts li.lim::marker{color:var(--dbc-fg-e3b04b)}' +
    'kbd{display:inline-block;min-width:20px;padding:0 5px;border:1px solid var(--dbc-bd-c6d0e4);border-bottom-width:2px;border-radius:4px;background:var(--dbc-bg-f1f3f8);font:600 11.5px/18px "Segoe UI",system-ui,sans-serif;text-align:center;color:var(--dbc-fg-10224e)}' +
    'code{font:12.5px ui-monospace,Consolas,monospace}' +
    '.empty{padding:26px 4px;color:var(--dbc-fg-56637f)}' +
    '@media (max-width:860px){.wrap{grid-template-columns:1fr}nav{position:static;max-height:none;border-right:0;border-bottom:1px solid var(--dbc-bd-dde3f0);padding:14px 16px}main{padding:18px 16px 60px}}';

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function factsHtml(list) {
    if (!list || !list.length) return '';
    return (
      '<ul class="facts">' +
      list.map((f) => (f[0] === '!' ? '<li class="lim">' + f.slice(1) + '</li>' : '<li>' + f + '</li>')).join('') +
      '</ul>'
    );
  }

  function build(tiles) {
    const nameOf = (t) => t.name || NAMES[t.id] || (tiles[t.id] && tiles[t.id].name) || t.id;
    const iconOf = (t) => t.icon || (tiles[t.id] && tiles[t.id].icon) || '';
    const all = [];
    SECTIONS.forEach((s) => (s.tools || []).forEach((t) => all.push(Object.assign({ section: s.id }, t))));
    const hereTools = all.filter((t) => here.has(t.id));

    const link = (cls, id, icon, name, extra) =>
      '<a class="' + cls + '" href="#' + id + '" data-for="' + id + '">' + icon + '<span>' + esc(name) + '</span>' + (extra || '') + '</a>';
    const toolLink = (t) => link('nt', t.id, iconOf(t), nameOf(t), here.has(t.id) ? '<i class="dot" title="On the page you came from"></i>' : '');

    let nav = '<div class="find">' + LOOK + '<input type="search" id="q" placeholder="Search tools and facts" autocomplete="off" spellcheck="false" aria-label="Search"></div>';
    // The page's own tools, in a block of their own.
    if (hereTools.length) {
      nav += '<div class="ng" id="here-ng">On this page</div>';
      nav += '<div class="grp here"><div class="items">' + hereTools.map((t) => link('nt', t.id, iconOf(t), nameOf(t))).join('') + '</div></div>';
    }
    // Everything: a block per site with its tools under it; the sections
    // without tools - the start first, the rest after the sites.
    nav += '<div class="ng">Everything</div>';
    const plain = SECTIONS.filter((s) => !s.tools);
    nav += '<div class="grp solo">' + link('ns', 'start', SITE_ICON.start, 'Getting started') + '</div>';
    for (const s of SECTIONS) {
      if (!s.tools) continue;
      nav +=
        '<div class="grp">' + link('ns', s.id, SITE_ICON[s.id], s.name, '<span class="cnt">' + s.tools.length + '</span>') +
        '<div class="items">' + s.tools.map(toolLink).join('') + '</div></div>';
    }
    nav +=
      '<div class="grp"><div class="items flat">' +
      plain.filter((s) => s.id !== 'start').map((s) => link('nt', s.id, SITE_ICON[s.id], s.name)).join('') + '</div></div>';

    let main =
      '<div class="legend"><span><i></i>a limit, or something the tool will not do</span>' +
      (hereTools.length ? '<span><i class="h"></i>works on the page you came from</span>' : '') + '</div>';
    for (const s of SECTIONS) {
      main += '<section id="' + s.id + '"><h2>' + SITE_ICON[s.id] + esc(s.name) + '</h2>' + (s.sub ? '<div class="sub">' + esc(s.sub) + '</div>' : '');
      main += factsHtml(s.facts);
      for (const t of s.tools || []) {
        const k = KIND[t.kind] || KIND.action;
        main +=
          '<article class="tool' + (here.has(t.id) ? ' here' : '') + '" id="' + t.id + '">' +
          '<div class="th"><span class="ic">' + iconOf(t) + '</span><h3>' + esc(nameOf(t)) + '</h3>' +
          '<span class="kind ' + k[1] + '">' + k[0] + '</span>' +
          (here.has(t.id) ? '<span class="kind here">On this page</span>' : '') + '</div>' +
          '<div class="where"><b>Where:</b> ' + t.where + '</div>' +
          '<div class="what">' + t.what + '</div>' +
          factsHtml(t.facts) +
          '</article>';
      }
      main += '</section>';
    }
    main += '<div class="empty hide" id="none">Nothing matches.</div>';

    const version = chrome.runtime.getManifest().version;
    document.documentElement.innerHTML =
      '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>DynaBoost help</title>' +
      '<style>' + CSS + DynaBoost.tabCss + '</style></head>' +
      '<body><header><div class="top"><img class="mark" src="' + chrome.runtime.getURL('icons/icon48.png') + '" alt="">' +
      '<div><h1>DynaBoost help<span class="ver">v' + esc(version) + '</span></h1>' +
      '<div class="crumbs">Every tool: where it works, what it does, and what it will not do.</div></div></div></header>' +
      '<div class="wrap"><nav>' + nav + '</nav><main>' + main + '</main></div></body>';
    DynaBoost.themeTab(window, dark);
    wire(hereTools);
  }

  function wire(hereTools) {
    const q = document.getElementById('q');
    const cards = [...document.querySelectorAll('main section, main .tool')];
    const links = [...document.querySelectorAll('nav a')];
    const navBox = document.querySelector('nav');
    const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Search: whole words of the query, anywhere in a tool's text.
    q.addEventListener('input', () => {
      const words = norm(q.value).split(/\s+/).filter(Boolean);
      let shown = 0;
      document.querySelectorAll('main section').forEach((sec) => {
        const own = sec.querySelector(':scope > ul.facts');
        const tools = [...sec.querySelectorAll('.tool')];
        let any = false;
        for (const t of tools) {
          const ok = words.every((w) => norm(t.textContent).includes(w));
          t.classList.toggle('hide', !ok);
          if (ok) any = true;
        }
        const ownOk = !!own && words.every((w) => norm(sec.querySelector('h2').textContent + ' ' + own.textContent).includes(w));
        if (own) own.classList.toggle('hide', !ownOk && !!words.length);
        const show = !words.length || any || ownOk;
        sec.classList.toggle('hide', !show);
        if (show) shown++;
      });
      links.forEach((a) => {
        const el = document.getElementById(a.dataset.for);
        a.classList.toggle('hide', !!el && el.classList.contains('hide'));
      });
      document.querySelectorAll('nav .grp').forEach((g) => g.classList.toggle('hide', !g.querySelector('a:not(.hide)')));
      const hereGrp = document.querySelector('nav .grp.here');
      if (hereGrp) document.getElementById('here-ng').classList.toggle('hide', hereGrp.classList.contains('hide'));
      document.getElementById('none').classList.toggle('hide', shown > 0);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== q) {
        e.preventDefault();
        q.focus();
        q.select();
      } else if (e.key === 'Escape' && document.activeElement === q && q.value) {
        q.value = '';
        q.dispatchEvent(new Event('input'));
      }
    });

    // The navigation follows the reading: the last card whose top has passed.
    let queued = false;
    const spy = () => {
      queued = false;
      let cur = null;
      for (const c of cards) {
        if (c.classList.contains('hide')) continue;
        if (c.getBoundingClientRect().top < 90) cur = c.id;
        else break;
      }
      const sec = cur && document.getElementById(cur).closest('section');
      let shown = null;
      links.forEach((a) => {
        const on = a.dataset.for === cur;
        a.classList.toggle('on', on);
        a.classList.toggle('cur', !on && !!sec && a.dataset.for === sec.id);
        if (on && !a.closest('.here')) shown = a;
      });
      // Keep the marked link in the navigation's view; at the top, its top.
      if (scrollY < 10) navBox.scrollTop = 0;
      else if (shown) {
        const top = shown.offsetTop;
        const bottom = top + shown.offsetHeight;
        if (top < navBox.scrollTop + 70) navBox.scrollTop = top - 70;
        else if (bottom > navBox.scrollTop + navBox.clientHeight - 30) navBox.scrollTop = bottom - navBox.clientHeight + 30;
      }
    };
    document.addEventListener('scroll', () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(spy);
    });

    // Opened from the panel: at the section of the page it was on - My
    // solutions is on every page, so it does not decide. Otherwise the
    // address's own #anchor, if any.
    const site = hereTools.find((t) => t.section !== 'panel');
    const hash = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    const to = site ? document.getElementById(site.section) : hash;
    if (to) to.scrollIntoView();
    spy();
  }

  chrome.storage.local.get(TILES_KEY, (d) => {
    const tiles = {};
    for (const t of (d && d[TILES_KEY]) || []) if (t && t.id) tiles[t.id] = t;
    build(tiles);
  });
})();
