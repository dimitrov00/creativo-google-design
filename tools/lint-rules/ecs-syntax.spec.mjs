import { ESLint } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import {
  ICON_SPEC_SYNTAX_RESTRICTIONS,
  ICON_SYNTAX_RESTRICTIONS,
} from './icon-syntax.mjs';
import {
  ECS_ADAPTER_RESTRICTIONS,
  ECS_ALL_SUFFIXES,
  ECS_DATA_RESTRICTIONS,
  ECS_ENTITY_RESTRICTIONS,
  ECS_INTL_RESTRICTION,
  ECS_PIPELINE_RESTRICTIONS,
  ECS_PORT_RESTRICTIONS,
  ECS_ROOT_SUFFIXES,
  ECS_SYSTEM_GLOBALS,
  ECS_SYSTEM_RESTRICTIONS,
  ECS_TOKEN_RESTRICTIONS,
  ECS_ZONED_TIME_RESTRICTIONS,
  ecsProjectBlocks,
  ecsSyntaxBlocks,
} from './ecs-syntax.mjs';

/**
 * Lints TypeScript source with exactly the given `no-restricted-syntax`
 * list (and, optionally, `no-restricted-globals`) — the rules the suffix
 * blocks install, nothing else.
 */
async function lint(code, restrictions, globals = null) {
  const rules = { 'no-restricted-syntax': ['error', ...restrictions] };
  if (globals) rules['no-restricted-globals'] = ['error', ...globals];
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        languageOptions: { parser: tsParser },
        rules,
      },
    ],
  });
  const [result] = await eslint.lintText(code, {
    filePath: 'libs/ecs-core/src/x.ts',
  });
  const fatal = result.messages.filter((message) => message.fatal);
  if (fatal.length > 0) throw new Error(fatal[0].message);
  return result.messages.map((message) => message.message);
}

/**
 * One offending snippet (or several) per selector. The meta-test below
 * fails if any selector in any array lacks a case here, so a new selector
 * cannot land untested.
 */
const CASES = {
  // purity guard
  'NewExpression[callee.name="Date"]': ['const t = new Date();'],
  'CallExpression[callee.object.name="Date"][callee.property.name="now"]': [
    'const t = Date.now();',
  ],
  'MemberExpression[object.name="Math"][property.name="random"]': [
    'const r = Math.random();',
  ],
  'MemberExpression[object.name="crypto"]': ['const id = crypto.randomUUID();'],
  'ImportDeclaration[source.value=/^(node:)?crypto$/]': [
    `import { createHash } from 'node:crypto';`,
    `import { createHash } from 'crypto';`,
  ],
  AwaitExpression: ['async function f(p: Promise<number>) { return await p; }'],
  'ImportDeclaration[source.value=/^(firebase|firebase-admin|@angular|rxjs|@sentry|pino)/]':
    [
      `import { getFirestore } from 'firebase/firestore';`,
      `import { getFirestore } from 'firebase-admin/firestore';`,
      `import { Injectable } from '@angular/core';`,
      `import { Observable } from 'rxjs';`,
      `import * as Sentry from '@sentry/node';`,
      `import pino from 'pino';`,
    ],
  [String.raw`ImportDeclaration[source.value=/\.(port|adapter|pipeline)$/]`]: [
    `import type { ReadTx } from '../ports/tx.port';`,
    `import { firestoreLoad } from './firestore.adapter';`,
    `import { bookAppointment } from './book-appointment.pipeline';`,
  ],
  [String.raw`ImportDeclaration[source.value=/(^|\/)ports\/(?!collections$)(?![^\/]*\.(port|adapter|pipeline)$)[^\/]+$/]`]:
    [
      `import { Callables } from '../ports/callables';`,
      `import { Collections } from '../ports/collections.extra';`,
    ],
  'MemberExpression[object.name="Intl"]': [
    `const f = Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Sofia' });`,
    `const f = new Intl.DateTimeFormat('en-US');`,
  ],
  // pipeline import guard
  'ImportDeclaration[source.value=/^(firebase-admin|@angular|pino|@sentry)/]': [
    `import { getFirestore } from 'firebase-admin/firestore';`,
    `import { inject } from '@angular/core';`,
    `import pino from 'pino';`,
    `import * as Sentry from '@sentry/node';`,
  ],
  // Object.freeze, everywhere in production code
  'CallExpression[callee.object.name="Object"][callee.property.name="freeze"]':
    ['const x = Object.freeze({ a: 1 });'],
  // optional-property guards
  'TSPropertySignature[optional=true]': [
    'type Q = { readonly blocks?: readonly number[] };',
  ],
  'TSPropertySignature TSUnionType > TSUndefinedKeyword': [
    'type Q = { readonly release: number | undefined };',
  ],
  'TSUnionType > TSUndefinedKeyword': [
    'type Q = { readonly release: number | undefined };',
    'export const Q = { of: (x: string | undefined) => x ?? null } as const;',
  ],
  // class guard
  ClassDeclaration: ['class Money { amount = 0; }'],
  ClassExpression: ['const Money = class { amount = 0; };'],
  // data naming and mapper words
  'TSTypeAliasDeclaration[id.name=/Component$/]': [
    'type TimeIntervalComponent = { readonly startMs: number };',
  ],
  'TSInterfaceDeclaration[id.name=/(Component|Document|Doc)$/]': [
    'interface AppointmentComponent { readonly id: string }',
    'interface AppointmentDocument { readonly id: string }',
    'interface AppointmentDoc { readonly id: string }',
  ],
  'Property[key.name=/^(reconstitute|toDocument|fromFirestore|toFirestore|assemble)$/]':
    [
      'export const A = { reconstitute: (d: unknown) => d } as const;',
      'export const A = { toDocument(a: unknown) { return a; } } as const;',
      'export const A = { fromFirestore: (d: unknown) => d } as const;',
      'export const A = { toFirestore: (d: unknown) => d } as const;',
      'export const A = { assemble: (d: unknown) => d } as const;',
    ],
  NewExpression: ['const seen = new Map<string, number>();'],
  ThisExpression: [
    'export const M = { a: 1, twice() { return this.a * 2; } };',
  ],
  'Property[kind="get"]': ['export const M = { get total() { return 1; } };'],
  'Property[kind="set"]': [
    'export const M = { set total(v: number) { void v; } };',
  ],
  MethodDefinition: ['const M = class { total() { return 1; } };'],
  // token guard
  'NewExpression[callee.name="InjectionToken"]': [
    `const T = new InjectionToken<string>('x');`,
  ],
};

const ARRAYS = {
  ECS_SYSTEM_RESTRICTIONS,
  ECS_ZONED_TIME_RESTRICTIONS,
  ECS_DATA_RESTRICTIONS,
  ECS_ENTITY_RESTRICTIONS,
  ECS_PIPELINE_RESTRICTIONS,
  ECS_PORT_RESTRICTIONS,
  ECS_ADAPTER_RESTRICTIONS,
  ECS_TOKEN_RESTRICTIONS,
};

describe('ecs syntax restrictions — one case per selector', () => {
  const restrictions = new Map();
  for (const list of Object.values(ARRAYS)) {
    for (const restriction of list) {
      restrictions.set(
        `${restriction.selector} :: ${restriction.message}`,
        restriction,
      );
    }
  }

  it('every selector has a case', () => {
    const missing = [...restrictions.values()]
      .map((restriction) => restriction.selector)
      .filter((selector) => !(selector in CASES));
    expect(missing).toEqual([]);
  });

  for (const restriction of restrictions.values()) {
    it(`${restriction.selector} fires on its case`, async () => {
      for (const code of CASES[restriction.selector] ?? []) {
        expect(await lint(code, [restriction]), code).toEqual([
          restriction.message,
        ]);
      }
    });
  }

  it('every message names the law or rule it enforces', () => {
    for (const restriction of restrictions.values()) {
      expect(restriction.message, restriction.selector).toMatch(
        /Laws? \d|CLAUDE\.md|ecs-components\.md|ZonedTimeSystem|absent is `null`/,
      );
    }
  });
});

describe('systems (ECS_SYSTEM_RESTRICTIONS)', () => {
  const system = [...ICON_SYNTAX_RESTRICTIONS, ...ECS_SYSTEM_RESTRICTIONS];

  it('lets a pure linear-scan system through', async () => {
    expect(
      await lint(
        `
        import { TimeInterval } from '../components/time-interval.data';
        import type { WriteOp } from '../components/write-op.data';
        import { ZonedTimeSystem } from './zoned-time.system';

        export type Collision = { readonly candidateIndex: number; readonly busyIndex: number };
        export type Query = { readonly blocks: readonly TimeInterval[]; readonly release: number | null };

        export const IntervalCollisionSystem = {
          findCollisions(
            candidates: readonly TimeInterval[],
            busy: readonly TimeInterval[],
            limit?: number,
          ): readonly Collision[] {
            const out: Collision[] = [];
            const seen = new Map<number, number>();
            const sorted = [...busy].sort((a, b) => a.startMs - b.startMs);
            for (let i = 0; i < candidates.length; i++) {
              const c = candidates[i] as TimeInterval;
              for (let k = 0; k < sorted.length; k++) {
                if (TimeInterval.overlaps(c, sorted[k] as TimeInterval)) out.push({ candidateIndex: i, busyIndex: k });
              }
              seen.set(i, out.length);
            }
            return limit === undefined ? out : out.slice(0, limit);
          },
          plan(nowMs: number, nextId: () => string): readonly WriteOp[] {
            void ZonedTimeSystem; void nowMs; void nextId;
            return [];
          },
        } as const;
      `,
        system,
      ),
    ).toEqual([]);
  });

  it('lets the collection registry through — the one module of `ports/` a system may import', async () => {
    expect(
      await lint(
        `
        import { Collections, Subcollections } from '../ports/collections';
        export const S = { names: () => [Collections, Subcollections] } as const;
      `,
        system,
      ),
    ).toEqual([]);
  });

  it('blocks the clock, randomness, crypto, awaiting and every banned import together', async () => {
    const messages = await lint(
      `
      import { randomUUID } from 'node:crypto';
      import { getFirestore } from 'firebase-admin/firestore';
      import type { LoadAppointment } from '../ports/scheduling.port';
      export const S = {
        async run(load: LoadAppointment) {
          const now = Date.now();
          const d = new Date(now);
          const r = Math.random();
          const id = crypto.randomUUID();
          const f = Intl.DateTimeFormat('en-US');
          await load('a' as never);
          return Object.freeze({ now, d, r, id, f, randomUUID, getFirestore });
        },
      } as const;
    `,
      system,
    );
    // Three imports (crypto, SDK, port), then Date.now, new Date,
    // Math.random, crypto.*, Intl.*, await and Object.freeze.
    expect(messages).toHaveLength(10);
  });

  it('bans the ambient I/O globals', async () => {
    const messages = await lint(
      `
      export const S = {
        run(): void {
          void fetch('/x');
          console.log('x');
          setTimeout(() => undefined, 1);
          void crypto;
        },
      } as const;
    `,
      [],
      ECS_SYSTEM_GLOBALS,
    );
    expect(messages).toHaveLength(4);
  });

  it('keeps an optional FUNCTION PARAMETER legal but not an optional or `| undefined` property', async () => {
    expect(
      await lint(
        'export const S = { f(limit?: number, x: number | undefined = 1) { return [limit, x]; } } as const;',
        system,
      ),
    ).toEqual([]);
    expect(
      await lint(
        'export type Q = { readonly termsByBarber?: number };',
        system,
      ),
    ).toHaveLength(1);
    expect(
      await lint(
        'export type Q = { readonly blocks: readonly number[] | undefined };',
        system,
      ),
    ).toHaveLength(1);
  });

  it('allows Intl only through the zoned-time list, which keeps every other guard', async () => {
    const zoned = [...ICON_SYNTAX_RESTRICTIONS, ...ECS_ZONED_TIME_RESTRICTIONS];
    const intl = `
      const FORMATTERS = new Map<string, Intl.DateTimeFormat>();
      export const ZonedTimeSystem = {
        formatter(zone: string): Intl.DateTimeFormat {
          const cached = FORMATTERS.get(zone);
          if (cached) return cached;
          const created = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23' });
          FORMATTERS.set(zone, created);
          return created;
        },
      } as const;
    `;
    expect(await lint(intl, zoned)).toEqual([]);
    expect(await lint(intl, system)).toEqual([ECS_INTL_RESTRICTION.message]);
    expect(ECS_ZONED_TIME_RESTRICTIONS).not.toContain(ECS_INTL_RESTRICTION);
    expect(ECS_ZONED_TIME_RESTRICTIONS).toHaveLength(
      ECS_SYSTEM_RESTRICTIONS.length - 1,
    );
    expect(await lint('const t = Date.now();', zoned)).toHaveLength(1);
  });

  it('does not cage a package by selector (that is no-restricted-imports, with per-file exemptions)', async () => {
    expect(
      await lint(
        `import { parsePhoneNumberFromString } from 'libphonenumber-js/min';`,
        system,
      ),
    ).toEqual([]);
    for (const restriction of ECS_SYSTEM_RESTRICTIONS) {
      expect(restriction.selector).not.toMatch(/luxon|dinero|libphonenumber/);
    }
  });
});

describe('components and entities (ECS_DATA_RESTRICTIONS, ECS_ENTITY_RESTRICTIONS)', () => {
  const data = [...ICON_SYNTAX_RESTRICTIONS, ...ECS_DATA_RESTRICTIONS];
  const entity = [...ICON_SYNTAX_RESTRICTIONS, ...ECS_ENTITY_RESTRICTIONS];

  it('lets the ecs-components.md variant template through', async () => {
    expect(
      await lint(
        `
        export const BookingState = {
          Pending: 'pending',
          Confirmed: 'confirmed',
        } as const;
        export type BookingState = (typeof BookingState)[keyof typeof BookingState];
        export type BookingStatus = BookingStatus.Pending | BookingStatus.Confirmed;
        export const BookingStatus = {
          pending(atMs: number): BookingStatus.Pending {
            return { kind: BookingState.Pending, atMs };
          },
          confirm(s: BookingStatus.Pending, atMs: number): BookingStatus.Confirmed {
            return { kind: BookingState.Confirmed, atMs, pendingSinceMs: s.atMs };
          },
          isTerminal: (s: BookingStatus): boolean => s.kind === BookingState.Confirmed,
        } as const;
        export namespace BookingStatus {
          export type Pending = { readonly kind: typeof BookingState.Pending; readonly atMs: number };
          export type Confirmed = {
            readonly kind: typeof BookingState.Confirmed;
            readonly atMs: number;
            readonly pendingSinceMs: number;
            readonly note: string | null;
          };
        }
      `,
        data,
      ),
    ).toEqual([]);
  });

  it('lets the ecs-components.md entity template through', async () => {
    expect(
      await lint(
        `
        import type { TimeInterval } from '../components/time-interval.data';
        export type AppointmentId = string & { readonly __brand: unique symbol };
        export const AppointmentId = {
          of: (raw: string): AppointmentId => raw as AppointmentId,
        } as const;
        export type AppointmentEntity = {
          readonly id: AppointmentId;
          readonly timeInterval: TimeInterval;
          readonly arrivedAtMs: number | null;
        };
      `,
        entity,
      ),
    ).toEqual([]);
  });

  it('blocks every Law 1 violation in one companion', async () => {
    const messages = await lint(
      `
      export type MoneyComponent = { readonly amount?: number; readonly currency: string | undefined };
      export const Money = {
        amount: 0,
        get total() { return this.amount; },
        set total(v: number) { void v; },
        toDocument: (m: unknown) => m,
        cache: new Map<string, number>(),
        frozen: Object.freeze({}),
      };
    `,
      data,
    );
    // Component name, `?:`, `| undefined`, getter, `this`, setter,
    // mapper word, `new`, `Object.freeze`.
    expect(messages).toHaveLength(9);
  });

  it('the entity list is the data list (one shape guard, two suffixes)', () => {
    expect(ECS_ENTITY_RESTRICTIONS).toEqual(ECS_DATA_RESTRICTIONS);
  });
});

describe('pipelines, ports and adapters', () => {
  it('a pipeline may not import an SDK but may read the clock through its ports', async () => {
    const pipeline = [
      ...ICON_SYNTAX_RESTRICTIONS,
      ...ECS_PIPELINE_RESTRICTIONS,
    ];
    expect(
      await lint(
        `
        import type { BookingPorts } from './booking.port';
        export const book = (ports: BookingPorts) => async (id: string) => {
          const nowMs = ports.nowMs();
          return await ports.load(id, nowMs);
        };
      `,
        pipeline,
      ),
    ).toEqual([]);
    expect(
      await lint(
        `import { getFirestore } from 'firebase-admin/firestore';`,
        pipeline,
      ),
    ).toHaveLength(1);
  });

  it('a port is a function type: optional parameters yes, optional properties and classes no', async () => {
    const port = [...ICON_SYNTAX_RESTRICTIONS, ...ECS_PORT_RESTRICTIONS];
    expect(
      await lint(
        `
        export type Log = (level: 'info' | 'warn' | 'error', msg: string, fields?: Record<string, unknown>) => void;
        export type Ports = { readonly log: Log; readonly nowMs: () => number };
      `,
        port,
      ),
    ).toEqual([]);
    expect(
      await lint('export type Cmd = { readonly note?: string };', port),
    ).toHaveLength(1);
    expect(await lint('export abstract class Gateway {}', port)).toHaveLength(
      1,
    );
  });

  it('an adapter is a function returning the port, never a class', async () => {
    const adapter = [...ICON_SYNTAX_RESTRICTIONS, ...ECS_ADAPTER_RESTRICTIONS];
    expect(
      await lint(
        'export const load = (db: { get(): Promise<unknown> }) => async () => db.get();',
        adapter,
      ),
    ).toEqual([]);
    expect(
      await lint('export class FirestoreAppointmentAdapter {}', adapter),
    ).toHaveLength(1);
  });
});

describe('ecsSyntaxBlocks', () => {
  it('builds one block per suffix, restating the icon list before the suffix list and the extras', () => {
    const blocks = ecsSyntaxBlocks(ECS_ALL_SUFFIXES, {
      extra: ECS_TOKEN_RESTRICTIONS,
    });
    expect(blocks.map((block) => block.files)).toEqual(
      ECS_ALL_SUFFIXES.map((suffix) => [`**/*.${suffix}.ts`]),
    );
    const [system] = blocks;
    expect(system.rules['no-restricted-syntax']).toEqual([
      'error',
      ...ICON_SYNTAX_RESTRICTIONS,
      ...ECS_SYSTEM_RESTRICTIONS,
      ...ECS_TOKEN_RESTRICTIONS,
    ]);
  });

  it('adds the per-suffix rule switches, and only where they belong', () => {
    const bySuffix = Object.fromEntries(
      ECS_ALL_SUFFIXES.map((suffix) => [
        suffix,
        ecsSyntaxBlocks([suffix])[0].rules,
      ]),
    );
    expect(bySuffix.system['no-restricted-globals']).toEqual([
      'error',
      ...ECS_SYSTEM_GLOBALS,
    ]);
    expect(bySuffix.system['security/detect-object-injection']).toBe('off');
    expect(bySuffix.data['security/detect-object-injection']).toBe('off');
    expect(bySuffix.data['@typescript-eslint/no-namespace']).toBe('off');
    expect(bySuffix.entity['@typescript-eslint/no-namespace']).toBe('off');
    expect(bySuffix.port['@typescript-eslint/consistent-type-imports']).toEqual(
      ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
    );
    for (const suffix of ['entity', 'pipeline', 'port', 'adapter']) {
      expect(bySuffix[suffix]['security/detect-object-injection']).toBe(
        undefined,
      );
      expect(bySuffix[suffix]['no-restricted-globals']).toBe(undefined);
    }
    expect(bySuffix.pipeline['@typescript-eslint/no-namespace']).toBe(
      undefined,
    );
  });

  it('keeps the icon guard alive inside a suffix block', async () => {
    const [system] = ecsSyntaxBlocks(['system']);
    const [, ...restrictions] = system.rules['no-restricted-syntax'];
    expect(
      await lint(`const k = ('a.' + v) as UiIconName;`, restrictions),
    ).toHaveLength(1);
  });

  it('the root suffixes are the four no legacy file carries', () => {
    expect(ECS_ROOT_SUFFIXES).toEqual(['system', 'data', 'entity', 'pipeline']);
    expect(() => ecsSyntaxBlocks(['ports'])).toThrow(/Unknown ECS suffix/);
  });
});

describe('ecsProjectBlocks (libs/ecs-core, apps/functions)', () => {
  it('puts the token guard on every file, specs keep their cast allowance, then all six suffixes', () => {
    const [ts, spec, ...suffixes] = ecsProjectBlocks();
    expect(ts.files).toEqual(['**/*.ts']);
    expect(ts.rules['no-restricted-syntax']).toEqual([
      'error',
      ...ICON_SYNTAX_RESTRICTIONS,
      ...ECS_TOKEN_RESTRICTIONS,
    ]);
    expect(spec.files).toEqual(['**/*.spec.ts']);
    expect(spec.rules['no-restricted-syntax']).toEqual([
      'error',
      ...ICON_SPEC_SYNTAX_RESTRICTIONS,
      ...ECS_TOKEN_RESTRICTIONS,
    ]);
    expect(suffixes).toEqual(
      ecsSyntaxBlocks(ECS_ALL_SUFFIXES, { extra: ECS_TOKEN_RESTRICTIONS }),
    );
  });

  it('the token guard fires through the every-file block', async () => {
    const [ts] = ecsProjectBlocks();
    const [, ...restrictions] = ts.rules['no-restricted-syntax'];
    expect(
      await lint(
        `export const LOG = new InjectionToken<string>('log');`,
        restrictions,
      ),
    ).toEqual([ECS_TOKEN_RESTRICTIONS[0].message]);
  });
});
