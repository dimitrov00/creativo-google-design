/**
 * `creativo/no-ambient-clock` — Law 7 in the UI layer: production code never
 * reads the wall clock, builds a date object or draws entropy on its own.
 *
 * Reported:
 *   - `new Date(…)` and `Date(…)`;
 *   - `Date.now` and `Date.parse` — called or passed as a value;
 *   - a `Date` type reference (`at: Date`, `(): Date`, `Date[]`);
 *   - `Math.random`;
 *   - `crypto.randomUUID` and `crypto.getRandomValues`.
 * Each also through `globalThis.` / `window.` / `self.`; a local binding of
 * the same name (an injected port called `crypto`, say) is not the global
 * and is not reported.
 *
 * Allowed: `Date.UTC(…)` (pure arithmetic returning a number) and
 * `performance.now()` (a monotonic interval — a toast's hold, a typeahead
 * window — not a domain clock).
 *
 * The replacements: "now" is the injected clock
 * `inject(CLOCK_PORTS).nowUtcMs()` (specs pin `memoryClockPorts`), "today"
 * in the shop's zone is `ZonedTimeSystem.toLocal`/`shopNow`, day arithmetic
 * is `LocalDate.addDays`/`daysBetween`, formatting is the cached
 * `@creativo/ui/wall-clock` formatters, ids come from `ID_PORTS`.
 *
 * Options (path fragments, see `pathScope` in `path-scope.mjs`):
 *   - `include` / `allowIn` — scope; `allowIn` names the sanctioned clock
 *     and entropy ADAPTERS, which are the one place the platform is read;
 *   - `allowRandomIn` — files where ONLY `Math.random` is lifted (a retry
 *     jitter, a visual particle effect); every clock form stays reported.
 */
import { PATH_FRAGMENTS, pathScope } from './path-scope.mjs';

const GLOBAL_OBJECTS = new Set(['globalThis', 'window', 'self']);

const messages = {
  newDate:
    'No `new Date` (Law 7.1): "now" is `inject(CLOCK_PORTS).nowUtcMs()`, a shop day and time are `ZonedTimeSystem.toLocal(…)` → `LocalDate` + `MinuteOfDay`, day arithmetic is `LocalDate.addDays`/`daysBetween`, and formatting goes through the `@creativo/ui/wall-clock` formatters (`formatWallClock`, `formatInstant`, …).',
  dateCall:
    'No `Date()` (Law 7.1): "now" is `inject(CLOCK_PORTS).nowUtcMs()`; format an instant with `formatInstant` of `@creativo/ui/wall-clock`.',
  dateNow:
    'No `Date.now` (Law 7.3): read the injected clock `inject(CLOCK_PORTS).nowUtcMs()` (specs pin `memoryClockPorts`) and derive the shop\'s "today" with `ZonedTimeSystem.shopNow`; an elapsed interval is `performance.now()`.',
  dateParse:
    'No `Date.parse` (Law 7.1): a shop day is `LocalDate.parse`, an offset ISO instant `ZonedTimeSystem.parseOffsetIso`, a day difference `LocalDate.daysBetween`.',
  dateType:
    'No `Date` type (Law 7.1): an instant is `UtcEpochMs`, a shop day `LocalDate`, a time of day `MinuteOfDay`; zone math is `ZonedTimeSystem`.',
  mathRandom:
    'No `Math.random` (Law 3/7): an id comes from the injected `ID_PORTS`; a randomness the plan justifies (retry jitter, a visual effect) is allow-listed by file with `allowRandomIn` in eslint.config.mjs.',
  cryptoRandom:
    'No `crypto.{{name}}` (Law 3/7): an id comes from the injected `ID_PORTS`; the browser-runtime adapter is the one sanctioned entropy reader.',
};

/** The static name of a member's property (`a.b`, `a['b']`), or null. */
function propertyName(member) {
  if (!member.computed && member.property.type === 'Identifier') {
    return member.property.name;
  }
  if (member.computed && member.property.type === 'Literal') {
    return typeof member.property.value === 'string'
      ? member.property.value
      : null;
  }
  return null;
}

export const noAmbientClock = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Law 7: no ambient clock, date object or entropy read in UI code — the injected CLOCK_PORTS / ID_PORTS, ZonedTimeSystem, LocalDate and the wall-clock formatters instead.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          include: PATH_FRAGMENTS,
          allowIn: PATH_FRAGMENTS,
          allowRandomIn: PATH_FRAGMENTS,
        },
        additionalProperties: false,
      },
    ],
    messages,
  },
  create(context) {
    const scope = pathScope(context);
    if (!scope.active) return {};
    const randomAllowed = scope.listed('allowRandomIn');
    const { sourceCode } = context;

    /** Is `identifier` the global of that name, not a local binding? */
    const isGlobalBinding = (identifier) => {
      for (
        let current = sourceCode.getScope(identifier);
        current;
        current = current.upper
      ) {
        const variable = current.set.get(identifier.name);
        if (variable) return variable.defs.length === 0;
      }
      return true;
    };

    /** `name`, `globalThis.name`, `window.name` or `self.name` — the global. */
    const isGlobal = (node, name) => {
      if (node.type === 'Identifier') {
        return node.name === name && isGlobalBinding(node);
      }
      return (
        node.type === 'MemberExpression' &&
        propertyName(node) === name &&
        node.object.type === 'Identifier' &&
        GLOBAL_OBJECTS.has(node.object.name) &&
        isGlobalBinding(node.object)
      );
    };

    return {
      NewExpression(node) {
        if (isGlobal(node.callee, 'Date')) {
          context.report({ node, messageId: 'newDate' });
        }
      },
      CallExpression(node) {
        if (isGlobal(node.callee, 'Date')) {
          context.report({ node, messageId: 'dateCall' });
        }
      },
      MemberExpression(node) {
        const name = propertyName(node);
        if (name === 'now' && isGlobal(node.object, 'Date')) {
          context.report({ node, messageId: 'dateNow' });
        } else if (name === 'parse' && isGlobal(node.object, 'Date')) {
          context.report({ node, messageId: 'dateParse' });
        } else if (
          name === 'random' &&
          !randomAllowed &&
          isGlobal(node.object, 'Math')
        ) {
          context.report({ node, messageId: 'mathRandom' });
        } else if (
          (name === 'randomUUID' || name === 'getRandomValues') &&
          isGlobal(node.object, 'crypto')
        ) {
          context.report({ node, messageId: 'cryptoRandom', data: { name } });
        }
      },
      TSTypeReference(node) {
        if (isGlobal(node.typeName, 'Date')) {
          context.report({ node, messageId: 'dateType' });
        }
      },
    };
  },
};
