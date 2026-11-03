/**
 * Every emitting tsconfig owns its output folder (CI, 2026-11-03).
 *
 * `tsc --build` writes declarations under `outDir`, mirrored from `rootDir`
 * (the repository root here). While every config shared `dist/out-tsc`, a
 * spec config that compiles ecs-core's sources (35 of them do: their
 * references stop short of `libs/ecs-core/tsconfig.lib.json`) re-emitted
 * ecs-core's declarations to the very paths ecs-core's own build writes and
 * every dependent reads, so a parallel typecheck could read a half-written
 * `.d.ts` (`TS2305 … has no exported member`, main's CI after PR #17). Nx
 * also declared each project's outputs as the whole shared folder, so one
 * cache hit rewrote every project's declarations.
 *
 * The rule: `<projectDir>/tsconfig.<kind>.json` emits to
 * `dist/out-tsc/<projectDir>/<kind>` and names its build-info file
 * `tsconfig.<kind>.tsbuildinfo` inside that folder (the Nx plugin infers the
 * wrong path from `rootDir`, so it is named, never derived). Two configs can
 * then never write the same file, and Nx caches each project's own folder.
 * A generator-made config (`"outDir": "../../dist/out-tsc"`) fails here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, sep } from 'node:path';
import ts from 'typescript';

const SCANNED = ['apps', 'libs', 'tools'];
const SKIPPED = new Set(['node_modules', 'dist', '.angular', '.nx']);
const CONFIG = /^tsconfig\.([a-z][a-z0-9-]*)\.json$/;

/** `tsconfig.<kind>.json` files under apps, libs and tools, repo-relative, posix. */
export function emittingConfigs(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED.has(entry.name)) walk(join(dir, entry.name));
      } else if (CONFIG.test(entry.name)) {
        found.push(join(dir, entry.name).split(sep).join('/'));
      }
    }
  };
  for (const top of SCANNED) walk(top);
  return found.sort();
}

/** The `compilerOptions` a config file states itself (no `extends` merge). */
export function statedOptions(text, path) {
  const { config, error } = ts.parseConfigFileTextToJson(path, text);
  if (error)
    throw new Error(
      `${path}: ${ts.flattenDiagnosticMessageText(error.messageText, ' ')}`,
    );
  return config?.compilerOptions ?? {};
}

/** The folder and build-info file `<dir>/tsconfig.<kind>.json` must state. */
export function expectedOutput(configPath) {
  const dir = posix.dirname(configPath);
  const kind = posix.basename(configPath).match(CONFIG)[1];
  const up = posix.relative(dir, '.') || '.';
  const outDir = `${up}/dist/out-tsc/${dir}/${kind}`;
  return { outDir, tsBuildInfoFile: `${outDir}/tsconfig.${kind}.tsbuildinfo` };
}

/**
 * The problems in a set of configs: `[{ path, options }]` → strings, empty
 * when every config owns its folder and no two configs share one.
 */
export function outDirProblems(configs) {
  const problems = [];
  const owners = new Map();
  for (const { path, options } of configs) {
    const expected = expectedOutput(path);
    if (options.outDir !== expected.outDir) {
      problems.push(
        `${path}: outDir is ${JSON.stringify(options.outDir)}, expected "${expected.outDir}"`,
      );
    }
    if (options.tsBuildInfoFile !== expected.tsBuildInfoFile) {
      problems.push(
        `${path}: tsBuildInfoFile is ${JSON.stringify(options.tsBuildInfoFile)}, expected "${expected.tsBuildInfoFile}"`,
      );
    }
    if (typeof options.outDir === 'string') {
      const resolved = posix.join(posix.dirname(path), options.outDir);
      const other = owners.get(resolved);
      if (other) problems.push(`${path}: shares its outDir with ${other}`);
      else owners.set(resolved, path);
    }
  }
  return problems;
}

/** The repository's configs, read from disk. */
export function repositoryProblems(root) {
  const configs = emittingConfigs(root).map((path) => ({
    path,
    options: statedOptions(readFileSync(join(root, path), 'utf8'), path),
  }));
  return { count: configs.length, problems: outDirProblems(configs) };
}
