/* Form as JSON, the business process flow's definition: what the page's Xrm
 * does not tell - the branches and their conditions. Read from the process's
 * own row (workflows, category 4) - its XAML - with one request:
 *
 *   stages    in the order the XAML has them: id, name, table, the stage
 *             that follows when there is no branch (next), and the steps -
 *             each with its column(s), required or not, or the workflow /
 *             action it runs;
 *   branches  each condition after a stage: the rules in order ("if Budget
 *             is greater than 10000" → a stage), and where it goes otherwise;
 *   unread    the parts of the XAML not understood here, by name - said, not
 *             left out without a word.
 *
 * As Dataverse writes it: each stage in an EntityComposite, its steps
 * (StepComposite, the column in a Control, the name in StepLabels) and, after
 * them, its condition - a ConditionSequence whose ConditionBranches stand side
 * by side, each going to a stage with SetNextStage (StageId); the last one,
 * on the condition True, is "otherwise". The conditions themselves are written
 * the way classic workflows write them (GetEntityProperty, EvaluateExpression,
 * EvaluateCondition, EvaluateLogicalCondition); an Else holding another
 * branch is read as "else if" too. Words come from the caller's labels
 * (column, choice). Nothing is written. Used by form-dump.js:
 * DynaBoost.formBpf.
 */
(function () {
  if (DynaBoost.off) return;
  const X_NS = 'http://schemas.microsoft.com/winfx/2006/xaml';

  const attr = (node, name) => node.getAttribute(name) || '';
  const keyOf = (node) => node.getAttributeNS(X_NS, 'Key') || node.getAttribute('x:Key') || '';
  const clean = (g) => String(g || '').replace(/[{}]/g, '').toLowerCase();

  // What an activity is: its class (…Activities.StageComposite, …) or the
  // designer's name for it ("StageStep3: Develop").
  function kindOf(node) {
    const m = attr(node, 'AssemblyQualifiedName').match(/\.([A-Za-z]+),/);
    if (m) return m[1];
    const d = attr(node, 'DisplayName').match(/^([A-Za-z]+?)\d*:/);
    return d ? d[1] : node.localName;
  }
  const isStage = (k) => k === 'StageComposite' || k === 'StageStep';
  const isStep = (k) => k === 'StepComposite' || k === 'StepStep';
  const isEntity = (k) => k === 'EntityComposite' || k === 'EntityStep';

  function nameOf(node) {
    const d = attr(node, 'DisplayName');
    const i = d.indexOf(': ');
    return i > -1 ? d.slice(i + 2) : '';
  }

  // An activity's own properties and arguments, by key: elements, and text.
  function partsOf(node, which) {
    const out = {};
    for (const child of node.children) {
      if (child.localName !== 'ActivityReference.' + which) continue;
      for (const p of child.children) {
        const k = keyOf(p);
        if (k) out[k] = p;
      }
    }
    return out;
  }
  const text = (el) => (el ? (el.textContent || '').trim() : '');

  function varName(t) {
    const m = String(t || '').match(/^\[([A-Za-z0-9_]+)\]$/);
    return m ? m[1] : null;
  }

  // [New Object() { …WorkflowPropertyType.OptionSetValue, "100000001", "Picklist" }]
  function literalOf(params) {
    const m = String(params || '').match(/WorkflowPropertyType\.(\w+),\s*"([^"]*)"/);
    return m ? { kind: 'literal', type: m[1], value: m[2] } : null;
  }

  const OPERATORS = {
    Null: 'is empty',
    NotNull: 'is not empty',
    Equal: 'equals',
    NotEqual: 'does not equal',
    GreaterThan: 'is greater than',
    LessThan: 'is less than',
    GreaterEqual: 'is greater or equal to',
    LessEqual: 'is less or equal to',
    Like: 'contains',
    NotLike: 'does not contain',
    BeginsWith: 'begins with',
    EndsWith: 'ends with',
    In: 'is in',
    NotIn: 'is not in',
    On: 'is on',
    Between: 'is between'
  };

  // Plumbing of the XAML - read for what it carries, never "not understood".
  // StageRelationshipCollectionComposite: how a stage on another table is reached (its relationship) - not a branch.
  const PLUMBING = new Set(['GetEntityProperty', 'EvaluateExpression', 'EvaluateCondition', 'EvaluateLogicalCondition', 'Composite', 'Sequence', 'Collection', 'Workflow', 'Assign', 'Persist', 'Variable', 'ActivityReference', 'StageRelationshipCollectionComposite', 'StageRelationshipComposite']);

  // The name the designer shows: StepLabels' Description (a step's DisplayName is "StepStep4: New Step").
  function labelOf(node, p) {
    const labels = p.StepLabels;
    if (labels) {
      for (const l of labels.children) if (attr(l, 'Description')) return attr(l, 'Description');
    }
    return '';
  }

  /* The XAML as stages and branches. The walk goes in document order: a
   * condition belongs to the stage last seen before it - a branch decides on
   * the steps of the stage just before it. */
  function read(xaml) {
    let s = String(xaml || '').replace(/^﻿?\s*<\?xml[^>]*\?>/i, '');
    // .NET's clr-namespace URIs are not URIs to the browser's parser.
    s = s.replace(/xmlns:([A-Za-z0-9_.-]+)="clr-namespace:[^"]*"/g, 'xmlns:$1="urn:dynaboost:$1"');
    const doc = new DOMParser().parseFromString(s, 'application/xml');
    const bad = doc.getElementsByTagName('parsererror')[0];
    if (bad) throw new Error('The process XAML could not be read: ' + text(bad).replace(/\s+/g, ' ').slice(0, 200));

    const vars = Object.create(null);
    const stages = [];
    const byId = Object.create(null);
    const branches = [];
    const unread = new Set();
    let lastStage = null;

    const resolve = (t) => {
      const v = varName(t);
      return v ? vars[v] || { kind: 'raw', text: v } : { kind: 'raw', text: String(t || '') };
    };

    // Activities written once and pointed at elsewhere: x:Name / <x:Reference>.
    const named = Object.create(null);
    for (const el of doc.getElementsByTagName('*')) {
      const n = el.getAttributeNS(X_NS, 'Name') || el.getAttribute('x:Name');
      if (n) named[n] = el;
    }
    const TARGET_KEY = /^(Next|Target|Destination|To)?StageId$/;

    // The stage a branch goes to: the first stage in it, or one an activity names.
    function targetIn(node) {
      const list = [node].concat(Array.from(node.getElementsByTagName('*')));
      // A stage written elsewhere and only pointed at here.
      for (const el of list) {
        if (el.localName === 'Reference' && named[text(el)]) list.push(named[text(el)]);
      }
      // SetNextStage StageId="…" - how Dataverse writes where a branch goes.
      for (const el of list) {
        if (el.localName === 'SetNextStage' && attr(el, 'StageId')) return clean(attr(el, 'StageId'));
      }
      for (const el of list) {
        if (el.localName !== 'ActivityReference') continue;
        const k = kindOf(el);
        const p = partsOf(el, 'Properties');
        if (isStage(k) && p.StageId) return clean(text(p.StageId));
        if (!isStage(k) && !isStep(k) && !isEntity(k)) {
          const named = p.StageId || p.NextStageId || partsOf(el, 'Arguments').StageId;
          if (named && text(named)) return clean(text(named));
        }
      }
      for (const el of list) if (TARGET_KEY.test(keyOf(el)) && text(el)) return clean(text(el));
      return null;
    }

    function stepOf(node, entity) {
      const p = partsOf(node, 'Properties');
      const named = nameOf(node);
      const step = { step: labelOf(node, p) || (named !== 'New Step' ? named : '') || text(p.Description) || '', fields: [], required: text(p.IsProcessRequired).toLowerCase() === 'true' };
      for (const c of node.getElementsByTagName('*')) {
        if (c.localName !== 'Control') continue;
        const f = attr(c, 'DataFieldName') || attr(c, 'ControlId');
        if (f && step.fields.indexOf(f) < 0) step.fields.push(f);
        if (!step.step) step.step = attr(c, 'ControlDisplayName') || attr(c, 'DisplayName');
        if (attr(c, 'IsRequired').toLowerCase() === 'true' || attr(c, 'IsProcessRequired').toLowerCase() === 'true') step.required = true;
      }
      // A step that runs something - a workflow, an action - names it.
      for (const k of Object.keys(p)) {
        if (/^(WorkflowId|ProcessId|ActionId|ActionName|WorkflowName)$/i.test(k) && text(p[k])) step[k.charAt(0).toLowerCase() + k.slice(1)] = text(p[k]);
      }
      if (entity) step.table = entity;
      return step;
    }

    function walk(node, entity) {
      for (const child of node.children) {
        const kind = kindOf(child);

        if (kind === 'GetEntityProperty') {
          const out = varName(attr(child, 'Value'));
          if (out) vars[out] = { kind: 'field', entity: attr(child, 'EntityName'), attribute: attr(child, 'Attribute') };
          continue;
        }
        if (kind === 'EvaluateExpression') {
          const a = partsOf(child, 'Arguments');
          const out = varName(text(a.Result));
          if (out) vars[out] = literalOf(text(a.Parameters)) || { kind: 'raw', text: 'a value' };
          continue;
        }
        if (kind === 'EvaluateCondition') {
          const a = partsOf(child, 'Arguments');
          const out = varName(text(a.Result));
          const rightVar = text(a.Parameters).match(/\{\s*([A-Za-z0-9_]+)\s*\}/);
          if (out) vars[out] = { kind: 'condition', left: resolve(text(a.Operand)), op: text(a.ConditionOperator), right: rightVar ? vars[rightVar[1]] || null : literalOf(text(a.Parameters)) };
          continue;
        }
        if (kind === 'EvaluateLogicalCondition') {
          const a = partsOf(child, 'Arguments');
          const out = varName(text(a.Result));
          if (out) vars[out] = { kind: 'logical', op: text(a.LogicalOperator) || 'And', left: resolve(text(a.LeftOperand)), right: resolve(text(a.RightOperand)) };
          continue;
        }

        if (isEntity(kind)) {
          const p = partsOf(child, 'Properties');
          walk(child, text(p.EntityLogicalName) || attr(child, 'EntityLogicalName') || entity);
          continue;
        }

        if (isStage(kind)) {
          const p = partsOf(child, 'Properties');
          const st = {
            id: clean(text(p.StageId)) || null,
            stage: labelOf(child, p) || nameOf(child) || text(p.StageName) || '',
            table: entity || null,
            next: clean(text(p.NextStageId)) || null,
            steps: []
          };
          if (text(p.StageCategory)) st.category = text(p.StageCategory);
          stages.push(st);
          if (st.id) byId[st.id] = st;
          lastStage = st;
          // Its steps; anything else in it is walked as usual.
          const coll = p.Activities || child;
          for (const el of coll.children) {
            const k = kindOf(el);
            if (isStep(k)) st.steps.push(stepOf(el, entity));
            else walkOne(el, entity);
          }
          continue;
        }

        if (kind === 'ConditionSequence') {
          const after = lastStage;
          const entry = { after: after ? after.id : null, afterName: after ? after.stage : null, rules: [], otherwise: null };
          branches.push(entry);
          plumbing(child, entity);
          for (const br of branchesOf(child)) branch(br, entry, entity);
          continue;
        }

        if (kind === 'ConditionBranch') {
          walk(child, entity);
          continue;
        }

        // An activity that names a stage is where a branch goes (targetIn).
        const named = child.localName === 'ActivityReference' && (partsOf(child, 'Properties').StageId || partsOf(child, 'Arguments').StageId);
        if (child.localName === 'ActivityReference' && !PLUMBING.has(kind) && !isStep(kind) && !named) unread.add(kind);
        walk(child, entity);
      }
    }
    const walkOne = (el, entity) => walk({ children: [el] }, entity);

    // A condition's branches side by side: those whose nearest branch or condition above is it.
    function branchesOf(seq) {
      return Array.from(seq.getElementsByTagName('*')).filter((el) => {
        if (el.localName !== 'ActivityReference' || kindOf(el) !== 'ConditionBranch') return false;
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (p.localName !== 'ActivityReference') continue;
          const k = kindOf(p);
          if (k === 'ConditionBranch') return false;
          if (k === 'ConditionSequence') return p === seq;
        }
        return false;
      });
    }

    // The first ConditionBranch under a node, not inside another branch or condition.
    function branchIn(node) {
      for (const el of node.children) {
        const k = kindOf(el);
        if (k === 'ConditionBranch') return el;
        if (k === 'ConditionSequence' || isStage(k)) continue;
        const inner = branchIn(el);
        if (inner) return inner;
      }
      return null;
    }

    /* One branch: its rule (if … → a stage), what its Then holds walked as
     * anywhere; an Else holding another branch is "else if", any other Else
     * is where it goes otherwise. */
    function branch(br, entry, entity) {
      const p = partsOf(br, 'Properties');
      const c = text(partsOf(br, 'Arguments').Condition);
      // The branch on True: the designer's "otherwise".
      if (/^true$/i.test(c)) {
        entry.otherwise = p.Then ? targetIn(p.Then) : null;
        if (p.Then) walk({ children: [p.Then] }, entity);
        return;
      }
      const rule = { cond: resolve(c), to: p.Then ? targetIn(p.Then) : null };
      if (text(p.Description)) rule.name = text(p.Description);
      entry.rules.push(rule);
      if (p.Then) walk({ children: [p.Then] }, entity);
      if (!p.Else || !p.Else.children.length) return;
      const next = kindOf(p.Else) === 'ConditionBranch' ? p.Else : branchIn(p.Else);
      if (next) {
        plumbing(p.Else, entity);
        branch(next, entry, entity);
        return;
      }
      entry.otherwise = targetIn(p.Else);
      walk({ children: [p.Else] }, entity);
    }

    // The values a condition is made of, set up before its branches use them.
    function plumbing(node, entity) {
      for (const el of node.getElementsByTagName('*')) {
        const k = kindOf(el);
        if (k === 'GetEntityProperty' || k === 'EvaluateExpression' || k === 'EvaluateCondition' || k === 'EvaluateLogicalCondition') walk({ children: [el] }, entity);
      }
    }

    walk(doc.documentElement, null);
    return { stages: stages, byId: byId, branches: branches, unread: Array.from(unread) };
  }

  /* In words, with the caller's labels: label(table, column) and
   * option(table, column, value) give text or null. */
  function words(def, labels) {
    const L = labels || {};
    const col = (t, c) => (L.label && L.label(t, c)) || c;
    const value = (v, t, c) => {
      if (!v) return '';
      if (v.kind === 'field') return col(v.entity, v.attribute);
      if (v.kind === 'literal') {
        if ((v.type === 'OptionSetValue' || v.type === 'Boolean') && c) {
          const o = L.option && L.option(t, c, v.value);
          if (o) return o;
        }
        if (v.value === '') return '(empty)';
        return v.type === 'String' ? '"' + v.value + '"' : v.value;
      }
      return v.text || '';
    };
    const cond = (x) => {
      if (!x) return '?';
      if (x.kind === 'logical') return cond(x.left) + ' ' + String(x.op).toLowerCase() + ' ' + cond(x.right);
      if (x.kind !== 'condition') return x.text || '?';
      const left = x.left;
      const isField = left && left.kind === 'field';
      const op = OPERATORS[x.op] || x.op || '';
      const right = isField ? value(x.right, left.entity, left.attribute) : value(x.right);
      return ((isField ? col(left.entity, left.attribute) : value(left)) + ' ' + op + (right ? ' ' + right : '')).trim();
    };
    return cond;
  }

  DynaBoost.formBpf = { read: read, words: words, clean: clean };
})();
