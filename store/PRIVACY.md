# DynaBoost — Privacy Policy

_Last updated: 30 September 2026_

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
- **Impersonate.** When you choose to work as another user of your
  Dynamics 365 environment in one tab, DynaBoost asks your browser to add
  Dataverse's impersonation header (`MSCRMCallerID`, with that user's id)
  to the requests that environment's pages in that tab send to it. Nothing
  else is changed, no other tab or site is touched, and the header goes
  only to the environment itself. It ends when you stop it, close the tab
  or close the browser. The last five users you picked there and up to
  three you starred (name, email, business unit) are kept in your browser
  for each environment, to pick them again.
- **Clipboard.** DynaBoost writes to the clipboard when you click Copy, and
  reads it only in the screen code editor, when you open the editor or click
  Load. The text is used to fill that editor and is not stored or sent
  anywhere.
- **Local storage.** DynaBoost stores its own settings in your browser
  (which tools are on, the host names of environments you entered, the
  users you last picked or starred in Impersonate, backups of journey and flow
  definitions you saved, and a count of how often the tools were used, so the
  panel can suggest a rating after a while and after an update). You can remove them by removing
  the extension.

- **Say thanks.** The heart in the panel footer shows a link to DynaBoost's
  page on the Chrome Web Store, a link to a payment page hosted by Stripe,
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
