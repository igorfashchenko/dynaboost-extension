/* DynaBoost - the help page (src/help.html), opened by the (i) in the panel:
 * help.html?here=<ids>[&theme=dark][&top=1]. The tiles of that page are
 * marked and listed first, and it opens at their section - at the top with
 * &top, the first help after DynaBoost is installed or updated. The tiles'
 * names and icons come from chrome.storage.local (dynaboost.helpTiles). One
 * line per fact; a fact starting with "!" is a limit.
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
    news: svg('<path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>'),
    present: svg('<rect x="3.5" y="4" width="17" height="11.5" rx="1.8"/><path d="M12 15.5V20M8.5 20h7"/><circle cx="12" cy="9.8" r="2.2"/>')
  };
  const PIN_ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="5" width="7" height="6" rx="1.5" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<rect x="13" y="5" width="7" height="6" rx="1.5" stroke="#3D8BFF" stroke-width="1.6"/><rect x="4" y="13" width="7" height="6" rx="1.5" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M16.5 13.5v5M14 16h5" stroke="#E3B04B" stroke-width="1.6" stroke-linecap="round"/></svg>';
  // Time saved: the capsule, a number and its gold unit.
  const SAVED_ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2.5" y="7" width="19" height="10" rx="5" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M7.5 10v4M10 10v4" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/><path d="M14.5 10v4M17 10v4M14.5 12H17" stroke="#E3B04B" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const LOOK = svg('<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>');

  /* What's new: one entry per version released on the Chrome Web Store (as
   * major.minor, like the releases of the public repo), newest first, and
   * only what changes for the user - tools and what they do, fixes they would
   * notice. Not looks, links, this help or the store. The last NEWS_SHOWN.
   * A long entry is items: a list under its version. */
  const NEWS = [
    {
      v: '2.40',
      items: [
        'New: <b>Compare</b> – this form and its table, or this record, against another environment, or two records here. Fields, columns and logic – only what differs.',
        'New: <b>Open table</b> and <b>Edit view</b> – from a record or a list (a subgrid’s too) straight into the maker portal, in your solution that holds it; a list asks which only when several of yours hold it, or none. <b>Edit form</b> works the same way.',
        '<b>Export run</b>: <b>Records</b> beside the steps – every Dataverse row the run read, created or changed, with its table and name, one click from opening. A failed run starts with <b>Where it failed</b> – the step the failure started in and the service’s own error message, even when Power Automate keeps it behind a link.',
        '<b>Form as JSON</b>: the form at a glance – header, tabs, sections and footer, each field with only what sets it apart – and the record’s <b>business process</b> as a bar, a stage’s fields opening in place. Faster, showing each step while it reads; a large form no longer holds the tab.',
        '<b>Versions</b> in every editor (Edit flow, Edit journey, Open workflow, Edit screen code) – the original and your last 5 saves, one click back; closing with unsaved changes asks first. Edit flow and Edit journey also keep a backup from before each save in the browser, 14 days.',
        '<b>Edit flow</b>: a solution flow’s unpublished draft is found and published before your save – asked first, no designer needed. When it cannot be published from here, one question takes you to the designer, your code kept.',
        'New: <b>Presenting</b> – Blur data, Laser pointer and Spotlight switched in one window, with your own keys.',
        'New: <b>Time saved</b> – the gold counter in the panel’s header adds up how much time the tools have saved you.',
        'New: <b>Arrange the panel</b> – the pencil in the footer: drag tiles and sections into your own order, kept per site.',
        'New: <b>Report a bug</b> and <b>Suggest an idea</b> – a short form from the help or any tab DynaBoost opens, no account needed; a tool that stopped with an error offers it at once.',
        'Copy work item: with images, both buttons copy the text – Copy with images also saves them. My solutions: a removed solution comes back with Undo.',
        'Fixes: Export table reads the whole list from the top; Export run never exports another flow’s run; Copy record fills only a new record in the same environment; the maker portal’s own errors no longer show up as DynaBoost’s; a tool that fails says why.'
      ]
    },
    {
      v: '2.39',
      text:
        'Light / dark: a mode you pick with the button stays, on every page, until the browser’s own mode changes. ' +
        'Edit flow opens from an incognito window too – in a regular window, as Chrome keeps extension pages out of incognito.'
    },
    {
      v: '2.38',
      text:
        'Open advanced options: also in the New / Edit table panel. New: Column defaults – a new column starts without form fill assistance. ' +
        'Copy work item: images stay numbered placeholders, never in the text; with images you choose – the text without them, or Download images (all of them, one ZIP). ' +
        'Markdown fields and comments stay Markdown; names written in the text are replaced too. Tabs left open keep working after DynaBoost updates.'
    },
    { v: '2.37', text: 'First release on the Chrome Web Store.' }
  ];
  const NEWS_SHOWN = 5;

  // Right of the title: rate it (in the store it came from - DynaBoost.store,
  // src/code-view.js), its code, its author.
  const ABOUT = {
    rate: (DynaBoost.store && DynaBoost.store.url) || 'https://chromewebstore.google.com/detail/odonlnpmplbipgojjodfpedjbbahfkmk',
    repo: 'https://github.com/igorfashchenko/dynaboost-extension',
    linkedin: 'https://www.linkedin.com/in/igor-fashchenko/'
  };
  // The page the help was opened from, for Report a bug (core.js, pageKind).
  const fromPage = params.get('page') || '';
  const STAR =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="m12 3.8 2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  const GITHUB =
    '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';
  const LINKEDIN =
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<rect width="24" height="24" rx="4.5" fill="#0A66C2"/>' +
    '<path fill="#fff" d="M7.1 9.4h2.6v8.3H7.1zm1.3-4.1a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm2.9 4.1h2.5v1.1h.04c.35-.66 1.2-1.36 2.47-1.36 2.64 0 3.13 1.74 3.13 4v4.55h-2.6v-4.03c0-.96-.02-2.2-1.34-2.2-1.34 0-1.55 1.05-1.55 2.13v4.1h-2.6z"/></svg>';

  // The tiles' names, as the panel shows them.
  const NAMES = {
    'table-export': 'Export table', 'open-all': 'Open on All', 'auto-advanced': 'Open advanced options', 'column-defaults': 'Column defaults', 'classic-open': 'Open in classic',
    'canvas-code': 'Edit screen code', 'canvas-tree': 'Expand tree', 'flow-edit': 'Edit flow', 'flow-run-export': 'Export run',
    'expand-all': 'Expand all steps', 'form-dump': 'Form as JSON', 'form-editor': 'Edit form', 'table-open': 'Open table', 'view-editor': 'Edit view', 'logical-names': 'Logical names',
    'god-mode': 'God mode', 'copy-record': 'Copy record', impersonate: 'Impersonate', 'advanced-find': 'Advanced Find',
    'system-jobs': 'System jobs', workflow: 'Open workflow', journey: 'Edit journey', 'ado-workitem': 'Copy work item',
    'ado-taskboard-expand': 'Expand items', 'wiki-expand': 'Expand wiki tree',
    'blur-data': 'Blur data', presenting: 'Presenting'
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
        'The <b>✎</b> in the footer arranges the panel: drag tiles within their section, and sections by their name (or the arrow keys). My solutions stays on top. Each site – Dynamics 365, Power Apps, Power Automate, Azure DevOps – keeps its own order; moved to the top or the bottom, a section or tile stays there on every page of the site. <b>Reset order</b> puts the site back as it came.',
        '<b>Action</b> tiles run once. <b>Switches</b> remember their state – except “this page only” and “this tab only”.',
        'The id under the header (record, table, flow, run, solution, work item…) copies on click.',
        'Light / dark follows the browser until you pick one; a later change in the browser wins. Tabs DynaBoost opens follow the panel.',
        '<b>(i)</b> opens this page at the current page’s tools; <kbd>/</kbd> jumps to the search. After an update it has a gold dot: it opens What’s new.',
        '<b>Report a bug</b> and <b>Suggest an idea</b> – at the top of this page and of every DynaBoost tab – open a short form, no account needed. It comes filled with the version, the browser, the panel section and the kind of page; never an address, a name or an id. A tab that stopped with an error offers <b>Report this bug</b>.',
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
        },
        {
          id: 'time-saved',
          name: 'Time saved',
          kind: 'panel',
          icon: SAVED_ICON,
          where: 'the panel’s header, and the top of this page',
          what: 'The time DynaBoost’s tools have saved you, in a slim gold-framed capsule: the number, then its unit.',
          facts: [
            'Units: <b>S</b> seconds, <b>M</b> minutes, <b>H</b> hours, <b>D</b> days, <b>MO</b> months (30 days), <b>Y</b> years. Below 10 with one decimal, in your browser’s style – <b>1.5 MO</b> is 45 days.',
            'Hover it for the exact time, the uses since it started counting and the tools that saved the most.',
            'Each tool adds a set time per use, once it has done its work – a tab opened, a copy made, a flow saved. Blur data, Presenting and God mode add nothing.',
            'Kept in this browser – reloads and updates keep it; removing DynaBoost clears it.'
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
          what: 'The whole list – copy it as Markdown or CSV, or download it as CSV.',
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
          where: 'the New / Edit table and New / Edit column panels',
          what: 'Opens “Advanced options” in these panels, so what is behind it – the schema name among it – is in view straight away.',
          facts: ['Close it yourself and it stays closed.', '!UI languages: EN, PL, DE, FR, ES, IT, NL.']
        },
        {
          id: 'column-defaults',
          kind: 'switch-on',
          where: 'the New column panel',
          what: 'A new column starts the way your project wants it: <b>Allow form fill assistance</b> cleared.',
          facts: ['Never in Edit column - a saved column stays as it is.', 'A checkbox you click yourself stays as you set it.', '!The checkbox is found by its English label.']
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
        },
        {
          id: 'workflow',
          kind: 'action',
          where: 'a classic workflow – its classic editor or the solution explorer',
          what: 'The logic as readable steps, with field and choice labels – and the XAML in an editor.',
          facts: [
            'Pasted XAML is previewed as steps before saving.',
            '!Saves only a draft, unmanaged definition – deactivate first.',
            'Before the first save the original is downloaded; a save is refused when the workflow changed meanwhile; the class name is set right.',
            '<b>Versions</b>: the original + the last 5 saves of this tab, a click loads one; closing the tab with an unsaved edit asks first.',
            '<kbd>Ctrl</kbd>+<kbd>S</kbd> saves; refresh the classic designer to see it.'
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
            '<b>Versions</b>: the code as loaded + the last 5 applied, for each screen or set of controls loaded in the tab; a click loads one.',
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
            'A solution flow with an unpublished <b>draft</b> (saved in the designer): one never published opens as its draft, marked <b>Draft – not published</b>; a published one is marked <b>Unpublished draft</b>.',
            '<b>Save to flow</b> looks for a draft every time – in the Power Automate page, else in a tab of the flow’s environment in Dynamics 365 (one you have open, or one opened in the background for a moment). Found: it asks, publishes it as Publish in the designer would (on or off as it was), then saves your code.',
            '!A draft DynaBoost cannot reach (not signed in to that environment, or its address not known yet) and Power Automate refuses the save: <b>OK</b> copies your code, keeps it under <b>Versions</b>, closes the editor and brings the flow’s tab forward – click <b>Publish</b> there, then open Edit flow again. <b>Cancel</b> stays.',
            '<b>Versions</b>: the original + the last 5 saves of this tab, a click loads one. Before each save a backup in the browser: this flow’s, from this environment, kept 14 days (5 newest of all flows).',
            '!Versions live in the editor tab; closing it with unsaved edits or more than 3 versions asks first.',
            'Keeps working when the Power Automate tab is reloaded or closed – any open Power Automate tab will do.',
            '<kbd>Ctrl</kbd>+<kbd>S</kbd> saves.',
            'Calls go through the page’s own sign-in – Power Automate’s, or Dynamics 365’s for a draft; the token never reaches DynaBoost.'
          ]
        },
        {
          id: 'flow-run-export',
          kind: 'action',
          where: 'a flow run',
          what: 'The whole run in one tab: trigger and every action, nested ones too, with status, timing, inputs, outputs, errors – copy or download.',
          facts: [
            '<b>Records</b> beside the steps: every Dataverse row the run read, created, changed or pointed at – its table, its name, the steps that touched it – one click opens it in Dynamics 365, in the app you last worked in there.',
            'A failed run opens with <b>Where it failed</b>: the step the failure started in – not the scopes that failed because of it – with its code, its message and the service’s own words from the response, even when Power Automate keeps them behind a link; a click goes to the step.',
            'No extra calls, except large inputs, outputs and response bodies, fetched from their own links.',
            '!Those links expire after a few hours – an older run may miss them.',
            '!Apply to each / Do until: each action once, as the run reports it, with how many times it ran – not every iteration.'
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
            'While it reads, the tab shows each step and what it found – first what the page said: the form and its business process.',
            '<b>Business process</b>: the record’s process flow as a bar at the top – a click on a stage opens its fields in place; the process icon on a field opens its stage; the filter finds them too.',
            '<b>The JSON</b> starts with <b>layout</b> – the form at a glance, in its order: header, business process and its stages, tabs and sections, footer, each field with only what sets it apart; the full details follow. A field both on the form and in the process is marked on both sides.',
            'On the bar: <b>Edit in…</b> for the process, and the table’s other process flows.',
            'A process the page has not loaded yet (a large table can take a while): the bar waits with the seconds counting, and the form fills in with it by itself once it is there – no Read again, no reload. After 90 s it offers Read again. On a table with process flows a record whose page named none is checked for 20 s before it says “none on this record”.',
            '<b>Logic</b>: scripts and handlers (<b>View code</b> jumps to the function), business rules, plug-in steps, workflows, cloud flows, actions, Custom APIs, and the command bars with their rules in words.',
            '!Handlers attached in code are found only when written plainly.',
            'Icons on a field show what fires on it; click one to open it.',
            '<b>Edit in…</b> opens the editor in a solution you pick.',
            'Command bars: Dynamics builds them on request – a minute or more for a big table. The last ones read are kept in the browser and shown at once next time, while they are read again.',
            '!The Default Solution only after a warning; managed solutions greyed out.'
          ]
        },
        {
          id: 'compare',
          kind: 'action',
          where: 'any record form',
          what: 'This form and its table – or this record – against another environment; or two records here. Only what differs.',
          facts: [
            'In the dialog: <b>From</b> (where you are) → <b>Compare</b> (Form and table, or Record – this one filled in, paste the other one’s id or link) → <b>With</b> (an environment).',
            'Form and table: the fields (place, label, hidden, read-only, required, the logic icons), the columns and the logic – on or off – as in Form as JSON. Table and form matched by name; not there by name, you pick the form.',
            'Record: field by field; in another environment a lookup matches by the name it shows. A pasted link brings its environment.',
            '<b>show all</b> on a section opens all of it; <b>hide system fields</b> leaves out created / modified, owner and the like.',
            '!Reads the other environment in its own tab: one you have open, or one DynaBoost opens in the background for a moment and closes again.',
            '!In the background only <b>make.powerapps.com</b> (the list of your environments – names and addresses, kept in the browser; an open make.powerapps.com tab keeps it fresh) and the other environment’s address (to read from it). It asks first; <b>Don’t ask again</b> turns that off, the switch in the dialog turns it back on.',
            '<b>Get the list</b> shows how long it is taking; <b>Stop</b>, <b>Cancel</b> or ✕ stop it and close its tab.',
            'Only reads, with your own sign-in. Not signed in there: it says so, with a button to sign in.'
          ]
        },
        {
          id: 'form-editor',
          kind: 'action',
          where: 'a record',
          what: 'This form in the make.powerapps.com form designer, in your solution that holds it.',
          facts: [
            'Opens at once in your one unmanaged solution that holds the form – or, when several do, in the one pinned in My solutions.',
            'Otherwise a list asks which: your solutions, then the Default Solution, then the managed ones folded away.',
            '!Only solutions that list the form itself are offered.'
          ]
        },
        {
          id: 'table-open',
          kind: 'action',
          where: 'a record or a list',
          what: 'This table in make.powerapps.com, in your solution that holds it.',
          facts: [
            'As Edit form: your one unmanaged solution that holds the table – or the pinned one – opens at once; otherwise a list asks which.',
            '!In the list the Default Solution is marked: a change made there is in none of your solutions, so it is not exported with them.'
          ]
        },
        {
          id: 'view-editor',
          kind: 'action',
          where: 'a list',
          what: 'This list’s view in the make.powerapps.com view designer, in your solution that holds it.',
          facts: [
            'The view in the address – a list opened from a subgrid, or a view you picked – else the table’s default public view.',
            'As Edit form: your one unmanaged solution that holds the view – or the pinned one – opens at once; otherwise a list asks which.',
            '!Only solutions that list the view itself are offered.',
            '!A personal view is in no solution: it says so and opens nothing.'
          ]
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
          id: 'journey',
          kind: 'action',
          where: 'a Customer Insights – Journeys (real-time) journey',
          what: 'The journey’s definition as JSON – copy, download, format, edit.',
          facts: [
            '!Saves only a Draft journey, and not when it changed since you opened it.',
            '<b>Versions</b>: the original + the last 5 saves of this tab, a click loads one; under them this journey’s backups from before each save, kept 14 days (5 newest of all journeys).',
            '!Publishing stays in the designer.'
          ]
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
            'Images become numbered placeholders (image-1.png …) – never base64 in the text. With images, both buttons copy the text: <b>Copy without images</b> only the text, <b>Copy with images</b> the text and the files saved under those names – one image as it is, several in one ZIP. They fold down in the panel for 6 s, like Say thanks. Without images, the text is copied at once.',
            'Fields and comments written with the Markdown editor stay Markdown; names written in the text are replaced too.'
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
      id: 'present',
      name: 'Presenting',
      sub: 'every site DynaBoost works on – for demos and screen sharing',
      tools: [
        {
          id: 'blur-data',
          kind: 'switch',
          where: 'any page',
          what: 'Values blurred – fields (quick views and the header too), lists and subgrids, lookups, the timeline, the record’s title; labels stay readable.',
          facts: [
            'Hold <kbd>Alt</kbd> to read the value under the pointer.',
            'Stays on across pages and reloads until you switch it off, so a reload does not show the data.',
            'Search boxes and DynaBoost itself are left clear.',
            '!A blur, not a mask: a tooltip can still show a value.'
          ]
        },
        {
          id: 'presenting',
          kind: 'action',
          where: 'any page',
          what: 'A window with two pointers – each with a switch and its own keys: while the switch is on, the keys show or hide it on any page.',
          facts: [
            '<b>Laser pointer</b>: a red dot instead of the pointer, with a short trail and a ring on each click. Clicks and typing work as usual.',
            '<b>Spotlight</b>: the page dims around a circle on the pointer, closing in on it like a lens. <kbd>Alt</kbd> + wheel or the slider: its size. Hold <kbd>Shift</kbd> on its own: a frame around the field or section under the pointer. <kbd>Esc</kbd> ends it.',
            'Keys: the pencil, then two or three keys with <kbd>Ctrl</kbd>, <kbd>Alt</kbd> or <kbd>Shift</kbd>. Start with <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> / <kbd>S</kbd>.',
            'Drawn in the page, so a shared screen shows them.',
            '!Not inside a frame from another site (a Power BI report, Power Apps Studio’s canvas): the pointer and the keys are not seen there.'
          ]
        }
      ]
    },
    {
      id: 'privacy',
      name: 'Privacy & permissions',
      facts: [
        'No server, analytics or tracking; requests go only to the Microsoft service you have open, with your sign-in.',
        'Writes only on your click – a flow, a draft workflow or journey, code applied in Studio. Impersonate adds one header to one tab.',
        'Report a bug and Suggest an idea open a form on Tally (tally.so) – only on your click, and only what you write is sent, with the version, browser, panel section, tool and kind of page.',
        'Stored in the browser: switch states, light / dark, the panel’s order, org addresses, My solutions (Chrome sync), flow and journey backups, Impersonate favorites and recent users, and a count of tools used - for the rating hint on the heart.',
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
      facts: NEWS.slice(0, NEWS_SHOWN).map((n) =>
        n.items ? '<b>' + n.v + '</b><ul class="news">' + n.items.map((i) => '<li>' + i + '</li>').join('') + '</ul>' : '<b>' + n.v + '</b> – ' + n.text
      )
    }
  ];

  const CSS =
    '*{box-sizing:border-box}' +
    'body{margin:0;font:14px/1.55 "Segoe UI",system-ui,sans-serif;color:var(--dbc-fg-10224e);background:var(--dbc-bg-f5f7fc)}' +
    'header{padding:18px 28px 16px}' +
    // Only here the header stays on top while the page scrolls (body>header
    // beats the shared header's position:relative); --hh is its height.
    'body>header{position:sticky;top:0;z-index:20;transition:box-shadow .2s}' +
    'body>header.scrolled{box-shadow:0 2px 10px rgba(16,34,78,.08)}' +
    'html.db-dark body>header.scrolled{box-shadow:0 2px 12px rgba(0,0,0,.45)}' +
    'header .top{display:flex;align-items:center;gap:14px}' +
    'header .mark{width:34px;height:34px;border-radius:7px;flex:none}' +
    // The help's own links, right of the title: Rate DynaBoost, the code on
    // GitHub, the author on LinkedIn. The other tabs get only the quiet rate link.
    '.about{margin-left:auto;display:flex;align-items:center;gap:8px}' +
    '.about a{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:34px;border:1px solid var(--dbc-bd-dde3f0);border-radius:17px;background:var(--dbc-bg-fff);color:var(--dbc-fg-10224e);font-size:13px;text-decoration:none;white-space:nowrap;transition:border-color .15s,box-shadow .15s,transform .15s}' +
    '.about a:hover{border-color:var(--dbc-bd-1e6bff);box-shadow:0 2px 8px rgba(16,34,78,.08)}' +
    '.about .db-rate{padding:0 14px 0 12px;border-color:var(--dbc-bd-e8d5a8)}' +
    '.about .db-rate:hover{border-color:var(--dbc-bd-e3b04b);box-shadow:0 0 0 3px rgba(227,176,75,.2)}' +
    '.about .db-rate svg{width:16px;height:16px;color:var(--dbc-fg-e3b04b);transition:transform .2s cubic-bezier(.34,1.56,.64,1)}' +
    '.about .db-rate:hover svg{transform:scale(1.15) rotate(-8deg)}' +
    // Report a bug and Suggest an idea: the same pills, a quiet icon that
    // takes its colour under the pointer - the bug red, the bulb gold. On a
    // narrow window only the icons stay.
    '.about .fb{padding:0 14px 0 12px}' +
    '.about .fb svg{width:16px;height:16px;color:var(--dbc-fg-56637f);transition:transform .2s cubic-bezier(.34,1.56,.64,1),color .15s}' +
    '.about .fb-bug:hover{border-color:var(--dbc-bd-c42b1c);box-shadow:0 0 0 3px rgba(196,43,28,.12)}' +
    '.about .fb-bug:hover svg{color:var(--dbc-fg-c42b1c);transform:rotate(-12deg)}' +
    '.about .fb-idea:hover{border-color:var(--dbc-bd-e3b04b);box-shadow:0 0 0 3px rgba(227,176,75,.2)}' +
    '.about .fb-idea:hover svg{color:var(--dbc-fg-e3b04b);transform:scale(1.15)}' +
    'html.db-dark .about .fb-bug:hover{box-shadow:0 0 0 3px rgba(255,123,123,.18)}' +
    'html.db-dark .about .fb-idea:hover{box-shadow:0 0 0 3px rgba(227,176,75,.25)}' +
    '@media (max-width:1180px){.about .fb{width:34px;padding:0}.about .fb span{display:none}}' +
    '.about .ico{width:34px;padding:0}' +
    '.about .ico svg{width:16px;height:16px}' +
    // Time saved: the panel's gold capsule, framed like Rate DynaBoost. The
    // links and the capsule share one scale: 34 px high, 13 px text, 16 px
    // icons, 14 px from the ends.
    '.about .db-saved{display:inline-flex;align-items:center;gap:5px;height:34px;padding:0 14px;border:1px solid var(--dbc-bd-e8d5a8);border-radius:17px;background:var(--dbc-bg-fff);cursor:default;white-space:nowrap;transition:border-color .6s,box-shadow .6s}' +
    '.about .db-saved.db-saved-glow{border-color:var(--dbc-bd-e3b04b);box-shadow:0 0 0 3px rgba(227,176,75,.22)}' +
    '.db-saved-n{position:relative;display:inline-block;height:32px;overflow:hidden;font-size:14px;font-weight:600;line-height:32px;color:var(--dbc-fg-10224e);font-variant-numeric:tabular-nums}' +
    '.db-saved-n>i{display:block;font-style:normal;transition:transform .45s cubic-bezier(.22,1,.36,1),opacity .35s}' +
    '.db-saved-n>i.db-saved-out{position:absolute;left:0;right:0;top:0;transform:translateY(-100%);opacity:0}' +
    '.db-saved-n>i.db-saved-in{transform:translateY(100%);opacity:0}' +
    '.db-saved-u{position:relative;top:1px;margin-left:-1px;font-size:10px;font-weight:700;letter-spacing:.3px;line-height:32px;color:var(--dbc-fg-e3b04b)}' +
    '.db-saved-l{margin-left:3px;font-size:13px;line-height:32px;color:var(--dbc-fg-56637f)}' +
    '@media (prefers-reduced-motion:reduce){.about .db-saved,.db-saved-n>i{transition-duration:.01s}}' +
    'header h1 .ver{margin-left:8px;font-size:12.5px;font-weight:400;color:var(--dbc-fg-56637f)}' +
    '.wrap{display:grid;grid-template-columns:300px minmax(0,1fr);align-items:start;max-width:1320px;margin:0 auto}' +
    'nav{position:sticky;top:var(--hh,0px);max-height:calc(100vh - var(--hh,0px));overflow:auto;padding:16px 14px 40px 18px;border-right:1px solid var(--dbc-bd-dde3f0)}' +
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
    'section{margin:0 0 34px;scroll-margin-top:calc(var(--hh,0px) + 14px)}' +
    'section>h2{display:flex;align-items:center;gap:10px;margin:0;font-size:21px;line-height:1.3}' +
    'section>h2 svg{width:22px;height:22px;flex:none;color:var(--dbc-fg-1e6bff)}' +
    'section>.sub{margin:2px 0 0 32px;font-size:13px;color:var(--dbc-fg-56637f)}' +
    'section>ul.facts{margin:12px 0 0;padding:14px 18px 14px 34px;border:1px solid var(--dbc-bd-dde3f0);border-radius:10px;background:var(--dbc-bg-fff)}' +
    '.tool{margin:12px 0 0;padding:15px 18px 14px;border:1px solid var(--dbc-bd-dde3f0);border-radius:10px;background:var(--dbc-bg-fff);scroll-margin-top:calc(var(--hh,0px) + 14px)}' +
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
    'ul.news{margin:6px 0 12px;padding-left:18px}' +
    'ul.news li{margin:5px 0}' +
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
    // Report a bug knows the panel's section when the page's tiles are all in
    // one, and the tool when there is only one.
    const hereTiles = Array.from(here).map((id) => tiles[id]).filter((t) => t && t.group);
    const groups = Array.from(new Set(hereTiles.map((t) => t.group)));
    const about = { section: groups.length === 1 ? groups[0] : '', tool: hereTiles.length === 1 ? hereTiles[0].name : '', page: fromPage };
    const fb = (kind, cls, icon, label) =>
      '<a class="fb ' + cls + '" href="' + esc(DynaBoost.feedbackUrl(kind, about)) + '" target="_blank" rel="noopener noreferrer" title="' + label + ' - a short form, no account needed">' + icon + '<span>' + label + '</span></a>';

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
      '<div class="crumbs">Every tool: where it works, what it does, and what it will not do.</div></div>' +
      '<div class="about">' +
      fb('bug', 'fb-bug', DynaBoost.icons.bug, 'Report a bug') +
      fb('idea', 'fb-idea', DynaBoost.icons.idea, 'Suggest an idea') +
      '<a class="db-rate" href="' + ABOUT.rate + '" target="_blank" rel="noopener noreferrer">' + STAR + '<span>Rate DynaBoost</span></a>' +
      '<a class="ico" href="' + ABOUT.repo + '" target="_blank" rel="noopener noreferrer" title="DynaBoost on GitHub" aria-label="DynaBoost on GitHub">' + GITHUB + '</a>' +
      '<a class="ico" href="' + ABOUT.linkedin + '" target="_blank" rel="noopener noreferrer" title="The author on LinkedIn" aria-label="The author on LinkedIn">' + LINKEDIN + '</a>' +
      '<span id="saved"></span>' +
      '</div></div></header>' +
      '<div class="wrap"><nav>' + nav + '</nav><main>' + main + '</main></div></body>';
    DynaBoost.themeTab(window, dark);
    savedClock();
    wire(hereTools);
  }

  /* Time saved, last in the header: the panel's gold capsule, bigger, with
   * "saved". It catches up from what a panel showed last, and rolls on while
   * the page is open as tools are used in other tabs. */
  function savedClock() {
    const ts = DynaBoost.timeSaved;
    const spot = document.getElementById('saved');
    if (!ts || !spot) return;
    const SEEN = 'dynaboost.savedSeen';
    const clock = ts.counter(document, true);
    spot.replaceWith(clock.el);
    const name = (id) => NAMES[id] || (id === 'solution-pins' ? 'My solutions' : id);
    let saved = null;
    const show = (animate) => {
      const total = (saved && saved.total) || 0;
      clock.set(total, animate);
      clock.el.title = ts.tip(saved, name);
      chrome.storage.local.set({ [SEEN]: total });
    };
    chrome.storage.local.get([ts.KEY, SEEN], (d) => {
      saved = (d && d[ts.KEY]) || null;
      const total = (saved && saved.total) || 0;
      const seen = d && d[SEEN];
      clock.set(typeof seen === 'number' && seen <= total ? seen : total, false);
      clock.el.title = ts.tip(saved, name);
      setTimeout(() => show(true), 400);
    });
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local' || !ch[ts.KEY]) return;
      saved = ch[ts.KEY].newValue || null;
      show(true);
    });
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

    // The header stays on top: what goes under it is measured from its bottom.
    const head = document.querySelector('body > header');
    let hh = 0;
    const measure = () => {
      hh = head.offsetHeight;
      document.documentElement.style.setProperty('--hh', hh + 'px');
    };
    measure();
    if (window.ResizeObserver) new ResizeObserver(measure).observe(head);

    // The navigation follows the reading: the last card whose top has passed.
    let queued = false;
    const spy = () => {
      queued = false;
      head.classList.toggle('scrolled', scrollY > 0);
      let cur = null;
      for (const c of cards) {
        if (c.classList.contains('hide')) continue;
        if (c.getBoundingClientRect().top < hh + 90) cur = c.id;
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
    // solutions is on every page, so it does not decide. From the (i) with
    // its dot after an update (&news): at What's new. The first help after
    // DynaBoost is installed or updated (&top) stays at the top. Otherwise the
    // address's own #anchor, if any.
    const site = !params.has('top') && hereTools.find((t) => t.section !== 'panel');
    const hash = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    const to = params.has('news') ? document.getElementById('news') : site ? document.getElementById(site.section) : hash;
    if (to) to.scrollIntoView();
    spy();
  }

  chrome.storage.local.get(TILES_KEY, (d) => {
    const tiles = {};
    for (const t of (d && d[TILES_KEY]) || []) if (t && t.id) tiles[t.id] = t;
    build(tiles);
  });
})();
