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
 * Where each array is installed in Phase 1:
 *  - root eslint.config.mjs — system, data, entity, pipeline (no legacy file
 *    carries those suffixes, so the blocks hit nothing that predates them);
 *  - libs/ecs-core and apps/functions eslint.config.mjs — all six, plus the
 *    port and adapter blocks and the `InjectionToken` guard, which would hit
 *    the 44 legacy `libs/application/**\/*.port.ts` files and the 40 class
 *    adapters elsewhere. Phase 4 widens them to the root when those go.
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
    'Intl is the zone-math engine of ZonedTimeSystem only (libs/ecs-core/src/systems/zoned-time.system.ts) — take epoch ms, minutes-of-day or a precomputed day table instead; formatting belongs to the UI.',
};

/** Law 3: deterministic, I/O-free, mutation-free. */
export const ECS_SYSTEM_RESTRICTIONS = [
  {
    selector: 'NewExpression[callee.name="Date"]',
    message:
      'A system never reads the clock (Law 3): take `nowMs: number` as a parameter; zone math goes through ZonedTimeSystem.',
  },
  {
    selector:
      'CallExpression[callee.object.name="Date"][callee.property.name="now"]',
    message:
      'A system never reads the clock (Law 3): take `nowMs: number` as a parameter.',
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
    // The one sanctioned exception, spelled out: `ports/collections.ts` is a
    // values file (the collection registry a `WriteOp` path is built from,
    // blueprint §4.2); every other module of `ports/` is the I/O boundary.
    // A `*.port`/`*.adapter`/`*.pipeline` path is left to the selector above.
    selector: String.raw`ImportDeclaration[source.value=/(^|\/)ports\/(?!collections$)(?![^\/]*\.(port|adapter|pipeline)$)[^\/]+$/]`,
    message:
      'A system imports nothing from `ports/` but the collection registry `ports/collections` (Law 3, blueprint §4.2): the pipeline owns the I/O boundary.',
  },
  ECS_INTL_RESTRICTION,
  FREEZE_GUARD,
  ...IO_OPTIONAL_PROPERTY_GUARD,
  ...CLASS_GUARD,
];

/** `ECS_SYSTEM_RESTRICTIONS` minus the `Intl` ban — `zoned-time.system.ts` only. */
export const ECS_ZONED_TIME_RESTRICTIONS = ECS_SYSTEM_RESTRICTIONS.filter(
  (restriction) => restriction !== ECS_INTL_RESTRICTION,
);

/** Law 1: `*.data.ts`. */
export const ECS_DATA_RESTRICTIONS = [
  ...DATA_OPTIONAL_GUARD,
  ...DATA_SHAPE_GUARD,
  ...CLASS_GUARD,
];

/** Law 2: `*.entity.ts` — the same shape guard as data. */
export const ECS_ENTITY_RESTRICTIONS = [
  ...DATA_OPTIONAL_GUARD,
  ...DATA_SHAPE_GUARD,
  ...CLASS_GUARD,
];

/** Law 4: `*.pipeline.ts` — no SDK, the ports carry it. */
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
];

/** Law 4: `*.port.ts` — plain function types, no classes, no shape toggles. */
export const ECS_PORT_RESTRICTIONS = [
  ...IO_OPTIONAL_PROPERTY_GUARD,
  ...CLASS_GUARD,
];

/** Law 4: `*.adapter.ts` — a function returning the port, never a class. */
export const ECS_ADAPTER_RESTRICTIONS = [...CLASS_GUARD];

/**
 * Law 4: no IoC container outside Angular UI wiring. Installed only by the
 * project configs of libs/ecs-core and apps/functions in Phase 1 (on every
 * file there); the root gains it in Phase 4 with the legacy token files gone.
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
  entity: ECS_ENTITY_RESTRICTIONS,
  pipeline: ECS_PIPELINE_RESTRICTIONS,
  port: ECS_PORT_RESTRICTIONS,
  adapter: ECS_ADAPTER_RESTRICTIONS,
};

/** The four suffixes no legacy file carries — safe at the workspace root. */
export const ECS_ROOT_SUFFIXES = ['system', 'data', 'entity', 'pipeline'];

/** All six — the project-scoped configs of libs/ecs-core and apps/functions. */
export const ECS_ALL_SUFFIXES = [...ECS_ROOT_SUFFIXES, 'port', 'adapter'];

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
 * token guard in the project configs) — because `no-restricted-syntax`
 * options replace, never merge. Systems also get `no-restricted-globals`; data and entities
 * turn `@typescript-eslint/no-namespace` off for the one type-only
 * namespace; systems and data turn `security/detect-object-injection` off
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
        ...extra,
      ],
    };
    if (suffix === 'system') {
      rules['no-restricted-globals'] = ['error', ...ECS_SYSTEM_GLOBALS];
    }
    if (suffix === 'system' || suffix === 'data') {
      rules['security/detect-object-injection'] = 'off';
    }
    if (suffix === 'data' || suffix === 'entity') {
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
 * The project-scoped half for libs/ecs-core and apps/functions, appended
 * after `...baseConfig`: the `InjectionToken` guard on every file (specs
 * keep their UiIconName-cast allowance), then all six suffix blocks — the
 * root's four restated with the token guard, plus `*.port.ts` and
 * `*.adapter.ts`. Order matters: a later block replaces the rule's options,
 * so the suffix blocks come after the `**\/*.ts` one.
 */
export function ecsProjectBlocks() {
  return [
    {
      files: ['**/*.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          ...ICON_SYNTAX_RESTRICTIONS,
          ...ECS_TOKEN_RESTRICTIONS,
        ],
      },
    },
    {
      files: ['**/*.spec.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          ...ICON_SPEC_SYNTAX_RESTRICTIONS,
          ...ECS_TOKEN_RESTRICTIONS,
        ],
      },
    },
    ...ecsSyntaxBlocks(ECS_ALL_SUFFIXES, { extra: ECS_TOKEN_RESTRICTIONS }),
  ];
}
