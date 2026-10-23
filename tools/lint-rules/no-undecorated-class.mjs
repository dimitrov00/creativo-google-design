/**
 * `creativo/no-undecorated-class` — CLAUDE.md §2: `class` is legal ONLY in
 * the Angular row. Every `ClassDeclaration` and `ClassExpression` is
 * reported unless it carries a CALLED Angular decorator — `@Component(…)`,
 * `@Directive(…)`, `@Pipe(…)`, `@Injectable(…)` or `@NgModule(…)`. A value
 * object, a clock, a scroller or a reporter is a plain object returned by a
 * factory function (closures hold its state), never `new SomeClass(…)`.
 *
 * `implements OnDestroy` does not make a class Angular, and neither does an
 * uncalled `@Component` or a decorator of another name: Angular only
 * compiles the five called decorators above.
 *
 * Test doubles (`FakeFirestore`, DOM observer polyfills, spec-local stubs)
 * stay legal because the root config never runs this rule on specs,
 * `testing/`, `test-setup.ts` or `e2e/` — see `ui-residue-cleanup.md` UR-8.
 *
 * ── Path scope ──────────────────────────────────────────────────────────
 *
 * Options `include` / `allowIn` (path fragments) — read by `pathScope` of
 * `./path-scope.mjs`, the one reading the three UI-residue guards share.
 */

import { PATH_FRAGMENTS, pathScope } from './path-scope.mjs';

const ANGULAR_DECORATORS = new Set([
  'Component',
  'Directive',
  'Pipe',
  'Injectable',
  'NgModule',
]);

/** Is this decorator a CALL of one of the five Angular class decorators? */
function isAngularDecorator(decorator) {
  const expression = decorator.expression;
  return (
    expression?.type === 'CallExpression' &&
    expression.callee.type === 'Identifier' &&
    ANGULAR_DECORATORS.has(expression.callee.name)
  );
}

export const noUndecoratedClass = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'CLAUDE.md §2: `class` only for Angular kinds (@Component, @Directive, @Pipe, @Injectable, @NgModule); everything else is a plain object from a factory.',
    },
    schema: [
      {
        type: 'object',
        properties: { include: PATH_FRAGMENTS, allowIn: PATH_FRAGMENTS },
        additionalProperties: false,
      },
    ],
    messages: {
      undecoratedClass:
        'No `class` outside the Angular row (CLAUDE.md §2): a value is a plain object from a factory function; only `@Component`, `@Directive`, `@Pipe`, `@Injectable`, `@NgModule` classes are legal.',
    },
  },
  create(context) {
    if (!pathScope(context).active) return {};
    const check = (node) => {
      if ((node.decorators ?? []).some(isAngularDecorator)) return;
      context.report({ node: node.id ?? node, messageId: 'undecoratedClass' });
    };
    return { ClassDeclaration: check, ClassExpression: check };
  },
};
