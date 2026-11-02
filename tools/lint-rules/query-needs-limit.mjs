/**
 * `creativo/query-needs-limit` — a Firestore query says how much it may read
 * (`docs/architecture/performance-cost-audit.md` F-04). Every document a query
 * returns is billed, so an unbounded one is a cost that grows with the data
 * while every test stays green.
 *
 * Reported, unless a `// unbounded-ok: <reason>` comment stands on the line
 * above it, or above the statement holding it:
 *   - a `QuerySpec` written as data with `limit: null`;
 *   - a modular `query(…)` with no `limit(…)` / `limitToLast(…)` argument,
 *     including one with a spread, which the rule cannot see into;
 *   - an Admin SDK chain ending in `.get()` or `.stream()` that holds a
 *     `.where(…)`, `.orderBy(…)` or `.collection(…)` link and no `.limit(…)`.
 *
 * Not reported:
 *   - a batch by document id (`where(documentId(), 'in', ids)`): Firestore caps
 *     the list, and each id names one document;
 *   - a `.doc(…)` read: one document;
 *   - `.get()` on a bare identifier. A chain assembled across variables is out
 *     of sight, which is this rule's known gap: it reads syntax, not types.
 *
 * A comment needs a reason: an empty `// unbounded-ok:` does not count.
 */

const WAIVER = /^\s*unbounded-ok:\s*\S/;

const TERMINALS = new Set(['get', 'stream']);
const QUERY_LINKS = new Set([
  'where',
  'orderBy',
  'collection',
  'collectionGroup',
]);

const calleeName = (call) => {
  const callee = call.callee;
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed) {
    return callee.property.name;
  }
  return null;
};

/** `documentId()` or `FieldPath.documentId()`. */
const isDocumentId = (node) =>
  node?.type === 'CallExpression' && calleeName(node) === 'documentId';

/** A `where(documentId(), 'in', …)` call's arguments. */
const isIdBatch = (args) =>
  isDocumentId(args[0]) &&
  args[1]?.type === 'Literal' &&
  args[1].value === 'in';

const isCall = (node) => node?.type === 'CallExpression';

/** The calls of a chain, outermost first: `a.b().c()` gives `c()`, `b()`. */
function chainOf(call) {
  const links = [];
  let node = call;
  while (node) {
    while (
      node.type === 'TSNonNullExpression' ||
      node.type === 'TSAsExpression'
    ) {
      node = node.expression;
    }
    if (!isCall(node) || node.callee.type !== 'MemberExpression') break;
    links.push(node);
    node = node.callee.object;
  }
  return links;
}

export const queryNeedsLimit = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'a Firestore query needs a limit, or a comment saying why it is bounded',
    },
    schema: [],
    messages: {
      specNull:
        '`limit: null` reads every match: give it a number, or say why it is bounded with `// unbounded-ok: <reason>` on the line above.',
      modular:
        'This query() has no limit() it can show: add one, or say why it is bounded with `// unbounded-ok: <reason>` on the line above.',
      admin:
        'This query reads every match: add .limit(), or say why it is bounded with `// unbounded-ok: <reason>` on the line above.',
    },
  },

  create(context) {
    const source = context.sourceCode;

    const waived = (node) => {
      const lines = new Set([node.loc.start.line - 1]);
      for (const ancestor of source.getAncestors(node)) {
        if (/Statement$|Declaration$|^Property$/.test(ancestor.type)) {
          lines.add(ancestor.loc.start.line - 1);
        }
      }
      return source
        .getAllComments()
        .some(
          (comment) =>
            comment.type === 'Line' &&
            lines.has(comment.loc.end.line) &&
            WAIVER.test(comment.value),
        );
    };

    const report = (node, messageId) => {
      if (!waived(node)) context.report({ node, messageId });
    };

    return {
      ObjectExpression(node) {
        const keys = new Map();
        for (const property of node.properties) {
          if (property.type === 'Property' && !property.computed) {
            keys.set(property.key.name, property);
          }
        }
        const limit = keys.get('limit');
        if (
          keys.has('collection') &&
          keys.has('where') &&
          limit?.value.type === 'Literal' &&
          limit.value.value === null
        ) {
          report(limit, 'specNull');
        }
      },

      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'query') {
          let bounded = false;
          for (const argument of node.arguments) {
            if (!isCall(argument)) continue;
            const name = calleeName(argument);
            if (name === 'limit' || name === 'limitToLast') bounded = true;
            if (name === 'where' && isIdBatch(argument.arguments)) {
              bounded = true;
            }
          }
          if (!bounded) report(node, 'modular');
          return;
        }

        if (
          node.callee.type !== 'MemberExpression' ||
          !TERMINALS.has(node.callee.property.name)
        ) {
          return;
        }
        const links = chainOf(node).slice(1);
        const names = links.map(calleeName);
        if (names.includes('doc') && names[0] === 'doc') return;
        if (!names.some((name) => QUERY_LINKS.has(name))) return;
        if (names.includes('limit')) return;
        const idBatch = links.some(
          (link) => calleeName(link) === 'where' && isIdBatch(link.arguments),
        );
        if (!idBatch) report(node, 'admin');
      },
    };
  },
};
