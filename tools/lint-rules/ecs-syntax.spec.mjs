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
  ECS_DATE_RESTRICTIONS,
  ECS_ENTITY_RESTRICTIONS,
  ECS_GENERIC_DISCRIMINATOR_RESTRICTIONS,
  ECS_ID_CAST_RESTRICTIONS,
  ECS_INTL_RESTRICTION,
  ECS_NESTED_TYPE_RESTRICTIONS,
  ECS_PRIMITIVE_RESTRICTIONS,
  ECS_RAW_PRIMITIVE_RESTRICTIONS,
  ECS_THROW_RESTRICTION,
  ECS_PIPELINE_RESTRICTIONS,
  ECS_PORT_RESTRICTIONS,
  ECS_ROOT_SUFFIXES,
  ECS_SYSTEM_GLOBALS,
  ECS_SYSTEM_RESTRICTIONS,
  ECS_TOKEN_RESTRICTIONS,
  ECS_ZONED_TIME_RESTRICTIONS,
  ecsProjectBlocks,
  ecsRootEveryFileBlocks,
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
  [String.raw`ImportDeclaration[source.value=/(^|\/)(ports|pipelines)(\/(?!.*\.(port|adapter|pipeline)$).+)?$/]`]:
    [
      `import { Callables } from '../ports/callables';`,
      `import { Collections } from '../ports/collections';`,
      `import { Collections } from '../ports/collections.extra';`,
      `import type { LoadAppointment } from '@core/ports';`,
      `import { bookAppointment } from '@core/pipelines';`,
      `import { x } from '@core/ports/scheduling/x';`,
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
  // L1 — no generic discriminator (Law 6.2)
  'TSPropertySignature[key.name=/^(kind|type|status)$/]': [
    `type A = { readonly kind: 'confirmed' };`,
    `type A = { readonly status: string };`,
    `type A = { readonly type: 'x' };`,
  ],
  'Property[key.name=/^(kind|type|status)$/]': [
    `export const A = { confirm: () => ({ kind: 'confirmed' }) } as const;`,
  ],
  // L2 — no nested 1-to-1 struct (Law 6.1)
  'TSPropertySignature > TSTypeAnnotation > TSTypeLiteral': [
    'type A = { readonly timing: { readonly startMinutes: number } };',
  ],
  'TSPropertySignature > TSTypeAnnotation > TSUnionType > TSTypeLiteral': [
    'type A = { readonly geo: { readonly lat: number } | null };',
  ],
  // L3 — branded coordinates, money and ids (Law 7.4)
  [ECS_RAW_PRIMITIVE_RESTRICTIONS[0].selector]: [
    'type A = { readonly appointmentId: string };',
    'type A = { readonly barberIds: readonly string[] };',
    'type A = { readonly confirmedAtUtcMs: number };',
    'type A = { readonly startMinutes: number };',
    'type A = { readonly priceCents: number | null };',
    'type A = { readonly localDate: string };',
    'type A = { readonly timeZone: string };',
    'type A = { readonly seatKey: string };',
  ],
  // L4 — no Date (Law 7.1)
  "TSTypeReference[typeName.name='Date']": ['let at: Date | null = null;'],
  "NewExpression[callee.name='Date']": ['const t = new Date(0);'],
  "CallExpression[callee.name='Date']": ['const t = Date();'],
  "MemberExpression[object.name='Date']": [
    `const t = Date.parse('2026-10-07');`,
  ],
  // L5 — no throw (Law 7.5)
  ThrowStatement: [`function f(): never { throw new Error('x'); }`],
  // L7 — no cast to UserId / CustomerId (Law 7.4, D29)
  'TSAsExpression > TSTypeReference[typeName.name=/^(CustomerId|UserId)$/]': [
    `const u = raw as UserId;`,
    `const c = raw as unknown as CustomerId;`,
  ],
  'TSAsExpression > TSUnionType > TSTypeReference[typeName.name=/^(CustomerId|UserId)$/]':
    [`const c = raw as CustomerId | null;`],
  'TSAsExpression > TSArrayType > TSTypeReference[typeName.name=/^(CustomerId|UserId)$/]':
    [`const us = raws as UserId[];`],
  'TSAsExpression > TSTypeOperator > TSArrayType > TSTypeReference[typeName.name=/^(CustomerId|UserId)$/]':
    [`const us = raws as readonly UserId[];`],
  'TSTypeAssertion > TSTypeReference[typeName.name=/^(CustomerId|UserId)$/]': [
    `const u = <UserId>raw;`,
  ],
  'TSTypeAssertion > TSUnionType > TSTypeReference[typeName.name=/^(CustomerId|UserId)$/]':
    [`const u = <UserId | null>raw;`],
};

/**
 * One VALID snippet per flatten-pass selector (flatten-spec §7: every
 * selector lands with an invalid AND a valid case) — the shape the guard
 * steers to, which it must let through.
 */
const VALID_CASES = {
  'TSPropertySignature[key.name=/^(kind|type|status)$/]':
    "type A = { readonly bookingStatus: 'CONFIRMED' };",
  'Property[key.name=/^(kind|type|status)$/]':
    "export const A = { confirm: () => ({ bookingStatus: 'CONFIRMED' }) } as const;",
  'TSPropertySignature > TSTypeAnnotation > TSTypeLiteral':
    'type A = { readonly seats: readonly { readonly seatId: SeatId }[] };',
  'TSPropertySignature > TSTypeAnnotation > TSUnionType > TSTypeLiteral':
    'type A = { readonly latitude: Latitude | null };',
  [ECS_RAW_PRIMITIVE_RESTRICTIONS[0].selector]:
    'type A = { readonly appointmentId: AppointmentId; readonly startMinutes: MinuteOfDay; readonly nextId: () => string }; type SeatInput = { readonly barberId: string; readonly startMinutes: number };',
  "TSTypeReference[typeName.name='Date']": 'let at: UtcEpochMs | null = null;',
  "NewExpression[callee.name='Date']":
    'const seen = new Map<string, number>();',
  "CallExpression[callee.name='Date']": 'const t = nowUtcMs();',
  "MemberExpression[object.name='Date']":
    "const t = ZonedTimeSystem.parseOffsetIso('2026-10-07T09:00Z');",
  ThrowStatement: "function f(): never { return defect('exhausted switch'); }",
  // A companion `{ … } as const` whose members TAKE a `UserId` is no cast.
  'TSAsExpression > TSTypeReference[typeName.name=/^(CustomerId|UserId)$/]':
    'const u = UserId.of(raw); const b = raw as BarberId; export const A = { of(userId: UserId): UserId { return userId; } } as const;',
  'TSAsExpression > TSUnionType > TSTypeReference[typeName.name=/^(CustomerId|UserId)$/]':
    'export const A = { f(userId: UserId | null) { return userId; } } as const; const b = raw as BarberId | null;',
  'TSAsExpression > TSArrayType > TSTypeReference[typeName.name=/^(CustomerId|UserId)$/]':
    'const xs = raws as BarberId[]; const ys = [UserId.of(raw)] as const;',
  'TSAsExpression > TSTypeOperator > TSArrayType > TSTypeReference[typeName.name=/^(CustomerId|UserId)$/]':
    'const xs = raws as readonly BarberId[];',
  'TSTypeAssertion > TSTypeReference[typeName.name=/^(CustomerId|UserId)$/]':
    'const c = CustomerId.forUser(u, hash);',
  'TSTypeAssertion > TSUnionType > TSTypeReference[typeName.name=/^(CustomerId|UserId)$/]':
    'const b = <BarberId | null>raw;',
};

const ARRAYS = {
  ECS_PRIMITIVE_RESTRICTIONS,
  ECS_GENERIC_DISCRIMINATOR_RESTRICTIONS,
  ECS_NESTED_TYPE_RESTRICTIONS,
  ECS_RAW_PRIMITIVE_RESTRICTIONS,
  ECS_DATE_RESTRICTIONS,
  ECS_THROW: [ECS_THROW_RESTRICTION],
  ECS_ID_CAST_RESTRICTIONS,
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

  it('every flatten-pass selector has a valid case it lets through', async () => {
    const flat = [
      ...ECS_GENERIC_DISCRIMINATOR_RESTRICTIONS,
      ...ECS_NESTED_TYPE_RESTRICTIONS,
      ...ECS_RAW_PRIMITIVE_RESTRICTIONS,
      ...ECS_DATE_RESTRICTIONS,
      ECS_THROW_RESTRICTION,
      ...ECS_ID_CAST_RESTRICTIONS,
    ];
    for (const restriction of flat) {
      const code = VALID_CASES[restriction.selector];
      expect(code, restriction.selector).toBeDefined();
      expect(await lint(code, [restriction]), code).toEqual([]);
    }
  });

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

  it('reaches the collection registry through `@core/entities` — never through the ports tier (Law 8.2)', async () => {
    expect(
      await lint(
        `
        import { Collections, Subcollections } from '@core/entities';
        export const S = { names: () => [Collections, Subcollections] } as const;
      `,
        system,
      ),
    ).toEqual([]);
    expect(
      await lint(
        `
        import { Collections, Subcollections } from '../ports/collections';
        export const S = { names: () => [Collections, Subcollections] } as const;
      `,
        system,
      ),
    ).toHaveLength(1);
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
    // Math.random, crypto.*, Intl.*, await and Object.freeze — and the
    // flatten pass's L4 a second time on `Date.now` and `new Date`.
    expect(messages).toHaveLength(12);
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
    // The clock guard and L4 (no `Date` in the core) both hold here.
    expect(await lint('const t = Date.now();', zoned)).toHaveLength(2);
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
        export const BookingStatus = {
          Confirmed: 'CONFIRMED',
          Cancelled: 'CANCELLED',
        } as const;
        export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];
        export type BookingLifecycle = BookingLifecycle.Confirmed | BookingLifecycle.Cancelled;
        export const BookingLifecycle = {
          confirm(atUtcMs: UtcEpochMs): BookingLifecycle.Confirmed {
            return { bookingStatus: BookingStatus.Confirmed, confirmedAtUtcMs: atUtcMs };
          },
          cancel(atUtcMs: UtcEpochMs, reasons: CancellationReasonSet): BookingLifecycle.Cancelled {
            return {
              bookingStatus: BookingStatus.Cancelled,
              cancelledAtUtcMs: atUtcMs,
              cancellationReason: reasons,
            };
          },
          isTerminal: (l: BookingLifecycle): boolean =>
            l.bookingStatus !== BookingStatus.Confirmed,
        } as const;
        export namespace BookingLifecycle {
          export type Confirmed = {
            readonly bookingStatus: typeof BookingStatus.Confirmed;
            readonly confirmedAtUtcMs: UtcEpochMs;
          };
          export type Cancelled = {
            readonly bookingStatus: typeof BookingStatus.Cancelled;
            readonly cancelledAtUtcMs: UtcEpochMs;
            readonly cancellationReason: CancellationReasonSet;
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
        import type { TimeCoordinate } from '../components/time-coordinate.data';
        import type { BookingLifecycle } from '../components/booking-lifecycle.data';
        import type { AppointmentId, BarberId, LocationId, TenantId, UserId } from '../primitives/ids.primitive';
        export type AppointmentMeta = {
          readonly id: AppointmentId;
          readonly tenantId: TenantId;
          readonly locationId: LocationId;
          readonly currency: Currency;
          readonly priceCents: PriceCents;
          readonly barberIds: readonly BarberId[];
          readonly subjectUserIds: readonly UserId[];
          readonly seats: readonly Seat[];
        };
        export type Appointment = AppointmentMeta & TimeCoordinate & BookingLifecycle;
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

  it('the root suffixes are the five no legacy file carries', () => {
    expect(ECS_ROOT_SUFFIXES).toEqual([
      'system',
      'data',
      'entity',
      'primitive',
      'pipeline',
    ]);
    expect(() => ecsSyntaxBlocks(['ports'])).toThrow(/Unknown ECS suffix/);
  });

  it('a primitive is data plus every flatten-pass guard (L6)', async () => {
    const [primitive] = ecsSyntaxBlocks(['primitive']);
    expect(primitive.files).toEqual(['**/*.primitive.ts']);
    expect(primitive.rules['security/detect-object-injection']).toBe('off');
    expect(primitive.rules['@typescript-eslint/no-namespace']).toBe('off');
    const [, ...restrictions] = primitive.rules['no-restricted-syntax'];
    // The ecs-primitives.md template passes …
    expect(
      await lint(
        [
          "import type { Brand } from './brand';",
          'export type MinuteOfDay = Brand<number, "MinuteOfDay">;',
          'export const MinuteOfDay = {',
          '  of(raw: number): Result<MinuteOfDay, PrimitiveError> {',
          '    return Number.isInteger(raw) && raw >= 0 && raw < 1440',
          '      ? Result.ok(raw as MinuteOfDay)',
          "      : Result.err({ errorCode: 'PRIMITIVE_MINUTE_OUT_OF_RANGE', raw, brand: 'MinuteOfDay' });",
          '  },',
          '} as const;',
        ].join('\n'),
        restrictions,
      ),
    ).toEqual([]);
    // … and a raw coordinate, a Date, Intl, a throw and its `new` do not.
    expect(
      await lint(
        "type A = { readonly startMinutes: number }; const f = (x: Date) => Intl.DateTimeFormat; function g() { throw new Error('x'); }",
        restrictions,
      ),
    ).toHaveLength(5);
  });
});

describe('the flatten-pass guards, widened (flatten-spec §7)', () => {
  it('every suffix array carries its flatten-pass guards, and L7 reaches all of them', () => {
    const flatData = [
      ...ECS_GENERIC_DISCRIMINATOR_RESTRICTIONS,
      ...ECS_NESTED_TYPE_RESTRICTIONS,
      ...ECS_RAW_PRIMITIVE_RESTRICTIONS,
      ...ECS_DATE_RESTRICTIONS,
      ECS_THROW_RESTRICTION,
      ...ECS_ID_CAST_RESTRICTIONS,
    ];
    expect(ECS_DATA_RESTRICTIONS).toEqual(expect.arrayContaining(flatData));
    expect(ECS_ENTITY_RESTRICTIONS).toEqual(expect.arrayContaining(flatData));
    expect(ECS_PRIMITIVE_RESTRICTIONS).toEqual(
      expect.arrayContaining(flatData),
    );
    // A system's or port's I/O struct may nest; every other guard holds.
    for (const list of [ECS_SYSTEM_RESTRICTIONS, ECS_PORT_RESTRICTIONS]) {
      expect(list).toEqual(
        expect.arrayContaining([
          ...ECS_GENERIC_DISCRIMINATOR_RESTRICTIONS,
          ...ECS_RAW_PRIMITIVE_RESTRICTIONS,
          ...ECS_DATE_RESTRICTIONS,
          ...ECS_ID_CAST_RESTRICTIONS,
        ]),
      );
    }
    expect(ECS_SYSTEM_RESTRICTIONS).toContain(ECS_THROW_RESTRICTION);
    for (const list of [
      ECS_SYSTEM_RESTRICTIONS,
      ECS_ZONED_TIME_RESTRICTIONS,
      ECS_DATA_RESTRICTIONS,
      ECS_ENTITY_RESTRICTIONS,
      ECS_PRIMITIVE_RESTRICTIONS,
      ECS_PIPELINE_RESTRICTIONS,
      ECS_PORT_RESTRICTIONS,
      ECS_ADAPTER_RESTRICTIONS,
    ]) {
      expect(list).toEqual(expect.arrayContaining(ECS_ID_CAST_RESTRICTIONS));
    }
  });

  it('a suffix block never restates an extra its array already carries', () => {
    const [data] = ecsSyntaxBlocks(['data'], {
      extra: [...ECS_DATE_RESTRICTIONS, ...ECS_TOKEN_RESTRICTIONS],
    });
    const [, ...restrictions] = data.rules['no-restricted-syntax'];
    expect(new Set(restrictions).size).toBe(restrictions.length);
    expect(restrictions).toEqual(
      expect.arrayContaining(ECS_TOKEN_RESTRICTIONS),
    );
  });

  it('L7 does not mistake a companion that takes a UserId for a cast', async () => {
    const restrictions = [...ECS_ID_CAST_RESTRICTIONS];
    expect(
      await lint(
        'export const ClientStats = { empty(subjectUserId: UserId | null, ids: readonly UserId[]) { return { subjectUserId, ids }; } } as const;',
        restrictions,
      ),
    ).toEqual([]);
    expect(await lint('const u = raw as UserId;', restrictions)).toHaveLength(
      1,
    );
  });
});

describe('ecsRootEveryFileBlocks (the workspace root)', () => {
  it('puts L7 beside the icon guards on every file, specs keeping their cast allowance', () => {
    const [ts, spec] = ecsRootEveryFileBlocks();
    expect(ts.files).toEqual(['**/*.ts']);
    expect(ts.rules['no-restricted-syntax']).toEqual([
      'error',
      ...ICON_SYNTAX_RESTRICTIONS,
      ...ECS_ID_CAST_RESTRICTIONS,
    ]);
    expect(spec.files).toEqual(['**/*.spec.ts']);
    expect(spec.rules['no-restricted-syntax']).toEqual([
      'error',
      ...ICON_SPEC_SYNTAX_RESTRICTIONS,
      ...ECS_ID_CAST_RESTRICTIONS,
    ]);
  });
});

describe('ecsProjectBlocks (libs/ecs-core, apps/functions)', () => {
  it('puts the token guard and L7 on every file, specs keep their cast allowance, then all seven suffixes', () => {
    const [ts, spec, ...suffixes] = ecsProjectBlocks();
    expect(ts.files).toEqual(['**/*.ts']);
    expect(ts.rules['no-restricted-syntax']).toEqual([
      'error',
      ...ICON_SYNTAX_RESTRICTIONS,
      ...ECS_ID_CAST_RESTRICTIONS,
      ...ECS_TOKEN_RESTRICTIONS,
    ]);
    expect(spec.files).toEqual(['**/*.spec.ts']);
    expect(spec.rules['no-restricted-syntax']).toEqual([
      'error',
      ...ICON_SPEC_SYNTAX_RESTRICTIONS,
      ...ECS_ID_CAST_RESTRICTIONS,
      ...ECS_TOKEN_RESTRICTIONS,
    ]);
    expect(suffixes).toEqual(
      ecsSyntaxBlocks(ECS_ALL_SUFFIXES, { extra: ECS_TOKEN_RESTRICTIONS }),
    );
  });

  it('everyFile reaches every block — libs/ecs-core puts L4 on specs and test support too', () => {
    const blocks = ecsProjectBlocks({ everyFile: ECS_DATE_RESTRICTIONS });
    for (const block of blocks) {
      expect(block.rules['no-restricted-syntax']).toEqual(
        expect.arrayContaining(ECS_DATE_RESTRICTIONS),
      );
    }
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
