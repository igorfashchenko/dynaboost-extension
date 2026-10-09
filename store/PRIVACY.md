# DynaBoost — Privacy Policy

_Last updated: 4 October 2026_

DynaBoost is a browser extension that adds productivity tools to Microsoft
Power Apps, Power Automate, Dynamics 365 and Azure DevOps pages.

## What DynaBoost does with your data

- **Everything stays in your browser.** DynaBoost reads the page you are on
  (for example a table, a flow run, a form, a workflow or the code of a
  canvas screen) only when you use one of its tools, and shows the result in
  a new tab of your own browser.
- **No data leaves your device for us.** DynaBoost has no server, no
  analytics, no tracking and no advertising. It does not send your data to
  the developer or to any third party.
- **Requests it makes go to the service you are already using.** Tools that
  read Dataverse or Azure DevOps records call the same Microsoft API as the
  page you have open, with your existing session. Some tools that you start
  yourself write back to it — for example saving a draft workflow or journey.
- **Edit flow and your sign-in.** To read, check and save a Power Automate
  flow, a small helper inside the Power Automate page asks the page's own
  Microsoft APIs, with the sign-in the page already sends to them. The
  sign-in header stays in that page's memory: DynaBoost does not read it
  into the extension, store it or send it anywhere, and it is used only for
  the flow you opened, when you click.
  A solution flow's unpublished draft is kept in its environment's
  Dataverse: to see it and, when you agree, publish it before a save,
  DynaBoost asks that environment in a tab of it, with your own sign-in - a
  tab you have open, or one it opens in the background for a moment and
  closes again - and only for that flow.
- **Impersonate.** When you choose to work as another user of your
  Dynamics 365 environment in one tab, DynaBoost asks your browser to add
  Dataverse's impersonation header (`MSCRMCallerID`, with that user's id)
  to the requests that environment's pages in that tab send to it. Nothing
  else is changed, no other tab or site is touched, and the header goes
  only to the environment itself. It ends when you stop it, close the tab
  or close the browser. The last five users you picked there and up to
  three you starred (name, email, business unit) are kept in your browser
  for each environment, to pick them again.
- **Compare.** To compare this environment with
  another, DynaBoost reads the other one in a tab of that environment, with
  your own sign-in: a tab you have open, or one it opens in the background
  for a moment and closes again - after asking you, unless you chose "Don't
  ask again". The list of your environments is read the same way from
  make.powerapps.com: a small helper inside the page looks at the portal's
  own answer listing your environments as it arrives, and DynaBoost keeps
  only their names and addresses, in your browser. These tools only read.
- **Clipboard.** DynaBoost writes to the clipboard when you click Copy, and
  reads it only in the screen code editor, when you open the editor or click
  Load. The text is used to fill that editor and is not stored or sent
  anywhere.
- **Local storage.** DynaBoost stores its own settings in your browser
  (which tools are on, the order you arranged the panel's sections and
  tiles in for each site, the host names of environments you entered, the
  users you last picked or starred in Impersonate, backups of journey and flow
  definitions from before your saves - the five newest of each, removed after
  14 days, the names and addresses of your environments as make.powerapps.com
  lists them (for Compare), whether to ask before
  opening a tab in the background, the Presenting tools' switches, keys and Spotlight size, the version the help page was last opened in, the version DynaBoost was updated to until What's new is opened (for the dot on the help button), the id of the app you last worked in, for each Dynamics 365 environment (so links to records open in that app), the command bars of the last five tables Form as JSON read (as Dynamics gave them, to show them at once next time; removed after 14 days), a count of how often the tools were used, so the
  panel can suggest a rating after a while and after an update, and for the
  Time saved counter how many times each tool was used and the time that saved). You can remove them by removing
  the extension.

- **Report a bug, Suggest an idea.** The help page and every tab DynaBoost
  opens have two links to short forms hosted by Tally (tally.so). Nothing is
  sent when DynaBoost runs: a form opens only when you click its link, filled
  in advance with DynaBoost's version, the browser's name and version, the
  panel section and tool, and the kind of page you were on (such as
  "Dynamics 365 · Record") - never its address, a name or an id. What you
  then write and send goes to the developer through Tally, under Tally's own
  privacy policy; the email field is optional.

- **Say thanks.** The heart in the panel footer shows a link to DynaBoost's
  page in the store it was installed from (Chrome Web Store or Microsoft Edge
  Add-ons - read from the extension's own manifest, nothing is sent), a link to a payment page hosted by Stripe
  (a one-off tip, or - switched to Monthly - a monthly one, cancelled from
  the link in Stripe's receipt) and one to Stripe's Privacy Center (how Stripe handles a payer's data),
  optionally the developer's crypto wallet addresses, and a link to the
  developer's LinkedIn profile. The help page links to the same store page, to
  DynaBoost's source code on GitHub and to the same LinkedIn profile; the other
  tabs DynaBoost opens link to the store page. Nothing is sent when you open
  them; each page opens in a new tab only when you click
  its link, and whatever you enter there is handled by that site under its own
  privacy policy. DynaBoost never sees it.

## Data sharing

DynaBoost does not sell, transfer or share user data with third parties, does
not use it for any purpose unrelated to its tools, and does not use it to
determine creditworthiness or for lending purposes. No person reads it:
DynaBoost has no server, so the developer never receives it.

## Chrome Web Store User Data Policy

DynaBoost's use of the data it handles complies with the Chrome Web Store User
Data Policy, including the Limited Use requirements.

## Changes to this policy

A change to what DynaBoost does with data changes this page first; the date at
the top says when it last changed.

## Contact

Questions about this policy: igorf.job@gmail.com
