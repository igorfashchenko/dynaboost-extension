/* DynaBoost.timeSaved - the time DynaBoost's tools have saved, in a slim
 * capsule with a thin gold frame: the number, then the unit in gold.
 *
 *   42 S · 12 M · 2,5 H · 12 D · 1,5 MO · 2,0 Y
 *
 * Below 10 the number keeps one decimal; it is rounded down, never up. A
 * month is 30 days, a year 365. A new value rolls in from below and the frame
 * lights up for a moment. The exact time is in the tooltip. background.js
 * adds the uses up (dynaboost.saved); the panel and the help page only show
 * them.
 *
 *   DynaBoost.timeSaved.KEY                  the storage key
 *   DynaBoost.timeSaved.parts(seconds)       { num: '2,5', unit: 'H' }
 *   DynaBoost.timeSaved.exact(seconds)       "45 d 3 h 20 min"
 *   DynaBoost.timeSaved.tip(saved, name)     the tooltip; name(id) gives a tool's name
 *   DynaBoost.timeSaved.counter(doc, label)  { el, value, set(seconds, animate) };
 *                                            label adds "saved" after the unit */
(function () {
  window.DynaBoost = window.DynaBoost || {};
  if (DynaBoost.timeSaved) return;

  const KEY = 'dynaboost.saved';
  const UNITS = [
    ['Y', 365 * 86400],
    ['MO', 30 * 86400],
    ['D', 86400],
    ['H', 3600],
    ['M', 60]
  ];
  const NAMES = { S: 'seconds', M: 'minutes', H: 'hours', D: 'days', MO: 'months', Y: 'years' };
  // The decimal mark of the browser's language: 1,5 or 1.5.
  const MARK = (function () {
    try {
      return (1.5).toLocaleString().charAt(1) || '.';
    } catch (e) {
      return '.';
    }
  })();

  function parts(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const u = UNITS.find((x) => s >= x[1]);
    if (!u) return { num: String(s), unit: 'S' };
    const v = s / u[1];
    if (v < 10) {
      const t = Math.floor(v * 10);
      return { num: Math.floor(t / 10) + MARK + (t % 10), unit: u[0] };
    }
    return { num: String(Math.floor(v)), unit: u[0] };
  }

  function exact(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    if (s < 60) return s + ' s';
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const out = [];
    if (d) out.push(d + ' d');
    if (h) out.push(h + ' h');
    if (m || !out.length) out.push(m + ' min');
    return out.join(' ');
  }

  function tip(saved, name) {
    if (!saved || !saved.total) return 'Time saved by DynaBoost\nNothing yet – each tool adds the time it saves you.';
    const lines = ['Time saved by DynaBoost: ' + exact(saved.total)];
    let since = '';
    try {
      since = new Date(saved.since).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) {
      /* no date */
    }
    lines.push(saved.n + (saved.n === 1 ? ' use' : ' uses') + (since ? ' since ' + since : ''));
    const top = Object.keys(saved.tools || {})
      .map((id) => [id, saved.tools[id]])
      .filter((x) => Array.isArray(x[1]) && x[1][1] > 0)
      .sort((a, b) => b[1][1] - a[1][1])
      .slice(0, 3);
    if (top.length) {
      lines.push('');
      for (const [id, t] of top) {
        const [tool, what] = id.split(':');
        lines.push((name ? name(tool) : tool) + (what ? ' – ' + what : '') + ': ' + exact(t[1]) + ' (' + t[0] + '×)');
      }
    }
    return lines.join('\n');
  }

  function counter(doc, label) {
    const el = doc.createElement('span');
    el.className = 'db-saved';
    el.setAttribute('role', 'img');
    const num = doc.createElement('span');
    num.className = 'db-saved-n';
    const unit = doc.createElement('span');
    unit.className = 'db-saved-u';
    el.append(num, unit);
    if (label) {
      const l = doc.createElement('span');
      l.className = 'db-saved-l';
      l.textContent = 'saved';
      el.appendChild(l);
    }
    let shown = null;
    let glowTimer = 0;
    const still = () => {
      try {
        return !!(doc.defaultView && doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches);
      } catch (e) {
        return false;
      }
    };

    // The number rolls: the old one leaves upward, the new one comes up from below.
    function roll(text, animate) {
      const cur = num.querySelector('i:not(.db-saved-out)');
      if (cur && cur.textContent === text) return false;
      const next = doc.createElement('i');
      next.textContent = text;
      if (!cur || !animate) {
        num.textContent = '';
        num.appendChild(next);
        return !!cur;
      }
      next.className = 'db-saved-in';
      num.appendChild(next);
      cur.classList.add('db-saved-out');
      void next.offsetWidth;
      next.classList.remove('db-saved-in');
      setTimeout(() => cur.remove(), 500);
      return true;
    }

    return {
      el: el,
      get value() {
        return shown;
      },
      set(seconds, animate) {
        const p = parts(seconds);
        const go = !!animate && shown !== null && !still();
        const changed = roll(p.num, go);
        unit.textContent = p.unit;
        if (go && changed) {
          clearTimeout(glowTimer);
          el.classList.add('db-saved-glow');
          glowTimer = setTimeout(() => el.classList.remove('db-saved-glow'), 700);
        }
        shown = Math.max(0, Math.floor(Number(seconds) || 0));
        el.setAttribute('aria-label', 'Time saved: ' + exact(shown) + ' (' + NAMES[p.unit] + ')');
      }
    };
  }

  DynaBoost.timeSaved = { KEY: KEY, parts: parts, exact: exact, tip: tip, counter: counter };
})();
