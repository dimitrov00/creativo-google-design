/**
 * `creativo/presenter-purity` — Law 10 (CLAUDE.md): a presenter
 * (`*.presenter.ts`), a display model (`*.vm.ts`) and their wording helpers
 * (`*.words.ts`, `*.format.ts`) are PURE: ecs-core values and words in, a
 * display struct out. In those files the rule reports
 *
 *  - a `class` (Law 1/§2: plain functions and records only);
 *  - Angular — an `@angular/*` import, `inject()`, signals (`signal`,
 *    `computed`, `effect`, `linkedSignal`, `resource`, `toSignal`): a
 *    store or component calls the presenter inside its `computed()`;
 *  - I/O and streams — `@core/ports`, `@core/pipelines`, `@core/testing`,
 *    `@creativo/infrastructure/*` but `i18n`, Firebase, `rxjs`;
 *  - `async` / `await`;
 *  - the clock and randomness — `new Date(…)`, `Date.now()`,
 *    `Math.random()`, `performance.now()`: `now` arrives as an input;
 *  - in a `*.vm.ts` only: a top-level function value — a display model holds
 *    display-struct types and tag-to-word tables, the functions that fill
 *    them live in a `*.presenter.ts`.
 *
 * "It decides nothing" (Law 10.2) is a review rule — no selector can tell a
 * domain decision from wording; the decisions belong to ecs-core systems.
 * The rule reads the file's physical name, so it holds from either base
 * path and needs no `files` glob.
 */

const PRESENTATION_FILE = /\.(presenter|vm|words|format)\.ts$/;
const DISPLAY_MODEL = /\.vm\.ts$/;
const ANGULAR_CALLS = new Set([
  'inject',
  'signal',
  'computed',
  'effect',
  'linkedSignal',
  'resource',
  'toSignal',
]);
const IO_IMPORT =
  /^(@core\/(ports|pipelines|testing)$|@creativo\/infrastructure\/(?!i18n$)|firebase(\/|$)|firebase-admin(\/|$)|rxjs(\/|$))/;
const CLOCKS = [
  ['Date', 'now'],
  ['Math', 'random'],
  ['performance', 'now'],
];

export const presenterPurity = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Law 10: presenters, display models and their wording helpers are pure — no class, Angular, I/O, async, clock or randomness.',
    },
    schema: [],
    messages: {
      noClass:
        'Law 10: no `class` in a presenter, display model or wording helper — plain functions and readonly records only.',
      noAngular:
        'Law 10: a presenter is pure — no Angular (`{{what}}`). A store or component calls it inside its `computed()`.',
      noIo: 'Law 10: a presenter does no I/O and holds no stream — `{{what}}` is not importable here. Its inputs arrive as ecs-core values.',
      noAsync:
        'Law 10: a presenter is synchronous — no `async` / `await`. The store awaits; the presenter words the answer.',
      noClock:
        'Law 10: no `{{what}}` in a presenter — `now` arrives as an input (`ShopNow` / `UtcEpochMs`), randomness never.',
      noFunctionInVm:
        'Law 10.3: a display model (`*.vm.ts`) holds types and tag-to-word tables only — move `{{what}}` into a `*.presenter.ts`.',
    },
  },
  create(context) {
    const filename = (context.physicalFilename ?? context.filename).replaceAll(
      '\\',
      '/',
    );
    if (!PRESENTATION_FILE.test(filename)) return {};
    const isVm = DISPLAY_MODEL.test(filename);
    const asyncFn = (node) => {
      if (node.async) context.report({ node, messageId: 'noAsync' });
    };
    const handlers = {
      ClassDeclaration(node) {
        context.report({ node, messageId: 'noClass' });
      },
      ClassExpression(node) {
        context.report({ node, messageId: 'noClass' });
      },
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== 'string') return;
        if (source.startsWith('@angular/')) {
          context.report({
            node,
            messageId: 'noAngular',
            data: { what: source },
          });
        } else if (IO_IMPORT.test(source)) {
          context.report({ node, messageId: 'noIo', data: { what: source } });
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          ANGULAR_CALLS.has(node.callee.name)
        ) {
          context.report({
            node,
            messageId: 'noAngular',
            data: { what: `${node.callee.name}()` },
          });
        }
      },
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'Date') {
          context.report({
            node,
            messageId: 'noClock',
            data: { what: 'new Date()' },
          });
        }
      },
      MemberExpression(node) {
        if (node.object.type !== 'Identifier') return;
        const property =
          node.property.type === 'Identifier' ? node.property.name : null;
        for (const [object, member] of CLOCKS) {
          if (node.object.name === object && property === member) {
            context.report({
              node,
              messageId: 'noClock',
              data: { what: `${object}.${member}()` },
            });
          }
        }
      },
      AwaitExpression(node) {
        context.report({ node, messageId: 'noAsync' });
      },
      FunctionDeclaration: asyncFn,
      FunctionExpression: asyncFn,
      ArrowFunctionExpression: asyncFn,
    };
    if (isVm) {
      const topLevelFunction = (node, name) =>
        context.report({
          node,
          messageId: 'noFunctionInVm',
          data: { what: name },
        });
      handlers['Program > FunctionDeclaration'] = (node) =>
        topLevelFunction(node, node.id?.name ?? 'a function');
      handlers['Program > ExportNamedDeclaration > FunctionDeclaration'] = (
        node,
      ) => topLevelFunction(node, node.id?.name ?? 'a function');
      const constFunction = (declarator) => {
        const init = declarator.init;
        if (
          init &&
          (init.type === 'ArrowFunctionExpression' ||
            init.type === 'FunctionExpression')
        ) {
          topLevelFunction(
            declarator,
            declarator.id.type === 'Identifier'
              ? declarator.id.name
              : 'a function',
          );
        }
      };
      handlers['Program > VariableDeclaration > VariableDeclarator'] =
        constFunction;
      handlers[
        'Program > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator'
      ] = constFunction;
    }
    return handlers;
  },
};
