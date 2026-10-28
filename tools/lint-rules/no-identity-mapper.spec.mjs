import { fileURLToPath } from 'node:url';
import { ESLint, Linter, RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { noIdentityMapper } from './no-identity-mapper.mjs';

/**
 * `creativo/no-identity-mapper` (Law 5 zero-mapper, Law 3 zero inbound
 * mapping) — the unit cases through RuleTester; then the justified disable
 * a KEEP-DOMAIN-ALIAS carries, through a flat `Linter` that registers the
 * rule under its real id (honoured, and used); then the root config's
 * registration (production `.ts` reported, specs and test support not).
 */

const tester = new RuleTester({
  languageOptions: { parser: tsParser },
});

const copy = (name) => ({ messageId: 'identityCopy', data: { name } });
const forward = (name, callee) => ({
  messageId: 'forwarder',
  data: { name, callee },
});
const localized = (source) => ({
  messageId: 'localizedCopy',
  data: { source },
});

tester.run('creativo/no-identity-mapper', noIdentityMapper, {
  valid: [
    // 1. The types differ: a real projection of a richer type.
    'export function contactOf(c: Client): Contact { return { firstName: c.firstName, phone: c.phone }; }',
    // 2. A generic projection declares the wider value it cuts from.
    'export const S = { of<T extends Rule>(r: T): Rule { return { version: r.version, enabled: r.enabled }; } } as const;',
    // 3. A transformation: one field derived.
    'function moved(s: Season): Season { return { ...s, windowFrom: addDays(s.windowFrom, 1) }; }',
    // 4. Fields swapped.
    'function swap(a: A): A { return { x: a.y, y: a.x }; }',
    // 5. The spread of a call (a documented limit).
    'function f(s: S): S { return { a: s.a, ...slotOf(s) }; }',
    // 6. Law 5's entity read: the id beside the document.
    'const entityOf = ({ id, doc }) => ({ id, ...doc });',
    // 7. Two sources.
    'function m(a: A, b: A): A { return { x: a.x, y: b.y }; }',
    // 8. Another statement before the return.
    'function f(a: A): A { audit(a); return { x: a.x }; }',
    // 9. A public class member is a template bridge.
    "import { labelOf } from 'x'; class C { label(x: X) { return labelOf(x); } }",
    // 10. A curried factory.
    "import { run } from 'x'; export const book = (ports: P) => async (cmd: C) => run(ports, cmd);",
    // 11. A default parameter is partial application.
    "import { Z } from 'z'; export function shopMidnightOf(d: D, tz = ZONE) { return Z.startOfLocalDay(d, tz); }",
    // 12. A local receiver built by a regex keeps its `this`.
    'const TEST_FILE = /x/; export function isTestFile(p: string) { return TEST_FILE.test(p); }',
    // 13. A typed port implementation.
    "import { observeDoc } from 'x'; export const observeBusyDay: ObserveBusyDay = (k) => observeDoc(k);",
    // 14. A transformed argument.
    "import { R, Id } from 'x'; export const src = (id: string) => R.redemption(Id.of(id));",
    // 15. Reordered arguments.
    "import { f } from 'x'; export const g = (a: A, b: B) => f(b, a);",
    // 16. A bound constant.
    "import { f } from 'x'; export const g = (a: A) => f(a, 1);",
    // 17. A cast.
    "import { f } from 'x'; export const g = (x: X) => f(x) as Y;",
    // 18. Explicit type arguments bind a type.
    "import { of } from 'rxjs'; function settled(u: string) { return of<string | null>(u); }",
    // 19. An inline callback.
    "import { f } from 'x'; export const ys = xs.map((x) => f(x));",
    // 20. A global callee.
    'export const keysOf = (o: object) => Object.keys(o);',
    // 21. A local alias nested inside a function (a documented limit).
    "import { t } from 'x'; export function outer(p: P) { const tr = (k: string) => t(k); return tr(p.k); }",
    // 22. An object built inside a factory (a documented limit).
    'export const ports = (g: G) => ({ load: (c: C) => g.load(c) });',
    // 23. Two sources / three keys are not a `LocalizedText` copy.
    'content.text({ en: a.en, bg: b.bg }); content.text({ en: t.en, bg: t.bg, ru: t.ru });',
    // 24. A `this` receiver.
    'class S { private money(m: Money) { return this.words.price(m); } }',
    // 25. A receiver built by `new`.
    "const collator = new Intl.Collator('bg'); export function compare(a: string, b: string) { return collator.compare(a, b); }",
    // A different call shape: optional, a call result as receiver, a parameter receiver.
    "import { f } from 'x'; export const g = (x: X) => f?.(x);",
    "import { f } from 'x'; export const g = (x: X) => f().h(x);",
    'export const g = (o: O, x: X) => o.h(x);',
    // A rest parameter forwarded as a list is not the same call.
    "import { g } from 'x'; export const f = (...args: A[]) => g(args);",
    // A projection with a destructuring of a different name.
    'function f(a: A): A { const { x } = b; return { x }; }',
    // A shorthand that is not bound from the parameter.
    'const y = 1; function f(a: A): A { return { y }; }',
    // A copy with no declared types and more than a bare clone (nothing proves the type is unchanged).
    'const pick = (a) => ({ x: a.x, y: a.y });',
  ],
  invalid: [
    // 1. The owner's case.
    {
      code: 'export function encodeExportClientDataAnswer(answer: ClientPrivacyCall.Exported): ClientPrivacyCall.Exported { return { clientExportVersion: answer.clientExportVersion, exportJson: answer.exportJson }; }',
      errors: [copy('encodeExportClientDataAnswer')],
    },
    // 2. A seed body builder behind `satisfies`.
    {
      code: "export function tierDefinitionBody(stored: Body<TierDefinition>): Body<TierDefinition> { return { name: stored.name, rank: stored.rank } satisfies Omit<TierDefinition, 'id'>; }",
      errors: [copy('tierDefinitionBody')],
    },
    // 3. An arrow.
    {
      code: 'const copy = (a: A): A => ({ x: a.x, y: a.y });',
      errors: [copy('copy')],
    },
    // 4–5. A bare clone, typed or not.
    {
      code: 'const clone = (a: A): A => ({ ...a });',
      errors: [copy('clone')],
    },
    {
      code: 'const clone = (a) => ({ ...a });',
      errors: [copy('clone')],
    },
    // 6. A destructured parameter.
    {
      code: 'const f = ({ x, y }: A): A => ({ x, y });',
      errors: [copy('f')],
    },
    // 7. A destructuring of the parameter, then the copy.
    {
      code: 'function f(a: A): A { const { x, y } = a; return { x, y }; }',
      errors: [copy('f')],
    },
    // 8. Whitespace in the type text does not matter.
    {
      code: 'function f(a: Readonly<A>): Readonly< A > { return { ...a }; }',
      errors: [copy('f')],
    },
    // 9. A companion member.
    {
      code: 'export const X = { of(a: A): A { return { x: a.x }; } } as const;',
      errors: [copy('of')],
    },
    // 10. A spread plus a field copied over itself.
    {
      code: 'const f = (a: A): A => ({ ...a, x: a.x });',
      errors: [copy('f')],
    },
    // `as const` around the copy.
    {
      code: 'const f = (a: A): A => ({ x: a.x }) as const;',
      errors: [copy('f')],
    },
    // A private class member.
    {
      code: 'class C { private copy(a: A): A { return { x: a.x }; } }',
      errors: [copy('copy')],
    },
    // 11. `LocalizedText` copied field by field, either order.
    {
      code: 'this.content.text({ en: shop.name.en, bg: shop.name.bg });',
      errors: [localized('shop.name')],
    },
    {
      code: 'const t = ({ bg: x.bg, en: x.en });',
      errors: [localized('x')],
    },
    // One report for a `LocalizedText` identity function, not two.
    {
      code: 'const keep = (t: LocalizedText): LocalizedText => ({ en: t.en, bg: t.bg });',
      errors: [copy('keep')],
    },
    // 12–13. Seed forwarders.
    {
      code: "import { StreakDefinitionVersionId } from '@core/primitives'; export const ruleVersionIdOf = (version: number) => StreakDefinitionVersionId.forVersion(version);",
      errors: [
        forward('ruleVersionIdOf', 'StreakDefinitionVersionId.forVersion'),
      ],
    },
    {
      code: "import { JournalEntryId } from '@core/primitives'; export const journalRowIdOf = (c: CustomerId, seq: number) => JournalEntryId.forEntry(c, seq);",
      errors: [forward('journalRowIdOf', 'JournalEntryId.forEntry')],
    },
    // 14. A per-callable refusal mapper.
    {
      code: "import { refusalOf } from './wire-read'; export function commitBookingRefusal(e: BookingError): EdgeError { return refusalOf(e); }",
      errors: [forward('commitBookingRefusal', 'refusalOf')],
    },
    // 15. A per-callable decoder.
    {
      code: "import { decodeShared } from './wire'; export function decodeA(r: WireRequest) { return decodeShared(r); }",
      errors: [forward('decodeA', 'decodeShared')],
    },
    // 16. A companion member renaming another tier's function.
    {
      code: "import { MetricRef } from '@core/components'; export const BadgeSystem = { isCalendarDriven(s: S) { return MetricRef.isCalendarDriven(s); } } as const;",
      errors: [
        forward('BadgeSystem.isCalendarDriven', 'MetricRef.isCalendarDriven'),
      ],
    },
    // 17. A rest parameter forwarded as a spread.
    {
      code: "import { g } from 'x'; export const f = (...args: A[]) => g(...args);",
      errors: [forward('f', 'g')],
    },
    // 18. An awaited forward.
    {
      code: "import { g } from 'x'; export async function f(a: A) { return await g(a); }",
      errors: [forward('f', 'g')],
    },
    // 19. One function, two names.
    {
      code: 'function voidedIds(x: X) { return [x]; } export const LedgerSystem = { voided(x: X) { return voidedIds(x); } } as const;',
      errors: [forward('LedgerSystem.voided', 'voidedIds')],
    },
    // 20. The same companion.
    {
      code: 'export const S = { a(x: X) { return 1; }, b(x: X) { return S.a(x); } } as const;',
      errors: [forward('S.b', 'S.a')],
    },
    // 21. A type and a value share the name.
    {
      code: 'export type MinuteOfDay = number; export const MinuteOfDay = { of(n: number) { return n; } } as const; export const TrackMinute = { toStart(t: number) { return MinuteOfDay.of(t); } } as const;',
      errors: [forward('TrackMinute.toStart', 'MinuteOfDay.of')],
    },
    // 22. Zero arguments.
    {
      code: "import { AuthFlowState } from '@core/components'; export const AuthFlowSystem = { initial() { return AuthFlowState.initial(); } } as const;",
      errors: [forward('AuthFlowSystem.initial', 'AuthFlowState.initial')],
    },
    // 23. Private class members, both spellings.
    {
      code: "import { IntervalSetSystem } from '@core/systems'; class C { private hull(s: S) { return IntervalSetSystem.hull(s); } #h(s: S) { return IntervalSetSystem.hull(s); } }",
      errors: [
        forward('hull', 'IntervalSetSystem.hull'),
        forward('#h', 'IntervalSetSystem.hull'),
      ],
    },
    // 24. Module-level, not exported.
    {
      code: "import { LocalDate } from '@core/primitives'; const dayOf = (n: number) => LocalDate.fromEpochDay(n);",
      errors: [forward('dayOf', 'LocalDate.fromEpochDay')],
    },
    // A companion behind `satisfies`, a function-valued property, a function-valued module const.
    {
      code: "import { g } from 'x'; export const C = { f: (a: A) => g(a) } satisfies Companion;",
      errors: [forward('C.f', 'g')],
    },
    {
      code: 'const h = function (a: A) { return a; }; export function f(a: A) { return h(a); }',
      errors: [forward('f', 'h')],
    },
    // A private arrow property.
    {
      code: "import { g } from 'x'; class C { private readonly f = (a: A) => g(a); }",
      errors: [forward('f', 'g')],
    },
  ],
});

const RULE_ID = 'creativo/no-identity-mapper';

/** The rule under its real id, as the root config registers it. */
const FLAT = [
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tsParser },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: {
      creativo: { rules: { 'no-identity-mapper': noIdentityMapper } },
    },
    rules: { [RULE_ID]: 'error' },
  },
];

const DOMAIN_ALIAS = [
  "import { M } from 'x';",
  'export const S = {',
  '  // eslint-disable-next-line creativo/no-identity-mapper -- a move is judged by the cancel rule',
  '  mayMove(a: A) { return M.mayCancel(a); },',
  '} as const;',
].join('\n');

describe('a KEEP-DOMAIN-ALIAS keeps a justified disable', () => {
  const linter = new Linter({ configType: 'flat' });

  it('honours it, and the directive is used', () => {
    const messages = linter.verify(DOMAIN_ALIAS, FLAT, 'move.system.ts');
    expect(messages).toEqual([]);
  });

  it('reports the alias once the directive is gone, on its name line', () => {
    const messages = linter.verify(
      DOMAIN_ALIAS.replace(/^ *\/\/ eslint-disable-next-line.*\n/m, ''),
      FLAT,
      'move.system.ts',
    );
    expect(messages.map(({ ruleId, line }) => ({ ruleId, line }))).toEqual([
      { ruleId: RULE_ID, line: 3 },
    ]);
  });
});

describe('the root config registers the rule on production .ts only', () => {
  const WORKSPACE = fileURLToPath(new URL('../..', import.meta.url));
  const OWNER_CASE =
    'export function encodeExportClientDataAnswer(answer: Exported): Exported {\n  return { clientExportVersion: answer.clientExportVersion };\n}\n';

  async function hitsAt(filePath) {
    const eslint = new ESLint({ cwd: WORKSPACE });
    const [result] = await eslint.lintText(OWNER_CASE, { filePath });
    return (result?.messages ?? []).filter(
      (message) => message.ruleId === RULE_ID,
    );
  }

  it('reports the owner’s case in production code, as an error', async () => {
    const hits = await hitsAt(
      `${WORKSPACE}apps/functions/src/wire/probe.wire.ts`,
    );
    expect(hits.map(({ severity }) => severity)).toEqual([2]);
  }, 60_000);

  it('leaves specs and test support alone', async () => {
    expect(
      await hitsAt(`${WORKSPACE}apps/functions/src/wire/probe.wire.spec.ts`),
    ).toEqual([]);
    expect(
      await hitsAt(`${WORKSPACE}apps/functions/src/test-support/probe.ts`),
    ).toEqual([]);
  }, 60_000);
});
