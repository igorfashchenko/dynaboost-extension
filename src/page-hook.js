/* DynaBoost - in the page's own world on Dynamics 365: which page the app
 * shows, as the app itself says it (Xrm.Utility.getPageContext), for the
 * content scripts. The address alone does not always say it: a multisession
 * app (Customer Service workspace and the like) keeps one address for every
 * session and record. Read a few times a second, told only when it changes,
 * with the address it was read at - so a page that has moved on since is not
 * taken for it. Only the page's kind, table, record and view.
 */
(function () {
  if (window.__dynaboostPage) return;
  window.__dynaboostPage = true;
  const SRC = 'dynaboost-page';
  let last = '';

  function read() {
    let page = null;
    try {
      const X = window.Xrm;
      const c = X && X.Utility && typeof X.Utility.getPageContext === 'function' ? X.Utility.getPageContext() : null;
      const i = c && c.input;
      if (i && i.pageType) page = { type: String(i.pageType), etn: String(i.entityName || ''), id: String(i.entityId || ''), viewId: String(i.viewId || ''), viewType: String(i.viewType || '') };
    } catch (e) {
      /* no app on this page yet */
    }
    const key = JSON.stringify(page) + location.href;
    if (key === last) return;
    last = key;
    window.postMessage({ source: SRC, page: page, href: location.href }, location.origin);
  }

  setInterval(read, 500);
  read();
  // A content script that came later (the extension updated) asks to hear it again.
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.source === SRC + '-ask') {
      last = '';
      read();
    }
  });
})();
