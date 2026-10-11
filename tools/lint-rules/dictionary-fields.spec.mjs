import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * L8 (flatten-spec §7, N15, Law 1): a dictionary's own field is
 * `camelCase(Dictionary)` — `bookingStatus: BookingStatus`,
 * `clientQueryShape: ClientQueryShape`. Not a selector: an AST selector
 * cannot relate a property name to the NAME of its type's dictionary across
 * files, so each group's `libs/ecs-core/src/components/<group>-dictionaries
 * .type-spec.ts` states one pair line per discriminator and plain tag field
 *
 *   Expect<Equal<Appointment['bookingStatus'], BookingStatus>>, // …
 *
 * and this spec asserts `field === lowerFirst(Dictionary)` for each, unless
 * the line ends with `// N15-exempt: <reason>` (the exemptions N15 lists:
 * role- or slice-prefixed references, `StreakRule`'s option fields).
 * `Equal` and `Equals` are both read. Run by the same target as
 * ecs-syntax.spec.mjs (`nx run lint-rules:test`).
 */

const COMPONENTS = fileURLToPath(
  new URL('../../libs/ecs-core/src/components/', import.meta.url),
);

/** One `Expect<Equal<Owner['field'], Dictionary>>` line, possibly wrapped by prettier. */
const PAIR =
  /Expect<\s*Equals?<\s*([\w.]+)\['(\w+)'\]\s*,\s*([\w.]+)\s*>\s*>\s*,?[ \t]*(\/\/[^\n]*)?/g;

const EXEMPT = /\/\/\s*N15-exempt:\s*\S/;

/** Every pair line of a type-spec source, with its exemption flag. */
export function dictionaryPairs(source) {
  const pairs = [];
  for (const match of source.matchAll(PAIR)) {
    const [, owner, field, dictionary, comment = ''] = match;
    pairs.push({ owner, field, dictionary, exempt: EXEMPT.test(comment) });
  }
  return pairs;
}

const lowerFirst = (name) => name.charAt(0).toLowerCase() + name.slice(1);

/** The pairs that break N15: field ≠ lowerFirst(Dictionary) and not exempt. */
export function n15Violations(pairs) {
  return pairs.filter(
    (pair) => !pair.exempt && pair.field !== lowerFirst(pair.dictionary),
  );
}

function groupTypeSpecs() {
  return readdirSync(COMPONENTS)
    .filter((name) => name.endsWith('-dictionaries.type-spec.ts'))
    .sort();
}

describe('L8 — dictionary fields are camelCase(Dictionary) (N15)', () => {
  it('reads pair lines, wrapped or not, and their exemptions', () => {
    const pairs = dictionaryPairs(
      [
        "  Expect<Equal<Appointment['bookingStatus'], BookingStatus>>, // appointment",
        '  Expect<',
        "    Equals<ClientQuery['clientQueryShape'], ClientQueryShape>",
        '  >, // client-query.system.ts',
        "  Expect<Equal<Seat['outcomeFrom'], AttendanceState>>, // N15-exempt: a typed reference in another role",
        "  Expect<Equal<Seat['kind'], SeatKind>>, // forgot the rule",
      ].join('\n'),
    );
    expect(pairs).toEqual([
      {
        owner: 'Appointment',
        field: 'bookingStatus',
        dictionary: 'BookingStatus',
        exempt: false,
      },
      {
        owner: 'ClientQuery',
        field: 'clientQueryShape',
        dictionary: 'ClientQueryShape',
        exempt: false,
      },
      {
        owner: 'Seat',
        field: 'outcomeFrom',
        dictionary: 'AttendanceState',
        exempt: true,
      },
      { owner: 'Seat', field: 'kind', dictionary: 'SeatKind', exempt: false },
    ]);
    // Valid: the named field and the exempt reference pass; invalid: `kind`.
    expect(n15Violations(pairs)).toEqual([pairs[3]]);
  });

  it('an exemption needs a reason', () => {
    const [pair] = dictionaryPairs(
      "Expect<Equal<Seat['outcomeFrom'], AttendanceState>>, // N15-exempt:",
    );
    expect(pair.exempt).toBe(false);
  });

  it('holds for every group dictionary type-spec in libs/ecs-core', () => {
    // Staged: the seven `<group>-dictionaries.type-spec.ts` files appear as
    // the groups split `dictionaries.type-spec.ts` (flatten-spec §8.1); an
    // absent file is not a failure, a pair that breaks N15 is.
    for (const name of groupTypeSpecs()) {
      const source = readFileSync(`${COMPONENTS}${name}`, 'utf8');
      expect(n15Violations(dictionaryPairs(source)), name).toEqual([]);
    }
  });
});
