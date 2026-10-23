/**
 * `no-restricted-syntax` selectors for the ECS file kinds of CLAUDE.md §2 —
 * the lint form of Laws 1–4 and of the `.claude/rules/ecs-*.md` checklists.
 * Exercised by ecs-syntax.spec.mjs so every selector is tested, not just
 * configured (blueprint docs/architecture/ecs-migration.md §6 Phase 1).
 *
 * AST selectors cannot see file names, so there is ONE array per suffix and
 * each is installed only through its own `files: ['**\/*.<suffix>.ts']`
 * block. `no-restricted-syntax` options replace rather than merge, so every
 * block restates the full list: `[...ICON_SYNTAX_RESTRICTIONS,
 * ...ECS_<SUFFIX>_RESTRICTIONS]` (see `ecsSyntaxBlocks` below).
 *
 * Where each array is installed:
 *  - root eslint.config.mjs — all eight suffix blocks (`ECS_ALL_SUFFIXES`),
 *    each with the `InjectionToken` guard as its `extra`, so every port,
 *    adapter, system, component, entity, primitive and pipeline file of the
 *    workspace carries its kind's guards wherever it lives;
 *  - libs/ecs-core and apps/functions eslint.config.mjs — the same eight,
 *    restated through `ecsProjectBlocks` beside the `InjectionToken` guard on
 *    every file (no Angular lives in either project).
 * Phase 1 kept the port and adapter blocks and the token guard
 * project-scoped while the legacy port files and class adapters existed;
 * Phase 4b deleted those and widened them to the root.
 *
 * The flatten-pass guards (Laws 6 and 7, flatten-spec §7, L1–L7) live in
 * the suffix arrays themselves: data, entities and primitives carry all of
 * them; systems and ports every one but the nested-type guard (a system's
 * I/O struct may nest); pipelines and adapters L7. L7 also reaches every
 * other file of the workspace through `ecsRootEveryFileBlocks`, and
 * libs/ecs-core adds L4 (no `Date`) to every one of its files, specs and
 * test support included (`ecsProjectBlocks({ everyFile })`).
 *
 * Package cages (`luxon`, `dinero.js`, `libphonenumber-js`) are NOT
 * selectors here: they live in `no-restricted-imports`, whose per-file
 * exemption (`phone.system.ts`) a selector could not honour.
 */

import {
  ICON_SPEC_SYNTAX_RESTRICTIONS,
  ICON_SYNTAX_RESTRICTIONS,
} from './icon-syntax.mjs';

// ── shared guards ────────────────────────────────────────────────────────

const CLASS_GUARD = [
  {
    selector: 'ClassDeclaration',
    message:
      'No `class` outside Angular (CLAUDE.md §2): a component is a type + `as const` companion, a port is a function type, an adapter is a function returning the port.',
  },
  {
    selector: 'ClassExpression',
    message:
      'No `class` outside Angular (CLAUDE.md §2): a component is a type + `as const` companion, a port is a function type, an adapter is a function returning the port.',
  },
];

const FREEZE_GUARD = {
  selector:
    'CallExpression[callee.object.name="Object"][callee.property.name="freeze"]',
  message:
    'No `Object.freeze` in production code (Law 1): `readonly` types are the guard; `deepFreeze` is test-only.',
};

/**
 * Property signatures only — an optional FUNCTION PARAMETER stays legal
 * (`Log`'s `fields?`), but a struct that toggles its shape does not.
 */
const IO_OPTIONAL_PROPERTY_GUARD = [
  {
    selector: 'TSPropertySignature[optional=true]',
    message:
      'No optional property in a system, port or pipeline struct — absent is `null`, so every value of the type shares one hidden class.',
  },
  {
    selector: 'TSPropertySignature TSUnionType > TSUndefinedKeyword',
    message:
      'No `| undefined` in a system, port or pipeline struct — absent is `null`, so every value of the type shares one hidden class.',
  },
];

/** Data and entity files: no `?:` and no `| undefined` anywhere. */
const DATA_OPTIONAL_GUARD = [
  {
    selector: 'TSPropertySignature[optional=true]',
    message:
      'No optional property in a component or entity (`.claude/rules/ecs-components.md`) — absent is `null`, so every value shares one hidden class.',
  },
  {
    selector: 'TSUnionType > TSUndefinedKeyword',
    message:
      'No `| undefined` in a component or entity (`.claude/rules/ecs-components.md`) — absent is `null`.',
  },
];

/** Law 1 / Law 2: names, mapper words, and no prototypes on data. */
const DATA_SHAPE_GUARD = [
  {
    selector: 'TSTypeAliasDeclaration[id.name=/Component$/]',
    message:
      'A data name never ends in `Component` — that suffix belongs to Angular (Law 1).',
  },
  {
    selector: 'TSInterfaceDeclaration[id.name=/(Component|Document|Doc)$/]',
    message:
      'No `*Component`/`*Document`/`*Doc` shapes: the Firestore body IS the entity minus `id` (Law 5).',
  },
  {
    selector:
      'Property[key.name=/^(reconstitute|toDocument|fromFirestore|toFirestore|assemble)$/]',
    message:
      'No mapper or assembler on data (Laws 2 and 5): `{ id, ...snap.data() }` is the entity; structural typing is the constructor.',
  },
  FREEZE_GUARD,
  {
    selector: 'NewExpression',
    message:
      'No `new` in a component or entity (Law 1): factories return object literals; a system may allocate a `Map`/`Set` per call.',
  },
  {
    selector: 'ThisExpression',
    message:
      'No `this` in a component or entity (Law 1): companion members are pure functions of their parameters.',
  },
  {
    selector: 'Property[kind="get"]',
    message:
      'No getters on data (Law 1): derive the value in a companion function or a system.',
  },
  {
    selector: 'Property[kind="set"]',
    message:
      'No setters on data (Law 1): data is `readonly`; return a new struct instead.',
  },
  {
    selector: 'MethodDefinition',
    message: 'No methods on data (Law 1): data is a plain struct.',
  },
];

// ── flatten-pass guards (Laws 6 and 7 — flatten-spec §7, L1–L7) ──────────

/** L1 — no generic discriminator (Law 6.2). */
export const ECS_GENERIC_DISCRIMINATOR_RESTRICTIONS = [
  {
    selector: 'TSPropertySignature[key.name=/^(kind|type|status)$/]',
    message:
      'No `kind`/`type`/`status` field (Law 6.2): name the discriminator after its domain (`bookingStatus`, `paymentMethod`, `attendanceState`) with SCREAMING values from its `as const` dictionary.',
  },
  {
    selector: 'Property[key.name=/^(kind|type|status)$/]',
    message:
      'No `kind`/`type`/`status` key (Law 6.2): the discriminator is domain-prefixed (`bookingStatus: BookingStatus.Confirmed`).',
  },
];

/** L2 — no nested object-literal TYPE for a 1-to-1 field (Law 6.1); arrays of literals stay legal. */
export const ECS_NESTED_TYPE_RESTRICTIONS = [
  {
    selector: 'TSPropertySignature > TSTypeAnnotation > TSTypeLiteral',
    message:
      'No nested 1-to-1 struct (Law 6.1): every 1-to-1 field sits at the root of the flat archetype; sub-objects exist only as arrays (1-to-N) or third-party audit blobs.',
  },
  {
    selector:
      'TSPropertySignature > TSTypeAnnotation > TSUnionType > TSTypeLiteral',
    message:
      'No nullable nested 1-to-1 struct (Law 6.1): flatten it into root fields that are all `| null` together, or a variant slice.',
  },
];

/**
 * L3 — a coordinate, money or id property is a brand, never a raw
 * number/string (Law 7.4). The `…Input` structs (foreign input before
 * `parse`) are the escape, and so is a function-typed member: `nextId: () =>
 * string` is the id-minting port the pipeline hands a system (ecs-systems.md),
 * not an id field.
 */
export const ECS_RAW_PRIMITIVE_RESTRICTIONS = [
  {
    selector:
      'TSTypeAliasDeclaration:not([id.name=/Input$/]) TSPropertySignature[key.name=/(Id|Ids|UtcMs|Minutes|Cents|[lL]ocalDate|[tT]imeZone|Latitude|Longitude|[sS]eatKey|[pP]ersonKey)$/] > TSTypeAnnotation :matches(TSNumberKeyword, TSStringKeyword):not(TSFunctionType *)',
    message:
      'A coordinate, amount or id is a branded primitive (Law 7.4): `UtcEpochMs`, `LocalDate`, `MinuteOfDay`/`EndMinute`/`DurationMinutes`, `PriceCents`, `TimeZone`, `XId` — never a raw `number`/`string` (foreign input is an `…Input` struct, parsed at the edge).',
  },
];

/** L4 — no `Date` anywhere in the core (Law 7.1). */
export const ECS_DATE_RESTRICTIONS = [
  {
    selector: "TSTypeReference[typeName.name='Date']",
    message:
      'No `Date` in the core (Law 7.1): instants are `UtcEpochMs`, shop days `LocalDate`, times of day `MinuteOfDay`; zone math is ZonedTimeSystem.',
  },
  {
    selector: "NewExpression[callee.name='Date']",
    message:
      'No `new Date` in the core (Law 7.1): name an instant with the testing `utcMs(…)` helper or `UtcEpochMs.of`; zone math is ZonedTimeSystem.',
  },
  {
    selector: "CallExpression[callee.name='Date']",
    message:
      'No `Date()` in the core (Law 7.1): the clock is the `nowUtcMs` port; zone math is ZonedTimeSystem.',
  },
  {
    selector: "MemberExpression[object.name='Date']",
    message:
      'No `Date.*` in the core (Law 7.1): `Date.parse` → `ZonedTimeSystem.parseOffsetIso`, `Date.now` → the `nowUtcMs` port.',
  },
];

/** L5 — no `throw` outside `primitives/defect.ts` (Law 7.5). */
export const ECS_THROW_RESTRICTION = {
  selector: 'ThrowStatement',
  message:
    'No `throw` in a system, component, entity or primitive (Law 7.5): return a `Result` whose error is a flat `{ errorCode, … }` struct; a programmer defect calls `defect(…)` (primitives/defect.ts).',
};

/**
 * L7 — no cast to `UserId` or `CustomerId` (Law 7.4, D29). The selectors
 * match the ASSERTED type only — the type annotation that is the cast's own
 * child (bare, in a union, in an array) — never a `UserId` annotation inside
 * the asserted expression, so a companion `{ … } as const` whose methods
 * take a `UserId` parameter is not a cast.
 */
const ID_CAST_MESSAGE =
  'No cast to `UserId`/`CustomerId` (Law 7.4, D29): an id of either brand comes only from its companion (`UserId.of/parse`, `CustomerId.forUser`) — never one value used as both.';
const ID_ASSERTION_MESSAGE =
  'No `<UserId>`/`<CustomerId>` assertion (Law 7.4, D29): an id of either brand comes only from its companion.';
const ID_BRAND = 'TSTypeReference[typeName.name=/^(CustomerId|UserId)$/]';

export const ECS_ID_CAST_RESTRICTIONS = [
  { selector: `TSAsExpression > ${ID_BRAND}`, message: ID_CAST_MESSAGE },
  {
    selector: `TSAsExpression > TSUnionType > ${ID_BRAND}`,
    message: ID_CAST_MESSAGE,
  },
  {
    selector: `TSAsExpression > TSArrayType > ${ID_BRAND}`,
    message: ID_CAST_MESSAGE,
  },
  {
    selector: `TSAsExpression > TSTypeOperator > TSArrayType > ${ID_BRAND}`,
    message: ID_CAST_MESSAGE,
  },
  { selector: `TSTypeAssertion > ${ID_BRAND}`, message: ID_ASSERTION_MESSAGE },
  {
    selector: `TSTypeAssertion > TSUnionType > ${ID_BRAND}`,
    message: ID_ASSERTION_MESSAGE,
  },
];

// ── per-suffix arrays ────────────────────────────────────────────────────

/**
 * The one system allowed to touch `Intl` is `zoned-time.system.ts` (owner
 * decision D5, 2026-10-10: zone math is native `Intl`, in one file). Its
 * per-file block restates `ECS_ZONED_TIME_RESTRICTIONS`, which is this array
 * without this one selector.
 */
export const ECS_INTL_RESTRICTION = {
  selector: 'MemberExpression[object.name="Intl"]',
  message:
    'Intl is the zone-math engine of ZonedTimeSystem only (libs/ecs-core/src/systems/zoned-time.system.ts) — take `LocalDate` + `MinuteOfDay` (or a `ShopNow`) instead; formatting belongs to the UI.',
};

/** Law 3: deterministic, I/O-free, mutation-free. */
export const ECS_SYSTEM_RESTRICTIONS = [
  {
    selector: 'NewExpression[callee.name="Date"]',
    message:
      'A system never reads the clock (Law 3): take `now: ShopNow` (or `nowUtcMs: UtcEpochMs` to stamp) as a parameter; zone math goes through ZonedTimeSystem.',
  },
  {
    selector:
      'CallExpression[callee.object.name="Date"][callee.property.name="now"]',
    message:
      'A system never reads the clock (Law 3): take `now: ShopNow` (or `nowUtcMs: UtcEpochMs` to stamp) as a parameter.',
  },
  {
    selector: 'MemberExpression[object.name="Math"][property.name="random"]',
    message:
      'A system never draws randomness (Law 3): take the random value or a `nextId: () => string` as a parameter.',
  },
  {
    selector: 'MemberExpression[object.name="crypto"]',
    message:
      'A system never calls `crypto` (Law 3): take `hash: (input: string) => string` or `nextId` as a parameter.',
  },
  {
    selector: 'ImportDeclaration[source.value=/^(node:)?crypto$/]',
    message:
      'A system never imports `crypto` (Law 3): take `hash`/`nextId` as a parameter supplied by the pipeline.',
  },
  {
    selector: 'AwaitExpression',
    message:
      'A system is synchronous pure math (Law 3): the pipeline awaits the read port and hands the data in.',
  },
  {
    selector:
      'ImportDeclaration[source.value=/^(firebase|firebase-admin|@angular|rxjs|@sentry|pino)/]',
    message:
      'A system imports no SDK, framework or stream library (Law 3): only components, entities and other systems.',
  },
  {
    selector: String.raw`ImportDeclaration[source.value=/\.(port|adapter|pipeline)$/]`,
    message:
      'A system never imports a port, adapter or pipeline (Law 3): the pipeline loads data and calls the system.',
  },
  {
    // Law 8.2: a system never imports the ports or pipelines tiers — not
    // their barrels (`@core/ports`, `@core/pipelines`), not any module inside
    // them. There is no exception: the collection registry a `WriteOp` path
    // is built from is `entities/collections.ts` (`@core/entities`). A
    // `*.port`/`*.adapter`/`*.pipeline` path is left to the selector above.
    selector: String.raw`ImportDeclaration[source.value=/(^|\/)(ports|pipelines)(\/(?!.*\.(port|adapter|pipeline)$).+)?$/]`,
    message:
      'A system imports nothing from the ports or pipelines tiers (Law 3, Law 8.2) — not `@core/ports`, not `@core/pipelines`, not a module inside them: the pipeline owns the I/O boundary. The collection registry is `@core/entities`.',
  },
  ECS_INTL_RESTRICTION,
  FREEZE_GUARD,
  ...IO_OPTIONAL_PROPERTY_GUARD,
  ...CLASS_GUARD,
  // The flatten pass (Laws 6 and 7, flatten-spec §7).
  ...ECS_GENERIC_DISCRIMINATOR_RESTRICTIONS,
  ...ECS_RAW_PRIMITIVE_RESTRICTIONS,
  ...ECS_DATE_RESTRICTIONS,
  ECS_THROW_RESTRICTION,
  ...ECS_ID_CAST_RESTRICTIONS,
];

/** `ECS_SYSTEM_RESTRICTIONS` minus the `Intl` ban — `zoned-time.system.ts` only. */
export const ECS_ZONED_TIME_RESTRICTIONS = ECS_SYSTEM_RESTRICTIONS.filter(
  (restriction) => restriction !== ECS_INTL_RESTRICTION,
);

/** The flatten-pass guards of a data or entity file (Laws 6 and 7). */
const FLAT_DATA_GUARDS = [
  ...ECS_GENERIC_DISCRIMINATOR_RESTRICTIONS,
  ...ECS_NESTED_TYPE_RESTRICTIONS,
  ...ECS_RAW_PRIMITIVE_RESTRICTIONS,
  ...ECS_DATE_RESTRICTIONS,
  ECS_THROW_RESTRICTION,
  ...ECS_ID_CAST_RESTRICTIONS,
];

/** Laws 1, 6 and 7: `*.data.ts`. */
export const ECS_DATA_RESTRICTIONS = [
  ...DATA_OPTIONAL_GUARD,
  ...DATA_SHAPE_GUARD,
  ...CLASS_GUARD,
  ...FLAT_DATA_GUARDS,
];

/**
 * Laws 1 and 7.5: `*.error.ts` (the `@core/errors` tier, and
 * `primitives/primitive.error.ts`) — error dictionaries and their flat
 * structs are data: the same guards as `*.data.ts` (no class, no `new`, no
 * freeze, no optional property, no `throw`, every flatten guard). That an
 * error names no component type is the tier's import rule, not a selector.
 */
export const ECS_ERROR_RESTRICTIONS = [
  ...DATA_OPTIONAL_GUARD,
  ...DATA_SHAPE_GUARD,
  ...CLASS_GUARD,
  ...FLAT_DATA_GUARDS,
];

/** Laws 2, 6 and 7: `*.entity.ts` — the same shape guard as data. */
export const ECS_ENTITY_RESTRICTIONS = [
  ...DATA_OPTIONAL_GUARD,
  ...DATA_SHAPE_GUARD,
  ...CLASS_GUARD,
  ...FLAT_DATA_GUARDS,
];

/** Laws 4 and 7: `*.pipeline.ts` — no SDK, the ports carry it. */
export const ECS_PIPELINE_RESTRICTIONS = [
  {
    selector:
      'ImportDeclaration[source.value=/^(firebase-admin|@angular|pino|@sentry)/]',
    message:
      'A pipeline imports no SDK (Law 4): reach Firestore, logging and error tracking through the ports it is given.',
  },
  FREEZE_GUARD,
  ...IO_OPTIONAL_PROPERTY_GUARD,
  ...CLASS_GUARD,
  ...ECS_ID_CAST_RESTRICTIONS,
];

/** Laws 4, 6 and 7: `*.port.ts` — plain function types, no classes, no shape toggles. */
export const ECS_PORT_RESTRICTIONS = [
  ...IO_OPTIONAL_PROPERTY_GUARD,
  ...CLASS_GUARD,
  ...ECS_GENERIC_DISCRIMINATOR_RESTRICTIONS,
  ...ECS_RAW_PRIMITIVE_RESTRICTIONS,
  ...ECS_DATE_RESTRICTIONS,
  ...ECS_ID_CAST_RESTRICTIONS,
];

/** Law 4: `*.adapter.ts` — a function returning the port, never a class. */
export const ECS_ADAPTER_RESTRICTIONS = [
  ...CLASS_GUARD,
  ...ECS_ID_CAST_RESTRICTIONS,
];

/**
 * L6 — `*.primitive.ts` is data (Laws 1 and 7): the data guards, no `Intl`,
 * and every flatten-pass guard. `primitives/ids.primitive.ts` is the one file
 * exempt from L7 (it IS the companion that makes the two brands) — its
 * project block restates this list without `ECS_ID_CAST_RESTRICTIONS`.
 */
export const ECS_PRIMITIVE_RESTRICTIONS = [
  ...DATA_OPTIONAL_GUARD,
  ...DATA_SHAPE_GUARD,
  ...CLASS_GUARD,
  ECS_INTL_RESTRICTION,
  ...ECS_GENERIC_DISCRIMINATOR_RESTRICTIONS,
  ...ECS_NESTED_TYPE_RESTRICTIONS,
  ...ECS_RAW_PRIMITIVE_RESTRICTIONS,
  ...ECS_DATE_RESTRICTIONS,
  ECS_THROW_RESTRICTION,
  ...ECS_ID_CAST_RESTRICTIONS,
];

/**
 * Law 4: no IoC container outside Angular UI wiring. Installed at the root
 * on the eight suffix blocks, and on every file of libs/ecs-core and
 * apps/functions through `ecsProjectBlocks`. Never on every root `*.ts`: the
 * web's Angular wiring (`ports.tokens.ts`, the SDK providers, the
 * `libs/ui/*` tokens, `app.config.ts`) declares its tokens lawfully.
 */
export const ECS_TOKEN_RESTRICTIONS = [
  {
    selector: 'NewExpression[callee.name="InjectionToken"]',
    message:
      'No `InjectionToken` in ECS code or the functions (Law 4): ports are function types handed in as closure parameters.',
  },
];

const ECS_SUFFIX_RESTRICTIONS = {
  system: ECS_SYSTEM_RESTRICTIONS,
  data: ECS_DATA_RESTRICTIONS,
  error: ECS_ERROR_RESTRICTIONS,
  entity: ECS_ENTITY_RESTRICTIONS,
  primitive: ECS_PRIMITIVE_RESTRICTIONS,
  pipeline: ECS_PIPELINE_RESTRICTIONS,
  port: ECS_PORT_RESTRICTIONS,
  adapter: ECS_ADAPTER_RESTRICTIONS,
};

/**
 * All eight ECS file kinds — installed by the root config and restated by
 * the project-scoped configs of libs/ecs-core and apps/functions.
 */
export const ECS_ALL_SUFFIXES = [
  'system',
  'data',
  'error',
  'entity',
  'primitive',
  'pipeline',
  'port',
  'adapter',
];

/** A system reaches no ambient I/O or timer. */
export const ECS_SYSTEM_GLOBALS = [
  {
    name: 'fetch',
    message: 'A system does no I/O (Law 3): the pipeline reads through a port.',
  },
  {
    name: 'crypto',
    message:
      'A system never calls `crypto` (Law 3): take `hash`/`nextId` as a parameter.',
  },
  {
    name: 'console',
    message:
      'A system does not log (Law 3): return a value; the pipeline logs through the `Log` port.',
  },
  {
    name: 'setTimeout',
    message: 'A system is synchronous pure math (Law 3): no timers.',
  },
];

/**
 * One `files:` block per suffix. Each restates the FULL syntax list —
 * `ICON_SYNTAX_RESTRICTIONS`, the suffix's own array, then `extra` (the
 * token guard, at the root and in the project configs) — because `no-restricted-syntax`
 * options replace, never merge. Systems also get `no-restricted-globals`; data, entities
 * and primitives turn `@typescript-eslint/no-namespace` off for the one
 * type-only namespace; systems, data and primitives turn
 * `security/detect-object-injection` off
 * (indexed scans over struct arrays and `as const` dictionary lookups are
 * the point); ports get `consistent-type-imports` so the `Observable` of a
 * web-facing port is erased at build.
 */
export function ecsSyntaxBlocks(suffixes, { extra = [] } = {}) {
  return suffixes.map((suffix) => {
    const restrictions = ECS_SUFFIX_RESTRICTIONS[suffix];
    if (!restrictions) throw new Error(`Unknown ECS suffix: ${suffix}`);
    const rules = {
      'no-restricted-syntax': [
        'error',
        ...ICON_SYNTAX_RESTRICTIONS,
        ...restrictions,
        // An extra the suffix already carries is not restated: a selector
        // listed twice would report every hit twice.
        ...extra.filter((restriction) => !restrictions.includes(restriction)),
      ],
    };
    if (suffix === 'system') {
      rules['no-restricted-globals'] = ['error', ...ECS_SYSTEM_GLOBALS];
    }
    if (
      suffix === 'system' ||
      suffix === 'data' ||
      suffix === 'error' ||
      suffix === 'primitive'
    ) {
      rules['security/detect-object-injection'] = 'off';
    }
    if (
      suffix === 'data' ||
      suffix === 'error' ||
      suffix === 'entity' ||
      suffix === 'primitive'
    ) {
      rules['@typescript-eslint/no-namespace'] = 'off';
    }
    if (suffix === 'port') {
      rules['@typescript-eslint/consistent-type-imports'] = [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ];
    }
    return { files: [`**/*.${suffix}.ts`], rules };
  });
}

/**
 * The every-file half of the root config (flatten-spec §7): L7 — no cast to
 * `UserId`/`CustomerId` — on every `*.ts` and `*.spec.ts` in the workspace,
 * beside the icon guards. The suffix arrays carry L7 themselves, so a suffix
 * block that replaces these options keeps it.
 */
export function ecsRootEveryFileBlocks() {
  return [
    {
      files: ['**/*.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          ...ICON_SYNTAX_RESTRICTIONS,
          ...ECS_ID_CAST_RESTRICTIONS,
        ],
      },
    },
    {
      // Specs may cast to UiIconName to exercise the runtime fallback.
      files: ['**/*.spec.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          ...ICON_SPEC_SYNTAX_RESTRICTIONS,
          ...ECS_ID_CAST_RESTRICTIONS,
        ],
      },
    },
  ];
}

/**
 * The project-scoped half for libs/ecs-core and apps/functions, appended
 * after `...baseConfig`: the `InjectionToken` guard and L7 on every file
 * (specs keep their UiIconName-cast allowance), then the root's eight suffix
 * blocks restated with the same extras. `everyFile` adds a project's own
 * guards to all of them (libs/ecs-core: L4, no `Date` — specs and test
 * support included). Order matters: a later block replaces the rule's
 * options, so the project's `**\/*.ts` block would replace the root suffix
 * blocks' options on its suffix files — the restated ones come after it.
 */
export function ecsProjectBlocks({ everyFile = [] } = {}) {
  const extra = [...ECS_TOKEN_RESTRICTIONS, ...everyFile];
  return [
    {
      files: ['**/*.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          ...ICON_SYNTAX_RESTRICTIONS,
          ...ECS_ID_CAST_RESTRICTIONS,
          ...extra,
        ],
      },
    },
    {
      files: ['**/*.spec.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          ...ICON_SPEC_SYNTAX_RESTRICTIONS,
          ...ECS_ID_CAST_RESTRICTIONS,
          ...extra,
        ],
      },
    },
    ...ecsSyntaxBlocks(ECS_ALL_SUFFIXES, { extra }),
  ];
}
