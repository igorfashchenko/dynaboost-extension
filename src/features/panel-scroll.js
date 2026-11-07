/* Feature: Keep panel position. A panel of make.powerapps.com - New or Edit
 * column, table, choice - jumps back to its top when you come back to the
 * tab from another tab, window or app: the panel puts the cursor in its first
 * field again, and the browser scrolls up to it. While on, where you were is
 * noted as you leave - how far each scrolled part of the open panels was
 * down, and the field you were in - and given back as you return: for two
 * seconds a jump is scrolled back, the cursor back in your field (without
 * scrolling). Clicking, scrolling or typing yourself ends it at once - a
 * click in another field is never taken back to the old one.
 */
(function () {
  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="4" y="3.5" width="12" height="17" rx="2" stroke="#3D8BFF" stroke-width="1.6"/>' +
    '<path d="M7 8h6M7 11h6M7 14h4" stroke="#3D8BFF" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="M19.5 7v10M17.5 15l2 2 2-2" stroke="#E3B04B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  const PANES = '[role="dialog"], [role="complementary"], aside, .ms-Panel, [class*="Panel"], [class*="Drawer"], [class*="drawer"]';
  const GUARD = 2000; // ms after the return a jump is put back

  let on = false;
  let noted = []; // [{ el, top }] - the panels' scrolled parts as you left
  let field = null; // the field you were in, in a panel
  let until = 0;
  let frame = 0;
  let given = false;

  const shown = (el) => !!el.getClientRects().length;
  const panes = () => Array.from(document.querySelectorAll(PANES)).filter((p) => shown(p) && !p.closest('#dynaboost-root'));

  // The parts of a pane that scroll: the pane itself and any box in it.
  function scrollers(pane) {
    const out = [];
    for (const el of [pane, ...pane.querySelectorAll('div, section, form, main')]) {
      if (el.scrollHeight <= el.clientHeight + 4) continue;
      const y = getComputedStyle(el).overflowY;
      if (y === 'auto' || y === 'scroll') out.push(el);
    }
    return out;
  }

  function leave() {
    if (!on || until > Date.now()) return;
    noted = [];
    const seen = new Set();
    for (const p of panes()) {
      for (const el of scrollers(p)) {
        if (seen.has(el) || el.scrollTop <= 0) continue;
        seen.add(el);
        noted.push({ el: el, top: el.scrollTop });
      }
    }
    const a = document.activeElement;
    field = a && a !== document.body && a.closest && a.closest(PANES) && !a.closest('#dynaboost-root') ? a : null;
  }

  function back() {
    if (!on || (!noted.length && !field)) return;
    until = Date.now() + GUARD;
    given = false;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(keep);
  }

  // Each frame for the two seconds: what jumped, put back.
  function keep() {
    if (Date.now() > until) return stop();
    for (const n of noted) {
      if (!n.el.isConnected) continue;
      if (Math.abs(n.el.scrollTop - n.top) > 2) {
        n.el.scrollTop = n.top;
        given = true;
      }
    }
    const a = document.activeElement;
    if (field && field.isConnected && a !== field && a && a.closest && a.closest(PANES) === field.closest(PANES)) {
      field.focus({ preventScroll: true });
      given = true;
    }
    frame = requestAnimationFrame(keep);
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (given) DynaBoost.saved('panel-scroll');
    given = false;
    until = 0;
    noted = [];
    field = null;
  }

  // Your own click, scrolling or typing: yours, not put back. A click ends it
  // before the field it lands in gets the cursor, so the cursor stays there.
  function yours(e) {
    if (!until || !e.isTrusted) return;
    if (e.type === 'keydown' && (e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt' || e.key === 'Shift')) return;
    stop();
  }

  // The window's own blur and focus - a field's do not reach here.
  window.addEventListener('blur', (e) => e.target === window && leave());
  window.addEventListener('focus', (e) => e.target === window && back());
  document.addEventListener('visibilitychange', () => (document.hidden ? leave() : back()));
  for (const t of ['pointerdown', 'mousedown', 'touchstart', 'wheel', 'touchmove', 'keydown']) window.addEventListener(t, yours, { capture: true, passive: true });

  DynaBoost.register({
    id: 'panel-scroll',
    name: 'Keep panel position',
    group: 'Automatic',
    hosts: ['make.powerapps.com'],
    hint: 'A panel stays where you were when you come back to the tab',
    icon: ICON,
    defaultOn: true,
    onEnable() {
      on = true;
    },
    onDisable() {
      on = false;
      stop();
    }
  });
})();
