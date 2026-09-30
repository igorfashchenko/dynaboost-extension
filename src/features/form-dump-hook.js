/* DynaBoost - page-world helper for Form as JSON. Reads window.Xrm, which a
 * content script cannot see: which form and record are open, and the runtime
 * state of tabs, sections and controls (visible, disabled, unsaved changes).
 * Nothing is fetched or written. */
(function () {
  if (window.__dynaboostFormHook) return;
  window.__dynaboostFormHook = true;

  const SRC = 'dynaboost-form-ctx';

  function clean(g) {
    return String(g || '').replace(/[{}]/g, '').toLowerCase();
  }

  function safe(fn, fallback) {
    try {
      const v = fn();
      return v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function snapshot() {
    const X = window.Xrm;
    if (!X || !X.Page || !X.Page.data || !X.Page.data.entity) return null;
    const fc = X.Page;
    const ent = fc.data.entity;
    const gc = safe(() => X.Utility.getGlobalContext(), null);
    const item = safe(() => fc.ui.formSelector.getCurrentItem(), null);

    const out = {
      entity: safe(() => ent.getEntityName(), null),
      id: clean(safe(() => ent.getId(), '')),
      recordName: safe(() => ent.getPrimaryAttributeValue(), null),
      formId: item ? clean(safe(() => item.getId(), '')) : '',
      formName: item ? safe(() => item.getLabel(), null) : null,
      formType: safe(() => fc.ui.getFormType(), null),
      clientUrl: gc ? safe(() => gc.getClientUrl(), null) : null,
      lcid: gc ? safe(() => gc.userSettings.languageId, null) : null,
      // The Power Platform environment id - what the maker portal links use.
      envId: gc ? safe(() => gc.organizationSettings.bapEnvironmentId, null) : null,
      unsaved: safe(() => ent.getIsDirty(), false),
      tabs: {},
      sections: {},
      controls: {},
      attributes: {}
    };

    safe(() =>
      fc.ui.tabs.forEach((tab) => {
        const tn = tab.getName();
        out.tabs[tn] = {
          label: safe(() => tab.getLabel(), null),
          visible: safe(() => tab.getVisible(), null),
          state: safe(() => tab.getDisplayState(), null)
        };
        safe(() =>
          tab.sections.forEach((sec) => {
            out.sections[tn + '/' + sec.getName()] = {
              label: safe(() => sec.getLabel(), null),
              visible: safe(() => sec.getVisible(), null)
            };
          })
        );
      })
    );

    safe(() =>
      fc.ui.controls.forEach((c) => {
        const name = c.getName();
        const type = safe(() => c.getControlType(), null);
        const entry = {
          type: type,
          visible: safe(() => c.getVisible(), null),
          disabled: safe(() => c.getDisabled(), null)
        };
        const attr = safe(() => (c.getAttribute ? c.getAttribute() : null), null);
        if (attr) entry.required = safe(() => attr.getRequiredLevel(), null);
        if (type === 'subgrid') {
          entry.subgrid = {
            entity: safe(() => c.getEntityName(), null),
            relationship: safe(() => (c.getRelationship ? c.getRelationship() : null), null),
            view: safe(() => c.getViewSelector().getCurrentView(), null)
          };
        }
        out.controls[name] = entry;
      })
    );

    safe(() =>
      ent.attributes.forEach((a) => {
        out.attributes[a.getName()] = {
          unsaved: safe(() => a.getIsDirty(), false),
          required: safe(() => a.getRequiredLevel(), null)
        };
      })
    );

    return out;
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== SRC || d.type !== 'request') return;

    let ctx = null;
    let error = null;
    try {
      ctx = snapshot();
      // postMessage needs a cloneable payload; Xrm sometimes hands back
      // objects with functions on them. A JSON round-trip strips those.
      if (ctx) ctx = JSON.parse(JSON.stringify(ctx));
    } catch (err) {
      error = String((err && err.message) || err);
    }
    window.postMessage({ source: SRC, type: 'response', nonce: d.nonce, ctx: ctx, error: error }, window.location.origin);
  });
})();
