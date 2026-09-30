# Contributing to DynaBoost

## Every UI in two colours

DynaBoost has a light and a dark mode, and everything new is made in both -
the panel, the dialogs it opens over a page, and every tab a feature opens.
Nothing ships light-only.

- **Panel** (`src/panel.css`): colours come from the `--db-*` tokens on
  `#dynaboost-root`; `#dynaboost-root.db-dark` gives them their dark values.
  A colour written out in a rule needs a twin under `#dynaboost-root.db-dark`.
  Dialogs over the page get `db-dark` on their `.db-overlay` from
  `DynaBoost.isDark()`.
- **Tabs** (everything opened with `window.open` or as an extension page):
  write colours as usual in the tab's CSS, then run
  `python3 tools/theme-vars.py` - it turns each `#hex` in a CSS declaration
  into `var(--dbc-<role>-<hex>)` and regenerates the table in
  `src/theme-table.js`, where the light value is the colour itself and the
  dark value comes from `tools/theme-dark.json`. A colour it does not know is
  reported: give it a dark value there and run it again.
- A tab gets the theme with `DynaBoost.themeTab(tab)` right after its
  document is written; the flow editor page gets it from its URL (`&theme=`).
- Check both modes on screenshots before calling it done.

## Workflow

- `main` is released: a version bump there builds the Chrome Web Store
  package and a GitHub Release (`.github/workflows/package.yml`).
- Every change bumps `version` in `manifest.json` - patch for fixes, minor
  for features.
- No remote code. A new permission or site needs its reason in
  `store/LISTING.md`, and `store/PRIVACY.md` has to stay true.
- A new tool gets its entry in the in-app help (`src/help.js`).
