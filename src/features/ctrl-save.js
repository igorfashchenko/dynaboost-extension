/* Feature: Ctrl+S saves. In make.powerapps.com Ctrl+S opens the browser's
 * Save As - a copy of the page, never what you meant. While on, Ctrl+S never
 * opens it there: it presses Save in the panel you have open (Edit column,
 * New table, a choice, an environment variable...) - the one on top when
 * there are several. A Save still greyed (nothing changed yet) is not
 * pressed, and a short message says so. No panel with a Save: nothing
 * happens - a designer that saves on Ctrl+S itself still does.
 *
 * It listens before the page: the portal's panels keep their keys to
 * themselves, so a listener after them never heard Ctrl+S. Labels in
 * several UI languages.
 */
(function () {
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M5 4.5h11l3 3V18a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 18V6a1.5 1.5 0 0 1 1-1.5Z" stroke="#3D8BFF" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M8 4.5v4h7v-4" stroke="#3D8BFF" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M8.5 13.5h7M8.5 16.5h4" stroke="#E3B04B" stroke-width="1.6" stroke-linecap="round"/>' +
    '</svg>';

  const SAVE = ['save', 'zapisz', 'speichern', 'enregistrer', 'guardar', 'salvar', 'salva', 'opslaan'];
  const PANES = '[role="dialog"], [role="complementary"], aside, .ms-Panel, [class*="Panel"], [class*="Drawer"], [class*="drawer"]';
  const BUTTONS = 'button, [role="button"], [role="menuitem"]';

  let on = false;

  const norm = (t) =>
    String(t || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  // Its text or its aria-label says Save.
  const isSave = (el) => SAVE.includes(norm(el.textContent)) || SAVE.includes(norm(el.getAttribute('aria-label')));
  const shown = (el) => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const disabled = (el) => el.disabled || el.getAttribute('aria-disabled') === 'true';

  // The Save button in a box, if it shows one.
  function saveIn(box) {
    return Array.from(box.querySelectorAll(BUTTONS)).find((b) => isSave(b) && shown(b)) || null;
  }

  /* The panel on top: of the panes holding a Save, the last one drawn - the
   * portal adds a panel over another at the end. A pane inside another
   * counts as the inner one. */
  function findSave() {
    const panes = Array.from(document.querySelectorAll(PANES)).filter((p) => shown(p) && !p.closest('#dynaboost-root'));
    for (let i = panes.length - 1; i >= 0; i--) {
      const b = saveIn(panes[i]);
      if (b) return b;
    }
    return null;
  }

  // Before the page: Ctrl+S is ours here, the browser's Save As never opens.
  function onKey(e) {
    if (!on || e.repeat) return;
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || String(e.key).toLowerCase() !== 's') return;
    e.preventDefault();
    const save = findSave();
    if (!save) return;
    // The panel's own keys are not pressed with it.
    e.stopPropagation();
    if (disabled(save)) {
      DynaBoost.toast('Nothing to save yet', 'Save is still greyed - change something in the panel first.');
      return;
    }
    save.click();
    DynaBoost.saved('ctrl-save');
  }

  window.addEventListener('keydown', onKey, true);

  DynaBoost.register({
    id: 'ctrl-save',
    name: 'Ctrl+S saves',
    group: 'Automatic',
    hosts: ['make.powerapps.com'],
    hint: 'Ctrl+S presses Save in the open panel, not the browser’s Save page',
    icon: ICON,
    onEnable() {
      on = true;
    },
    onDisable() {
      on = false;
    }
  });
})();
