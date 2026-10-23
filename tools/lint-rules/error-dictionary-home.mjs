/**
 * `creativo/error-dictionary-home` — Law 7.5 and the Error file kind
 * (CLAUDE.md §2): an error dictionary — a module-level PascalCase
 * `*ErrorCode` or `*RefusalCode` (a constant, an enum or an export alias),
 * the ONLY source of its SCREAMING codes — lives in its HOME and nowhere
 * else. The home is a path, not a suffix: the `@core/errors` tier
 * (`libs/ecs-core/src/errors/<domain>.error.ts`) and the one file below it,
 * `libs/ecs-core/src/primitives/primitive.error.ts` (`PrimitiveErrorCode` —
 * the brands' smart constructors answer it). A `*.error.ts` anywhere else is
 * itself reported: a dictionary must not leave the tier by taking the
 * suffix, nor escape the edge's totality scan, which reads only those two
 * folders.
 *
 * The rule reads the file's physical path, not a `files` glob, so it holds
 * from either base path ESLint resolves the config against. A camelCase
 * local (`lastErrorCode`) is a value, not a dictionary.
 */

const DICTIONARY_NAME = /^[A-Z][A-Za-z0-9]*(ErrorCode|RefusalCode)$/;
const ERROR_FILE = /\.error\.ts$/;
const ERROR_HOME =
  /(^|\/)libs\/ecs-core\/src\/errors\/[^/]+\.error\.ts$|(^|\/)libs\/ecs-core\/src\/primitives\/primitive\.error\.ts$/;

export const errorDictionaryHome = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Law 7.5: an *ErrorCode / *RefusalCode dictionary lives only in libs/ecs-core/src/errors/*.error.ts (or primitives/primitive.error.ts).',
    },
    schema: [],
    messages: {
      outsideErrorFile:
        'Law 7.5: `{{name}}` is an error dictionary — declare it in the `@core/errors` tier (libs/ecs-core/src/errors/<domain>.error.ts), never here.',
      misplacedErrorFile:
        'Law 7.5: a `*.error.ts` file lives only in libs/ecs-core/src/errors/ (the `@core/errors` tier) — `primitives/primitive.error.ts` is the one exception. Move this file there, or rename it.',
    },
  },
  create(context) {
    const filename = (context.physicalFilename ?? context.filename).replaceAll(
      '\\',
      '/',
    );
    if (ERROR_HOME.test(filename)) return {};
    const report = (node, name) =>
      context.report({ node, messageId: 'outsideErrorFile', data: { name } });
    const checkDeclarator = (declarator) => {
      if (
        declarator.id.type === 'Identifier' &&
        DICTIONARY_NAME.test(declarator.id.name)
      ) {
        report(declarator.id, declarator.id.name);
      }
    };
    const checkEnum = (declaration) => {
      if (DICTIONARY_NAME.test(declaration.id.name)) {
        report(declaration.id, declaration.id.name);
      }
    };
    return {
      Program(node) {
        if (ERROR_FILE.test(filename)) {
          context.report({ node, messageId: 'misplacedErrorFile' });
        }
      },
      'Program > VariableDeclaration > VariableDeclarator': checkDeclarator,
      'Program > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator':
        checkDeclarator,
      'Program > TSEnumDeclaration': checkEnum,
      'Program > ExportNamedDeclaration > TSEnumDeclaration': checkEnum,
      // `export { codes as BookingErrorCode }` — a dictionary under an alias.
      'Program > ExportNamedDeclaration > ExportSpecifier'(specifier) {
        const exported = specifier.exported;
        const name =
          exported.type === 'Identifier' ? exported.name : exported.value;
        const local =
          specifier.local.type === 'Identifier'
            ? specifier.local.name
            : specifier.local.value;
        const reexport = specifier.parent.source !== null;
        if (!reexport && name !== local && DICTIONARY_NAME.test(name)) {
          report(exported, name);
        }
      },
    };
  },
};
