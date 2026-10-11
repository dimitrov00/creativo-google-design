/**
 * `creativo/no-restricted-import-expressions` — the `regex` patterns of
 * `no-restricted-imports`, applied to the module specifiers that rule never
 * reads: `import('…')` expressions, `import('…').Name` type queries and
 * `import x = require('…')`. ESLint's core rule checks only static
 * `import … from` / `export … from`, so without this a Law 8 breach written
 * as a lazy import (`() => import('@core/components')` in a primitives file)
 * lints clean and only the uncached `verify-tools:layering` sees it.
 *
 * Options: `{ patterns: [{ regex, caseSensitive?, message? }] }` — the same
 * objects libs/ecs-core's `no-restricted-imports` blocks list, so one table
 * drives both halves. A specifier is reported once, for the first pattern it
 * matches; a computed specifier (`import(name)`, a template with `${…}`) is
 * not a literal and is left to the verifier. Options replace, never merge,
 * like every ESLint rule: a block that restates this rule restates the set.
 */

/**
 * A parent segment ANYWHERE in a specifier — `..`, `../x`, `./../x`,
 * `./a/../../x` — not only at its start (`./../x` climbs as surely as
 * `../x`). Never matches `./x`, a package, an alias or a file named `..x`.
 * libs/ecs-core bans it in both halves (Law 8.3: no `../` inside the
 * library).
 */
export const PARENT_SEGMENT_REGEX = String.raw`(^|/)\.\.(/|$)`;

/** The text of a string literal or a template without substitutions. */
function literalText(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

export const noRestrictedImportExpressions = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Apply `no-restricted-imports` regex patterns to `import()` expressions, `import()` type queries and `import = require()`.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          patterns: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                regex: { type: 'string' },
                caseSensitive: { type: 'boolean' },
                message: { type: 'string' },
              },
              required: ['regex'],
              additionalProperties: false,
            },
          },
        },
        required: ['patterns'],
        additionalProperties: false,
      },
    ],
    messages: {
      restricted:
        "'{{specifier}}' import is restricted from being used by a pattern. {{message}}",
    },
  },
  create(context) {
    const [{ patterns }] = context.options;
    // The flags of `no-restricted-imports` itself: case-insensitive unless
    // `caseSensitive`, unicode always.
    const compiled = patterns.map(
      ({ regex, caseSensitive = false, message = '' }) => ({
        pattern: new RegExp(regex, caseSensitive ? 'u' : 'iu'),
        message,
      }),
    );
    const check = (node) => {
      const specifier = literalText(node);
      if (specifier === null) return;
      const hit = compiled.find(({ pattern }) => pattern.test(specifier));
      if (hit) {
        context.report({
          node,
          messageId: 'restricted',
          data: { specifier, message: hit.message },
        });
      }
    };
    return {
      ImportExpression(node) {
        check(node.source);
      },
      // typescript-eslint 8 names the literal `source`; older releases
      // wrapped it as `argument: TSLiteralType`.
      TSImportType(node) {
        check(node.source ?? node.argument?.literal);
      },
      TSExternalModuleReference(node) {
        check(node.expression);
      },
    };
  },
};
