/**
 * `creativo/no-hand-built-load-slice` — REUSE, NEVER COPY for the one read
 * state (UI residue cleanup UR-2, §2.1): a `LoadSlice` is built by its
 * companion in `@creativo/shared/view-state` — `LoadSlice.ready(data)`,
 * `LoadSlice.loading`, `LoadSlice.failed`, `LoadSlice.empty` — never spelled
 * out again at a use site, so a change to the slice's shape touches one
 * factory instead of every copy.
 *
 * Reported: an object literal that IS a load slice and nothing else —
 *   - exactly `{ loadState: LoadState.Ready, data: … }` (`data` shorthand
 *     included), or
 *   - exactly `{ loadState: LoadState.Loading }`, `{ loadState:
 *     LoadState.Failed }` or `{ loadState: LoadState.Empty }`.
 * NOT reported: a literal that carries any other field or a spread — a
 * paging or page state (`{ ...LOADING_HISTORY, loadState: LoadState.Ready }`,
 * `{ loadState: LoadState.Ready, subline, groups, paging }`) is a different
 * slice type, not a `LoadSlice`; a `loadState` that is not a member read off
 * `LoadState` (a variable, a parameter); a computed key.
 *
 * Options (path fragments, see `pathScope` in `path-scope.mjs`):
 * `include` / `allowIn` — `allowIn` carries `libs/shared/view-state`, where
 * the companion itself builds the variants.
 */
import { PATH_FRAGMENTS, pathScope } from './path-scope.mjs';

/** A `LoadState` member → the companion expression that replaces its literal. */
const COMPANION = {
  Ready: 'LoadSlice.ready(…)',
  Loading: 'LoadSlice.loading',
  Failed: 'LoadSlice.failed',
  Empty: 'LoadSlice.empty',
};

/** The static name of a plain `key: value` property, or null. */
function plainKey(property) {
  if (property.type !== 'Property') return null;
  if (property.computed || property.kind !== 'init' || property.method) {
    return null;
  }
  const key = property.key;
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  return null;
}

/** `LoadState.<Member>` → `'<Member>'` for a member the companion builds, else null. */
function loadStateMember(value) {
  if (value.type !== 'MemberExpression' || value.computed) return null;
  if (value.object.type !== 'Identifier' || value.object.name !== 'LoadState') {
    return null;
  }
  if (value.property.type !== 'Identifier') return null;
  return Object.hasOwn(COMPANION, value.property.name)
    ? value.property.name
    : null;
}

export const noHandBuiltLoadSlice = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Reuse, never copy: build a `LoadSlice` with its companion (`LoadSlice.ready(data)`, `LoadSlice.loading`, `LoadSlice.failed`, `LoadSlice.empty`), never a hand-written `{ loadState: LoadState.… }` literal.',
    },
    schema: [
      {
        type: 'object',
        properties: { include: PATH_FRAGMENTS, allowIn: PATH_FRAGMENTS },
        additionalProperties: false,
      },
    ],
    messages: {
      handBuiltLoadSlice:
        'A hand-built load slice (`LoadState.{{member}}`): use `{{companion}}` from `@creativo/shared/view-state` — the one companion that builds every read state (UI residue cleanup UR-2).',
    },
  },
  create(context) {
    if (!pathScope(context).active) return {};
    return {
      ObjectExpression(node) {
        const keys = [];
        for (const property of node.properties) {
          const key = plainKey(property);
          if (key === null) return;
          keys.push([key, property]);
        }
        const state = keys.find(([key]) => key === 'loadState');
        if (state === undefined) return;
        const member = loadStateMember(state[1].value);
        if (member === null) return;
        const others = keys.filter(([key]) => key !== 'loadState');
        const isSlice =
          member === 'Ready'
            ? others.length === 1 && others[0][0] === 'data'
            : others.length === 0;
        if (!isSlice) return;
        context.report({
          node,
          messageId: 'handBuiltLoadSlice',
          data: { member, companion: COMPANION[member] },
        });
      },
    };
  },
};
