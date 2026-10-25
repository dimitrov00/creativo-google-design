/**
 * `creativo/no-generic-discriminator` — Law 6.2 for view state and every
 * other UI union: a discriminator is never a field called `kind`, `type` or
 * `status`. It is named after its domain — `camelCase(Dictionary)`:
 * `loadState: LoadState`, `pagingState: PagingState`, `bookingStatus:
 * BookingStatus` — with SCREAMING_SNAKE values declared once in an
 * `as const` dictionary and compared with `===` against the dictionary
 * member.
 *
 * Reported: a `TSPropertySignature` whose key is the identifier or string
 * literal `kind`, `type` or `status` — in an interface, a type alias, or an
 * inline type literal (`computed<{ kind: … }>`, `row: { readonly status: … }`).
 * That is the half of `ECS_GENERIC_DISCRIMINATOR_RESTRICTIONS` without false
 * positives. Object-literal PROPERTIES are not reported: `{ type:
 * 'conjunction' }` is an `Intl.ListFormat` option, `PLACEHOLDER_HEIGHTS.status`
 * a CSS key — and an object literal typed by a renamed type fails typecheck
 * anyway. A class field (an Angular `input` named `kind`) is a
 * `PropertyDefinition`, not a signature, and is not reported either.
 *
 * Options (path fragments, see `pathScope` in `path-scope.mjs`):
 * `include` / `allowIn`. The root config passes no `allowIn`: the one file
 * it ever carried, the icon MANIFEST (a `schemaVersion`'d JSON input format
 * whose asset discriminator was the wire field `kind`, ui-residue-cleanup
 * UR-13 a), renamed that field `iconAsset` in schema 2 (pass D, DEP-16) and
 * is checked like every other UI file.
 */
import { PATH_FRAGMENTS, pathScope } from './path-scope.mjs';

const GENERIC_NAMES = new Set(['kind', 'type', 'status']);

/** The static name of a signature key (`kind`, `'kind'`, `['kind']`), or null. */
function keyName(node) {
  const key = node.key;
  if (key.type === 'Identifier' && !node.computed) return key.name;
  if (key.type === 'Literal' && typeof key.value === 'string') {
    return key.value;
  }
  return null;
}

export const noGenericDiscriminator = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Law 6.2: no `kind`/`type`/`status` field in a type — a domain-prefixed discriminator with SCREAMING values from its `as const` dictionary.',
    },
    schema: [
      {
        type: 'object',
        properties: { include: PATH_FRAGMENTS, allowIn: PATH_FRAGMENTS },
        additionalProperties: false,
      },
    ],
    messages: {
      genericDiscriminator:
        'No `{{name}}` field (Law 6.2): name the discriminator after its domain — `loadState: LoadState`, `pagingState: PagingState`, `bookingStatus: BookingStatus` — with SCREAMING_SNAKE values from its `as const` dictionary, compared with `===` against the dictionary member (a single-variant tag is deleted, not renamed).',
    },
  },
  create(context) {
    if (!pathScope(context).active) return {};
    return {
      TSPropertySignature(node) {
        const name = keyName(node);
        if (name !== null && GENERIC_NAMES.has(name)) {
          context.report({
            node: node.key,
            messageId: 'genericDiscriminator',
            data: { name },
          });
        }
      },
    };
  },
};
