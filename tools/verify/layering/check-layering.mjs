#!/usr/bin/env node
// Guard: Law 8 of CLAUDE.md — layered subpath exports and strict dependency
// tiering for libs/ecs-core, plus the repo-wide ban on deep relative imports.
//
//   pnpm nx run verify-tools:layering
//   node tools/verify/layering/check-layering.mjs [--root=<workspace>]
//
// Five checks, each failure printed as `file:line  (check) message`:
//
//   (a) entry points — libs/ecs-core/src has no root barrel (no module sits
//       directly in src/), the retired root alias appears nowhere in
//       libs/apps/tools, and tsconfig.base.json maps exactly the eight
//       `@core/*` aliases to their tier barrels and nothing to the old alias;
//   (b) hierarchy — every import edge inside libs/ecs-core points to a tier
//       its folder may import, never to its own barrel, never through a
//       `..` segment (`../x`, `./../x`, `./a/../b`);
//       specs and type-specs may import any tier but their own (a spec is a
//       graph leaf: it is never imported, so it cannot cycle or ship, and
//       `@core/testing`, which it may import, already reaches every tier) —
//       and so nothing may import a spec or type-spec;
//   (c) cycles — no import cycle in the library's runtime file graph,
//       barrels included (Tarjan's strongly connected components). An
//       `import type` edge is erased at build and is no edge here: two
//       sibling types may name each other (`DurationMinutes` and
//       `MinuteOfDay`), which (b) already confines to one tier;
//   (d) deep relative — no module specifier climbing three or more levels
//       (`../../../`) in libs/apps/tools, with no exception: a file Node
//       loads before any tsconfig alias applies (a nested project's
//       eslint.config.mjs extending the root config) names its target
//       through the root package.json `imports` (`#eslint-config`). File
//       paths handed to `resolve()`/`readFileSync` are not imports, and only
//       code files are read: a CSS `@import` in an app's global stylesheet
//       is outside Law 8.3 (its order fixes the cascade layers);
//   (e) barrels — each tier barrel only re-exports files of its own folder,
//       and every exported name — value or type — has exactly one home
//       tier (`export *` across two barrels never collides at compile time
//       now that no root barrel joins them, so the clash is caught here).
//
// Pure functions over a workspace snapshot (`{ files, tsconfigBase }`), so
// the guard and check-layering.spec.mjs share one reading. Exits 1 on any
// violation. The tier table is mirrored by the per-tier `no-restricted-imports`
// blocks of libs/ecs-core/eslint.config.mjs — keep the two in step.

import { readFileSync, readdirSync } from 'node:fs';
import {
  dirname,
  extname,
  join,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

/** The library's source root, repo-relative (posix). */
export const CORE_SRC = 'libs/ecs-core/src';

/**
 * Law 8.2 — what a PRODUCTION file of each tier folder may import. `testing`
 * (`@core/testing`) is the test-support tier above every production tier;
 * specs and type-specs sit above it and may import any tier but their own.
 */
export const TIER_IMPORTS = new Map([
  ['primitives', []],
  ['errors', ['primitives']],
  ['components', ['errors', 'primitives']],
  ['entities', ['components', 'errors', 'primitives']],
  ['ports', ['entities', 'components', 'errors', 'primitives']],
  ['systems', ['entities', 'components', 'errors', 'primitives']],
  [
    'pipelines',
    ['systems', 'ports', 'entities', 'components', 'errors', 'primitives'],
  ],
  [
    'testing',
    [
      'primitives',
      'errors',
      'components',
      'entities',
      'ports',
      'systems',
      'pipelines',
    ],
  ],
]);

/** Law 8.1 — each `@core/<tier>` alias and the barrel it must map to. */
export const TIER_ALIASES = new Map(
  [...TIER_IMPORTS.keys()].map((tier) => [
    `@core/${tier}`,
    `./${CORE_SRC}/${tier}/index.ts`,
  ]),
);

/**
 * The retired single-barrel alias, assembled so that this guard and its
 * spec do not themselves contain the string they forbid.
 */
export const LEGACY_ALIAS = ['@creativo', 'ecs-core'].join('/');

/** Folders the snapshot walks, repo-relative. */
export const SCANNED_ROOTS = ['libs', 'apps', 'tools'];

const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

const TEXT_EXTENSIONS = new Set([
  ...CODE_EXTENSIONS,
  '.json',
  '.html',
  '.css',
  '.scss',
  '.md',
  '.yml',
  '.yaml',
]);

/** Build output, caches and dependencies — never source. */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'coverage',
  'out-tsc',
  'tmp',
  '.angular',
  '.nx',
  '.vite',
  'test-results',
  'playwright-report',
  '__screenshots__',
]);

/** Calls whose first argument is a module specifier. */
const MODULE_CALLS = new Set([
  'require',
  'require.resolve',
  'vi.mock',
  'vi.doMock',
  'vi.unmock',
  'vi.doUnmock',
  'vi.importActual',
  'vi.importMock',
  'jest.mock',
  'jest.doMock',
  'jest.requireActual',
  'jest.requireMock',
]);

const TEST_FILE = /\.(spec|type-spec|test)\.[cm]?tsx?$/;

export const CHECKS = {
  entryPoints: '(a) entry points',
  hierarchy: '(b) hierarchy',
  cycles: '(c) cycles',
  deepRelative: '(d) deep relative',
  barrels: '(e) barrels',
};

// ── reading ──────────────────────────────────────────────────────────────

export function isCodeFile(path) {
  return CODE_EXTENSIONS.has(extname(path)) && !path.endsWith('.d.ts');
}

export function isTestFile(path) {
  return TEST_FILE.test(path);
}

function scriptKindOf(path) {
  switch (extname(path)) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS;
    case '.jsx':
      return ts.ScriptKind.JSX;
    default:
      return ts.ScriptKind.TS;
  }
}

function callName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression)
  ) {
    return `${expression.expression.text}.${expression.name.text}`;
  }
  return null;
}

function isTypeOnlyImport(declaration) {
  const clause = declaration.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  const named = clause.namedBindings;
  return (
    !clause.name &&
    named !== undefined &&
    ts.isNamedImports(named) &&
    named.elements.length > 0 &&
    named.elements.every((element) => element.isTypeOnly)
  );
}

function isTypeOnlyExport(declaration) {
  if (declaration.isTypeOnly) return true;
  const clause = declaration.exportClause;
  return (
    clause !== undefined &&
    ts.isNamedExports(clause) &&
    clause.elements.length > 0 &&
    clause.elements.every((element) => element.isTypeOnly)
  );
}

/**
 * Every module specifier one file names — static imports and re-exports,
 * `import x = require()`, `import()` (value and type position), `require`
 * and the test runners' module mocks — with its 1-based line and whether
 * the edge is type-only (erased at build).
 */
export function extractImports(path, text) {
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    false,
    scriptKindOf(path),
  );
  const found = [];
  const add = (literal, typeOnly) => {
    const { line } = source.getLineAndCharacterOfPosition(
      literal.getStart(source),
    );
    found.push({ specifier: literal.text, line: line + 1, typeOnly });
  };
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      add(node.moduleSpecifier, isTypeOnlyImport(node));
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      add(node.moduleSpecifier, isTypeOnlyExport(node));
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      add(node.moduleReference.expression, node.isTypeOnly);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      add(node.argument.literal, true);
    } else if (ts.isCallExpression(node)) {
      const [first] = node.arguments;
      const isModuleCall =
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        MODULE_CALLS.has(callName(node.expression));
      if (isModuleCall && first && ts.isStringLiteralLike(first)) {
        add(first, false);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

// ── shared helpers ───────────────────────────────────────────────────────

/**
 * How many levels a relative specifier climbs once normalised — `../a` is 1,
 * `./../../a` is 2, `../../..` is 3 — and 0 for anything else.
 */
export function climbsOf(specifier) {
  const relative =
    specifier === '..' ||
    specifier.startsWith('../') ||
    specifier.startsWith('./');
  if (!relative) return 0;
  let climbs = 0;
  for (const segment of posix.normalize(specifier).split('/')) {
    if (segment !== '..') break;
    climbs += 1;
  }
  return climbs;
}

/**
 * Whether a relative specifier has a `..` segment anywhere — `../a`,
 * `./../a`, and `./a/../b` too, which climbs nowhere but still spells `../`
 * (Law 8.3: no `../` at all inside the library). Mirrors
 * `PARENT_SEGMENT_REGEX` of the lint half (tools/lint-rules).
 */
export function hasParentSegment(specifier) {
  return specifier.startsWith('.') && /(^|\/)\.\.(\/|$)/.test(specifier);
}

/** The tier folder a library file sits in, or null outside one. */
export function tierOf(path) {
  if (!path.startsWith(`${CORE_SRC}/`)) return null;
  const segments = path.slice(CORE_SRC.length + 1).split('/');
  return segments.length > 1 ? segments[0] : null;
}

/** The tier an `@core/...` specifier names, and whether it has a subpath. */
function coreAliasOf(specifier) {
  if (!specifier.startsWith('@core/')) return null;
  const [tier, ...rest] = specifier.slice('@core/'.length).split('/');
  return { tier, subpath: rest.length > 0 };
}

const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.mts', '.cts', '/index.ts'];

/**
 * A relative or `@core/<tier>` specifier resolved to a snapshot file
 * (repo-relative), or null — packages, unknown aliases, missing files.
 */
export function resolveSpecifier(files, from, specifier) {
  const alias = coreAliasOf(specifier);
  if (alias) {
    const barrel = `${CORE_SRC}/${alias.tier}/index.ts`;
    return !alias.subpath && TIER_IMPORTS.has(alias.tier) && files.has(barrel)
      ? barrel
      : null;
  }
  if (!specifier.startsWith('./') && climbsOf(specifier) === 0) {
    return null;
  }
  const base = posix.normalize(posix.join(posix.dirname(from), specifier));
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    if (files.has(candidate) && (suffix !== '' || extname(candidate))) {
      return candidate;
    }
  }
  return null;
}

/** Library code files with their parsed imports, parsed once per snapshot. */
function coreModules(snapshot) {
  const modules = new Map();
  for (const [path, text] of snapshot.files) {
    if (path.startsWith(`${CORE_SRC}/`) && isCodeFile(path)) {
      modules.set(path, extractImports(path, text));
    }
  }
  return modules;
}

function violation(check, file, line, message) {
  return { check, file, line, message };
}

function lineOf(text, needle) {
  const index = text.indexOf(needle);
  return index < 0 ? 1 : text.slice(0, index).split('\n').length;
}

// ── (a) entry points ─────────────────────────────────────────────────────

export function checkEntryPoints(snapshot) {
  const found = [];
  for (const [path, text] of snapshot.files) {
    if (
      path.startsWith(`${CORE_SRC}/`) &&
      !path.slice(CORE_SRC.length + 1).includes('/') &&
      isCodeFile(path)
    ) {
      found.push(
        violation(
          CHECKS.entryPoints,
          path,
          1,
          `No module sits directly in ${CORE_SRC} (Law 8.1): the library has no root barrel and exports only through its tier barrels — move this into a tier folder.`,
        ),
      );
    }
    text.split('\n').forEach((content, index) => {
      if (content.includes(LEGACY_ALIAS)) {
        found.push(
          violation(
            CHECKS.entryPoints,
            path,
            index + 1,
            `The single root barrel is retired (Law 8.1) — import the tier alias (@core/primitives … @core/pipelines, @core/testing in specs) instead of ${LEGACY_ALIAS}.`,
          ),
        );
      }
    });
  }
  found.push(...checkTsconfigPaths(snapshot.tsconfigBase));
  return found;
}

/** tsconfig.base.json: exactly the eight tier aliases, nothing legacy. */
export function checkTsconfigPaths(tsconfigBase) {
  if (!tsconfigBase) return [];
  const { path, text } = tsconfigBase;
  const { config, error } = ts.parseConfigFileTextToJson(path, text);
  if (error) {
    return [
      violation(
        CHECKS.entryPoints,
        path,
        1,
        `Cannot parse: ${ts.flattenDiagnosticMessageText(error.messageText, ' ')}`,
      ),
    ];
  }
  const paths = config?.compilerOptions?.paths ?? {};
  const found = [];
  for (const [key, targets] of Object.entries(paths)) {
    const line = lineOf(text, `"${key}"`);
    if (key === LEGACY_ALIAS || key.startsWith(`${LEGACY_ALIAS}/`)) {
      found.push(
        violation(
          CHECKS.entryPoints,
          path,
          line,
          `"${key}" is the retired root alias (Law 8.1) — delete it; the library exports only through @core/<tier>.`,
        ),
      );
    } else if (key.startsWith('@core/')) {
      const expected = TIER_ALIASES.get(key);
      if (!expected) {
        found.push(
          violation(
            CHECKS.entryPoints,
            path,
            line,
            `"${key}" is not one of the eight tier aliases (Law 8.1: ${[...TIER_ALIASES.keys()].join(', ')}).`,
          ),
        );
      } else if (
        !Array.isArray(targets) ||
        targets.length !== 1 ||
        targets[0] !== expected
      ) {
        found.push(
          violation(
            CHECKS.entryPoints,
            path,
            line,
            `"${key}" must map to ["${expected}"] (Law 8.1), not ${JSON.stringify(targets)}.`,
          ),
        );
      }
    }
  }
  for (const [alias, expected] of TIER_ALIASES) {
    if (!Object.hasOwn(paths, alias)) {
      found.push(
        violation(
          CHECKS.entryPoints,
          path,
          lineOf(text, '"paths"'),
          `"${alias}" is missing — Law 8.1 maps it to ["${expected}"].`,
        ),
      );
    }
  }
  return found;
}

// ── (b) hierarchy ────────────────────────────────────────────────────────

/** Why one import edge of one library file breaks Law 8, or null. */
export function hierarchyBreach(path, specifier) {
  const tier = tierOf(path);
  if (tier === null || !TIER_IMPORTS.has(tier)) return null;
  if (hasParentSegment(specifier)) {
    return 'No `../` inside libs/ecs-core (Law 8.3): another tier is its `@core/<tier>` alias, a sibling in the same tier is `./x`.';
  }
  const alias = coreAliasOf(specifier);
  if (!alias) return null;
  if (!TIER_IMPORTS.has(alias.tier)) {
    return `\`${specifier}\` names no tier (Law 8.1: ${[...TIER_ALIASES.keys()].join(', ')}).`;
  }
  if (alias.subpath) {
    return `Import the tier barrel \`@core/${alias.tier}\` itself, never a path inside it (Law 8.1).`;
  }
  if (alias.tier === tier) {
    return `\`${specifier}\` is this file's own tier barrel — import the sibling with \`./x\` (Law 8.3: a tier importing itself through its barrel cycles).`;
  }
  if (isTestFile(path)) return null;
  if (alias.tier === 'testing') {
    return '`@core/testing` is test support — import it from specs, type-specs and src/testing only (Law 8.1).';
  }
  const allowed = TIER_IMPORTS.get(tier);
  if (!allowed.includes(alias.tier)) {
    return allowed.length === 0
      ? `src/${tier} imports nothing from the library (Law 8.2) — it is the bottom of the hierarchy.`
      : `src/${tier} may import only ${allowed.map((name) => `@core/${name}`).join(', ')} (Law 8.2) — \`${specifier}\` is not below it in primitives → errors → components → entities → systems → pipelines (ports beside).`;
  }
  return null;
}

export function checkHierarchy(snapshot, modules = coreModules(snapshot)) {
  const found = [];
  for (const [path, imports] of modules) {
    const tier = tierOf(path);
    if (tier !== null && !TIER_IMPORTS.has(tier)) {
      found.push(
        violation(
          CHECKS.hierarchy,
          path,
          1,
          `src/${tier} is not a tier (Law 8.1: ${[...TIER_IMPORTS.keys()].join(', ')}) — move this file into the tier it belongs to.`,
        ),
      );
      continue;
    }
    for (const { specifier, line } of imports) {
      const breach =
        hierarchyBreach(path, specifier) ??
        leafBreach(snapshot.files, path, specifier);
      if (breach) found.push(violation(CHECKS.hierarchy, path, line, breach));
    }
  }
  return found;
}

/**
 * Specs and type-specs are graph leaves — the premise of their licence to
 * import any tier. An edge INTO one breaks it: shared test code belongs in
 * src/testing (`@core/testing`).
 */
export function leafBreach(files, path, specifier) {
  const target = resolveSpecifier(files, path, specifier);
  return target !== null && isTestFile(target)
    ? `\`${specifier}\` is a spec or type-spec — a test file is a leaf of the graph and nothing imports it (Law 8): move what it shares into src/testing (\`@core/testing\`).`
    : null;
}

// ── (c) cycles ───────────────────────────────────────────────────────────

/**
 * The library's runtime file graph: path → [{ to, line }], barrels resolved
 * (`@core/<tier>` is an edge to `src/<tier>/index.ts`, whose re-exports are
 * edges on). Type-only imports and re-exports are left out — erased at
 * build, they cannot order module evaluation.
 */
export function importGraph(snapshot, modules = coreModules(snapshot)) {
  const graph = new Map();
  for (const [path, imports] of modules) {
    const edges = [];
    for (const { specifier, line, typeOnly } of imports) {
      if (typeOnly) continue;
      const to = resolveSpecifier(snapshot.files, path, specifier);
      if (to && modules.has(to)) edges.push({ to, line });
    }
    graph.set(path, edges);
  }
  return graph;
}

/** Tarjan's strongly connected components (iterative), in graph order. */
export function stronglyConnected(graph) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  let next = 0;
  for (const root of graph.keys()) {
    if (index.has(root)) continue;
    const work = [{ node: root, edge: 0 }];
    index.set(root, next);
    low.set(root, next);
    next += 1;
    stack.push(root);
    onStack.add(root);
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const edges = graph.get(frame.node) ?? [];
      if (frame.edge < edges.length) {
        const { to } = edges[frame.edge];
        frame.edge += 1;
        if (!index.has(to)) {
          index.set(to, next);
          low.set(to, next);
          next += 1;
          stack.push(to);
          onStack.add(to);
          work.push({ node: to, edge: 0 });
        } else if (onStack.has(to)) {
          low.set(frame.node, Math.min(low.get(frame.node), index.get(to)));
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].node;
        low.set(parent, Math.min(low.get(parent), low.get(frame.node)));
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component = [];
        let member;
        do {
          member = stack.pop();
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        components.push(component);
      }
    }
  }
  return components;
}

/** The shortest cycle through `start` inside one component, as edges. */
function shortestCycle(graph, start, members) {
  const previous = new Map();
  const queue = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const node = queue[head];
    for (const edge of graph.get(node) ?? []) {
      if (!members.has(edge.to)) continue;
      if (edge.to === start) {
        const path = [{ from: node, ...edge }];
        let cursor = node;
        while (cursor !== start) {
          const step = previous.get(cursor);
          path.unshift(step);
          cursor = step.from;
        }
        return path;
      }
      if (!previous.has(edge.to) && edge.to !== start) {
        previous.set(edge.to, { from: node, ...edge });
        queue.push(edge.to);
      }
    }
  }
  return [];
}

export function checkCycles(snapshot, modules = coreModules(snapshot)) {
  const graph = importGraph(snapshot, modules);
  const found = [];
  for (const component of stronglyConnected(graph)) {
    const [only] = component;
    const selfLoop =
      component.length === 1 &&
      (graph.get(only) ?? []).some((edge) => edge.to === only);
    if (component.length === 1 && !selfLoop) continue;
    const start = [...component].sort()[0];
    const cycle = shortestCycle(graph, start, new Set(component));
    const chain = cycle
      .map(({ from, line }) => `${posix.relative(CORE_SRC, from)}:${line}`)
      .concat(posix.relative(CORE_SRC, start))
      .join(' → ');
    found.push(
      violation(
        CHECKS.cycles,
        start,
        cycle[0]?.line ?? 1,
        `Import cycle through ${component.length} file(s) (Law 8.2): ${chain}. Break it with a one-way edge — a sibling with \`./x\`, never a tier above.`,
      ),
    );
  }
  return found;
}

// ── (d) deep relative ────────────────────────────────────────────────────

export function checkDeepRelative(snapshot) {
  const found = [];
  for (const [path, text] of snapshot.files) {
    if (!isCodeFile(path)) continue;
    if (!text.includes('../../..')) continue;
    for (const { specifier, line } of extractImports(path, text)) {
      if (climbsOf(specifier) >= 3) {
        found.push(
          violation(
            CHECKS.deepRelative,
            path,
            line,
            `No deep relative import (Law 8.3): \`${specifier}\` climbs three or more levels — import the target through its alias in tsconfig.base.json (a file Node loads itself, like an ESLint config, through a \`#…\` entry of the root package.json \`imports\`, e.g. \`#eslint-config\`), or move it closer.`,
          ),
        );
      }
    }
  }
  return found;
}

// ── (e) barrels ──────────────────────────────────────────────────────────

export function checkBarrels(snapshot) {
  const found = [];
  for (const tier of TIER_IMPORTS.keys()) {
    const folder = `${CORE_SRC}/${tier}`;
    const path = `${folder}/index.ts`;
    const text = snapshot.files.get(path);
    if (text === undefined) {
      found.push(
        violation(
          CHECKS.barrels,
          path,
          1,
          `The @core/${tier} barrel is missing (Law 8.1) — an empty tier still holds \`export {};\`.`,
        ),
      );
      continue;
    }
    const source = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TS,
    );
    for (const statement of source.statements) {
      const line =
        source.getLineAndCharacterOfPosition(statement.getStart(source)).line +
        1;
      const reject = (message) =>
        found.push(violation(CHECKS.barrels, path, line, message));
      if (!ts.isExportDeclaration(statement)) {
        reject(
          'A tier barrel holds re-exports only (Law 8): no imports, declarations or side effects.',
        );
        continue;
      }
      if (!statement.moduleSpecifier) {
        const empty =
          statement.exportClause &&
          ts.isNamedExports(statement.exportClause) &&
          statement.exportClause.elements.length === 0;
        if (!empty) {
          reject(
            'A tier barrel re-exports files, it never exports local names (Law 8).',
          );
        }
        continue;
      }
      const specifier = ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : '';
      const target = resolveSpecifier(snapshot.files, path, specifier);
      if (!specifier.startsWith('./') || climbsOf(specifier) > 0) {
        reject(
          `The @core/${tier} barrel re-exports only its own folder (Law 8) — \`${specifier}\` is outside src/${tier}.`,
        );
      } else if (!target || !target.startsWith(`${folder}/`)) {
        reject(`\`${specifier}\` resolves to no file in src/${tier}.`);
      }
    }
  }
  return found;
}

/** Every identifier a binding name declares (`const { a, b: [c] } = …`). */
function bindingNames(name) {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
  );
}

/**
 * The names one module exports — declarations, named and namespace
 * re-exports, and `export *` / `export type *` followed through relative
 * files and `@core/<tier>` barrels — each with the file that declares or
 * re-exports it. A default export is left out: `export *` never carries it.
 */
export function exportedNames(files, path, seen = new Set()) {
  const names = new Map();
  if (seen.has(path)) return names;
  seen.add(path);
  const text = files.get(path);
  if (text === undefined) return names;
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  const add = (name, home = path) => {
    if (!names.has(name)) names.set(name, home);
  };
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      const specifier =
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : null;
      const clause = statement.exportClause;
      if (!clause) {
        const target =
          specifier === null ? null : resolveSpecifier(files, path, specifier);
        if (target) {
          for (const [name, home] of exportedNames(files, target, seen)) {
            add(name, home);
          }
        }
      } else if (ts.isNamespaceExport(clause)) {
        add(clause.name.text);
      } else {
        for (const element of clause.elements) add(element.name.text);
      }
      continue;
    }
    const modifiers = ts.canHaveModifiers(statement)
      ? (ts.getModifiers(statement) ?? [])
      : [];
    const exported = modifiers.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    const isDefault = modifiers.some(
      (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
    );
    if (!exported || isDefault) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(declaration.name)) add(name);
      }
    } else if (statement.name && ts.isIdentifier(statement.name)) {
      // functions, classes, types, interfaces, enums and namespaces
      add(statement.name.text);
    }
  }
  return names;
}

/**
 * The line of the first `export` that declares or re-exports `name` (the
 * name before any `=` or `(`), else the line of its first mention.
 */
function exportLineOf(text, name) {
  const index = text.split('\n').findIndex((line) => {
    if (!/\bexport\b/.test(line)) return false;
    const head = line.split(/[=(]/, 1)[0];
    return (head.match(/[\w$]+/g) ?? []).includes(name);
  });
  return index < 0 ? lineOf(text, name) : index + 1;
}

/** (e), second half: a name exported by two tier barrels. */
export function checkNameHomes(snapshot) {
  const homes = new Map();
  for (const tier of TIER_IMPORTS.keys()) {
    const barrel = `${CORE_SRC}/${tier}/index.ts`;
    if (!snapshot.files.has(barrel)) continue;
    for (const [name, file] of exportedNames(snapshot.files, barrel)) {
      homes.set(name, [...(homes.get(name) ?? []), { tier, file }]);
    }
  }
  const found = [];
  for (const [name, places] of homes) {
    if (places.length < 2) continue;
    const [first, ...rest] = places;
    for (const { tier, file } of rest) {
      found.push(
        violation(
          CHECKS.barrels,
          file,
          exportLineOf(snapshot.files.get(file) ?? '', name),
          `\`${name}\` is exported by both @core/${first.tier} (${first.file}) and @core/${tier} — every name has ONE home tier (Law 8): rename one, or import the other tier's instead of re-exporting it.`,
        ),
      );
    }
  }
  return found;
}

// ── all of it ────────────────────────────────────────────────────────────

export function checkLayering(snapshot) {
  const modules = coreModules(snapshot);
  const violations = [
    ...checkEntryPoints(snapshot),
    ...checkHierarchy(snapshot, modules),
    ...checkCycles(snapshot, modules),
    ...checkDeepRelative(snapshot),
    ...checkBarrels(snapshot),
    ...checkNameHomes(snapshot),
  ].sort(
    (left, right) =>
      left.check.localeCompare(right.check) ||
      left.file.localeCompare(right.file) ||
      left.line - right.line,
  );
  const edges = [...modules.values()].reduce(
    (total, imports) => total + imports.length,
    0,
  );
  return {
    violations,
    coreFiles: modules.size,
    coreEdges: edges,
    scannedFiles: snapshot.files.size,
  };
}

export function formatViolation({ check, file, line, message }) {
  return `${file}:${line}  ${check}  ${message}`;
}

// ── the workspace on disk ────────────────────────────────────────────────

/** Text files under libs/apps/tools, plus tsconfig.base.json. */
export function loadWorkspace(root) {
  const files = new Map();
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(absolute);
      } else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name))) {
        const path = relative(root, absolute).split(sep).join('/');
        files.set(path, readFileSync(absolute, 'utf8'));
      }
    }
  };
  for (const folder of SCANNED_ROOTS) walk(join(root, folder));
  let tsconfigBase = null;
  try {
    tsconfigBase = {
      path: 'tsconfig.base.json',
      text: readFileSync(join(root, 'tsconfig.base.json'), 'utf8'),
    };
  } catch {
    tsconfigBase = null;
  }
  return { files, tsconfigBase };
}

function main(argv) {
  const rootArgument = argv.find((argument) => argument.startsWith('--root='));
  const root = rootArgument
    ? resolve(rootArgument.slice('--root='.length))
    : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const report = checkLayering(loadWorkspace(root));
  console.log(
    `Law 8 layering — ${report.coreFiles} files and ${report.coreEdges} import edges in ${CORE_SRC}; ${report.scannedFiles} files scanned in ${SCANNED_ROOTS.join('/')}.`,
  );
  for (const check of Object.values(CHECKS)) {
    const count = report.violations.filter(
      (entry) => entry.check === check,
    ).length;
    console.log(
      `  ${check.padEnd(20)} ${count === 0 ? 'ok' : `${count} violation(s)`}`,
    );
  }
  if (report.violations.length > 0) {
    console.error(`\nFAIL — ${report.violations.length} violation(s):`);
    for (const entry of report.violations) {
      console.error(`  ${formatViolation(entry)}`);
    }
    return 1;
  }
  console.log('\nOK — Law 8 holds.');
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = main(process.argv.slice(2));
}
